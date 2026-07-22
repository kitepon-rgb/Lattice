import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat, mkdir, open, readFile, realpath, rename, rm,
} from 'node:fs/promises';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

import {
  canonicalizeTodoArtifact,
  digestTodoArtifact,
  exactRecord,
  isTodoDigest,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
  validateEvidenceDescriptor,
} from './todo-contracts.mjs';
import { projectTodoChainV1 } from './todo-chain.mjs';
import { ensureTodoDashboardActivity } from './todo-dashboard-registry.mjs';
import { resolveProjectIdentity } from './project-identity.mjs';
import { layoutTodoGantt } from './todo-gantt-layout.mjs';
import { loadTodoGanttPresentation } from './todo-gantt-presentation.mjs';
import { startTodoGanttLiveServer } from './todo-gantt-live.mjs';
import {
  renderTodoGanttHtml,
  TODO_GANTT_HTML_MAX_BYTES,
  TODO_GANTT_RENDERER_VERSION,
} from './todo-gantt-html.mjs';
import { verifyNarrativeAnchors } from './todo-narrative-anchor.mjs';
import {
  appendTodoEvent,
  applyPhaseTodoRevision,
  applyTodoRevision,
  applyTodoRevisionSet,
  createTodoStoreWriter,
  TodoStoreError,
  readTodoStore,
  readTodoStoreStable,
  rebuildTodoSnapshot,
  verifyEffectivePhaseTodoRevisionSources,
  verifyTodoRevisionSources,
} from './todo-store.mjs';
import {
  appendTodoExtraction,
  validateTodoExtraction,
} from './todo-migration.mjs';
import { projectTodoStatus } from './todo-status.mjs';
import {
  parseTodoSourceRef, todoLegacyReconciliationDigest, validatePhaseTodoRevision,
  validateTodoRevision, validateTodoRevisionSet,
} from './todo-revision.mjs';

const CLI_ERROR_SCHEMA = 'lattice.cli_error.v2';
const DEFAULT_GANTT_REF = '.lattice/generated/gantt.html';
const GANTT_DESCRIPTOR_SUFFIX = '.status.json';
const MAX_GANTT_DESCRIPTOR_BYTES = 65_536;
const MAX_MIGRATION_INPUT_BYTES = 8_388_608;
const ACTOR_ENV_KEYS = Object.freeze([
  'LATTICE_TODO_ACTOR_HOST',
  'LATTICE_TODO_ACTOR_SESSION',
  'LATTICE_TODO_ACTOR_AGENT',
]);

function usageFailure(stderr, argv) {
  const received = argv.length === 0 ? '(none)' : argv.join(' ').replace(/[\r\n]/gu, ' ');
  stderr.write(`lattice todo: unsupported command or arguments: ${received}\n`);
  return 2;
}

function typedFailure(stderr, error) {
  const payload = {
    schema: CLI_ERROR_SCHEMA,
    code: error.code,
    message: error.message,
  };
  if (error.detail !== null && typeof error.detail === 'object'
    && !Array.isArray(error.detail) && Object.keys(error.detail).length > 0) {
    payload.detail = error.detail;
  }
  stderr.write(`${JSON.stringify(payload)}\n`);
  return 1;
}

function resolveRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new TodoStoreError('REPO_UNRESOLVED', 'git_toplevel_unresolved', 'cwdのgit toplevelを解決できない');
  }
}

function selectMembers(store, requestedPlanKey) {
  if (requestedPlanKey === null) return store.members;
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === requestedPlanKey);
  if (member === undefined) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active');
  }
  return [member];
}

function taskRef(plan, taskId) {
  return { project_id: plan.project_id, plan_key: plan.plan_key, task_id: taskId };
}

function mergedTopology(store) {
  return {
    nodes: store.members.flatMap(({ plan }) => plan.tasks.map(({ task_id: taskId }) => taskRef(plan, taskId))),
    hard_edges: store.members.flatMap(({ plan }) => plan.hard_dependencies),
    joins: store.members.flatMap(({ plan }) => plan.joins),
  };
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function hasDuplicateJsonKey(node) {
  if (node?.type === 'object') {
    const keys = new Set();
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? [];
      if (keys.has(key?.value) || hasDuplicateJsonKey(value)) return true;
      keys.add(key?.value);
    }
  } else if (node?.type === 'array') {
    return (node.children ?? []).some(hasDuplicateJsonKey);
  }
  return false;
}

