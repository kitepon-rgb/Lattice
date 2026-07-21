import {
  canonicalizeTodoArtifact,
  digestTodoArtifact,
  exactRecord,
  isTodoDigest,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
  validateTodoPlan,
} from './todo-contracts.mjs';

const REVISION_V1_KEYS = [
  'schema', 'project_id', 'plan_key', 'predecessor', 'desired_plan', 'task_migration',
  'source_inventory', 'reconciliation', 'revision_digest',
];
const REVISION_V2_KEYS = [...REVISION_V1_KEYS, 'source_cutover_batch'];
const PHASE_REVISION_KEYS = [
  'schema', 'project_id', 'plan_key', 'predecessor', 'desired_plan', 'task_migration',
  'phase_migration', 'revision_digest',
];
const PHASE_REVISION_V3_KEYS = [
  'schema', 'project_id', 'plan_key', 'predecessor', 'desired_plan',
  'runtime_task_migration', 'task_migration', 'phase_migration', 'source_inventory',
  'reconciliation', 'source_cutover_batch', 'revision_digest',
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
  sourceCutoverBatch = undefined,
}) {
  const versionDigest = digestTodoArtifact({
    schema: sourceCutoverBatch === undefined
      ? 'lattice.todo_revision_version.v1' : 'lattice.todo_revision_version.v2',
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
    ...(sourceCutoverBatch === undefined ? {} : { source_cutover_batch: sourceCutoverBatch }),
  });
  return `rev-${versionDigest.slice(0, 24)}`;
}

export function phaseTodoRevisionPlanVersion({
  projectId, planKey, predecessor, desiredPlan, taskMigration, phaseMigration,
}) {
  const versionDigest = digestTodoArtifact({
    schema: desiredPlan.schema === 'lattice.todo_plan.v5'
      ? 'lattice.phase_todo_revision_version.v2' : 'lattice.phase_todo_revision_version.v1', project_id: projectId,
    plan_key: planKey, predecessor, desired_topology: {
      schema: desiredPlan.schema, project_id: desiredPlan.project_id,
      plan_key: desiredPlan.plan_key, predecessor_plan_digest: desiredPlan.predecessor_plan_digest,
      tasks: desiredPlan.tasks, phases: desiredPlan.phases,
      hard_dependencies: desiredPlan.hard_dependencies, joins: desiredPlan.joins,
      ...(desiredPlan.schema === 'lattice.todo_plan.v5'
        ? { phase_accept_dependencies: desiredPlan.phase_accept_dependencies } : {}),
    }, task_migration: taskMigration, phase_migration: phaseMigration,
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
  sourceCutoverBatch = undefined,
}) {
  if (!isTodoDigest(predecessorReconciliationDigest) || !isTodoDigest(sourceInventoryDigest)
    || !isTodoDigest(desiredPlanDigest)) throw new TypeError('reconciliation digest input invalid');
  return digestTodoArtifact({
    schema: sourceCutoverBatch === undefined
      ? 'lattice.todo_reconciliation_binding.v1' : 'lattice.todo_reconciliation_binding.v2',
    predecessor_reconciliation_digest: predecessorReconciliationDigest,
    source_inventory_digest: sourceInventoryDigest,
    predecessor,
    desired_plan_digest: desiredPlanDigest,
    task_migration_digest: digestTodoArtifact(taskMigration),
    ...(sourceCutoverBatch === undefined ? {} : {
      source_cutover_batch_digest: sourceCutoverBatch.batch_digest,
    }),
  });
}

export function todoCutoverArchiveSourceRef(batch, index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('cutover operation index invalid');
  return `${batch.archive_ref}#L${index + 6}`;
}

function validLiveReplacement(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4_096
    && !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    && !/^[\t ]*(?:[-+*]|\d+[A-Za-z]?\.|\d+\))[\t ]+\[[ xX]\](?:[\t ]+.*)?$/u.test(value);
}

