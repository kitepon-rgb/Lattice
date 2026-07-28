/**
 * 三面の変換候補を実際のソースへ適用する書き換え（ADR 0137）。
 *
 * 決まった移動を機械的に実行するだけである。どこへ何を移すかはseam導出が決めており、
 * 「どう書くのが綺麗か」の裁量は持ち込まない。整形の判断を入れると、変換の前後で挙動以外の差が
 * 増え、外部挙動同等性の検証が何を見ているのか分からなくなる。
 *
 * 純関数として組む。worktreeへ書くのは呼び出し側の仕事で、ここはtextからtextを作る。
 */

const IMPORT_START = /^import[\s{*]/u;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\*\/)/u;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function fail(reasons) {
  return { files: null, reasons: [...new Set(reasons)].sort(compareText) };
}

/**
 * 先頭のimport文を、行範囲と束縛名つきで取り出す。
 *
 * 複数行importがあるので`from '...'`で終わる行までを1文とする。束縛名は、移した先で
 * どのimportが要るかを語単位で判定するために使う。
 */
export function scanImportStatements(lines) {
  const statements = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '' || COMMENT_LINE.test(line)) { index += 1; continue; }
    if (!IMPORT_START.test(line)) break;
    const start = index;
    while (index < lines.length
      && !/from\s+['"][^'"]+['"];?\s*$/u.test(lines[index])
      && !/^import\s+['"][^'"]+['"];?\s*$/u.test(lines[index])) index += 1;
    const end = Math.min(index, lines.length - 1);
    const text = lines.slice(start, end + 1).join('\n');
    statements.push({ text, bindings: importBindings(text), start, end });
    index = end + 1;
  }
  return { statements, endIndex: statements.length === 0 ? -1 : statements.at(-1).end };
}

export function importBindings(text) {
  const bindings = [];
  const namespace = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/u.exec(text);
  if (namespace) bindings.push(namespace[1]);
  const defaultBinding = /^import\s+([A-Za-z_$][\w$]*)\s*(?:,|\sfrom)/u.exec(text);
  if (defaultBinding) bindings.push(defaultBinding[1]);
  const named = /\{([\s\S]*?)\}/u.exec(text);
  if (named) {
    for (const entry of named[1].split(',')) {
      const parts = entry.split(/\s+as\s+/u).map((part) => part.trim());
      const name = parts.length > 1 ? parts[1] : parts[0];
      if (/^[A-Za-z_$][\w$]*$/u.test(name)) bindings.push(name);
    }
  }
  return [...new Set(bindings)];
}

/** 語として現れるか。string中やcomment中の一致も拾うが、余分なimportは害にならない。 */
export function mentions(text, name) {
  return new RegExp(`(?<![\\w$])${name.replace(/[$]/gu, '\\$$')}(?![\\w$])`, 'u').test(text);
}

/**
 * 宣言の範囲を直前の連続コメント行まで広げる。
 *
 * JSDocを置き去りにすると、残余に持ち主のいない説明が残り、移した先が無説明になる。
 * 空行で切るのは、離れた位置のコメントを巻き込まないため。
 */
function extendUpward(lines, startLine) {
  let start = startLine;
  while (start - 1 >= 1 && COMMENT_LINE.test(lines[start - 2])) start -= 1;
  return start;
}

function exportedBlock(raw) {
  const parts = raw.split('\n');
  const declarationIndex = parts
    .findIndex((line) => !COMMENT_LINE.test(line) && line.trim() !== '');
  if (declarationIndex >= 0 && !/^\s*export\s/u.test(parts[declarationIndex])) {
    parts[declarationIndex] = `export ${parts[declarationIndex]}`;
  }
  return parts.join('\n');
}

/** 原pathでexport宣言だったか。移動先でexportを足したかではなく、元の姿を見る。 */
function wasExported(raw) {
  const declaration = raw.split('\n')
    .find((line) => !COMMENT_LINE.test(line) && line.trim() !== '');
  return declaration !== undefined && /^\s*export\s/u.test(declaration);
}

/**
 * repo相対path同士から、ESMが解決できる相対specifierを作る。
 *
 * 以前は行き先がfromの配下でない時に`./<repo相対>`を返しており、親ディレクトリや兄弟
 * ディレクトリへの移動で**解決不能なspecifier**を生成していた（`src/a/x.mjs`→`src/b/y.mjs`で
 * `./src/b/y.mjs`）。segment単位で共通prefixを外し、残りを`../`で遡って組み立てる。
 */
export function relativeSpecifier(fromPath, toPath) {
  const fromSegments = fromPath.split('/').slice(0, -1);
  const toSegments = toPath.split('/');
  let shared = 0;
  while (shared < fromSegments.length && shared < toSegments.length - 1
    && fromSegments[shared] === toSegments[shared]) shared += 1;
  const ascent = '../'.repeat(fromSegments.length - shared);
  const descent = toSegments.slice(shared).join('/');
  return ascent === '' ? `./${descent}` : `${ascent}${descent}`;
}

