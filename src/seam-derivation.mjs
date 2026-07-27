/**
 * seam提案から実行可能な変換候補を導出する（ADR 0137・0138）。
 *
 * 提案が持つのは所有surfaceだけである。宣言symbolを新fileへ移すには、それが依存していて
 * 誰も宣言していないsymbol（共有surface）と、原pathに残るもの（残余surface）まで決まっていなければ
 * 適用後の姿が一意にならない。ここはその三面を、sensorが返した同一file内の依存から導く。
 *
 * 導出は宣言とsensor観測だけを入力にする。ここで新しい所有を発明しない——宣言していないsymbolは
 * 誰のものにもせず、共有面へ送る。
 */

import { isTodoIdentifier, isTodoRef, todoSelfDigest } from './todo-contracts.mjs';

export const BOUNDED_SEAM_CANDIDATE_SCHEMA = 'lattice.bounded_seam_candidate.v2';

/** 三面の役割。所有だけがtaskへ紐づき、共有と残余は誰のものでもない。 */
export const SEAM_SURFACE_ROLES = Object.freeze(['task_owned', 'shared', 'residual']);

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sortedUnique = (values) => [...new Set(values)].sort(compareText);

function reject(reasons) {
  return { candidate: null, reasons: sortedUnique(reasons) };
}

/**
 * 宣言symbolが同一file内で依存する先を、宣言されていない分だけ集める。
 *
 * 推移的に辿るのは、共有面が所有面へ依存しない一方向を作るためである。1段だけ見て止めると、
 * helperのhelperが原pathに残り、共有面から原pathへの辺が生き残る。
 */
function collectSharedClosure({ sourcePath, ownedSymbols, calleesBySymbol }) {
  const owned = new Set(ownedSymbols);
  const shared = new Set();
  const missing = new Set();
  const pending = [...ownedSymbols];
  while (pending.length > 0) {
    const current = pending.pop();
    const callees = calleesBySymbol[current];
    // 未照会と「calleeが無い」を同一視しない。同一視すると閉包が黙って浅くなり、
    // 移動先で参照だけが宙に浮く——構文は通るので、実行するまで壊れたと分からない。
    if (callees === undefined) { missing.add(current); continue; }
    for (const callee of callees) {
      // 同一file内だけを見る。sensorのsymbol解決は同名の別fileへ寄ることがあるので、
      // pathのexact一致で絞らないと無関係なsymbolを共有面へ引き込む。
      if (callee.path !== sourcePath) continue;
      if (owned.has(callee.name) || shared.has(callee.name)) continue;
      shared.add(callee.name);
      pending.push(callee.name);
    }
  }
  return { shared: [...shared].sort(compareText), missing: [...missing].sort(compareText) };
}

/** 共有面から所有面への辺。1本でもあれば循環を作るので候補にしない（ADR 0137 Decision 2）。 */
function sharedDependsOnOwned({ sourcePath, ownedSymbols, sharedSymbols, calleesBySymbol }) {
  const owned = new Set(ownedSymbols);
  const violations = [];
  for (const symbol of sharedSymbols) {
    for (const callee of calleesBySymbol[symbol] ?? []) {
      if (callee.path !== sourcePath || !owned.has(callee.name)) continue;
      violations.push(`${symbol}->${callee.name}`);
    }
  }
  return violations.sort(compareText);
}

function surfaceEntry(role, path, ownerTaskIds, symbols) {
  return {
    role,
    path,
    owner_task_ids: [...ownerTaskIds].sort(compareText),
    symbols: [...symbols].sort(compareText),
  };
}

/**
 * 実行可能な変換候補を導出する。
 *
 * 入力はすべて記録済みの事実である——宣言（concern anchors）、提案が決めた所有surfaceのpath、
 * sensorが返した同一file内のcallee、候補のaffected test。ここで再びsensorを引かない。
 */
