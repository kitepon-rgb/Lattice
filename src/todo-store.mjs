import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir,
} from 'node:fs/promises';
import path from 'node:path';
import {
  TODO_LIMITS,
  canonicalizeTodoArtifact,
  digestTodoArtifact,
  exactRecord,
  isStrictTodoTimestamp,
  isTodoDigest,
  isTodoIdentifier,
  todoSelfDigest,
  validateEvidenceDescriptor,
  validateTodoImportSource,
  validateTodoEvent,
  validateTodoManifest,
  validateTodoPlan,
  validateTodoSnapshot,
} from './todo-contracts.mjs';
import { sha256Bytes, verifyLinearHashChain } from './hash-chain.mjs';
import {
  parseTodoSourceRef,
  todoCutoverArchiveSourceRef,
  todoLegacyReconciliationDigest,
  validatePhaseTodoRevision,
  validateTodoRevision,
  validateTodoRevisionSet,
} from './todo-revision.mjs';

const STORE_ROOT_REF = '.lattice/todo';
const MANIFEST_REF = `${STORE_ROOT_REF}/manifest.json`;
const SOURCE_CUTOVER_BARRIER_REF = `${STORE_ROOT_REF}/source-cutover-recovery.json`;
const SOURCE_CUTOVER_RECOVERY_CAPABILITY = Symbol('lattice.todo.source-cutover-recovery');
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const WRITER_CALLERS = new Set(['g4-migration', 'g5-authoring']);

export class TodoStoreError extends Error {
  constructor(code, reason, message = reason, detail = {}) {
    super(message);
    this.name = 'TodoStoreError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

export function createTodoStoreWriter(options = {}) {
  if (!exactRecord(options, ['caller']) || !WRITER_CALLERS.has(options.caller)) {
    throw new TypeError('todo store writer caller must be g4-migration or g5-authoring');
  }
  return Object.freeze({ schema: 'lattice.todo_store_writer.v1', caller: options.caller });
}

function fail(code, reason, detail) {
  throw new TodoStoreError(code, reason, reason, detail);
}

function requireWriter(writer, caller) {
  if (!exactRecord(writer, ['schema', 'caller']) || writer.schema !== 'lattice.todo_store_writer.v1'
    || writer.caller !== caller) throw new TypeError(`writer capability for ${caller} required`);
}

function canonicalLine(value) {
  return Buffer.from(`${canonicalizeTodoArtifact(value)}\n`, 'utf8');
}

async function pathState(repoRoot, ref, classification, { missing = false } = {}) {
  let canonicalRepoRoot;
  try { canonicalRepoRoot = await realpath(repoRoot); } catch { canonicalRepoRoot = path.resolve(repoRoot); }
  const absolute = path.resolve(canonicalRepoRoot, ref);
  const root = path.resolve(canonicalRepoRoot, STORE_ROOT_REF);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    fail(classification, 'path_outside_store', { ref });
  }
  let stats;
  try { stats = await lstat(absolute); } catch (error) {
    if (missing && error?.code === 'ENOENT') return null;
    fail(classification, 'artifact_missing', { ref });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) fail(classification, 'unsafe_artifact_path', { ref });
  const resolved = await realpath(absolute);
  if (resolved !== absolute) fail(classification, 'path_alias_or_escape', { ref });
  return { absolute, stats };
}

function decodeUtf8(bytes, code, reason) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail(code, reason); }
}

function parseCanonicalJsonLine(bytes, { code, reason, maxBytes, validate }) {
  if (bytes.length === 0 || bytes.length > maxBytes) fail(code, bytes.length > maxBytes ? 'size_limit_exceeded' : reason);
  const text = decodeUtf8(bytes, code, 'invalid_utf8');
  if (!text.endsWith('\n') || text.includes('\r') || text.startsWith('\uFEFF')
    || text.slice(0, -1).includes('\n')) fail(code, reason);
  let value;
  try { value = JSON.parse(text.slice(0, -1)); } catch { fail(code, reason); }
  let expected;
  try { expected = `${canonicalizeTodoArtifact(value)}\n`; } catch { fail(code, reason); }
  if (text !== expected) fail(code, 'non_canonical_or_duplicate_key');
  if (!validate(value)) fail(code, 'schema_invalid');
  return value;
}

async function readArtifact(repoRoot, ref, { code, maxBytes, validate, missing = false }) {
  const state = await pathState(repoRoot, ref, code, { missing });
  if (state === null) return null;
  const bytes = await readFile(state.absolute);
  return parseCanonicalJsonLine(bytes, { code, reason: 'artifact_truncated_or_trailing_bytes', maxBytes, validate });
}

async function readSnapshotArtifact(repoRoot, ref) {
  const state = await pathState(repoRoot, ref, 'STORE_INCONSISTENT', { missing: true });
  if (state === null) return null;
  const bytes = await readFile(state.absolute);
  return parseCanonicalJsonLine(bytes, {
    code: 'SNAPSHOT_INVALID', reason: 'snapshot_truncated_or_trailing_bytes',
    maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoSnapshot,
  });
}

function parseJournalSegment(bytes) {
  if (bytes.length === 0 || bytes.length > TODO_LIMITS.journalSegmentBytes) {
    fail('STORE_CORRUPT', bytes.length > TODO_LIMITS.journalSegmentBytes ? 'journal_segment_limit_exceeded' : 'journal_empty');
  }
  const text = decodeUtf8(bytes, 'STORE_CORRUPT', 'journal_invalid_utf8');
  if (!text.endsWith('\n') || text.includes('\r') || text.startsWith('\uFEFF')) fail('STORE_CORRUPT', 'journal_byte_contract');
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => line.length === 0)) fail('STORE_CORRUPT', 'journal_truncated_or_empty_line');
  return lines.map((line) => {
    let event;
    try { event = JSON.parse(line); } catch { fail('STORE_CORRUPT', 'journal_json_invalid'); }
    let canonical;
    try { canonical = canonicalizeTodoArtifact(event); } catch { fail('STORE_CORRUPT', 'journal_schema_invalid'); }
    if (line !== canonical) fail('STORE_CORRUPT', 'journal_non_canonical_or_duplicate_key');
    if (!validateTodoEvent(event)) fail('STORE_CORRUPT', 'journal_schema_invalid');
    return event;
  });
}

async function readJournal(repoRoot, journalRef) {
  const state = await pathState(repoRoot, journalRef, 'STORE_CORRUPT');
  const directory = path.dirname(state.absolute);
  const sealedDirectory = path.join(directory, 'sealed');
  const segments = [];
  try {
    const sealedStats = await lstat(sealedDirectory);
    if (sealedStats.isSymbolicLink() || !sealedStats.isDirectory()) fail('STORE_CORRUPT', 'unsafe_sealed_directory');
    const names = (await readdir(sealedDirectory)).sort();
    for (const name of names) {
      if (!/^\d{12}-\d{12}-[0-9a-f]{64}-[0-9a-f]{64}\.jsonl$/u.test(name)) {
        fail('STORE_CORRUPT', 'sealed_segment_name_invalid', { name });
      }
      const ref = path.posix.join(path.posix.dirname(journalRef), 'sealed', name);
      const sealed = await pathState(repoRoot, ref, 'STORE_CORRUPT');
      const bytes = await readFile(sealed.absolute);
      const [, startText, endText, previousDigest, segmentDigest] = name.match(
        /^(\d{12})-(\d{12})-([0-9a-f]{64})-([0-9a-f]{64})\.jsonl$/u,
      );
      if (sha256Bytes(bytes) !== segmentDigest) fail('STORE_CORRUPT', 'sealed_segment_digest_mismatch');
      const events = parseJournalSegment(bytes);
      if (events[0].sequence !== Number(startText) || events.at(-1).sequence !== Number(endText)) {
        fail('STORE_CORRUPT', 'sealed_segment_range_mismatch');
      }
      if (previousDigest !== (segments.at(-1)?.events.at(-1).event_digest ?? '0'.repeat(64))) {
        fail('STORE_CORRUPT', 'sealed_segment_link_mismatch');
      }
      segments.push({ ref, bytes, events });
    }
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    if (error?.code !== 'ENOENT') fail('STORE_CORRUPT', 'sealed_segment_read_failed');
  }
  const activeBytes = await readFile(state.absolute);
  segments.push({ ref: journalRef, bytes: activeBytes, events: parseJournalSegment(activeBytes) });
  const events = segments.flatMap(({ events: entries }) => entries);
  const failures = verifyLinearHashChain({
    entries: events,
    canonicalize: canonicalizeTodoArtifact,
    digestField: 'event_digest',
    genesisPrevious: events[0]?.previous_digest ?? null,
  });
  if (failures.size > 0) fail('STORE_CORRUPT', [...failures].sort()[0], { failed_conditions: [...failures].sort() });
  if (events[0]?.kind !== 'plan_genesis' || events.slice(1).some(({ kind }) => kind === 'plan_genesis')) {
    fail('STORE_CORRUPT', 'genesis_missing_or_repeated');
  }
  const successorSchema = events[0].schema === 'lattice.todo_event.v2';
  const phaseSchema = ['lattice.todo_event.v3', 'lattice.todo_event.v4'].includes(events[0].schema);
  const phaseRevisionSchema = events[0].schema === 'lattice.todo_event.v4';
  const phaseTail = (event) => event.schema === 'lattice.todo_event.v3';
  const legacyTail = (event) => event.schema === 'lattice.todo_event.v1';
  if ((phaseSchema && events.some(({ schema }, index) => index === 0
    ? !['lattice.todo_event.v3', 'lattice.todo_event.v4'].includes(schema) : !phaseTail(events[index])))
    || (!phaseSchema && events.slice(1).some((event) => !legacyTail(event)))
    || (!phaseSchema && !successorSchema && events.some((event, index) => index === 0
      ? event.schema !== 'lattice.todo_event.v1' : !legacyTail(event)))) {
    fail('STORE_CORRUPT', 'journal_schema_sequence_invalid');
  }
  return { segments, events, activeBytes };
}

function taskState(taskId) {
  return { task_id: taskId, status: 'pending', started_at: null, done_at: null, blocked_reason: null,
    evidence: null, evidence_unverified: false, imported: false };
}

function emptyPhaseState(phaseId) {
  return { phase_id: phaseId, status: 'locked', review_event_digest: null,
    decision_event_digest: null, decision_evidence: null };
}

function derivedPhaseStatus(plan, taskStates, phaseStates, phaseId) {
  const state = phaseStates.get(phaseId);
  if (['reviewing', 'accepted', 'rejected'].includes(state.status)) return state.status;
  const phase = plan.phases.find((entry) => entry.phase_id === phaseId);
  if (!phase.predecessor_phase_ids.every((id) => phaseStates.get(id)?.status === 'accepted')) return 'locked';
  const tasks = plan.tasks.filter((entry) => entry.phase_id === phaseId);
  return tasks.every((entry) => taskStates.get(entry.task_id)?.status === 'done') ? 'gate_ready' : 'active';
}

