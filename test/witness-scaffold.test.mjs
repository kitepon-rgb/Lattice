import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTodoWitnessSet } from '../src/todo-independence-contracts.mjs';
import { canonicalizeTodoArtifact } from '../src/todo-contracts.mjs';
import {
  buildWitnessObservationQuerySet, buildWitnessSet, serializeWitnessSet, validateWitnessDraft,
} from '../src/witness-scaffold.mjs';

// AGENTS.md「装置の境界」。推定はしない——何を所有し何を触るかは下書きが述べる。
// 道具が供給するのはAIには作れないものだけ: fresh観測、配線、canonical bytes。

const draft = (overrides = {}) => ({
  schema: 'lattice.todo_witness_draft.v1',
  project_id: 'lattice',
  plan_key: 'main',
  capacity: { executors: 2 },
  tasks: {
    T1: {
      owns: ['src/page.mjs'],
      concern_anchors: [{ within: 'src/page.mjs', symbols: ['renderLeft'] }],
    },
    T2: { owns: ['src/style.mjs'], reads: ['src/page.mjs'] },
  },
  ...overrides,
});

/** 観測は三値を保つ。不存在は「観測できていない」ではなく「不在と観測できた」である。 */
const present = (target, affectedTests) => ({
  state: 'present', affectedTests, changedFiles: [target],
});
const absent = (target) => ({ state: 'absent', affectedTests: [], changedFiles: [target] });

const observed = {
  'src/page.mjs': present('src/page.mjs', ['test/page.test.mjs', 'test/all.test.mjs']),
  'src/style.mjs': present('src/style.mjs', []),
};

test('下書きと観測から、そのまま通る宣言を組む', () => {
  const { witnessSet, reasons } = buildWitnessSet({ draft: draft(), observationByPath: observed });
  assert.deepEqual(reasons, []);
  assert.equal(validateTodoWitnessSet(witnessSet), true);

  // 観測はそのまま載る。手で当てると外れる欄なので、書き手に書かせない。
  assert.deepEqual(witnessSet.manual_witness.T1.affected_tests,
    ['test/all.test.mjs', 'test/page.test.mjs']);
  // 所有pathとprovenanceが同じ資源を指す。別々を指すと宣言と証拠がずれる。
  assert.equal(witnessSet.manual_witness.T1.sensor_provenance.queries[0].expect.path, 'src/page.mjs');
  const queryId = witnessSet.manual_witness.T1.sensor_provenance.queries[0].query_id;
  assert.equal(witnessSet.sensor_query_set.queries
    .some(({ id, target }) => id === queryId && target === 'src/page.mjs'), true);
  assert.deepEqual(witnessSet.manual_witness.T1.concern_anchors,
    [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['renderLeft'] }]);
});

test('書き出すbytesはcanonicalで末尾LFを持つ', () => {
  // 非canonicalな宣言は独立性判定を通ってseam提案でだけ落ちる。
  const { witnessSet } = buildWitnessSet({ draft: draft(), observationByPath: observed });
  const bytes = serializeWitnessSet(witnessSet);
  assert.equal(bytes.endsWith('\n'), true);
  assert.equal(bytes, `${canonicalizeTodoArtifact(JSON.parse(bytes))}\n`);
});

