import {
  digestTodoArtifact,
  exactRecord,
  isTodoDigest,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
  validateTodoPlan,
} from './todo-contracts.mjs';

const REVISION_KEYS = [
  'schema', 'project_id', 'plan_key', 'predecessor', 'desired_plan', 'task_migration',
  'source_inventory', 'reconciliation', 'revision_digest',
];

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const boundedText = (value) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value) <= 16_384 && !/[\u0000-\u001f\u007f]/u.test(value);

export function parseTodoSourceRef(value) {
  if (typeof value !== 'string') return null;
  const match = /^(.*)#L([1-9]\d*)$/u.exec(value);
  if (match === null || !isTodoRef(match[1])) return null;
  const line = Number(match[2]);
  return Number.isSafeInteger(line) ? { path: match[1], line } : null;
}

export function todoRevisionPlanVersion({
  projectId, planKey, predecessor, desiredPlan, taskMigration, sourceInventory,
}) {
  const versionDigest = digestTodoArtifact({
    schema: 'lattice.todo_revision_version.v1',
    project_id: projectId,
    plan_key: planKey,
    predecessor,
    desired_topology: {
      schema: desiredPlan.schema,
      project_id: desiredPlan.project_id,
      plan_key: desiredPlan.plan_key,
      predecessor_plan_digest: desiredPlan.predecessor_plan_digest,
      tasks: desiredPlan.tasks,
      hard_dependencies: desiredPlan.hard_dependencies,
      joins: desiredPlan.joins,
    },
    task_migration: taskMigration,
    source_inventory: sourceInventory,
  });
  return `rev-${versionDigest.slice(0, 24)}`;
}

export function todoLegacyReconciliationDigest({ planDigest, journalHeadDigest }) {
  if (!isTodoDigest(planDigest) || !isTodoDigest(journalHeadDigest)) {
    throw new TypeError('legacy reconciliation anchor digest required');
  }
  return digestTodoArtifact({
    schema: 'lattice.todo_reconciliation_anchor.v1',
    state: 'registered_unreconciled',
    plan_digest: planDigest,
    journal_head_digest: journalHeadDigest,
  });
}

export function todoSourceInventoryDigest(sourceInventory) {
  return digestTodoArtifact(sourceInventory);
}

export function todoReconciliationDigest({
  predecessorReconciliationDigest,
  sourceInventoryDigest,
  predecessor,
  desiredPlanDigest,
  taskMigration,
}) {
  if (!isTodoDigest(predecessorReconciliationDigest) || !isTodoDigest(sourceInventoryDigest)
    || !isTodoDigest(desiredPlanDigest)) throw new TypeError('reconciliation digest input invalid');
  return digestTodoArtifact({
    schema: 'lattice.todo_reconciliation_binding.v1',
    predecessor_reconciliation_digest: predecessorReconciliationDigest,
    source_inventory_digest: sourceInventoryDigest,
    predecessor,
    desired_plan_digest: desiredPlanDigest,
    task_migration_digest: digestTodoArtifact(taskMigration),
  });
}

function validPredecessor(value) {
  return exactRecord(value, ['plan_digest', 'journal_head_digest', 'plan_version'])
    && isTodoDigest(value.plan_digest) && isTodoDigest(value.journal_head_digest)
    && isTodoIdentifier(value.plan_version);
}

function validTaskMigration(value) {
  const activeTargets = Array.isArray(value)
    ? value.filter(({ to_task_id }) => to_task_id !== 'removed').map(({ to_task_id }) => to_task_id)
    : [];
  return Array.isArray(value) && value.length > 0 && value.length <= 512
    && value.every((entry) => exactRecord(entry, [
      'from_task_id', 'to_task_id', 'state_policy',
    ]) && isTodoIdentifier(entry.from_task_id)
      && (entry.to_task_id === 'removed' || isTodoIdentifier(entry.to_task_id))
      && ((entry.state_policy === 'removed' && entry.to_task_id === 'removed')
        || (['carry', 'reset_pending'].includes(entry.state_policy) && entry.to_task_id !== 'removed')))
    && new Set(value.map(({ from_task_id }) => from_task_id)).size === value.length
    && new Set(activeTargets).size === activeTargets.length
    && value.every((entry, index) => index === 0
      || compareText(value[index - 1].from_task_id, entry.from_task_id) < 0);
}

