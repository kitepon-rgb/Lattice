import assert from 'node:assert/strict';
import test from 'node:test';

import {
  todoSelfDigest,
  validateTodoEvent,
} from '../src/todo-contracts.mjs';
import { buildTodoPlan } from '../src/todo-store.mjs';
import {
  todoLegacyReconciliationDigest,
  todoReconciliationDigest,
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

function revisionFixture() {
  const predecessor = { plan_digest: DIGEST, journal_head_digest: HEAD, plan_version: 'v1' };
  const desiredPlan = buildTodoPlan({
    schema: 'lattice.todo_plan.v3',
    project_id: 'project-1',
    plan_key: 'main',
    plan_version: 'v2',
    predecessor_plan_digest: DIGEST,
    tasks: [task('P1'), task('T1', 'P1')],
    hard_dependencies: [],
    joins: [],
  });
  const taskMigration = [
    { from_task_id: 'A1', to_task_id: 'P1', state_policy: 'carry' },
    { from_task_id: 'A2', to_task_id: 'T1', state_policy: 'reset_pending' },
  ];
  const sourceInventory = {
    active: [
      { task_id: 'P1', source_ref: 'docs/plan.md/P1', source_digest: '3'.repeat(64) },
      { task_id: 'T1', source_ref: 'docs/plan.md/T1', source_digest: '4'.repeat(64) },
    ],
    excluded_tombstones: [{
      source_ref: 'docs/plan.md/old', source_digest: '5'.repeat(64), exclusion_reason: 'retired',
    }],
  };
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
