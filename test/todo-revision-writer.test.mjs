import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  TodoStoreError,
  appendImportedPlan,
  applyTodoRevision,
  appendTodoEvent,
  buildTodoPlan,
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoStore,
} from '../src/todo-store.mjs';
import {
  todoLegacyReconciliationDigest,
  todoReconciliationDigest,
  todoRevisionPlanVersion,
  todoSourceInventoryDigest,
} from '../src/todo-revision.mjs';

const NOW = '2026-07-19T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
const task = (taskId, title = taskId) => ({
  task_id: taskId, title, lane: 'main', narrative_ref: null,
  narrative_anchor: null, compile_binding: null, parent_task_id: null,
});
const ref = (taskId) => ({ project_id: 'project-1', plan_key: 'main', task_id: taskId });
const digest = (text) => createHash('sha256').update(text).digest('hex');

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-revision-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeFile(path.join(root, 'plan.md'), [1, 2, 3, 4, 5, 6]
    .map((index) => `- [ ] T${index}`).join('\n') + '\n');
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }], now: NOW,
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v3', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [task('T1'), task('T2'), task('T3'), task('T4'), task('T5')],
        hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
  });
  return root;
}

async function revisionFor(root, { title = 'T1', migrationPolicy = 'carry' } = {}) {
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  const previous = store.members[0];
  const predecessor = {
    plan_digest: previous.plan.plan_digest,
    journal_head_digest: previous.journal.events.at(-1).event_digest,
    plan_version: previous.plan.plan_version,
  };
  const taskMigration = [
    { from_task_id: 'T1', to_task_id: 'T1', state_policy: migrationPolicy },
    { from_task_id: 'T2', to_task_id: 'T2', state_policy: 'carry' },
    { from_task_id: 'T3', to_task_id: 'T3', state_policy: 'carry' },
    { from_task_id: 'T4', to_task_id: 'T4', state_policy: 'carry' },
    { from_task_id: 'T5', to_task_id: 'T5', state_policy: 'reset_pending' },
  ];
  const sourceInventory = {
    active: [
      { task_id: 'T1', source_ref: 'plan.md#L1', source_digest: digest('- [ ] T1') },
      { task_id: 'T2', source_ref: 'plan.md#L2', source_digest: digest('- [ ] T2') },
      { task_id: 'T3', source_ref: 'plan.md#L3', source_digest: digest('- [ ] T3') },
      { task_id: 'T4', source_ref: 'plan.md#L4', source_digest: digest('- [ ] T4') },
      { task_id: 'T5', source_ref: 'plan.md#L5', source_digest: digest('- [ ] T5') },
      { task_id: 'T6', source_ref: 'plan.md#L6', source_digest: digest('- [ ] T6') },
    ],
    excluded_tombstones: [],
  };
  const desiredInput = {
    schema: 'lattice.todo_plan.v3', project_id: 'project-1', plan_key: 'main',
    plan_version: 'pending', predecessor_plan_digest: predecessor.plan_digest,
    tasks: [task('T1', title), task('T2'), task('T3'), task('T4'), task('T5'), task('T6')],
    hard_dependencies: [], joins: [],
  };
  desiredInput.plan_version = todoRevisionPlanVersion({
    projectId: 'project-1', planKey: 'main', predecessor, desiredPlan: desiredInput,
    taskMigration, sourceInventory,
  });
  const desiredPlan = buildTodoPlan(desiredInput);
  const predecessorReconciliationDigest = todoLegacyReconciliationDigest({
    planDigest: predecessor.plan_digest, journalHeadDigest: predecessor.journal_head_digest,
  });
  const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
  const reconciliation = {
    predecessor_reconciliation_digest: predecessorReconciliationDigest,
    source_inventory_digest: sourceInventoryDigest,
    reconciliation_digest: todoReconciliationDigest({
      predecessorReconciliationDigest, sourceInventoryDigest, predecessor,
      desiredPlanDigest: desiredPlan.plan_digest, taskMigration,
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

function pinnedLegacyCommit(root) {
  const content = '- [x] H1\n- [ ] H2\n';
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root, input: content, encoding: 'utf8',
  }).trim();
  const tree = execFileSync('git', ['mktree'], {
    cwd: root, input: `100644 blob ${blob}\tlegacy.md\n`, encoding: 'utf8',
  }).trim();
  return execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: root,
    input: `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1760000000 +0000\ncommitter Fixture <fixture@example.invalid> 1760000000 +0000\n\nfixture\n`,
    encoding: 'utf8',
  }).trim();
}

