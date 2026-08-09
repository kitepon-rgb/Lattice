import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureWorktreeDiff, detectCheckpointFindings } from '../../src/runtime-diff-observer.mjs';
import { resolveRuntimeSeamTreatment } from '../../src/runtime-seam-treatment.mjs';
import { commitSeamTransform } from '../../src/seam-commit.mjs';
import { applySeamConflict } from '../../src/seam-apply.mjs';
import { collectWitnessSensorEvidence, compileTodoIndependence } from '../../src/todo-independence.mjs';
import { todoSelfDigest } from '../../src/todo-contracts.mjs';

// 請求項8。実行時に観測した競合を、その場の変換で解消する。実git repositoryと実sensorで通す。

const LATTICE_BIN = fileURLToPath(new URL('../../bin/lattice.mjs', import.meta.url));
const DIGEST = (character) => character.repeat(64);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

const SOURCE = [
  'const CSS = \'body { color: red; }\';',
  '',
  'function escapeText(value) {',
  '  return String(value).replaceAll(\'&\', \'&amp;\');',
  '}',
  '',
  'function renderLeft(value) {',
  '  return `<div>${escapeText(value)}</div>`;',
  '}',
  '',
  'export function renderPage(value) {',
  '  return `<style>${CSS}</style>${renderLeft(value)}`;',
  '}',
  '',
].join('\n');

const PAGE_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { renderPage } from '../src/page.mjs';",
  "test('render', () => { assert.match(renderPage('a'), /<div>a<\\/div>/); });",
  '',
].join('\n');

function witnessFor(projectId, planKey) {
  const witness = (symbol) => ({
    owns: [{ kind: 'path', target: 'src/page.mjs' }],
    reads: [],
    writes: ['src/page.mjs'],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: 'q-page', expect: { kind: 'affected', path: 'src/page.mjs' } }],
    },
    affected_tests: ['test/page.test.mjs'],
    unknowns: [],
    concern_anchors: [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: [symbol] }],
  });
  const set = {
    schema: 'lattice.todo_witness_set.v3',
    project_id: projectId,
    plan_key: planKey,
    capacity: { executors: 2 },
    sensor_query_set: {
      queries: [
        { id: 'q-page', operation: 'affected', target: 'src/page.mjs' },
        { id: 'q-status', operation: 'status' },
      ],
    },
    manual_witness: { T1: witness('renderLeft'), T2: witness('CSS') },
    witness_set_digest: '',
  };
  set.witness_set_digest = todoSelfDigest(set, 'witness_set_digest');
  return set;
}

