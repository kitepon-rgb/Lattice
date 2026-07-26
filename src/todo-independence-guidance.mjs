/**
 * 並列可否の案内（ADR 0130）。
 *
 * 状況から`{code, message, next_action}`を引く単一正本。advisory・投影・typed error・helpは
 * すべてここから引く。面ごとに文言を書けば必ずずれ、同じ状況に別の説明が付く。
 *
 * 文は事実と次の一歩だけを述べ、指示しない。dispatchの意思決定はhostが所有する
 * （ADR 0063 Decision 5）。命令形にするとLatticeがagentを統制する面へ滑る。
 */

export const TODO_INDEPENDENCE_GUIDANCE_CODES = Object.freeze([
  'independence_no_ready_frontier',
  'independence_unrecorded',
  'independence_task_undeclared',
  'independence_contract_superseded',
  'independence_superseded',
  'independence_stale_for_task',
  'independence_conflict_with_active',
  'independence_conflict_between_ready',
  'independence_verdicts_absent',
  'independence_verified',
]);

export const SEAM_PROPOSAL_GUIDANCE_CODES = Object.freeze([
  'seam_proposal_unrecorded',
  'seam_proposal_superseded',
  'seam_proposal_stale',
  'seam_proposal_binding_overlap',
  'seam_proposal_binding_outside_resource',
  'seam_proposal_binding_symbol_unresolved',
  'seam_proposal_binding_resource_unresolved',
  'seam_proposal_binding_ambiguous',
  'seam_proposal_binding_missing',
  'seam_proposal_verified',
]);

/**
 * 束縛失敗のunknown種別から案内codeを引く表。並びは優先順で、先頭ほど次の一歩が具体的である。
 *
 * 宣言が壊れている状況を、宣言が無い状況より上に置く。壊れている方は直す対象が
 * 一意に決まるのに対し、無い方は何をどう宣言するかから決めることになるからである。
 */
const SEAM_PROPOSAL_BINDING_GUIDANCE = Object.freeze([
  Object.freeze(['concern_anchor_overlap', 'seam_proposal_binding_overlap']),
  Object.freeze(['concern_anchor_outside_resource', 'seam_proposal_binding_outside_resource']),
  Object.freeze(['concern_anchor_unresolved', 'seam_proposal_binding_symbol_unresolved']),
  Object.freeze(['concern_anchor_resource_unresolved', 'seam_proposal_binding_resource_unresolved']),
  Object.freeze(['semantic_owner_binding_ambiguous', 'seam_proposal_binding_ambiguous']),
  Object.freeze(['semantic_owner_binding_missing', 'seam_proposal_binding_missing']),
]);

/**
 * 束縛の案内へ共通で添える、記録が更新される条件。
 *
 * concern_anchorsはwitness setにあり、seam提案はindependence記録のwitness_set_digestと
 * 一致する宣言しか読まない。宣言を直しただけでは提案は変わらないので、そこまで述べないと
 * 「直したのに同じunknownが出る」で止まる。
 */
const BINDING_RECOMPILE_HINT = '宣言はwitness setにあり、independence compileとseam-proposal compileを通し直すまで提案へ写らない。';

