import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeSeamSplit, pathResourceId, resolveRuntimeSeamTreatment,
} from '../src/runtime-seam-treatment.mjs';

// 請求項8。実行時競合を、事前宣言に頼らずその場の変換で解消する。
// 「実行時だから緩める」ことをしない——緩めると、外部挙動を変えうる変更が便益の証明なしに
// 実行中のrunへ入る。

const DIGEST = (character) => character.repeat(64);
const BASE_SHA = 'a'.repeat(40);

const witnessSet = {
  manual_witness: {
    T1: { concern_anchors: [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['renderLeft'] }] },
    T2: { concern_anchors: [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['CSS'] }] },
  },
};

const finding = {
  kind: 'observed_write_conflict', path: 'src/page.mjs', todo_ids: ['T1', 'T2'],
};

const pathNames = { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs' };

const acceptedCandidate = {
  surfaces: [
    { role: 'task_owned', path: 'src/page-left.mjs', owner_task_ids: ['T1'], symbols: ['renderLeft'] },
    { role: 'task_owned', path: 'src/page-style.mjs', owner_task_ids: ['T2'], symbols: ['CSS'] },
    { role: 'residual', path: 'src/page.mjs', owner_task_ids: [], symbols: [] },
  ],
};

const accept = async ({ conflict }) => ({
  outcome: { decision: 'accepted', candidate_digest: DIGEST('9'), reasons: [] },
  candidate: acceptedCandidate,
  files: { 'src/page.mjs': 'residual\n' },
  conflict,
});

const base = (overrides = {}) => ({
  finding,
  witnessSet,
  pathNames,
  applyConflict: accept,
  baseSha: BASE_SHA,
  manifestDigest: DIGEST('1'),
  affectedTests: ['test/page.test.mjs'],
  taskMigrationDigest: DIGEST('2'),
  ...overrides,
});

test('事前宣言された処置があればそれを使う', async () => {
  const result = await resolveRuntimeSeamTreatment(base({
    predeclaredTreatments: [{ covered_paths: ['src/page.mjs'], id: 'pre' }],
  }));
  assert.equal(result.lane, 'seam_transform');
  assert.equal(result.treatment.id, 'pre');
  // 事前宣言を使った場合は変換していないので、splitは作らない。
  assert.equal(result.split, null);
});

test('事前宣言が無ければその場で変換し、seam splitを組む', async () => {
  const result = await resolveRuntimeSeamTreatment(base());
  assert.equal(result.lane, 'seam_transform');
  assert.deepEqual(result.treatment.covered_paths, ['src/page.mjs']);
  assert.equal(result.split.schema, 'lattice.runtime_seam_split.v1');
  assert.deepEqual(result.split.predecessor_task_ids, ['T1', 'T2']);

  // 所有の差分は「係争資源の所有を降りて、自分の新資源を所有する」。
  const source = pathResourceId('src/page.mjs');
  assert.deepEqual(result.split.ownership_diff.removed.map(({ resource_id: id }) => id),
    [source, source]);
  assert.deepEqual(
    result.split.ownership_diff.added.map(({ owner_todo_id: id }) => id).sort(),
    ['T1', 'T2'],
  );
  assert.equal(result.split.ownership_diff.added
    .some(({ resource_id: id }) => id === pathResourceId('src/page-left.mjs')), true);

  // 競合辺は消える側だけを載せる。
  assert.deepEqual(result.split.edge_diff.removed,
    [{ from_todo_id: 'T1', to_todo_id: 'T2', kind: 'conflict' }]);
  assert.deepEqual(result.split.edge_diff.added, []);
  assert.deepEqual(result.split.verifier_refs, ['test/page.test.mjs']);
});

test('変換が五条件を満たさなければ意図的直列へ送り、欠けた条件を残す', async () => {
  const result = await resolveRuntimeSeamTreatment(base({
    applyConflict: async () => ({
      outcome: { decision: 'rejected', reasons: ['parallelism_improved:no_gain:2->2'] },
    }),
  }));
  assert.equal(result.lane, 'intentional_serial');
  assert.equal(result.split, null);
  assert.deepEqual(result.reasons, ['parallelism_improved:no_gain:2->2']);
});

test('実行時だからといって適用器の不在を黙って通さない', async () => {
  const result = await resolveRuntimeSeamTreatment(base({ applyConflict: undefined }));
  assert.equal(result.lane, 'intentional_serial');
  assert.deepEqual(result.reasons, ['applier_absent']);
});

test('宣言や名前が足りない競合は変換にかけない', async () => {
  const missingName = await resolveRuntimeSeamTreatment(base({ pathNames: { T1: 'src/page-left.mjs' } }));
  assert.equal(missingName.lane, 'intentional_serial');
  assert.deepEqual(missingName.reasons, ['owned_path_name_missing:T2']);

  const notWriteConflict = await resolveRuntimeSeamTreatment(base({
    finding: { kind: 'scope_violation', path: 'src/page.mjs', todo_ids: ['T1'] },
  }));
  assert.equal(notWriteConflict.lane, 'intentional_serial');
  assert.deepEqual(notWriteConflict.reasons, ['finding_not_write_conflict']);
});

test('所有面が2つ揃わない候補からseam splitを組まない', () => {
  const { split, reasons } = buildRuntimeSeamSplit({
    conflict: { sourcePath: 'src/page.mjs', taskIds: ['T1', 'T2'], findingDigest: DIGEST('3') },
    candidate: { surfaces: [{ role: 'residual', path: 'src/page.mjs', owner_task_ids: [], symbols: [] }] },
    taskMigrationDigest: DIGEST('2'),
  });
  assert.equal(split, null);
  assert.deepEqual(reasons, ['owned_surfaces_below_two']);
});