test('実行時に観測した競合を、その場の変換で解消してseam splitへ落とす', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-runtime-seam-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src/page.mjs'), SOURCE);
  await writeFile(path.join(root, 'test/page.test.mjs'), PAGE_TEST);
  await writeFile(path.join(root, '.gitignore'), '.lattice/\nnode_modules/\n');
  run('git', ['init', '--quiet'], root);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root);
  run('git', ['config', 'user.name', 'fixture'], root);
  run('git', ['add', '-A'], root);
  run('git', ['commit', '--quiet', '-m', 'fixture'], root);
  const baseSha = run('git', ['rev-parse', 'HEAD'], root).trim();
  run(process.execPath, [LATTICE_BIN, 'sensor', 'init', '.', '--json'], root);

  // --- 実行時の観測: T2が自分のscope外、かつT1のscope内であるpathへ書いた
  const workerRoot = await mkdtemp(path.join(tmpdir(), 'lattice-runtime-worker-'));
  context.after(async () => {
    spawnSync('git', ['worktree', 'remove', '--force', workerRoot], { cwd: root });
    await rm(workerRoot, { recursive: true, force: true });
  });
  run('git', ['worktree', 'add', '--detach', workerRoot, baseSha], root);
  await writeFile(path.join(workerRoot, 'src/page.mjs'), `${SOURCE}\n// touched by T2\n`);
  const checkpoint = await captureWorktreeDiff({ worktreePath: workerRoot, baseSha });

  const packets = {
    T1: { todo_id: 'T1', scope: { writes: ['src/page.mjs'] } },
    T2: { todo_id: 'T2', scope: { writes: ['src/other.mjs'] } },
  };
  const { findings } = detectCheckpointFindings({
    todoId: 'T2', checkpoint, packets,
    manifests: {
      T1: { writes: ['src/page.mjs'] },
      T2: { writes: ['src/other.mjs'] },
    },
    runningTodoIds: ['T1', 'T2'],
  });
  const conflictFinding = findings.find(({ kind }) => kind === 'observed_write_conflict');
  assert.notEqual(conflictFinding, undefined, JSON.stringify(findings));
  assert.equal(conflictFinding.path, 'src/page.mjs');
  assert.deepEqual(conflictFinding.todo_ids, ['T1', 'T2']);

  // --- その場の変換: 観測したfindingから候補を導出し、五条件で採否を決める
  const witnessSet = witnessFor('runtime-seam', 'main');
  const plan = {
    schema: 'lattice.todo_plan.v2',
    project_id: 'runtime-seam',
    plan_key: 'main',
    plan_version: 'v1',
    topology_digest: DIGEST('7'),
    tasks: [{ task_id: 'T1' }, { task_id: 'T2' }],
  };
  const baseArtifact = compileTodoIndependence({
    witnessSet,
    plan,
    baseSha,
    compiledAt: '2026-07-27T00:00:00.000Z',
    sensorEvidence: await collectWitnessSensorEvidence({ cwd: root, witnessSet }),
  });
  assert.equal(baseArtifact.conflicts.length, 1);

  const resolved = await resolveRuntimeSeamTreatment({
    finding: conflictFinding,
    witnessSet,
    pathNames: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs' },
    baseSha,
    manifestDigest: baseArtifact.result_digest,
    affectedTests: ['test/page.test.mjs'],
    taskMigrationDigest: DIGEST('2'),
    commitTransform: async ({ files, candidateId }) => commitSeamTransform({
      repoRoot: root, baseSha, files, candidateId,
    }),
    applyConflict: async ({ conflict }) => {
      const applied = await applySeamConflict({
        repoRoot: root,
        planKey: 'main',
        conflict,
        witnessSet,
        latticeBin: LATTICE_BIN,
        sharedPathFor: (target) => target.replace(/(\.[^./]+)$/u, '.seam-shared$1'),
        executors: witnessSet.capacity.executors,
        pathNames: { shared: 'src/page-shared.mjs' },
        compileIndependence: {
          baseArtifact,
          inWorktree: async ({ worktreePath, witnessSet: postWitness }) => compileTodoIndependence({
            witnessSet: postWitness,
            plan,
            baseSha,
            compiledAt: '2026-07-27T00:00:00.000Z',
            sensorEvidence: await collectWitnessSensorEvidence({
              cwd: worktreePath, witnessSet: postWitness,
            }),
          }),
        },
      });
      return { ...applied, candidate: null };
    },
  });

  assert.equal(resolved.lane, 'seam_transform', JSON.stringify(resolved.reasons));
  assert.deepEqual(resolved.treatment.covered_paths, ['src/page.mjs']);
  assert.equal(resolved.split.schema, 'lattice.runtime_seam_split.v1');
  assert.deepEqual(resolved.split.predecessor_task_ids, ['T1', 'T2']);
  // 競合辺は消える側だけを載せる。所有はそれぞれの新資源へ移る。
  assert.deepEqual(resolved.split.edge_diff.removed,
    [{ from_todo_id: 'T1', to_todo_id: 'T2', kind: 'conflict' }]);
  assert.equal(resolved.split.ownership_diff.added.length, 2);
  assert.equal(resolved.split.ownership_diff.removed.length, 2);
  // 本repositoryは変換で変わらない。
  assert.equal(run('git', ['status', '--porcelain=v1'], root).trim(), '');
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), baseSha);

  // --- 再開: 後継baseへworktreeを張ると、所有を宣言した新pathが実在する
  assert.match(resolved.successor_base_sha, /^[0-9a-f]{40}$/u);
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', baseSha, resolved.successor_base_sha], { cwd: root }).status, 0);
  const resumed = path.join(root, 'resumed');
  run('git', ['worktree', 'add', '--detach', '--quiet', resumed, resolved.successor_base_sha], root);
  context.after(() => spawnSync('git', ['worktree', 'remove', '--force', resumed], { cwd: root }));
  for (const owned of ['src/page-left.mjs', 'src/page-style.mjs']) {
    assert.equal(spawnSync('test', ['-f', path.join(resumed, owned)]).status, 0, owned);
  }
  // 旧base——直す前の再開先——には無い。
  assert.equal(spawnSync('test', ['-f', path.join(root, 'src/page-left.mjs')]).status !== 0, true);
});

