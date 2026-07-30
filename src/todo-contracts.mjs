import { createHash } from 'node:crypto';
import { isCanonicalUtcTimestamp } from './timestamp-contract.mjs';

export const TODO_EVENT_KINDS = Object.freeze([
  'plan_genesis', 'start', 'block', 'unblock', 'done', 'reopen',
  'phase_review', 'phase_accept', 'phase_reject', 'phase_reopen',
  // ADR 0148: 監査していない歴史を「監査なしで閉じた」として明示的に閉じるための専用kind。
  // phase_review/accept/reject/reopenと同じv3 tail event shape(phase_id持ち)に収め、
  // 新しいevent schema版は作らない。
  'phase_close_unaudited',
]);
export const TODO_LIMITS = Object.freeze({
  tasksPerPlan: 512,
  edgesPerPlan: 2_048,
  joinsPerPlan: 128,
  journalSegmentBytes: 1_048_576,
  snapshotBytes: 8_388_608,
  narrativeSectionBytes: 262_144,
});

const DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const CONTROL = /[\u0000-\u001f\u007f]/u;

export const isTodoDigest = (value) => typeof value === 'string' && DIGEST.test(value);
export const isTodoIdentifier = (value) => typeof value === 'string' && IDENTIFIER.test(value);
export const isNonNegativeSafeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function isStrictTodoTimestamp(value) {
  return isCanonicalUtcTimestamp(value);
}

export function assertStrictTodoTimestamp(value, field = 'timestamp') {
  if (!isStrictTodoTimestamp(value)) throw new TypeError(`${field}: strict timestamp required`);
  return value;
}

export function isTodoRef(value) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 1_024
    || CONTROL.test(value) || value.includes('\\') || value.startsWith('/')) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalPart(value, seen, depth) {
  if (depth > 40) throw new TypeError('todo artifact nesting limit exceeded');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('todo artifact number must be a safe integer');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('todo artifact is not a JSON tree');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('todo artifact array is not dense');
    result = `[${value.map((entry) => canonicalPart(entry, seen, depth + 1)).join(',')}]`;
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) throw new TypeError('todo artifact must use plain objects');
    result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalPart(value[key], seen, depth + 1)}`).join(',')}}`;
  }
  seen.delete(value);
  return result;
}

export function canonicalizeTodoArtifact(value) {
  return canonicalPart(value, new Set(), 0);
}

export function digestTodoArtifact(value) {
  return createHash('sha256').update(canonicalizeTodoArtifact(value), 'utf8').digest('hex');
}

export function todoSelfDigest(value, field) {
  const projection = {};
  for (const key of Object.keys(value)) if (key !== field) projection[key] = value[key];
  return digestTodoArtifact(projection);
}

const nullableDigest = (value) => value === null || isTodoDigest(value);
const nullableText = (value) => value === null || (typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 16_384);
const actor = (value) => exactRecord(value, ['host', 'session', 'agent'])
  && [value.host, value.session, value.agent].every(isTodoIdentifier);
const provenance = (value) => value === null || (exactRecord(value, ['source_commit', 'source_event_digest'])
  && /^[0-9a-f]{40}$/u.test(value.source_commit) && isTodoDigest(value.source_event_digest));
const nodeRef = (value) => (exactRecord(value, ['project_id', 'plan_key', 'task_id'])
  || exactRecord(value, ['project_id', 'plan_key', 'task_id', 'expected_topology_digest']))
  && isTodoIdentifier(value.project_id) && isTodoIdentifier(value.plan_key)
  && isTodoIdentifier(value.task_id)
  && (value.expected_topology_digest === undefined || isTodoDigest(value.expected_topology_digest));
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const refKey = (value) => `${value.project_id}\0${value.plan_key}\0${value.task_id}`;
const phaseRef = (value) => (exactRecord(value, ['project_id', 'plan_key', 'phase_id'])
  || exactRecord(value, ['project_id', 'plan_key', 'phase_id', 'expected_topology_digest']))
  && isTodoIdentifier(value.project_id) && isTodoIdentifier(value.plan_key)
  && isTodoIdentifier(value.phase_id)
  && (value.expected_topology_digest === undefined || isTodoDigest(value.expected_topology_digest));
