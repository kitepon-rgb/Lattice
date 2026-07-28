import assert from 'node:assert/strict';
import test from 'node:test';

import { classifySeamCost, fileCycles } from '../src/seam-cost.mjs';

// 切断コストの内訳（docs/plan_seam-cost.md）。装置は数えられる事実だけを返し、
// 閾値も可否判定も持たない。分類が正しいことをここで固定する。

const NODES = [
  { name: 'renderLeft', kind: 'function', startLine: 5, endLine: 7, isExported: false },
  { name: 'CSS', kind: 'constant', startLine: 2, endLine: 2, isExported: false },
  { name: 'styleCache', kind: 'constant', startLine: 3, endLine: 3, isExported: false },
  { name: 'formatText', kind: 'function', startLine: 9, endLine: 11, isExported: false },
  { name: 'renderPage', kind: 'function', startLine: 13, endLine: 15, isExported: true },
];

const SOURCE = [
  "import { helper } from './helper.mjs';",
  "const CSS = 'body {}';",
  'const styleCache = {};',
  '',
  'function renderLeft(value) {',
  '  return helper(styleCache) + formatText(value);',
  '}',
  '',
  'function formatText(value) {',
  '  return String(value);',
  '}',
  '',
  'export function renderPage(value) {',
  '  return helper(CSS) + renderLeft(value);',
  '}',
  '',
].join('\n');

function base(overrides = {}) {
  return {
    sourcePath: 'src/page.mjs',
    sourceText: SOURCE,
    nodes: NODES,
    ownedSymbolsByTask: { T1: ['renderLeft'], T2: ['renderPage'] },
    calleesBySymbol: {
      renderLeft: [
        { name: 'styleCache', path: 'src/page.mjs', edgeKind: 'references', valueRef: true },
        { name: 'formatText', path: 'src/page.mjs', edgeKind: 'calls', valueRef: false },
      ],
      renderPage: [
        { name: 'CSS', path: 'src/page.mjs', edgeKind: 'references', valueRef: true },
        { name: 'renderLeft', path: 'src/page.mjs', edgeKind: 'calls', valueRef: false },
      ],
    },
    ...overrides,
  };
}

test('task間の直接辺を、辺種別つきで数える', () => {
  const profile = classifySeamCost(base());
  assert.deepEqual(profile.cross_edges, [{
    from_task: 'T2', from: 'renderPage', to_task: 'T1', to: 'renderLeft',
    edge_kind: 'calls', value_ref: false, value_write: false,
  }]);
});

test('共有を複製可能性で分ける——stateとfunctionとimport', () => {
  const profile = classifySeamCost({
    ...base(),
    calleesBySymbol: {
      renderLeft: [
        { name: 'styleCache', path: 'src/page.mjs', edgeKind: 'references', valueRef: true },
        { name: 'formatText', path: 'src/page.mjs', edgeKind: 'calls', valueRef: false },
      ],
      renderPage: [
        { name: 'styleCache', path: 'src/page.mjs', edgeKind: 'references', valueRef: true },
        { name: 'formatText', path: 'src/page.mjs', edgeKind: 'calls', valueRef: false },
      ],
    },
  });
  // 両taskが同じmodule定数へ届く=複製できない共有。
  assert.deepEqual(profile.shared_state, [
    { name: 'styleCache', kind: 'constant', referenced_by: ['T1', 'T2'], written_by: [] },
  ]);
  // 共有関数は共有面へ出せる側。
  assert.deepEqual(profile.shared_functions, [
    { name: 'formatText', kind: 'function', referenced_by: ['T1', 'T2'] },
  ]);
  // importの共有は複製できるので別枠。両bodyがhelperへ言及している。
  assert.deepEqual(profile.shared_imports, [
    { statement: "import { helper } from './helper.mjs';", used_by: ['T1', 'T2'] },
  ]);
});

test('片方しか届かない共有は、届いたtaskだけを記録する', () => {
  const profile = classifySeamCost(base());
  assert.deepEqual(profile.shared_state, [
    { name: 'CSS', kind: 'constant', referenced_by: ['T2'], written_by: [] },
    { name: 'styleCache', kind: 'constant', referenced_by: ['T1'], written_by: [] },
  ]);
});

test('両taskを跨ぐ循環だけをsame_cycleとして返す', () => {
  const profile = classifySeamCost({
    ...base(),
    calleesBySymbol: {
      renderLeft: [{ name: 'renderPage', path: 'src/page.mjs', edgeKind: 'calls', valueRef: false }],
      renderPage: [{ name: 'renderLeft', path: 'src/page.mjs', edgeKind: 'calls', valueRef: false }],
    },
  });
  assert.deepEqual(profile.same_cycle, [
    { symbols: ['renderLeft', 'renderPage'], task_ids: ['T1', 'T2'] },
  ]);
});

test('symbolごとに行数と公開面を数え、判断はしない', () => {
  const profile = classifySeamCost(base());
  assert.deepEqual(profile.tasks.T1.symbols, [
    { name: 'renderLeft', kind: 'function', lines: 3, exported: false },
  ]);
  assert.deepEqual(profile.tasks.T2.symbols, [
    { name: 'renderPage', kind: 'function', lines: 3, exported: true },
  ]);
});

test('盲点をconfidenceで申告する——打ち切り・本文不明・辺フィルタ・write情報', () => {
  const profile = classifySeamCost({
    ...base(),
    ownedSymbolsByTask: { T1: ['renderLeft'], T2: ['ghostSymbol'] },
    truncatedSymbols: ['renderLeft'],
  });
  assert.deepEqual(profile.confidence.callees_truncated, ['renderLeft']);
  assert.deepEqual(profile.confidence.body_missing, ['ghostSymbol']);
  assert.equal(profile.confidence.value_ref_name_filter,
    'names-under-3-chars-invisible-in-edges');
  assert.equal(profile.confidence.write_distinction, 'ts-js-wasm-pipeline-only');
  assert.equal(profile.confidence.imports_analysis, 'esm-only');
});

test('書く側と読むだけの側を、共有stateのwritten_byで区別する', () => {
  const profile = classifySeamCost({
    ...base(),
    calleesBySymbol: {
      renderLeft: [
        { name: 'styleCache', path: 'src/page.mjs', edgeKind: 'references', valueRef: true, valueWrite: true },
      ],
      renderPage: [
        { name: 'styleCache', path: 'src/page.mjs', edgeKind: 'references', valueRef: true, valueWrite: false },
      ],
    },
  });
  assert.deepEqual(profile.shared_state, [
    { name: 'styleCache', kind: 'constant', referenced_by: ['T1', 'T2'], written_by: ['T1'] },
  ]);
});

test('fileCyclesは相互再帰を見つけ、自己再帰だけの成分は返さない', () => {
  const adjacency = new Map([
    ['a', ['b']],
    ['b', ['a', 'c']],
    ['c', ['c']],
    ['d', []],
  ]);
  assert.deepEqual(fileCycles(adjacency), [['a', 'b']]);
});
