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
import { TODO_GANTT_SCOPES } from './todo-gantt-scope.mjs';
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
  readTodoIndependenceArtifact,
  readTodoSeamProposalArtifact,
  readTodoStore,
  readTodoWitnessSet,
  todoWitnessRef,
  writeTodoWitnessSet,
  readTodoStoreStable,
  rebuildTodoSnapshot,
  writeTodoIndependenceArtifact,
  writeTodoSeamProposalArtifact,
  verifyEffectivePhaseTodoRevisionSources,
  verifyTodoRevisionSources,
} from './todo-store.mjs';
import {
  appendTodoExtraction,
  validateTodoExtraction,
} from './todo-migration.mjs';
import {
  computeReadyFrontier,
  projectTodoBindings,
  projectTodoStatus,
} from './todo-status.mjs';
import {
  TODO_INDEPENDENCE_PROJECTION_SCHEMA,
  explainTodoWitnessSet,
  isTodoIndependenceLegacyMarker,
  validateTodoIndependence,
  validateTodoIndependenceProjection,
} from './todo-independence-contracts.mjs';
import {
  collectWitnessSensorEvidence,
  compileTodoIndependence,
  migrateWitnessSetTaskIds,
  projectIndependenceFrontier,
} from './todo-independence.mjs';
import {
  selectIndependenceGuidance,
  selectSeamProposalGuidance,
} from './todo-independence-guidance.mjs';
import {
  buildSeamProposalQuerySet,
  collectSeamProposalEvidenceBundle,
} from './seam-proposal-queries.mjs';
import {
  SEAM_PROPOSAL_PROJECTION_SCHEMA,
  validateSeamProposalProjection,
} from './seam-proposal-contracts.mjs';
import { compileSeamProposalArtifact } from './seam-proposal.mjs';
import {
  parseTodoSourceRef, todoLegacyReconciliationDigest, validatePhaseTodoRevision,
  validateTodoRevision, validateTodoRevisionSet,
} from './todo-revision.mjs';

const CLI_ERROR_SCHEMA = 'lattice.cli_error.v2';
const DEFAULT_GANTT_REF = '.lattice/generated/gantt.html';
const GANTT_DESCRIPTOR_SUFFIX = '.status.json';
const MAX_GANTT_DESCRIPTOR_BYTES = 65_536;
const DEFAULT_GANTT_SCOPE = 'live';
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
  return readJsonInput(repoRoot, inputRef, {
    validate: validateEvidenceDescriptor, invalidCode: 'INVALID_EVIDENCE',
  });
}

async function readJsonInput(repoRoot, inputRef, { validate, invalidCode }) {
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
  if (!validate(descriptor)) {
    throw new TodoStoreError(invalidCode, 'schema_invalid');
  }
  return descriptor;
}