async function historicalRevisionFor(root) {
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  const previous = store.members.find(({ plan }) => plan.plan_key === 'archive');
  const predecessor = { plan_digest: previous.plan.plan_digest,
    journal_head_digest: previous.journal.events.at(-1).event_digest,
    plan_version: previous.plan.plan_version };
  const taskMigration = [
    { from_task_id: 'H1', to_task_id: 'H1', state_policy: 'carry' },
    { from_task_id: 'H2', to_task_id: 'H2', state_policy: 'carry' },
  ];
  const sourceInventory = { active: [
    { task_id: 'H1', source_ref: 'reconcile.md#L1', source_digest: digest('- [x] H1') },
    { task_id: 'H2', source_ref: 'reconcile.md#L2', source_digest: digest('- [ ] H2') },
  ], excluded_tombstones: [] };
  const desiredInput = { schema: 'lattice.todo_plan.v3', project_id: 'project-1',
    plan_key: 'archive', plan_version: 'pending', predecessor_plan_digest: predecessor.plan_digest,
    tasks: [task('H1'), task('H2')], hard_dependencies: [], joins: [] };
  desiredInput.plan_version = todoRevisionPlanVersion({ projectId: 'project-1', planKey: 'archive',
    predecessor, desiredPlan: desiredInput, taskMigration, sourceInventory });
  const desiredPlan = buildTodoPlan(desiredInput);
  const predecessorReconciliationDigest = todoLegacyReconciliationDigest({
    planDigest: predecessor.plan_digest, journalHeadDigest: predecessor.journal_head_digest,
  });
  const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
  const reconciliation = { predecessor_reconciliation_digest: predecessorReconciliationDigest,
    source_inventory_digest: sourceInventoryDigest,
    reconciliation_digest: todoReconciliationDigest({ predecessorReconciliationDigest,
      sourceInventoryDigest, predecessor, desiredPlanDigest: desiredPlan.plan_digest, taskMigration }) };
  const revision = { schema: 'lattice.todo_revision.v1', project_id: 'project-1',
    plan_key: 'archive', predecessor, desired_plan: desiredPlan, task_migration: taskMigration,
    source_inventory: sourceInventory, reconciliation, revision_digest: '' };
  revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
  return revision;
}

const apply = (root, revision, extra = {}) => applyTodoRevision({
  repoRoot: root, writer, revision, actor: ACTOR, recordedAt: NOW, now: NOW, ...extra,
});

test('revision writerはv2 genesisからcarry/reset/source-seeded stateを投影しretryを冪等化する', async (context) => {
  const root = await fixture(context);
  const revision = await revisionFor(root);
  const oldJournal = await readFile(path.join(root, '.lattice/todo/plans/main/v1/journal/active.jsonl'));
  const first = await apply(root, revision);
  const second = await apply(root, revision);
  assert.deepEqual(second, first);
  assert.equal(first.schema, 'lattice.todo_revise_result.v1');
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  assert.equal(store.members[0].journal.events[0].schema, 'lattice.todo_event.v2');
  assert.equal(store.members[0].journal.events[0].reconciliation_state, 'reconciled');
  assert.deepEqual(store.members[0].tasks.map(({ task_id, status }) => [task_id, status]), [
    ['T1', 'pending'], ['T2', 'pending'], ['T3', 'pending'], ['T4', 'pending'],
    ['T5', 'pending'], ['T6', 'pending'],
  ]);
  assert.deepEqual(await readFile(path.join(root, '.lattice/todo/plans/main/v1/journal/active.jsonl')), oldJournal);
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T6', actor: ACTOR, recorded_at: NOW,
      payload: { override_reason: null } } });
  const transitioned = (await readTodoStore({ repoRoot: root, now: NOW })).members[0];
  assert.deepEqual(transitioned.journal.events.map(({ schema }) => schema), [
    'lattice.todo_event.v2', 'lattice.todo_event.v1',
  ]);
  assert.equal(transitioned.tasks.find(({ task_id }) => task_id === 'T6').status, 'in-progress');
});