function validSourceCutoverBatch(value, revision) {
  if (!exactRecord(value, ['batch_id', 'archive_ref', 'operations', 'batch_digest'])
    || !isTodoIdentifier(value.batch_id) || !isTodoRef(value.archive_ref)
    || !value.archive_ref.endsWith('.md') || parseTodoSourceRef(value.archive_ref) !== null
    || !Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 512
    || !isTodoDigest(value.batch_digest)
    || value.batch_digest !== todoSelfDigest(value, 'batch_digest')) return false;
  const sourceRefs = new Set();
  const activeTaskIds = new Set();
  for (const [index, operation] of value.operations.entries()) {
    if (!exactRecord(operation, [
      'task_id', 'disposition', 'source_ref', 'source_digest', 'live_replacement',
    ]) || !['active', 'excluded'].includes(operation.disposition)
      || (operation.disposition === 'active' ? !isTodoIdentifier(operation.task_id) : operation.task_id !== null)
      || parseTodoSourceRef(operation.source_ref) === null || !isTodoDigest(operation.source_digest)
      || !validLiveReplacement(operation.live_replacement)
      || sourceRefs.has(operation.source_ref)
      || (index > 0 && compareText(value.operations[index - 1].source_ref, operation.source_ref) >= 0)) return false;
    sourceRefs.add(operation.source_ref);
    const archivedSourceRef = todoCutoverArchiveSourceRef(value, index);
    if (operation.disposition === 'active') {
      if (activeTaskIds.has(operation.task_id)) return false;
      activeTaskIds.add(operation.task_id);
      const inventory = revision.source_inventory.active.find(({ task_id }) => task_id === operation.task_id);
      const task = revision.desired_plan.tasks.find(({ task_id }) => task_id === operation.task_id);
      if (inventory?.source_ref !== archivedSourceRef
        || inventory.source_digest !== operation.source_digest
        || task?.narrative_ref !== archivedSourceRef) return false;
    } else {
      const tombstone = revision.source_inventory.excluded_tombstones.find((entry) => (
        entry.source_ref === archivedSourceRef && entry.source_digest === operation.source_digest
      ));
      if (tombstone === undefined) return false;
    }
  }
  return true;
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
        || (['carry', 'carry_reconciled_metadata', 'reset_pending'].includes(entry.state_policy)
          && entry.to_task_id !== 'removed')))
    && new Set(value.map(({ from_task_id }) => from_task_id)).size === value.length
    && new Set(activeTargets).size === activeTargets.length
    && value.every((entry, index) => index === 0
      || compareText(value[index - 1].from_task_id, entry.from_task_id) < 0);
}

function validPhaseMigration(value, desiredPlan) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512
    || !value.every((entry) => exactRecord(entry, [
      'from_phase_id', 'to_phase_id', 'state_policy',
    ]) && (entry.from_phase_id === null || isTodoIdentifier(entry.from_phase_id))
      && (entry.to_phase_id === 'removed' || isTodoIdentifier(entry.to_phase_id))
      && ['carry', 'reset', 'removed'].includes(entry.state_policy)
      && (entry.state_policy !== 'carry' || (entry.from_phase_id !== null && entry.to_phase_id !== 'removed'))
      && (entry.state_policy !== 'removed' || (entry.from_phase_id !== null && entry.to_phase_id === 'removed'))
      && (entry.state_policy !== 'reset' || entry.to_phase_id !== 'removed'))) return false;
  const sources = value.filter(({ from_phase_id }) => from_phase_id !== null).map(({ from_phase_id }) => from_phase_id);
  const targets = value.filter(({ to_phase_id }) => to_phase_id !== 'removed').map(({ to_phase_id }) => to_phase_id);
  return new Set(sources).size === sources.length && new Set(targets).size === targets.length
    && canonicalizeForCompare(targets) === canonicalizeForCompare(desiredPlan.phases.map(({ phase_id }) => phase_id));
}

function canonicalizeForCompare(value) {
  return canonicalizeTodoArtifact([...value].sort((left, right) => compareText(
    canonicalizeTodoArtifact(left), canonicalizeTodoArtifact(right),
  )));
}

function todoTaskMigrationDigest(taskMigration) {
  return todoSelfDigest({ task_migration: taskMigration, task_migration_digest: '' },
    'task_migration_digest');
}

function validRuntimeTaskMigration(value) {
  if (!exactRecord(value, ['schema', 'entries', 'migration_digest'])
    || value.schema !== 'lattice.runtime_task_migration.v1'
    || !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 512
    || !isTodoDigest(value.migration_digest)
    || value.migration_digest !== todoSelfDigest(value, 'migration_digest')) return false;
  const targets = [];
  for (const [index, entry] of value.entries.entries()) {
    if (!exactRecord(entry, [
      'predecessor_task_id', 'disposition', 'successor_task_ids', 'reason', 'evidence_digests',
    ]) || !isTodoIdentifier(entry.predecessor_task_id)
      || !['carry', 'stay', 'replace', 'split', 'retire'].includes(entry.disposition)
      || !Array.isArray(entry.successor_task_ids) || entry.successor_task_ids.length > 512
      || !entry.successor_task_ids.every(isTodoIdentifier)
      || new Set(entry.successor_task_ids).size !== entry.successor_task_ids.length
      || entry.successor_task_ids.some((id, targetIndex) => targetIndex > 0
        && compareText(entry.successor_task_ids[targetIndex - 1], id) >= 0)
      || !boundedText(entry.reason) || !Array.isArray(entry.evidence_digests)
      || entry.evidence_digests.length < 1 || entry.evidence_digests.length > 512
      || !entry.evidence_digests.every(isTodoDigest)
      || new Set(entry.evidence_digests).size !== entry.evidence_digests.length
      || entry.evidence_digests.some((digest, digestIndex) => digestIndex > 0
        && compareText(entry.evidence_digests[digestIndex - 1], digest) >= 0)
      || (index > 0 && compareText(value.entries[index - 1].predecessor_task_id,
        entry.predecessor_task_id) >= 0)) return false;
    if (['carry', 'stay'].includes(entry.disposition)
      && (entry.successor_task_ids.length !== 1
        || entry.successor_task_ids[0] !== entry.predecessor_task_id)) return false;
    if (entry.disposition === 'retire' && entry.successor_task_ids.length !== 0) return false;
    if (['replace', 'split'].includes(entry.disposition) && entry.successor_task_ids.length === 0) return false;
    targets.push(...entry.successor_task_ids);
  }
  return new Set(targets).size === targets.length;
}

