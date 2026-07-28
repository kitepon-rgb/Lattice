import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTodoStoreWriter, initializeTodoStore, writeTodoWitnessSet } from '../../src/todo-store.mjs';
import { todoSelfDigest } from '../../src/todo-contracts.mjs';

// 計画時の切断コスト投影（docs/plan_seam-cost.md sc-005）。witness setのconcern_anchorsから
// task別のsymbol帰属を取り、実sensorで内訳を返す。read-onlyで、storeへ何も書かない。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const NOW = '2026-07-28T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });

const planFor = (planKey, tasks) => ({
  plan: {
    schema: 'lattice.todo_plan.v1',
    project_id: 'project-1',
    plan_key: planKey,
    plan_version: 'v1',
    predecessor_plan_digest: null,
    tasks: tasks.map((taskId) => ({
      task_id: taskId, title: taskId, lane: 'main',
      narrative_ref: null, compile_binding: null,
    })),
    hard_dependencies: [],
    joins: [],
  },
  genesis: { actor: ACTOR, recorded_at: NOW },
});

const SOURCE = [
  "const CSS = 'body { color: red; }';",
  'const styleCache = {};',
  '',
  'function formatText(value) {',
  '  return String(value);',
  '}',
  '',
  'function renderLeft(value) {',
  '  return formatText(styleCache) + value;',
  '}',
  '',
  'export function renderPage(value) {',
  '  return CSS + renderLeft(value) + formatText(String(styleCache));',
  '}',
  '',
].join('\n');

function run(root, args, env = {}) {
  const merged = { ...process.env, NO_COLOR: '1', ...env };
  delete merged.FORCE_COLOR;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: merged });
}

test('witness宣言から係争fileの内訳を投影し、storeへ何も書かない', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-seam-profile-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  spawnSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'fixture'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/page.mjs'), SOURCE);
  await writeFile(path.join(root, '.gitignore'), '.lattice/generated/\n.lattice/sensor/\n');
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });

  const sensorInit = run(root, ['sensor', 'init', '.', '--json']);
  assert.equal(sensorInit.status, 0, sensorInit.stderr);

  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [planFor('main', ['T1', 'T2'])],
    now: NOW,
  });

  const witness = (symbol) => ({
    owns: [{ kind: 'path', target: 'src/page.mjs' }],
    reads: [],
    writes: ['src/page.mjs'],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: 'q-page', expect: { kind: 'affected', path: 'src/page.mjs' } }],
    },
    affected_tests: [],
    unknowns: [],
    concern_anchors: [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: [symbol] }],
  });
  const witnessSet = {
    schema: 'lattice.todo_witness_set.v3',
    project_id: 'project-1',
    plan_key: 'main',
    capacity: { executors: 2 },
    sensor_query_set: {
      queries: [
        { id: 'q-page', operation: 'affected', target: 'src/page.mjs' },
        { id: 'q-status', operation: 'status' },
      ],
    },
    manual_witness: { T1: witness('renderLeft'), T2: witness('renderPage') },
    witness_set_digest: '',
  };
  witnessSet.witness_set_digest = todoSelfDigest(witnessSet, 'witness_set_digest');
  await writeTodoWitnessSet({ repoRoot: root, planKey: 'main', witnessSet });

  const profiled = run(root, ['todo', 'seam-profile', '--plan', 'main', '--file', 'src/page.mjs', '--json']);
  assert.equal(profiled.status, 0, profiled.stderr);
  const profile = JSON.parse(profiled.stdout.trim().split('\n').at(-1));
  assert.equal(profile.schema, 'lattice.seam_cost_profile.v1');

  // 実sensorの辺から: T2(renderPage)→T1(renderLeft)の直接辺、共有module状態、共有関数。
  assert.deepEqual(profile.cross_edges, [{
    from_task: 'T2', from: 'renderPage', to_task: 'T1', to: 'renderLeft',
    edge_kind: 'calls', value_ref: false,
  }]);
  assert.deepEqual(profile.shared_state.map(({ name, referenced_by: by }) => [name, by]),
    [['CSS', ['T2']], ['styleCache', ['T1', 'T2']]]);
  assert.deepEqual(profile.shared_functions.map(({ name, referenced_by: by }) => [name, by]),
    [['formatText', ['T1', 'T2']]]);
  // 数えられる事実だけ。可否判定や閾値の欄は無い。
  assert.equal('recommendation' in profile, false);
  assert.equal('threshold' in profile, false);

  // read-only——storeのjournalへ何も書かない。
  const status = run(root, ['todo', 'status', '--json']);
  assert.equal(status.status, 0, status.stderr);
});

test('宣言が2 task未満なら空の内訳へ丸めず、何を書けばよいかを返す', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-seam-profile-empty-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  spawnSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'fixture'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [planFor('main', ['T1'])],
    now: NOW,
  });

  const result = run(root, ['todo', 'seam-profile', '--plan', 'main', '--file', 'src/page.mjs', '--json']);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr.trim().split('\n').at(-1));
  assert.equal(error.code, 'SEAM_PROFILE_UNAVAILABLE');
  assert.equal(error.detail.reason, 'witness_set_absent');
  assert.equal(error.detail.next_action, 'declare_witness_set');
});
