/**
 * seam 切断コストの内訳（`lattice.seam_cost_profile.v1`、docs/plan_seam-cost.md）。
 *
 * 係争 file を task ごとに分割する時、**何を共有しているから単純に切れないのか**を
 * 数えられる事実として返す。装置は分類して見せるだけで、可否を決めない——「切るのを
 * やめろ」とは言わないし、閾値も持たない。「深さ2まで」「件数20超はやめる」を決めるのは
 * 方針と操作する AI である（seam-proposal の Pareto 支配と同じ規律）。
 *
 * これは**投影であって記録ではない**。sensor が進めば変わる値なので、digest 済み artifact へ
 * 焼き込まない（ADR 0127 の independence 記録と同じ線）。記録に残らないものは採点にも
 * 使えない——「このファイルは N 回競合した」という会計を装置が持たないための構造的裏付け
 * でもある（ADR 0145）。
 *
 * 共有物は複製可能性で重さが分かれる:
 *
 * | 分類 | 分割後 | 由来 |
 * |---|---|---|
 * | `shared_imports` | 両面から import すればよい（複製可・安い） | import 文の束縛言及 |
 * | `shared_functions` | 共有面へ出せる（装置が機械的に処理できる） | 同一 file 内の calls 辺 |
 * | `shared_state` | **複製できない**。所有者を決める設計判断が要る | valueRef 辺 |
 * | `cross_edges` | 書き換える参照そのもの | task 間の直接辺 |
 * | `same_cycle` | 循環を壊さない限り**切れない** | 同一 file 内 SCC |
 */

import { spawnSync } from 'node:child_process';

import { invokeSensorCli } from './sensor-runtime.mjs';
import { mentions, scanImportStatements } from './seam-rewrite.mjs';

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export const SEAM_COST_PROFILE_SCHEMA = 'lattice.seam_cost_profile.v1';

/** module 状態として数えるノード種別。関数・クラスは複製や共有面行きで解けるので含めない。 */
const STATE_KINDS = new Set(['constant', 'variable']);
const FUNCTION_KINDS = new Set(['function', 'method']);

function sortedEntries(entries, key) {
  return [...entries].sort((left, right) => compareText(key(left), key(right)));
}

/**
 * 同一 file 内の隣接から強連結成分を求める（Tarjan・反復形）。
 *
 * seam-proposal の実装は正規化 graph の shape に結合しているので、ここでは file 内
 * adjacency（symbol 名 → symbol 名）の小さな入力に対して独立に持つ。
 */
export function fileCycles(adjacency) {
  const names = [...adjacency.keys()].sort(compareText);
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  let next = 0;

  for (const root of names) {
    if (index.has(root)) continue;
    const work = [{ name: root, childIndex: 0 }];
    while (work.length > 0) {
      const frame = work.at(-1);
      const { name } = frame;
      if (frame.childIndex === 0) {
        index.set(name, next);
        low.set(name, next);
        next += 1;
        stack.push(name);
        onStack.add(name);
      }
      const targets = (adjacency.get(name) ?? []).filter((target) => adjacency.has(target));
      if (frame.childIndex < targets.length) {
        const target = targets[frame.childIndex];
        frame.childIndex += 1;
        if (!index.has(target)) {
          work.push({ name: target, childIndex: 0 });
        } else if (onStack.has(target)) {
          low.set(name, Math.min(low.get(name), index.get(target)));
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent !== undefined) {
        low.set(parent.name, Math.min(low.get(parent.name), low.get(name)));
      }
      if (low.get(name) === index.get(name)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== name);
        // 自己再帰だけの1要素成分は「循環で切れない」とは別の話なので、2要素以上だけを返す。
        if (component.length > 1) cycles.push(component.sort(compareText));
      }
    }
  }
  return cycles.sort((left, right) => compareText(left.join(','), right.join(',')));
}

/**
 * 内訳の計算本体（純関数）。観測の取得と分類を分けるので、分類はここで単体検証できる。
 *
 * @param {object} options
 * @param {string} options.sourcePath 係争 file
 * @param {string} options.sourceText 係争 file の現在の内容
 * @param {Array<{name: string, kind: string, startLine: number, endLine: number, isExported: boolean}>} options.nodes
 *   係争 file の symbol 一覧（`file-nodes`）
 * @param {Record<string, Array<{name: string, path: string, edgeKind: string, valueRef: boolean, truncated?: boolean}>>} options.calleesBySymbol
 *   symbol ごとの隣接（callees、辺種別つき）。**係争 file 内の相手だけ**が渡される前提
 * @param {Record<string, string[]>} options.ownedSymbolsByTask task ごとの宣言 symbol
 * @param {string[]} [options.truncatedSymbols] callees が limit に達した symbol（観測の打ち切り申告）
 */
