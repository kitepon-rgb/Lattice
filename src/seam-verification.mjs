/**
 * 変換の受入判定（ADR 0137 Decision 4・ADR 0138）。
 *
 * 五条件をすべて満たしたときだけ採用する。1つでも欠けたら棄却であり、どれが欠けたかを残す。
 * 「だいたい良さそう」で通す経路を作らない——外部挙動を変えうる変更を、便益の証明なしに
 * 受け入れないための面である。
 *
 * 実行を伴う観測（focused test、再index）は呼び出し側が行い、ここは観測から判定だけを作る。
 */

import { compileSchedulabilityGraphV2 } from './schedulability-compiler-v2.mjs';
import { todoSelfDigest } from './todo-contracts.mjs';

const GRAPH_SCHEMA = 'lattice.normalized_boundary_graph.v2';
const EXPORT_NAMED = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/u;
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/u;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sortedUnique = (values) => [...new Set(values)].sort(compareText);

/**
 * moduleが外へ出している名前を読む。
 *
 * 分割で外部の消費者が影響を受けるかは、原pathの公開面が変わったかで決まる。原pathが
 * 同じ名前を同じだけ出し続けるなら、原pathをimportしている側は一行も変わらない
 * （ADR 0137 Decision 3）。
 *
 * **ESM構文（`export function` / `export {}`）を正規表現で読むJS/TS限定の検査である。**
 * 他言語のsourceに対しては公開名を1つも読めず、比較は実質空になる——「検証済み」を
 * 主張しない（ADR 0145）。言語非依存の網は切断参照の計数（`severed`観測）が担う。
 */
export function readExportSurface(text) {
  if (typeof text !== 'string') return [];
  const names = [];
  for (const line of text.split('\n')) {
    const named = EXPORT_NAMED.exec(line);
    if (named) { names.push(named[1]); continue; }
    const list = EXPORT_LIST.exec(line);
    if (!list) continue;
    for (const entry of list[1].split(',')) {
      const parts = entry.split(/\s+as\s+/u).map((part) => part.trim());
      const name = parts.length > 1 ? parts[1] : parts[0];
      if (/^[A-Za-z_$][\w$]*$/u.test(name)) names.push(name);
    }
  }
  return sortedUnique(names);
}

/**
 * 外部挙動同等性を、原pathの公開面が保たれたかで判定する。
 *
 * 名前が欠ければ、その原pathをimportしている外部が壊れる。増えるだけなら既存の消費者は
 * 影響を受けないので、欠落だけを違反とする。
 */
export function compareExportSurface({ before, after } = {}) {
  const original = readExportSurface(before);
  const residual = new Set(readExportSurface(after));
  const missing = original.filter((name) => !residual.has(name));
  return { preserved: missing.length === 0, missing };
}

/**
 * 変換後のwitness setを作る。
 *
 * 所有面へ移ったtaskは、その新pathを所有し書き込む。宣言は移動先を指すよう写し、
 * 中身の意味は変えない——ここで新しい所有を発明すると、判定が実態から外れる。
 */