const CATALOG = Object.freeze({
  independence_no_ready_frontier: Object.freeze({
    message: '着手候補が無いため、並列可否を述べる対象が無い。',
    next_action: 'none',
  }),
  independence_unrecorded: Object.freeze({
    message: 'このplanの並列可否はまだ判定していない。競合が無いのではなく、記録が存在しない。',
    next_action: 'declare_witness_set_then_compile',
  }),
  independence_task_undeclared: Object.freeze({
    message: 'この工程はwitness setで宣言されていないため、記録には含まれていない。',
    next_action: 'add_task_to_witness_set_then_compile',
  }),
  independence_contract_superseded: Object.freeze({
    message: '記録は旧契約versionで書かれており、現在の並列可否の判定としては読めない。現在の契約での再compileが次の一歩になる。',
    next_action: 'recompile_independence',
  }),
  independence_superseded: Object.freeze({
    message: 'planが改訂され、記録は別のtopologyについての判定になっている。',
    next_action: 'migrate_witness_set_then_compile',
  }),
  independence_stale_for_task: Object.freeze({
    message: '記録後にこの工程の宣言境界が変更されたため、記録時点の判定は現在のcodeを指していない。',
    next_action: 'recompile_independence',
  }),
  independence_conflict_with_active: Object.freeze({
    message: '作業中の工程と同じ資源を書く記録がある。並行すると衝突する。',
    next_action: 'serialize_or_split_boundary',
  }),
  independence_conflict_between_ready: Object.freeze({
    message: '他のready工程と同じ資源を書く記録がある。同時に着手すると衝突する。',
    next_action: 'serialize_or_split_boundary',
  }),
  independence_verdicts_absent: Object.freeze({
    message: '判定が途中で止まっており、記録はどの組についてもverdictを持たない。自分にunknownが無いことは、他と干渉しない証拠にならない。',
    next_action: 'resolve_unknowns_then_recompile',
  }),
  independence_verified: Object.freeze({
    message: '記録時点の宣言境界では、他のready工程と干渉しない。',
    next_action: 'none',
  }),
  seam_proposal_unrecorded: Object.freeze({
    message: 'このplanのseam提案はまだ生成していない。提案対象が無いのではなく、記録が存在しない。',
    next_action: 'compile_seam_proposal',
  }),
  seam_proposal_superseded: Object.freeze({
    message: '参照元のplanまたは並列可否記録が更新され、このseam提案は現在の競合についての記録ではない。',
    next_action: 'compile_seam_proposal',
  }),
  seam_proposal_stale: Object.freeze({
    message: 'seam提案の生成後にHEADが進み、記録時点の構造証拠は現在のcodeを指していない。',
    next_action: 'compile_seam_proposal',
  }),
  seam_proposal_binding_overlap: Object.freeze({
    message: `同じ資源について、複数のToDoが同じsymbolを自分の担当として宣言している。どちら側へ切るか決まらないため、切断候補を束縛できない。${BINDING_RECOMPILE_HINT}`,
    next_action: 'split_overlapping_concern_anchors_then_recompile',
  }),
  seam_proposal_binding_outside_resource: Object.freeze({
    message: `concern_anchorsが挙げたsymbolが、withinで指した資源の外にある。その資源の分割を説明しないので束縛へ使えない。${BINDING_RECOMPILE_HINT}`,
    next_action: 'correct_concern_anchors_then_recompile',
  }),
  seam_proposal_binding_symbol_unresolved: Object.freeze({
    message: `concern_anchorsが挙げたsymbolを、sensorが同名同pathで解決できなかった。近い別symbolへは寄せないため、束縛は成立していない。${BINDING_RECOMPILE_HINT}`,
    next_action: 'correct_concern_anchors_then_recompile',
  }),
  seam_proposal_binding_resource_unresolved: Object.freeze({
    message: `concern_anchorsのwithinが指す資源をsensorで解決できなかった。宣言がどの資源についてのものか確定しない。${BINDING_RECOMPILE_HINT}`,
    next_action: 'correct_concern_anchors_then_recompile',
  }),
  seam_proposal_binding_ambiguous: Object.freeze({
    message: `宣言したsymbolが切断候補の複数側へ当たるため、どのToDoがどちらを所有するか一意に決まらない。${BINDING_RECOMPILE_HINT}`,
    next_action: 'narrow_concern_anchors_then_recompile',
  }),
  seam_proposal_binding_missing: Object.freeze({
    message: `係争資源の中でどのToDoが何を触るかが宣言されていないため、切断候補を所有者へ束縛できない。依存線でも呼び出し辺でも所有は決まらない。${BINDING_RECOMPILE_HINT}`,
    next_action: 'declare_concern_anchors_then_recompile',
  }),
  seam_proposal_verified: Object.freeze({
    message: 'seam提案の記録は現在のplan、並列可否記録、HEADと一致している。',
    next_action: 'none',
  }),
});

/** 切断可能性の言い換え。conflictの案内へ添える。 */
const SEVERABILITY_HINT = Object.freeze({
  code_seam: 'symbol／pathの衝突なので、境界を分けるrefactorで並列化しうる。',
  serial: '共有stateまたはeffectの衝突なので、分割では切り離せない。',
});

export function todoIndependenceGuidance(code, { severability = null } = {}) {
  const entry = CATALOG[code];
  if (entry === undefined) {
    throw new TypeError(`unknown independence guidance code: ${code}`);
  }
  const hint = severability === null ? null : SEVERABILITY_HINT[severability] ?? null;
  return {
    code,
    message: hint === null ? entry.message : `${entry.message}${hint}`,
    next_action: entry.next_action,
  };
}