const phaseRefKey = (value) => `${value.project_id}\0${value.plan_key}\0${value.phase_id}`;

function compileBinding(value) {
  return value === null || (exactRecord(value, [
    'boundary_manifest_digest', 'compiled_plan_digest', 'topology_digest', 'base_sha',
  ]) && isTodoDigest(value.boundary_manifest_digest) && isTodoDigest(value.compiled_plan_digest)
    && isTodoDigest(value.topology_digest) && /^[0-9a-f]{40}$/u.test(value.base_sha));
}

function taskV1(value) {
  return exactRecord(value, ['task_id', 'title', 'lane', 'narrative_ref', 'compile_binding'])
    && isTodoIdentifier(value.task_id) && nullableText(value.title) && isTodoIdentifier(value.lane)
    && (value.narrative_ref === null || isTodoRef(value.narrative_ref)) && compileBinding(value.compile_binding);
}

export function validateTodoNarrativeAnchor(value) {
  return exactRecord(value, ['origin_plan_ref', 'origin_line', 'source_commit', 'source_line_digest'])
    && isTodoRef(value.origin_plan_ref) && Number.isSafeInteger(value.origin_line) && value.origin_line >= 1
    && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.source_commit)
    && isTodoDigest(value.source_line_digest);
}

function taskV2(value) {
  return exactRecord(value, [
    'task_id', 'title', 'lane', 'narrative_ref', 'narrative_anchor', 'compile_binding',
  ]) && isTodoIdentifier(value.task_id) && nullableText(value.title) && isTodoIdentifier(value.lane)
    && (value.narrative_ref === null || isTodoRef(value.narrative_ref))
    && (value.narrative_anchor === null || (validateTodoNarrativeAnchor(value.narrative_anchor)
      && value.narrative_ref === value.narrative_anchor.origin_plan_ref))
    && compileBinding(value.compile_binding);
}

function evidence(value) {
  return exactRecord(value, [
    'evidence_id', 'repo_id', 'path', 'git_blob_oid', 'content_digest', 'media_type', 'anchor_digest',
  ]) && isTodoIdentifier(value.evidence_id) && isTodoIdentifier(value.repo_id) && isTodoRef(value.path)
    && /^[0-9a-f]{40,64}$/u.test(value.git_blob_oid) && isTodoDigest(value.content_digest)
    && typeof value.media_type === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(value.media_type)
    && nullableDigest(value.anchor_digest);
}

export function validateTodoImportSource(value) {
  return exactRecord(value, ['schema', 'origin_plan_ref', 'origin_line', 'source_commit'])
    && value.schema === 'lattice.todo_import_source.v1' && isTodoRef(value.origin_plan_ref)
    && Number.isSafeInteger(value.origin_line) && value.origin_line >= 1
    && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.source_commit);
}

function taskV3(value) {
  return exactRecord(value, [
    'task_id', 'title', 'lane', 'narrative_ref', 'narrative_anchor', 'compile_binding',
    'parent_task_id',
  ]) && isTodoIdentifier(value.task_id) && nullableText(value.title) && isTodoIdentifier(value.lane)
    && (value.narrative_ref === null || isTodoRef(value.narrative_ref))
    && (value.narrative_anchor === null || (validateTodoNarrativeAnchor(value.narrative_anchor)
      && value.narrative_ref === value.narrative_anchor.origin_plan_ref))
    && compileBinding(value.compile_binding)
    && (value.parent_task_id === null || isTodoIdentifier(value.parent_task_id));
}

