import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp, readFile, readdir, rm, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  canonicalizeTodoArtifact,
  todoSelfDigest,
} from '../src/todo-contracts.mjs';
import {
  appendImportedPlan,
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const NOW = '2026-07-18T00:00:00.000Z';
const manifestRef = '.lattice/todo/manifest.json';
const journalRef = '.lattice/todo/plans/main/v1/journal/active.jsonl';
const snapshotRef = '.lattice/todo/plans/main/v1/snapshot.json';

const task = (taskId) => ({
  task_id: taskId,
  title: taskId,
  lane: 'main',
  narrative_ref: null,
  compile_binding: null,
});

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0);
  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1',
        project_id: 'project-1',
        plan_key: 'main',
        plan_version: 'v1',
        predecessor_plan_digest: null,
        tasks: [task('T1'), task('T2')],
        hard_dependencies: [{
          from: { project_id: 'project-1', plan_key: 'main', task_id: 'T1' },
          to: { project_id: 'project-1', plan_key: 'main', task_id: 'T2' },
        }],
        joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  return root;
}

function runCli(root, args, { actor = true } = {}) {
  const env = { ...process.env, NO_COLOR: '1' };
  if (actor) {
    env.LATTICE_TODO_ACTOR_HOST = ACTOR.host;
    env.LATTICE_TODO_ACTOR_SESSION = ACTOR.session;
    env.LATTICE_TODO_ACTOR_AGENT = ACTOR.agent;
  } else {
    delete env.LATTICE_TODO_ACTOR_HOST;
    delete env.LATTICE_TODO_ACTOR_SESSION;
    delete env.LATTICE_TODO_ACTOR_AGENT;
  }
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  assert.equal(result.error, undefined);
  return result;
}

async function evidenceFixture(root, name = 'evidence') {
  const ref = `${name}.txt`;
  const bytes = Buffer.from(`${name}\n`, 'utf8');
  await writeFile(path.join(root, ref), bytes);
  const object = spawnSync('git', ['hash-object', '-w', ref], { cwd: root, encoding: 'utf8' });
  assert.equal(object.status, 0, object.stderr);
  const descriptor = {
    evidence_id: name,
    repo_id: 'self',
    path: ref,
    git_blob_oid: object.stdout.trim(),
    content_digest: createHash('sha256').update(bytes).digest('hex'),
    media_type: 'text/plain',
    anchor_digest: null,
  };
  const descriptorRef = `${name}.json`;
  await writeFile(path.join(root, descriptorRef), `${JSON.stringify(descriptor)}\n`);
  return { descriptor, descriptorRef };
}

function gitOutput(root, args, input) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', input });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function pinnedImportCommit(root) {
  const blob = gitOutput(root, ['hash-object', '-w', '--stdin'], '# Imported plan\n- [x] A1\n- [x] A2\n');
  const tree = gitOutput(root, ['mktree'], `100644 blob ${blob}\tplan.md\n`);
  return gitOutput(root, ['hash-object', '-t', 'commit', '-w', '--stdin'],
    `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1760000000 +0000\ncommitter Fixture <fixture@example.invalid> 1760000000 +0000\n\nfixture\n`);
}

async function importedUnknownDone(root) {
  const sourceCommit = pinnedImportCommit(root);
  const source = (originLine) => ({
    schema: 'lattice.todo_import_source.v1',
    origin_plan_ref: 'plan.md',
    origin_line: originLine,
    source_commit: sourceCommit,
  });
  return appendImportedPlan({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    plan: {
      schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'archive', plan_version: 'v1',
      predecessor_plan_digest: null, tasks: [task('A1'), task('A2')],
      hard_dependencies: [{
        from: { project_id: 'project-1', plan_key: 'archive', task_id: 'A1' },
        to: { project_id: 'project-1', plan_key: 'archive', task_id: 'A2' },
      }],
      joins: [],
    },
    genesis: { actor: ACTOR, recorded_at: NOW },
    completedTasks: [
      { task_id: 'A1', completed_at: NOW, evidence: source(2) },
      { task_id: 'A2', completed_at: 'unknown_requires_evidence', evidence: source(3) },
    ],
    now: NOW,
  });
}