/**
 * advisoryや投影の状態から、最も行動を要する案内を1つ選ぶ。
 *
 * 複数の状況が重なることはあるが、案内を並べると読み手はどれから手を付けるか決められない。
 * 「記録が無い」より「記録が古い」より「衝突している」を上に置く——後者ほど
 * 次の一歩が具体的だからである。
 */
export function selectIndependenceGuidance({
  coverage, taskDeclared, taskStale, conflictWithActive = null, conflictBetweenReady = null,
  contractSuperseded = false, readyCount = null, verdictsAbsent = false,
}) {
  // 着手候補が無いなら述べる対象が無い。ここを通さないと、readyが空のとき
  // 「未検査taskが1件も無い」が空虚に真になり、記録が古くても検証済みへ倒れる。
  if (readyCount === 0) return todoIndependenceGuidance('independence_no_ready_frontier');
  if (conflictWithActive !== null) {
    return todoIndependenceGuidance('independence_conflict_with_active', {
      severability: conflictWithActive,
    });
  }
  if (conflictBetweenReady !== null) {
    return todoIndependenceGuidance('independence_conflict_between_ready', {
      severability: conflictBetweenReady,
    });
  }
  if (contractSuperseded) {
    return todoIndependenceGuidance('independence_contract_superseded');
  }
  if (coverage === 'missing') return todoIndependenceGuidance('independence_unrecorded');
  if (coverage === 'superseded') return todoIndependenceGuidance('independence_superseded');
  if (!taskDeclared) return todoIndependenceGuidance('independence_task_undeclared');
  if (taskStale) return todoIndependenceGuidance('independence_stale_for_task');
  // 記録は新しく、この工程自身にも問題が無い。それでもverdictが1つも無いなら、
  // 述べられるのは「干渉しない」ではなく「まだ何も判定していない」である。
  if (verdictsAbsent) return todoIndependenceGuidance('independence_verdicts_absent');
  return todoIndependenceGuidance('independence_verified');
}

/**
 * seam提案の状況から案内codeを引く。投影の生成側と契約の検査側が同じ規則を読むための正本。
 *
 * 鮮度（coverage）を束縛失敗より先に見る。記録が古い・別topologyについてのものである時、
 * そこに載っているunknownは現在のcodeについての事実ではないため、先に再compileが要る。
 * 記録が現在と一致している時だけ、束縛失敗が「今直せる状況」になる。
 */
export function seamProposalGuidanceCode({ coverage, unknownKinds = [] }) {
  if (coverage === 'missing') return 'seam_proposal_unrecorded';
  if (coverage === 'superseded') return 'seam_proposal_superseded';
  if (coverage === 'stale') return 'seam_proposal_stale';
  if (coverage !== 'verified') throw new TypeError(`unknown seam proposal coverage: ${coverage}`);
  const kinds = new Set(unknownKinds);
  const binding = SEAM_PROPOSAL_BINDING_GUIDANCE.find(([kind]) => kinds.has(kind));
  return binding === undefined ? 'seam_proposal_verified' : binding[1];
}

export function selectSeamProposalGuidance({ coverage, unknownKinds = [] }) {
  return todoIndependenceGuidance(seamProposalGuidanceCode({ coverage, unknownKinds }));
}

/**
 * 宣言からcompileを経て読むまでの順序。helpとMCP instructionsが同じ手順を語るための正本。
 * 面ごとに手順を書き直すと、片方だけが古くなる。
 *
 * 宣言できる欄を挙げる面はここだけなので、witness契約へ欄を足したらここへも足す。
 * 足さないと、能力はあるのに機械が黙る面が残る（ADR 0130）。
 */
export const TODO_INDEPENDENCE_WORKFLOW = Object.freeze([
  '1. 宣言する: .lattice/todo/witness/<plan_key>.json へ、ToDoごとのowns／reads／writes／affected_testsを書く',
  '   係争資源しか所有していないToDoは、その資源の中で自分が触るsymbolをconcern_anchorsへ宣言できる（witness set v2）。並列可否の判定には写らず、切断候補の束縛だけに効く',
  '2. 判定する: lattice todo independence compile --plan <key> --input <ref>（実sensorを引き、clean worktreeが要る）',
  '3. 読む: lattice todo independence --plan <key> --json（sensorを引かず、記録とHEAD照合だけで返る）',
  '4. 追従する: plan改訂後は lattice todo independence witness migrate --plan <key> で宣言を写してから再compileする',
]);