function validSourceInventory(value, desiredPlan) {
  if (!exactRecord(value, ['active', 'excluded_tombstones'])
    || !Array.isArray(value.active) || !Array.isArray(value.excluded_tombstones)
    || value.active.length > 512 || value.excluded_tombstones.length > 2_048
    || !value.active.every((entry) => exactRecord(entry, ['task_id', 'source_ref', 'source_digest'])
      && isTodoIdentifier(entry.task_id) && parseTodoSourceRef(entry.source_ref) !== null
      && isTodoDigest(entry.source_digest))
    || !value.excluded_tombstones.every((entry) => exactRecord(entry, [
      'source_ref', 'source_digest', 'exclusion_reason',
    ]) && parseTodoSourceRef(entry.source_ref) !== null && isTodoDigest(entry.source_digest)
      && boundedText(entry.exclusion_reason))) return false;
  const taskIds = desiredPlan.tasks.map(({ task_id }) => task_id);
  const activeIds = value.active.map(({ task_id }) => task_id);
  const activeRefs = value.active.map(({ source_ref }) => source_ref);
  const tombstoneRefs = value.excluded_tombstones.map(({ source_ref }) => source_ref);
  const activeRefSet = new Set(activeRefs);
  return taskIds.length === activeIds.length && taskIds.every((id, index) => id === activeIds[index])
    && activeRefSet.size === activeRefs.length
    && new Set(tombstoneRefs).size === tombstoneRefs.length
    && tombstoneRefs.every((ref) => !activeRefSet.has(ref))
    && value.excluded_tombstones.every((entry, index) => index === 0
      || compareText(value.excluded_tombstones[index - 1].source_ref, entry.source_ref) < 0);
}

export function validateTodoRevision(value) {
  try {
    if (!exactRecord(value, REVISION_KEYS) || value.schema !== 'lattice.todo_revision.v1'
      || !isTodoIdentifier(value.project_id) || !isTodoIdentifier(value.plan_key)
      || !validPredecessor(value.predecessor) || !validateTodoPlan(value.desired_plan)
      || value.desired_plan.schema !== 'lattice.todo_plan.v3'
      || value.desired_plan.project_id !== value.project_id
      || value.desired_plan.plan_key !== value.plan_key
      || value.desired_plan.predecessor_plan_digest !== value.predecessor.plan_digest
      || !validTaskMigration(value.task_migration)
      || !validSourceInventory(value.source_inventory, value.desired_plan)
      || value.desired_plan.plan_version !== todoRevisionPlanVersion({
        projectId: value.project_id, planKey: value.plan_key, predecessor: value.predecessor,
        desiredPlan: value.desired_plan, taskMigration: value.task_migration,
        sourceInventory: value.source_inventory,
      }) || !exactRecord(value.reconciliation, [
        'predecessor_reconciliation_digest', 'source_inventory_digest', 'reconciliation_digest',
      ]) || !isTodoDigest(value.reconciliation.predecessor_reconciliation_digest)
      || value.reconciliation.source_inventory_digest !== todoSourceInventoryDigest(value.source_inventory)
      || value.reconciliation.reconciliation_digest !== todoReconciliationDigest({
        predecessorReconciliationDigest: value.reconciliation.predecessor_reconciliation_digest,
        sourceInventoryDigest: value.reconciliation.source_inventory_digest,
        predecessor: value.predecessor,
        desiredPlanDigest: value.desired_plan.plan_digest,
        taskMigration: value.task_migration,
      })) return false;
    const targets = new Set(value.desired_plan.tasks.map(({ task_id }) => task_id));
    if (value.task_migration.some(({ to_task_id }) => to_task_id !== 'removed' && !targets.has(to_task_id))) return false;
    return isTodoDigest(value.revision_digest)
      && value.revision_digest === todoSelfDigest(value, 'revision_digest');
  } catch { return false; }
}
