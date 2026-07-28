import assert from 'node:assert/strict';
import test from 'node:test';

import { planSeamRewrite, relativeSpecifier, scanImportStatements } from '../src/seam-rewrite.mjs';

// ADR 0137。決まった移動を機械的に実行するだけの書き換え。整形の裁量を持ち込まない。

const SOURCE = [
  "import { createHash } from 'node:crypto';",
  "import {",
  "  helperA,",
  "  helperB as renamed,",
  "} from './other.mjs';",
  '',
  '/** 共有の逃がし文字。 */',
  'function escapeText(value) {',
  "  return String(value).replaceAll('&', '&amp;');",
  '}',
  '',
  '/**',
  ' * 左ペイン。',
  ' */',
  'function renderLeft(value) {',
  '  return escapeText(value) + createHash;',
  '}',
  '',
  'const CSS = `body { color: red; }`;',
  '',
  'export function renderAll(value) {',
  '  return renderLeft(value) + CSS + helperA + renamed;',
  '}',
  '',
].join('\n');

const EXTENTS = {
  escapeText: { startLine: 8, endLine: 10 },
  renderLeft: { startLine: 15, endLine: 17 },
  CSS: { startLine: 19, endLine: 19 },
};

const candidate = (overrides = {}) => ({
  schema: 'lattice.bounded_seam_candidate.v2',
  source_path: 'src/page.mjs',
  surfaces: [
    { role: 'residual', path: 'src/page.mjs', owner_task_ids: [], symbols: [] },
    { role: 'shared', path: 'src/page.seam-shared.mjs', owner_task_ids: [], symbols: ['escapeText'] },
    { role: 'task_owned', path: 'src/page.seam-left.mjs', owner_task_ids: ['T1'], symbols: ['renderLeft'] },
    { role: 'task_owned', path: 'src/page.seam-css.mjs', owner_task_ids: ['T2'], symbols: ['CSS'] },
  ],
  ...overrides,
});

test('宣言はJSDocごと移り、移した先でexportされる', () => {
  const { files, reasons } = planSeamRewrite({
    sourceText: SOURCE, candidate: candidate(), symbolExtents: EXTENTS,
  });
  assert.deepEqual(reasons, []);

  // JSDocを置き去りにしない。残余に持ち主のいない説明を残さない。
  assert.match(files['src/page.seam-left.mjs'], /\/\*\*\n \* 左ペイン。\n \*\/\nexport function renderLeft/u);
  assert.match(files['src/page.seam-shared.mjs'], /\/\*\* 共有の逃がし文字。 \*\/\nexport function escapeText/u);
  assert.match(files['src/page.seam-css.mjs'], /^.*export const CSS = /msu);

  // 移した本文は原pathから消える。
  assert.equal(files['src/page.mjs'].includes('function renderLeft'), false);
  assert.equal(files['src/page.mjs'].includes('const CSS ='), false);
  assert.equal(files['src/page.mjs'].includes('左ペイン'), false);
});

test('移した先は使うimportだけを持ち込み、使わないものは持ち込まない', () => {
  const { files } = planSeamRewrite({
    sourceText: SOURCE, candidate: candidate(), symbolExtents: EXTENTS,
  });
  // renderLeftはcreateHashを使う。helperA/renamedは使わない。
  assert.match(files['src/page.seam-left.mjs'], /import \{ createHash \} from 'node:crypto';/u);
  assert.equal(files['src/page.seam-left.mjs'].includes('./other.mjs'), false);
  // CSSは何も使わないのでimportを持たない。
  assert.equal(files['src/page.seam-css.mjs'].includes('import'), false);
});

test('面をまたぐ参照は相対importとして張られる', () => {
  const { files } = planSeamRewrite({
    sourceText: SOURCE, candidate: candidate(), symbolExtents: EXTENTS,
  });
  // 所有面から共有面へ。向きは所有→共有だけ。
  assert.match(files['src/page.seam-left.mjs'],
    /import \{ escapeText \} from '\.\/page\.seam-shared\.mjs';/u);
  // 残余は移った分を取り戻す。既存importは重複しない。
  const residual = files['src/page.mjs'];
  assert.match(residual, /import \{ CSS \} from '\.\/page\.seam-css\.mjs';/u);
  assert.match(residual, /import \{ renderLeft \} from '\.\/page\.seam-left\.mjs';/u);
  assert.equal(residual.match(/from 'node:crypto'/gu).length, 1);
  // 残余が使わない共有symbolは取り戻さない。
  assert.equal(residual.includes('page.seam-shared.mjs'), false);
});

test('範囲が重なる宣言は整形で解かずに止める', () => {
  const { files, reasons } = planSeamRewrite({
    sourceText: SOURCE,
    candidate: candidate(),
    symbolExtents: { ...EXTENTS, renderLeft: { startLine: 8, endLine: 17 } },
  });
  assert.equal(files, null);
  assert.equal(reasons.some((reason) => reason.startsWith('symbol_extent_overlap:')), true);
});

test('行範囲の無いsymbolは黙って落とさない', () => {
  const { files, reasons } = planSeamRewrite({
    sourceText: SOURCE,
    candidate: candidate(),
    symbolExtents: { escapeText: EXTENTS.escapeText, renderLeft: EXTENTS.renderLeft },
  });
  assert.equal(files, null);
  assert.deepEqual(reasons, ['symbol_extent_missing:CSS']);
});

test('import文は複数行と別名束縛を1文として読む', () => {
  const { statements, endIndex } = scanImportStatements(SOURCE.split('\n'));
  assert.equal(statements.length, 2);
  assert.equal(endIndex, 4);
  assert.deepEqual(statements[0].bindings, ['createHash']);
  assert.deepEqual(statements[1].bindings, ['helperA', 'renamed']);
});

// 親・兄弟ディレクトリへの移動で解決不能なspecifierを作らない（sc-002）。
// 以前は行き先がfromの配下でない時に`./<repo相対>`を返し、ESMが解決できなかった。
test('相対specifierは親・兄弟ディレクトリへの移動でも解決できる形になる', () => {
  assert.equal(relativeSpecifier('src/page.mjs', 'src/page-left.mjs'), './page-left.mjs');
  assert.equal(relativeSpecifier('src/a/x.mjs', 'src/b/y.mjs'), '../b/y.mjs');
  assert.equal(relativeSpecifier('src/a/x.mjs', 'src/y.mjs'), '../y.mjs');
  assert.equal(relativeSpecifier('src/x.mjs', 'src/a/y.mjs'), './a/y.mjs');
  assert.equal(relativeSpecifier('src/a/b/x.mjs', 'lib/y.mjs'), '../../../lib/y.mjs');
});