export function classifySeamCost({
  sourcePath, sourceText, nodes, calleesBySymbol, ownedSymbolsByTask, truncatedSymbols = [],
} = {}) {
  const taskIds = Object.keys(ownedSymbolsByTask).sort(compareText);
  const ownerOf = new Map();
  for (const taskId of taskIds) {
    for (const symbol of ownedSymbolsByTask[taskId]) ownerOf.set(symbol, taskId);
  }
  const nodeByName = new Map(nodes.map((node) => [node.name, node]));
  const lines = sourceText.split('\n');

  // task ごとの本文。extent の行範囲で切る。宣言に extent が無い symbol は本文不明として
  // 言及判定から外れる——「無い」へ丸めず observed で申告する。
  const bodyOf = new Map();
  const bodyMissing = [];
  for (const taskId of taskIds) {
    const parts = [];
    for (const symbol of ownedSymbolsByTask[taskId]) {
      const node = nodeByName.get(symbol);
      if (node === undefined) { bodyMissing.push(symbol); continue; }
      parts.push(lines.slice(node.startLine - 1, node.endLine).join('\n'));
    }
    bodyOf.set(taskId, parts.join('\n'));
  }

  // 1) task 間の直接辺。書き換える参照そのものであり、切断コストのほぼ定義。
  const crossEdges = [];
  for (const [symbol, callees] of Object.entries(calleesBySymbol)) {
    const fromTask = ownerOf.get(symbol);
    if (fromTask === undefined) continue;
    for (const callee of callees) {
      const toTask = ownerOf.get(callee.name);
      if (toTask === undefined || toTask === fromTask) continue;
      crossEdges.push({
        from_task: fromTask, from: symbol, to_task: toTask, to: callee.name,
        edge_kind: callee.edgeKind, value_ref: callee.valueRef === true,
        value_write: callee.valueWrite === true,
      });
    }
  }

  // 2) 同一 file 内の循環。両 task を跨ぐ成分は、循環を壊さない限り切れない。
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.name, []);
  for (const [symbol, callees] of Object.entries(calleesBySymbol)) {
    if (!adjacency.has(symbol)) adjacency.set(symbol, []);
    for (const callee of callees) {
      if (adjacency.has(callee.name)) adjacency.get(symbol).push(callee.name);
    }
  }
  const sameCycle = fileCycles(adjacency)
    .map((component) => ({
      symbols: component,
      task_ids: [...new Set(component.map((name) => ownerOf.get(name)).filter(Boolean))].sort(compareText),
    }))
    .filter(({ task_ids: ids }) => ids.length >= 2);

  // 3) 共有の分類。誰の宣言でもない同一 file 内の隣接を、複製可能性で分ける。
  const reachedBy = new Map();
  for (const [symbol, callees] of Object.entries(calleesBySymbol)) {
    const fromTask = ownerOf.get(symbol);
    if (fromTask === undefined) continue;
    for (const callee of callees) {
      if (ownerOf.has(callee.name)) continue;
      if (!reachedBy.has(callee.name)) {
        reachedBy.set(callee.name, { tasks: new Set(), writers: new Set() });
      }
      const reach = reachedBy.get(callee.name);
      reach.tasks.add(fromTask);
      if (callee.valueWrite === true) reach.writers.add(fromTask);
    }
  }
  const sharedState = [];
  const sharedFunctions = [];
  for (const [name, reach] of reachedBy) {
    const kind = nodeByName.get(name)?.kind ?? 'unknown';
    const referencedBy = [...reach.tasks].sort(compareText);
    if (STATE_KINDS.has(kind)) {
      // 共有の重さは読むだけ/片方が書く/両方書くでほぼ決まる。誰が書くかまで数える。
      sharedState.push({
        name, kind, referenced_by: referencedBy,
        written_by: [...reach.writers].sort(compareText),
      });
    } else if (FUNCTION_KINDS.has(kind)) {
      sharedFunctions.push({ name, kind, referenced_by: referencedBy });
    } else {
      // それ以外（class等）は cross/cycle が拾う。分類できない共有を黙って捨てないため、
      // state でも function でもない到達は shared_functions 側へ kind つきで載せる。
      sharedFunctions.push({ name, kind, referenced_by: referencedBy });
    }
  }

  // 4) import の共有。複製できるので安い——ESM の import 文束縛への言及で数える。
  //    正規表現による ESM 限定の解析であり、他言語では観測不能（confidence で申告）。
  const statements = scanImportStatements(lines).statements;
  const sharedImports = [];
  for (const statement of statements) {
    const usedBy = taskIds.filter((taskId) => statement.bindings
      .some((binding) => mentions(bodyOf.get(taskId) ?? '', binding)));
    if (usedBy.length >= 2) sharedImports.push({ statement: statement.text, used_by: usedBy });
  }

  // 5) symbol ごとの数えられる事実。行数と公開面。判断はしない。
  const tasks = {};
  for (const taskId of taskIds) {
    tasks[taskId] = {
      symbols: ownedSymbolsByTask[taskId].map((symbol) => {
        const node = nodeByName.get(symbol);
        return node === undefined
          ? { name: symbol, kind: null, lines: null, exported: null }
          : {
            name: symbol, kind: node.kind,
            lines: node.endLine - node.startLine + 1,
            exported: node.isExported === true,
          };
      }),
    };
  }

  return {
    schema: SEAM_COST_PROFILE_SCHEMA,
    source_path: sourcePath,
    tasks,
    cross_edges: sortedEntries(crossEdges, (edge) => `${edge.from}\0${edge.to}`),
    same_cycle: sameCycle,
    shared_state: sortedEntries(sharedState, ({ name }) => name),
    shared_functions: sortedEntries(sharedFunctions, ({ name }) => name),
    shared_imports: sharedImports,
    confidence: {
      // 盲点の申告（計画の不変条件4）。見えていないものを「共有なし」と言わない。
      // 3文字未満の名前（i, db等）はloop/parameterのnoiseが支配的なので辺にしない。
      value_ref_name_filter: 'names-under-3-chars-invisible-in-edges',
      // TS/JS/ArkTS/Go/Python/Javaはwasmとkernelの両経路で同じwrite判定を持つ。
      // それ以外のvalue-ref対応言語はmetadata.writeが未配線なので、範囲を明記する。
      write_distinction: 'ts-js-arkts-go-python-java-all-routes',
      imports_analysis: 'esm-only',
      callees_truncated: [...new Set(truncatedSymbols)].sort(compareText),
      body_missing: [...new Set(bodyMissing)].sort(compareText),
    },
  };
}