function projectRuntimeTaskMigration(value) {
  return value.entries.map((entry) => {
    if (['carry', 'stay'].includes(entry.disposition)) return {
      from_task_id: entry.predecessor_task_id,
      to_task_id: entry.predecessor_task_id,
      state_policy: 'carry',
    };
    if (entry.disposition === 'retire') return {
      from_task_id: entry.predecessor_task_id, to_task_id: 'removed', state_policy: 'removed',
    };
    return { from_task_id: entry.predecessor_task_id,
      to_task_id: entry.successor_task_ids[0], state_policy: 'reset_pending' };
  });
}

function validRuntimeTodoProjection(runtimeMigration, taskMigration) {
  const projected = projectRuntimeTaskMigration(runtimeMigration);
  return projected.length === taskMigration.length && projected.every((expected, index) => {
    const actual = taskMigration[index];
    return expected.from_task_id === actual.from_task_id && expected.to_task_id === actual.to_task_id
      && (expected.state_policy === 'carry'
        ? ['carry', 'carry_reconciled_metadata'].includes(actual.state_policy)
        : expected.state_policy === actual.state_policy);
  });
}

export function validatePhaseTodoRevision(value) {
  try {
    const revisionV1 = value?.schema === 'lattice.phase_todo_revision.v1';
    const revisionV2 = value?.schema === 'lattice.phase_todo_revision.v2';
    const revisionV3 = value?.schema === 'lattice.phase_todo_revision.v3';
    const keys = revisionV3 ? PHASE_REVISION_V3_KEYS : PHASE_REVISION_KEYS;
    if (!exactRecord(value, keys) || (!revisionV1 && !revisionV2 && !revisionV3)) return false;
    if (!isTodoIdentifier(value.project_id) || !isTodoIdentifier(value.plan_key)) return false;
    if (!validPredecessor(value.predecessor) || !validateTodoPlan(value.desired_plan)
      || value.desired_plan.schema !== ((revisionV2 || revisionV3)
        ? 'lattice.todo_plan.v5' : 'lattice.todo_plan.v4')
      || value.desired_plan.project_id !== value.project_id
      || value.desired_plan.plan_key !== value.plan_key
      || value.desired_plan.predecessor_plan_digest !== value.predecessor.plan_digest
      || !validTaskMigration(value.task_migration)
      || !validPhaseMigration(value.phase_migration, value.desired_plan)) return false;
    if (value.desired_plan.plan_version !== phaseTodoRevisionPlanVersion({
        projectId: value.project_id, planKey: value.plan_key, predecessor: value.predecessor,
        desiredPlan: value.desired_plan, taskMigration: value.task_migration,
        phaseMigration: value.phase_migration,
      })) return false;
    if (revisionV3) {
      if (!validRuntimeTaskMigration(value.runtime_task_migration)
        || !validRuntimeTodoProjection(value.runtime_task_migration, value.task_migration)
        || canonicalizeForCompare(value.runtime_task_migration.entries
          .flatMap(({ successor_task_ids: ids }) => ids))
          !== canonicalizeForCompare(value.desired_plan.tasks.map(({ task_id: id }) => id))
        || !validSourceInventory(value.source_inventory, value.desired_plan,
          { requireNarrativeRef: true })
        || !validSourceCutoverBatch(value.source_cutover_batch, value)
        || !exactRecord(value.reconciliation, [
          'predecessor_reconciliation_digest', 'source_inventory_digest', 'desired_plan_digest',
          'runtime_task_migration_digest', 'task_migration_digest', 'phase_migration_digest',
          'source_cutover_batch_digest', 'reconciliation_digest',
        ]) || !isTodoDigest(value.reconciliation.predecessor_reconciliation_digest)
        || value.reconciliation.source_inventory_digest !== todoSourceInventoryDigest(value.source_inventory)
        || value.reconciliation.desired_plan_digest !== value.desired_plan.plan_digest
        || value.reconciliation.runtime_task_migration_digest !== value.runtime_task_migration.migration_digest
        || value.reconciliation.task_migration_digest !== todoTaskMigrationDigest(value.task_migration)
        || value.reconciliation.phase_migration_digest !== digestTodoArtifact(value.phase_migration)
        || value.reconciliation.source_cutover_batch_digest !== value.source_cutover_batch.batch_digest
        || value.reconciliation.reconciliation_digest
          !== todoSelfDigest(value.reconciliation, 'reconciliation_digest')) return false;
    }
    return isTodoDigest(value.revision_digest)
      && value.revision_digest === todoSelfDigest(value, 'revision_digest');
  } catch { return false; }
}

