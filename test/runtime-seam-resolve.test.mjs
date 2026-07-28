import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RUNTIME_SEAM_REQUEST_SCHEMA, buildRuntimeSeamResolution, buildRuntimeSeamWitnessSet,
  readRuntimeFindingRecord, validateRuntimeSeamRequest, verifySeamSplitSuccessor,
  reconcileWitnessToObservation,
} from '../src/runtime-seam-resolve.mjs';
import { explainTodoWitnessSet } from '../src/todo-independence-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// 請求項8の入口。AIが宣言できるのは「係争fileの中で自分が触るsymbol」と「新しい面の名前」だけで、
// Latticeはそれ以上を推定しない。宣言が実態と噛み合わない時は受けずに直列へ倒す。

const DIGEST = (character) => character.repeat(64);

function sealedRequest(overrides = {}) {
  const value = {
    schema: RUNTIME_SEAM_REQUEST_SCHEMA,
    run_id: 'run-1',
    finding_digest: DIGEST('a'),
    concern_symbols: { T1: ['renderLeft'], T2: ['CSS'] },
    path_names: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs' },
    task_migration_digest: DIGEST('2'),
    request_digest: '',
    ...overrides,
  };
  value.request_digest = todoSelfDigest(value, 'request_digest');
  return value;
}

test('宣言が揃っていれば受理する', () => {
  assert.equal(validateRuntimeSeamRequest(sealedRequest()), true);
});

test('digestが合わない宣言を受けない', () => {
  const value = sealedRequest();
  value.task_migration_digest = DIGEST('3');
  assert.equal(validateRuntimeSeamRequest(value), false);
});

test('名前が片方しか無い宣言を受けない', () => {
  // 所有面が2つ揃わなければ切断は成立しない。片方だけで通すと、
  // splitが所有を宣言しない資源が残る。
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    path_names: { T1: 'src/page-left.mjs', shared: 'src/page-shared.mjs' },
  })), false);
});

test('共有面の名前が無い宣言を受けない', () => {
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    path_names: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs' },
  })), false);
});

test('symbolを1つも挙げていないTODOがある宣言を受けない', () => {
  // 触るsymbolが無いなら、その資源に対する切断の当事者ではない。
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    concern_symbols: { T1: ['renderLeft'], T2: [] },
  })), false);
});

test('repoの外を指す名前を受けない', () => {
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    path_names: { T1: '../outside.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs' },
  })), false);
});

test('実行時witnessへconcern anchorを足してtodo witness setにする', () => {
  const witness = (tests) => ({
    owns: [{ kind: 'path', target: 'src/page.mjs' }],
    reads: [], writes: ['src/page.mjs'], resources: [], state_effects: [],
    sensor_provenance: { queries: [] }, affected_tests: tests, unknowns: [],
  });
  const { witnessSet, reasons } = buildRuntimeSeamWitnessSet({
    request: {
      manual_witness: { T1: witness(['test/a.test.mjs']), T2: witness(['test/b.test.mjs']) },
      sensor_query_set: { queries: [{ id: 'q-status', operation: 'status' }] },
    },
    declaration: sealedRequest(),
    contestedPath: 'src/page.mjs',
    executors: 2,
  });
  assert.deepEqual(reasons, []);
  assert.equal(witnessSet.schema, 'lattice.todo_witness_set.v3');
  assert.deepEqual(witnessSet.manual_witness.T1.concern_anchors, [
    { within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['renderLeft'] },
  ]);
  // 実行時witnessの中身は書き換えない。anchorを足すだけ。
  assert.deepEqual(witnessSet.manual_witness.T2.affected_tests, ['test/b.test.mjs']);
  assert.equal(witnessSet.witness_set_digest, todoSelfDigest(witnessSet, 'witness_set_digest'));
});

test('宣言されたTODOのwitnessが無ければ組まない', () => {
  const { witnessSet, reasons } = buildRuntimeSeamWitnessSet({
    request: { manual_witness: {}, sensor_query_set: { queries: [] } },
    declaration: sealedRequest(),
    contestedPath: 'src/page.mjs',
    executors: 2,
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['witness_absent:T1']);
});

test('別epochのfindingを受けない', async (context) => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'lattice-seam-resolve-'));
  context.after(() => rm(runDir, { recursive: true, force: true }));
  await mkdir(path.join(runDir, 'findings'), { recursive: true });
  const record = { finding_digest: DIGEST('a'), plan_epoch: 1, finding: { kind: 'observed_write_conflict' } };
  await writeFile(path.join(runDir, 'findings', `${DIGEST('a')}.json`), JSON.stringify(record));

  const same = await readRuntimeFindingRecord({ runDir, findingDigest: DIGEST('a'), planEpoch: 1 });
  assert.equal(same.record.plan_epoch, 1);

  const other = await readRuntimeFindingRecord({ runDir, findingDigest: DIGEST('a'), planEpoch: 2 });
  assert.equal(other.record, null);
  assert.equal(other.reason, 'finding_from_other_epoch');

  const missing = await readRuntimeFindingRecord({ runDir, findingDigest: DIGEST('b'), planEpoch: 1 });
  assert.equal(missing.reason, 'finding_not_recorded');
});