export function buildPostTransformWitnessSet({ witnessSet, candidate, affectedTestsByPath } = {}) {
  const owned = (candidate?.surfaces ?? []).filter(({ role }) => role === 'task_owned');
  if (owned.length === 0) return { witnessSet: null, reasons: ['no_owned_surface'] };
  const next = structuredClone(witnessSet);
  const reasons = [];
  for (const [index, surface] of owned.entries()) {
    const taskId = surface.owner_task_ids[0];
    const witness = next?.manual_witness?.[taskId];
    if (witness === undefined) { reasons.push(`witness_missing:${taskId}`); continue; }
    const affected = affectedTestsByPath?.[surface.path];
    if (!Array.isArray(affected)) { reasons.push(`affected_tests_missing:${surface.path}`); continue; }
    witness.owns = [{ kind: 'path', target: surface.path }];
    witness.writes = [surface.path];
    witness.affected_tests = sortedUnique(affected);
    if (Array.isArray(witness.concern_anchors)) {
      witness.concern_anchors = witness.concern_anchors
        .filter((entry) => entry.within.target === candidate.source_path)
        .map((entry) => ({ ...entry, within: { kind: 'path', target: surface.path } }));
    }
    // 宣言だけ移して観測の裏付けを旧pathに残すと、宣言と証拠が別の資源を指す。
    // query setとprovenanceも移動先へ揃える。
    const queryId = `seam-post-${String(index).padStart(3, '0')}`;
    witness.sensor_provenance = {
      queries: [{ query_id: queryId, expect: { kind: 'affected', path: surface.path } }],
    };
    if (Array.isArray(next.sensor_query_set?.queries)) {
      next.sensor_query_set.queries = next.sensor_query_set.queries
        .filter((query) => query.id !== queryId)
        .concat([{ id: queryId, operation: 'affected', target: surface.path }]);
    }
  }
  if (reasons.length > 0) return { witnessSet: null, reasons: sortedUnique(reasons) };
  if (Array.isArray(next.sensor_query_set?.queries)) {
    next.sensor_query_set.queries.sort((left, right) => compareText(left.id, right.id));
  }
  // 宣言を書き換えた以上、自己digestを取り直す。古いまま出すと契約が拒否する。
  next.witness_set_digest = '';
  next.witness_set_digest = todoSelfDigest(next, 'witness_set_digest');
  return { witnessSet: next, reasons: [] };
}

/**
 * 競合graphから最小実行段階数を求める。既存のschedulability compilerへ載せる。
 *
 * 独自の近似を持たない。変換前後を同じ規則で測らないと、改善したという主張が
 * 測り方の差で出てしまう。
 */
