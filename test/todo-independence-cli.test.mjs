import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  writeTodoWitnessSet,
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

const planFor = (planKey, tasks) => ({
  plan: {
    schema: 'lattice.todo_plan.v1',
    project_id: 'project-1',
    plan_key: planKey,
    plan_version: 'v1',
    predecessor_plan_digest: null,
    tasks: tasks.map(task),
    hard_dependencies: [],
    joins: [],
  },
  genesis: { actor: ACTOR, recorded_at: NOW },
});

async function workspace(context, { tasks = ['T1', 'T2'], extraPlans = [] } = {}) {
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
    plans: [planFor('main', tasks), ...extraPlans],
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
    task_boundaries: [
      { task_id: 'T1', paths: ['src/t1.mjs'] },
      { task_id: 'T2', paths: ['src/t2.mjs'] },
    ],
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

  // 宣言境界に触れないcommitでHEADが進んでも、観測は変わらないのでverified独立は維持する。
  // coverageはsha水準の事実としてstaleを述べるが、taskは未検査へ落とさない。
  await writeFile(path.join(root, 'NEXT.md'), 'next\n');
  git(root, ['add', 'NEXT.md']);
  git(root, ['commit', '--quiet', '-m', 'advance head outside declared boundaries']);

  const untouched = parse(runCli(root, ['independence', '--json']).stdout);
  assert.equal(untouched.coverage, 'stale');
  assert.equal(untouched.drift.base_reachable, true);
  assert.equal(untouched.drift.changed_path_count, 1);
  assert.deepEqual(untouched.drift.intersecting_task_ids, []);
  assert.deepEqual(untouched.frontier.parallel_groups, [{ task_ids: ['T1', 'T2'] }]);
  assert.deepEqual(untouched.frontier.unknown, []);

  // 宣言境界に触れたcommitは、そのtaskだけを未検査へ落とす。
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 't1.mjs'), 'export const t1 = 1;\n');
  git(root, ['add', 'src/t1.mjs']);
  git(root, ['commit', '--quiet', '-m', 'touch declared boundary of T1']);

  const touched = parse(runCli(root, ['independence', '--json']).stdout);
  assert.equal(touched.coverage, 'stale');
  assert.deepEqual(touched.drift.intersecting_task_ids, ['T1']);
  assert.deepEqual(touched.frontier.unknown.map(({ task_id: id }) => id), ['T1']);
  assert.equal(touched.frontier.unknown[0].unknowns[0].kind, 'record_stale');
  // 触れていないT2は検証済みのまま残る。
  assert.deepEqual(touched.frontier.parallel_groups, [{ task_ids: ['T2'] }]);
});

test('進行中ToDoとの競合をconflicts_with_activeとして返す', async (context) => {
  const root = await workspace(context, { tasks: ['T1', 'T2'] });
  const head = git(root, ['rev-parse', 'HEAD']);
  const topologyDigest = parse(runCli(root, ['verify', '--json']).stdout)
    .verified_members[0].topology_digest;
  const artifact = {
    schema: TODO_INDEPENDENCE_SCHEMA,
    project_id: 'project-1',
    plan_key: 'main',
    plan_version: 'v1',
    topology_digest: topologyDigest,
    base_sha: head,
    witness_set_digest: 'd'.repeat(64),
    compiled_at: NOW,
    task_ids: ['T1', 'T2'],
    task_boundaries: [
      { task_id: 'T1', paths: ['src/shared.mjs'] },
      { task_id: 'T2', paths: ['src/shared.mjs'] },
    ],
    conflicts: [{ task_ids: ['T1', 'T2'], resource_id: 'own-path-shared', kind: 'path' }],
    precedences: [],
    unknowns: [],
    wave_plan: {
      waves: [{ task_ids: ['T1'] }, { task_ids: ['T2'] }],
      minimum_feasible_waves: 2,
    },
    outcome: 'compiled',
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });

  // T1を着手すると、readyはT2だけになりペアの片端がactiveになる。
  const env = {
    LATTICE_TODO_ACTOR_HOST: 'host-1',
    LATTICE_TODO_ACTOR_SESSION: 'session-1',
    LATTICE_TODO_ACTOR_AGENT: 'agent-1',
  };
  const started = spawnSync(process.execPath, [
    CLI, 'todo', 'start', '--plan', 'main', '--task', 'T1', '--override-reason', 'fixture',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env, NO_COLOR: '1' } });
  assert.equal(started.status, 0, started.stderr);

  const projection = parse(runCli(root, ['independence', '--json']).stdout);
  assert.deepEqual(projection.active_task_ids, ['T1']);
  assert.deepEqual(projection.uncovered_active_task_ids, []);
  // v1はここで黙って捨てていた。着手時に最も危ない組み合わせを落とさない。
  assert.deepEqual(projection.frontier.conflicts_with_active, [{
    ready_task_id: 'T2',
    active_task_id: 'T1',
    type: 'conflict',
    detail: 'own-path-shared',
    kind: 'path',
    severability: 'code_seam',
  }]);
  assert.deepEqual(projection.frontier.serialize_pairs, []);
});

test('readyが無くても記録があればplan指定でverifiedを返す', async (context) => {
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
    task_ids: ['T1'],
    task_boundaries: [{ task_id: 'T1', paths: ['src/t1.mjs'] }],
    conflicts: [],
    precedences: [],
    unknowns: [],
    wave_plan: { waves: [{ task_ids: ['T1'] }], minimum_feasible_waves: 1 },
    outcome: 'compiled',
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });

  // 単一planならready集合が空でもそのplanが候補になる。記録があるのに
  // coverage missingと報告してしまう経路を残さない。
  const projection = parse(runCli(root, ['independence', '--json']).stdout);
  assert.equal(projection.plan_key, 'main');
  assert.equal(projection.coverage, 'verified');
});