/**
 * 三面の変換後textを作る。
 *
 * @param {object} options
 * @param {string} options.sourceText 原pathの現在の内容
 * @param {object} options.candidate `lattice.bounded_seam_candidate.v2`
 * @param {object} options.symbolExtents symbol名 -> `{startLine, endLine}`（1始まり・両端含む）
 * @returns {{files: object|null, reasons: string[]}} pathごとの変換後text
 */
export function planSeamRewrite({ sourceText, candidate, symbolExtents } = {}) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) return fail(['empty_source']);
  const lines = sourceText.split('\n');
  const surfaces = candidate?.surfaces ?? [];
  const residual = surfaces.find(({ role }) => role === 'residual');
  const moving = surfaces.filter(({ role }) => role !== 'residual');
  if (residual === undefined || moving.length === 0) return fail(['surfaces_incomplete']);

  const blocks = [];
  for (const surface of moving) {
    for (const symbol of surface.symbols) {
      const extent = symbolExtents?.[symbol];
      if (extent === undefined
        || !Number.isSafeInteger(extent.startLine) || !Number.isSafeInteger(extent.endLine)
        || extent.startLine < 1 || extent.endLine > lines.length
        || extent.endLine < extent.startLine) {
        return fail([`symbol_extent_missing:${symbol}`]);
      }
      blocks.push({
        symbol, path: surface.path, end: extent.endLine,
        start: extendUpward(lines, extent.startLine),
      });
    }
  }
  blocks.sort((left, right) => left.start - right.start);
  for (let index = 1; index < blocks.length; index += 1) {
    // 範囲が重なる宣言は、片方を切ると他方が壊れる。整形で解こうとせず止める。
    if (blocks[index].start <= blocks[index - 1].end) {
      return fail([`symbol_extent_overlap:${blocks[index - 1].symbol}:${blocks[index].symbol}`]);
    }
  }

  const { statements, endIndex } = scanImportStatements(lines);
  if (blocks.some((block) => block.start <= endIndex + 1)) {
    return fail(['symbol_inside_import_block']);
  }

  const bodyByPath = new Map();
  const removal = new Set();
  // 原pathでexportされていたsymbolは、移した先から残余面が再exportする。
  // しないと原pathをimportしている全fileが壊れ、外部挙動同等性が原理的に満たせない。
  const reExportByPath = new Map();
  for (const block of blocks) {
    const raw = lines.slice(block.start - 1, block.end).join('\n');
    if (!bodyByPath.has(block.path)) bodyByPath.set(block.path, []);
    bodyByPath.get(block.path).push(exportedBlock(raw));
    if (wasExported(raw)) {
      if (!reExportByPath.has(block.path)) reExportByPath.set(block.path, []);
      reExportByPath.get(block.path).push(block.symbol);
    }
    for (let line = block.start; line <= block.end; line += 1) removal.add(line);
  }

  const symbolPath = new Map(blocks.map((block) => [block.symbol, block.path]));
  const importsFor = (ownerPath, body) => {
    const carried = statements
      .filter((statement) => statement.bindings.some((name) => mentions(body, name)))
      .map((statement) => statement.text);
    const byTarget = new Map();
    for (const [symbol, targetPath] of symbolPath) {
      if (targetPath === ownerPath || !mentions(body, symbol)) continue;
      if (!byTarget.has(targetPath)) byTarget.set(targetPath, []);
      byTarget.get(targetPath).push(symbol);
    }
    const cross = [...byTarget.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([targetPath, names]) => `import { ${[...names].sort(compareText).join(', ')} } from '${relativeSpecifier(ownerPath, targetPath)}';`);
    return [...carried, ...cross];
  };

  const files = {};
  for (const [path, bodies] of bodyByPath) {
    const body = bodies.join('\n\n');
    const header = importsFor(path, body);
    files[path] = `${header.length === 0 ? '' : `${header.join('\n')}\n\n`}${body}\n`;
  }

  const keptHeader = lines.slice(0, endIndex + 1);
  const keptBody = lines.slice(endIndex + 1)
    .filter((_, index) => !removal.has(endIndex + 2 + index));
  const residualBody = keptBody.join('\n').replace(/\n{3,}/gu, '\n\n').replace(/\n+$/u, '');
  const residualCross = importsFor(residual.path, residualBody)
    .filter((statement) => !keptHeader.join('\n').includes(statement));
  const reExports = [...reExportByPath.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([targetPath, names]) => `export { ${[...names].sort(compareText).join(', ')} }`
      + ` from '${relativeSpecifier(residual.path, targetPath)}';`);
  files[residual.path] = `${[...keptHeader, ...residualCross, ...reExports].join('\n')}\n${residualBody}\n`
    .replace(/^\n+/u, '');

  return { files, reasons: [] };
}