export function measureWaveCount({ taskIds, conflictPairs, precedences = [], executors } = {}) {
  const todos = sortedUnique(taskIds ?? []);
  if (todos.length === 0) return { waves: null, reason: 'no_todos' };
  const todoSet = new Set(todos);
  const seen = new Set();
  const conflicts = [];
  for (const pair of conflictPairs ?? []) {
    const [left, right] = [...pair].sort(compareText);
    if (left === right || !todos.includes(left) || !todos.includes(right)) continue;
    const key = `${left}\u0000${right}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ todo_ids: [left, right], resource_id: `pair-${conflicts.length}` });
  }
  const precedenceSeen = new Set();
  const scopedPrecedences = [];
  for (const edge of precedences) {
    const from = edge?.from_todo_id;
    const to = edge?.to_todo_id;
    if (!todoSet.has(from) || !todoSet.has(to) || from === to) continue;
    const reason = typeof edge.reason === 'string' && edge.reason.trim() !== ''
      ? edge.reason : 'plan_precedence';
    const key = `${from}\0${to}\0${reason}`;
    if (precedenceSeen.has(key)) continue;
    precedenceSeen.add(key);
    scopedPrecedences.push({ from_todo_id: from, to_todo_id: to, reason });
  }
  const compiled = compileSchedulabilityGraphV2({
    schema_version: GRAPH_SCHEMA,
    todos,
    conflicts,
    precedences: scopedPrecedences,
    unknowns: [],
    capacity: Number.isSafeInteger(executors) && executors >= 1 ? executors : 1,
  });
  if (compiled.outcome !== 'compiled') {
    return { waves: null, reason: compiled.code ?? compiled.outcome };
  }
  return { waves: compiled.plan.minimum_feasible_waves, reason: null };
}

/** todo planの順序制約をschedulability compilerのcanonical edgeへ写す。 */
export function todoPlanPrecedences(plan) {
  const edges = [];
  for (const edge of plan?.hard_dependencies ?? []) {
    edges.push({
      from_todo_id: edge.from.task_id,
      to_todo_id: edge.to.task_id,
      reason: 'hard_dependency',
    });
  }
  for (const join of plan?.joins ?? []) {
    for (const after of join.after) {
      edges.push({
        from_todo_id: after.task_id,
        to_todo_id: join.before.task_id,
        reason: `join:${join.id}`,
      });
    }
  }
  return edges;
}

const CONDITIONS = Object.freeze([
  'behavior_equivalent',
  'focused_tests_passed',
  'sensor_fresh',
  'overlap_reduced',
  'parallelism_improved',
]);

/**
 * 五条件を判定する。1つでも欠けたら`rejected`で、欠けた条件を残す。
 *
 * @param {object} options
 * @param {{preserved: boolean, missing: string[]}} options.exportSurface 公開面の比較
 * @param {boolean} options.focusedTestsPassed 変換後worktreeでのfocused test結果
 * @param {boolean} options.sensorFresh 変換後の再indexが新pathを収載したか
 * @param {{observed: boolean, entries: Array<{file: string, name: string}>}|null} options.severed
 *   切断参照の観測（ADR 0145）。`null`はfresh indexへ到達しなかった時で、その場合は
 *   sensor_freshが先に落ちる。`observed: false`は観測の失敗であり「切断なし」へ丸めない。
 * @param {{targetResolved: boolean, before: number, after: number}} options.conflictPairs 競合対の増減
 * @param {{before: number|null, after: number|null}} options.waves 実行段階数の増減
 *
 * behavior_equivalentは2つの観測の合成である。(1) export面の比較——**ESM構文を正規表現で
 * 読むのでJS/TS限定**。他言語のsourceに対しては常にpreservedを返す実質空の検査であり、
 * 「検証済み」を主張しない。(2) 切断参照の計数——fresh indexのsymbol一覧に立つので、
 * sensorが抽出できる言語なら効く。網の言語非依存部はこちらが担う。
 */
export function evaluateSeamVerification(options = {}) {
  const {
    exportSurface, focusedTestsPassed, sensorFresh, conflictPairs, waves, severed = null,
  } = options;
  const detail = {};
  const failures = [];

  const surfacePreserved = exportSurface?.preserved === true;
  // severedがnullのままここへ来るのはsensor_freshが落ちる経路だけ。fresh indexに到達したのに
  // 観測が組めなかった（observed: false）は、切断なしではなく観測の欠落として落とす。
  const severedObserved = severed === null || severed.observed === true;
  const severedEntries = severed?.entries ?? [];
  detail.behavior_equivalent = surfacePreserved && severedObserved && severedEntries.length === 0;
  if (!detail.behavior_equivalent) {
    if (!surfacePreserved) {
      failures.push(`behavior_equivalent:${(exportSurface?.missing ?? []).join(',') || 'unknown'}`);
    }
    if (!severedObserved) failures.push('behavior_equivalent:severed_observation_missing');
    for (const entry of severedEntries) {
      failures.push(`behavior_equivalent:severed_reference:${entry.file}:${entry.name}`);
    }
  }

  detail.focused_tests_passed = focusedTestsPassed === true;
  if (!detail.focused_tests_passed) failures.push('focused_tests_passed');

  detail.sensor_fresh = sensorFresh === true;
  if (!detail.sensor_fresh) failures.push('sensor_fresh');

  // 対象競合が消えたことと、plan全体の競合対が増えていないことの両方を見る（ADR 0138）。
  // componentだけを見ると、切った先で作った共有面が別の作業対の係争資源になっても通る。
  const targetResolved = conflictPairs?.targetResolved === true;
  const before = conflictPairs?.before;
  const after = conflictPairs?.after;
  const counted = Number.isSafeInteger(before) && Number.isSafeInteger(after);
  detail.overlap_reduced = targetResolved && counted && after <= before;
  if (!detail.overlap_reduced) {
    failures.push(!targetResolved ? 'overlap_reduced:target_conflict_remains'
      : !counted ? 'overlap_reduced:pair_count_unknown'
        : `overlap_reduced:pairs_increased:${before}->${after}`);
  }

  // 競合が消えても波数が変わらないなら、その変換は並列化を解放していない。
  const wavesBefore = waves?.before;
  const wavesAfter = waves?.after;
  const measured = Number.isSafeInteger(wavesBefore) && Number.isSafeInteger(wavesAfter);
  detail.parallelism_improved = measured && wavesAfter < wavesBefore;
  if (!detail.parallelism_improved) {
    failures.push(measured ? `parallelism_improved:no_gain:${wavesBefore}->${wavesAfter}`
      : 'parallelism_improved:waves_unknown');
  }

  return {
    decision: failures.length === 0 ? 'accepted' : 'rejected',
    conditions: Object.fromEntries(CONDITIONS.map((name) => [name, detail[name] === true])),
    failures: sortedUnique(failures),
  };
}
