import {
  exactRecord,
  isNonNegativeSafeInteger,
  isTodoDigest,
  isTodoIdentifier,
  todoSelfDigest,
} from './todo-contracts.mjs';
import { todoLegacyReconciliationDigest } from './todo-revision.mjs';

export const TODO_STATUS_SCHEMA = 'lattice.todo_status_result.v3';
export const TODO_STATUS_LIST_LIMIT = 2_000;
export const TODO_STATUS_LABEL_LIMIT = 160;
export const TODO_STATUS_REASON_LIMIT = 512;
export const TODO_STATUS_CAPTURE_LIMIT = 64 * 1_024;

export class TodoStatusProjectionError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoStatusProjectionError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail) {
  throw new TodoStatusProjectionError(code, reason, detail);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** Python consumerのlen()/ord()と同じUnicode code point単位のbounded_text。 */
export function isTodoStatusBoundedText(value, limit = TODO_STATUS_REASON_LIMIT) {
  if (typeof value !== 'string') return false;
  const points = [...value];
  return points.length > 0 && points.length <= limit
    && points.every((character) => character.codePointAt(0) >= 0x20 && character !== '\x7f');
}

function displayText(value, fallback, limit) {
  const source = typeof value === 'string' && value.length > 0 ? value : fallback;
  const points = [...source].slice(0, limit).map((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint >= 0x20 && codePoint !== 0x7f ? character : '\uFFFD';
  });
  const result = points.join('');
  return result.length > 0 ? result : fallback;
}

function taskKey(projectId, planKey, taskId) {
  return `${projectId}\0${planKey}\0${taskId}`;
}

function refKey(ref) {
  return taskKey(ref.project_id, ref.plan_key, ref.task_id);
}

function compareTaskEntries(left, right) {
  return left.plan_key < right.plan_key ? -1 : left.plan_key > right.plan_key ? 1
    : left.task_id < right.task_id ? -1 : left.task_id > right.task_id ? 1 : 0;
}

function enforceListLimit(name, value) {
  if (value.length > TODO_STATUS_LIST_LIMIT) {
    fail('TODO_SCALE_EXCEEDED', 'todo_status_list_limit_exceeded', {
      list: name,
      count: value.length,
      limit: TODO_STATUS_LIST_LIMIT,
    });
  }
}

function taskEntry(value) {
  return exactRecord(value, ['plan_key', 'task_id', 'label'])
    && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.task_id)
    && isTodoStatusBoundedText(value.label, TODO_STATUS_LABEL_LIMIT);
}

function taskRefEntry(value) {
  return exactRecord(value, ['plan_key', 'task_id'])
    && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.task_id);
}

function activeTaskEntry(value) {
  return exactRecord(value, ['plan_key', 'task_id', 'label', 'unmet_dependencies'])
    && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.task_id)
    && isTodoStatusBoundedText(value.label, TODO_STATUS_LABEL_LIMIT)
    && boundedList(value.unmet_dependencies, taskRefEntry);
}

function blockedEntry(value) {
  return exactRecord(value, ['plan_key', 'task_id', 'reason'])
    && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.task_id)
    && isTodoStatusBoundedText(value.reason, TODO_STATUS_REASON_LIMIT);
}

function memberHead(value) {
  return exactRecord(value, [
    'plan_key', 'plan_version', 'through_sequence', 'journal_head_digest',
    'reconciliation_state', 'revision_digest', 'reconciliation_digest',
  ]) && isTodoIdentifier(value.plan_key) && isTodoIdentifier(value.plan_version)
    && isNonNegativeSafeInteger(value.through_sequence) && isTodoDigest(value.journal_head_digest)
    && ['registered_unreconciled', 'reconciled'].includes(value.reconciliation_state)
    && (value.revision_digest === null || isTodoDigest(value.revision_digest))
    && isTodoDigest(value.reconciliation_digest)
    && ((value.reconciliation_state === 'registered_unreconciled' && value.revision_digest === null)
      || (value.reconciliation_state === 'reconciled' && isTodoDigest(value.revision_digest)));
}

function boundedList(value, validator) {
  return Array.isArray(value) && value.length <= TODO_STATUS_LIST_LIMIT && value.every(validator);
}

