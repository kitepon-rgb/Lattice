import assert from 'node:assert/strict';
import test from 'node:test';

import {
  todoSelfDigest,
  validateTodoEvent,
} from '../src/todo-contracts.mjs';
import { buildTodoPlan } from '../src/todo-store.mjs';
import {
  todoCutoverArchiveSourceRef,
  todoLegacyReconciliationDigest,
  todoReconciliationDigest,
  todoRevisionPlanVersion,
  todoSourceInventoryDigest,
  validateTodoRevision,
} from '../src/todo-revision.mjs';

const DIGEST = '1'.repeat(64);
const HEAD = '2'.repeat(64);
const ACTOR = { host: 'host-1', session: 'session-1', agent: 'agent-1' };
const NOW = '2026-07-19T00:00:00.000Z';

const task = (taskId, parentTaskId = null) => ({
  task_id: taskId,
  title: taskId,
  lane: 'main',
  narrative_ref: null,
  narrative_anchor: null,
  compile_binding: null,
  parent_task_id: parentTaskId,
});

function revisionFixture({ taskMigration = [
  { from_task_id: 'A1', to_task_id: 'P1', state_policy: 'carry' },
  { from_task_id: 'A2', to_task_id: 'T1', state_policy: 'reset_pending' },
] } = {}) {
  const predecessor = { plan_digest: DIGEST, journal_head_digest: HEAD, plan_version: 'v1' };
  const desiredPlanInput = {
    schema: 'lattice.todo_plan.v3',
    project_id: 'project-1',
    plan_key: 'main',
    plan_version: 'pending',
    predecessor_plan_digest: DIGEST,
    tasks: [task('P1'), task('T1', 'P1')],
    hard_dependencies: [],
    joins: [],
  };
  const sourceInventory = {
    active: [
      { task_id: 'P1', source_ref: 'docs/plan.md#L1', source_digest: '3'.repeat(64) },
      { task_id: 'T1', source_ref: 'docs/plan.md#L2', source_digest: '4'.repeat(64) },
    ],
    excluded_tombstones: [{
      source_ref: 'docs/plan.md#L3', source_digest: '5'.repeat(64), exclusion_reason: 'retired',
    }],
  };
  desiredPlanInput.plan_version = todoRevisionPlanVersion({
    projectId: 'project-1', planKey: 'main', predecessor, desiredPlan: desiredPlanInput,
    taskMigration, sourceInventory,
  });
  const desiredPlan = buildTodoPlan(desiredPlanInput);
  const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
  const predecessorReconciliationDigest = todoLegacyReconciliationDigest({
    planDigest: predecessor.plan_digest,
    journalHeadDigest: predecessor.journal_head_digest,
  });
  const reconciliation = {
    predecessor_reconciliation_digest: predecessorReconciliationDigest,
    source_inventory_digest: sourceInventoryDigest,
    reconciliation_digest: todoReconciliationDigest({
      predecessorReconciliationDigest,
      sourceInventoryDigest,
      predecessor,
      desiredPlanDigest: desiredPlan.plan_digest,
      taskMigration,
    }),
  };
  const revision = {
    schema: 'lattice.todo_revision.v1', project_id: 'project-1', plan_key: 'main',
    predecessor, desired_plan: desiredPlan, task_migration: taskMigration,
    source_inventory: sourceInventory, reconciliation, revision_digest: '',
  };
  revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
  return revision;
}