function taskV4(value) {
  return exactRecord(value, [
    'task_id', 'title', 'lane', 'narrative_ref', 'narrative_anchor', 'compile_binding',
    'parent_task_id', 'phase_id',
  ]) && isTodoIdentifier(value.task_id) && nullableText(value.title) && isTodoIdentifier(value.lane)
    && (value.narrative_ref === null || isTodoRef(value.narrative_ref))
    && (value.narrative_anchor === null || (validateTodoNarrativeAnchor(value.narrative_anchor)
      && value.narrative_ref === value.narrative_anchor.origin_plan_ref))
    && compileBinding(value.compile_binding)
    && (value.parent_task_id === null || isTodoIdentifier(value.parent_task_id))
    && isTodoIdentifier(value.phase_id);
}

function phaseV1(value) {
  return exactRecord(value, [
    'phase_id', 'title', 'gate_policy', 'predecessor_phase_ids', 'required_evidence_slots',
  ]) && isTodoIdentifier(value.phase_id) && nullableText(value.title)
    && isTodoIdentifier(value.gate_policy)
    && Array.isArray(value.predecessor_phase_ids)
    && value.predecessor_phase_ids.every(isTodoIdentifier)
    && value.predecessor_phase_ids.every((entry, index) => index === 0
      || compareText(value.predecessor_phase_ids[index - 1], entry) < 0)
    && Array.isArray(value.required_evidence_slots) && value.required_evidence_slots.length > 0
    && value.required_evidence_slots.every(isTodoIdentifier)
    && value.required_evidence_slots.every((entry, index) => index === 0
      || compareText(value.required_evidence_slots[index - 1], entry) < 0);
}

function validPhaseGraph(phases) {
  const ids = new Set(phases.map(({ phase_id }) => phase_id));
  const predecessors = new Map(phases.map(({ phase_id, predecessor_phase_ids }) => (
    [phase_id, predecessor_phase_ids]
  )));
  if (phases.some(({ phase_id, predecessor_phase_ids }) => predecessor_phase_ids.includes(phase_id)
    || predecessor_phase_ids.some((id) => !ids.has(id)))) return false;
  const colors = new Map();
  const visit = (id) => {
    if (colors.get(id) === 1) return false;
    if (colors.get(id) === 2) return true;
    colors.set(id, 1);
    if (!predecessors.get(id).every(visit)) return false;
    colors.set(id, 2);
    return true;
  };
  return [...ids].every(visit);
}