// 検証網（ADR 0145）の受入。**focused testが通ってしまう形の静かな破壊**を、網だけが捕まえる。
//
// 移すsymbolが、グラフの辺にならないmodule変数を参照している。名前フィルタの緩和（sc-008）で
// 小文字名は辺に映るようになったので、残る死角は**3文字未満の名前**（`db`）である。辺が無い
// ので閉包は拾わず、変数は残余面に残る。移した先の参照は束縛を失うが、moduleの読み込みは
// 通り、壊れた関数を呼ばないtestは緑のまま——網が無ければこれが採用される。
const SEVERED_SOURCE = [
  'const db = { rows: 1 };',
  'const CSS = \'body { color: red; }\';',
  '',
  'function renderLeft(value) {',
  '  return `<div>${db.rows + value}</div>`;',
  '}',
  '',
  'export function renderPage(value) {',
  '  return `<style>${CSS}</style>${renderLeft(value)}`;',
  '}',
  '',
].join('\n');

// 壊れた経路（renderLeft）を実行しないtest。読み込みだけなら通る、が要点である。
const SEVERED_PAGE_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { renderPage } from '../src/page.mjs';",
  "test('page module loads', () => { assert.equal(typeof renderPage, 'function'); });",
  '',
].join('\n');

async function severedHarness(context, source) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-seam-net-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src/page.mjs'), source);
  await writeFile(path.join(root, 'test/page.test.mjs'), SEVERED_PAGE_TEST);
  await writeFile(path.join(root, '.gitignore'), '.lattice/\nnode_modules/\n');
  run('git', ['init', '--quiet'], root);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root);
  run('git', ['config', 'user.name', 'fixture'], root);
  run('git', ['add', '-A'], root);
  run('git', ['commit', '--quiet', '-m', 'fixture'], root);
  const baseSha = run('git', ['rev-parse', 'HEAD'], root).trim();
  run(process.execPath, [LATTICE_BIN, 'sensor', 'init', '.', '--json'], root);

  const workerRoot = await mkdtemp(path.join(tmpdir(), 'lattice-seam-net-worker-'));
  context.after(async () => {
    spawnSync('git', ['worktree', 'remove', '--force', workerRoot], { cwd: root });
    await rm(workerRoot, { recursive: true, force: true });
  });
  run('git', ['worktree', 'add', '--detach', workerRoot, baseSha], root);
  await writeFile(path.join(workerRoot, 'src/page.mjs'), `${source}\n// touched by T2\n`);
  const checkpoint = await captureWorktreeDiff({ worktreePath: workerRoot, baseSha });
  const { findings } = detectCheckpointFindings({
    todoId: 'T2', checkpoint,
    packets: {
      T1: { todo_id: 'T1', scope: { writes: ['src/page.mjs'] } },
      T2: { todo_id: 'T2', scope: { writes: ['src/other.mjs'] } },
    },
    manifests: {
      T1: { writes: ['src/page.mjs'] },
      T2: { writes: ['src/other.mjs'] },
    },
    runningTodoIds: ['T1', 'T2'],
  });
  const conflictFinding = findings.find(({ kind }) => kind === 'observed_write_conflict');
  assert.notEqual(conflictFinding, undefined, JSON.stringify(findings));

  const witnessSet = witnessFor('runtime-seam-net', 'main');
  const plan = {
    schema: 'lattice.todo_plan.v2',
    project_id: 'runtime-seam-net',
    plan_key: 'main',
    plan_version: 'v1',
    topology_digest: DIGEST('7'),
    tasks: [{ task_id: 'T1' }, { task_id: 'T2' }],
  };
  const baseArtifact = compileTodoIndependence({
    witnessSet,
    plan,
    baseSha,
    compiledAt: '2026-07-27T00:00:00.000Z',
    sensorEvidence: await collectWitnessSensorEvidence({ cwd: root, witnessSet }),
  });

  const resolved = await resolveRuntimeSeamTreatment({
    finding: conflictFinding,
    witnessSet,
    pathNames: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs' },
    baseSha,
    manifestDigest: baseArtifact.result_digest,
    affectedTests: ['test/page.test.mjs'],
    taskMigrationDigest: DIGEST('2'),
    commitTransform: async ({ files, candidateId }) => commitSeamTransform({
      repoRoot: root, baseSha, files, candidateId,
    }),
    applyConflict: async ({ conflict }) => {
      const applied = await applySeamConflict({
        repoRoot: root,
        planKey: 'main',
        conflict,
        witnessSet,
        latticeBin: LATTICE_BIN,
        sharedPathFor: (target) => target.replace(/(\.[^./]+)$/u, '.seam-shared$1'),
        executors: witnessSet.capacity.executors,
        pathNames: { shared: 'src/page-shared.mjs' },
        compileIndependence: {
          baseArtifact,
          inWorktree: async ({ worktreePath, witnessSet: postWitness }) => compileTodoIndependence({
            witnessSet: postWitness,
            plan,
            baseSha,
            compiledAt: '2026-07-27T00:00:00.000Z',
            sensorEvidence: await collectWitnessSensorEvidence({
              cwd: worktreePath, witnessSet: postWitness,
            }),
          }),
        },
      });
      return { ...applied, candidate: null };
    },
  });

  return { resolved };
}