function validSourceInventory(value, desiredPlan, { requireNarrativeRef = false } = {}) {
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
    && (!requireNarrativeRef || value.active.every((entry) => desiredPlan.tasks
      .find(({ task_id }) => task_id === entry.task_id)?.narrative_ref === entry.source_ref))
    && activeRefSet.size === activeRefs.length
    && new Set(tombstoneRefs).size === tombstoneRefs.length
    && tombstoneRefs.every((ref) => !activeRefSet.has(ref))
    && value.excluded_tombstones.every((entry, index) => index === 0
      || compareText(value.excluded_tombstones[index - 1].source_ref, entry.source_ref) < 0);
}

export function validateTodoRevision(value) {
  try {
    const revisionV1 = value?.schema === 'lattice.todo_revision.v1';
    const revisionV2 = value?.schema === 'lattice.todo_revision.v2';
    const sourceCutoverBatch = revisionV2 ? value.source_cutover_batch : undefined;
    if ((!revisionV1 && !revisionV2)
      || !exactRecord(value, revisionV1 ? REVISION_V1_KEYS : REVISION_V2_KEYS)
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
        sourceInventory: value.source_inventory, sourceCutoverBatch,
      }) || !exactRecord(value.reconciliation, [
        'predecessor_reconciliation_digest', 'source_inventory_digest', 'reconciliation_digest',
      ]) || !isTodoDigest(value.reconciliation.predecessor_reconciliation_digest)
      || value.reconciliation.source_inventory_digest !== todoSourceInventoryDigest(value.source_inventory)
      || value.reconciliation.reconciliation_digest !== todoReconciliationDigest({
        predecessorReconciliationDigest: value.reconciliation.predecessor_reconciliation_digest,
        sourceInventoryDigest: value.reconciliation.source_inventory_digest,
        predecessor: value.predecessor,
        desiredPlanDigest: value.desired_plan.plan_digest,
        taskMigration: value.task_migration, sourceCutoverBatch,
      })) return false;
    if (revisionV2 && !validSourceCutoverBatch(value.source_cutover_batch, value)) return false;
    const targets = new Set(value.desired_plan.tasks.map(({ task_id }) => task_id));
    if (value.task_migration.some(({ to_task_id }) => to_task_id !== 'removed' && !targets.has(to_task_id))) return false;
    return isTodoDigest(value.revision_digest)
      && value.revision_digest === todoSelfDigest(value, 'revision_digest');
  } catch { return false; }
}

export function validateTodoRevisionSet(value) {
  try {
    const setV1 = value?.schema === 'lattice.todo_revision_set.v1';
    const setV2 = value?.schema === 'lattice.todo_revision_set.v2';
    const setV3 = value?.schema === 'lattice.todo_revision_set.v3';
    return exactRecord(value, [
      'schema', 'project_id', 'revisions', 'revision_set_digest',
    ])
      && (setV1 || setV2 || setV3)
      && isTodoIdentifier(value.project_id)
      && Array.isArray(value.revisions)
      && value.revisions.length >= 2
      && value.revisions.length <= 64
      && value.revisions.every((revision) => (
        (validateTodoRevision(revision)
          && (setV2 || setV3 || revision.schema === 'lattice.todo_revision.v1'))
        || (setV3 && ['lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2']
          .includes(revision.schema) && validatePhaseTodoRevision(revision))
      ) && revision.project_id === value.project_id)
      && (!setV2 || value.revisions.some((revision) => revision.schema === 'lattice.todo_revision.v2'))
      && (!setV3 || value.revisions.some((revision) => [
        'lattice.phase_todo_revision.v1', 'lattice.phase_todo_revision.v2',
      ].includes(revision.schema)))
      && value.revisions.every((revision, index) => index === 0
        || compareText(value.revisions[index - 1].plan_key, revision.plan_key) < 0)
      && isTodoDigest(value.revision_set_digest)
      && value.revision_set_digest === todoSelfDigest(value, 'revision_set_digest');
  } catch { return false; }
}
