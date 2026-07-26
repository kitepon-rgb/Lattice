import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  TODO_WITNESS_SET_SCHEMA,
  validateTodoIndependenceProjection,
} from '../src/todo-independence-contracts.mjs';
import {
  createTodoStoreWriter,
  initializeTodoStore,
  writeTodoIndependenceArtifact,
} from '../src/todo-store.mjs';
import { TODO_INDEPENDENCE_SCHEMA } from '../src/todo-independence-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// ADR 0127 Decision 5。読み出しはsensorを引かず、記録済みartifactとHEAD照合だけで閉じる。
// dirty worktreeでのcompileは拒否し、未commitの観測を検証済み証拠にしない。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const NOW = '2026-07-26T00:00:00.000Z';

const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .trim();
}

async function workspace(context, { tasks = ['T1', 'T2'] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-independence-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);

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
        tasks: tasks.map(task),
        hard_dependencies: [],
        joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  return root;
}

function runCli(root, args) {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [CLI, 'todo', ...args], { cwd: root, encoding: 'utf8', env });
}

const parse = (text) => JSON.parse(text.trim().split('\n').at(-1));

test('記録が無い時はcoverage missingでready全件を未検査として返す', async (context) => {
  const root = await workspace(context);
  const result = runCli(root, ['independence', '--json']);

  assert.equal(result.status, 0);
  const projection = parse(result.stdout);
  assert.equal(validateTodoIndependenceProjection(projection), true);
  assert.equal(projection.coverage, 'missing');
  assert.equal(projection.plan_key, 'main');
  assert.deepEqual(projection.frontier.parallel_groups, []);
  assert.deepEqual(projection.frontier.unknown.map(({ task_id: id }) => id), ['T1', 'T2']);
});

test('記録があればHEAD一致でverified並列グループを返す（sensorは引かない）', async (context) => {
  const root = await workspace(context);
  const head = git(root, ['rev-parse', 'HEAD']);
  const artifact = {
    schema: TODO_INDEPENDENCE_SCHEMA,
    project_id: 'project-1',
    plan_key: 'main',
    plan_version: 'v1',
    topology_digest: parse(runCli(root, ['verify', '--json']).stdout)
      .verified_members[0].topology_digest,
    base_sha: head,
    witness_set_digest: 'd'.repeat(64),
    compiled_at: NOW,
    task_ids: ['T1', 'T2'],
    conflicts: [],
    precedences: [],
    unknowns: [],
    wave_plan: { waves: [{ task_ids: ['T1', 'T2'] }], minimum_feasible_waves: 1 },
    outcome: 'compiled',
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });

  const projection = parse(runCli(root, ['independence', '--json']).stdout);
  assert.equal(projection.coverage, 'verified');
  assert.equal(projection.compiled_base_sha, head);
  assert.deepEqual(projection.frontier.parallel_groups, [{ task_ids: ['T1', 'T2'] }]);
  assert.deepEqual(projection.frontier.unknown, []);

  // HEADが進めばstaleへ落ち、verified独立を主張しなくなる。
  await writeFile(path.join(root, 'NEXT.md'), 'next\n');
  git(root, ['add', 'NEXT.md']);
  git(root, ['commit', '--quiet', '-m', 'advance head']);

  const stale = parse(runCli(root, ['independence', '--json']).stdout);
  assert.equal(stale.coverage, 'stale');
  assert.deepEqual(stale.frontier.parallel_groups, []);
  assert.deepEqual(stale.frontier.unknown.map(({ task_id: id }) => id), ['T1', 'T2']);
  assert.equal(stale.frontier.unknown[0].unknowns[0].kind, 'record_stale');
});

test('存在しないplanはfail closedにする', async (context) => {
  const root = await workspace(context);
  const result = runCli(root, ['independence', '--plan', 'absent', '--json']);

  assert.equal(result.status, 1);
  const error = parse(result.stderr);
  assert.equal(error.schema, 'lattice.cli_error.v2');
  assert.equal(error.code, 'STORE_INCONSISTENT');
  assert.equal(error.detail.reason, 'plan_not_active');
});

test('dirty worktreeではcompileを拒否する', async (context) => {
  const root = await workspace(context);
  const witnessSet = {
    schema: TODO_WITNESS_SET_SCHEMA,
    project_id: 'project-1',
    plan_key: 'main',
    capacity: { executors: 2 },
    sensor_query_set: { queries: [{ id: 'q-status', operation: 'status' }] },
    manual_witness: {
      T1: {
        owns: [],
        reads: [],
        writes: ['src/a.mjs'],
        resources: [],
        state_effects: [],
        sensor_provenance: { queries: [] },
        affected_tests: [],
        unknowns: [],
      },
    },
    witness_set_digest: '',
  };
  witnessSet.witness_set_digest = todoSelfDigest(witnessSet, 'witness_set_digest');
  await writeFile(path.join(root, 'witness.json'), `${JSON.stringify(witnessSet)}\n`);

  const result = runCli(root, ['independence', 'compile', '--plan', 'main', '--input', 'witness.json']);
  assert.equal(result.status, 1);
  const error = parse(result.stderr);
  assert.equal(error.code, 'INDEPENDENCE_WORKTREE_DIRTY');
  assert.equal(error.detail.next_action, 'commit_or_stash_then_retry');
});

test('契約を満たさないwitness setはtyped errorで止まる', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, 'witness.json'), `${JSON.stringify({ schema: 'nope' })}\n`);
  git(root, ['add', 'witness.json']);
  git(root, ['commit', '--quiet', '-m', 'witness']);

  const result = runCli(root, ['independence', 'compile', '--plan', 'main', '--input', 'witness.json']);
  assert.equal(result.status, 1);
  assert.equal(parse(result.stderr).code, 'INVALID_TODO_WITNESS_SET');
});

test('未知の引数はusage failureで終わる', async (context) => {
  const root = await workspace(context);
  for (const args of [
    ['independence', 'compile'],
    ['independence', 'compile', '--plan', 'main', '--input'],
    ['independence', '--plan'],
  ]) {
    const result = runCli(root, args);
    assert.equal(result.status, 2, `expected usage failure for: ${args.join(' ')}`);
    assert.equal(result.stdout, '');
  }
});