function cutoverRevisionFixture() {
  const legacy = revisionFixture();
  const sourceCutoverBatch = {
    batch_id: 'batch-1',
    archive_ref: 'docs/archive/lattice-todos/main/batch-1.md',
    operations: [
      { task_id: 'P1', disposition: 'active', source_ref: 'docs/plan.md#L1',
        source_digest: '3'.repeat(64), live_replacement: '<!-- Lattice main/P1 -->' },
      { task_id: 'T1', disposition: 'active', source_ref: 'docs/plan.md#L2',
        source_digest: '4'.repeat(64), live_replacement: '<!-- Lattice main/T1 -->' },
      { task_id: null, disposition: 'excluded', source_ref: 'docs/plan.md#L3',
        source_digest: '5'.repeat(64), live_replacement: '<!-- Lattice excluded -->' },
    ],
    batch_digest: '',
  };
  sourceCutoverBatch.batch_digest = todoSelfDigest(sourceCutoverBatch, 'batch_digest');
  const desiredInput = {
    schema: legacy.desired_plan.schema,
    project_id: legacy.project_id,
    plan_key: legacy.plan_key,
    plan_version: 'pending',
    predecessor_plan_digest: legacy.predecessor.plan_digest,
    tasks: legacy.desired_plan.tasks.map((entry) => ({
      ...entry,
      narrative_ref: todoCutoverArchiveSourceRef(
        sourceCutoverBatch,
        entry.task_id === 'P1' ? 0 : 1,
      ),
    })),
    hard_dependencies: legacy.desired_plan.hard_dependencies,
    joins: legacy.desired_plan.joins,
  };
  const sourceInventory = {
    active: legacy.source_inventory.active.map((entry, index) => ({
      ...entry, source_ref: todoCutoverArchiveSourceRef(sourceCutoverBatch, index),
    })),
    excluded_tombstones: legacy.source_inventory.excluded_tombstones.map((entry) => ({
      ...entry, source_ref: todoCutoverArchiveSourceRef(sourceCutoverBatch, 2),
    })),
  };
  desiredInput.plan_version = todoRevisionPlanVersion({
    projectId: legacy.project_id, planKey: legacy.plan_key, predecessor: legacy.predecessor,
    desiredPlan: desiredInput, taskMigration: legacy.task_migration,
    sourceInventory, sourceCutoverBatch,
  });
  const desiredPlan = buildTodoPlan(desiredInput);
  const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
  const reconciliation = {
    predecessor_reconciliation_digest: legacy.reconciliation.predecessor_reconciliation_digest,
    source_inventory_digest: sourceInventoryDigest,
    reconciliation_digest: todoReconciliationDigest({
      predecessorReconciliationDigest: legacy.reconciliation.predecessor_reconciliation_digest,
      sourceInventoryDigest, predecessor: legacy.predecessor,
      desiredPlanDigest: desiredPlan.plan_digest, taskMigration: legacy.task_migration,
      sourceCutoverBatch,
    }),
  };
  const revision = {
    schema: 'lattice.todo_revision.v2', project_id: legacy.project_id, plan_key: legacy.plan_key,
    predecessor: legacy.predecessor, desired_plan: desiredPlan,
    task_migration: legacy.task_migration, source_inventory: sourceInventory,
    reconciliation, source_cutover_batch: sourceCutoverBatch, revision_digest: '',
  };
  revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
  return revision;
}

test('todo_revision.v1はv3 desired state・inventory・reconciliationをexact digest束縛する', () => {
  const revision = revisionFixture();
  assert.equal(validateTodoRevision(revision), true);
  for (const mutate of [
    (value) => { value.unknown = true; },
    (value) => { value.desired_plan.tasks[1].parent_task_id = 'missing'; },
    (value) => { value.task_migration[1].to_task_id = 'missing'; },
    (value) => { value.source_inventory.active.reverse(); },
    (value) => { value.reconciliation.source_inventory_digest = 'f'.repeat(64); },
    (value) => { value.revision_digest = 'f'.repeat(64); },
  ]) {
    const invalid = structuredClone(revision);
    mutate(invalid);
    assert.equal(validateTodoRevision(invalid), false);
  }
});

test('todo_revision.v2はper-ToDo source cutover batchをplan・inventory・narrativeへ束縛する', () => {
  const revision = cutoverRevisionFixture();
  assert.equal(validateTodoRevision(revision), true);
  assert.equal(todoCutoverArchiveSourceRef(revision.source_cutover_batch, 0),
    'docs/archive/lattice-todos/main/batch-1.md#L6');
  for (const mutate of [
    (value) => { value.source_cutover_batch.operations.reverse(); },
    (value) => { value.source_cutover_batch.operations[0].live_replacement = '- [ ] 復活'; },
    (value) => { value.source_cutover_batch.operations[0].source_digest = 'f'.repeat(64); },
    (value) => { value.source_inventory.active[0].source_ref = 'docs/plan.md#L1'; },
    (value) => { value.desired_plan.tasks[0].narrative_ref = 'docs/plan.md#L1'; },
    (value) => { value.source_cutover_batch.archive_ref = '../escape.md'; },
  ]) {
    const invalid = structuredClone(revision);
    mutate(invalid);
    invalid.source_cutover_batch.batch_digest = todoSelfDigest(
      invalid.source_cutover_batch, 'batch_digest',
    );
    invalid.revision_digest = todoSelfDigest(invalid, 'revision_digest');
    assert.equal(validateTodoRevision(invalid), false);
  }
});

