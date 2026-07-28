import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPostTransformWitnessSet,
  compareExportSurface,
  evaluateSeamVerification,
  measureWaveCount,
  readExportSurface,
} from '../src/seam-verification.mjs';

// ADR 0138。五条件をすべて満たしたときだけ採用する。1つでも欠けたら棄却であり、
// どれが欠けたかを残す。「だいたい良さそう」で通す経路を作らない。

const passing = () => ({
  exportSurface: { preserved: true, missing: [] },
  focusedTestsPassed: true,
  sensorFresh: true,
  conflictPairs: { targetResolved: true, before: 3, after: 2 },
  waves: { before: 2, after: 1 },
});

test('五条件が揃ったときだけ採用する', () => {
  const result = evaluateSeamVerification(passing());
  assert.equal(result.decision, 'accepted');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(Object.values(result.conditions), [true, true, true, true, true]);
});

test('1つでも欠ければ棄却し、欠けた条件を名指しする', () => {
  const cases = [
    [{ exportSurface: { preserved: false, missing: ['renderAll'] } }, 'behavior_equivalent:renderAll'],
    [{ focusedTestsPassed: false }, 'focused_tests_passed'],
    [{ sensorFresh: false }, 'sensor_fresh'],
    [{ conflictPairs: { targetResolved: false, before: 3, after: 2 } },
      'overlap_reduced:target_conflict_remains'],
    // 対象競合は消えたが、切った先で別の作業対の競合が増えた構成。
    [{ conflictPairs: { targetResolved: true, before: 2, after: 3 } },
      'overlap_reduced:pairs_increased:2->3'],
    // 競合は消えたが波数が変わらない。並列化を解放していないので便益が無い。
    [{ waves: { before: 2, after: 2 } }, 'parallelism_improved:no_gain:2->2'],
  ];
  for (const [override, expected] of cases) {
    const result = evaluateSeamVerification({ ...passing(), ...override });
    assert.equal(result.decision, 'rejected', expected);
    assert.equal(result.failures.includes(expected), true,
      `${expected} not in ${JSON.stringify(result.failures)}`);
  }
});

test('観測が欠けていることを「満たした」へ丸めない', () => {
  const unknownWaves = evaluateSeamVerification({ ...passing(), waves: { before: null, after: 1 } });
  assert.equal(unknownWaves.failures.includes('parallelism_improved:waves_unknown'), true);
  const unknownPairs = evaluateSeamVerification({
    ...passing(), conflictPairs: { targetResolved: true, before: null, after: 1 },
  });
  assert.equal(unknownPairs.failures.includes('overlap_reduced:pair_count_unknown'), true);
});

test('公開面の欠落だけを外部挙動の違反とする', () => {
  const before = [
    'export const A = 1;',
    'export function b() {}',
    'export class C {}',
    'const hidden = 2;',
    'export { hidden as D };',
  ].join('\n');
  assert.deepEqual(readExportSurface(before), ['A', 'C', 'D', 'b']);

  // 分割で名前が減れば、原pathをimportしている外部が壊れる。
  const lost = compareExportSurface({ before, after: 'export const A = 1;' });
  assert.equal(lost.preserved, false);
  assert.deepEqual(lost.missing, ['C', 'D', 'b']);

  // 増えるだけなら既存の消費者は影響を受けない。
  const grown = compareExportSurface({ before, after: `${before}\nexport const E = 3;` });
  assert.equal(grown.preserved, true);
});

test('波数は変換前後を同じ規則で測る', () => {
  // 3 taskが一本の競合鎖で繋がると、容量2でも3段必要になる。
  const chained = measureWaveCount({
    taskIds: ['T1', 'T2', 'T3'],
    conflictPairs: [['T1', 'T2'], ['T2', 'T3'], ['T1', 'T3']],
    executors: 2,
  });
  assert.equal(chained.waves, 3);

  // 競合が消えれば容量に従って畳める。
  const free = measureWaveCount({ taskIds: ['T1', 'T2', 'T3'], conflictPairs: [], executors: 2 });
  assert.equal(free.waves, 2);

  // 測れなかったことをwaves=0へ丸めない。
  assert.equal(measureWaveCount({ taskIds: [], conflictPairs: [], executors: 2 }).waves, null);
});