test('観測できていないpathを空配列へ丸めない', () => {
  const { witnessSet, reasons } = buildWitnessSet({
    draft: draft(), observationByPath: { 'src/page.mjs': present('src/page.mjs', []) },
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['affected_tests_unobserved:src/style.mjs']);
});

test('複数pathを所有する宣言は、今の契約で表現できないので断る', () => {
  // affected_testsは宣言とfresh観測をbinding単位でexact比較する。観測集合が一致しない限り
  // 必ず落ちるので、書けたことにしない。
  const { witnessSet, reasons } = buildWitnessSet({
    draft: draft({ tasks: { T1: { owns: ['src/page.mjs', 'src/style.mjs'] } } }),
    observationByPath: observed,
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['multiple_owned_paths_unsupported:T1']);
});

test('所有していない資源の内側へ担当を主張させない', () => {
  const { witnessSet, reasons } = buildWitnessSet({
    draft: draft({
      tasks: {
        T1: {
          owns: ['src/page.mjs'],
          concern_anchors: [{ within: 'src/style.mjs', symbols: ['CSS'] }],
        },
      },
    }),
    observationByPath: observed,
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['anchor_outside_owned:T1:src/style.mjs']);
});

test('明示unknownは道具が発明も削除もしない', () => {
  const { witnessSet } = buildWitnessSet({
    draft: draft({
      tasks: {
        T1: {
          owns: ['src/page.mjs'],
          unknowns: [{ kind: 'boundary_undetermined_until_design', ref: 'src/other.mjs' }],
        },
      },
    }),
    observationByPath: observed,
  });
  assert.deepEqual(witnessSet.manual_witness.T1.unknowns,
    [{ kind: 'boundary_undetermined_until_design', ref: 'src/other.mjs' }]);
});

test('下書きは所有pathごとに1つのaffected queryを引く', () => {
  const { queries, paths } = buildWitnessObservationQuerySet(draft());
  assert.deepEqual(paths, ['src/page.mjs', 'src/style.mjs']);
  assert.deepEqual(queries.map(({ operation }) => operation), ['status', 'affected', 'affected']);
});

test('形の壊れた下書きを受理しない', () => {
  assert.equal(validateWitnessDraft(draft({ tasks: {} })), false);
  assert.equal(validateWitnessDraft(draft({ schema: 'other' })), false);
  assert.equal(validateWitnessDraft(draft({ capacity: { executors: 0 } })), false);
  assert.equal(validateWitnessDraft(draft({
    tasks: { T1: { owns: ['/absolute/path.mjs'] } },
  })), false);
});

// --- 創作境界（ADR 0136）。まだ存在しないpathを所有するToDoの宣言を、道具で作れるようにする。

const creationDraft = (overrides = {}) => ({
  schema: 'lattice.todo_witness_draft.v2',
  project_id: 'lattice',
  plan_key: 'main',
  capacity: { executors: 2 },
  tasks: { T1: { owns: [{ path: 'scripts/new-gate.mjs', creates: true }] } },
  ...overrides,
});

test('創作を宣言したpathは、不在と観測できていれば裏付けありとして組む', () => {
  const { witnessSet, reasons } = buildWitnessSet({
    draft: creationDraft(),
    observationByPath: { 'scripts/new-gate.mjs': absent('scripts/new-gate.mjs') },
  });
  assert.deepEqual(reasons, []);
  assert.equal(validateTodoWitnessSet(witnessSet), true);
  // 創作宣言はowns側に載る。裏付けを決めるのはbindingだが、宣言する欄はここである。
  assert.deepEqual(witnessSet.manual_witness.T1.owns,
    [{ kind: 'path', target: 'scripts/new-gate.mjs', creates: true }]);
  // まだ無いのだから、依存するtestも無い。観測がそう言っている。
  assert.deepEqual(witnessSet.manual_witness.T1.affected_tests, []);
});

test('既に在るpathへ創作を宣言したら断る', () => {
  // 実害は無いが、宣言が実態とずれている。ずれたまま通すと、判定の前提が壊れる。
  const { witnessSet, reasons } = buildWitnessSet({
    draft: creationDraft(),
    observationByPath: { 'scripts/new-gate.mjs': present('scripts/new-gate.mjs', ['test/a.test.mjs']) },
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['creates_path_present:scripts/new-gate.mjs']);
});

test('不在なのに創作を宣言していないpathは、次の一手を添えて断る', () => {
  // 「観測できていない」ではなく「作るならそう宣言する」が正しい案内である。
  const { witnessSet, reasons } = buildWitnessSet({
    draft: creationDraft({
      schema: 'lattice.todo_witness_draft.v2',
      tasks: { T1: { owns: ['scripts/new-gate.mjs'] } },
    }),
    observationByPath: { 'scripts/new-gate.mjs': absent('scripts/new-gate.mjs') },
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['path_absent_declare_creates:scripts/new-gate.mjs']);
});

test('front endが要求する形を満たさない観測では創作を裏付けない', () => {
  // changedFilesが対象1件でなければ、front endのcreationBoundaryStatusがcreates_unverifiedを返す。
  // 通る宣言を作ったつもりでcompileで落ちる状態を、道具の側で止める。
  const { witnessSet, reasons } = buildWitnessSet({
    draft: creationDraft(),
    observationByPath: {
      'scripts/new-gate.mjs': { state: 'absent', affectedTests: [], changedFiles: [] },
    },
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['creates_unverified:scripts/new-gate.mjs']);
});

test('v1の下書きは創作宣言を表現できない', () => {
  // 版で線を引く。v1のstringだけのownsへ`creates`を持ち込めないようにする。
  assert.equal(validateWitnessDraft(creationDraft({ schema: 'lattice.todo_witness_draft.v1' })), false);
  assert.equal(validateWitnessDraft(creationDraft()), true);
});

test('prefix形のpathへ創作を宣言させない', () => {
  // 末尾/はaffectedがunresolvedを返すので、file単位に限る（ADR 0136）。
  assert.equal(validateWitnessDraft(creationDraft({
    tasks: { T1: { owns: [{ path: 'docs/evidence/', creates: true }] } },
  })), false);
});