test('revision plan versionは循環せず全入力から決まり移送先mergeを拒否する', () => {
  const revision = revisionFixture();
  const input = {
    projectId: revision.project_id,
    planKey: revision.plan_key,
    predecessor: revision.predecessor,
    desiredPlan: revision.desired_plan,
    taskMigration: revision.task_migration,
    sourceInventory: revision.source_inventory,
  };
  assert.equal(todoRevisionPlanVersion(input), revision.desired_plan.plan_version);
  assert.equal(todoRevisionPlanVersion(input), todoRevisionPlanVersion(structuredClone(input)));

  const changedInventory = structuredClone(input);
  changedInventory.sourceInventory.active[0].source_digest = 'a'.repeat(64);
  assert.notEqual(todoRevisionPlanVersion(changedInventory), revision.desired_plan.plan_version);

  const merged = revisionFixture({ taskMigration: [
    { from_task_id: 'A1', to_task_id: 'P1', state_policy: 'carry' },
    { from_task_id: 'A2', to_task_id: 'P1', state_policy: 'reset_pending' },
  ] });
  assert.equal(validateTodoRevision(merged), false);

  const malformedSource = structuredClone(revision);
  malformedSource.source_inventory.active[0].source_ref = 'docs/plan.md';
  malformedSource.revision_digest = todoSelfDigest(malformedSource, 'revision_digest');
  assert.equal(validateTodoRevision(malformedSource), false);
});

test('legacy reconciliation anchorはv1 bytesを書換えずplan/head identityだけから決定する', () => {
  const first = todoLegacyReconciliationDigest({ planDigest: DIGEST, journalHeadDigest: HEAD });
  const second = todoLegacyReconciliationDigest({ planDigest: DIGEST, journalHeadDigest: HEAD });
  assert.equal(first, second);
  assert.notEqual(first, todoLegacyReconciliationDigest({
    planDigest: DIGEST, journalHeadDigest: 'a'.repeat(64),
  }));
});

test('todo_event.v2 genesisはsorted state migrationとcarry stateをself digest検証する', () => {
  const revision = revisionFixture();
  const event = {
    schema: 'lattice.todo_event.v2', project_id: 'project-1', plan_key: 'main', plan_version: 'v2',
    sequence: 0, previous_digest: HEAD, kind: 'plan_genesis', task_id: null, actor: ACTOR,
    recorded_at: NOW, provenance: null,
    payload: {
      plan_digest: revision.desired_plan.plan_digest,
      topology_digest: revision.desired_plan.topology_digest,
      predecessor_plan_digest: DIGEST,
      task_migration: revision.task_migration.map(({ from_task_id, to_task_id }) => ({
        from_task_id, to_task_id,
      })),
    },
    reconciliation_state: 'reconciled', revision_digest: revision.revision_digest,
    reconciliation_digest: revision.reconciliation.reconciliation_digest,
    state_migration: [
      {
        from_task_id: 'A1', to_task_id: 'P1', state_policy: 'carry',
        state: { status: 'done', started_at: NOW, done_at: NOW, blocked_reason: null,
          evidence: { evidence_id: 'ev-1', repo_id: 'self', path: 'evidence.txt',
            git_blob_oid: '1'.repeat(40), content_digest: '6'.repeat(64), media_type: 'text/plain',
            anchor_digest: null }, imported: false },
      },
      { from_task_id: 'A2', to_task_id: 'T1', state_policy: 'reset_pending', state: null },
    ],
    event_digest: '',
  };
  event.event_digest = todoSelfDigest(event, 'event_digest');
  assert.equal(validateTodoEvent(event), true);
  const invalid = structuredClone(event);
  invalid.state_migration.reverse();
  invalid.event_digest = todoSelfDigest(invalid, 'event_digest');
  assert.equal(validateTodoEvent(invalid), false);
});