test('変換後のwitnessは所有面を指し、宣言の中身を発明しない', () => {
  const candidate = {
    source_path: 'src/page.mjs',
    surfaces: [
      { role: 'task_owned', path: 'src/page.seam-left.mjs', owner_task_ids: ['T1'], symbols: ['renderLeft'] },
      { role: 'task_owned', path: 'src/page.seam-css.mjs', owner_task_ids: ['T2'], symbols: ['CSS'] },
      { role: 'residual', path: 'src/page.mjs', owner_task_ids: [], symbols: [] },
    ],
  };
  const witnessSet = {
    manual_witness: {
      T1: {
        owns: [{ kind: 'path', target: 'src/page.mjs' }],
        writes: ['src/page.mjs'],
        affected_tests: ['test/page.test.mjs'],
        concern_anchors: [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['renderLeft'] }],
      },
      T2: {
        owns: [{ kind: 'path', target: 'src/page.mjs' }],
        writes: ['src/page.mjs'],
        affected_tests: ['test/page.test.mjs'],
      },
    },
  };
  const { witnessSet: next, reasons } = buildPostTransformWitnessSet({
    witnessSet,
    candidate,
    affectedTestsByPath: {
      'src/page.seam-left.mjs': ['test/page.test.mjs'],
      'src/page.seam-css.mjs': [],
    },
  });
  assert.deepEqual(reasons, []);
  assert.deepEqual(next.manual_witness.T1.owns, [{ kind: 'path', target: 'src/page.seam-left.mjs' }]);
  assert.deepEqual(next.manual_witness.T1.writes, ['src/page.seam-left.mjs']);
  // 宣言symbolは変えず、指す資源だけを移す。
  assert.deepEqual(next.manual_witness.T1.concern_anchors,
    [{ within: { kind: 'path', target: 'src/page.seam-left.mjs' }, symbols: ['renderLeft'] }]);
  assert.deepEqual(next.manual_witness.T2.affected_tests, []);
  // 元の宣言は書き換えない。
  assert.deepEqual(witnessSet.manual_witness.T1.writes, ['src/page.mjs']);
});

test('観測できていないaffected testを空配列へ丸めない', () => {
  const candidate = {
    source_path: 'src/page.mjs',
    surfaces: [
      { role: 'task_owned', path: 'src/page.seam-left.mjs', owner_task_ids: ['T1'], symbols: ['renderLeft'] },
      { role: 'residual', path: 'src/page.mjs', owner_task_ids: [], symbols: [] },
    ],
  };
  const { witnessSet, reasons } = buildPostTransformWitnessSet({
    witnessSet: { manual_witness: { T1: { owns: [], writes: [], affected_tests: [] } } },
    candidate,
    affectedTestsByPath: {},
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['affected_tests_missing:src/page.seam-left.mjs']);
});

// 検証網（ADR 0145）。切断参照はbehavior_equivalentの中身として数える。

test('切断された参照が1つでもあれば外部挙動同等を落とし、fileとsymbolを名指しする', () => {
  const result = evaluateSeamVerification({
    ...passing(),
    severed: {
      observed: true,
      entries: [
        { file: 'src/page-left.mjs', name: 'counter' },
        { file: 'src/page-style.mjs', name: 'styleCache' },
      ],
    },
  });
  assert.equal(result.decision, 'rejected');
  assert.equal(result.conditions.behavior_equivalent, false);
  assert.deepEqual(result.failures, [
    'behavior_equivalent:severed_reference:src/page-left.mjs:counter',
    'behavior_equivalent:severed_reference:src/page-style.mjs:styleCache',
  ]);
});

test('切断参照の観測が組めなかったことを「切断なし」へ丸めない', () => {
  const result = evaluateSeamVerification({
    ...passing(),
    severed: { observed: false, entries: [] },
  });
  assert.equal(result.decision, 'rejected');
  assert.deepEqual(result.failures, ['behavior_equivalent:severed_observation_missing']);
});

test('切断参照が無ければ網は沈黙し、採用は五条件のまま決まる', () => {
  const result = evaluateSeamVerification({
    ...passing(),
    severed: { observed: true, entries: [] },
  });
  assert.equal(result.decision, 'accepted');
  assert.deepEqual(result.failures, []);
});