// --- seam_split再計画の後継base検査（ADR 0141）

const SPLIT = {
  edge_diff: { removed: [{ from_todo_id: 'T1', to_todo_id: 'T2', kind: 'conflict' }], added: [] },
  ownership_diff: {
    added: [
      { resource_id: 'own-path-0000000000000000', owner_todo_id: 'T1', access_kind: 'own' },
    ],
    removed: [],
  },
};

const successorBase = (overrides = {}) => ({
  split: SPLIT,
  predecessorBaseSha: 'a'.repeat(40),
  successorBaseSha: 'b'.repeat(40),
  successorIsDescendant: true,
  successorConflicts: [],
  successorWitness: { T1: { owns: [{ kind: 'path', target: 'src/page-left.mjs' }] } },
  ...overrides,
});

test('前進した子孫baseで、宣言どおり競合が消えていれば通す', () => {
  assert.deepEqual(verifySeamSplitSuccessor(successorBase()), { ok: true, reasons: [] });
});

test('baseが前進していないseam splitを通さない', () => {
  // 変換が着地していなければbaseは動かない。これが直す前の姿である。
  const verdict = verifySeamSplitSuccessor(successorBase({ successorBaseSha: 'a'.repeat(40) }));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ['successor_base_not_advanced']);
});

test('旧baseの子孫でないbaseを指すseam splitを通さない', () => {
  const verdict = verifySeamSplitSuccessor(successorBase({ successorIsDescendant: false }));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ['successor_base_not_descendant']);
});

test('消えるはずの競合が後継planに残っていれば通さない', () => {
  // 後継treeに変換が載っていなければ両TODOは同じfileを書き続け、この辺は消えない。
  const verdict = verifySeamSplitSuccessor(successorBase({
    successorConflicts: [{ todo_ids: ['T2', 'T1'], resource_id: 'rw-x' }],
  }));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ['declared_removed_conflict_persists:T1,T2']);
});

test('新しい面をこれから作ると宣言しているseam splitを通さない', () => {
  // seam splitは既存codeを移す操作で、変換が既にfileを作っている。creationなら
  // 指しているbaseは変換前である。
  const own = { kind: 'path', target: 'src/page-left.mjs', creates: true };
  const id = `own-path-${createHash('sha256').update(own.target, 'utf8').digest('hex').slice(0, 16)}`;
  const verdict = verifySeamSplitSuccessor(successorBase({
    split: { ...SPLIT, ownership_diff: { added: [{ resource_id: id, owner_todo_id: 'T1', access_kind: 'own' }], removed: [] } },
    successorWitness: { T1: { owns: [own] } },
  }));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ['declared_owned_surface_is_creation:T1']);
});

test('拒否された処置は後継baseを持たない決着になる', () => {
  const resolution = buildRuntimeSeamResolution({
    runId: 'run-1', findingDigest: DIGEST('a'),
    resolved: { lane: 'intentional_serial', reasons: ['transform_not_committed'], split: null },
  });
  assert.equal(resolution.lane, 'intentional_serial');
  assert.equal(resolution.successor_base_sha, null);
  assert.equal(resolution.split, null);
  assert.deepEqual(resolution.reconciled, []);
  assert.equal(resolution.resolution_digest, todoSelfDigest(resolution, 'resolution_digest'));
});

test('翻訳で広げた宣言は決着に残る', () => {
  const resolution = buildRuntimeSeamResolution({
    runId: 'run-1', findingDigest: DIGEST('a'),
    resolved: {
      lane: 'intentional_serial', reasons: [], split: null,
      widened: [{
        todo_id: 'T2', resource: { kind: 'path', target: 'src/page.mjs' },
        fields: ['writes', 'owns'],
      }],
    },
  });
  assert.deepEqual(resolution.reconciled, [{
    todo_id: 'T2', resource: { kind: 'path', target: 'src/page.mjs' }, fields: ['owns', 'writes'],
  }]);
  assert.equal(resolution.resolution_digest, todoSelfDigest(resolution, 'resolution_digest'));
});