test('planを絞らない呼び出しで候補が複数なら曖昧として止まる', async (context) => {
  const root = await workspace(context, { extraPlans: [planFor('second', ['S1'])] });

  const result = runCli(root, ['independence', '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = parse(result.stderr);
  assert.equal(error.code, 'INDEPENDENCE_PLAN_AMBIGUOUS');
  assert.deepEqual(error.detail.plan_keys, ['main', 'second']);
  assert.equal(error.detail.next_action, 'rerun_with_plan_flag');

  // planを絞れば答えられる。
  const projection = parse(runCli(root, ['independence', '--plan', 'second', '--json']).stdout);
  assert.equal(projection.plan_key, 'second');
  assert.equal(projection.coverage, 'missing');
});

test('着手時のadvisoryが進行中との競合と切断可能性を返す', async (context) => {
  const root = await workspace(context, { tasks: ['T1', 'T2'] });
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
    task_boundaries: [
      { task_id: 'T1', paths: ['src/shared.mjs'] },
      { task_id: 'T2', paths: ['src/shared.mjs'] },
    ],
    conflicts: [{ task_ids: ['T1', 'T2'], resource_id: 'own-path-shared', kind: 'path' }],
    precedences: [],
    unknowns: [],
    wave_plan: {
      waves: [{ task_ids: ['T1'] }, { task_ids: ['T2'] }],
      minimum_feasible_waves: 2,
    },
    outcome: 'compiled',
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });

  const actorEnv = {
    LATTICE_TODO_ACTOR_HOST: 'host-1',
    LATTICE_TODO_ACTOR_SESSION: 'session-1',
    LATTICE_TODO_ACTOR_AGENT: 'agent-1',
  };
  const start = (taskId) => spawnSync(process.execPath, [
    CLI, 'todo', 'start', '--plan', 'main', '--task', taskId, '--override-reason', 'fixture',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, ...actorEnv, NO_COLOR: '1' } });

  const first = start('T1');
  assert.equal(first.status, 0, first.stderr);
  const firstResult = parse(first.stdout);
  assert.equal(firstResult.advisory.coverage, 'verified');
  // まだactiveが無いので競合相手はいない。
  assert.deepEqual(firstResult.advisory.conflicts_with_active, []);
  assert.deepEqual(firstResult.advisory.self_unknowns, []);

  // T1が進行中の状態でT2へ着手すると、相手と切断可能性が助言に載る。
  const second = start('T2');
  assert.equal(second.status, 0, second.stderr);
  const advisory = parse(second.stdout).advisory;
  assert.deepEqual(advisory.conflicts_with_active, [{
    active_task_id: 'T1',
    type: 'conflict',
    detail: 'own-path-shared',
    kind: 'path',
    severability: 'code_seam',
  }]);
  assert.equal(advisory.coverage, 'verified');
  assert.equal(advisory.drift_intersecting, null);
});

test('記録が無い時の着手も助言を返し、未検査であることを告げる', async (context) => {
  const root = await workspace(context, { tasks: ['T1'] });
  const actorEnv = {
    LATTICE_TODO_ACTOR_HOST: 'host-1',
    LATTICE_TODO_ACTOR_SESSION: 'session-1',
    LATTICE_TODO_ACTOR_AGENT: 'agent-1',
  };
  const started = spawnSync(process.execPath, [
    CLI, 'todo', 'start', '--plan', 'main', '--task', 'T1',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, ...actorEnv, NO_COLOR: '1' } });

  assert.equal(started.status, 0, started.stderr);
  const advisory = parse(started.stdout).advisory;
  assert.equal(advisory.coverage, 'missing');
  // 「競合なし」でなく「まだ判定していない」として返す。
  assert.deepEqual(advisory.self_unknowns, [
    { kind: 'witness_missing', ref: 'no_independence_record' },
  ]);
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

test('witness migrateは宣言もrevisionも無い状態をfail closedにする', async (context) => {
  const root = await workspace(context);

  const noWitness = runCli(root, ['independence', 'witness', 'migrate', '--plan', 'main']);
  assert.equal(noWitness.status, 1);
  const absent = parse(noWitness.stderr);
  assert.equal(absent.code, 'WITNESS_MIGRATION_UNAVAILABLE');
  assert.equal(absent.detail.reason, 'witness_set_absent');
  assert.equal(absent.detail.witness_ref, '.lattice/todo/witness/main.json');

  // 宣言はあるがrevisionを経ていないplanは、写す先が無いので「移行済み」と装わない。
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
  await writeTodoWitnessSet({ repoRoot: root, witnessSet });

  const noRevision = runCli(root, ['independence', 'witness', 'migrate', '--plan', 'main']);
  assert.equal(noRevision.status, 1);
  assert.equal(parse(noRevision.stderr).detail.reason, 'plan_has_no_revision');

  const absentPlan = runCli(root, ['independence', 'witness', 'migrate', '--plan', 'nope']);
  assert.equal(absentPlan.status, 1);
  assert.equal(parse(absentPlan.stderr).detail.reason, 'plan_not_active');
});

test('未知の引数はusage failureで終わる', async (context) => {
  const root = await workspace(context);
  for (const args of [
    ['independence', 'compile'],
    ['independence', 'compile', '--plan', 'main', '--input'],
    ['independence', '--plan'],
    ['independence', 'witness'],
    ['independence', 'witness', 'migrate'],
    ['independence', 'witness', 'migrate', '--plan'],
  ]) {
    const result = runCli(root, args);
    assert.equal(result.status, 2, `expected usage failure for: ${args.join(' ')}`);
    assert.equal(result.stdout, '');
  }
});