test('切断された参照は、focused testが黙っていても網が落とす', async (context) => {
  const { resolved } = await severedHarness(context, SEVERED_SOURCE);
  // 網だけが落とした、を理由の全量一致で主張する。focused testも他の四条件も通っていた
  // ——つまり網が無ければこの変換は採用されていた（現状再現が理由の不在として埋まっている）。
  assert.equal(resolved.lane, 'intentional_serial');
  assert.deepEqual(resolved.reasons,
    ['behavior_equivalent:severed_reference:src/page-left.mjs:db']);
});

// 正の対照（sc-008の帰結）。**辺に映る**module変数の共有は、閉包が拾って共有面へ移すので
// 切断がそもそも起きない——網が黙り、変換が正当に成立する。網は「見える共有」を装置が
// 正しく処理することの代替ではなく、見えないものの最後の防壁である。
const VISIBLE_SHARED_SOURCE = [
  'const counter = 1;',
  'const CSS = \'body { color: red; }\';',
  '',
  'function renderLeft(value) {',
  '  return `<div>${counter + value}</div>`;',
  '}',
  '',
  'export function renderPage(value) {',
  '  return `<style>${CSS}</style>${renderLeft(value)}`;',
  '}',
  '',
].join('\n');

test('辺に映る共有module変数は閉包が拾い、変換が成立して網は黙る', async (context) => {
  const { resolved } = await severedHarness(context, VISIBLE_SHARED_SOURCE);
  assert.equal(resolved.lane, 'seam_transform', JSON.stringify(resolved.reasons));
  assert.deepEqual(resolved.reasons, []);
});