async function readMigrationInput(repoRoot, inputRef) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, inputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_missing', undefined, { input_ref: inputRef });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'unsafe_input_path', undefined, { input_ref: inputRef });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_alias_or_escape', undefined, { input_ref: inputRef });
  }
  if (stats.size > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('INVALID_JSON', 'invalid_utf8');
  }
  const parseErrors = [];
  const tree = parseTree(text, parseErrors, { allowTrailingComma: false, disallowComments: true });
  if (parseErrors.length > 0 || tree === undefined) {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (hasDuplicateJsonKey(tree)) throw new TodoStoreError('INVALID_JSON', 'duplicate_key');
  let extraction;
  try { extraction = JSON.parse(text); } catch {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (!validateTodoExtraction(extraction)) {
    throw new TodoStoreError('INVALID_TODO_EXTRACTION', 'schema_invalid');
  }
  return extraction;
}

async function readRevisionInput(repoRoot, inputRef, {
  validate = validateTodoRevision,
  invalidCode = 'REVISION_INVALID',
  invalidReason = 'revision_schema_or_digest_invalid',
} = {}) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, inputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_missing', undefined, { input_ref: inputRef });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'unsafe_input_path', undefined, { input_ref: inputRef });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_alias_or_escape', undefined, { input_ref: inputRef });
  }
  if (stats.size > MAX_MIGRATION_INPUT_BYTES) throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_MIGRATION_INPUT_BYTES) throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('INVALID_JSON', 'invalid_utf8');
  }
  if (!text.endsWith('\n') || text.startsWith('\uFEFF') || text.includes('\r')
    || text.slice(0, -1).includes('\n')) {
    throw new TodoStoreError(invalidCode, 'non_canonical_revision_bytes');
  }
  const parseErrors = [];
  const tree = parseTree(text.slice(0, -1), parseErrors, { allowTrailingComma: false, disallowComments: true });
  if (parseErrors.length > 0 || tree === undefined) throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  if (hasDuplicateJsonKey(tree)) throw new TodoStoreError('INVALID_JSON', 'duplicate_key');
  let revision;
  try { revision = JSON.parse(text.slice(0, -1)); } catch {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (!validate(revision)) throw new TodoStoreError(invalidCode, invalidReason);
  if (text !== `${canonicalizeTodoArtifact(revision)}\n`) {
    throw new TodoStoreError(invalidCode, 'non_canonical_revision_bytes');
  }
  return revision;
}