function validParentGraph(tasks) {
  const parents = new Map(tasks.map(({ task_id, parent_task_id }) => [task_id, parent_task_id]));
  for (const [taskId, parentTaskId] of parents) {
    if (parentTaskId !== null && (parentTaskId === taskId || !parents.has(parentTaskId))) return false;
    const seen = new Set([taskId]);
    let cursor = parentTaskId;
    while (cursor !== null) {
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
  }
  return true;
}

export function validateTodoPlan(value) {
  try {
    const taskValidator = value?.schema === 'lattice.todo_plan.v1' ? taskV1
      : value?.schema === 'lattice.todo_plan.v2' ? taskV2
        : value?.schema === 'lattice.todo_plan.v3' ? taskV3
          : ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(value?.schema) ? taskV4 : null;
    const planKeys = [
      'schema', 'project_id', 'plan_key', 'plan_version', 'predecessor_plan_digest',
      'tasks', 'hard_dependencies', 'joins', 'topology_digest', 'plan_digest',
    ];
    if (['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(value?.schema)) planKeys.push('phases');
    if (value?.schema === 'lattice.todo_plan.v5') planKeys.push('phase_accept_dependencies');
    if (!exactRecord(value, planKeys) || taskValidator === null || !isTodoIdentifier(value.project_id)
      || !isTodoIdentifier(value.plan_key) || !isTodoIdentifier(value.plan_version)
      || !nullableDigest(value.predecessor_plan_digest) || !Array.isArray(value.tasks)
      || value.tasks.length === 0 || value.tasks.length > TODO_LIMITS.tasksPerPlan
      || !value.tasks.every(taskValidator) || new Set(value.tasks.map(({ task_id }) => task_id)).size !== value.tasks.length
      || !Array.isArray(value.hard_dependencies) || value.hard_dependencies.length > TODO_LIMITS.edgesPerPlan
      || !value.hard_dependencies.every((edge) => exactRecord(edge, ['from', 'to']) && nodeRef(edge.from) && nodeRef(edge.to))
      || !Array.isArray(value.joins) || value.joins.length > TODO_LIMITS.joinsPerPlan
      || !value.joins.every((join) => exactRecord(join, ['id', 'after', 'before']) && isTodoIdentifier(join.id)
        && Array.isArray(join.after) && join.after.length > 0 && join.after.length <= TODO_LIMITS.tasksPerPlan
        && join.after.every(nodeRef) && nodeRef(join.before))
      || !isTodoDigest(value.topology_digest) || !isTodoDigest(value.plan_digest)
      || (['lattice.todo_plan.v3', 'lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(value.schema)
        && !validParentGraph(value.tasks))) return false;
    if (['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(value.schema)
      && (!Array.isArray(value.phases) || value.phases.length === 0
        || value.phases.length > TODO_LIMITS.tasksPerPlan || !value.phases.every(phaseV1)
        || value.phases.some((entry, index) => index > 0
          && compareText(value.phases[index - 1].phase_id, entry.phase_id) >= 0)
        || new Set(value.phases.map(({ phase_id }) => phase_id)).size !== value.phases.length
        || value.tasks.some(({ phase_id }) => !value.phases.some((phase) => phase.phase_id === phase_id))
        || !validPhaseGraph(value.phases))) return false;
    if (value.schema === 'lattice.todo_plan.v5'
      && (!Array.isArray(value.phase_accept_dependencies)
        || value.phase_accept_dependencies.length > TODO_LIMITS.edgesPerPlan
        || !value.phase_accept_dependencies.every((edge) => exactRecord(edge, ['from', 'to'])
          && phaseRef(edge.from) && nodeRef(edge.to))
        || value.phase_accept_dependencies.some((edge, index) => index > 0
          && compareText(`${phaseRefKey(value.phase_accept_dependencies[index - 1].from)}\0${refKey(value.phase_accept_dependencies[index - 1].to)}`,
            `${phaseRefKey(edge.from)}\0${refKey(edge.to)}`) >= 0))) return false;
    if (value.tasks.some((entry, index) => index > 0 && compareText(value.tasks[index - 1].task_id, entry.task_id) >= 0)
      || value.hard_dependencies.some((edge, index) => index > 0
        && compareText(`${refKey(value.hard_dependencies[index - 1].from)}\0${refKey(value.hard_dependencies[index - 1].to)}`,
          `${refKey(edge.from)}\0${refKey(edge.to)}`) >= 0)
      || value.joins.some((join, index) => index > 0 && compareText(value.joins[index - 1].id, join.id) >= 0)
      || value.joins.some((join) => join.after.some((entry, index) => index > 0
        && compareText(refKey(join.after[index - 1]), refKey(entry)) >= 0))) return false;
    const topology = {
      project_id: value.project_id, plan_key: value.plan_key, plan_version: value.plan_version,
      tasks: value.tasks, hard_dependencies: value.hard_dependencies, joins: value.joins,
      ...(['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(value.schema)
        ? { phases: value.phases } : {}),
      ...(value.schema === 'lattice.todo_plan.v5'
        ? { phase_accept_dependencies: value.phase_accept_dependencies } : {}),
    };
    return value.topology_digest === digestTodoArtifact(topology)
      && value.plan_digest === todoSelfDigest(value, 'plan_digest');
  } catch { return false; }
}

export function validateEvidenceDescriptor(value) { return evidence(value); }

function validPayload(event) {
  const payload = event.payload;
  if (event.kind === 'plan_genesis') return (exactRecord(payload, [
    'plan_digest', 'topology_digest', 'predecessor_plan_digest', 'task_migration',
  ]) || exactRecord(payload, [
    'plan_digest', 'topology_digest', 'predecessor_plan_digest', 'task_migration', 'historical_import',
  ])) && (payload.historical_import === undefined || payload.historical_import === true)
    && isTodoDigest(payload.plan_digest) && isTodoDigest(payload.topology_digest)
    && nullableDigest(payload.predecessor_plan_digest) && Array.isArray(payload.task_migration)
    && payload.task_migration.length <= TODO_LIMITS.tasksPerPlan
    && payload.task_migration.every((entry) => exactRecord(entry, ['from_task_id', 'to_task_id'])
      && isTodoIdentifier(entry.from_task_id) && (entry.to_task_id === 'removed' || isTodoIdentifier(entry.to_task_id)));
  if (event.kind === 'start' && payload?.start_mode === 'historical_import') {
    return exactRecord(payload, ['start_mode', 'imported', 'status', 'started_at', 'evidence'])
      && payload.imported === true && payload.status === 'in-progress'
      && (payload.started_at === 'unknown_requires_evidence' || isStrictTodoTimestamp(payload.started_at))
      && validateTodoImportSource(payload.evidence);
  }
  if (event.kind === 'start') return exactRecord(payload, ['override_reason']) && nullableText(payload.override_reason);
  if (event.kind === 'block') return exactRecord(payload, ['reason']) && nullableText(payload.reason) && payload.reason !== null;
  if (event.kind === 'unblock') return exactRecord(payload, []);
  if (event.kind === 'done' && payload?.done_mode === 'authored') {
    return exactRecord(payload, ['done_mode', 'imported', 'evidence'])
      && payload.imported === false && evidence(payload.evidence);
  }
  if (event.kind === 'done' && payload?.done_mode === 'historical_import') {
    return exactRecord(payload, ['done_mode', 'imported', 'status', 'completed_at', 'evidence'])
      && payload.imported === true && payload.status === 'done'
      && (payload.completed_at === 'unknown_requires_evidence' || isStrictTodoTimestamp(payload.completed_at))
      && validateTodoImportSource(payload.evidence);
  }
  if (event.kind === 'done' && payload?.done_mode === 'evidence_promotion') {
    return exactRecord(payload, ['done_mode', 'imported', 'target_done_digest', 'evidence'])
      && payload.imported === true && isTodoDigest(payload.target_done_digest) && evidence(payload.evidence);
  }
  if (event.kind === 'reopen') return exactRecord(payload, ['reason', 'target_done_digest', 'override_reason'])
    && nullableText(payload.reason) && payload.reason !== null && isTodoDigest(payload.target_done_digest)
    && nullableText(payload.override_reason);
  if (event.kind === 'phase_review') return exactRecord(payload, ['reason'])
    && nullableText(payload.reason) && payload.reason !== null;
  if (event.kind === 'phase_accept') return exactRecord(payload, [
    'review_event_digest', 'decision_evidence', 'evidence_slots',
  ]) && isTodoDigest(payload.review_event_digest) && evidence(payload.decision_evidence)
    && Array.isArray(payload.evidence_slots) && payload.evidence_slots.length > 0
    && payload.evidence_slots.every((entry) => exactRecord(entry, ['slot_id', 'evidence'])
      && isTodoIdentifier(entry.slot_id) && evidence(entry.evidence))
    && payload.evidence_slots.every((entry, index) => index === 0
      || compareText(payload.evidence_slots[index - 1].slot_id, entry.slot_id) < 0);
  if (event.kind === 'phase_reject') return exactRecord(payload, [
    'review_event_digest', 'reason', 'decision_evidence',
  ]) && isTodoDigest(payload.review_event_digest) && nullableText(payload.reason)
    && payload.reason !== null && evidence(payload.decision_evidence);
  if (event.kind === 'phase_reopen') return exactRecord(payload, [
    'reason', 'target_decision_digest', 'override_reason',
  ]) && nullableText(payload.reason) && payload.reason !== null
    && isTodoDigest(payload.target_decision_digest) && nullableText(payload.override_reason);
  // ADR 0148裁定1: 監査なしで閉じたことの理由は必須(payload.reason !== null)。証拠は無い
  // ——監査していないというのが事実であり、evidenceを要求すると「監査した体」を装う経路になる。
  if (event.kind === 'phase_close_unaudited') return exactRecord(payload, ['reason'])
    && nullableText(payload.reason) && payload.reason !== null;
  return false;
}

function validCarriedState(value) {
  if (!exactRecord(value, [
    'status', 'started_at', 'done_at', 'blocked_reason', 'evidence', 'imported',
  ]) || !['pending', 'in-progress', 'blocked', 'done'].includes(value.status)
    || (value.started_at !== null && !isStrictTodoTimestamp(value.started_at))
    || (value.done_at !== null && !isStrictTodoTimestamp(value.done_at))
    || (value.blocked_reason !== null && !nullableText(value.blocked_reason))
    || typeof value.imported !== 'boolean') return false;
  if (value.status === 'pending') return value.started_at === null && value.done_at === null
    && value.blocked_reason === null && value.evidence === null && value.imported === false;
  const activeEvidenceValid = value.imported
    ? value.evidence === null || validateTodoImportSource(value.evidence)
    : value.evidence === null;
  if (value.status === 'in-progress') return value.done_at === null && value.blocked_reason === null
    && activeEvidenceValid;
  if (value.status === 'blocked') return value.done_at === null && value.blocked_reason !== null
    && activeEvidenceValid;
  return value.blocked_reason === null && value.evidence !== null
    && (value.imported ? validateTodoImportSource(value.evidence) : evidence(value.evidence));
}

function validStateMigration(value) {
  return Array.isArray(value) && value.length <= TODO_LIMITS.tasksPerPlan
    && value.every((entry) => exactRecord(entry, [
      'from_task_id', 'to_task_id', 'state_policy', 'state',
    ]) && isTodoIdentifier(entry.from_task_id)
      && (entry.to_task_id === 'removed' || isTodoIdentifier(entry.to_task_id))
      && ['carry', 'carry_reconciled_metadata', 'reset_pending', 'removed', 'acquire_phase'].includes(entry.state_policy)
      && ((['carry', 'carry_reconciled_metadata', 'acquire_phase'].includes(entry.state_policy)
        && entry.to_task_id !== 'removed' && validCarriedState(entry.state))
        || (entry.state_policy === 'reset_pending' && entry.to_task_id !== 'removed' && entry.state === null)
        || (entry.state_policy === 'removed' && entry.to_task_id === 'removed' && entry.state === null)))
    && new Set(value.map(({ from_task_id }) => from_task_id)).size === value.length
    && value.every((entry, index) => index === 0
      || compareText(value[index - 1].from_task_id, entry.from_task_id) < 0);
}

function validPhaseStateMigration(value) {
  return Array.isArray(value) && value.length <= TODO_LIMITS.tasksPerPlan
    && value.every((entry) => exactRecord(entry, ['phase_id', 'state_policy', 'state'])
      && isTodoIdentifier(entry.phase_id) && ['carry', 'reset'].includes(entry.state_policy)
      && (entry.state_policy === 'reset' ? entry.state === null
        : exactRecord(entry.state, [
          'status', 'review_event_digest', 'decision_event_digest', 'decision_evidence',
        ]) && ['locked', 'active', 'gate_ready', 'reviewing', 'accepted', 'rejected', 'closed_unaudited']
          .includes(entry.state.status)
          && nullableDigest(entry.state.review_event_digest)
          && nullableDigest(entry.state.decision_event_digest)
          && (entry.state.decision_evidence === null || evidence(entry.state.decision_evidence))))
    && value.every((entry, index) => index === 0
      || compareText(value[index - 1].phase_id, entry.phase_id) < 0);
}

export function validateTodoEvent(value) {
  try {
    const commonKeys = [
      'schema', 'project_id', 'plan_key', 'plan_version', 'sequence', 'previous_digest',
      'kind', 'task_id', 'actor', 'recorded_at', 'provenance', 'payload', 'event_digest',
    ];
    const v1 = value?.schema === 'lattice.todo_event.v1' && exactRecord(value, commonKeys);
    const v2 = value?.schema === 'lattice.todo_event.v2' && exactRecord(value, [
      ...commonKeys, 'reconciliation_state', 'revision_digest', 'reconciliation_digest',
      'state_migration',
    ]) && value.kind === 'plan_genesis' && value.task_id === null
      && value.reconciliation_state === 'reconciled' && isTodoDigest(value.revision_digest)
      && isTodoDigest(value.reconciliation_digest) && validStateMigration(value.state_migration);
    const v3 = value?.schema === 'lattice.todo_event.v3' && exactRecord(value, [
      ...commonKeys, 'phase_id',
    ]);
    const v4 = value?.schema === 'lattice.todo_event.v4' && exactRecord(value, [
      ...commonKeys, 'phase_id', 'revision_digest', 'state_migration', 'phase_state_migration',
    ]) && value.kind === 'plan_genesis' && value.task_id === null && value.phase_id === null
      && isTodoDigest(value.revision_digest) && validStateMigration(value.state_migration)
      && validPhaseStateMigration(value.phase_state_migration);
    const phaseKind = ['phase_review', 'phase_accept', 'phase_reject', 'phase_reopen', 'phase_close_unaudited']
      .includes(value?.kind);
    return (v1 || v2 || v3 || v4) && isTodoIdentifier(value.project_id)
      && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.plan_version)
      && isNonNegativeSafeInteger(value.sequence) && nullableDigest(value.previous_digest)
      && TODO_EVENT_KINDS.includes(value.kind)
      && (v3 || v4
        ? ((value.kind === 'plan_genesis' && value.task_id === null && value.phase_id === null)
          || (phaseKind && value.task_id === null && isTodoIdentifier(value.phase_id))
          || (!phaseKind && value.kind !== 'plan_genesis' && isTodoIdentifier(value.task_id)
            && value.phase_id === null))
        : !phaseKind && ((value.kind === 'plan_genesis' && value.task_id === null)
          || (value.kind !== 'plan_genesis' && isTodoIdentifier(value.task_id))))
      && actor(value.actor) && isStrictTodoTimestamp(value.recorded_at) && provenance(value.provenance)
      && validPayload(value) && isTodoDigest(value.event_digest)
      && value.event_digest === todoSelfDigest(value, 'event_digest');
  } catch { return false; }
}

export function validateTodoManifest(value) {
  try {
    const manifestV1 = value?.schema === 'lattice.todo_manifest.v1';
    const manifestV2 = value?.schema === 'lattice.todo_manifest.v2';
    return exactRecord(value, ['schema', 'project_id', 'repositories', 'members', 'manifest_digest'])
      && (manifestV1 || manifestV2) && isTodoIdentifier(value.project_id)
      && Array.isArray(value.repositories) && value.repositories.length > 0 && value.repositories.length <= 256
      && value.repositories.every((repo) => exactRecord(repo, ['repo_id', 'path'])
        && isTodoIdentifier(repo.repo_id) && (repo.path === '.' || isTodoRef(repo.path)))
      && new Set(value.repositories.map(({ repo_id }) => repo_id)).size === value.repositories.length
      && value.repositories.every((repo, index) => index === 0 || value.repositories[index - 1].repo_id < repo.repo_id)
      && Array.isArray(value.members) && value.members.length > 0 && value.members.length <= 256
      && value.members.every((member) => exactRecord(member, [
        'plan_key', 'active_plan_version', 'plan_ref', 'journal_ref', 'snapshot_ref',
        'topology_digest', 'journal_head_digest', ...(manifestV2 ? ['active_revision_digest'] : []),
      ]) && isTodoIdentifier(member.plan_key) && isTodoIdentifier(member.active_plan_version)
        && isTodoRef(member.plan_ref) && isTodoRef(member.journal_ref) && isTodoRef(member.snapshot_ref)
        && isTodoDigest(member.topology_digest) && isTodoDigest(member.journal_head_digest)
        && (!manifestV2 || isTodoDigest(member.active_revision_digest)))
      && value.members.every((member, index) => index === 0 || value.members[index - 1].plan_key < member.plan_key)
      && new Set(value.members.map(({ plan_key }) => plan_key)).size === value.members.length
      && isTodoDigest(value.manifest_digest) && value.manifest_digest === todoSelfDigest(value, 'manifest_digest');
  } catch { return false; }
}

export function validateTodoSnapshot(value) {
  try {
    const v1 = value?.schema === 'lattice.todo_snapshot.v1' && exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'projection_version', 'through_sequence',
      'journal_head_digest', 'tasks', 'snapshot_digest',
    ]);
    const v2 = value?.schema === 'lattice.todo_snapshot.v2' && exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'projection_version', 'through_sequence',
      'journal_head_digest', 'tasks', 'phases', 'snapshot_digest',
    ]);
    return (v1 || v2) && isTodoIdentifier(value.project_id)
      && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.plan_version)
      && value.projection_version === (v1 ? 1 : 2) && isNonNegativeSafeInteger(value.through_sequence)
      && isTodoDigest(value.journal_head_digest) && Array.isArray(value.tasks)
      && value.tasks.length > 0 && value.tasks.length <= TODO_LIMITS.tasksPerPlan
      && value.tasks.every((entry) => exactRecord(entry, [
        'task_id', 'status', 'started_at', 'done_at', 'blocked_reason', 'evidence', 'evidence_unverified', 'imported',
      ]) && isTodoIdentifier(entry.task_id) && ['pending', 'in-progress', 'blocked', 'done'].includes(entry.status)
        && (entry.started_at === null || isStrictTodoTimestamp(entry.started_at))
        && (entry.done_at === null || isStrictTodoTimestamp(entry.done_at)) && nullableText(entry.blocked_reason)
        && (entry.evidence === null || evidence(entry.evidence) || validateTodoImportSource(entry.evidence))
        && typeof entry.evidence_unverified === 'boolean' && typeof entry.imported === 'boolean')
      && value.tasks.every((entry, index) => index === 0 || value.tasks[index - 1].task_id < entry.task_id)
      && (!v2 || (Array.isArray(value.phases) && value.phases.length > 0
        && value.phases.every((entry) => exactRecord(entry, [
          'phase_id', 'status', 'review_event_digest', 'decision_event_digest', 'decision_evidence',
        ]) && isTodoIdentifier(entry.phase_id)
          && ['locked', 'active', 'gate_ready', 'reviewing', 'accepted', 'rejected', 'closed_unaudited']
            .includes(entry.status)
          && nullableDigest(entry.review_event_digest) && nullableDigest(entry.decision_event_digest)
          && (entry.decision_evidence === null || evidence(entry.decision_evidence)))
        && value.phases.every((entry, index) => index === 0
          || value.phases[index - 1].phase_id < entry.phase_id)))
      && isTodoDigest(value.snapshot_digest) && value.snapshot_digest === todoSelfDigest(value, 'snapshot_digest');
  } catch { return false; }
}