/** todo status v3 wire shapeを検証し、digestも再計算する。 */
export function validateTodoStatusResult(value) {
  try {
    return exactRecord(value, [
      'schema', 'project_id', 'active_set', 'next_ready', 'blocked', 'member_heads', 'result_digest',
    ]) && value.schema === TODO_STATUS_SCHEMA && isTodoIdentifier(value.project_id)
      && boundedList(value.active_set, activeTaskEntry) && boundedList(value.next_ready, taskEntry)
      && boundedList(value.blocked, blockedEntry) && boundedList(value.member_heads, memberHead)
      && isTodoDigest(value.result_digest)
      && value.result_digest === todoSelfDigest(value, 'result_digest');
  } catch {
    return false;
  }
}

/** Canonical todo read modelからSessionStart向け現在地をread-only投影する。 */
export function projectTodoStatus(readModel) {
  if (!plain(readModel) || readModel.schema !== 'lattice.todo_store_read.v1'
    || !isTodoIdentifier(readModel.project_id) || !Array.isArray(readModel.members)) {
    fail('TODO_STATUS_INVALID_INPUT', 'todo_status_read_model_invalid');
  }

  const nodes = new Map();
  const incoming = new Map();
  const memberHeads = [];
  const phaseStatuses = new Map(readModel.members.flatMap((member) => (
    (member.snapshot?.phases ?? []).map((phase) => [
      `${member.plan.project_id}\0${member.plan.plan_key}\0${phase.phase_id}`, phase.status,
    ])
  )));
  const members = [...readModel.members].sort((left, right) => {
    const leftKey = left?.descriptor?.plan_key ?? '';
    const rightKey = right?.descriptor?.plan_key ?? '';
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  for (const member of members) {
    if (!plain(member) || !plain(member.plan) || !plain(member.descriptor)
      || !Array.isArray(member.plan.tasks) || !Array.isArray(member.plan.hard_dependencies)
      || !Array.isArray(member.plan.joins) || !Array.isArray(member.tasks)
      || !plain(member.journal) || !Array.isArray(member.journal.events)) {
      fail('TODO_STATUS_INVALID_INPUT', 'todo_status_member_invalid');
    }
    const head = member.journal.events.at(-1);
    const genesis = member.journal.events[0];
    if (!plain(head) || !isNonNegativeSafeInteger(head.sequence) || !isTodoDigest(head.event_digest)) {
      fail('TODO_STATUS_INVALID_INPUT', 'todo_status_member_head_invalid');
    }
    memberHeads.push({
      plan_key: member.plan.plan_key,
      plan_version: member.plan.plan_version,
      through_sequence: head.sequence,
      journal_head_digest: head.event_digest,
      reconciliation_state: ['lattice.todo_event.v2', 'lattice.todo_event.v4'].includes(genesis.schema)
        ? 'reconciled' : 'registered_unreconciled',
      revision_digest: ['lattice.todo_event.v2', 'lattice.todo_event.v4'].includes(genesis.schema)
        ? genesis.revision_digest : null,
      reconciliation_digest: ['lattice.todo_event.v2', 'lattice.todo_event.v4'].includes(genesis.schema)
        ? genesis.schema === 'lattice.todo_event.v4' ? genesis.revision_digest : genesis.reconciliation_digest
        : todoLegacyReconciliationDigest({
          planDigest: member.plan.plan_digest, journalHeadDigest: head.event_digest,
        }),
    });
    const states = new Map(member.tasks.map((state) => [state.task_id, state]));
    const phases = new Map((member.snapshot?.phases ?? []).map((state) => [state.phase_id, state]));
    for (const task of member.plan.tasks) {
      const state = states.get(task.task_id);
      if (!plain(state) || !['pending', 'in-progress', 'blocked', 'done'].includes(state.status)) {
        fail('TODO_STATUS_INVALID_INPUT', 'todo_status_task_state_missing', {
          plan_key: member.plan.plan_key,
          task_id: task.task_id,
        });
      }
      const key = taskKey(member.plan.project_id, member.plan.plan_key, task.task_id);
      if (nodes.has(key)) fail('TODO_STATUS_INVALID_INPUT', 'todo_status_task_duplicate');
      nodes.set(key, {
        key,
        project_id: member.plan.project_id,
        plan_key: member.plan.plan_key,
        task_id: task.task_id,
        label: displayText(task.title, task.task_id, TODO_STATUS_LABEL_LIMIT),
        status: state.status,
        blocked_reason: state.blocked_reason,
        plan_schema: member.plan.schema,
        phase_id: ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(member.plan.schema)
          ? task.phase_id : null,
        phase_status: ['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(member.plan.schema)
          ? phases.get(task.phase_id)?.status : null,
        phase_ready: member.plan.schema !== 'lattice.todo_plan.v4'
          || phases.get(task.phase_id)?.status === 'active',
      });
      incoming.set(key, new Set());
    }
  }

  const addPredecessor = (from, to) => {
    const fromKey = refKey(from);
    const toKey = refKey(to);
    if (!nodes.has(fromKey) || !nodes.has(toKey)) {
      fail('TODO_STATUS_INVALID_INPUT', 'todo_status_dependency_dangling');
    }
    incoming.get(toKey).add(fromKey);
  };
  const phaseAcceptIncoming = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  for (const member of members) {
    for (const edge of member.plan.hard_dependencies) addPredecessor(edge.from, edge.to);
    for (const join of member.plan.joins) {
      for (const after of join.after) addPredecessor(after, join.before);
    }
    if (member.plan.schema === 'lattice.todo_plan.v5') {
      for (const edge of member.plan.phase_accept_dependencies) {
        const target = refKey(edge.to);
        if (!nodes.has(target)) fail('TODO_STATUS_INVALID_INPUT', 'todo_status_dependency_dangling');
        phaseAcceptIncoming.get(target).add(
          `${edge.from.project_id}\0${edge.from.plan_key}\0${edge.from.phase_id}`,
        );
      }
    }
  }

  const activeSet = [];
  const nextReady = [];
  const blocked = [];
  for (const node of nodes.values()) {
    const task = { plan_key: node.plan_key, task_id: node.task_id, label: node.label };
    if (node.status === 'in-progress') {
      const unmetDependencies = [...incoming.get(node.key)]
        .filter((key) => nodes.get(key).status !== 'done')
        .map((key) => {
          const predecessor = nodes.get(key);
          return { plan_key: predecessor.plan_key, task_id: predecessor.task_id };
        })
        .sort(compareTaskEntries);
      enforceListLimit('active_set.unmet_dependencies', unmetDependencies);
      activeSet.push({ ...task, unmet_dependencies: unmetDependencies });
    }
    if (node.status === 'pending' && node.phase_ready
      && [...incoming.get(node.key)].every((key) => {
        const predecessor = nodes.get(key);
        return predecessor.status === 'done'
          && (predecessor.plan_schema !== 'lattice.todo_plan.v4'
            || predecessor.phase_id === null
            || (predecessor.plan_key === node.plan_key && predecessor.phase_id === node.phase_id)
            || predecessor.phase_status === 'accepted');
      }) && [...phaseAcceptIncoming.get(node.key)]
        .every((key) => phaseStatuses.get(key) === 'accepted')) nextReady.push(task);
    if (node.status === 'blocked') {
      blocked.push({
        plan_key: node.plan_key,
        task_id: node.task_id,
        reason: displayText(node.blocked_reason, 'blocked', TODO_STATUS_REASON_LIMIT),
      });
    }
  }
  activeSet.sort(compareTaskEntries);
  nextReady.sort(compareTaskEntries);
  blocked.sort(compareTaskEntries);
  memberHeads.sort((left, right) => left.plan_key < right.plan_key ? -1 : left.plan_key > right.plan_key ? 1 : 0);
  for (const [name, value] of [
    ['active_set', activeSet], ['next_ready', nextReady], ['blocked', blocked], ['member_heads', memberHeads],
  ]) enforceListLimit(name, value);

  const result = {
    schema: TODO_STATUS_SCHEMA,
    project_id: readModel.project_id,
    active_set: activeSet,
    next_ready: nextReady,
    blocked,
    member_heads: memberHeads,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  if (!validateTodoStatusResult(result)) fail('TODO_STATUS_INVALID_RESULT', 'todo_status_result_invalid');
  const resultBytes = Buffer.byteLength(`${JSON.stringify(result)}\n`);
  if (resultBytes > TODO_STATUS_CAPTURE_LIMIT) {
    fail('TODO_SCALE_EXCEEDED', 'todo_status_result_size_limit_exceeded', {
      result_bytes: resultBytes,
      result_limit: TODO_STATUS_CAPTURE_LIMIT,
    });
  }
  return result;
}