/** 安全読み取りとcanonical JSON規律を共有したまま、witness set契約で検証する。 */
async function readWitnessSetInput(repoRoot, inputRef) {
  let explained = null;
  const witnessSet = await readJsonInput(repoRoot, inputRef, {
    validate: (value) => {
      explained = explainTodoWitnessSet(value);
      return explained.valid;
    },
    invalidCode: 'INVALID_TODO_WITNESS_SET',
  }).catch((error) => {
    if (error?.code === 'INVALID_TODO_WITNESS_SET' && explained !== null) {
      throw new TodoStoreError('INVALID_TODO_WITNESS_SET', explained.reason, undefined, {
        input_ref: inputRef, path: explained.path,
      });
    }
    throw error;
  });
  return witnessSet;
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

async function mutate({
  repoRoot, env, planKey, taskId, kind, payload, evidenceRef, advisory = null,
}) {
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
  const task = snapshot.tasks.find(({ task_id: current }) => current === event.task_id);
  const result = {
    schema: 'lattice.todo_mutation_result.v2',
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
    advisory,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

/**
 * 着手しようとしているtaskについて、記録済みの独立性から助言を組む（ADR 0128 Decision 5）。
 *
 * 助言であって拒否ではない。ADR 0063のdispatch契約は変えない。ただし助言を計算できない
 * 状況——git HEADが読めない等——はsilent degradeせず、呼び出し側でstart自体を止める。
 */
async function startAdvisory({ repoRoot, store, projection, planKey, taskId }) {
  const artifact = await readTodoIndependenceArtifact({ repoRoot, store, planKey });
  if (artifact === null) {
    // 記録が無ければ鮮度を語る相手がいない。HEADを要求すると、commitがまだ無いrepoで
    // 「判定できない」でなく「startできない」になってしまう。
    return {
      coverage: 'missing',
      drift_intersecting: null,
      conflicts_with_active: [],
      uncovered_active_task_ids: projection.active_set
        .filter((task) => task.plan_key === planKey).map(({ task_id: id }) => id),
      self_unknowns: [{ kind: 'witness_missing', ref: 'no_independence_record' }],
      guidance: selectIndependenceGuidance({
        coverage: 'missing', taskDeclared: false, taskStale: false,
      }),
    };
  }
  // 記録があるなら鮮度の判定にHEADが要る。ここで読めないのは判定不能であり、
  // 助言なしで通してよい状態ではない。
  const currentBaseSha = currentHeadSha(repoRoot);
  const changedPaths = artifact.base_sha !== null && artifact.base_sha !== currentBaseSha
    ? changedPathsSince(repoRoot, artifact.base_sha) : null;
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === planKey);
  const projected = projectIndependenceFrontier({
    artifact,
    readyTaskIds: projection.next_ready
      .filter((task) => task.plan_key === planKey).map(({ task_id: id }) => id),
    activeTaskIds: projection.active_set
      .filter((task) => task.plan_key === planKey).map(({ task_id: id }) => id),
    plan: member?.plan ?? { plan_version: null, topology_digest: null },
    currentBaseSha,
    changedPaths,
  });
  const selfUnknowns = projected.frontier.unknown
    .find((entry) => entry.task_id === taskId)?.unknowns ?? [];
  const conflictsWithActive = projected.frontier.conflicts_with_active
    .filter((entry) => entry.ready_task_id === taskId)
    .map((entry) => ({
      active_task_id: entry.active_task_id,
      type: entry.type,
      detail: entry.detail,
      kind: entry.kind,
      severability: entry.severability,
    }));
  const readyConflict = projected.frontier.serialize_pairs
    .find((pair) => pair.task_ids.includes(taskId)) ?? null;
  const declared = !selfUnknowns.some(({ kind }) => kind === 'witness_missing');
  return {
    coverage: projected.coverage,
    drift_intersecting: projected.drift === null
      ? null : projected.drift.intersecting_task_ids.includes(taskId),
    conflicts_with_active: conflictsWithActive,
    uncovered_active_task_ids: projected.uncovered_active_task_ids,
    self_unknowns: selfUnknowns,
    guidance: selectIndependenceGuidance({
      coverage: projected.coverage,
      taskDeclared: declared,
      taskStale: selfUnknowns.some(({ kind }) => kind === 'record_stale'),
      contractSuperseded: isTodoIndependenceLegacyMarker(artifact),
      conflictWithActive: conflictsWithActive[0]?.severability ?? null,
      conflictBetweenReady: readyConflict?.severability ?? null,
    }),
  };
}

async function startTask({ repoRoot, env, planKey, taskId, overrideReason, parallelFrontier }) {
  const store = await readTodoStore({ repoRoot });
  const projection = projectTodoStatus(store);
  const readyTask = projection.next_ready.find((task) => (
    task.plan_key === planKey && task.task_id.toLowerCase() === taskId.toLowerCase()
  ));
  const targetReady = readyTask !== undefined;
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
  const resolvedTaskId = readyTask?.task_id ?? taskId;
  // 助言はjournalへ書く前に確定させる。計算できないならstart自体を止める。
  const advisory = await startAdvisory({
    repoRoot, store, projection, planKey, taskId: resolvedTaskId,
  });
  return mutate({ repoRoot, env, planKey, taskId: resolvedTaskId, kind: 'start',
    payload: { override_reason: overrideReason }, evidenceRef: null, advisory });
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

async function bindings({ repoRoot, requestedPlanKey }) {
  return projectTodoBindings(await readTodoStore({ repoRoot }), { requestedPlanKey });
}

function currentHeadSha(repoRoot) {
  let head;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new TodoStoreError('INDEPENDENCE_BASE_UNRESOLVED', 'git_head_unresolved');
  }
  if (!/^[0-9a-f]{40}$/u.test(head)) {
    throw new TodoStoreError('INDEPENDENCE_BASE_UNRESOLVED', 'git_head_invalid');
  }
  return head;
}

/**
 * `base_sha..HEAD`で変わったrepo相対pathを返す。
 *
 * baseがgit historyから到達できない場合（rebase・shallow等）はnullを返す。
 * 「変更なし」の空配列と「差分を確定できない」を同じ顔にしない——前者は記録の有効性を
 * 支える事実だが、後者は支えない（ADR 0128 Decision 4）。
 */
function changedPathsSince(repoRoot, baseSha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseSha}^{commit}`], {
      cwd: repoRoot, stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    return null;
  }
  let output;
  try {
    output = execFileSync('git', ['diff', '--name-only', '--no-renames', `${baseSha}..HEAD`], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return [...new Set(output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0))]
    .sort();
}

function requireCleanWorktree(repoRoot) {
  let porcelain;
  try {
    porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new TodoStoreError('INDEPENDENCE_BASE_UNRESOLVED', 'git_status_unresolved');
  }
  const dirty = porcelain.split('\n').filter((line) => line.trim().length > 0);
  if (dirty.length > 0) {
    // 未commitの観測を検証済み証拠として固定化しない（ADR 0127 Decision 3）。
    throw new TodoStoreError('INDEPENDENCE_WORKTREE_DIRTY', 'worktree_not_clean', undefined, {
      changed_entries: dirty.length,
      next_action: 'commit_or_stash_then_retry',
    });
  }
}

async function independenceCompile({ repoRoot, planKey, inputRef }) {
  const witnessSet = await readWitnessSetInput(repoRoot, inputRef);
  requireCleanWorktree(repoRoot);
  const baseSha = currentHeadSha(repoRoot);
  const store = await readTodoStore({ repoRoot });
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === planKey);
  if (!member) throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active', undefined, { plan_key: planKey });

  const artifact = compileTodoIndependence({
    witnessSet,
    plan: member.plan,
    baseSha,
    compiledAt: new Date().toISOString(),
    sensorEvidence: await collectWitnessSensorEvidence({ cwd: repoRoot, witnessSet }),
  });
  const { ref } = await writeTodoIndependenceArtifact({ repoRoot, artifact });

  const result = {
    schema: 'lattice.todo_independence_compile_result.v1',
    project_id: artifact.project_id,
    plan_key: artifact.plan_key,
    plan_version: artifact.plan_version,
    base_sha: artifact.base_sha,
    artifact_ref: ref,
    outcome: artifact.outcome,
    task_count: artifact.task_ids.length,
    conflict_count: artifact.conflicts.length,
    unknown_count: artifact.unknowns.length,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

/**
 * revision後のwitness宣言をtask migrationで写す（ADR 0128 Decision 6）。
 *
 * compileしないので証拠を固定化せず、dirty worktreeを拒否しない。
 * 想定運用は「移行 → commit → cleanな状態でcompile」である。
 */
async function independenceWitnessMigrate({ repoRoot, planKey }) {
  const store = await readTodoStore({ repoRoot });
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === planKey);
  if (!member) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active', undefined, { plan_key: planKey });
  }
  const witnessSet = await readTodoWitnessSet({ repoRoot, planKey });
  if (witnessSet === null) {
    throw new TodoStoreError('WITNESS_MIGRATION_UNAVAILABLE', 'witness_set_absent', undefined, {
      witness_ref: todoWitnessRef(planKey),
    });
  }
  const revision = member.revision;
  if (!revision || !Array.isArray(revision.task_migration)) {
    // revisionを経ていないplanには写す先が無い。「移行済み」と装わない。
    throw new TodoStoreError('WITNESS_MIGRATION_UNAVAILABLE', 'plan_has_no_revision', undefined, {
      plan_key: planKey, plan_version: member.plan.plan_version,
    });
  }

  const migration = migrateWitnessSetTaskIds({
    witnessSet,
    taskMigration: revision.task_migration,
    planTaskIds: member.plan.tasks.map(({ task_id: taskId }) => taskId),
  });
  const { ref } = await writeTodoWitnessSet({ repoRoot, witnessSet: migration.witnessSet });

  const result = {
    schema: 'lattice.todo_witness_migrate_result.v1',
    project_id: store.project_id,
    plan_key: planKey,
    plan_version: member.plan.plan_version,
    witness_ref: ref,
    migrated_count: migration.migrated_count,
    removed_count: migration.removed_count,
    unchanged_count: migration.unchanged_count,
    witness_set_digest: migration.witnessSet.witness_set_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function independence({ repoRoot, requestedPlanKey }) {
  const store = await readTodoStore({ repoRoot });
  if (requestedPlanKey !== null
    && !store.members.some(({ descriptor }) => descriptor.plan_key === requestedPlanKey)) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active', undefined, {
      plan_key: requestedPlanKey,
    });
  }
  const frontier = computeReadyFrontier(store);
  const readyPlanKeys = [...new Set(frontier.map(({ plan_key: key }) => key))].sort();
  // planを絞らない呼び出しではreadyがどのplanを指しているかで決める。readyが無い時は
  // 全planが候補になる。どちらの場合も候補が複数なら、片方だけ見せて答えたことにしない。
  // ここで黙ってnullへ倒すと、記録があるのにcoverage missingと報告してしまう。
  const candidatePlanKeys = readyPlanKeys.length > 0
    ? readyPlanKeys
    : store.members.map(({ descriptor }) => descriptor.plan_key).sort();
  if (requestedPlanKey === null && candidatePlanKeys.length > 1) {
    throw new TodoStoreError('INDEPENDENCE_PLAN_AMBIGUOUS', 'plan_selection_ambiguous', undefined, {
      plan_keys: candidatePlanKeys,
      ready_plan_keys: readyPlanKeys,
      next_action: 'rerun_with_plan_flag',
    });
  }
  const planKey = requestedPlanKey ?? candidatePlanKeys[0] ?? null;

  const currentBaseSha = currentHeadSha(repoRoot);
  const ready = frontier.filter((task) => task.plan_key === planKey);
  const member = planKey === null
    ? undefined : store.members.find(({ descriptor }) => descriptor.plan_key === planKey);
  const artifact = member === undefined
    ? null : await readTodoIndependenceArtifact({ repoRoot, store, planKey });
  const active = projectTodoStatus(store).active_set
    .filter((task) => task.plan_key === planKey);
  // HEADが進んでいる時だけdiffを取る。一致していれば宣言境界を見るまでもない。
  const changedPaths = artifact !== null && artifact.base_sha !== null
    && artifact.base_sha !== currentBaseSha
    ? changedPathsSince(repoRoot, artifact.base_sha) : null;

  const projected = projectIndependenceFrontier({
    artifact,
    readyTaskIds: ready.map(({ task_id: taskId }) => taskId),
    activeTaskIds: active.map(({ task_id: taskId }) => taskId),
    plan: member?.plan ?? { plan_version: null, topology_digest: null },
    currentBaseSha,
    changedPaths,
  });

  const result = {
    schema: TODO_INDEPENDENCE_PROJECTION_SCHEMA,
    project_id: store.project_id,
    plan_key: planKey,
    coverage: projected.coverage,
    compiled_base_sha: artifact?.base_sha ?? null,
    current_base_sha: currentBaseSha,
    plan_version: artifact?.plan_version ?? null,
    topology_digest: artifact?.topology_digest ?? null,
    active_task_ids: projected.active_task_ids,
    uncovered_active_task_ids: projected.uncovered_active_task_ids,
    drift: projected.drift,
    // planを読みに来た人にも、着手する人と同じ文言を返す（ADR 0130 Decision 1）。
    guidance: selectIndependenceGuidance({
      coverage: projected.coverage,
      // 旧契約markerはreadyが空でも「対象なし」へ隠さず、superseded guidanceを返す。
      readyCount: isTodoIndependenceLegacyMarker(artifact) ? null : ready.length,
      contractSuperseded: isTodoIndependenceLegacyMarker(artifact),
      taskDeclared: projected.frontier.unknown
        .every(({ unknowns }) => !unknowns.some(({ kind }) => kind === 'witness_missing')),
      taskStale: projected.frontier.unknown
        .some(({ unknowns }) => unknowns.some(({ kind }) => kind === 'record_stale')),
      conflictWithActive: projected.frontier.conflicts_with_active[0]?.severability ?? null,
      conflictBetweenReady: projected.frontier.serialize_pairs[0]?.severability ?? null,
    }),
    frontier: projected.frontier,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  if (!validateTodoIndependenceProjection(result)) {
    throw new TodoStoreError('INDEPENDENCE_PROJECTION_INVALID', 'independence_projection_invalid');
  }
  return result;
}

async function seamProposalCompile({ repoRoot, planKey }) {
  requireCleanWorktree(repoRoot);
  const currentBaseSha = currentHeadSha(repoRoot);
  const store = await readTodoStore({ repoRoot });
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === planKey);
  if (!member) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active', undefined, {
      plan_key: planKey,
    });
  }
  const independenceArtifact = await readTodoIndependenceArtifact({ repoRoot, store, planKey });
  if (independenceArtifact === null || !validateTodoIndependence(independenceArtifact)) {
    throw new TodoStoreError(
      'SEAM_PROPOSAL_COMPILE_UNAVAILABLE',
      independenceArtifact === null ? 'independence_artifact_absent' : 'independence_artifact_superseded',
      undefined,
      { next_action: 'compile_independence' },
    );
  }
  if (independenceArtifact.outcome !== 'compiled') {
    throw new TodoStoreError('SEAM_PROPOSAL_COMPILE_UNAVAILABLE', 'independence_outcome_not_compiled', undefined, {
      outcome: independenceArtifact.outcome,
      next_action: 'recompile_independence',
    });
  }
  if (independenceArtifact.base_sha !== currentBaseSha) {
    throw new TodoStoreError('SEAM_PROPOSAL_COMPILE_UNAVAILABLE', 'independence_artifact_stale', undefined, {
      independence_base_sha: independenceArtifact.base_sha,
      current_base_sha: currentBaseSha,
      next_action: 'recompile_independence',
    });
  }
  const witnessSet = await readTodoWitnessSet({ repoRoot, planKey });
  if (witnessSet === null) {
    throw new TodoStoreError('SEAM_PROPOSAL_COMPILE_UNAVAILABLE', 'witness_set_absent', undefined, {
      next_action: 'declare_witness_set_then_compile_independence',
    });
  }
  if (witnessSet.witness_set_digest !== independenceArtifact.witness_set_digest) {
    throw new TodoStoreError('SEAM_PROPOSAL_COMPILE_UNAVAILABLE', 'witness_set_changed', undefined, {
      next_action: 'recompile_independence',
    });
  }

  const { query_set: querySet } = buildSeamProposalQuerySet({
    conflictResources: independenceArtifact.conflict_resources,
  });
  const [sensorEvidence, proposalEvidence] = await Promise.all([
    collectWitnessSensorEvidence({ cwd: repoRoot, witnessSet }),
    collectSeamProposalEvidenceBundle({ cwd: repoRoot, querySet }),
  ]);
  const artifact = compileSeamProposalArtifact({
    independenceArtifact,
    witnessSet,
    plan: member.plan,
    compiledAt: new Date().toISOString(),
    sensorEvidence,
    evidence: proposalEvidence.evidence,
    rawCollected: proposalEvidence.raw_collected,
  });
  const { ref } = await writeTodoSeamProposalArtifact({ repoRoot, artifact });
  const verdictCounts = {
    seam_candidate: artifact.decisions.filter(({ verdict }) => verdict === 'seam_candidate').length,
    intentional_serial: artifact.decisions
      .filter(({ verdict }) => verdict === 'intentional_serial').length,
    unknown_requires_evidence: artifact.decisions
      .filter(({ verdict }) => verdict === 'unknown_requires_evidence').length,
  };
  const result = {
    schema: 'lattice.seam_proposal_compile_result.v1',
    project_id: artifact.project_id,
    plan_key: artifact.plan_key,
    plan_version: artifact.source_binding.plan_version,
    base_sha: artifact.source_binding.base_sha,
    artifact_ref: ref,
    component_count: artifact.decisions.length,
    conflict_resource_count: artifact.decisions
      .reduce((count, decision) => count + decision.conflicts.length, 0),
    verdict_counts: verdictCounts,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

function summarizeSeamProposalDecision(decision) {
  return {
    component_id: decision.component_id,
    verdict: decision.verdict,
    task_ids: decision.task_ids,
    conflicts: decision.conflicts.map(({
      resource_id: resourceId, kind, target, task_pairs: taskPairs,
    }) => ({
      resource_id: resourceId,
      kind,
      target,
      task_pairs: taskPairs,
    })),
    proposed_surfaces: decision.seam_candidate?.proposed_surfaces ?? [],
    affected_tests: decision.seam_candidate?.affected_tests ?? [],
    limits: decision.seam_candidate?.limits ?? [],
    reasons: decision.reasons,
    unknowns: decision.unknowns,
  };
}

async function seamProposal({ repoRoot, requestedPlanKey }) {
  const store = await readTodoStore({ repoRoot });
  if (requestedPlanKey !== null
    && !store.members.some(({ descriptor }) => descriptor.plan_key === requestedPlanKey)) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active', undefined, {
      plan_key: requestedPlanKey,
    });
  }
  const frontier = computeReadyFrontier(store);
  const readyPlanKeys = [...new Set(frontier.map(({ plan_key: key }) => key))].sort();
  const candidatePlanKeys = readyPlanKeys.length > 0
    ? readyPlanKeys
    : store.members.map(({ descriptor }) => descriptor.plan_key).sort();
  if (requestedPlanKey === null && candidatePlanKeys.length > 1) {
    throw new TodoStoreError('SEAM_PROPOSAL_PLAN_AMBIGUOUS', 'plan_selection_ambiguous', undefined, {
      plan_keys: candidatePlanKeys,
      ready_plan_keys: readyPlanKeys,
      next_action: 'rerun_with_plan_flag',
    });
  }
  const planKey = requestedPlanKey ?? candidatePlanKeys[0] ?? null;
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === planKey);
  const currentBaseSha = currentHeadSha(repoRoot);
  const independenceArtifact = member === undefined
    ? null : await readTodoIndependenceArtifact({ repoRoot, store, planKey });
  const artifact = member === undefined
    ? null : await readTodoSeamProposalArtifact({ repoRoot, store, planKey });

  let coverage = 'verified';
  if (artifact === null) coverage = 'missing';
  else {
    const binding = artifact.source_binding;
    const independenceMatches = independenceArtifact !== null
      && validateTodoIndependence(independenceArtifact)
      && independenceArtifact.schema === binding.independence_schema
      && independenceArtifact.result_digest === binding.independence_result_digest
      && independenceArtifact.witness_set_digest === binding.witness_set_digest
      && independenceArtifact.plan_version === binding.plan_version
      && independenceArtifact.topology_digest === binding.topology_digest
      && independenceArtifact.base_sha === binding.base_sha;
    const planMatches = member !== undefined
      && member.plan.plan_version === binding.plan_version
      && member.plan.topology_digest === binding.topology_digest;
    if (!independenceMatches || !planMatches) coverage = 'superseded';
    else if (binding.base_sha !== currentBaseSha) coverage = 'stale';
  }

  const components = artifact?.decisions.map(summarizeSeamProposalDecision) ?? [];
  const result = {
    schema: SEAM_PROPOSAL_PROJECTION_SCHEMA,
    project_id: store.project_id,
    plan_key: planKey,
    coverage,
    compiled_base_sha: artifact?.source_binding.base_sha ?? null,
    current_base_sha: currentBaseSha,
    plan_version: artifact?.source_binding.plan_version ?? null,
    topology_digest: artifact?.source_binding.topology_digest ?? null,
    independence_result_digest: artifact?.source_binding.independence_result_digest ?? null,
    compiled_at: artifact?.compiled_at ?? null,
    guidance: selectSeamProposalGuidance({ coverage }),
    component_count: artifact === null ? null : components.length,
    conflict_resource_count: artifact === null ? null : components
      .reduce((count, component) => count + component.conflicts.length, 0),
    components,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  if (!validateSeamProposalProjection(result)) {
    throw new TodoStoreError('SEAM_PROPOSAL_PROJECTION_INVALID', 'seam_proposal_projection_invalid');
  }
  return result;
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

// v2 records the scope the artifact was drawn at. Without it `gantt status`
// would re-render at the default scope and report a `--scope all` artifact as
// stale even though nothing in the store had moved.
function validateGanttArtifactDescriptor(value) {
  return exactRecord(value, [
    'schema', 'project_id', 'output_ref', 'manifest_digest', 'renderer_version',
    'scope', 'html_digest', 'artifact_digest',
  ]) && value.schema === 'lattice.todo_gantt_artifact.v2'
    && isTodoIdentifier(value.project_id) && isTodoRef(value.output_ref)
    && isTodoDigest(value.manifest_digest)
    && typeof value.renderer_version === 'string'
    && /^lattice\.todo_gantt_renderer\.v[1-9][0-9]*$/u.test(value.renderer_version)
    && TODO_GANTT_SCOPES.includes(value.scope)
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

/**
 * 図が描く全planについて独立性を投影する（ADR 0129 Decision 4）。
 *
 * Ganttは複数planを同時に描くので、単一plan前提の`todo independence`の曖昧判定は持ち込まない。
 * plan単位で記録を引き、記録が無いplanは投影を持たないまま通す——描けない事実を
 * 図の側で作り出さない。
 */
/**
 * live配信の更新検知に使うhead digest（ADR 0129 Decision 6）。
 *
 * manifest_digestだけでは、独立性の再compileもHEAD前進も検知できず画面が古いまま残る。
 * 同じ値を描画側と検知側で別々に組み立てると、更新されない状態が静かに再発するため、
 * 一つの関数だけが組む。
 */
export async function ganttLiveHeadDigest({ repoRoot, store }) {
  const [independence, seamProposals] = await Promise.all([
    independenceForGantt({ repoRoot, store }),
    seamProposalsForGantt({ repoRoot, store }),
  ]);
  return digestTodoArtifact({
    schema: 'lattice.todo_gantt_live_head.v1',
    manifest_digest: store.manifest.manifest_digest,
    independence: independence === null ? null : independence.map((entry) => ({
      plan_key: entry.plan_key,
      coverage: entry.coverage,
      frontier_digest: digestTodoArtifact(entry.frontier),
    })),
    seam_proposals: seamProposals.map((entry) => ({
      plan_key: entry.plan_key,
      coverage: entry.coverage,
      projection_digest: digestTodoArtifact(entry),
    })),
  });
}

async function independenceForGantt({ repoRoot, store }) {
  const frontier = computeReadyFrontier(store);
  const status = projectTodoStatus(store);
  let currentBaseSha = null;
  const projections = [];
  for (const member of store.members) {
    const planKey = member.plan.plan_key;
    const artifact = await readTodoIndependenceArtifact({ repoRoot, store, planKey });
    if (artifact === null) continue;
    // 記録があるplanが1つでもあれば鮮度の判定にHEADが要る。
    if (currentBaseSha === null) currentBaseSha = currentHeadSha(repoRoot);
    const changedPaths = artifact.base_sha !== null && artifact.base_sha !== currentBaseSha
      ? changedPathsSince(repoRoot, artifact.base_sha) : null;
    const projected = projectIndependenceFrontier({
      artifact,
      readyTaskIds: frontier.filter((task) => task.plan_key === planKey)
        .map(({ task_id: taskId }) => taskId),
      activeTaskIds: status.active_set.filter((task) => task.plan_key === planKey)
        .map(({ task_id: taskId }) => taskId),
      plan: member.plan,
      currentBaseSha,
      changedPaths,
    });
    projections.push({
      project_id: member.plan.project_id,
      plan_key: planKey,
      coverage: projected.coverage,
      frontier: projected.frontier,
    });
  }
  return projections.length === 0 ? null : projections;
}

/**
 * 図が描く全planのseam提案記録を読む。生成は行わず、記録が無いplanもmissing guidanceを
 * 持つ投影として残すので、「提案対象なし」と「まだ生成していない」を混同しない。
 */
async function seamProposalsForGantt({ repoRoot, store }) {
  let currentBaseSha = null;
  const projections = [];
  for (const member of store.members) {
    const planKey = member.plan.plan_key;
    const artifact = await readTodoSeamProposalArtifact({ repoRoot, store, planKey });
    if (artifact === null) {
      projections.push({
        project_id: member.plan.project_id,
        plan_key: planKey,
        coverage: 'missing',
        guidance: selectSeamProposalGuidance({ coverage: 'missing' }),
        component_count: null,
        conflict_resource_count: null,
        components: [],
      });
      continue;
    }

    if (currentBaseSha === null) currentBaseSha = currentHeadSha(repoRoot);
    const independenceArtifact = await readTodoIndependenceArtifact({ repoRoot, store, planKey });
    const binding = artifact.source_binding;
    const independenceMatches = independenceArtifact !== null
      && validateTodoIndependence(independenceArtifact)
      && independenceArtifact.schema === binding.independence_schema
      && independenceArtifact.result_digest === binding.independence_result_digest
      && independenceArtifact.witness_set_digest === binding.witness_set_digest
      && independenceArtifact.plan_version === binding.plan_version
      && independenceArtifact.topology_digest === binding.topology_digest
      && independenceArtifact.base_sha === binding.base_sha;
    const planMatches = member.plan.plan_version === binding.plan_version
      && member.plan.topology_digest === binding.topology_digest;
    const coverage = !independenceMatches || !planMatches ? 'superseded'
      : binding.base_sha !== currentBaseSha ? 'stale' : 'verified';
    const components = artifact.decisions.map(summarizeSeamProposalDecision);
    projections.push({
      project_id: member.plan.project_id,
      plan_key: planKey,
      coverage,
      guidance: selectSeamProposalGuidance({ coverage }),
      component_count: components.length,
      conflict_resource_count: components
        .reduce((count, component) => count + component.conflicts.length, 0),
      components,
    });
  }
  return projections;
}

export async function renderTodoGanttForProject({
  repoRoot, stable = false, displayName = null, env = process.env, readModel = null,
  scope = DEFAULT_GANTT_SCOPE,
}) {
  const store = readModel
    ?? (stable ? await readTodoStoreStable({ repoRoot }) : await readTodoStore({ repoRoot }));
  const identity = displayName === null
    ? await resolveProjectIdentity({ repoRoot, projectId: store.project_id, env })
    : { displayName };
  const presentation = await loadTodoGanttPresentation({ repoRoot, readModel: store });
  const topology = mergedTopology(store);
  const chain = projectTodoChainV1(topology);
  const [independence, seamProposals] = await Promise.all([
    independenceForGantt({ repoRoot, store }),
    seamProposalsForGantt({ repoRoot, store }),
  ]);
  const layout = layoutTodoGantt(store, chain, { scope, independence, seamProposals });
  // When the diagram hides history, the page also carries the full diagram so
  // the reader can bring it back in place. Nothing is hidden under `all`.
  const expandedLayout = layout.scope.folded_task_count === 0
    ? null : layoutTodoGantt(store, chain, {
      scope: 'all', independence, seamProposals,
    });
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
    folded_task_count: layout.scope.folded_task_count,
  };
  const rendered = renderTodoGanttHtml({
    readModel: store,
    layout,
    expandedLayout,
    narratives: narrative.narratives,
    anchorOutcomes,
    presentation,
    metadata,
  });
  return { store, metadata, memberBindings, rendered };
}

async function gantt({ repoRoot, outputRef, env, scope = DEFAULT_GANTT_SCOPE }) {
  const { store, metadata, memberBindings, rendered } = await renderTodoGanttForProject({
    repoRoot, env, scope,
  });
  await atomicWriteOutput(repoRoot, outputRef, rendered.html);
  const descriptor = { schema: 'lattice.todo_gantt_artifact.v2', project_id: store.project_id,
    output_ref: outputRef, manifest_digest: metadata.manifest_digest,
    renderer_version: TODO_GANTT_RENDERER_VERSION, scope, html_digest: rendered.html_digest,
    artifact_digest: '' };
  descriptor.artifact_digest = todoSelfDigest(descriptor, 'artifact_digest');
  await atomicWriteOutput(repoRoot, ganttDescriptorRef(outputRef),
    `${canonicalizeTodoArtifact(descriptor)}\n`);
  const result = {
    schema: 'lattice.todo_gantt_result.v1',
    project_id: store.project_id,
    output_ref: outputRef,
    scope,
    folded_task_count: metadata.folded_task_count,
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
      html_digest: null, renderer_version: null, scope: null, result_digest: '' };
    result.result_digest = todoSelfDigest(result, 'result_digest');
    return result;
  }
  const descriptor = parseGanttDescriptor(descriptorBytes, descriptorRef);
  const htmlDigest = createHash('sha256').update(htmlBytes).digest('hex');
  if (descriptor.output_ref !== outputRef || descriptor.html_digest !== htmlDigest) {
    throw new TodoStoreError('GANTT_ARTIFACT_INVALID', 'artifact_digest_mismatch', undefined,
      { output_ref: outputRef, descriptor_ref: descriptorRef });
  }
  // Re-render at the artifact's own scope: comparing a `--scope all` artifact
  // against a default-scope render would report a false `stale`.
  const current = await renderTodoGanttForProject({ repoRoot, env, scope: descriptor.scope });
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
    renderer_version: descriptor.renderer_version, scope: descriptor.scope, result_digest: '' };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function serveGantt({ repoRoot, port, stdout, env, scope = DEFAULT_GANTT_SCOPE }) {
  const initialStore = await readTodoStoreStable({ repoRoot });
  const identity = await resolveProjectIdentity({ repoRoot, projectId: initialStore.project_id, env });
  const live = await startTodoGanttLiveServer({
    projectId: initialStore.project_id,
    displayName: identity.displayName,
    port,
    render: async () => {
      const store = await readTodoStoreStable({ repoRoot });
      const { rendered } = await renderTodoGanttForProject({
        repoRoot, stable: true, displayName: identity.displayName, scope, readModel: store,
      });
      return { html: rendered.html, head_digest: await ganttLiveHeadDigest({ repoRoot, store }) };
    },
    readHead: async () => ganttLiveHeadDigest({
      repoRoot, store: await readTodoStoreStable({ repoRoot }),
    }),
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
  } else if ((argv.length === 1 && argv[0] === 'bindings')
    || (argv.length === 2 && argv[0] === 'bindings' && argv[1] === '--json')) {
    action = (repoRoot) => bindings({ repoRoot, requestedPlanKey: null });
  } else if ((argv.length === 3 || argv.length === 4) && argv[0] === 'bindings'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && (argv.length === 3 || argv[3] === '--json')) {
    action = (repoRoot) => bindings({ repoRoot, requestedPlanKey: argv[2] });
  } else if (argv.length === 5 && argv[0] === 'independence' && argv[1] === 'witness'
    && argv[2] === 'migrate' && argv[3] === '--plan' && isTodoIdentifier(argv[4])) {
    action = (repoRoot) => independenceWitnessMigrate({ repoRoot, planKey: argv[4] });
  } else if (argv.length === 6 && argv[0] === 'independence' && argv[1] === 'compile'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3]) && argv[4] === '--input') {
    action = (repoRoot) => independenceCompile({
      repoRoot, planKey: argv[3], inputRef: argv[5],
    });
  } else if ((argv.length === 1 && argv[0] === 'independence')
    || (argv.length === 2 && argv[0] === 'independence' && argv[1] === '--json')) {
    action = (repoRoot) => independence({ repoRoot, requestedPlanKey: null });
  } else if ((argv.length === 3 || argv.length === 4) && argv[0] === 'independence'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
  && (argv.length === 3 || argv[3] === '--json')) {
    action = (repoRoot) => independence({ repoRoot, requestedPlanKey: argv[2] });
  } else if (argv.length === 4 && argv[0] === 'seam-proposal' && argv[1] === 'compile'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])) {
    action = (repoRoot) => seamProposalCompile({ repoRoot, planKey: argv[3] });
  } else if ((argv.length === 1 && argv[0] === 'seam-proposal')
    || (argv.length === 2 && argv[0] === 'seam-proposal' && argv[1] === '--json')) {
    action = (repoRoot) => seamProposal({ repoRoot, requestedPlanKey: null });
  } else if ((argv.length === 3 || argv.length === 4) && argv[0] === 'seam-proposal'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && (argv.length === 3 || argv[3] === '--json')) {
    action = (repoRoot) => seamProposal({ repoRoot, requestedPlanKey: argv[2] });
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
  } else if (argv.length === 3 && argv[0] === 'gantt' && argv[1] === '--scope'
    && TODO_GANTT_SCOPES.includes(argv[2])) {
    action = (repoRoot) => gantt({ repoRoot, outputRef: DEFAULT_GANTT_REF, env, scope: argv[2] });
  } else if (argv.length === 3 && argv[0] === 'gantt' && argv[1] === '--out'
    && isTodoRef(argv[2])) {
    action = (repoRoot) => gantt({ repoRoot, outputRef: argv[2], env });
  } else if (argv.length === 5 && argv[0] === 'gantt' && argv[1] === '--out'
    && isTodoRef(argv[2]) && argv[3] === '--scope' && TODO_GANTT_SCOPES.includes(argv[4])) {
    action = (repoRoot) => gantt({ repoRoot, outputRef: argv[2], env, scope: argv[4] });
  } else if (argv.length === 2 && argv[0] === 'gantt' && argv[1] === 'status') {
    action = (repoRoot) => ganttStatus({ repoRoot, outputRef: DEFAULT_GANTT_REF, env });
  } else if (argv.length === 4 && argv[0] === 'gantt' && argv[1] === 'status'
    && argv[2] === '--out' && isTodoRef(argv[3])) {
    action = (repoRoot) => ganttStatus({ repoRoot, outputRef: argv[3], env });
  } else if (argv.length === 4 && argv[0] === 'gantt' && argv[1] === 'serve'
    && argv[2] === '--port' && /^(?:0|[1-9][0-9]{0,4})$/u.test(argv[3])
    && Number(argv[3]) <= 65_535) {
    action = (repoRoot) => serveGantt({ repoRoot, port: Number(argv[3]), stdout, env });
  } else if (argv.length === 6 && argv[0] === 'gantt' && argv[1] === 'serve'
    && argv[2] === '--port' && /^(?:0|[1-9][0-9]{0,4})$/u.test(argv[3])
    && Number(argv[3]) <= 65_535 && argv[4] === '--scope'
    && TODO_GANTT_SCOPES.includes(argv[5])) {
    action = (repoRoot) => serveGantt({
      repoRoot, port: Number(argv[3]), stdout, env, scope: argv[5],
    });
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