function projectPhaseStates(plan, events, taskStates) {
  if (!['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema)) return [];
  const states = new Map(plan.phases.map(({ phase_id }) => [phase_id, emptyPhaseState(phase_id)]));
  for (const event of events) {
    if (event.schema === 'lattice.todo_event.v4') {
      for (const migration of event.phase_state_migration) {
        if (migration.state_policy === 'carry') {
          Object.assign(states.get(migration.phase_id), structuredClone(migration.state));
        }
      }
    } else if (event.kind === 'phase_review') {
      const state = states.get(event.phase_id);
      state.status = 'reviewing'; state.review_event_digest = event.event_digest;
      state.decision_event_digest = null; state.decision_evidence = null;
    } else if (event.kind === 'phase_accept') {
      const state = states.get(event.phase_id);
      state.status = 'accepted'; state.decision_event_digest = event.event_digest;
      state.decision_evidence = event.payload.decision_evidence;
    } else if (event.kind === 'phase_reject') {
      const state = states.get(event.phase_id);
      state.status = 'rejected'; state.decision_event_digest = event.event_digest;
      state.decision_evidence = event.payload.decision_evidence;
    } else if (event.kind === 'phase_reopen') {
      Object.assign(states.get(event.phase_id), emptyPhaseState(event.phase_id));
    }
  }
  for (const phase of plan.phases) {
    const state = states.get(phase.phase_id);
    state.status = derivedPhaseStatus(plan, taskStates, states, phase.phase_id);
  }
  return [...states.values()].sort((left, right) => left.phase_id.localeCompare(right.phase_id));
}

function localPredecessors(plan, taskId) {
  const result = [];
  for (const edge of plan.hard_dependencies) {
    if (edge.to.project_id === plan.project_id && edge.to.plan_key === plan.plan_key && edge.to.task_id === taskId
      && edge.from.project_id === plan.project_id && edge.from.plan_key === plan.plan_key) result.push(edge.from.task_id);
  }
  for (const join of plan.joins) {
    if (join.before.project_id === plan.project_id && join.before.plan_key === plan.plan_key && join.before.task_id === taskId) {
      for (const after of join.after) if (after.project_id === plan.project_id && after.plan_key === plan.plan_key) result.push(after.task_id);
    }
  }
  return [...new Set(result)];
}

function localSuccessors(plan, taskId) {
  return plan.tasks.map(({ task_id }) => task_id).filter((candidate) => localPredecessors(plan, candidate).includes(taskId));
}

function replay(plan, events, { now = new Date(), verifyEvidence, verifyImportSource } = {}) {
  const states = new Map(plan.tasks.map(({ task_id }) => [task_id, taskState(task_id)]));
  const phaseStates = new Map((plan.phases ?? []).map(({ phase_id }) => [phase_id, emptyPhaseState(phase_id)]));
  const doneDigest = new Map();
  const completion = new Map();
  const importedGenesis = events[0]?.payload.historical_import === true;
  let previousTime = null;
  for (const event of events) {
    if (event.project_id !== plan.project_id || event.plan_key !== plan.plan_key || event.plan_version !== plan.plan_version) {
      fail('STORE_CORRUPT', 'journal_identity_mismatch');
    }
    if (!isStrictTodoTimestamp(event.recorded_at)) fail('STORE_CORRUPT', 'timestamp_invalid');
    const time = Date.parse(event.recorded_at);
    if (previousTime !== null && time < previousTime) fail('STORE_INCONSISTENT', 'clock_reversal');
    if (time > now.valueOf() + MAX_FUTURE_SKEW_MS) fail('STORE_INCONSISTENT', 'future_clock_skew');
    previousTime = time;
    if (event.kind === 'plan_genesis') {
      if (event.payload.plan_digest !== plan.plan_digest || event.payload.topology_digest !== plan.topology_digest
        || event.payload.predecessor_plan_digest !== plan.predecessor_plan_digest) {
        fail('STORE_INCONSISTENT', 'genesis_plan_binding_mismatch');
      }
      if (['lattice.todo_event.v2', 'lattice.todo_event.v4'].includes(event.schema)) {
        const projected = event.state_migration.map(({ from_task_id, to_task_id }) => ({
          from_task_id, to_task_id,
        }));
        if (canonicalizeTodoArtifact(projected) !== canonicalizeTodoArtifact(event.payload.task_migration)) {
          fail('STORE_INCONSISTENT', 'genesis_migration_projection_mismatch');
        }
        const activeTargets = event.state_migration
          .filter(({ to_task_id }) => to_task_id !== 'removed').map(({ to_task_id }) => to_task_id);
        if (new Set(activeTargets).size !== activeTargets.length
          || activeTargets.some((taskId) => !states.has(taskId))) {
          fail('STORE_INCONSISTENT', 'genesis_migration_target_invalid');
        }
        for (const migration of event.state_migration) {
          if (!['carry', 'carry_reconciled_metadata'].includes(migration.state_policy)) continue;
          const state = states.get(migration.to_task_id);
          Object.assign(state, structuredClone(migration.state), { evidence_unverified: false });
          if (state.evidence !== null) {
            if (state.imported) {
              if (verifyImportSource) verifyImportSource(state.evidence);
            } else if (verifyEvidence) verifyEvidence(state.evidence);
          }
          if (state.status === 'done') {
            doneDigest.set(migration.to_task_id, event.event_digest);
            completion.set(migration.to_task_id, state.imported
              ? { mode: 'historical_import', completed_at: state.done_at ?? 'unknown_requires_evidence' }
              : { mode: 'authored', completed_at: state.done_at });
          }
        }
        if (event.schema === 'lattice.todo_event.v4') {
          for (const migration of event.phase_state_migration) {
            if (migration.state_policy === 'carry') {
              Object.assign(phaseStates.get(migration.phase_id), structuredClone(migration.state));
            }
          }
        }
      }
      continue;
    }
    if (event.kind.startsWith('phase_')) {
      if (!['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema) || !phaseStates.has(event.phase_id)) {
        fail('STORE_INCONSISTENT', 'event_phase_missing');
      }
      const state = phaseStates.get(event.phase_id);
      const currentStatus = derivedPhaseStatus(plan, states, phaseStates, event.phase_id);
      if (event.kind === 'phase_review') {
        if (currentStatus !== 'gate_ready') fail('STORE_INCONSISTENT', 'phase_gate_not_ready');
        state.status = 'reviewing'; state.review_event_digest = event.event_digest;
        state.decision_event_digest = null; state.decision_evidence = null;
      } else if (event.kind === 'phase_accept') {
        const phase = plan.phases.find(({ phase_id }) => phase_id === event.phase_id);
        const slots = event.payload.evidence_slots.map(({ slot_id }) => slot_id);
        if (currentStatus !== 'reviewing' || state.review_event_digest !== event.payload.review_event_digest
          || canonicalizeTodoArtifact(slots) !== canonicalizeTodoArtifact(phase.required_evidence_slots)) {
          fail('STORE_INCONSISTENT', 'phase_accept_binding_invalid');
        }
        if (verifyEvidence) {
          verifyEvidence(event.payload.decision_evidence);
          for (const slot of event.payload.evidence_slots) verifyEvidence(slot.evidence);
        }
        state.status = 'accepted'; state.decision_event_digest = event.event_digest;
        state.decision_evidence = event.payload.decision_evidence;
      } else if (event.kind === 'phase_reject') {
        if (currentStatus !== 'reviewing' || state.review_event_digest !== event.payload.review_event_digest) {
          fail('STORE_INCONSISTENT', 'phase_reject_binding_invalid');
        }
        if (verifyEvidence) verifyEvidence(event.payload.decision_evidence);
        state.status = 'rejected'; state.decision_event_digest = event.event_digest;
        state.decision_evidence = event.payload.decision_evidence;
      } else {
        if (!['accepted', 'rejected'].includes(currentStatus)
          || state.decision_event_digest !== event.payload.target_decision_digest) {
          fail('STORE_INCONSISTENT', 'phase_reopen_binding_invalid');
        }
        const successorStarted = currentStatus === 'accepted' && (plan.schema === 'lattice.todo_plan.v4'
          ? plan.phases.some((phase) => phase.predecessor_phase_ids.includes(event.phase_id)
            && (phaseStates.get(phase.phase_id).status !== 'locked'
              || plan.tasks.some((task) => task.phase_id === phase.phase_id
                && states.get(task.task_id).status !== 'pending')))
          : plan.phases.some((phase) => phase.predecessor_phase_ids.includes(event.phase_id)
              && phaseStates.get(phase.phase_id).status !== 'locked')
            || plan.phase_accept_dependencies.some((edge) => edge.from.project_id === plan.project_id
              && edge.from.plan_key === plan.plan_key && edge.from.phase_id === event.phase_id
              && edge.to.project_id === plan.project_id && edge.to.plan_key === plan.plan_key
              && states.get(edge.to.task_id)?.status !== 'pending'));
        if (successorStarted && event.payload.override_reason === null) {
          fail('STORE_INCONSISTENT', 'phase_reopen_has_started_successor');
        }
        Object.assign(state, emptyPhaseState(event.phase_id));
      }
      continue;
    }
    const state = states.get(event.task_id);
    if (state === undefined) fail('STORE_INCONSISTENT', 'event_task_missing');
    const dependenciesDone = localPredecessors(plan, event.task_id).every((id) => states.get(id)?.status === 'done');
    if (event.kind === 'start') {
      if (event.payload.start_mode === 'historical_import') {
        if (!importedGenesis || state.status !== 'pending') {
          fail('STORE_INCONSISTENT', 'invalid_historical_import_start_transition');
        }
        if (verifyImportSource) verifyImportSource(event.payload.evidence);
        state.status = 'in-progress';
        state.started_at = event.payload.started_at === 'unknown_requires_evidence'
          ? null : event.payload.started_at;
        state.evidence = event.payload.evidence;
        state.imported = true;
      } else {
        const phaseStatus = plan.schema === 'lattice.todo_plan.v4'
          ? derivedPhaseStatus(plan, states, phaseStates,
            plan.tasks.find(({ task_id }) => task_id === event.task_id).phase_id) : 'active';
        if (state.status !== 'pending' || phaseStatus !== 'active'
          || (!dependenciesDone && event.payload.override_reason === null)) {
          fail('STORE_INCONSISTENT', 'invalid_start_transition');
        }
        state.status = 'in-progress'; state.started_at = event.recorded_at;
      }
    } else if (event.kind === 'block') {
      if (state.status !== 'in-progress') fail('STORE_INCONSISTENT', 'invalid_block_transition');
      state.status = 'blocked'; state.blocked_reason = event.payload.reason;
    } else if (event.kind === 'unblock') {
      if (state.status !== 'blocked') fail('STORE_INCONSISTENT', 'invalid_unblock_transition');
      state.status = 'in-progress'; state.blocked_reason = null;
    } else if (event.kind === 'done') {
      if (event.payload.done_mode === 'authored') {
        if (state.status !== 'in-progress' || !dependenciesDone) fail('STORE_INCONSISTENT', 'invalid_done_transition');
        if (verifyEvidence) verifyEvidence(event.payload.evidence);
        state.status = 'done'; state.done_at = event.recorded_at; state.evidence = event.payload.evidence;
        state.imported = false;
        completion.set(event.task_id, { mode: 'authored', completed_at: event.recorded_at });
      } else if (event.payload.done_mode === 'historical_import') {
        if (!importedGenesis || state.status !== 'pending') fail('STORE_INCONSISTENT', 'invalid_historical_import_transition');
        if (verifyImportSource) verifyImportSource(event.payload.evidence);
        state.status = 'done'; state.done_at = event.payload.completed_at === 'unknown_requires_evidence'
          ? null : event.payload.completed_at;
        state.evidence = event.payload.evidence; state.imported = true;
        completion.set(event.task_id, { mode: 'historical_import', completed_at: event.payload.completed_at });
      } else {
        const current = completion.get(event.task_id);
        if (state.status !== 'done' || current?.mode !== 'historical_import'
          || current.completed_at !== 'unknown_requires_evidence'
          || doneDigest.get(event.task_id) !== event.payload.target_done_digest) {
          fail('STORE_INCONSISTENT', 'invalid_evidence_promotion');
        }
        if (verifyEvidence) verifyEvidence(event.payload.evidence);
        state.evidence = event.payload.evidence;
        completion.set(event.task_id, { mode: 'evidence_promotion', completed_at: current.completed_at });
      }
      doneDigest.set(event.task_id, event.event_digest);
    } else if (event.kind === 'reopen') {
      if (state.status !== 'done' || doneDigest.get(event.task_id) !== event.payload.target_done_digest) {
        fail('STORE_INCONSISTENT', 'invalid_reopen_binding');
      }
      if (['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema)) {
        const phaseId = plan.tasks.find(({ task_id }) => task_id === event.task_id).phase_id;
        if (derivedPhaseStatus(plan, states, phaseStates, phaseId) === 'accepted') {
          fail('STORE_INCONSISTENT', 'task_reopen_requires_phase_reopen');
        }
      }
      const startedSuccessor = localSuccessors(plan, event.task_id).some((id) => states.get(id).status !== 'pending');
      if (startedSuccessor && event.payload.override_reason === null) fail('STORE_INCONSISTENT', 'reopen_has_started_successor');
      state.status = 'in-progress'; state.done_at = null; state.evidence = null;
      completion.delete(event.task_id);
    }
  }
  return [...states.values()].sort((left, right) => left.task_id < right.task_id ? -1 : left.task_id > right.task_id ? 1 : 0);
}

function snapshotFor(plan, events, tasks) {
  const head = events.at(-1);
  const phasePlan = ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema);
  const snapshot = {
    schema: phasePlan ? 'lattice.todo_snapshot.v2' : 'lattice.todo_snapshot.v1',
    project_id: plan.project_id, plan_key: plan.plan_key,
    plan_version: plan.plan_version, projection_version: phasePlan ? 2 : 1, through_sequence: head.sequence,
    journal_head_digest: head.event_digest, tasks, snapshot_digest: '',
    ...(phasePlan ? { phases: projectPhaseStates(plan, events,
      new Map(tasks.map((task) => [task.task_id, task]))) } : {}),
  };
  snapshot.snapshot_digest = todoSelfDigest(snapshot, 'snapshot_digest');
  return snapshot;
}

function validateMergedGraph(members) {
  const tasks = new Map();
  for (const member of members) for (const task of member.plan.tasks) {
    tasks.set(`${member.plan.project_id}\0${member.plan.plan_key}\0${task.task_id}`, member.plan.topology_digest);
  }
  const adjacency = new Map([...tasks.keys()].map((key) => [key, []]));
  const phases = new Map();
  for (const member of members) {
    if (member.plan.schema !== 'lattice.todo_plan.v5') continue;
    for (const phase of member.plan.phases) {
      const key = `phase\0${member.plan.project_id}\0${member.plan.plan_key}\0${phase.phase_id}`;
      phases.set(key, member.plan.topology_digest);
      adjacency.set(key, []);
    }
  }
  const bind = (ref, ownerPlan) => {
    const key = `${ref.project_id}\0${ref.plan_key}\0${ref.task_id}`;
    const topology = tasks.get(key);
    if (topology === undefined) fail('STORE_INCONSISTENT', 'dangling_dependency');
    if ((ref.project_id !== ownerPlan.project_id || ref.plan_key !== ownerPlan.plan_key)
      && ref.expected_topology_digest === undefined) fail('STORE_INCONSISTENT', 'cross_plan_binding_missing');
    if (ref.expected_topology_digest !== undefined && topology !== ref.expected_topology_digest) {
      fail('STORE_INCONSISTENT', 'binding_stale');
    }
    return key;
  };
  const bindPhase = (ref, ownerPlan) => {
    const key = `phase\0${ref.project_id}\0${ref.plan_key}\0${ref.phase_id}`;
    const topology = phases.get(key);
    if (topology === undefined) fail('STORE_INCONSISTENT', 'dangling_phase_dependency');
    if ((ref.project_id !== ownerPlan.project_id || ref.plan_key !== ownerPlan.plan_key)
      && ref.expected_topology_digest === undefined) fail('STORE_INCONSISTENT', 'cross_plan_binding_missing');
    if (ref.expected_topology_digest !== undefined && topology !== ref.expected_topology_digest) {
      fail('STORE_INCONSISTENT', 'binding_stale');
    }
    return key;
  };
  for (const { plan } of members) {
    for (const edge of plan.hard_dependencies) {
      const from = bind(edge.from, plan); const to = bind(edge.to, plan);
      if (from === to) fail('STORE_INCONSISTENT', 'self_edge');
      adjacency.get(from).push(to);
    }
    for (const join of plan.joins) {
      const before = bind(join.before, plan);
      for (const afterRef of join.after) {
        const after = bind(afterRef, plan);
        if (after === before) fail('STORE_INCONSISTENT', 'join_self_edge');
        adjacency.get(after).push(before);
      }
    }
    if (plan.schema === 'lattice.todo_plan.v5') {
      for (const task of plan.tasks) {
        const taskKey = `${plan.project_id}\0${plan.plan_key}\0${task.task_id}`;
        const phaseKey = `phase\0${plan.project_id}\0${plan.plan_key}\0${task.phase_id}`;
        adjacency.get(taskKey).push(phaseKey);
      }
      for (const phase of plan.phases) {
        const to = `phase\0${plan.project_id}\0${plan.plan_key}\0${phase.phase_id}`;
        for (const predecessor of phase.predecessor_phase_ids) {
          adjacency.get(`phase\0${plan.project_id}\0${plan.plan_key}\0${predecessor}`).push(to);
        }
      }
      for (const edge of plan.phase_accept_dependencies) {
        adjacency.get(bindPhase(edge.from, plan)).push(bind(edge.to, plan));
      }
    }
  }
  const colors = new Map();
  const visit = (node) => {
    if (colors.get(node) === 1) fail('STORE_INCONSISTENT', 'merged_cycle');
    if (colors.get(node) === 2) return;
    colors.set(node, 1); for (const next of adjacency.get(node)) visit(next); colors.set(node, 2);
  };
  for (const node of adjacency.keys()) visit(node);
}

function mergedTaskKey(refValue) {
  return `${refValue.project_id}\0${refValue.plan_key}\0${refValue.task_id}`;
}

function mergedTaskStates(store) {
  return new Map(store.members.flatMap((member) => member.tasks.map((taskValue) => ([
    mergedTaskKey({
      project_id: member.plan.project_id, plan_key: member.plan.plan_key, task_id: taskValue.task_id,
    }),
    taskValue.status,
  ]))));
}

function mergedTaskPhase(store, taskKey) {
  for (const member of store.members) {
    const task = member.plan.tasks.find((entry) => mergedTaskKey({
      project_id: member.plan.project_id, plan_key: member.plan.plan_key, task_id: entry.task_id,
    }) === taskKey);
    if (task === undefined) continue;
    if (!['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(member.plan.schema)) return null;
    return { schema: member.plan.schema, plan_key: member.plan.plan_key, phase_id: task.phase_id,
      status: member.snapshot.phases.find(({ phase_id }) => phase_id === task.phase_id)?.status };
  }
  return undefined;
}

function mergedDependencyPhaseReady(store, predecessorKey, targetKey) {
  const predecessor = mergedTaskPhase(store, predecessorKey);
  const target = mergedTaskPhase(store, targetKey);
  if (predecessor === undefined) return false;
  if (predecessor === null) return true;
  if (predecessor.schema === 'lattice.todo_plan.v5') return true;
  if (target !== null && target !== undefined && predecessor.plan_key === target.plan_key
    && predecessor.phase_id === target.phase_id) return true;
  return predecessor.status === 'accepted';
}

function mergedPhaseAcceptReady(store, targetKey) {
  for (const member of store.members) {
    if (member.plan.schema !== 'lattice.todo_plan.v5') continue;
    for (const edge of member.plan.phase_accept_dependencies) {
      if (mergedTaskKey(edge.to) !== targetKey) continue;
      const source = store.members.find((candidate) => candidate.plan.project_id === edge.from.project_id
        && candidate.plan.plan_key === edge.from.plan_key);
      if (source?.snapshot.phases.find(({ phase_id }) => phase_id === edge.from.phase_id)?.status !== 'accepted') {
        return false;
      }
    }
  }
  return true;
}

function mergedPredecessorKeys(store, targetKey) {
  const result = [];
  for (const member of store.members) {
    for (const edge of member.plan.hard_dependencies) {
      if (mergedTaskKey(edge.to) === targetKey) result.push(mergedTaskKey(edge.from));
    }
    for (const join of member.plan.joins) {
      if (mergedTaskKey(join.before) === targetKey) {
        for (const after of join.after) result.push(mergedTaskKey(after));
      }
    }
  }
  return [...new Set(result)];
}

function mergedSuccessorKeys(store, targetKey) {
  const result = [];
  for (const member of store.members) {
    for (const edge of member.plan.hard_dependencies) {
      if (mergedTaskKey(edge.from) === targetKey) result.push(mergedTaskKey(edge.to));
    }
    for (const join of member.plan.joins) {
      if (join.after.some((after) => mergedTaskKey(after) === targetKey)) {
        result.push(mergedTaskKey(join.before));
      }
    }
  }
  return [...new Set(result)];
}

function validateMergedTransition(store, member, event) {
  const targetKey = mergedTaskKey({
    project_id: member.plan.project_id, plan_key: member.plan.plan_key, task_id: event.task_id,
  });
  const states = mergedTaskStates(store);
  const taskDependenciesDone = mergedPredecessorKeys(store, targetKey)
    .every((key) => states.get(key) === 'done' && mergedDependencyPhaseReady(store, key, targetKey));
  const phaseAcceptReady = mergedPhaseAcceptReady(store, targetKey);
  const dependenciesDone = taskDependenciesDone && phaseAcceptReady;
  if (event.kind === 'start' && event.payload.start_mode !== 'historical_import'
    && (!phaseAcceptReady || (!taskDependenciesDone && event.payload.override_reason === null))) {
    fail('STORE_INCONSISTENT', 'invalid_start_transition');
  }
  if (event.kind === 'done' && event.payload.done_mode === 'authored' && !dependenciesDone) {
    fail('STORE_INCONSISTENT', 'invalid_done_transition');
  }
  if (event.kind === 'reopen' && event.payload.override_reason === null) {
    const startedSuccessor = mergedSuccessorKeys(store, targetKey)
      .some((key) => states.get(key) !== 'pending');
    if (startedSuccessor) fail('STORE_INCONSISTENT', 'reopen_has_started_successor');
  }
  if (event.kind === 'phase_reopen' && event.payload.override_reason === null) {
    const startedSuccessor = member.plan.schema === 'lattice.todo_plan.v4'
      ? member.plan.tasks.filter(({ phase_id }) => phase_id === event.phase_id)
        .map(({ task_id }) => mergedTaskKey({ project_id: member.plan.project_id,
          plan_key: member.plan.plan_key, task_id }))
        .flatMap((key) => mergedSuccessorKeys(store, key))
        .some((key) => states.get(key) !== 'pending')
      : store.members.some((candidate) => candidate.plan.schema === 'lattice.todo_plan.v5'
        && candidate.plan.phase_accept_dependencies.some((edge) => (
          edge.from.project_id === member.plan.project_id
          && edge.from.plan_key === member.plan.plan_key && edge.from.phase_id === event.phase_id
          && states.get(mergedTaskKey(edge.to)) !== 'pending'
        )));
    if (startedSuccessor) fail('STORE_INCONSISTENT', 'phase_reopen_has_started_successor');
  }
}

function evidenceVerifier(manifest, repoRoot, hard) {
  const repositories = new Map(manifest.repositories.map((repo) => [repo.repo_id, repo.path]));
  return (descriptor) => {
    if (!validateEvidenceDescriptor(descriptor)) fail('STORE_INCONSISTENT', 'evidence_descriptor_invalid');
    const repoRef = repositories.get(descriptor.repo_id);
    if (repoRef === undefined) fail('STORE_INCONSISTENT', 'evidence_repo_missing');
    const absoluteRepo = path.resolve(repoRoot, repoRef);
    try {
      const type = execFileSync('git', ['cat-file', '-t', descriptor.git_blob_oid], { cwd: absoluteRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (type !== 'blob') throw new Error('not blob');
      const bytes = execFileSync('git', ['cat-file', 'blob', descriptor.git_blob_oid], { cwd: absoluteRepo, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: TODO_LIMITS.narrativeSectionBytes + 1 });
      if (sha256Bytes(bytes) !== descriptor.content_digest) throw new Error('digest mismatch');
      return true;
    } catch {
      if (hard) fail('STORE_INCONSISTENT', 'evidence_unverified');
      return false;
    }
  };
}

function pinnedSourceLine(repoRoot, source, cache = null) {
  if (cache === null || !cache.commits.has(source.source_commit)) {
    const commitType = execFileSync('git', ['cat-file', '-t', source.source_commit], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (commitType !== 'commit') throw new Error('not commit');
    cache?.commits.add(source.source_commit);
  }
  const objectSpec = `${source.source_commit}:${source.origin_plan_ref}`;
  let blob = cache?.blobs.get(objectSpec);
  if (blob === undefined) {
    const blobType = execFileSync('git', ['cat-file', '-t', objectSpec], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (blobType !== 'blob') throw new Error('not blob');
    blob = execFileSync('git', ['cat-file', 'blob', objectSpec], {
      cwd: repoRoot, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: TODO_LIMITS.narrativeSectionBytes + 1,
    });
    cache?.blobs.set(objectSpec, blob);
  }
  let start = 0;
  let line = 1;
  for (let index = 0; index < blob.length; index += 1) {
    if (blob[index] !== 0x0a) continue;
    if (line === source.origin_line) return blob.subarray(start, index);
    start = index + 1;
    line += 1;
  }
  if (start < blob.length && line === source.origin_line) return blob.subarray(start);
  throw new Error('line outside blob');
}

function markdownCheckboxState(lineBytes) {
  if (lineBytes.length >= 3 && lineBytes[0] === 0xef && lineBytes[1] === 0xbb && lineBytes[2] === 0xbf) return null;
  let line;
  try { line = new TextDecoder('utf-8', { fatal: true }).decode(lineBytes); } catch { return null; }
  const match = /^[\t ]*(?:[-+*]|\d+[A-Za-z]?\.|\d+\))[\t ]+\[([ xX])\](?:[\t ]+.*)?$/u.exec(line);
  if (match === null) return null;
  return match[1] === ' ' ? 'unchecked' : 'checked';
}

function liveReplacementPreservesListStructure(lineBytes, replacement) {
  let line;
  try { line = new TextDecoder('utf-8', { fatal: true }).decode(lineBytes); } catch { return false; }
  const source = /^([\t ]*)([-+*]|\d+[A-Za-z]?\.|\d+\))[\t ]+\[[ xX]\](?:[\t ]+.*)?\r?$/u.exec(line);
  const target = /^([\t ]*)([-+*]|\d+[A-Za-z]?\.|\d+\))[\t ]+.+$/u.exec(replacement);
  return source !== null && target !== null && source[1] === target[1] && source[2] === target[2];
}

function importSourceVerifier(repoRoot, hard, cache = null) {
  return (descriptor) => {
    if (!validateTodoImportSource(descriptor)) fail('STORE_INCONSISTENT', 'import_source_descriptor_invalid');
    try {
      pinnedSourceLine(repoRoot, descriptor, cache);
      return true;
    } catch {
      if (hard) fail('STORE_INCONSISTENT', 'import_source_unverified');
      return false;
    }
  };
}

function narrativeAnchorSource(value) {
  return exactRecord(value, [
    'task_id', 'origin_plan_ref', 'origin_line', 'source_commit', 'checkbox_state',
  ]) && isTodoIdentifier(value.task_id)
    && ['checked', 'unchecked', 'absent', 'ambiguous'].includes(value.checkbox_state)
    && validateTodoImportSource({
      schema: 'lattice.todo_import_source.v1', origin_plan_ref: value.origin_plan_ref,
      origin_line: value.origin_line, source_commit: value.source_commit,
    });
}

function materializeImportedNarrativeAnchors(repoRoot, planInput, sources) {
  if (sources === undefined) return planInput;
  if (planInput?.schema !== 'lattice.todo_plan.v2' || !Array.isArray(sources)
    || sources.length > TODO_LIMITS.tasksPerPlan || !sources.every(narrativeAnchorSource)) {
    throw new TypeError('imported narrative anchor sources are invalid');
  }
  const byTask = new Map(sources.map((source) => [source.task_id, source]));
  if (byTask.size !== sources.length
    || sources.some(({ task_id: taskId }) => !planInput.tasks.some((task) => task.task_id === taskId))) {
    throw new TypeError('imported narrative anchor sources do not match plan tasks');
  }
  return {
    ...planInput,
    tasks: planInput.tasks.map((task) => {
      const source = byTask.get(task.task_id);
      let narrativeAnchor = null;
      if (source !== undefined && task.narrative_ref === source.origin_plan_ref
        && ['checked', 'unchecked'].includes(source.checkbox_state)) {
        try {
          const line = pinnedSourceLine(repoRoot, source);
          if (markdownCheckboxState(line) === source.checkbox_state) {
            narrativeAnchor = {
              origin_plan_ref: source.origin_plan_ref,
              origin_line: source.origin_line,
              source_commit: source.source_commit,
              source_line_digest: sha256Bytes(line),
            };
          }
        } catch {
          narrativeAnchor = null;
        }
      }
      return { ...task, narrative_anchor: narrativeAnchor };
    }),
  };
}

function verifyPlanNarrativeAnchors(repoRoot, plan, trustedPlan = null) {
  if (!['lattice.todo_plan.v2', 'lattice.todo_plan.v3', 'lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema)) return;
  const trusted = new Map((['lattice.todo_plan.v2', 'lattice.todo_plan.v3', 'lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(trustedPlan?.schema)
    ? trustedPlan.tasks : [])
    .map((task) => [task.task_id, task.narrative_anchor]));
  for (const task of plan.tasks) {
    const anchor = task.narrative_anchor;
    if (anchor === null) continue;
    const previous = trusted.get(task.task_id);
    if (previous !== undefined
      && canonicalizeTodoArtifact(previous) === canonicalizeTodoArtifact(anchor)) continue;
    try {
      const line = pinnedSourceLine(repoRoot, anchor);
      if (sha256Bytes(line) !== anchor.source_line_digest || markdownCheckboxState(line) === null) {
        throw new Error('anchor mismatch');
      }
    } catch {
      fail('STORE_INCONSISTENT', 'narrative_anchor_unverified', {
        plan_key: plan.plan_key, task_id: task.task_id,
      });
    }
  }
}

export async function readTodoStore(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const barrier = await exactFileOrNull(path.resolve(repoRoot, SOURCE_CUTOVER_BARRIER_REF));
  if (barrier !== null) {
    let value;
    try { value = JSON.parse(decodeUtf8(barrier, 'SOURCE_CUTOVER_RECOVERY_REQUIRED', 'barrier_invalid')); }
    catch (error) {
      if (error instanceof TodoStoreError) throw error;
      fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'barrier_invalid');
    }
    const revisionRecovery = value?.schema === 'lattice.todo_source_cutover_barrier.v1'
      && value.revision_digest === options.allowSourceCutoverRevisionDigest;
    const revisionSetRecovery = value?.schema === 'lattice.todo_source_cutover_set_barrier.v1'
      && value.revision_set_digest === options.allowSourceCutoverRevisionSetDigest;
    if (options.sourceCutoverRecoveryCapability !== SOURCE_CUTOVER_RECOVERY_CAPABILITY
      || (!revisionRecovery && !revisionSetRecovery)) {
      fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_recovery_required');
    }
  }
  const pinnedSourceCache = { commits: new Set(), blobs: new Map() };
  const manifest = await readArtifact(repoRoot, MANIFEST_REF, {
    code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
  });
  const loaded = [];
  for (const descriptor of manifest.members) {
    const plan = await readArtifact(repoRoot, descriptor.plan_ref, {
      code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoPlan,
    });
    if (plan.project_id !== manifest.project_id || plan.plan_key !== descriptor.plan_key
      || plan.plan_version !== descriptor.active_plan_version || plan.topology_digest !== descriptor.topology_digest) {
      fail('STORE_INCONSISTENT', 'manifest_plan_binding_mismatch');
    }
    const journal = await readJournal(repoRoot, descriptor.journal_ref);
    if (journal.events.at(-1).event_digest !== descriptor.journal_head_digest) {
      fail('STORE_INCONSISTENT', 'manifest_journal_head_mismatch');
    }
    let revision = null;
    const genesis = journal.events[0];
    if (['lattice.todo_event.v2', 'lattice.todo_event.v4'].includes(genesis.schema)) {
      const revisionRef = path.posix.join(path.posix.dirname(descriptor.plan_ref), 'revision.json');
      revision = await readArtifact(repoRoot, revisionRef, {
        code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes,
        validate: genesis.schema === 'lattice.todo_event.v4' ? validatePhaseTodoRevision : validateTodoRevision,
      });
      const migrationProjection = genesis.state_migration.map((entry) => ({
        from_task_id: entry.from_task_id, to_task_id: entry.to_task_id,
        state_policy: entry.state_policy,
      }));
      if (canonicalizeTodoArtifact(revision.desired_plan) !== canonicalizeTodoArtifact(plan)
        || revision.revision_digest !== genesis.revision_digest
        || revision.predecessor.plan_digest !== genesis.payload.predecessor_plan_digest
        || revision.predecessor.journal_head_digest !== genesis.previous_digest
        || canonicalizeTodoArtifact(revision.task_migration)
          !== canonicalizeTodoArtifact(migrationProjection)) {
        fail('STORE_INCONSISTENT', 'revision_genesis_binding_mismatch');
      }
      if (genesis.schema === 'lattice.todo_event.v2'
        && revision.reconciliation.reconciliation_digest !== genesis.reconciliation_digest) {
        fail('STORE_INCONSISTENT', 'revision_genesis_binding_mismatch');
      }
      if (genesis.schema === 'lattice.todo_event.v4') {
        const phaseProjection = revision.phase_migration
          .filter(({ to_phase_id }) => to_phase_id !== 'removed')
          .map(({ to_phase_id, state_policy }) => ({ phase_id: to_phase_id, state_policy }))
          .sort((left, right) => left.phase_id.localeCompare(right.phase_id));
        const genesisProjection = genesis.phase_state_migration
          .map(({ phase_id, state_policy }) => ({ phase_id, state_policy }));
        if (canonicalizeTodoArtifact(phaseProjection) !== canonicalizeTodoArtifact(genesisProjection)) {
          fail('STORE_INCONSISTENT', 'revision_genesis_binding_mismatch');
        }
      }
    }
    const verifyEvidence = evidenceVerifier(manifest, repoRoot, options.forWrite === true);
    const verifyImportSource = importSourceVerifier(repoRoot, options.forWrite === true, pinnedSourceCache);
    const tasks = replay(plan, journal.events, {
      now: options.now ? new Date(options.now) : new Date(),
      verifyEvidence: options.forWrite === true ? verifyEvidence : undefined,
      verifyImportSource: options.forWrite === true ? verifyImportSource : undefined,
    });
    const expectedSnapshot = snapshotFor(plan, journal.events, structuredClone(tasks));
    // Read-time evidence failure is annotation, never store rejection.
    for (const task of tasks) if (task.evidence !== null) {
      const verified = validateTodoImportSource(task.evidence)
        ? verifyImportSource(task.evidence) : verifyEvidence(task.evidence);
      if (!verified) task.evidence_unverified = true;
    }
    let snapshot = null;
    let snapshotStale = false;
    try {
      snapshot = await readSnapshotArtifact(repoRoot, descriptor.snapshot_ref);
      snapshotStale = snapshot === null || canonicalizeTodoArtifact(snapshot) !== canonicalizeTodoArtifact(expectedSnapshot);
    } catch (error) {
      if (error instanceof TodoStoreError && error.code === 'SNAPSHOT_INVALID'
        && !['unsafe_artifact_path', 'path_alias_or_escape', 'path_outside_store'].includes(error.detail.reason)) snapshotStale = true;
      else throw error;
    }
    if (options.forWrite === true && snapshotStale) fail('STORE_WRITE_REFUSED', 'snapshot_stale');
    loaded.push({ descriptor, plan, revision, journal, snapshot: snapshotStale ? expectedSnapshot : snapshot,
      tasks, snapshot_stale: snapshotStale });
  }
  validateMergedGraph(loaded);
  return {
    schema: 'lattice.todo_store_read.v1', project_id: manifest.project_id, manifest,
    members: loaded, snapshot_stale: loaded.some((member) => member.snapshot_stale),
  };
}

export async function readTodoStoreStable(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const maximumAttempts = options.maximumAttempts ?? 4;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 16) {
    throw new TypeError('maximumAttempts must be 1..16');
  }
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const before = await readArtifact(repoRoot, MANIFEST_REF, {
      code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
    });
    try {
      const store = await readTodoStore(options);
      const after = await readArtifact(repoRoot, MANIFEST_REF, {
        code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
      });
      if (before.manifest_digest === after.manifest_digest
        && store.manifest.manifest_digest === after.manifest_digest) return store;
    } catch (error) {
      if (!(error instanceof TodoStoreError)) throw error;
      const after = await readArtifact(repoRoot, MANIFEST_REF, {
        code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
      });
      const transientWriteWindow = error.code === 'STORE_INCONSISTENT'
        && ['manifest_journal_head_mismatch', 'manifest_plan_binding_mismatch']
          .includes(error.detail.reason);
      if (before.manifest_digest === after.manifest_digest && !transientWriteWindow) throw error;
    }
    if (attempt < maximumAttempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(16, 2 ** attempt)));
    }
  }
  fail('STORE_BUSY', 'stable_read_exhausted', { attempts: maximumAttempts });
}

async function atomicWrite(absolute, bytes) {
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, absolute);
    const directory = await open(path.dirname(absolute), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

async function atomicWriteMode(absolute, bytes, mode) {
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = path.join(path.dirname(absolute),
    `.${path.basename(absolute)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(bytes); await handle.chmod(mode);
    await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, absolute);
    await fsyncDirectory(path.dirname(absolute));
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

async function fsyncDirectory(absolute) {
  const directory = await open(absolute, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function withLock(repoRoot, callback) {
  const root = path.join(repoRoot, STORE_ROOT_REF);
  await mkdir(root, { recursive: true });
  const lockRef = path.join(root, '.write.lock');
  let handle;
  try { handle = await open(lockRef, 'wx', 0o600); }
  catch (error) { if (error?.code === 'EEXIST') fail('STORE_WRITE_CONFLICT', 'store_locked'); throw error; }
  try { return await callback(); }
  finally { await handle.close(); await rm(lockRef, { force: true }); }
}

export async function rebuildTodoSnapshot(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  return withLock(repoRoot, async () => {
    const store = await readTodoStore({ repoRoot, now: options.now });
    const member = store.members.find(({ descriptor }) => descriptor.plan_key === options.planKey);
    if (!member) fail('STORE_INCONSISTENT', 'plan_not_active');
    await atomicWrite(path.resolve(repoRoot, member.descriptor.snapshot_ref), canonicalLine(member.snapshot));
    return member.snapshot;
  });
}

function nextEvent(input, storeMember) {
  const previous = storeMember.journal.events.at(-1);
  const payload = input.kind === 'done' && exactRecord(input.payload, ['evidence'])
    ? { done_mode: 'authored', imported: false, evidence: input.payload.evidence }
    : input.payload;
  const event = {
    schema: ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(storeMember.plan.schema)
      ? 'lattice.todo_event.v3' : 'lattice.todo_event.v1', project_id: storeMember.plan.project_id,
    plan_key: storeMember.plan.plan_key, plan_version: storeMember.plan.plan_version,
    sequence: previous.sequence + 1, previous_digest: previous.event_digest,
    kind: input.kind, task_id: input.task_id ?? null,
    ...(['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(storeMember.plan.schema)
      ? { phase_id: input.phase_id ?? null } : {}),
    actor: input.actor, recorded_at: input.recorded_at,
    provenance: input.provenance ?? null, payload, event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  if (!validateTodoEvent(event)) throw new TypeError('todo event input violates its declared schema');
  return event;
}

function resolveTargetedEvent(input, storeMember) {
  if (input.kind === 'reopen' && exactRecord(input.payload, [
    'reason', 'override_reason',
  ])) {
    const target = [...storeMember.journal.events].reverse().find((event) => (
      event.kind === 'done' && event.task_id === input.task_id
    ));
    if (target === undefined) fail('STORE_INCONSISTENT', 'invalid_reopen_binding');
    return {
      ...input,
      payload: { ...input.payload, target_done_digest: target.event_digest },
    };
  }
  if (input.kind === 'done' && exactRecord(input.payload, [
    'done_mode', 'imported', 'evidence',
  ]) && input.payload.done_mode === 'evidence_promotion' && input.payload.imported === true) {
    const target = [...storeMember.journal.events].reverse().find((event) => (
      event.kind === 'done' && event.task_id === input.task_id
    ));
    if (target === undefined) fail('STORE_INCONSISTENT', 'invalid_evidence_promotion');
    return {
      ...input,
      payload: { ...input.payload, target_done_digest: target.event_digest },
    };
  }
  if (input.kind === 'phase_reopen' && exactRecord(input.payload, ['reason', 'override_reason'])) {
    const target = [...storeMember.journal.events].reverse().find((event) => (
      ['phase_accept', 'phase_reject'].includes(event.kind) && event.phase_id === input.phase_id
    ));
    if (target === undefined) fail('STORE_INCONSISTENT', 'phase_reopen_binding_invalid');
    return { ...input, payload: { ...input.payload, target_decision_digest: target.event_digest } };
  }
  return input;
}

export async function appendTodoEvent(options = {}) {
  requireWriter(options.writer, 'g5-authoring');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  return withLock(repoRoot, async () => {
    const store = await readTodoStore({ repoRoot, forWrite: true, now: options.now });
    const member = store.members.find(({ descriptor }) => descriptor.plan_key === options.planKey);
    if (!member) fail('STORE_INCONSISTENT', 'plan_not_active');
    const input = resolveTargetedEvent({
      ...options.event,
      recorded_at: options.event.recorded_at ?? new Date().toISOString(),
    }, member);
    const event = nextEvent(input, member);
    if ((event.kind === 'start' && event.payload.start_mode === 'historical_import')
      || (event.kind === 'done' && event.payload.done_mode === 'historical_import')) {
      fail('STORE_WRITE_CONFLICT', 'historical_import_writer_required');
    }
    // Validate the prospective history, including hard evidence and transitions, before any write.
    validateMergedTransition(store, member, event);
    replay(member.plan, [...member.journal.events, event], {
      now: options.now ? new Date(options.now) : new Date(),
      verifyEvidence: evidenceVerifier(store.manifest, repoRoot, true),
      verifyImportSource: importSourceVerifier(repoRoot, true),
    });
    const eventBytes = canonicalLine(event);
    const activeRef = member.descriptor.journal_ref;
    const activeAbsolute = path.resolve(repoRoot, activeRef);
    if (member.journal.activeBytes.length + eventBytes.length > TODO_LIMITS.journalSegmentBytes) {
      const activeEvents = member.journal.segments.at(-1).events;
      const previousSegmentDigest = member.journal.segments.length > 1
        ? member.journal.segments.at(-2).events.at(-1).event_digest : '0'.repeat(64);
      const segmentDigest = sha256Bytes(member.journal.activeBytes);
      const name = `${String(activeEvents[0].sequence).padStart(12, '0')}-${String(activeEvents.at(-1).sequence).padStart(12, '0')}-${previousSegmentDigest}-${segmentDigest}.jsonl`;
      await atomicWrite(path.join(path.dirname(activeAbsolute), 'sealed', name), member.journal.activeBytes);
      await atomicWrite(activeAbsolute, eventBytes);
    } else {
      await atomicWrite(activeAbsolute, Buffer.concat([member.journal.activeBytes, eventBytes]));
    }
    const tasks = replay(member.plan, [...member.journal.events, event], {
      now: options.now ? new Date(options.now) : new Date(),
      verifyEvidence: evidenceVerifier(store.manifest, repoRoot, false),
      verifyImportSource: importSourceVerifier(repoRoot, false),
    });
    const snapshot = snapshotFor(member.plan, [...member.journal.events, event], tasks);
    await atomicWrite(path.resolve(repoRoot, member.descriptor.snapshot_ref), canonicalLine(snapshot));
    member.descriptor.journal_head_digest = event.event_digest;
    store.manifest.manifest_digest = todoSelfDigest(store.manifest, 'manifest_digest');
    await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(store.manifest));
    return { event, snapshot };
  });
}

export function buildTodoPlan(input) {
  const plan = { ...input, topology_digest: '', plan_digest: '' };
  plan.topology_digest = digestTodoArtifact({
    project_id: plan.project_id, plan_key: plan.plan_key, plan_version: plan.plan_version,
    tasks: plan.tasks, hard_dependencies: plan.hard_dependencies, joins: plan.joins,
    ...(['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema) ? { phases: plan.phases } : {}),
    ...(plan.schema === 'lattice.todo_plan.v5'
      ? { phase_accept_dependencies: plan.phase_accept_dependencies } : {}),
  });
  plan.plan_digest = todoSelfDigest(plan, 'plan_digest');
  if (!validateTodoPlan(plan)) throw new TypeError('todo plan input violates its declared schema');
  return plan;
}

export function buildPlanGenesis(plan, input) {
  const event = {
    schema: ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema)
      ? 'lattice.todo_event.v3' : 'lattice.todo_event.v1',
    project_id: plan.project_id, plan_key: plan.plan_key,
    plan_version: plan.plan_version, sequence: 0, previous_digest: input.previous_digest ?? null,
    kind: 'plan_genesis', task_id: null,
    ...(['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(plan.schema) ? { phase_id: null } : {}),
    actor: input.actor, recorded_at: input.recorded_at,
    provenance: input.provenance ?? null,
    payload: { plan_digest: plan.plan_digest, topology_digest: plan.topology_digest,
      predecessor_plan_digest: plan.predecessor_plan_digest, task_migration: input.task_migration ?? [],
      ...(input.historical_import === true ? { historical_import: true } : {}) },
    event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  if (!validateTodoEvent(event)) throw new TypeError('genesis input violates its declared schema');
  return event;
}

export function buildRevisionGenesis(plan, input) {
  const event = {
    schema: 'lattice.todo_event.v2', project_id: plan.project_id, plan_key: plan.plan_key,
    plan_version: plan.plan_version, sequence: 0, previous_digest: input.previous_digest,
    kind: 'plan_genesis', task_id: null, actor: input.actor, recorded_at: input.recorded_at,
    provenance: input.provenance ?? null,
    payload: { plan_digest: plan.plan_digest, topology_digest: plan.topology_digest,
      predecessor_plan_digest: plan.predecessor_plan_digest,
      task_migration: input.state_migration.map(({ from_task_id, to_task_id }) => ({
        from_task_id, to_task_id,
      })) },
    reconciliation_state: 'reconciled', revision_digest: input.revision_digest,
    reconciliation_digest: input.reconciliation_digest,
    state_migration: input.state_migration, event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  if (!validateTodoEvent(event)) throw new TypeError('revision genesis violates lattice.todo_event.v2');
  return event;
}

export function buildPhaseRevisionGenesis(plan, input) {
  const event = {
    schema: 'lattice.todo_event.v4', project_id: plan.project_id, plan_key: plan.plan_key,
    plan_version: plan.plan_version, sequence: 0, previous_digest: input.previous_digest,
    kind: 'plan_genesis', task_id: null, phase_id: null, actor: input.actor,
    recorded_at: input.recorded_at, provenance: input.provenance ?? null,
    payload: { plan_digest: plan.plan_digest, topology_digest: plan.topology_digest,
      predecessor_plan_digest: plan.predecessor_plan_digest,
      task_migration: input.state_migration.map(({ from_task_id, to_task_id }) => ({
        from_task_id, to_task_id,
      })) },
    revision_digest: input.revision_digest, state_migration: input.state_migration,
    phase_state_migration: input.phase_state_migration, event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  if (!validateTodoEvent(event)) throw new TypeError('phase revision genesis violates lattice.todo_event.v4');
  return event;
}

function buildHistoricalDone(plan, previous, input, genesis) {
  const event = {
    schema: 'lattice.todo_event.v1', project_id: plan.project_id, plan_key: plan.plan_key,
    plan_version: plan.plan_version, sequence: previous.sequence + 1, previous_digest: previous.event_digest,
    kind: 'done', task_id: input.task_id, actor: input.actor ?? genesis.actor,
    recorded_at: input.recorded_at ?? genesis.recorded_at, provenance: input.provenance ?? null,
    payload: { done_mode: 'historical_import', imported: true, status: 'done',
      completed_at: input.completed_at, evidence: input.evidence }, event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  if (!validateTodoEvent(event)) throw new TypeError('historical done input violates lattice.todo_event.v1');
  return event;
}

function buildHistoricalStart(plan, previous, input, genesis) {
  const event = {
    schema: 'lattice.todo_event.v1', project_id: plan.project_id, plan_key: plan.plan_key,
    plan_version: plan.plan_version, sequence: previous.sequence + 1, previous_digest: previous.event_digest,
    kind: 'start', task_id: input.task_id, actor: input.actor ?? genesis.actor,
    recorded_at: input.recorded_at ?? genesis.recorded_at, provenance: input.provenance ?? null,
    payload: { start_mode: 'historical_import', imported: true, status: 'in-progress',
      started_at: input.started_at, evidence: input.evidence }, event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  if (!validateTodoEvent(event)) throw new TypeError('historical start input violates lattice.todo_event.v1');
  return event;
}

function historicalImportInputs(value, timestampKey) {
  const required = ['task_id', timestampKey, 'evidence'];
  const allowed = new Set([...required, 'actor', 'recorded_at', 'provenance']);
  return Array.isArray(value) && value.length <= TODO_LIMITS.tasksPerPlan
    && value.every((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      && Object.getPrototypeOf(entry) === Object.prototype
      && required.every((key) => Object.hasOwn(entry, key))
      && Object.keys(entry).every((key) => allowed.has(key)));
}

function prepareImportedArtifacts(repoRoot, options, projectId, memberPlans) {
  const planInput = materializeImportedNarrativeAnchors(
    repoRoot, options.plan, options.narrativeAnchorSources,
  );
  const plan = buildTodoPlan(planInput);
  if (plan.project_id !== projectId || plan.predecessor_plan_digest !== null) {
    throw new TypeError('imported plan must be a project-local genesis plan');
  }
  verifyPlanNarrativeAnchors(repoRoot, plan);
  const genesis = buildPlanGenesis(plan, { ...options.genesis, historical_import: true });
  const events = [genesis];
  const inProgressTasks = options.inProgressTasks ?? [];
  const completedTasks = options.completedTasks ?? [];
  if (!historicalImportInputs(inProgressTasks, 'started_at')
    || !historicalImportInputs(completedTasks, 'completed_at')) {
    fail('STORE_INCONSISTENT', 'historical_import_disposition_invalid');
  }
  const inProgressIds = new Set(inProgressTasks.map(({ task_id: taskId }) => taskId));
  const completedIds = new Set(completedTasks.map(({ task_id: taskId }) => taskId));
  if (inProgressIds.size !== inProgressTasks.length
    || completedIds.size !== completedTasks.length
    || [...inProgressIds].some((taskId) => completedIds.has(taskId))) {
    fail('STORE_INCONSISTENT', 'historical_import_disposition_conflict');
  }
  for (const input of inProgressTasks) events.push(buildHistoricalStart(plan, events.at(-1), input, genesis));
  for (const input of completedTasks) events.push(buildHistoricalDone(plan, events.at(-1), input, genesis));
  const verifyImportSource = importSourceVerifier(repoRoot, true);
  const tasks = replay(plan, events, {
    now: options.now ? new Date(options.now) : new Date(), verifyImportSource,
  });
  validateMergedGraph([...memberPlans, { plan }]);
  return { plan, genesis, events, tasks, snapshot: snapshotFor(plan, events, tasks) };
}

async function bootstrapImportedPlan(repoRoot, options) {
  const initialization = options.initializeIfMissing;
  if (!exactRecord(initialization, ['projectId', 'repositories'])
    || initialization.projectId !== options.plan?.project_id) {
    throw new TypeError('historical import initialization input invalid');
  }
  const prepared = prepareImportedArtifacts(repoRoot, options, initialization.projectId, []);
  const { plan, genesis, events, snapshot } = prepared;
  const base = `${STORE_ROOT_REF}/plans/${plan.plan_key}/${plan.plan_version}`;
  const planRef = `${base}/plan.json`;
  const journalRef = `${base}/journal/active.jsonl`;
  const snapshotRef = `${base}/snapshot.json`;
  const descriptor = { plan_key: plan.plan_key, active_plan_version: plan.plan_version,
    plan_ref: planRef, journal_ref: journalRef, snapshot_ref: snapshotRef,
    topology_digest: plan.topology_digest, journal_head_digest: events.at(-1).event_digest };
  const manifest = { schema: 'lattice.todo_manifest.v1', project_id: initialization.projectId,
    repositories: initialization.repositories, members: [descriptor], manifest_digest: '' };
  manifest.manifest_digest = todoSelfDigest(manifest, 'manifest_digest');
  if (!validateTodoManifest(manifest)) throw new TypeError('manifest input violates lattice.todo_manifest.v1');

  const stage = path.join(repoRoot, `.lattice-todo-bootstrap-${process.pid}-${randomBytes(6).toString('hex')}`);
  const latticeRoot = path.join(repoRoot, '.lattice');
  const storeRoot = path.join(repoRoot, STORE_ROOT_REF);
  let createdLatticeRoot = false;
  let activated = false;
  try {
    await mkdir(stage, { mode: 0o700 });
    const stagedBase = path.join(stage, 'plans', plan.plan_key, plan.plan_version);
    await atomicWrite(path.join(stagedBase, 'plan.json'), canonicalLine(plan));
    await atomicWrite(path.join(stagedBase, 'journal', 'active.jsonl'), Buffer.concat(events.map(canonicalLine)));
    await atomicWrite(path.join(stagedBase, 'snapshot.json'), canonicalLine(snapshot));
    await atomicWrite(path.join(stage, 'manifest.json'), canonicalLine(manifest));
    await protocolStage(options, 'bootstrap_staged');

    try {
      const state = await lstat(latticeRoot);
      if (state.isSymbolicLink() || !state.isDirectory()) fail('STORE_INCONSISTENT', 'unsafe_lattice_root');
    } catch (error) {
      if (error instanceof TodoStoreError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(latticeRoot, { mode: 0o700 });
      createdLatticeRoot = true;
      await fsyncDirectory(repoRoot);
    }
    await protocolStage(options, 'bootstrap_parent_prepared');
    try { await rename(stage, storeRoot); }
    catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
        fail('STORE_WRITE_CONFLICT', 'store_bootstrap_raced');
      }
      throw error;
    }
    activated = true;
    await fsyncDirectory(latticeRoot);
    await protocolStage(options, 'bootstrap_activated');
    return { plan, genesis, events, snapshot, descriptor };
  } finally {
    if (!activated) await rm(stage, { recursive: true, force: true });
    if (!activated && createdLatticeRoot) {
      try { await rmdir(latticeRoot); }
      catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error; }
    }
  }
}

async function protocolStage(options, stage) {
  if (typeof options.onProtocolStage === 'function') await options.onProtocolStage(stage);
}

/** G4-only atomic import, with optional all-or-nothing store bootstrap. */
export async function appendImportedPlan(options = {}) {
  requireWriter(options.writer, 'g4-migration');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  if (options.initializeIfMissing !== undefined) {
    try { await lstat(path.join(repoRoot, STORE_ROOT_REF)); }
    catch (error) {
      if (error?.code === 'ENOENT') return bootstrapImportedPlan(repoRoot, options);
      throw error;
    }
  }
  return withLock(repoRoot, async () => {
    // 1. Validate canonical manifest bytes and every current member before preparing output.
    const store = await readTodoStore({ repoRoot, forWrite: true, now: options.now });
    const expectedManifestDigest = store.manifest.manifest_digest;
    await protocolStage(options, 'manifest_validated');

    // 2. A plan key is never overwritten, merged, or treated as an idempotent success.
    const existing = store.members.find(({ descriptor }) => descriptor.plan_key === options.plan?.plan_key);
    if (existing) {
      const imported = existing.journal.events[0]?.payload.historical_import === true;
      fail('STORE_WRITE_CONFLICT', imported ? 'plan_key_already_imported' : 'plan_key_already_exists');
    }
    await protocolStage(options, 'plan_key_absent');

    const { plan, genesis, events, snapshot } = prepareImportedArtifacts(
      repoRoot, options, store.project_id, store.members.map(({ plan: memberPlan }) => ({ plan: memberPlan })),
    );

    const base = `${STORE_ROOT_REF}/plans/${plan.plan_key}/${plan.plan_version}`;
    const planRef = `${base}/plan.json`;
    const journalRef = `${base}/journal/active.jsonl`;
    const snapshotRef = `${base}/snapshot.json`;
    const transactionRef = `${STORE_ROOT_REF}/transactions/${plan.plan_key}-${plan.plan_version}`;
    const transactionAbsolute = path.resolve(repoRoot, transactionRef);
    const finalBaseAbsolute = path.resolve(repoRoot, base);
    // These paths can only be leftovers from a transaction whose plan key is still absent.
    await rm(transactionAbsolute, { recursive: true, force: true });
    await rm(finalBaseAbsolute, { recursive: true, force: true });

    // 3. All future member artifacts are durable while still outside manifest membership.
    const stagedPlan = path.join(transactionAbsolute, 'plan.json');
    const stagedJournal = path.join(transactionAbsolute, 'active.jsonl');
    const stagedSnapshot = path.join(transactionAbsolute, 'snapshot.json');
    await atomicWrite(stagedPlan, canonicalLine(plan));
    await atomicWrite(stagedJournal, Buffer.concat(events.map(canonicalLine)));
    await atomicWrite(stagedSnapshot, canonicalLine(snapshot));
    await protocolStage(options, 'staging_fsynced');

    // 4. Re-read canonical manifest bytes under the lock and compare the captured digest.
    const currentManifest = await readArtifact(repoRoot, MANIFEST_REF, {
      code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
    });
    if (currentManifest.manifest_digest !== expectedManifestDigest) {
      fail('STORE_WRITE_CONFLICT', 'manifest_digest_changed');
    }
    await protocolStage(options, 'manifest_cas_matched');

    // 5. Pre-activation paths remain invisible until the final manifest rename.
    await mkdir(path.dirname(path.resolve(repoRoot, planRef)), { recursive: true });
    await mkdir(path.dirname(path.resolve(repoRoot, journalRef)), { recursive: true });
    await rename(stagedPlan, path.resolve(repoRoot, planRef));
    await rename(stagedJournal, path.resolve(repoRoot, journalRef));
    await rename(stagedSnapshot, path.resolve(repoRoot, snapshotRef));
    await fsyncDirectory(path.dirname(path.resolve(repoRoot, planRef)));
    await fsyncDirectory(path.dirname(path.resolve(repoRoot, journalRef)));
    await protocolStage(options, 'pre_activation_renamed');

    const descriptor = { plan_key: plan.plan_key, active_plan_version: plan.plan_version,
      plan_ref: planRef, journal_ref: journalRef, snapshot_ref: snapshotRef,
      topology_digest: plan.topology_digest, journal_head_digest: events.at(-1).event_digest };
    currentManifest.members.push(descriptor);
    currentManifest.members.sort((left, right) => left.plan_key < right.plan_key ? -1 : left.plan_key > right.plan_key ? 1 : 0);
    currentManifest.manifest_digest = todoSelfDigest(currentManifest, 'manifest_digest');
    if (!validateTodoManifest(currentManifest)) throw new TypeError('import activation manifest invalid');
    await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(currentManifest));
    await protocolStage(options, 'manifest_activated');
    await rm(transactionAbsolute, { recursive: true, force: true });
    return { plan, genesis, events, snapshot, descriptor };
  });
}

export async function initializeTodoStore(options = {}) {
  requireWriter(options.writer, 'g4-migration');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  if (!Array.isArray(options.plans) || options.plans.length === 0) throw new TypeError('plans required');
  return withLock(repoRoot, async () => {
    try { await lstat(path.resolve(repoRoot, MANIFEST_REF)); fail('STORE_WRITE_CONFLICT', 'store_already_exists'); }
    catch (error) { if (error instanceof TodoStoreError) throw error; if (error?.code !== 'ENOENT') throw error; }
    const members = [];
    for (const entry of options.plans) {
      const plan = buildTodoPlan(entry.plan);
      verifyPlanNarrativeAnchors(repoRoot, plan);
      const genesis = buildPlanGenesis(plan, entry.genesis);
      const base = `${STORE_ROOT_REF}/plans/${plan.plan_key}/${plan.plan_version}`;
      const planRef = `${base}/plan.json`; const journalRef = `${base}/journal/active.jsonl`; const snapshotRef = `${base}/snapshot.json`;
      await atomicWrite(path.resolve(repoRoot, planRef), canonicalLine(plan));
      await atomicWrite(path.resolve(repoRoot, journalRef), canonicalLine(genesis));
      const snapshot = snapshotFor(plan, [genesis], replay(plan, [genesis], { now: options.now ? new Date(options.now) : new Date() }));
      await atomicWrite(path.resolve(repoRoot, snapshotRef), canonicalLine(snapshot));
      members.push({ plan_key: plan.plan_key, active_plan_version: plan.plan_version, plan_ref: planRef,
        journal_ref: journalRef, snapshot_ref: snapshotRef, topology_digest: plan.topology_digest,
        journal_head_digest: genesis.event_digest });
    }
    members.sort((left, right) => left.plan_key < right.plan_key ? -1 : left.plan_key > right.plan_key ? 1 : 0);
    const manifest = { schema: 'lattice.todo_manifest.v1', project_id: options.projectId,
      repositories: options.repositories, members, manifest_digest: '' };
    manifest.manifest_digest = todoSelfDigest(manifest, 'manifest_digest');
    if (!validateTodoManifest(manifest)) throw new TypeError('manifest input violates lattice.todo_manifest.v1');
    // Activation is last: a crash before this point leaves the new store/version unpublished.
    await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(manifest));
    return readTodoStore({ repoRoot, now: options.now });
  });
}

/** G5-only initial authoring transaction. Store membership appears by one final directory rename. */
export async function initializeAuthoredTodoStore(options = {}) {
  requireWriter(options.writer, 'g5-authoring');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const optionKeys = [
    'repoRoot', 'writer', 'projectId', 'repositories', 'plan', 'genesis',
  ];
  if (!(exactRecord(options, optionKeys)
    || (exactRecord(options, [...optionKeys, 'onProtocolStage'])
      && typeof options.onProtocolStage === 'function'))
    || options.projectId !== options.plan?.project_id
    || options.plan?.predecessor_plan_digest !== null) {
    throw new TypeError('authored store initialization input invalid');
  }
  const plan = buildTodoPlan(options.plan);
  verifyPlanNarrativeAnchors(repoRoot, plan);
  const genesis = buildPlanGenesis(plan, options.genesis);
  const tasks = replay(plan, [genesis]);
  validateMergedGraph([{ plan }]);
  const snapshot = snapshotFor(plan, [genesis], tasks);
  const base = `plans/${plan.plan_key}/${plan.plan_version}`;
  const planRef = `${STORE_ROOT_REF}/${base}/plan.json`;
  const journalRef = `${STORE_ROOT_REF}/${base}/journal/active.jsonl`;
  const snapshotRef = `${STORE_ROOT_REF}/${base}/snapshot.json`;
  const descriptor = {
    plan_key: plan.plan_key, active_plan_version: plan.plan_version,
    plan_ref: planRef, journal_ref: journalRef, snapshot_ref: snapshotRef,
    topology_digest: plan.topology_digest, journal_head_digest: genesis.event_digest,
  };
  const manifest = {
    schema: 'lattice.todo_manifest.v1', project_id: options.projectId,
    repositories: options.repositories, members: [descriptor], manifest_digest: '',
  };
  manifest.manifest_digest = todoSelfDigest(manifest, 'manifest_digest');
  if (!validateTodoManifest(manifest)) throw new TypeError('manifest input violates lattice.todo_manifest.v1');

  const stage = path.join(repoRoot, `.lattice-todo-authoring-${process.pid}-${randomBytes(6).toString('hex')}`);
  const latticeRoot = path.join(repoRoot, '.lattice');
  const storeRoot = path.join(repoRoot, STORE_ROOT_REF);
  let createdLatticeRoot = false;
  let renamed = false;
  let activated = false;
  let stageIdentity = null;
  let latticeIdentity = null;
  const sameIdentity = (left, right) => left !== null && right !== null
    && left.dev === right.dev && left.ino === right.ino;
  try {
    try { await lstat(storeRoot); fail('STORE_WRITE_CONFLICT', 'store_already_exists'); }
    catch (error) {
      if (error instanceof TodoStoreError) throw error;
      if (error?.code === 'ENOTDIR') fail('STORE_INCONSISTENT', 'unsafe_lattice_root');
      if (error?.code !== 'ENOENT') throw error;
    }
    await mkdir(stage, { mode: 0o700 });
    stageIdentity = await lstat(stage);
    await atomicWrite(path.join(stage, base, 'plan.json'), canonicalLine(plan));
    await atomicWrite(path.join(stage, base, 'journal', 'active.jsonl'), canonicalLine(genesis));
    await atomicWrite(path.join(stage, base, 'snapshot.json'), canonicalLine(snapshot));
    await atomicWrite(path.join(stage, 'manifest.json'), canonicalLine(manifest));

    try {
      const state = await lstat(latticeRoot);
      if (state.isSymbolicLink() || !state.isDirectory()) fail('STORE_INCONSISTENT', 'unsafe_lattice_root');
    } catch (error) {
      if (error instanceof TodoStoreError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(latticeRoot, { mode: 0o700 });
      createdLatticeRoot = true;
      await fsyncDirectory(repoRoot);
    }
    latticeIdentity = await lstat(latticeRoot);
    const stagedBeforeRename = await lstat(stage);
    const parentBeforeRename = await lstat(latticeRoot);
    if (!sameIdentity(stageIdentity, stagedBeforeRename)
      || !sameIdentity(latticeIdentity, parentBeforeRename)
      || stagedBeforeRename.isSymbolicLink() || !stagedBeforeRename.isDirectory()
      || parentBeforeRename.isSymbolicLink() || !parentBeforeRename.isDirectory()) {
      fail('STORE_WRITE_CONFLICT', 'authoring_activation_path_changed');
    }
    try { await rename(stage, storeRoot); }
    catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) fail('STORE_WRITE_CONFLICT', 'store_bootstrap_raced');
      throw error;
    }
    renamed = true;
    await fsyncDirectory(latticeRoot);
    if (typeof options.onProtocolStage === 'function') await options.onProtocolStage('authoring_renamed');
    const activatedStore = await lstat(storeRoot);
    const activatedParent = await lstat(latticeRoot);
    if (!sameIdentity(stageIdentity, activatedStore)
      || !sameIdentity(latticeIdentity, activatedParent)
      || activatedStore.isSymbolicLink() || !activatedStore.isDirectory()
      || activatedParent.isSymbolicLink() || !activatedParent.isDirectory()) {
      fail('STORE_WRITE_CONFLICT', 'authoring_activation_path_changed');
    }
    const store = await readTodoStore({ repoRoot });
    const member = store.members[0];
    if (store.project_id !== options.projectId || store.members.length !== 1
      || store.snapshot_stale !== false || member?.journal?.events?.length !== 1
      || canonicalizeTodoArtifact(store.manifest) !== canonicalizeTodoArtifact(manifest)
      || canonicalizeTodoArtifact(member?.descriptor) !== canonicalizeTodoArtifact(descriptor)
      || canonicalizeTodoArtifact(member?.plan) !== canonicalizeTodoArtifact(plan)
      || canonicalizeTodoArtifact(member?.journal?.events?.[0]) !== canonicalizeTodoArtifact(genesis)
      || canonicalizeTodoArtifact(member?.snapshot) !== canonicalizeTodoArtifact(snapshot)) {
      fail('STORE_WRITE_CONFLICT', 'authoring_activation_verification_failed');
    }
    activated = true;
    return store;
  } finally {
    if (renamed && !activated) {
      try {
        const currentParent = await lstat(latticeRoot);
        const currentStore = await lstat(storeRoot);
        if (sameIdentity(latticeIdentity, currentParent) && sameIdentity(stageIdentity, currentStore)
          && !currentParent.isSymbolicLink() && currentParent.isDirectory()
          && !currentStore.isSymbolicLink() && currentStore.isDirectory()) {
          await rm(storeRoot, { recursive: true, force: true });
          await fsyncDirectory(latticeRoot);
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error;
      }
    }
    if (!activated) await rm(stage, { recursive: true, force: true });
    if (!activated && createdLatticeRoot) {
      try { await rmdir(latticeRoot); }
      catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error; }
    }
  }
}

async function sourceItemBytes(repoRoot, sourceRef) {
  const parsed = parseTodoSourceRef(sourceRef);
  if (parsed === null) fail('RECONCILIATION_INCOMPLETE', 'source_ref_invalid', { source_ref: sourceRef });
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, parsed.path);
  if (!absolute.startsWith(`${canonicalRoot}${path.sep}`)) {
    fail('RECONCILIATION_INCOMPLETE', 'source_path_outside_repo', { source_ref: sourceRef });
  }
  let current = canonicalRoot;
  for (const part of path.relative(canonicalRoot, absolute).split(path.sep)) {
    current = path.join(current, part);
    let state;
    try { state = await lstat(current); }
    catch { fail('RECONCILIATION_INCOMPLETE', 'source_path_missing', { source_ref: sourceRef }); }
    if (state.isSymbolicLink()) {
      fail('RECONCILIATION_INCOMPLETE', 'source_path_symlink', { source_ref: sourceRef });
    }
  }
  const state = await lstat(absolute);
  if (!state.isFile() || await realpath(absolute) !== absolute) {
    fail('RECONCILIATION_INCOMPLETE', 'source_path_not_regular', { source_ref: sourceRef });
  }
  const bytes = await readFile(absolute);
  decodeUtf8(bytes, 'RECONCILIATION_INCOMPLETE', 'source_invalid_utf8');
  const lines = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index === bytes.length || bytes[index] === 0x0a) {
      lines.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  const line = lines[parsed.line - 1];
  if (line === undefined) fail('RECONCILIATION_INCOMPLETE', 'source_line_missing', { source_ref: sourceRef });
  return line;
}

async function verifyRevisionSources(repoRoot, inventory) {
  for (const entry of [...inventory.active, ...inventory.excluded_tombstones]) {
    const line = await sourceItemBytes(repoRoot, entry.source_ref);
    if (sha256Bytes(line) !== entry.source_digest) {
      fail('RECONCILIATION_INCOMPLETE', 'source_digest_mismatch', { source_ref: entry.source_ref });
    }
    if (markdownCheckboxState(line) === null) {
      fail('RECONCILIATION_INCOMPLETE', 'source_item_not_todo', { source_ref: entry.source_ref });
    }
  }
}

export async function verifyTodoRevisionSources(options = {}) {
  const revision = options.revision;
  if (!validateTodoRevision(revision)) fail('REVISION_INVALID', 'revision_schema_or_digest_invalid');
  await verifyRevisionSources(path.resolve(options.repoRoot ?? process.cwd()), revision.source_inventory);
  return true;
}

function mappedNodeRef(ref, plan, idMap) {
  if (ref.project_id !== plan.project_id || ref.plan_key !== plan.plan_key) return ref;
  return { ...ref, task_id: idMap.get(ref.task_id) ?? ref.task_id };
}

function localTaskRef(ref, plan, taskId) {
  return ref.project_id === plan.project_id && ref.plan_key === plan.plan_key
    && ref.task_id === taskId;
}

function taskSemantics(plan, taskId, idMap, { reconciliationMetadata = false } = {}) {
  const task = plan.tasks.find(({ task_id }) => task_id === taskId);
  if (!task) return null;
  const mapId = (id) => id === null ? null : idMap.get(id) ?? id;
  const normalizedTask = reconciliationMetadata ? {
    task_id: mapId(task.task_id), title: task.title, lane: task.lane,
    compile_binding: task.compile_binding,
  } : {
    task_id: mapId(task.task_id), title: task.title, lane: task.lane,
    narrative_ref: task.narrative_ref, narrative_anchor: task.narrative_anchor ?? null,
    compile_binding: task.compile_binding, parent_task_id: mapId(task.parent_task_id ?? null),
  };
  const edges = plan.hard_dependencies
    .filter(({ from, to }) => localTaskRef(from, plan, taskId) || localTaskRef(to, plan, taskId))
    .map(({ from, to }) => ({ from: mappedNodeRef(from, plan, idMap), to: mappedNodeRef(to, plan, idMap) }))
    .sort((left, right) => canonicalizeTodoArtifact(left) < canonicalizeTodoArtifact(right) ? -1 : 1);
  const joins = plan.joins
    .filter(({ after, before }) => localTaskRef(before, plan, taskId)
      || after.some((ref) => localTaskRef(ref, plan, taskId)))
    .map((join) => ({ ...join,
      after: join.after.map((ref) => mappedNodeRef(ref, plan, idMap))
        .sort((left, right) => canonicalizeTodoArtifact(left) < canonicalizeTodoArtifact(right) ? -1 : 1),
      before: mappedNodeRef(join.before, plan, idMap),
    })).sort((left, right) => left.id < right.id ? -1 : 1);
  const phaseAcceptDependencies = plan.schema === 'lattice.todo_plan.v5'
    ? plan.phase_accept_dependencies
      .filter(({ to }) => localTaskRef(to, plan, taskId))
      .map(({ from, to }) => ({ from, to: mappedNodeRef(to, plan, idMap) }))
      .sort((left, right) => canonicalizeTodoArtifact(left) < canonicalizeTodoArtifact(right) ? -1 : 1)
    : [];
  return { task: normalizedTask, hard_dependencies: edges, joins, phase_accept_dependencies: phaseAcceptDependencies };
}

function stateMigrationFor(previous, revision) {
  const oldIds = previous.plan.tasks.map(({ task_id }) => task_id);
  const migrationIds = revision.task_migration.map(({ from_task_id }) => from_task_id);
  if (canonicalizeTodoArtifact([...oldIds].sort()) !== canonicalizeTodoArtifact([...migrationIds].sort())) {
    fail('REVISION_INVALID', 'predecessor_task_migration_incomplete');
  }
  const idMap = new Map(revision.task_migration
    .filter(({ to_task_id }) => to_task_id !== 'removed')
    .map(({ from_task_id, to_task_id }) => [from_task_id, to_task_id]));
  const states = new Map(previous.tasks.map((state) => [state.task_id, state]));
  return revision.task_migration.map((migration) => {
    const carriesState = ['carry', 'carry_reconciled_metadata'].includes(migration.state_policy);
    if (!carriesState) return { ...migration, state: null };
    const reconciliationMetadata = migration.state_policy === 'carry_reconciled_metadata';
    const before = taskSemantics(previous.plan, migration.from_task_id, idMap,
      { reconciliationMetadata });
    const after = taskSemantics(revision.desired_plan, migration.to_task_id, new Map(),
      { reconciliationMetadata });
    if (canonicalizeTodoArtifact(before) !== canonicalizeTodoArtifact(after)) {
      fail('REVISION_INVALID', 'carry_semantics_changed', { from_task_id: migration.from_task_id });
    }
    const state = states.get(migration.from_task_id);
    if (!state) fail('STORE_INCONSISTENT', 'predecessor_task_state_missing');
    return { ...migration, state: {
      status: state.status, started_at: state.started_at, done_at: state.done_at,
      blocked_reason: state.blocked_reason, evidence: state.evidence, imported: state.imported,
    } };
  });
}

function phaseStateMigrationFor(previous, revision) {
  const predecessorPhases = ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(previous.plan.schema)
    ? previous.plan.phases : [];
  const sourceIds = revision.phase_migration
    .filter(({ from_phase_id }) => from_phase_id !== null).map(({ from_phase_id }) => from_phase_id);
  if (canonicalizeTodoArtifact([...sourceIds].sort())
    !== canonicalizeTodoArtifact(predecessorPhases.map(({ phase_id }) => phase_id).sort())) {
    fail('REVISION_INVALID', 'predecessor_phase_migration_incomplete');
  }
  const idMap = new Map(revision.phase_migration
    .filter(({ from_phase_id, to_phase_id }) => from_phase_id !== null && to_phase_id !== 'removed')
    .map(({ from_phase_id, to_phase_id }) => [from_phase_id, to_phase_id]));
  const taskIdMap = new Map(revision.task_migration
    .filter(({ to_task_id }) => to_task_id !== 'removed')
    .map(({ from_task_id, to_task_id }) => [from_task_id, to_task_id]));
  const previousStates = new Map((previous.snapshot.phases ?? []).map((state) => [state.phase_id, state]));
  return revision.phase_migration
    .filter(({ to_phase_id }) => to_phase_id !== 'removed')
    .map((migration) => {
      if (migration.state_policy === 'reset') {
        return { phase_id: migration.to_phase_id, state_policy: 'reset', state: null };
      }
      const before = predecessorPhases.find(({ phase_id }) => phase_id === migration.from_phase_id);
      const after = revision.desired_plan.phases.find(({ phase_id }) => phase_id === migration.to_phase_id);
      const mappedBefore = { ...before, phase_id: migration.to_phase_id,
        predecessor_phase_ids: before.predecessor_phase_ids.map((id) => idMap.get(id) ?? id).sort() };
      const beforeTaskIds = previous.plan.tasks
        .filter(({ phase_id }) => phase_id === migration.from_phase_id)
        .map(({ task_id }) => taskIdMap.get(task_id) ?? 'removed').filter((id) => id !== 'removed').sort();
      const afterTaskIds = revision.desired_plan.tasks
        .filter(({ phase_id }) => phase_id === migration.to_phase_id).map(({ task_id }) => task_id).sort();
      if (canonicalizeTodoArtifact({ phase: mappedBefore, task_ids: beforeTaskIds })
        !== canonicalizeTodoArtifact({ phase: after, task_ids: afterTaskIds })) {
        fail('REVISION_INVALID', 'phase_carry_semantics_changed', { from_phase_id: migration.from_phase_id });
      }
      const state = previousStates.get(migration.from_phase_id);
      if (state === undefined) fail('STORE_INCONSISTENT', 'predecessor_phase_state_missing');
      return { phase_id: migration.to_phase_id, state_policy: 'carry', state: {
        status: state.status, review_event_digest: state.review_event_digest,
        decision_event_digest: state.decision_event_digest, decision_evidence: state.decision_evidence,
      } };
    }).sort((left, right) => left.phase_id.localeCompare(right.phase_id));
}

function phaseRevisionResult(revision, genesis, recovered = false) {
  const result = {
    schema: 'lattice.phase_todo_revise_result.v1', project_id: revision.project_id,
    plan_key: revision.plan_key, predecessor_plan_digest: revision.predecessor.plan_digest,
    predecessor_journal_head_digest: revision.predecessor.journal_head_digest,
    plan_version: revision.desired_plan.plan_version, plan_digest: revision.desired_plan.plan_digest,
    topology_digest: revision.desired_plan.topology_digest, journal_head_digest: genesis.event_digest,
    revision_digest: revision.revision_digest, recovered, result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

function revisionResult(revision, genesis, { recovered = false } = {}) {
  const result = {
    schema: revision.schema === 'lattice.todo_revision.v2'
      ? 'lattice.todo_revise_result.v2' : 'lattice.todo_revise_result.v1',
    project_id: revision.project_id,
    plan_key: revision.plan_key, predecessor_plan_digest: revision.predecessor.plan_digest,
    predecessor_journal_head_digest: revision.predecessor.journal_head_digest,
    plan_version: revision.desired_plan.plan_version, plan_digest: revision.desired_plan.plan_digest,
    topology_digest: revision.desired_plan.topology_digest, journal_head_digest: genesis.event_digest,
    revision_digest: revision.revision_digest,
    reconciliation_digest: revision.reconciliation.reconciliation_digest,
    ...(revision.schema === 'lattice.todo_revision.v2' ? { source_cutover: {
      batch_id: revision.source_cutover_batch.batch_id,
      operation_count: revision.source_cutover_batch.operations.length,
      archive_ref: revision.source_cutover_batch.archive_ref,
      recovered,
    } } : {}),
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function exactFileOrNull(absolute) {
  try {
    const state = await lstat(absolute);
    if (state.isSymbolicLink() || !state.isFile()) fail('REVISION_CONFLICT', 'revision_artifact_unsafe');
    return readFile(absolute);
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureSafeStoreDirectory(repoRoot, target) {
  const requestedStoreRoot = path.resolve(repoRoot, STORE_ROOT_REF);
  const requested = path.resolve(target);
  if (requested !== requestedStoreRoot && !requested.startsWith(`${requestedStoreRoot}${path.sep}`)) {
    fail('REVISION_CONFLICT', 'revision_directory_outside_store');
  }
  const canonicalRepoRoot = await realpath(repoRoot);
  const storeRoot = path.resolve(canonicalRepoRoot, STORE_ROOT_REF);
  const absolute = path.resolve(storeRoot, path.relative(requestedStoreRoot, requested));
  let current = storeRoot;
  const parts = path.relative(storeRoot, absolute).split(path.sep).filter(Boolean);
  for (const part of ['', ...parts]) {
    if (part !== '') current = path.join(current, part);
    let state;
    try { state = await lstat(current); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
      await fsyncDirectory(path.dirname(current));
      state = await lstat(current);
    }
    if (state.isSymbolicLink() || !state.isDirectory() || await realpath(current) !== current) {
      fail('REVISION_CONFLICT', 'revision_directory_unsafe');
    }
  }
}

function parseRevisionMarker(bytes) {
  return parseCanonicalJsonLine(bytes, {
    code: 'REVISION_CONFLICT', reason: 'revision_marker_invalid',
    maxBytes: TODO_LIMITS.snapshotBytes,
    validate: (value) => exactRecord(value, ['schema', 'revision', 'genesis'])
      && value.schema === 'lattice.todo_revision_transaction.v1'
      && validateTodoRevision(value.revision) && validateTodoEvent(value.genesis),
  });
}

function parsePhaseRevisionMarker(bytes) {
  return parseCanonicalJsonLine(bytes, {
    code: 'REVISION_CONFLICT', reason: 'phase_revision_marker_invalid',
    maxBytes: TODO_LIMITS.snapshotBytes,
    validate: (value) => exactRecord(value, ['schema', 'revision', 'genesis'])
      && value.schema === 'lattice.phase_todo_revision_transaction.v1'
      && validatePhaseTodoRevision(value.revision) && validateTodoEvent(value.genesis),
  });
}

function parseRevisionSetMarker(bytes) {
  return parseCanonicalJsonLine(bytes, {
    code: 'REVISION_CONFLICT', reason: 'revision_set_marker_invalid',
    maxBytes: TODO_LIMITS.snapshotBytes,
    validate: (value) => exactRecord(value, [
      'schema', 'project_id', 'revision_set_digest', 'entries',
    ]) && ['lattice.todo_revision_set_transaction.v1',
      'lattice.todo_revision_set_transaction.v2'].includes(value.schema)
      && isTodoIdentifier(value.project_id) && isTodoDigest(value.revision_set_digest)
      && Array.isArray(value.entries) && value.entries.length > 0
      && value.entries.every((entry) => {
        const phase = ['lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2']
          .includes(entry?.revision?.schema);
        return exactRecord(entry, phase && value.schema.endsWith('.v2') ? [
          'revision', 'state_migration', 'phase_state_migration', 'genesis',
        ] : ['revision', 'state_migration', 'genesis'])
          && (phase ? validatePhaseTodoRevision(entry.revision) : validateTodoRevision(entry.revision))
          && Array.isArray(entry.state_migration)
          && (!phase || Array.isArray(entry.phase_state_migration))
          && validateTodoEvent(entry.genesis);
      }),
  });
}

async function rejectCompetingRevisionTransaction(repoRoot, revision) {
  const root = path.join(repoRoot, STORE_ROOT_REF, 'transactions', 'revisions', revision.plan_key);
  let names;
  try {
    const state = await lstat(root);
    if (state.isSymbolicLink() || !state.isDirectory()) {
      fail('REVISION_CONFLICT', 'revision_transaction_root_unsafe');
    }
    names = await readdir(root);
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) {
    if (!isTodoIdentifier(name)) fail('REVISION_CONFLICT', 'revision_transaction_entry_invalid');
    const markerBytes = await exactFileOrNull(path.join(root, name, 'marker.json'));
    if (markerBytes === null) fail('REVISION_CONFLICT', 'revision_marker_missing');
    const marker = parseRevisionMarker(markerBytes);
    if (canonicalizeTodoArtifact(marker.revision.predecessor)
        === canonicalizeTodoArtifact(revision.predecessor)
      && marker.revision.revision_digest !== revision.revision_digest) {
      fail('REVISION_CONFLICT', 'revision_bytes_conflict');
    }
  }
}

async function publishRevisionArtifact(staged, finalAbsolute, expected) {
  const finalBytes = await exactFileOrNull(finalAbsolute);
  if (finalBytes !== null) {
    if (!finalBytes.equals(expected)) fail('REVISION_CONFLICT', 'revision_bytes_conflict');
    return;
  }
  let stagedBytes = await exactFileOrNull(staged);
  if (stagedBytes === null) {
    await atomicWrite(staged, expected);
    stagedBytes = expected;
  }
  if (!stagedBytes.equals(expected)) fail('REVISION_CONFLICT', 'revision_bytes_conflict');
  await mkdir(path.dirname(finalAbsolute), { recursive: true });
  await rename(staged, finalAbsolute);
  await fsyncDirectory(path.dirname(finalAbsolute));
}

function splitSourceLines(bytes) {
  const lines = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index === bytes.length || bytes[index] === 0x0a) {
      lines.push({ start, end: index, bytes: bytes.subarray(start, index) });
      start = index + 1;
    }
  }
  return lines;
}

async function safeRepoFile(repoRoot, ref, { missing = false } = {}) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, ref);
  if (!absolute.startsWith(`${canonicalRoot}${path.sep}`)) {
    fail('RECONCILIATION_INCOMPLETE', 'source_path_outside_repo', { ref });
  }
  let current = canonicalRoot;
  const parts = path.relative(canonicalRoot, absolute).split(path.sep).filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    let state;
    try { state = await lstat(current); }
    catch (error) {
      if (missing && error?.code === 'ENOENT') return { absolute, missingParent: current };
      fail('RECONCILIATION_INCOMPLETE', 'source_path_missing', { ref });
    }
    if (state.isSymbolicLink() || !state.isDirectory() || await realpath(current) !== current) {
      fail('RECONCILIATION_INCOMPLETE', 'source_path_symlink', { ref });
    }
  }
  let state;
  try { state = await lstat(absolute); }
  catch (error) {
    if (missing && error?.code === 'ENOENT') return { absolute, missing: true };
    fail('RECONCILIATION_INCOMPLETE', 'source_path_missing', { ref });
  }
  if (state.isSymbolicLink() || !state.isFile() || state.nlink !== 1
    || await realpath(absolute) !== absolute) {
    fail('RECONCILIATION_INCOMPLETE', 'source_path_not_regular', { ref });
  }
  return { absolute, state, missing: false };
}

async function ensureSafeRepoParent(repoRoot, absolute) {
  const canonicalRoot = await realpath(repoRoot);
  if (!absolute.startsWith(`${canonicalRoot}${path.sep}`)) {
    fail('REVISION_CONFLICT', 'source_path_outside_repo');
  }
  let current = canonicalRoot;
  for (const part of path.relative(canonicalRoot, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const state = await lstat(current);
      if (state.isSymbolicLink() || !state.isDirectory() || await realpath(current) !== current) {
        fail('REVISION_CONFLICT', 'source_directory_unsafe');
      }
    } catch (error) {
      if (error instanceof TodoStoreError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
      await fsyncDirectory(path.dirname(current));
    }
  }
}

function sourceCutoverArchiveBytes(revision, originals) {
  const header = [
    '# Lattice ToDo archive',
    `Plan: ${revision.plan_key}`,
    `Batch: ${revision.source_cutover_batch.batch_id}`,
    `Revision: ${revision.revision_digest}`,
    '',
  ].join('\n');
  return Buffer.concat([Buffer.from(`${header}\n`, 'utf8'),
    ...originals.flatMap((line) => [line, Buffer.from('\n')])]);
}

async function buildSourceCutoverImages(repoRoot, revision) {
  const batch = revision.source_cutover_batch;
  const archiveState = await safeRepoFile(repoRoot, batch.archive_ref, { missing: true });
  if (!archiveState.missing && !archiveState.missingParent) {
    fail('REVISION_CONFLICT', 'source_cutover_archive_exists', { archive_ref: batch.archive_ref });
  }
  const groups = new Map();
  const originals = [];
  for (const operation of batch.operations) {
    const parsed = parseTodoSourceRef(operation.source_ref);
    const state = await safeRepoFile(repoRoot, parsed.path);
    let group = groups.get(parsed.path);
    if (!group) {
      const before = await readFile(state.absolute);
      decodeUtf8(before, 'RECONCILIATION_INCOMPLETE', 'source_invalid_utf8');
      group = { ref: parsed.path, absolute: state.absolute, before,
        mode: state.state.mode & 0o7777, replacements: [] };
      groups.set(parsed.path, group);
    }
    const line = splitSourceLines(group.before)[parsed.line - 1]?.bytes;
    if (line === undefined) fail('RECONCILIATION_INCOMPLETE', 'source_line_missing', {
      source_ref: operation.source_ref,
    });
    if (sha256Bytes(line) !== operation.source_digest) {
      fail('RECONCILIATION_INCOMPLETE', 'source_digest_mismatch', { source_ref: operation.source_ref });
    }
    if (markdownCheckboxState(line) === null) {
      fail('RECONCILIATION_INCOMPLETE', 'source_item_not_todo', { source_ref: operation.source_ref });
    }
    if (!liveReplacementPreservesListStructure(line, operation.live_replacement)) {
      fail('RECONCILIATION_INCOMPLETE', 'live_replacement_breaks_list_structure', {
        source_ref: operation.source_ref,
      });
    }
    originals.push(line);
    const replacement = Buffer.from(`${operation.live_replacement}${line.at(-1) === 0x0d ? '\r' : ''}`, 'utf8');
    group.replacements.push({ line: parsed.line, replacement });
  }
  const files = [...groups.values()].sort((left, right) => left.ref.localeCompare(right.ref));
  for (const file of files) {
    const lines = splitSourceLines(file.before);
    let after = file.before;
    for (const replacement of file.replacements.sort((left, right) => right.line - left.line)) {
      const target = lines[replacement.line - 1];
      after = Buffer.concat([after.subarray(0, target.start), replacement.replacement,
        after.subarray(target.end)]);
    }
    file.after = after;
  }
  return { files, archive: { ref: batch.archive_ref, absolute: archiveState.absolute,
    bytes: sourceCutoverArchiveBytes(revision, originals) } };
}

async function stageSourceCutover(transaction, revision, images) {
  const files = [];
  for (const [index, file] of images.files.entries()) {
    const beforeName = `source-${index}-before.bin`;
    const afterName = `source-${index}-after.bin`;
    await atomicWrite(path.join(transaction, beforeName), file.before);
    await atomicWrite(path.join(transaction, afterName), file.after);
    files.push({ ref: file.ref, before: beforeName, after: afterName, mode: file.mode,
      before_digest: sha256Bytes(file.before), after_digest: sha256Bytes(file.after) });
  }
  await atomicWrite(path.join(transaction, 'source-archive.bin'), images.archive.bytes);
  const descriptor = {
    schema: 'lattice.todo_source_cutover_stage.v1', revision_digest: revision.revision_digest,
    archive_ref: images.archive.ref, archive_digest: sha256Bytes(images.archive.bytes), files,
  };
  await atomicWrite(path.join(transaction, 'source-cutover.json'), canonicalLine(descriptor));
  return descriptor;
}

async function loadSourceCutoverStage(repoRoot, transaction, revision) {
  const bytes = await exactFileOrNull(path.join(transaction, 'source-cutover.json'));
  if (bytes === null) fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_stage_missing');
  let descriptor;
  try { descriptor = JSON.parse(decodeUtf8(bytes, 'SOURCE_CUTOVER_RECOVERY_REQUIRED', 'stage_invalid')); }
  catch (error) {
    if (error instanceof TodoStoreError) throw error;
    fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'stage_invalid');
  }
  if (descriptor?.schema !== 'lattice.todo_source_cutover_stage.v1'
    || descriptor.revision_digest !== revision.revision_digest
    || descriptor.archive_ref !== revision.source_cutover_batch.archive_ref
    || !Array.isArray(descriptor.files)) {
    fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'stage_invalid');
  }
  const files = [];
  for (const file of descriptor.files) {
    const before = await exactFileOrNull(path.join(transaction, file.before));
    const after = await exactFileOrNull(path.join(transaction, file.after));
    if (before === null || after === null || sha256Bytes(before) !== file.before_digest
      || sha256Bytes(after) !== file.after_digest) {
      fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_stage_invalid');
    }
    if (!Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o7777) {
      fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_stage_invalid');
    }
    const state = await safeRepoFile(repoRoot, file.ref);
    files.push({ ...file, absolute: state.absolute, before, after });
  }
  const archiveBytes = await exactFileOrNull(path.join(transaction, 'source-archive.bin'));
  if (archiveBytes === null || sha256Bytes(archiveBytes) !== descriptor.archive_digest) {
    fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_stage_invalid');
  }
  const archiveAbsolute = path.resolve(await realpath(repoRoot), descriptor.archive_ref);
  return { descriptor, files, archive: { absolute: archiveAbsolute, bytes: archiveBytes } };
}

async function publishSourceCutover(repoRoot, staged) {
  await ensureSafeRepoParent(repoRoot, staged.archive.absolute);
  const existingArchive = await exactFileOrNull(staged.archive.absolute);
  if (existingArchive === null) await atomicWriteMode(staged.archive.absolute, staged.archive.bytes, 0o644);
  else if (!existingArchive.equals(staged.archive.bytes)) {
    fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'archive_bytes_conflict');
  }
  for (const file of staged.files) {
    const current = await readFile(file.absolute);
    if (current.equals(file.after)) continue;
    if (!current.equals(file.before)) {
      fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_bytes_conflict', { source_ref: file.ref });
    }
    await atomicWriteMode(file.absolute, file.after, file.mode);
  }
}

async function rollbackSourceCutover(staged, barrierAbsolute, { removeBarrier = true } = {}) {
  for (const file of staged.files) {
    const current = await readFile(file.absolute);
    if (current.equals(file.after)) await atomicWriteMode(file.absolute, file.before, file.mode);
    else if (!current.equals(file.before)) return false;
  }
  const archive = await exactFileOrNull(staged.archive.absolute);
  if (archive !== null) {
    if (!archive.equals(staged.archive.bytes)) return false;
    await rm(staged.archive.absolute);
    await fsyncDirectory(path.dirname(staged.archive.absolute));
  }
  if (removeBarrier) {
    await rm(barrierAbsolute, { force: true });
    await fsyncDirectory(path.dirname(barrierAbsolute));
  }
  return true;
}

/** Native successor transaction for first-class Phase plans; no Markdown source inventory is involved. */
export async function applyPhaseTodoRevision(options = {}) {
  requireWriter(options.writer, 'g5-authoring');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const revision = options.revision;
  if (!validatePhaseTodoRevision(revision)) fail('REVISION_INVALID', 'phase_revision_schema_or_digest_invalid');
  return withLock(repoRoot, async () => {
    const store = await readTodoStore({ repoRoot, forWrite: true, now: options.now });
    const previous = store.members.find(({ descriptor }) => descriptor.plan_key === revision.plan_key);
    if (!previous || revision.project_id !== store.project_id) fail('STORE_INCONSISTENT', 'plan_not_active');
    const transaction = path.join(repoRoot, STORE_ROOT_REF, 'transactions', 'phase-revisions',
      revision.plan_key, revision.desired_plan.plan_version);
    const markerAbsolute = path.join(transaction, 'marker.json');
    const activeGenesis = previous.journal.events[0];
    if (previous.plan.plan_digest === revision.desired_plan.plan_digest
      && activeGenesis.schema === 'lattice.todo_event.v4'
      && activeGenesis.revision_digest === revision.revision_digest) {
      await rm(transaction, { recursive: true, force: true });
      return phaseRevisionResult(revision, activeGenesis, true);
    }
    if (previous.plan.plan_digest !== revision.predecessor.plan_digest
      || previous.plan.plan_version !== revision.predecessor.plan_version
      || previous.journal.events.at(-1).event_digest !== revision.predecessor.journal_head_digest) {
      fail('STORE_WRITE_CONFLICT', 'stale_predecessor');
    }
    verifyPlanNarrativeAnchors(repoRoot, revision.desired_plan, previous.plan);
    const stateMigration = stateMigrationFor(previous, revision);
    const phaseStateMigration = phaseStateMigrationFor(previous, revision);
    const prospective = store.members.map((member) => member === previous
      ? { ...member, plan: revision.desired_plan } : member);
    validateMergedGraph(prospective);
    const candidateGenesis = buildPhaseRevisionGenesis(revision.desired_plan, {
      previous_digest: revision.predecessor.journal_head_digest,
      actor: options.actor, recorded_at: options.recordedAt, provenance: options.provenance ?? null,
      revision_digest: revision.revision_digest, state_migration: stateMigration,
      phase_state_migration: phaseStateMigration,
    });
    await ensureSafeStoreDirectory(repoRoot, transaction);
    const markerBytes = await exactFileOrNull(markerAbsolute);
    let genesis = candidateGenesis;
    if (markerBytes !== null) {
      const marker = parsePhaseRevisionMarker(markerBytes);
      if (canonicalizeTodoArtifact(marker.revision) !== canonicalizeTodoArtifact(revision)
        || canonicalizeTodoArtifact(marker.genesis.state_migration)
          !== canonicalizeTodoArtifact(stateMigration)
        || canonicalizeTodoArtifact(marker.genesis.phase_state_migration)
          !== canonicalizeTodoArtifact(phaseStateMigration)) {
        fail('REVISION_CONFLICT', 'revision_bytes_conflict');
      }
      genesis = marker.genesis;
    } else {
      await atomicWrite(markerAbsolute, canonicalLine({
        schema: 'lattice.phase_todo_revision_transaction.v1', revision, genesis,
      }));
    }
    await protocolStage(options, 'phase_revision_marker_durable');
    const base = `${STORE_ROOT_REF}/plans/${revision.plan_key}/${revision.desired_plan.plan_version}`;
    const revisionRef = `${base}/revision.json`; const planRef = `${base}/plan.json`;
    const journalRef = `${base}/journal/active.jsonl`; const snapshotRef = `${base}/snapshot.json`;
    const tasks = replay(revision.desired_plan, [genesis], {
      now: options.now ? new Date(options.now) : new Date(),
      verifyEvidence: evidenceVerifier(store.manifest, repoRoot, true),
      verifyImportSource: importSourceVerifier(repoRoot, true),
    });
    const snapshot = snapshotFor(revision.desired_plan, [genesis], tasks);
    const artifacts = [
      ['phase_revision_input_durable', revisionRef, canonicalLine(revision)],
      ['phase_revision_plan_durable', planRef, canonicalLine(revision.desired_plan)],
      ['phase_revision_genesis_durable', journalRef, canonicalLine(genesis)],
      ['phase_revision_snapshot_durable', snapshotRef, canonicalLine(snapshot)],
    ];
    for (const [stage, ref, bytes] of artifacts) {
      const absolute = path.resolve(repoRoot, ref);
      const existing = await exactFileOrNull(absolute);
      if (existing === null) await atomicWrite(absolute, bytes);
      else if (!existing.equals(bytes)) fail('REVISION_CONFLICT', 'revision_bytes_conflict');
      await protocolStage(options, stage);
    }
    const currentManifest = await readArtifact(repoRoot, MANIFEST_REF, {
      code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
    });
    if (currentManifest.manifest_digest !== store.manifest.manifest_digest) {
      fail('STORE_WRITE_CONFLICT', 'manifest_digest_changed');
    }
    const descriptor = currentManifest.members.find(({ plan_key }) => plan_key === revision.plan_key);
    Object.assign(descriptor, { active_plan_version: revision.desired_plan.plan_version,
      plan_ref: planRef, journal_ref: journalRef, snapshot_ref: snapshotRef,
      topology_digest: revision.desired_plan.topology_digest, journal_head_digest: genesis.event_digest });
    currentManifest.manifest_digest = todoSelfDigest(currentManifest, 'manifest_digest');
    await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(currentManifest));
    await protocolStage(options, 'phase_revision_manifest_activated');
    await rm(transaction, { recursive: true, force: true });
    return phaseRevisionResult(revision, genesis, false);
  });
}

/** G5 revision transaction: exact successor, state migration, and manifest-CAS activation. */
export async function applyTodoRevision(options = {}) {
  requireWriter(options.writer, 'g5-authoring');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const revision = options.revision;
  if (!validateTodoRevision(revision)) fail('REVISION_INVALID', 'revision_schema_or_digest_invalid');
  return withLock(repoRoot, async () => {
    const barrierAbsolute = path.resolve(repoRoot, SOURCE_CUTOVER_BARRIER_REF);
    const barrierBytes = await exactFileOrNull(barrierAbsolute);
    let recovering = false;
    if (barrierBytes !== null) {
      let barrier;
      try { barrier = JSON.parse(decodeUtf8(barrierBytes, 'SOURCE_CUTOVER_RECOVERY_REQUIRED', 'barrier_invalid')); }
      catch (error) {
        if (error instanceof TodoStoreError) throw error;
        fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'barrier_invalid');
      }
      if (revision.schema !== 'lattice.todo_revision.v2'
        || barrier?.schema !== 'lattice.todo_source_cutover_barrier.v1'
        || barrier.revision_digest !== revision.revision_digest) {
        fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_recovery_required');
      }
      recovering = true;
    }
    const store = await readTodoStore({ repoRoot, forWrite: true, now: options.now,
      ...(recovering ? { allowSourceCutoverRevisionDigest: revision.revision_digest,
        sourceCutoverRecoveryCapability: SOURCE_CUTOVER_RECOVERY_CAPABILITY } : {}) });
    const previous = store.members.find(({ descriptor }) => descriptor.plan_key === revision.plan_key);
    if (!previous || revision.project_id !== store.project_id) fail('STORE_INCONSISTENT', 'plan_not_active');
    const activeGenesis = previous.journal.events[0];
    if (previous.plan.plan_digest === revision.desired_plan.plan_digest
      && activeGenesis.schema === 'lattice.todo_event.v2'
      && activeGenesis.revision_digest === revision.revision_digest) {
      const transaction = path.join(repoRoot, STORE_ROOT_REF, 'transactions', 'revisions',
        revision.plan_key, revision.desired_plan.plan_version);
      if (revision.schema === 'lattice.todo_revision.v2' && recovering) {
        const staged = await loadSourceCutoverStage(repoRoot, transaction, revision);
        await publishSourceCutover(repoRoot, staged);
        await rm(barrierAbsolute, { force: true });
        await fsyncDirectory(path.dirname(barrierAbsolute));
      }
      await rm(transaction, { recursive: true, force: true });
      return revisionResult(revision, activeGenesis, { recovered: recovering });
    }
    if (activeGenesis.schema === 'lattice.todo_event.v2'
      && activeGenesis.payload.predecessor_plan_digest === revision.predecessor.plan_digest
      && activeGenesis.previous_digest === revision.predecessor.journal_head_digest) {
      fail('REVISION_CONFLICT', 'revision_bytes_conflict');
    }
    if (previous.plan.plan_digest !== revision.predecessor.plan_digest
      || previous.plan.plan_version !== revision.predecessor.plan_version
      || previous.journal.events.at(-1).event_digest !== revision.predecessor.journal_head_digest) {
      fail('STORE_WRITE_CONFLICT', 'stale_predecessor');
    }
    const predecessorReconciliationDigest = activeGenesis.schema === 'lattice.todo_event.v2'
      ? activeGenesis.reconciliation_digest
      : todoLegacyReconciliationDigest({
        planDigest: previous.plan.plan_digest,
        journalHeadDigest: previous.journal.events.at(-1).event_digest,
      });
    if (revision.reconciliation.predecessor_reconciliation_digest
      !== predecessorReconciliationDigest) fail('STORE_WRITE_CONFLICT', 'stale_predecessor');

    await rejectCompetingRevisionTransaction(repoRoot, revision);
    const cutoverImages = revision.schema === 'lattice.todo_revision.v2' && !recovering
      ? await buildSourceCutoverImages(repoRoot, revision) : null;
    if (revision.schema === 'lattice.todo_revision.v1') {
      await verifyRevisionSources(repoRoot, revision.source_inventory);
    }
    verifyPlanNarrativeAnchors(repoRoot, revision.desired_plan, previous.plan);
    const stateMigration = stateMigrationFor(previous, revision);
    const prospective = store.members.map((member) => member === previous
      ? { ...member, plan: revision.desired_plan } : member);
    validateMergedGraph(prospective);

    const candidateGenesis = buildRevisionGenesis(revision.desired_plan, {
      previous_digest: revision.predecessor.journal_head_digest,
      actor: options.actor, recorded_at: options.recordedAt,
      provenance: options.provenance ?? null, state_migration: stateMigration,
      revision_digest: revision.revision_digest,
      reconciliation_digest: revision.reconciliation.reconciliation_digest,
    });
    const base = `${STORE_ROOT_REF}/plans/${revision.plan_key}/${revision.desired_plan.plan_version}`;
    const revisionRef = `${base}/revision.json`;
    const planRef = `${base}/plan.json`;
    const journalRef = `${base}/journal/active.jsonl`;
    const snapshotRef = `${base}/snapshot.json`;
    const transactionRef = `${STORE_ROOT_REF}/transactions/revisions/${revision.plan_key}/${revision.desired_plan.plan_version}`;
    const transaction = path.resolve(repoRoot, transactionRef);
    const markerAbsolute = path.join(transaction, 'marker.json');
    await ensureSafeStoreDirectory(repoRoot, transaction);
    await ensureSafeStoreDirectory(repoRoot, path.dirname(path.resolve(repoRoot, planRef)));
    const markerBytes = await exactFileOrNull(markerAbsolute);
    let genesis = candidateGenesis;
    if (markerBytes !== null) {
      const marker = parseRevisionMarker(markerBytes);
      if (canonicalizeTodoArtifact(marker.revision) !== canonicalizeTodoArtifact(revision)
        || canonicalizeTodoArtifact(marker.genesis.state_migration)
          !== canonicalizeTodoArtifact(stateMigration)) {
        fail('REVISION_CONFLICT', 'revision_bytes_conflict');
      }
      genesis = marker.genesis;
    } else {
      await atomicWrite(markerAbsolute, canonicalLine({
        schema: 'lattice.todo_revision_transaction.v1', revision, genesis,
      }));
    }
    await protocolStage(options, 'revision_marker_durable');

    const verifyEvidence = evidenceVerifier(store.manifest, repoRoot, true);
    const verifyImportSource = importSourceVerifier(repoRoot, true);
    const tasks = replay(revision.desired_plan, [genesis], {
      now: options.now ? new Date(options.now) : new Date(), verifyEvidence, verifyImportSource,
    });
    const snapshot = snapshotFor(revision.desired_plan, [genesis], tasks);
    const planBytes = canonicalLine(revision.desired_plan);
    const journalBytes = canonicalLine(genesis);
    const snapshotBytes = canonicalLine(snapshot);
    await publishRevisionArtifact(path.join(transaction, 'revision.json'),
      path.resolve(repoRoot, revisionRef), canonicalLine(revision));
    await protocolStage(options, 'revision_input_durable');
    await publishRevisionArtifact(path.join(transaction, 'plan.json'), path.resolve(repoRoot, planRef), planBytes);
    await protocolStage(options, 'revision_plan_durable');
    await publishRevisionArtifact(path.join(transaction, 'active.jsonl'), path.resolve(repoRoot, journalRef), journalBytes);
    await protocolStage(options, 'revision_genesis_durable');
    await publishRevisionArtifact(path.join(transaction, 'snapshot.json'), path.resolve(repoRoot, snapshotRef), snapshotBytes);
    await protocolStage(options, 'revision_snapshot_durable');

    let stagedCutover = null;
    if (revision.schema === 'lattice.todo_revision.v2') {
      if (recovering) stagedCutover = await loadSourceCutoverStage(repoRoot, transaction, revision);
      else {
        const descriptor = await stageSourceCutover(transaction, revision, cutoverImages);
        stagedCutover = await loadSourceCutoverStage(repoRoot, transaction, revision);
        if (descriptor.revision_digest !== revision.revision_digest) {
          fail('REVISION_CONFLICT', 'source_cutover_stage_invalid');
        }
        await protocolStage(options, 'source_cutover_staged');
        await atomicWrite(barrierAbsolute, canonicalLine({
          schema: 'lattice.todo_source_cutover_barrier.v1',
          revision_digest: revision.revision_digest,
        }));
        await protocolStage(options, 'source_cutover_barrier_durable');
      }
      await publishSourceCutover(repoRoot, stagedCutover);
      await protocolStage(options, 'source_cutover_published');
    }

    try {
      const currentManifest = await readArtifact(repoRoot, MANIFEST_REF, {
        code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
      });
      if (currentManifest.manifest_digest !== store.manifest.manifest_digest) {
        fail('STORE_WRITE_CONFLICT', 'manifest_digest_changed');
      }
      const descriptor = currentManifest.members.find(({ plan_key }) => plan_key === revision.plan_key);
      if (!descriptor || descriptor.active_plan_version !== revision.predecessor.plan_version
        || descriptor.journal_head_digest !== revision.predecessor.journal_head_digest) {
        fail('STORE_WRITE_CONFLICT', 'stale_predecessor');
      }
      Object.assign(descriptor, {
        active_plan_version: revision.desired_plan.plan_version, plan_ref: planRef,
        journal_ref: journalRef, snapshot_ref: snapshotRef,
        topology_digest: revision.desired_plan.topology_digest,
        journal_head_digest: genesis.event_digest,
      });
      currentManifest.manifest_digest = todoSelfDigest(currentManifest, 'manifest_digest');
      await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(currentManifest));
      await protocolStage(options, 'revision_manifest_activated');
    } catch (error) {
      if (stagedCutover !== null && error instanceof TodoStoreError) {
        const rolledBack = await rollbackSourceCutover(stagedCutover, barrierAbsolute);
        if (!rolledBack) fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'rollback_incomplete');
      }
      throw error;
    }
    if (revision.schema === 'lattice.todo_revision.v2') {
      await rm(barrierAbsolute, { force: true });
      await fsyncDirectory(path.dirname(barrierAbsolute));
      await protocolStage(options, 'source_cutover_cleanup');
    }
    await rm(transaction, { recursive: true, force: true });
    return revisionResult(revision, genesis, { recovered: recovering });
  });
}

function revisionSetResult(projectId, revisionSetDigest, entries, { recovered }) {
  const result = {
    schema: 'lattice.todo_revision_set_result.v1',
    project_id: projectId,
    revision_set_digest: revisionSetDigest,
    members: entries.map(({ revision, genesis }) => ({
      plan_key: revision.plan_key,
      plan_version: revision.desired_plan.plan_version,
      revision_digest: revision.revision_digest,
      journal_head_digest: genesis.event_digest,
    })),
    recovered,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

/**
 * Multiple plan successors are prepared independently but become active through one manifest replace.
 * Set v2 additionally binds all Markdown cutovers behind one recovery barrier.
 */
export async function applyTodoRevisionSet(options = {}) {
  requireWriter(options.writer, 'g5-authoring');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const revisionSet = options.revisionSet ?? null;
  if (revisionSet !== null && !validateTodoRevisionSet(revisionSet)) {
    fail('REVISION_SET_INVALID', 'revision_set_schema_invalid');
  }
  const revisions = revisionSet?.revisions ?? options.revisions;
  if (!Array.isArray(revisions) || revisions.length < 2 || revisions.length > 64
    || revisions.some((revision) => !validateTodoRevision(revision)
      && !validatePhaseTodoRevision(revision))) {
    fail('REVISION_SET_INVALID', 'revision_set_schema_invalid');
  }
  if (revisionSet === null && revisions.some((revision) => revision.schema !== 'lattice.todo_revision.v1')) {
    fail('REVISION_SET_INVALID', 'revision_set_v2_required');
  }
  if (revisions.some((revision, index) => index > 0
    && revisions[index - 1].plan_key >= revision.plan_key)) {
    fail('REVISION_SET_INVALID', 'revision_set_order_invalid');
  }
  const projectId = revisions[0].project_id;
  if (revisions.some((revision) => revision.project_id !== projectId)) {
    fail('REVISION_SET_INVALID', 'revision_set_project_mismatch');
  }
  const revisionSetDigest = revisionSet?.revision_set_digest ?? digestTodoArtifact({
    schema: 'lattice.todo_revision_set.v1',
    project_id: projectId,
    revision_digests: revisions.map(({ plan_key, revision_digest }) => ({ plan_key, revision_digest })),
  });

  return withLock(repoRoot, async () => {
    const transactionRef = `${STORE_ROOT_REF}/transactions/revision-sets/${revisionSetDigest}`;
    const transaction = path.resolve(repoRoot, transactionRef);
    const barrierAbsolute = path.resolve(repoRoot, SOURCE_CUTOVER_BARRIER_REF);
    const barrierBytes = await exactFileOrNull(barrierAbsolute);
    let recovering = false;
    if (barrierBytes !== null) {
      let barrier;
      try { barrier = JSON.parse(decodeUtf8(barrierBytes, 'SOURCE_CUTOVER_RECOVERY_REQUIRED', 'barrier_invalid')); }
      catch (error) {
        if (error instanceof TodoStoreError) throw error;
        fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'barrier_invalid');
      }
      if (barrier?.schema !== 'lattice.todo_source_cutover_set_barrier.v1'
        || barrier.revision_set_digest !== revisionSetDigest) {
        fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'source_cutover_recovery_required');
      }
      recovering = true;
    }
    const store = await readTodoStore({ repoRoot, forWrite: true, now: options.now,
      ...(recovering ? {
        allowSourceCutoverRevisionSetDigest: revisionSetDigest,
        sourceCutoverRecoveryCapability: SOURCE_CUTOVER_RECOVERY_CAPABILITY,
      } : {}) });
    if (store.project_id !== projectId) fail('REVISION_SET_INVALID', 'revision_set_project_mismatch');
    const byPlan = new Map(store.members.map((member) => [member.descriptor.plan_key, member]));
    const activeDesired = revisions.map((revision) => {
      const member = byPlan.get(revision.plan_key);
      const genesis = member?.journal.events[0];
      const expectedGenesisSchema = ['lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2']
        .includes(revision.schema)
        ? 'lattice.todo_event.v4' : 'lattice.todo_event.v2';
      return member !== undefined
        && member.plan.plan_digest === revision.desired_plan.plan_digest
        && genesis.schema === expectedGenesisSchema
        && genesis.revision_digest === revision.revision_digest;
    });
    if (activeDesired.every(Boolean)) {
      const entries = revisions.map((revision) => ({
        revision,
        genesis: byPlan.get(revision.plan_key).journal.events[0],
      }));
      if (recovering) {
        for (const entry of entries.filter(({ revision }) => revision.schema === 'lattice.todo_revision.v2')) {
          const staged = await loadSourceCutoverStage(repoRoot,
            path.join(transaction, entry.revision.plan_key, 'source'), entry.revision);
          await publishSourceCutover(repoRoot, staged);
        }
        await rm(barrierAbsolute, { force: true });
        await fsyncDirectory(path.dirname(barrierAbsolute));
        await rm(transaction, { recursive: true, force: true });
      }
      return revisionSetResult(projectId, revisionSetDigest, entries, { recovered: true });
    }
    if (activeDesired.some(Boolean)) fail('REVISION_SET_RECOVERY_REQUIRED', 'partial_manifest_activation');

    const prepared = [];
    for (const revision of revisions) {
      const previous = byPlan.get(revision.plan_key);
      if (previous === undefined) fail('STORE_INCONSISTENT', 'plan_not_active');
      if (previous.plan.plan_digest !== revision.predecessor.plan_digest
        || previous.plan.plan_version !== revision.predecessor.plan_version
        || previous.journal.events.at(-1).event_digest !== revision.predecessor.journal_head_digest) {
        fail('STORE_WRITE_CONFLICT', 'stale_predecessor');
      }
      const phaseRevision = ['lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2']
        .includes(revision.schema);
      const activeGenesis = previous.journal.events[0];
      if (!phaseRevision) {
        const predecessorReconciliationDigest = activeGenesis.schema === 'lattice.todo_event.v2'
          ? activeGenesis.reconciliation_digest
          : todoLegacyReconciliationDigest({
            planDigest: previous.plan.plan_digest,
            journalHeadDigest: previous.journal.events.at(-1).event_digest,
          });
        if (revision.reconciliation.predecessor_reconciliation_digest
          !== predecessorReconciliationDigest) fail('STORE_WRITE_CONFLICT', 'stale_predecessor');
        await rejectCompetingRevisionTransaction(repoRoot, revision);
      }
      const cutoverImages = revision.schema === 'lattice.todo_revision.v2' && !recovering
        ? await buildSourceCutoverImages(repoRoot, revision) : null;
      if (revision.schema === 'lattice.todo_revision.v1') {
        await verifyRevisionSources(repoRoot, revision.source_inventory);
      }
      verifyPlanNarrativeAnchors(repoRoot, revision.desired_plan, previous.plan);
      const stateMigration = stateMigrationFor(previous, revision);
      const phaseStateMigration = phaseRevision ? phaseStateMigrationFor(previous, revision) : null;
      const commonGenesis = {
        previous_digest: revision.predecessor.journal_head_digest, actor: options.actor,
        recorded_at: options.recordedAt, provenance: options.provenance ?? null,
        state_migration: stateMigration, revision_digest: revision.revision_digest,
      };
      const genesis = phaseRevision
        ? buildPhaseRevisionGenesis(revision.desired_plan, {
          ...commonGenesis, phase_state_migration: phaseStateMigration,
        })
        : buildRevisionGenesis(revision.desired_plan, {
          ...commonGenesis, reconciliation_digest: revision.reconciliation.reconciliation_digest,
        });
      prepared.push({ revision, previous, stateMigration, phaseStateMigration, genesis, cutoverImages });
    }

    const desiredByPlan = new Map(prepared.map((entry) => [entry.revision.plan_key,
      entry.revision.desired_plan]));
    validateMergedGraph(store.members.map((member) => desiredByPlan.has(member.descriptor.plan_key)
      ? { ...member, plan: desiredByPlan.get(member.descriptor.plan_key) } : member));

    await ensureSafeStoreDirectory(repoRoot, transaction);
    const mixedPhaseSet = prepared.some(({ revision }) => ([
      'lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2',
    ].includes(revision.schema)));
    let marker = {
      schema: mixedPhaseSet
        ? 'lattice.todo_revision_set_transaction.v2' : 'lattice.todo_revision_set_transaction.v1',
      project_id: projectId,
      revision_set_digest: revisionSetDigest,
      entries: prepared.map(({ revision, stateMigration, phaseStateMigration, genesis }) => ({
        revision, state_migration: stateMigration,
        ...(phaseStateMigration === null ? {} : { phase_state_migration: phaseStateMigration }), genesis,
      })),
    };
    const markerAbsolute = path.join(transaction, 'marker.json');
    const existingMarker = await exactFileOrNull(markerAbsolute);
    if (existingMarker === null) await atomicWrite(markerAbsolute, canonicalLine(marker));
    else {
      const durable = parseRevisionSetMarker(existingMarker);
      const expectedIdentity = marker.entries.map(({ revision, state_migration: stateMigration,
        phase_state_migration: phaseStateMigration }) => ({
        revision, state_migration: stateMigration,
        ...(phaseStateMigration === undefined ? {} : { phase_state_migration: phaseStateMigration }),
      }));
      const durableIdentity = durable.entries.map(({ revision, state_migration: stateMigration,
        phase_state_migration: phaseStateMigration }) => ({
        revision, state_migration: stateMigration,
        ...(phaseStateMigration === undefined ? {} : { phase_state_migration: phaseStateMigration }),
      }));
      if (durable.project_id !== projectId || durable.revision_set_digest !== revisionSetDigest
        || canonicalizeTodoArtifact(durableIdentity) !== canonicalizeTodoArtifact(expectedIdentity)) {
        fail('REVISION_CONFLICT', 'revision_set_bytes_conflict');
      }
      marker = durable;
      for (const [index, entry] of prepared.entries()) entry.genesis = marker.entries[index].genesis;
    }
    await protocolStage(options, 'revision_set_marker_durable');

    const verifyEvidence = evidenceVerifier(store.manifest, repoRoot, true);
    const verifyImportSource = importSourceVerifier(repoRoot, true);
    for (const entry of prepared) {
      const { revision, genesis } = entry;
      const tasks = replay(revision.desired_plan, [genesis], {
        now: options.now ? new Date(options.now) : new Date(), verifyEvidence, verifyImportSource,
      });
      const snapshot = snapshotFor(revision.desired_plan, [genesis], tasks);
      const base = `${STORE_ROOT_REF}/plans/${revision.plan_key}/${revision.desired_plan.plan_version}`;
      entry.refs = {
        revision_ref: `${base}/revision.json`,
        plan_ref: `${base}/plan.json`,
        journal_ref: `${base}/journal/active.jsonl`,
        snapshot_ref: `${base}/snapshot.json`,
      };
      const staged = path.join(transaction, revision.plan_key);
      await publishRevisionArtifact(path.join(staged, 'revision.json'),
        path.resolve(repoRoot, entry.refs.revision_ref), canonicalLine(revision));
      await publishRevisionArtifact(path.join(staged, 'plan.json'),
        path.resolve(repoRoot, entry.refs.plan_ref), canonicalLine(revision.desired_plan));
      await publishRevisionArtifact(path.join(staged, 'active.jsonl'),
        path.resolve(repoRoot, entry.refs.journal_ref), canonicalLine(genesis));
      await publishRevisionArtifact(path.join(staged, 'snapshot.json'),
        path.resolve(repoRoot, entry.refs.snapshot_ref), canonicalLine(snapshot));
    }
    await protocolStage(options, 'revision_set_artifacts_durable');

    const stagedCutovers = [];
    if (prepared.some(({ revision }) => revision.schema === 'lattice.todo_revision.v2')) {
      const sourceRefs = new Set();
      const archiveRefs = new Set();
      for (const entry of prepared.filter(({ revision }) => revision.schema === 'lattice.todo_revision.v2')) {
        if (archiveRefs.has(entry.revision.source_cutover_batch.archive_ref)) {
          fail('REVISION_SET_INVALID', 'source_cutover_archive_conflict');
        }
        archiveRefs.add(entry.revision.source_cutover_batch.archive_ref);
        for (const operation of entry.revision.source_cutover_batch.operations) {
          if (sourceRefs.has(operation.source_ref)) {
            fail('REVISION_SET_INVALID', 'source_cutover_source_conflict');
          }
          sourceRefs.add(operation.source_ref);
        }
        const sourceTransaction = path.join(transaction, entry.revision.plan_key, 'source');
        if (!recovering) await stageSourceCutover(sourceTransaction, entry.revision, entry.cutoverImages);
        stagedCutovers.push(await loadSourceCutoverStage(repoRoot, sourceTransaction, entry.revision));
      }
      if (!recovering) {
        await atomicWrite(barrierAbsolute, canonicalLine({
          schema: 'lattice.todo_source_cutover_set_barrier.v1',
          revision_set_digest: revisionSetDigest,
          revision_digests: prepared.filter(({ revision }) => revision.schema === 'lattice.todo_revision.v2')
            .map(({ revision }) => revision.revision_digest),
        }));
        await protocolStage(options, 'revision_set_source_barrier_durable');
      }
      for (const [index, staged] of stagedCutovers.entries()) {
        await publishSourceCutover(repoRoot, staged);
        await protocolStage(options, `revision_set_source_published_${index}`);
      }
    }

    try {
      const currentManifest = await readArtifact(repoRoot, MANIFEST_REF, {
        code: 'STORE_INCONSISTENT', maxBytes: TODO_LIMITS.snapshotBytes, validate: validateTodoManifest,
      });
      if (currentManifest.manifest_digest !== store.manifest.manifest_digest) {
        fail('STORE_WRITE_CONFLICT', 'manifest_digest_changed');
      }
      for (const entry of prepared) {
        const descriptor = currentManifest.members.find(({ plan_key }) => plan_key === entry.revision.plan_key);
        if (descriptor === undefined
          || descriptor.active_plan_version !== entry.revision.predecessor.plan_version
          || descriptor.journal_head_digest !== entry.revision.predecessor.journal_head_digest) {
          fail('STORE_WRITE_CONFLICT', 'stale_predecessor');
        }
        Object.assign(descriptor, {
          active_plan_version: entry.revision.desired_plan.plan_version,
          plan_ref: entry.refs.plan_ref,
          journal_ref: entry.refs.journal_ref,
          snapshot_ref: entry.refs.snapshot_ref,
          topology_digest: entry.revision.desired_plan.topology_digest,
          journal_head_digest: entry.genesis.event_digest,
        });
      }
      currentManifest.manifest_digest = todoSelfDigest(currentManifest, 'manifest_digest');
      await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(currentManifest));
      await protocolStage(options, 'revision_set_manifest_activated');
    } catch (error) {
      if (stagedCutovers.length > 0 && error instanceof TodoStoreError) {
        let rolledBack = true;
        for (const staged of [...stagedCutovers].reverse()) {
          rolledBack = await rollbackSourceCutover(staged, barrierAbsolute, { removeBarrier: false })
            && rolledBack;
        }
        if (!rolledBack) fail('SOURCE_CUTOVER_RECOVERY_REQUIRED', 'rollback_incomplete');
        await rm(barrierAbsolute, { force: true });
        await fsyncDirectory(path.dirname(barrierAbsolute));
      }
      throw error;
    }
    if (stagedCutovers.length > 0) {
      await rm(barrierAbsolute, { force: true });
      await fsyncDirectory(path.dirname(barrierAbsolute));
      await protocolStage(options, 'revision_set_source_cleanup');
    }
    await rm(transaction, { recursive: true, force: true });
    return revisionSetResult(projectId, revisionSetDigest, prepared, { recovered: recovering });
  });
}

/** G5 revise primitive: topology changes only by publishing a successor version. */
export async function createSuccessorTodoPlan(options = {}) {
  requireWriter(options.writer, 'g5-authoring');
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  return withLock(repoRoot, async () => {
    const store = await readTodoStore({ repoRoot, forWrite: true, now: options.now });
    const previous = store.members.find(({ descriptor }) => descriptor.plan_key === options.planKey);
    if (!previous) fail('STORE_INCONSISTENT', 'plan_not_active');
    if (options.plan.predecessor_plan_digest !== previous.plan.plan_digest
      || options.plan.plan_version === previous.plan.plan_version) throw new TypeError('successor predecessor/version binding invalid');
    const plan = buildTodoPlan(options.plan);
    if (plan.project_id !== store.project_id || plan.plan_key !== previous.plan.plan_key) {
      throw new TypeError('successor identity must match active plan');
    }
    const schemaRank = new Map([
      ['lattice.todo_plan.v1', 1], ['lattice.todo_plan.v2', 2], ['lattice.todo_plan.v3', 3],
      ['lattice.todo_plan.v4', 4], ['lattice.todo_plan.v5', 5],
    ]);
    if (schemaRank.get(plan.schema) < schemaRank.get(previous.plan.schema)) {
      throw new TypeError(previous.plan.schema === 'lattice.todo_plan.v2'
        && plan.schema === 'lattice.todo_plan.v1'
        ? 'todo plan schema cannot regress from v2 to v1'
        : 'todo plan schema cannot regress');
    }
    verifyPlanNarrativeAnchors(repoRoot, plan, previous.plan);
    const migration = options.genesis.task_migration ?? [];
    const oldIds = previous.plan.tasks.map(({ task_id }) => task_id).sort();
    const migrationIds = migration.map(({ from_task_id }) => from_task_id).sort();
    if (canonicalizeTodoArtifact(oldIds) !== canonicalizeTodoArtifact(migrationIds)
      || new Set(migrationIds).size !== migrationIds.length) throw new TypeError('every predecessor task requires one migration entry');
    const newIds = new Set(plan.tasks.map(({ task_id }) => task_id));
    if (migration.some(({ to_task_id }) => to_task_id !== 'removed' && !newIds.has(to_task_id))) {
      throw new TypeError('task migration targets missing successor task');
    }
    const genesis = buildPlanGenesis(plan, {
      ...options.genesis, previous_digest: previous.journal.events.at(-1).event_digest,
    });
    const prospective = store.members.map((member) => member === previous ? { ...member, plan } : member);
    validateMergedGraph(prospective);
    const base = `${STORE_ROOT_REF}/plans/${plan.plan_key}/${plan.plan_version}`;
    const planRef = `${base}/plan.json`; const journalRef = `${base}/journal/active.jsonl`; const snapshotRef = `${base}/snapshot.json`;
    try { await lstat(path.resolve(repoRoot, planRef)); fail('STORE_WRITE_CONFLICT', 'successor_version_exists'); }
    catch (error) { if (error instanceof TodoStoreError) throw error; if (error?.code !== 'ENOENT') throw error; }
    const tasks = replay(plan, [genesis], { now: options.now ? new Date(options.now) : new Date() });
    const snapshot = snapshotFor(plan, [genesis], tasks);
    // Required order: plan, genesis journal, then manifest activation. Snapshot is
    // prepared before activation so a newly active version is immediately writable.
    await atomicWrite(path.resolve(repoRoot, planRef), canonicalLine(plan));
    await atomicWrite(path.resolve(repoRoot, journalRef), canonicalLine(genesis));
    await atomicWrite(path.resolve(repoRoot, snapshotRef), canonicalLine(snapshot));
    Object.assign(previous.descriptor, {
      active_plan_version: plan.plan_version, plan_ref: planRef, journal_ref: journalRef,
      snapshot_ref: snapshotRef, topology_digest: plan.topology_digest,
      journal_head_digest: genesis.event_digest,
    });
    store.manifest.manifest_digest = todoSelfDigest(store.manifest, 'manifest_digest');
    await atomicWrite(path.resolve(repoRoot, MANIFEST_REF), canonicalLine(store.manifest));
    return { plan, genesis, snapshot };
  });
}