const CALLEES_LIMIT = 200;

/**
 * 実 sensor から材料を集めて内訳を返す（投影・read-only）。
 *
 * `blast_by_depth` は impact を深さ別に引いて差分で数える。深さだけの方針は粗い——
 * 深さ2に3件と300件は別の作業なので、件数まで出す。「深さ2まで、件数 N 超はやめる」を
 * 書けるようにするのが目的で、書くのは方針と AI である。
 */
export async function computeSeamCostProfile({
  repoRoot, sourcePath, sourceText, ownedSymbolsByTask, impactDepths = [1, 2, 3],
} = {}) {
  const invoke = (args) => invokeSensorCli(
    (command, cliArgs, options) => spawnSync(command, cliArgs, options),
    args,
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const fileNodes = invoke(['file-nodes', sourcePath, '--path', '.']);
  if (fileNodes.status !== 0) {
    return { profile: null, reasons: ['file_nodes_unavailable'] };
  }
  let nodes;
  try { nodes = JSON.parse(fileNodes.stdout)?.nodes ?? null; } catch { nodes = null; }
  if (nodes === null) return { profile: null, reasons: ['file_nodes_unreadable'] };

  const allOwned = [...new Set(Object.values(ownedSymbolsByTask).flat())].sort(compareText);
  const calleesBySymbol = {};
  const truncatedSymbols = [];
  for (const symbol of allOwned) {
    const result = invoke(['callees', symbol, '--path', '.', '--limit', String(CALLEES_LIMIT), '--json']);
    if (result.status !== 0) { calleesBySymbol[symbol] = []; continue; }
    let callees;
    try { callees = JSON.parse(result.stdout)?.callees ?? []; } catch { callees = []; }
    if (callees.length >= CALLEES_LIMIT) truncatedSymbols.push(symbol);
    calleesBySymbol[symbol] = callees
      .filter((callee) => callee.filePath === sourcePath)
      .map((callee) => ({
        name: callee.name, path: callee.filePath,
        edgeKind: callee.edgeKind ?? 'calls', valueRef: callee.valueRef === true,
        valueWrite: callee.valueWrite === true,
      }));
  }

  const profile = classifySeamCost({
    sourcePath, sourceText, nodes, calleesBySymbol, ownedSymbolsByTask, truncatedSymbols,
  });

  // 深さごとの影響件数。累積値の差分が「その深さで初めて届く数」になる。
  const blast = {};
  for (const symbol of allOwned) {
    const perDepth = {};
    let previous = 0;
    for (const depth of [...impactDepths].sort((a, b) => a - b)) {
      const result = invoke(['impact', symbol, '--path', '.', '--depth', String(depth), '--json']);
      if (result.status !== 0) { perDepth[depth] = null; continue; }
      let count = null;
      try { count = JSON.parse(result.stdout)?.nodeCount ?? null; } catch { count = null; }
      perDepth[depth] = count === null ? null : Math.max(0, count - previous);
      if (count !== null) previous = count;
    }
    blast[symbol] = perDepth;
  }
  profile.blast_by_depth = blast;
  return { profile, reasons: [] };
}