function successJson(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\{.*\}\n$/u);
  return JSON.parse(result.stdout);
}

async function fileBytes(root, ref) {
  return readFile(path.join(root, ref));
}

async function storeDigest(root) {
  const storeRoot = path.join(root, '.lattice', 'todo');
  const entries = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const ref = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), ref);
      else entries.push([ref, await readFile(path.join(directory, entry.name))]);
    }
  }
  await visit(storeRoot);
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const hash = createHash('sha256');
  for (const [ref, bytes] of entries) hash.update(ref).update('\0').update(bytes).update('\0');
  return hash.digest('hex');
}

async function writeCanonical(root, ref, value) {
  await writeFile(path.join(root, ref), `${canonicalizeTodoArtifact(value)}\n`);
}

async function revisionInput(root) {
  await writeFile(path.join(root, 'plan.md'), '- [ ] T1\n- [ ] T2\n');
  const previous = (await readTodoStore({ repoRoot: root, now: NOW })).members[0];
  const predecessor = { plan_digest: previous.plan.plan_digest,
    journal_head_digest: previous.journal.events.at(-1).event_digest,
    plan_version: previous.plan.plan_version };
  const taskMigration = [
    { from_task_id: 'T1', to_task_id: 'T1', state_policy: 'carry' },
    { from_task_id: 'T2', to_task_id: 'T2', state_policy: 'carry' },
  ];
  const sourceInventory = { active: [
    { task_id: 'T1', source_ref: 'plan.md#L1',
      source_digest: createHash('sha256').update('- [ ] T1').digest('hex') },
    { task_id: 'T2', source_ref: 'plan.md#L2',
      source_digest: createHash('sha256').update('- [ ] T2').digest('hex') },
  ], excluded_tombstones: [] };
  const v3task = (taskId) => ({ ...task(taskId), narrative_anchor: null, parent_task_id: null });
  const desiredInput = { schema: 'lattice.todo_plan.v3', project_id: 'project-1',
    plan_key: 'main', plan_version: 'pending', predecessor_plan_digest: predecessor.plan_digest,
    tasks: [v3task('T1'), v3task('T2')], hard_dependencies: [{
      from: { project_id: 'project-1', plan_key: 'main', task_id: 'T1' },
      to: { project_id: 'project-1', plan_key: 'main', task_id: 'T2' },
    }], joins: [] };
  desiredInput.plan_version = todoRevisionPlanVersion({ projectId: 'project-1', planKey: 'main',
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
  const revision = { schema: 'lattice.todo_revision.v1', project_id: 'project-1', plan_key: 'main',
    predecessor, desired_plan: desiredPlan, task_migration: taskMigration,
    source_inventory: sourceInventory, reconciliation, revision_digest: '' };
  revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
  return revision;
}

function assertExactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

test('todo verifyは全member/plan指定のexact result wireを一行で返す', async (context) => {
  const root = await workspace(context);
  for (const args of [['todo', 'verify'], ['todo', 'verify', '--plan', 'main']]) {
    const output = successJson(runCli(root, args));
    assertExactKeys(output, [
      'schema', 'project_id', 'requested_plan_key', 'verified_members', 'snapshot_stale', 'result_digest',
    ]);
    assert.equal(output.schema, 'lattice.todo_verify_result.v2');
    assert.equal(output.project_id, 'project-1');
    assert.equal(output.requested_plan_key, args.length === 2 ? null : 'main');
    assert.equal(output.snapshot_stale, false);
    assert.equal(output.result_digest, todoSelfDigest(output, 'result_digest'));
    assert.equal(output.verified_members.length, 1);
    assertExactKeys(output.verified_members[0], [
      'plan_key', 'plan_version', 'topology_digest', 'journal_head_digest', 'through_sequence',
      'snapshot_stale', 'reconciliation_state', 'revision_digest', 'reconciliation_digest',
      'source_inventory_count', 'active_task_count', 'excluded_tombstone_count',
    ]);
    assert.equal(output.verified_members[0].reconciliation_state, 'registered_unreconciled');
    assert.equal(output.verified_members[0].revision_digest, null);
    assert.equal(output.verified_members[0].source_inventory_count, null);
  }
});

test('todo reviseはcanonical revisionだけを発行しstatus/verifyへreconciled identityを公開する', async (context) => {
  const root = await workspace(context);
  const revision = await revisionInput(root);
  await writeCanonical(root, 'revision.json', revision);
  const output = successJson(runCli(root, ['todo', 'revise', '--plan', 'main', '--input', 'revision.json']));
  assert.equal(output.schema, 'lattice.todo_revise_result.v1');
  assert.equal(output.revision_digest, revision.revision_digest);
  assert.equal(output.result_digest, todoSelfDigest(output, 'result_digest'));
  const status = successJson(runCli(root, ['todo', 'status']));
  assert.equal(status.member_heads[0].reconciliation_state, 'reconciled');
  assert.equal(status.member_heads[0].revision_digest, revision.revision_digest);
  const verified = successJson(runCli(root, ['todo', 'verify', '--plan', 'main']));
  assert.equal(verified.verified_members[0].reconciliation_state, 'reconciled');
  assert.equal(verified.verified_members[0].source_inventory_count, 2);
  assert.equal(verified.verified_members[0].active_task_count, 2);
  assert.equal(verified.verified_members[0].excluded_tombstone_count, 0);
  await writeFile(path.join(root, 'plan.md'), '- [x] T1\n- [ ] T2\n');
  const drifted = runCli(root, ['todo', 'verify', '--plan', 'main']);
  assert.equal(drifted.status, 1);
  assert.equal(drifted.stdout, '');
  assert.equal(JSON.parse(drifted.stderr).code, 'RECONCILIATION_INCOMPLETE');
});

test('todo reviseはnon-canonical input bytesをstore無変更で拒否する', async (context) => {
  const root = await workspace(context);
  const revision = await revisionInput(root);
  await writeFile(path.join(root, 'revision.json'), JSON.stringify(revision, null, 2));
  const before = await storeDigest(root);
  const result = runCli(root, ['todo', 'revise', '--plan', 'main', '--input', 'revision.json']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'REVISION_INVALID');
  assert.equal(await storeDigest(root), before);
});

test('authoring CLIはclosed遷移をappendしmutation resultをdigest束縛する', async (context) => {
  const root = await workspace(context);
  const { descriptorRef } = await evidenceFixture(root);
  const commands = [
    [['todo', 'start', '--plan', 'main', '--task', 'T1'], 'start', 'in-progress'],
    [['todo', 'block', '--plan', 'main', '--task', 'T1', '--reason', 'waiting'], 'block', 'blocked'],
    [['todo', 'unblock', '--plan', 'main', '--task', 'T1'], 'unblock', 'in-progress'],
    [['todo', 'done', '--plan', 'main', '--task', 'T1', '--evidence', descriptorRef], 'done', 'done'],
    [['todo', 'reopen', '--plan', 'main', '--task', 'T1', '--reason', 'correction'], 'reopen', 'in-progress'],
  ];
  let sequence = 0;
  for (const [args, kind, status] of commands) {
    const output = successJson(runCli(root, args));
    sequence += 1;
    assertExactKeys(output, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'task_id', 'kind', 'sequence',
      'event_digest', 'journal_head_digest', 'snapshot_digest', 'status', 'result_digest',
    ]);
    assert.equal(output.schema, 'lattice.todo_mutation_result.v1');
    assert.equal(output.kind, kind);
    assert.equal(output.status, status);
    assert.equal(output.sequence, sequence);
    assert.equal(output.journal_head_digest, output.event_digest);
    assert.equal(output.result_digest, todoSelfDigest(output, 'result_digest'));
  }
  const journal = (await readFile(path.join(root, journalRef), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(journal.slice(1).map(({ actor }) => actor), Array(commands.length).fill(ACTOR));
  assert.equal(journal.at(-1).payload.target_done_digest, journal.at(-2).event_digest);
});

test('authoring CLIはactor欠落・順序違反・blocked中doneを無変更拒否する', async (context) => {
  const root = await workspace(context);
  const { descriptorRef } = await evidenceFixture(root);
  for (const [args, actor, code, reason] of [
    [['todo', 'start', '--plan', 'main', '--task', 'T1'], false, 'ACTOR_UNRESOLVED', 'actor_environment_invalid'],
    [['todo', 'start', '--plan', 'main', '--task', 'T2'], true, 'STORE_INCONSISTENT', 'invalid_start_transition'],
  ]) {
    const before = await storeDigest(root);
    const result = runCli(root, args, { actor });
    assert.equal(result.status, 1);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, code);
    assert.equal(error.detail.reason, reason);
    assert.equal(await storeDigest(root), before);
  }
  successJson(runCli(root, ['todo', 'start', '--plan', 'main', '--task', 'T1']));
  successJson(runCli(root, ['todo', 'block', '--plan', 'main', '--task', 'T1', '--reason', 'waiting']));
  const before = await storeDigest(root);
  const blockedDone = runCli(root, ['todo', 'done', '--plan', 'main', '--task', 'T1', '--evidence', descriptorRef]);
  assert.equal(blockedDone.status, 1);
  assert.equal(JSON.parse(blockedDone.stderr).detail.reason, 'invalid_done_transition');
  assert.equal(await storeDigest(root), before);
});

test('start/reopen overrideとdescriptor schema拒否をexact argvで処理する', async (context) => {
  const root = await workspace(context);
  const { descriptorRef } = await evidenceFixture(root);
  const overridden = successJson(runCli(root, [
    'todo', 'start', '--plan', 'main', '--task', 'T2', '--override-reason', 'parallel audit',
  ]));
  assert.equal(overridden.status, 'in-progress');

  const invalidRef = 'invalid-evidence.json';
  await writeFile(path.join(root, invalidRef), '{"path":"evidence.txt"}\n');
  const before = await storeDigest(root);
  const invalid = runCli(root, ['todo', 'done', '--plan', 'main', '--task', 'T2', '--evidence', invalidRef]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).code, 'INVALID_EVIDENCE');
  assert.equal(await storeDigest(root), before);

  successJson(runCli(root, ['todo', 'start', '--plan', 'main', '--task', 'T1']));
  successJson(runCli(root, ['todo', 'done', '--plan', 'main', '--task', 'T1', '--evidence', descriptorRef]));
  const withoutOverride = runCli(root, [
    'todo', 'reopen', '--plan', 'main', '--task', 'T1', '--reason', 'correction',
  ]);
  assert.equal(withoutOverride.status, 1);
  assert.equal(JSON.parse(withoutOverride.stderr).detail.reason, 'reopen_has_started_successor');
  const reopened = successJson(runCli(root, [
    'todo', 'reopen', '--plan', 'main', '--task', 'T1', '--reason', 'correction',
    '--override-reason', 'successor audited',
  ]));
  assert.equal(reopened.status, 'in-progress');
});

test('evidence promote CLIはlock内でunknown historical doneを解決する', async (context) => {
  const root = await workspace(context);
  const imported = await importedUnknownDone(root);
  const sourceDone = imported.events.find(({ kind, task_id: taskId }) => kind === 'done' && taskId === 'A2');
  const { descriptorRef } = await evidenceFixture(root, 'promoted');
  const output = successJson(runCli(root, [
    'todo', 'evidence', 'promote', '--plan', 'archive', '--task', 'A2', '--evidence', descriptorRef,
  ]));
  assert.equal(output.kind, 'done');
  assert.equal(output.status, 'done');
  const journal = (await readFile(path.join(root,
    '.lattice/todo/plans/archive/v1/journal/active.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(journal.at(-1).payload.done_mode, 'evidence_promotion');
  assert.equal(journal.at(-1).payload.target_done_digest, sourceDone.event_digest);
});

const snapshotCases = [
  ['missing', async (root) => unlink(path.join(root, snapshotRef))],
  ['stale_projection', async (root) => {
    const value = JSON.parse(await fileBytes(root, snapshotRef));
    value.plan_version = 'old';
    value.snapshot_digest = todoSelfDigest(value, 'snapshot_digest');
    await writeCanonical(root, snapshotRef, value);
  }],
  ['digest_mismatch', async (root) => {
    const value = JSON.parse(await fileBytes(root, snapshotRef));
    value.snapshot_digest = 'f'.repeat(64);
    await writeCanonical(root, snapshotRef, value);
  }],
  ['body_mismatch', async (root) => {
    const value = JSON.parse(await fileBytes(root, snapshotRef));
    value.tasks[0].status = 'in-progress';
    value.tasks[0].started_at = NOW;
    value.snapshot_digest = todoSelfDigest(value, 'snapshot_digest');
    await writeCanonical(root, snapshotRef, value);
  }],
  ['byte_corrupt', async (root) => {
    await writeFile(path.join(root, snapshotRef), Buffer.from([0xff, 0x0a]));
  }],
  ['previous_head', async (root) => {
    const oldSnapshot = await fileBytes(root, snapshotRef);
    await appendTodoEvent({
      repoRoot: root,
      writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
      planKey: 'main',
      now: NOW,
      event: {
        kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW,
        payload: { override_reason: null },
      },
    });
    await writeFile(path.join(root, snapshotRef), oldSnapshot);
  }],
];

for (const [name, mutate] of snapshotCases) {
  test(`crash matrix: journal健全×snapshot ${name} はverify read-only＋明示rebuild`, async (context) => {
    const root = await workspace(context);
    await mutate(root);
    const beforeVerify = await storeDigest(root);
    const verify = successJson(runCli(root, ['todo', 'verify']));
    assert.equal(verify.snapshot_stale, true);
    assert.equal(verify.verified_members[0].snapshot_stale, true);
    assert.equal(await storeDigest(root), beforeVerify, 'verify must not regenerate or modify snapshot');

    const journalBefore = await fileBytes(root, journalRef);
    const manifestBefore = await fileBytes(root, manifestRef);
    const rebuilt = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
    assertExactKeys(rebuilt, [
      'schema', 'project_id', 'plan_key', 'snapshot_ref', 'through_sequence',
      'journal_head_digest', 'snapshot_digest', 'result_digest',
    ]);
    assert.equal(rebuilt.schema, 'lattice.todo_snapshot_result.v1');
    assert.equal(rebuilt.snapshot_ref, snapshotRef);
    assert.equal(rebuilt.result_digest, todoSelfDigest(rebuilt, 'result_digest'));
    assert.deepEqual(await fileBytes(root, journalRef), journalBefore);
    assert.deepEqual(await fileBytes(root, manifestRef), manifestBefore);
    assert.equal(successJson(runCli(root, ['todo', 'verify'])).snapshot_stale, false);

    const rebuiltBytes = await fileBytes(root, snapshotRef);
    const second = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
    assert.deepEqual(await fileBytes(root, snapshotRef), rebuiltBytes);
    assert.deepEqual(second, rebuilt);
  });
}

test('crash matrix: current snapshotのrebuildもbytes/resultが決定的', async (context) => {
  const root = await workspace(context);
  const before = await fileBytes(root, snapshotRef);
  const first = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
  assert.deepEqual(await fileBytes(root, snapshotRef), before);
  const second = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
  assert.deepEqual(second, first);
  assert.deepEqual(await fileBytes(root, snapshotRef), before);
});

test('journal破損はSTORE_CORRUPT exit 1で全store bytes不変', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, journalRef), Buffer.from([0xff, 0x0a]));
  const before = await storeDigest(root);
  for (const args of [
    ['todo', 'verify'],
    ['todo', 'snapshot', '--rebuild', '--plan', 'main'],
  ]) {
    const result = runCli(root, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^\{.*\}\n$/u);
    const error = JSON.parse(result.stderr);
    assert.equal(error.schema, 'lattice.cli_error.v2');
    assert.equal(error.code, 'STORE_CORRUPT');
    assert.equal(error.detail.reason, 'journal_invalid_utf8');
    assert.equal(await storeDigest(root), before);
  }
});

test('todo namespaceの未知subcommand・不足・余剰・重複・順序違反はusage exit 2', async (context) => {
  const root = await workspace(context);
  const malformed = [
    ['todo'],
    ['todo', 'unknown'],
    ['todo', 'status', 'extra'],
    ['todo', 'verify', '--plan'],
    ['todo', 'verify', '--plan', 'main', 'extra'],
    ['todo', 'verify', '--plan', 'main', '--plan', 'main'],
    ['todo', 'snapshot', '--plan', 'main', '--rebuild'],
    ['todo', 'snapshot', '--rebuild', '--plan', 'main', 'extra'],
    ['todo', 'migrate'],
    ['todo', 'migrate', '--input'],
    ['todo', 'migrate', '--input', '/tmp/extraction.json'],
    ['todo', 'migrate', 'extraction.json', '--input'],
    ['todo', 'migrate', '--input', 'extraction.json', 'extra'],
    ['todo', 'start', '--task', 'T1', '--plan', 'main'],
    ['todo', 'start', '--plan', 'main', '--task', 'T1', '--override-reason'],
    ['todo', 'block', '--plan', 'main', '--task', 'T1'],
    ['todo', 'unblock', '--plan', 'main', '--task', 'T1', 'extra'],
    ['todo', 'done', '--plan', 'main', '--task', 'T1'],
    ['todo', 'evidence', 'promote', '--task', 'T1', '--plan', 'main', '--evidence', 'evidence.json'],
    ['todo', 'reopen', '--plan', 'main', '--task', 'T1', '--reason', 'why', '--override-reason'],
  ];
  for (const args of malformed) {
    const before = await storeDigest(root);
    const result = runCli(root, args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.split('\n').length, 2);
    assert.doesNotMatch(result.stderr, /^\{/u);
    assert.equal(await storeDigest(root), before);
  }
});

test('存在しないplanはtyped exit 1でstore bytes不変', async (context) => {
  const root = await workspace(context);
  for (const args of [
    ['todo', 'verify', '--plan', 'absent'],
    ['todo', 'snapshot', '--rebuild', '--plan', 'absent'],
  ]) {
    const before = await storeDigest(root);
    const result = runCli(root, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).code, 'STORE_INCONSISTENT');
    assert.equal(await storeDigest(root), before);
  }
});

test('todo verifyはdone evidenceをhard検証し、解決不能ならtyped exit 1', async (context) => {
  const root = await workspace(context);
  const blob = Buffer.from('completion evidence\n');
  const object = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    input: blob,
    encoding: 'utf8',
  });
  assert.equal(object.status, 0);
  const oid = object.stdout.trim();
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  await appendTodoEvent({
    repoRoot: root, writer, planKey: 'main', now: NOW,
    event: {
      kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW,
      payload: { override_reason: null },
    },
  });
  await appendTodoEvent({
    repoRoot: root, writer, planKey: 'main', now: NOW,
    event: {
      kind: 'done', task_id: 'T1', actor: ACTOR, recorded_at: NOW,
      payload: { evidence: {
        evidence_id: 'evidence-1', repo_id: 'self', path: 'evidence.txt', git_blob_oid: oid,
        content_digest: createHash('sha256').update(blob).digest('hex'),
        media_type: 'text/plain', anchor_digest: null,
      } },
    },
  });
  await unlink(path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
  const before = await storeDigest(root);
  const result = runCli(root, ['todo', 'verify']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, 'STORE_INCONSISTENT');
  assert.equal(error.detail.reason, 'evidence_unverified');
  assert.equal(error.detail.plan_key, 'main');
  assert.equal(error.detail.task_id, 'T1');
  assert.equal(await storeDigest(root), before);
});
