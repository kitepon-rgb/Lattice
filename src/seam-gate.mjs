/**
 * 確実の門（docs/plan_seam-cost.md sc-012、オーナー裁定）。
 *
 * スクリプト変換は**確実にできる内容だけ**行う。チャレンジは駄目、怪しければ AI へ。
 * ESM 変換器は元から fail closed で、導出・照会・書き換え・五条件の各段が typed 理由で
 * 拒否する——だが条件はコードに散在し、「機械が何を前提にしているか」「拒否されたら誰の
 * 仕事か」を読める一覧が無かった。ここが正典。
 *
 * 門は2つのことだけを言う:
 *
 * - **前提の一覧**: 機械変換が立つ条件。1つでも欠ければ変換は実行されない（既存挙動）。
 * - **手渡しの分類**: 拒否理由を「宣言を直せば機械で通る」(fix_declaration) と
 *   「機械の変換能力の外＝AI が変換すべき」(hand_to_ai) へ分ける。装置は可否を決めず、
 *   次に誰が動くべきかの事実だけ返す。
 *
 * **未知の理由は certain 側へ丸めない。** 分類できない拒否は unrecognized として返し、
 * 門は閉じたままにする——理由の語彙が増えた時、黙って「確実」へ倒れる方向の壊れ方を防ぐ。
 */

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * 機械変換の事前条件の正典。id は安定識別子、reason_prefixes は各段が返す typed 理由
 * との対応（`:` 以降に対象名が付く動的形を含む）。
 */
export const SEAM_GATE_PRECONDITIONS = Object.freeze([
  {
    id: 'inputs_well_formed',
    holds: '入力（path・task・candidate id）が契約の形である',
    handoff: 'fix_declaration',
    reason_prefixes: [
      'invalid_source_path', 'invalid_shared_path', 'invalid_owned_path',
      'invalid_candidate_id', 'task_refs_below_minimum', 'duplicate_task_id',
      'surface_path_collision', 'empty_source', 'surfaces_incomplete',
    ],
  },
  {
    id: 'ownership_declared_and_exclusive',
    holds: '移す symbol が宣言され、2 task が同じ symbol を主張していない',
    handoff: 'fix_declaration',
    reason_prefixes: ['owned_symbols_missing', 'owned_symbol_claimed_twice'],
  },
  {
    id: 'closure_observed_and_closed',
    holds: '所有 symbol の同一 file 内閉包が観測で閉じている',
    handoff: 'hand_to_ai',
    reason_prefixes: ['callee_data_missing', 'closure_rounds_exhausted'],
  },
  {
    id: 'shared_surface_acyclic',
    holds: '共有面が所有面へ逆依存しない（切った先が元を向かない）',
    handoff: 'hand_to_ai',
    reason_prefixes: ['shared_depends_on_owned'],
  },
  {
    id: 'extents_resolved_and_disjoint',
    holds: '全対象 symbol の行範囲が確定し、互いに重ならず、import block の外にある',
    handoff: 'hand_to_ai',
    reason_prefixes: [
      'symbol_extent_missing', 'symbol_extent_overlap', 'symbol_inside_import_block',
      'symbol_lookup_truncated',
    ],
  },
  {
    id: 'behavior_preserved',
    holds: '公開面が保たれ、切断参照が無い（ADR 0145 の網）',
    handoff: 'hand_to_ai',
    reason_prefixes: ['behavior_equivalent'],
  },
  {
    id: 'tests_and_index_pass',
    holds: 'focused test が通り、変換後 index が新面を収載している',
    handoff: 'hand_to_ai',
    reason_prefixes: ['focused_tests_passed', 'sensor_fresh', 'verifier', 'witness'],
  },
  {
    id: 'parallelism_gained',
    holds: '対象競合が消え、競合対が増えず、波数が減る（ADR 0138）',
    handoff: 'hand_to_ai',
    reason_prefixes: ['overlap_reduced', 'parallelism_improved'],
  },
]);

const PREFIX_TO_CONDITION = new Map();
for (const condition of SEAM_GATE_PRECONDITIONS) {
  for (const prefix of condition.reason_prefixes) {
    PREFIX_TO_CONDITION.set(prefix, condition);
  }
}

function conditionOf(reason) {
  const head = reason.split(':')[0];
  return PREFIX_TO_CONDITION.get(head) ?? null;
}

/**
 * 拒否理由の集合を門で分類する。
 *
 * @param {string[]} reasons 変換が返した typed 理由（空なら門は開いている＝機械で確実に通った）
 * @returns {{
 *   certain: boolean,
 *   handoff: 'none'|'fix_declaration'|'hand_to_ai',
 *   failed: Array<{id: string, holds: string, handoff: string, reasons: string[]}>,
 *   unrecognized: string[],
 * }}
 */
export function explainSeamGate(reasons = []) {
  const byCondition = new Map();
  const unrecognized = [];
  for (const reason of reasons) {
    const condition = conditionOf(reason);
    if (condition === null) {
      unrecognized.push(reason);
      continue;
    }
    if (!byCondition.has(condition.id)) {
      byCondition.set(condition.id, { id: condition.id, holds: condition.holds,
        handoff: condition.handoff, reasons: [] });
    }
    byCondition.get(condition.id).reasons.push(reason);
  }
  const failed = [...byCondition.values()]
    .map((entry) => ({ ...entry, reasons: [...entry.reasons].sort(compareText) }))
    .sort((left, right) => compareText(left.id, right.id));
  const certain = reasons.length === 0;
  // hand_to_ai が1つでもあれば機械の再試行では越えられない。fix_declaration だけなら
  // 宣言を直して再提出すれば機械で通りうる。未知の理由は安全側＝hand_to_ai として扱う。
  const handoff = certain ? 'none'
    : (failed.some(({ handoff: kind }) => kind === 'hand_to_ai') || unrecognized.length > 0)
      ? 'hand_to_ai' : 'fix_declaration';
  return {
    certain,
    handoff,
    failed,
    unrecognized: [...unrecognized].sort(compareText),
  };
}