export function deriveBoundedSeamCandidate(options = {}) {
  const {
    sourcePath, taskRefs, ownedSymbolsByTask, proposedPathByTask, sharedPath,
    calleesBySymbol = {}, affectedTests = [], baseSha, manifestDigest, findingDigest,
    candidateId,
  } = options;

  if (!isTodoRef(sourcePath)) return reject(['invalid_source_path']);
  if (!Array.isArray(taskRefs) || taskRefs.length < 2) return reject(['task_refs_below_minimum']);
  const taskIds = taskRefs.map(({ task_id: taskId }) => taskId);
  if (new Set(taskIds).size !== taskIds.length) return reject(['duplicate_task_id']);

  const ownedByTask = new Map();
  for (const taskId of taskIds) {
    const symbols = sortedUnique(ownedSymbolsByTask?.[taskId] ?? []);
    // 宣言の無いtaskがある構成は、その所有面を作れない。片側の宣言から他方を補完しない。
    if (symbols.length === 0) return reject([`owned_symbols_missing:${taskId}`]);
    ownedByTask.set(taskId, symbols);
  }
  const ownedSymbols = sortedUnique([...ownedByTask.values()].flat());
  const declaredCount = [...ownedByTask.values()].reduce((total, list) => total + list.length, 0);
  if (ownedSymbols.length !== declaredCount) return reject(['owned_symbol_claimed_twice']);

  const closure = collectSharedClosure({ sourcePath, ownedSymbols, calleesBySymbol });
  // 閉包が閉じていない。呼び出し側は不足分のcalleeを引いてから導出をやり直す。
  if (closure.missing.length > 0) {
    return reject(closure.missing.map((symbol) => `callee_data_missing:${symbol}`));
  }
  const sharedSymbols = closure.shared;
  if (sharedSymbols.length > 0 && !isTodoRef(sharedPath)) return reject(['invalid_shared_path']);
  const violations = sharedDependsOnOwned({
    sourcePath, ownedSymbols, sharedSymbols, calleesBySymbol,
  });
  if (violations.length > 0) {
    return reject(violations.map((edge) => `shared_depends_on_owned:${edge}`));
  }

  const surfaces = [];
  for (const taskId of [...taskIds].sort(compareText)) {
    const path = proposedPathByTask?.[taskId];
    if (!isTodoRef(path)) return reject([`invalid_owned_path:${taskId}`]);
    surfaces.push(surfaceEntry('task_owned', path, [taskId], ownedByTask.get(taskId)));
  }
  if (sharedSymbols.length > 0) {
    surfaces.push(surfaceEntry('shared', sharedPath, [], sharedSymbols));
  }
  // 残余はsymbolを列挙しない。移らなかったものすべてという補集合であり、
  // 列挙すると原fileの全symbol目録を導出の入力に持ち込むことになる。
  surfaces.push(surfaceEntry('residual', sourcePath, [], []));

  const paths = surfaces.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) return reject(['surface_path_collision']);

  const candidate = {
    schema: BOUNDED_SEAM_CANDIDATE_SCHEMA,
    candidate_id: candidateId,
    base_sha: baseSha,
    manifest_digest: manifestDigest,
    finding_digest: findingDigest,
    source_path: sourcePath,
    todo_refs: [...taskRefs]
      .map(({ plan_key: planKey, task_id: taskId }) => ({ plan_key: planKey, task_id: taskId }))
      .sort((left, right) => compareText(
        `${left.plan_key}\0${left.task_id}`, `${right.plan_key}\0${right.task_id}`,
      )),
    surfaces: surfaces.sort((left, right) => compareText(left.path, right.path)),
    allowed_paths: sortedUnique(paths),
    // 原pathと所有面は必ず変わる。変わっていなければ変換が起きていない。
    required_paths: sortedUnique([sourcePath, ...surfaces
      .filter(({ role }) => role === 'task_owned').map(({ path }) => path)]),
    verification_policy: {
      focused_test_refs: sortedUnique(affectedTests),
      require_behavior_equivalence: true,
      require_fresh_sensor: true,
      require_overlap_reduction: true,
      // ADR 0138。局所の競合を消して全体の競合を増やす変換と、
      // 競合は消えるが波数が変わらない変換を採用しない。
      require_no_new_conflict_pairs: true,
      require_parallelism_improvement: true,
    },
    candidate_digest: '',
  };
  if (!isTodoIdentifier(candidate.candidate_id)) return reject(['invalid_candidate_id']);
  candidate.candidate_digest = todoSelfDigest(candidate, 'candidate_digest');
  return { candidate, reasons: [] };
}

/**
 * 導出に要るsensor query set。宣言symbolのcalleeだけを引く。
 *
 * pathのconflictはaffected testしか観測していないので、同一file内の依存は別途引く必要がある
 * （ADR 0133が「pathの競合には分割すべきcall graphが無い」と述べた面）。
 */
export function buildSeamDerivationQuerySet(concernSymbols = []) {
  const symbols = sortedUnique(concernSymbols);
  return {
    queries: [
      { id: 'seam-derive-status', operation: 'status' },
      ...symbols.map((symbol, index) => ({
        id: `seam-derive-callees-${String(index).padStart(3, '0')}`,
        operation: 'callees',
        target: symbol,
      })),
    ],
  };
}