async function readEvidenceInput(repoRoot, inputRef) {
  if (!isTodoRef(inputRef)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, inputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_missing', undefined, { input_ref: inputRef });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'unsafe_input_path', undefined, { input_ref: inputRef });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_alias_or_escape', undefined, { input_ref: inputRef });
  }
  if (stats.size > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('INVALID_JSON', 'invalid_utf8');
  }
  if (text.startsWith('\uFEFF') || text.includes('\r')) {
    throw new TodoStoreError('INVALID_JSON', 'non_portable_json_bytes');
  }
  const parseErrors = [];
  const tree = parseTree(text, parseErrors, { allowTrailingComma: false, disallowComments: true });
  if (parseErrors.length > 0 || tree === undefined) {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (hasDuplicateJsonKey(tree)) throw new TodoStoreError('INVALID_JSON', 'duplicate_key');
  let descriptor;
  try { descriptor = JSON.parse(text); } catch {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (!validateEvidenceDescriptor(descriptor)) {
    throw new TodoStoreError('INVALID_EVIDENCE', 'schema_invalid');
  }
  return descriptor;
}

function mutationActor(env) {
  const entries = ACTOR_ENV_KEYS.map((key) => ({ key, value: env[key] }));
  const missingEnvironment = entries
    .filter(({ value }) => typeof value !== 'string' || value.length === 0)
    .map(({ key }) => key);
  const invalidEnvironment = entries
    .filter(({ value }) => typeof value === 'string' && value.length > 0 && !isTodoIdentifier(value))
    .map(({ key }) => key);
  if (missingEnvironment.length > 0 || invalidEnvironment.length > 0) {
    throw new TodoStoreError('ACTOR_UNRESOLVED', 'actor_environment_invalid', undefined, {
      required_environment: ACTOR_ENV_KEYS,
      missing_environment: missingEnvironment,
      invalid_environment: invalidEnvironment,
      next_action: 'set_required_actor_environment_and_retry',
    });
  }
  return { host: entries[0].value, session: entries[1].value, agent: entries[2].value };
}

async function mutate({ repoRoot, env, planKey, taskId, kind, payload, evidenceRef }) {
  const actor = mutationActor(env);
  const evidence = evidenceRef === null ? null : await readEvidenceInput(repoRoot, evidenceRef);
  let eventPayload = payload;
  if (kind === 'done' && payload === 'authored') eventPayload = { evidence };
  if (kind === 'done' && payload === 'evidence_promotion') {
    eventPayload = { done_mode: 'evidence_promotion', imported: true, evidence };
  }
  const { event, snapshot } = await appendTodoEvent({
    repoRoot,
    writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    planKey,
    event: { kind, task_id: taskId, actor, payload: eventPayload },
  });
  const task = snapshot.tasks.find(({ task_id: current }) => current === taskId);
  const result = {
    schema: 'lattice.todo_mutation_result.v1',
    project_id: event.project_id,
    plan_key: event.plan_key,
    plan_version: event.plan_version,
    task_id: event.task_id,
    kind: event.kind,
    sequence: event.sequence,
    event_digest: event.event_digest,
    journal_head_digest: event.event_digest,
    snapshot_digest: snapshot.snapshot_digest,
    status: task.status,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function startTask({ repoRoot, env, planKey, taskId, overrideReason, parallelFrontier }) {
  const projection = projectTodoStatus(await readTodoStore({ repoRoot }));
  const targetReady = projection.next_ready.some((task) => (
    task.plan_key === planKey && task.task_id === taskId
  ));
  if (parallelFrontier && !targetReady) {
    throw new TodoStoreError('PARALLEL_DISPATCH_INVALID', 'parallel_frontier_not_applicable');
  }
  if (targetReady && projection.active_set.length === 0 && projection.next_ready.length > 1
    && overrideReason === null && !parallelFrontier) {
    throw new TodoStoreError('PARALLEL_DISPATCH_REQUIRED', 'parallel_frontier_requires_declaration',
      undefined, {
        ready_count: projection.next_ready.length,
        frontier_digest: projection.dispatch_frontier.frontier_digest,
        parallel_start_flag: projection.dispatch_frontier.parallel_start_flag,
        serial_reason_flag: '--override-reason',
      });
  }
  return mutate({ repoRoot, env, planKey, taskId, kind: 'start',
    payload: { override_reason: overrideReason }, evidenceRef: null });
}

function validatePhaseDecisionInput(value, outcome) {
  const keys = outcome === 'accept'
    ? ['schema', 'review_event_digest', 'decision_evidence', 'evidence_slots', 'input_digest']
    : ['schema', 'review_event_digest', 'reason', 'decision_evidence', 'input_digest'];
  return exactRecord(value, keys) && value.schema === `lattice.phase_${outcome}_input.v1`
    && isTodoDigest(value.review_event_digest) && validateEvidenceDescriptor(value.decision_evidence)
    && (outcome === 'accept'
      ? Array.isArray(value.evidence_slots) && value.evidence_slots.length > 0
        && value.evidence_slots.every((entry) => exactRecord(entry, ['slot_id', 'evidence'])
          && isTodoIdentifier(entry.slot_id) && validateEvidenceDescriptor(entry.evidence))
        && value.evidence_slots.every((entry, index) => index === 0
          || value.evidence_slots[index - 1].slot_id < entry.slot_id)
      : typeof value.reason === 'string' && value.reason.length > 0)
    && isTodoDigest(value.input_digest) && value.input_digest === todoSelfDigest(value, 'input_digest');
}

async function phaseDecision({ repoRoot, env, planKey, phaseId, outcome, inputRef }) {
  const input = await readRevisionInput(repoRoot, inputRef, {
    validate: (value) => validatePhaseDecisionInput(value, outcome),
    invalidCode: 'PHASE_DECISION_INVALID', invalidReason: 'phase_decision_schema_or_digest_invalid',
  });
  const payload = outcome === 'accept'
    ? { review_event_digest: input.review_event_digest, decision_evidence: input.decision_evidence,
      evidence_slots: input.evidence_slots }
    : { review_event_digest: input.review_event_digest, reason: input.reason,
      decision_evidence: input.decision_evidence };
  return phaseMutation({ repoRoot, env, planKey, phaseId, kind: `phase_${outcome}`, payload });
}

async function phaseMutation({ repoRoot, env, planKey, phaseId, kind, payload }) {
  const { event, snapshot } = await appendTodoEvent({
    repoRoot, writer: createTodoStoreWriter({ caller: 'g5-authoring' }), planKey,
    event: { kind, phase_id: phaseId, actor: mutationActor(env), payload },
  });
  const phase = snapshot.phases?.find(({ phase_id: current }) => current === phaseId);
  if (phase === undefined) throw new TodoStoreError('STORE_INCONSISTENT', 'phase_not_active');
  const result = {
    schema: 'lattice.phase_mutation_result.v1', project_id: event.project_id,
    plan_key: event.plan_key, plan_version: event.plan_version, phase_id: event.phase_id,
    kind: event.kind, sequence: event.sequence, event_digest: event.event_digest,
    journal_head_digest: event.event_digest, snapshot_digest: snapshot.snapshot_digest,
    status: phase.status, result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function phaseStatus({ repoRoot, planKey }) {
  const store = await readTodoStore({ repoRoot });
  const [member] = selectMembers(store, planKey);
  if (!['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(member.plan.schema)) {
    throw new TodoStoreError('PHASE_UNAVAILABLE', 'plan_has_no_phase_contract');
  }
  const result = {
    schema: 'lattice.phase_status_result.v1', project_id: store.project_id,
    plan_key: member.plan.plan_key, plan_version: member.plan.plan_version,
    journal_head_digest: member.journal.events.at(-1).event_digest,
    phases: member.snapshot.phases, result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function migrate({ repoRoot, inputRef }) {
  const extraction = await readMigrationInput(repoRoot, inputRef);
  const imported = await appendTodoExtraction({ repoRoot, extraction });
  const registered = extraction.tasks.filter(({ disposition }) => disposition.startsWith('register_'));
  const result = {
    schema: 'lattice.todo_migrate_result.v1',
    project_id: imported.plan.project_id,
    plan_key: imported.plan.plan_key,
    plan_version: imported.plan.plan_version,
    extraction_digest: extraction.extraction_digest,
    imported_task_count: registered.length,
    completed_task_count: extraction.tasks.filter(({ disposition }) => disposition === 'register_done').length,
    plan_ref: imported.descriptor.plan_ref,
    journal_ref: imported.descriptor.journal_ref,
    snapshot_ref: imported.descriptor.snapshot_ref,
    topology_digest: imported.plan.topology_digest,
    journal_head_digest: imported.events.at(-1).event_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function revise({ repoRoot, env, planKey, inputRef }) {
  const revision = await readRevisionInput(repoRoot, inputRef);
  if (revision.plan_key !== planKey) {
    throw new TodoStoreError('REVISION_INVALID', 'requested_plan_mismatch');
  }
  return applyTodoRevision({
    repoRoot, writer: createTodoStoreWriter({ caller: 'g5-authoring' }), revision,
    actor: mutationActor(env), recordedAt: new Date().toISOString(),
  });
}

async function reviseSet({ repoRoot, env, inputRef }) {
  const revisionSet = await readRevisionInput(repoRoot, inputRef, {
    validate: validateTodoRevisionSet,
    invalidCode: 'REVISION_SET_INVALID',
    invalidReason: 'revision_set_schema_invalid',
  });
  return applyTodoRevisionSet({
    repoRoot, writer: createTodoStoreWriter({ caller: 'g5-authoring' }), revisionSet,
    actor: mutationActor(env), recordedAt: new Date().toISOString(),
  });
}

async function revisePhase({ repoRoot, env, planKey, inputRef }) {
  const revision = await readRevisionInput(repoRoot, inputRef, {
    validate: validatePhaseTodoRevision, invalidCode: 'REVISION_INVALID',
    invalidReason: 'phase_revision_schema_or_digest_invalid',
  });
  if (revision.plan_key !== planKey) throw new TodoStoreError('REVISION_INVALID', 'requested_plan_mismatch');
  return applyPhaseTodoRevision({ repoRoot, writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    revision, actor: mutationActor(env), recordedAt: new Date().toISOString() });
}

async function status({ repoRoot }) {
  return projectTodoStatus(await readTodoStore({ repoRoot }));
}

async function readNarrative(repoRoot, ref) {
  const canonicalRoot = await realpath(repoRoot);
  const source = parseTodoSourceRef(ref);
  const fileRef = source?.path ?? ref;
  const absolute = path.resolve(canonicalRoot, fileRef);
  if (!within(canonicalRoot, absolute)) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_path_outside_repo', undefined, { ref });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_missing', undefined, { ref });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'unsafe_narrative_path', undefined, { ref });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_path_alias_or_escape', undefined, { ref });
  }
  const fileBytes = await readFile(resolved);
  let bytes = fileBytes;
  if (source !== null) {
    const lines = [];
    let start = 0;
    for (let index = 0; index <= fileBytes.length; index += 1) {
      if (index === fileBytes.length || fileBytes[index] === 0x0a) {
        lines.push(fileBytes.subarray(start, index));
        start = index + 1;
      }
    }
    bytes = lines[source.line - 1];
    if (bytes === undefined) {
      throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_line_missing', undefined, { ref });
    }
  }
  let markdown;
  try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_invalid_utf8', undefined, { ref });
  }
  return { markdown, content_digest: createHash('sha256').update(bytes).digest('hex') };
}

async function loadNarratives(store, repoRoot) {
  const content = new Map();
  const bindings = [];
  const narratives = [];
  for (const member of store.members) for (const task of member.plan.tasks) {
    const ref = taskRef(member.plan, task.task_id);
    if (task.narrative_ref === null) {
      bindings.push({ ...ref, narrative_ref: null, content_digest: null });
      narratives.push({ ref, markdown: '', narrative_ref: null, content_digest: null });
      continue;
    }
    let loaded = content.get(task.narrative_ref);
    if (loaded === undefined) {
      loaded = await readNarrative(repoRoot, task.narrative_ref);
      content.set(task.narrative_ref, loaded);
    }
    bindings.push({ ...ref, narrative_ref: task.narrative_ref, content_digest: loaded.content_digest });
    narratives.push({ ref, markdown: loaded.markdown, narrative_ref: task.narrative_ref,
      content_digest: loaded.content_digest });
  }
  return { narratives, bindings };
}

async function resolveOutput(repoRoot, outputRef) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, outputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('OUTPUT_PATH_INVALID', 'output_path_outside_repo', undefined, { output_ref: outputRef });
  }
  let cursor = path.dirname(absolute);
  const missing = [];
  while (cursor !== canonicalRoot) {
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new TodoStoreError('OUTPUT_PATH_INVALID', 'unsafe_output_parent', undefined, { output_ref: outputRef });
      }
      const resolved = await realpath(cursor);
      if (resolved !== cursor || !within(canonicalRoot, resolved)) {
        throw new TodoStoreError('OUTPUT_PATH_INVALID', 'output_parent_alias_or_escape', undefined, { output_ref: outputRef });
      }
      break;
    } catch (error) {
      if (error instanceof TodoStoreError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      missing.push(cursor);
      cursor = path.dirname(cursor);
    }
  }
  let target;
  try { target = await lstat(absolute); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (target !== undefined && (target.isSymbolicLink() || !target.isFile())) {
    throw new TodoStoreError('OUTPUT_PATH_INVALID', 'unsafe_output_target', undefined, { output_ref: outputRef });
  }
  return { absolute, missing, target };
}

async function atomicWriteOutput(repoRoot, outputRef, html) {
  const { absolute } = await resolveOutput(repoRoot, outputRef);
  await mkdir(path.dirname(absolute), { recursive: true });
  // Re-resolve after mkdir so a raced alias cannot redirect the write.
  const checked = await resolveOutput(repoRoot, outputRef);
  const temporary = path.join(path.dirname(checked.absolute),
    `.${path.basename(checked.absolute)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(html, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, checked.absolute);
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

function ganttDescriptorRef(outputRef) {
  return `${outputRef}${GANTT_DESCRIPTOR_SUFFIX}`;
}

function validateGanttArtifactDescriptor(value) {
  return exactRecord(value, [
    'schema', 'project_id', 'output_ref', 'manifest_digest', 'renderer_version',
    'html_digest', 'artifact_digest',
  ]) && value.schema === 'lattice.todo_gantt_artifact.v1'
    && isTodoIdentifier(value.project_id) && isTodoRef(value.output_ref)
    && isTodoDigest(value.manifest_digest)
    && typeof value.renderer_version === 'string'
    && /^lattice\.todo_gantt_renderer\.v[1-9][0-9]*$/u.test(value.renderer_version)
    && isTodoDigest(value.html_digest) && isTodoDigest(value.artifact_digest)
    && value.artifact_digest === todoSelfDigest(value, 'artifact_digest');
}

async function readOptionalOutput(repoRoot, outputRef, maxBytes) {
  const resolved = await resolveOutput(repoRoot, outputRef);
  if (resolved.target === undefined) return null;
  if (resolved.target.size > maxBytes) {
    throw new TodoStoreError('GANTT_ARTIFACT_INVALID', 'artifact_size_limit_exceeded', undefined,
      { output_ref: outputRef });
  }
  return readFile(resolved.absolute);
}

function parseGanttDescriptor(bytes, descriptorRef) {
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    if (`${canonicalizeTodoArtifact(value)}\n` !== text || !validateGanttArtifactDescriptor(value)) {
      throw new Error('non-canonical descriptor');
    }
  } catch {
    throw new TodoStoreError('GANTT_ARTIFACT_INVALID', 'descriptor_invalid', undefined,
      { descriptor_ref: descriptorRef });
  }
  return value;
}

export async function renderTodoGanttForProject({
  repoRoot, stable = false, displayName = null, env = process.env, readModel = null,
}) {
  const store = readModel
    ?? (stable ? await readTodoStoreStable({ repoRoot }) : await readTodoStore({ repoRoot }));
  const identity = displayName === null
    ? await resolveProjectIdentity({ repoRoot, projectId: store.project_id, env })
    : { displayName };
  const presentation = await loadTodoGanttPresentation({ repoRoot, readModel: store });
  const topology = mergedTopology(store);
  const chain = projectTodoChainV1(topology);
  const layout = layoutTodoGantt(store, chain);
  const narrative = await loadNarratives(store, repoRoot);
  const anchorOutcomes = verifyNarrativeAnchors({
    readModel: store,
    narratives: narrative.narratives,
  });
  const outcomesByRef = new Map(anchorOutcomes.map((entry) => [
    JSON.stringify([entry.ref.project_id, entry.ref.plan_key, entry.ref.task_id]), entry,
  ]));
  const narrativeBindings = narrative.bindings.map((entry) => {
    const key = JSON.stringify([entry.project_id, entry.plan_key, entry.task_id]);
    const anchor = outcomesByRef.get(key);
    return { ...entry, anchored: anchor.anchored, reason: anchor.reason };
  });
  const memberBindings = store.members.map((member) => ({
    plan_key: member.descriptor.plan_key,
    topology_digest: member.plan.topology_digest,
    journal_head_digest: member.journal.events.at(-1).event_digest,
  }));
  const metadata = {
    manifest_digest: store.manifest.manifest_digest,
    member_bindings: memberBindings,
    narrative_bindings_digest: digestTodoArtifact(narrativeBindings),
    presentation_digest: presentation.presentation_digest,
    chain_digest: digestTodoArtifact(chain),
    layout_digest: digestTodoArtifact(layout),
    renderer_version: TODO_GANTT_RENDERER_VERSION,
    project_display_name: identity.displayName,
  };
  const rendered = renderTodoGanttHtml({
    readModel: store,
    layout,
    narratives: narrative.narratives,
    anchorOutcomes,
    presentation,
    metadata,
  });
  return { store, metadata, memberBindings, rendered };
}

async function gantt({ repoRoot, outputRef, env }) {
  const { store, metadata, memberBindings, rendered } = await renderTodoGanttForProject({ repoRoot, env });
  await atomicWriteOutput(repoRoot, outputRef, rendered.html);
  const descriptor = { schema: 'lattice.todo_gantt_artifact.v1', project_id: store.project_id,
    output_ref: outputRef, manifest_digest: metadata.manifest_digest,
    renderer_version: TODO_GANTT_RENDERER_VERSION, html_digest: rendered.html_digest,
    artifact_digest: '' };
  descriptor.artifact_digest = todoSelfDigest(descriptor, 'artifact_digest');
  await atomicWriteOutput(repoRoot, ganttDescriptorRef(outputRef),
    `${canonicalizeTodoArtifact(descriptor)}\n`);
  const result = {
    schema: 'lattice.todo_gantt_result.v1',
    project_id: store.project_id,
    output_ref: outputRef,
    manifest_digest: metadata.manifest_digest,
    member_bindings: memberBindings,
    narrative_bindings_digest: metadata.narrative_bindings_digest,
    chain_digest: metadata.chain_digest,
    layout_digest: metadata.layout_digest,
    renderer_version: TODO_GANTT_RENDERER_VERSION,
    html_digest: rendered.html_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function ganttStatus({ repoRoot, outputRef, env }) {
  const descriptorRef = ganttDescriptorRef(outputRef);
  const [htmlBytes, descriptorBytes] = await Promise.all([
    readOptionalOutput(repoRoot, outputRef, TODO_GANTT_HTML_MAX_BYTES),
    readOptionalOutput(repoRoot, descriptorRef, MAX_GANTT_DESCRIPTOR_BYTES),
  ]);
  if ((htmlBytes === null) !== (descriptorBytes === null)) {
    throw new TodoStoreError('GANTT_ARTIFACT_INVALID', 'artifact_pair_incomplete', undefined,
      { output_ref: outputRef, descriptor_ref: descriptorRef });
  }
  if (htmlBytes === null) {
    const store = await readTodoStore({ repoRoot });
    const result = { schema: 'lattice.todo_gantt_status_result.v1', project_id: store.project_id,
      output_ref: outputRef, descriptor_ref: descriptorRef, artifact_status: 'missing',
      current_manifest_digest: store.manifest.manifest_digest, artifact_manifest_digest: null,
      html_digest: null, renderer_version: null, result_digest: '' };
    result.result_digest = todoSelfDigest(result, 'result_digest');
    return result;
  }
  const descriptor = parseGanttDescriptor(descriptorBytes, descriptorRef);
  const htmlDigest = createHash('sha256').update(htmlBytes).digest('hex');
  if (descriptor.output_ref !== outputRef || descriptor.html_digest !== htmlDigest) {
    throw new TodoStoreError('GANTT_ARTIFACT_INVALID', 'artifact_digest_mismatch', undefined,
      { output_ref: outputRef, descriptor_ref: descriptorRef });
  }
  const current = await renderTodoGanttForProject({ repoRoot, env });
  if (descriptor.project_id !== current.store.project_id) {
    throw new TodoStoreError('GANTT_ARTIFACT_INVALID', 'artifact_project_mismatch', undefined,
      { output_ref: outputRef });
  }
  const artifactStatus = descriptor.renderer_version === TODO_GANTT_RENDERER_VERSION
    && descriptor.manifest_digest === current.metadata.manifest_digest
    && descriptor.html_digest === current.rendered.html_digest ? 'current' : 'stale';
  const result = { schema: 'lattice.todo_gantt_status_result.v1',
    project_id: current.store.project_id, output_ref: outputRef, descriptor_ref: descriptorRef,
    artifact_status: artifactStatus, current_manifest_digest: current.metadata.manifest_digest,
    artifact_manifest_digest: descriptor.manifest_digest, html_digest: descriptor.html_digest,
    renderer_version: descriptor.renderer_version, result_digest: '' };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function serveGantt({ repoRoot, port, stdout, env }) {
  const initialStore = await readTodoStoreStable({ repoRoot });
  const identity = await resolveProjectIdentity({ repoRoot, projectId: initialStore.project_id, env });
  const live = await startTodoGanttLiveServer({
    projectId: initialStore.project_id,
    displayName: identity.displayName,
    port,
    render: async () => {
      const { rendered, metadata } = await renderTodoGanttForProject({
        repoRoot, stable: true, displayName: identity.displayName,
      });
      return { html: rendered.html, head_digest: metadata.manifest_digest };
    },
    readHead: async () => (await readTodoStoreStable({ repoRoot })).manifest.manifest_digest,
  });
  const result = { schema: 'lattice.todo_gantt_live_result.v2', project_id: live.projectId,
    host: live.host, port: live.port, project_path: live.projectPath,
    url: live.url, events_url: live.eventsUrl };
  stdout.write(`${JSON.stringify(result)}\n`);
  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
  await live.close();
  return null;
}

async function ensureActiveProjectDashboard({ repoRoot, env }) {
  if (env.LATTICE_DASHBOARD_AUTOSTART === '0') return null;
  const actorIdentity = ACTOR_ENV_KEYS.map((key) => env[key]);
  if (!actorIdentity.every(isTodoIdentifier)) return null;
  const sessionId = env.LATTICE_TODO_ACTOR_SESSION;
  const store = await readTodoStoreStable({ repoRoot });
  let identity;
  try { identity = await resolveProjectIdentity({ repoRoot, projectId: store.project_id, env }); } catch (error) {
    throw new TodoStoreError(error?.code ?? 'PROJECT_IDENTITY_INVALID',
      'project_identity_resolve_failed', undefined, error?.detail ?? {});
  }
  try {
    return await ensureTodoDashboardActivity({
      repoRoot, projectId: store.project_id, displayName: identity.displayName, sessionId, env,
    });
  } catch (error) {
    throw new TodoStoreError(error?.code ?? 'DASHBOARD_DAEMON_UNAVAILABLE',
      'dashboard_daemon_ensure_failed', undefined, { project_id: store.project_id });
  }
}

async function verify({ repoRoot, requestedPlanKey }) {
  const store = await readTodoStore({ repoRoot });
  const members = selectMembers(store, requestedPlanKey);
  const verifiedSourceInventories = new Map();
  for (const member of members) {
    const unverified = member.tasks.find((task) => task.evidence_unverified);
    if (unverified !== undefined) {
      throw new TodoStoreError('STORE_INCONSISTENT', 'evidence_unverified', 'evidence_unverified', {
        plan_key: member.descriptor.plan_key,
        task_id: unverified.task_id,
      });
    }
    if (member.revision !== null) {
      switch (member.revision.schema) {
        case 'lattice.todo_revision.v1':
        case 'lattice.todo_revision.v2':
          await verifyTodoRevisionSources({ repoRoot, revision: member.revision });
          verifiedSourceInventories.set(member.descriptor.plan_key,
            member.revision.source_inventory);
          break;
        case 'lattice.phase_todo_revision.v1':
        case 'lattice.phase_todo_revision.v2':
        case 'lattice.phase_todo_revision.v3':
          verifiedSourceInventories.set(member.descriptor.plan_key,
            await verifyEffectivePhaseTodoRevisionSources({ repoRoot, member }));
          break;
        default:
          throw new TodoStoreError('REVISION_INVALID', 'revision_schema_or_digest_invalid');
      }
    }
  }
  const verifiedMembers = members.map((member) => {
    const reconciled = member.revision !== null;
    const sourceInventory = verifiedSourceInventories.get(member.descriptor.plan_key) ?? null;
    const phaseRevision = ['lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2',
      'lattice.phase_todo_revision.v3']
      .includes(member.revision?.schema);
    return {
      plan_key: member.descriptor.plan_key,
      plan_version: member.plan.plan_version,
      topology_digest: member.plan.topology_digest,
      journal_head_digest: member.journal.events.at(-1).event_digest,
      through_sequence: member.journal.events.at(-1).sequence,
      snapshot_stale: member.snapshot_stale,
      reconciliation_state: reconciled ? 'reconciled' : 'registered_unreconciled',
      revision_digest: reconciled ? member.revision.revision_digest : null,
      reconciliation_digest: reconciled
        ? phaseRevision && member.revision.schema !== 'lattice.phase_todo_revision.v3'
          ? member.revision.revision_digest : member.revision.reconciliation.reconciliation_digest
        : todoLegacyReconciliationDigest({ planDigest: member.plan.plan_digest,
          journalHeadDigest: member.journal.events.at(-1).event_digest }),
      source_inventory_count: reconciled
        ? sourceInventory.active.length + sourceInventory.excluded_tombstones.length : null,
      active_task_count: reconciled
        ? sourceInventory.active.length : null,
      excluded_tombstone_count: reconciled
        ? sourceInventory.excluded_tombstones.length : null,
    };
  });
  const result = {
    schema: 'lattice.todo_verify_result.v2',
    project_id: store.project_id,
    requested_plan_key: requestedPlanKey,
    verified_members: verifiedMembers,
    snapshot_stale: verifiedMembers.some((member) => member.snapshot_stale),
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function rebuildSnapshot({ repoRoot, planKey }) {
  // Read first so every typed validation failure happens before the rebuild writer is entered.
  const store = await readTodoStore({ repoRoot });
  const [member] = selectMembers(store, planKey);
  const snapshot = await rebuildTodoSnapshot({ repoRoot, planKey });
  const result = {
    schema: 'lattice.todo_snapshot_result.v1',
    project_id: store.project_id,
    plan_key: planKey,
    snapshot_ref: member.descriptor.snapshot_ref,
    through_sequence: snapshot.through_sequence,
    journal_head_digest: snapshot.journal_head_digest,
    snapshot_digest: snapshot.snapshot_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

/**
 * `lattice todo` namespace. Exact position, order, and argument count are part of
 * the public contract; usage failures never use a JSON envelope.
 */
export async function runTodoCli({ argv, cwd, stdout, stderr, env = process.env }) {
  if (!Array.isArray(argv) || typeof cwd !== 'string'
    || typeof stdout?.write !== 'function' || typeof stderr?.write !== 'function'
    || env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('runTodoCli optionsが不正');
  }

  let action = null;
  if ((argv.length === 1 && argv[0] === 'status')
    || (argv.length === 2 && argv[0] === 'status' && argv[1] === '--json')) {
    action = (repoRoot) => status({ repoRoot });
  } else if ((argv.length === 1 && argv[0] === 'verify')
    || (argv.length === 2 && argv[0] === 'verify' && argv[1] === '--json')) {
    action = (repoRoot) => verify({ repoRoot, requestedPlanKey: null });
  } else if ((argv.length === 3 || argv.length === 4) && argv[0] === 'verify'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && (argv.length === 3 || argv[3] === '--json')) {
    action = (repoRoot) => verify({ repoRoot, requestedPlanKey: argv[2] });
  } else if (argv.length === 4 && argv[0] === 'snapshot' && argv[1] === '--rebuild'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])) {
    action = (repoRoot) => rebuildSnapshot({ repoRoot, planKey: argv[3] });
  } else if (argv.length === 1 && argv[0] === 'gantt') {
    action = (repoRoot) => gantt({ repoRoot, outputRef: DEFAULT_GANTT_REF, env });
  } else if (argv.length === 3 && argv[0] === 'gantt' && argv[1] === '--out'
    && isTodoRef(argv[2])) {
    action = (repoRoot) => gantt({ repoRoot, outputRef: argv[2], env });
  } else if (argv.length === 2 && argv[0] === 'gantt' && argv[1] === 'status') {
    action = (repoRoot) => ganttStatus({ repoRoot, outputRef: DEFAULT_GANTT_REF, env });
  } else if (argv.length === 4 && argv[0] === 'gantt' && argv[1] === 'status'
    && argv[2] === '--out' && isTodoRef(argv[3])) {
    action = (repoRoot) => ganttStatus({ repoRoot, outputRef: argv[3], env });
  } else if (argv.length === 4 && argv[0] === 'gantt' && argv[1] === 'serve'
    && argv[2] === '--port' && /^(?:0|[1-9][0-9]{0,4})$/u.test(argv[3])
    && Number(argv[3]) <= 65_535) {
    action = (repoRoot) => serveGantt({ repoRoot, port: Number(argv[3]), stdout, env });
  } else if (argv.length === 3 && argv[0] === 'migrate' && argv[1] === '--input'
    && isTodoRef(argv[2])) {
    action = (repoRoot) => migrate({ repoRoot, inputRef: argv[2] });
  } else if (argv.length === 5 && argv[0] === 'revise'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--input' && isTodoRef(argv[4])) {
    action = (repoRoot) => revise({ repoRoot, env, planKey: argv[2], inputRef: argv[4] });
  } else if (argv.length === 3 && argv[0] === 'revise-set'
    && argv[1] === '--input' && isTodoRef(argv[2])) {
    action = (repoRoot) => reviseSet({ repoRoot, env, inputRef: argv[2] });
  } else if (argv.length === 5 && argv[0] === 'revise-phase'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--input' && isTodoRef(argv[4])) {
    action = (repoRoot) => revisePhase({ repoRoot, env, planKey: argv[2], inputRef: argv[4] });
  } else if (argv.length === 4 && argv[0] === 'phase' && argv[1] === 'status'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])) {
    action = (repoRoot) => phaseStatus({ repoRoot, planKey: argv[3] });
  } else if (argv.length === 8 && argv[0] === 'phase' && argv[1] === 'review'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])
    && argv[4] === '--phase' && isTodoIdentifier(argv[5])
    && argv[6] === '--reason' && argv[7].length > 0) {
    action = (repoRoot) => phaseMutation({ repoRoot, env, planKey: argv[3], phaseId: argv[5],
      kind: 'phase_review', payload: { reason: argv[7] } });
  } else if (argv.length === 8 && argv[0] === 'phase'
    && ['accept', 'reject'].includes(argv[1])
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])
    && argv[4] === '--phase' && isTodoIdentifier(argv[5])
    && argv[6] === '--input' && isTodoRef(argv[7])) {
    action = (repoRoot) => phaseDecision({ repoRoot, env, planKey: argv[3], phaseId: argv[5],
      outcome: argv[1], inputRef: argv[7] });
  } else if ((argv.length === 8 || argv.length === 10) && argv[0] === 'phase'
    && argv[1] === 'reopen' && argv[2] === '--plan' && isTodoIdentifier(argv[3])
    && argv[4] === '--phase' && isTodoIdentifier(argv[5])
    && argv[6] === '--reason' && argv[7].length > 0
    && (argv.length === 8 || (argv[8] === '--override-reason' && argv[9].length > 0))) {
    action = (repoRoot) => phaseMutation({ repoRoot, env, planKey: argv[3], phaseId: argv[5],
      kind: 'phase_reopen', payload: { reason: argv[7], override_reason: argv[9] ?? null } });
  } else if ((argv.length === 5 || argv.length === 6 || argv.length === 7) && argv[0] === 'start'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && (argv.length === 5 || (argv.length === 6 && argv[5] === '--parallel-frontier')
      || (argv.length === 7 && argv[5] === '--override-reason' && argv[6].length > 0))) {
    const overrideReason = argv.length === 7 ? argv[6] : null;
    action = (repoRoot) => startTask({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      overrideReason, parallelFrontier: argv.length === 6 });
  } else if (argv.length === 7 && argv[0] === 'block'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && argv[5] === '--reason' && argv[6].length > 0) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'block', payload: { reason: argv[6] }, evidenceRef: null });
  } else if (argv.length === 5 && argv[0] === 'unblock'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'unblock', payload: {}, evidenceRef: null });
  } else if (argv.length === 7 && argv[0] === 'done'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && argv[5] === '--evidence' && isTodoRef(argv[6])) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'done', payload: 'authored', evidenceRef: argv[6] });
  } else if (argv.length === 8 && argv[0] === 'evidence' && argv[1] === 'promote'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])
    && argv[4] === '--task' && isTodoIdentifier(argv[5])
    && argv[6] === '--evidence' && isTodoRef(argv[7])) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[3], taskId: argv[5],
      kind: 'done', payload: 'evidence_promotion', evidenceRef: argv[7] });
  } else if ((argv.length === 7 || argv.length === 9) && argv[0] === 'reopen'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && argv[5] === '--reason' && argv[6].length > 0
    && (argv.length === 7 || (argv[7] === '--override-reason' && argv[8].length > 0))) {
    const overrideReason = argv.length === 9 ? argv[8] : null;
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'reopen', payload: { reason: argv[6], override_reason: overrideReason }, evidenceRef: null });
  }
  if (action === null) return usageFailure(stderr, argv);

  try {
    const repoRoot = resolveRepoRoot(cwd);
    const manualServe = argv[0] === 'gantt' && argv[1] === 'serve';
    if (!manualServe) await ensureActiveProjectDashboard({ repoRoot, env });
    const result = await action(repoRoot);
    if (result !== null) stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof TodoStoreError || (typeof error?.code === 'string'
      && error.detail !== null && typeof error.detail === 'object')) return typedFailure(stderr, error);
    if (error instanceof TypeError) {
      return typedFailure(stderr, {
        code: 'CONTRACT_VIOLATION',
        message: error.message,
      });
    }
    return typedFailure(stderr, {
      code: 'INTERNAL_FAILURE',
      message: error?.constructor?.name ?? 'Error',
    });
  }
}