test('同じpredecessorへ異なるrevision bytesを発行したretryはconflictにする', async (context) => {
  const root = await fixture(context);
  const accepted = await revisionFor(root);
  const competing = await revisionFor(root, { title: 'changed', migrationPolicy: 'reset_pending' });
  await apply(root, accepted);
  await assert.rejects(apply(root, competing), (error) => error instanceof TodoStoreError
    && error.code === 'REVISION_CONFLICT' && error.detail.reason === 'revision_bytes_conflict');
});

test('未activation transactionがある同じpredecessorへ別revisionを発行しない', async (context) => {
  const root = await fixture(context);
  const interrupted = await revisionFor(root);
  const competing = await revisionFor(root, { title: 'changed', migrationPolicy: 'reset_pending' });
  await assert.rejects(apply(root, interrupted, {
    onProtocolStage: (stage) => { if (stage === 'revision_marker_durable') throw new Error('crash'); },
  }), /crash/u);
  await assert.rejects(apply(root, competing), (error) => error instanceof TodoStoreError
    && error.code === 'REVISION_CONFLICT' && error.detail.reason === 'revision_bytes_conflict');
  await apply(root, interrupted);
});

test('carryはpending・in-progress・blocked・doneを保ちresetとsource-seededだけpending化する', async (context) => {
  const root = await fixture(context);
  const proof = Buffer.from('verified proof\n');
  const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root, input: proof, encoding: 'utf8',
  }).trim();
  const evidence = {
    evidence_id: 'ev-1', repo_id: 'self', path: 'proof.txt', git_blob_oid: oid,
    content_digest: digest(proof), media_type: 'text/plain', anchor_digest: null,
  };
  for (const taskId of ['T2', 'T3', 'T4', 'T5']) {
    await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
      event: { kind: 'start', task_id: taskId, actor: ACTOR, recorded_at: NOW,
        payload: { override_reason: null } } });
  }
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'block', task_id: 'T3', actor: ACTOR, recorded_at: NOW,
      payload: { reason: 'waiting' } } });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'done', task_id: 'T4', actor: ACTOR, recorded_at: NOW,
      payload: { evidence } } });

  const revision = await revisionFor(root);
  await apply(root, revision);
  const member = (await readTodoStore({ repoRoot: root, now: NOW })).members[0];
  const states = new Map(member.tasks.map((state) => [state.task_id, state]));
  assert.equal(states.get('T1').status, 'pending');
  assert.equal(states.get('T2').status, 'in-progress');
  assert.equal(states.get('T2').started_at, NOW);
  assert.equal(states.get('T3').status, 'blocked');
  assert.equal(states.get('T3').blocked_reason, 'waiting');
  assert.equal(states.get('T4').status, 'done');
  assert.deepEqual(states.get('T4').evidence, evidence);
  assert.equal(states.get('T5').status, 'pending');
  assert.equal(states.get('T5').started_at, null);
  assert.equal(states.get('T6').status, 'pending');
  assert.equal(member.journal.events[0].state_migration
    .find(({ from_task_id }) => from_task_id === 'T5').state, null);
});