test('係争資源を所有していない側の宣言を、観測が示した資源だけ広げる', () => {
  const witness = (owns) => ({
    owns, reads: [], writes: owns.map(({ target }) => target), resources: [], state_effects: [],
    sensor_provenance: { queries: [] }, affected_tests: [], unknowns: [],
  });
  const { manualWitness, widened, reasons } = reconcileWitnessToObservation({
    manualWitness: {
      T1: witness([{ kind: 'path', target: 'src/page.mjs' }]),
      T2: witness([{ kind: 'path', target: 'src/widget.mjs' }]),
    },
    contestedPath: 'src/page.mjs',
    todoIds: ['T1', 'T2'],
    sensorQuerySet: { queries: [{ id: 'q-page-aff', operation: 'affected', target: 'src/page.mjs' }] },
    observedAffectedTests: ['test/page.test.mjs'],
  });
  assert.deepEqual(reasons, []);
  // 予測が実態を覆っていた側は触らない。操作は対称でも、結果は観測が決める。
  assert.deepEqual(manualWitness.T1.owns, [{ kind: 'path', target: 'src/page.mjs' }]);
  assert.deepEqual(manualWitness.T2.owns, [
    { kind: 'path', target: 'src/page.mjs' },
    { kind: 'path', target: 'src/widget.mjs' },
  ]);
  assert.deepEqual(manualWitness.T2.writes, ['src/page.mjs', 'src/widget.mjs']);
  assert.deepEqual(widened, [{
    todo_id: 'T2',
    resource: { kind: 'path', target: 'src/page.mjs' },
    fields: ['affected_tests', 'owns', 'sensor_provenance', 'writes'],
  }]);
  // 面を引き受けたので、その面の裏取りとaffected testも引き受ける。所有だけ広げると
  // `sensor_unbound`になり、compileが競合を投影しなくなる。
  assert.deepEqual(manualWitness.T2.sensor_provenance.queries, [
    { query_id: 'q-page-aff', expect: { kind: 'affected', path: 'src/page.mjs' } },
  ]);
  assert.deepEqual(manualWitness.T2.affected_tests, ['test/page.test.mjs']);
  // 観測が示していない資源は増やさない。
  assert.equal(manualWitness.T2.owns.some(({ target }) => target === 'src/other.mjs'), false);
});

test('裏取りに使えるqueryが無ければ、広げずに理由を返す', () => {
  const witness = (owns) => ({
    owns, reads: [], writes: owns.map(({ target }) => target), resources: [], state_effects: [],
    sensor_provenance: { queries: [] }, affected_tests: [], unknowns: [],
  });
  const result = reconcileWitnessToObservation({
    manualWitness: {
      T1: witness([{ kind: 'path', target: 'src/page.mjs' }]),
      T2: witness([{ kind: 'path', target: 'src/widget.mjs' }]),
    },
    contestedPath: 'src/page.mjs',
    todoIds: ['T1', 'T2'],
    sensorQuerySet: { queries: [{ id: 'q-status', operation: 'status' }] },
    observedAffectedTests: ['test/page.test.mjs'],
  });
  // 証明できない宣言を作らない。広げたことにして先へ進むと、compileが非dispatchableへ落ちて
  // 競合が投影されず、「翻訳したのに変換の便益が測れない」状態になる。
  assert.equal(result.manualWitness, null);
  assert.deepEqual(result.reasons, ['observation_unbacked:T2:src/page.mjs']);
});

test('係争資源を所有していないTODOの宣言でも、変換の入力として組める', () => {
  const witness = (owns) => ({
    owns, reads: [], writes: owns.map(({ target }) => target), resources: [], state_effects: [],
    sensor_provenance: { queries: [] }, affected_tests: ['test/a.test.mjs'], unknowns: [],
  });
  const built = buildRuntimeSeamWitnessSet({
    request: {
      manual_witness: {
        T1: witness([{ kind: 'path', target: 'src/page.mjs' }]),
        T2: witness([{ kind: 'path', target: 'src/widget.mjs' }]),
      },
      sensor_query_set: {
        queries: [{ id: 'q-page-aff', operation: 'affected', target: 'src/page.mjs' }],
      },
    },
    declaration: sealedRequest(),
    contestedPath: 'src/page.mjs',
    executors: 2,
    observedAffectedTests: ['test/a.test.mjs'],
  });
  // 翻訳を通さないと、所有していない資源の内側にanchorを立てることになり必ず不正になる。
  assert.deepEqual(explainTodoWitnessSet(built.witnessSet), { valid: true });
  assert.deepEqual(built.widened.map(({ todo_id: id }) => id), ['T2']);
});