test('historical importのdone・in-progress stateとsource evidenceもv2 genesisへcarryする', async (context) => {
  const root = await fixture(context);
  const sourceCommit = pinnedLegacyCommit(root);
  const source = (originLine) => ({ schema: 'lattice.todo_import_source.v1',
    origin_plan_ref: 'legacy.md', origin_line: originLine, source_commit: sourceCommit });
  await appendImportedPlan({ repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    now: NOW, plan: { schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'archive',
      plan_version: 'v1', predecessor_plan_digest: null,
      tasks: [
        { task_id: 'H1', title: 'H1', lane: 'main', narrative_ref: null, compile_binding: null },
        { task_id: 'H2', title: 'H2', lane: 'main', narrative_ref: null, compile_binding: null },
      ], hard_dependencies: [], joins: [] }, genesis: { actor: ACTOR, recorded_at: NOW },
    completedTasks: [{ task_id: 'H1', completed_at: NOW, evidence: source(1) }],
    inProgressTasks: [{ task_id: 'H2', started_at: NOW, evidence: source(2) }],
  });
  await writeFile(path.join(root, 'reconcile.md'), '- [x] H1\n- [ ] H2\n');
  const revision = await historicalRevisionFor(root);
  await apply(root, revision);
  const member = (await readTodoStore({ repoRoot: root, now: NOW })).members
    .find(({ plan }) => plan.plan_key === 'archive');
  assert.deepEqual(member.tasks.map(({ task_id, status, imported }) => [task_id, status, imported]), [
    ['H1', 'done', true], ['H2', 'in-progress', true],
  ]);
  assert.equal(member.journal.events[0].state_migration[0].state.evidence.source_commit, sourceCommit);
  assert.equal(member.journal.events[0].state_migration[1].state.evidence.source_commit, sourceCommit);
});

test('carryは意味変更を拒否しsource digest不一致はactivation前に拒否する', async (context) => {
  const root = await fixture(context);
  const changed = await revisionFor(root, { title: 'changed' });
  await assert.rejects(apply(root, changed), (error) => error instanceof TodoStoreError
    && error.code === 'REVISION_INVALID' && error.detail.reason === 'carry_semantics_changed');
  const revision = await revisionFor(root);
  await writeFile(path.join(root, 'plan.md'), [
    '- [x] T1', '- [ ] T2', '- [ ] T3', '- [ ] T4', '- [ ] T5', '- [ ] T6',
  ].join('\n') + '\n');
  await assert.rejects(apply(root, revision), (error) => error instanceof TodoStoreError
    && error.code === 'RECONCILIATION_INCOMPLETE' && error.detail.reason === 'source_digest_mismatch');
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  assert.equal(store.members[0].plan.plan_version, 'v1');
});

test('source inventoryはrepo内symlinkを辿らずactivation前に拒否する', async (context) => {
  const root = await fixture(context);
  const revision = await revisionFor(root);
  await writeFile(path.join(root, 'actual.md'), [1, 2, 3, 4, 5, 6]
    .map((index) => `- [ ] T${index}`).join('\n') + '\n');
  await unlink(path.join(root, 'plan.md'));
  await symlink('actual.md', path.join(root, 'plan.md'));
  await assert.rejects(apply(root, revision), (error) => error instanceof TodoStoreError
    && error.code === 'RECONCILIATION_INCOMPLETE' && error.detail.reason === 'source_path_symlink');
});

for (const stage of [
  'revision_marker_durable', 'revision_input_durable', 'revision_plan_durable', 'revision_genesis_durable',
  'revision_snapshot_durable', 'revision_manifest_activated',
]) {
  test(`revision crash recoveryは${stage}からexact retryで完遂する`, async (context) => {
    const root = await fixture(context);
    const revision = await revisionFor(root);
    await assert.rejects(apply(root, revision, {
      onProtocolStage: (current) => { if (current === stage) throw new Error(`crash:${stage}`); },
    }), new RegExp(`crash:${stage}`, 'u'));
    const result = await apply(root, revision);
    assert.equal(result.revision_digest, revision.revision_digest);
    const store = await readTodoStore({ repoRoot: root, now: NOW });
    assert.equal(store.members[0].plan.plan_version, revision.desired_plan.plan_version);
  });
}
