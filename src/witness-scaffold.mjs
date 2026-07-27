/**
 * 宣言を書くための道具（AGENTS.md「装置の境界」）。
 *
 * 推定はしない。何を所有し、係争資源の中で何を触るかはAIが決める——Latticeを操作するAIは装置の
 * 一部であり、そこへ同じ能力を二重化しない。ここが供給するのは、AIには作れないものだけである。
 *
 * - `affected_tests`のfresh観測。宣言と観測はbinding単位でexact比較されるので、手で当てると外れる。
 * - `sensor_query_set`と`sensor_provenance`の配線。宣言と観測の裏付けが別の資源を指す事故を防ぐ。
 * - canonical bytesと自己digest。非canonicalな宣言は独立性判定を通ってseam提案でだけ落ちる。
 *
 * この3つは2026-07-27の作業で実際に踏んだ摩擦であり、道具が無いと毎回踏む。
 */

import { canonicalizeTodoArtifact, isTodoIdentifier, isTodoRef, todoSelfDigest } from './todo-contracts.mjs';
import { TODO_WITNESS_SET_SCHEMA } from './todo-independence-contracts.mjs';

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sortedUnique = (values) => [...new Set(values)].sort(compareText);

export const WITNESS_DRAFT_SCHEMA = 'lattice.todo_witness_draft.v1';

function reject(reasons) {
  return { witnessSet: null, queries: [], reasons: sortedUnique(reasons) };
}

/** 下書きの形。AIが書く欄だけを持ち、観測で埋まる欄は持たない。 */
export function validateWitnessDraft(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.schema !== WITNESS_DRAFT_SCHEMA) return false;
  if (!isTodoIdentifier(value.project_id) || !isTodoIdentifier(value.plan_key)) return false;
  if (value.capacity === null || typeof value.capacity !== 'object'
    || !Number.isSafeInteger(value.capacity.executors) || value.capacity.executors < 1) return false;
  if (value.tasks === null || typeof value.tasks !== 'object' || Array.isArray(value.tasks)) return false;
  const entries = Object.entries(value.tasks);
  if (entries.length === 0) return false;
  return entries.every(([taskId, task]) => isTodoIdentifier(taskId)
    && task !== null && typeof task === 'object' && !Array.isArray(task)
    && Array.isArray(task.owns) && task.owns.every(isTodoRef)
    && (task.reads === undefined || (Array.isArray(task.reads) && task.reads.every(isTodoRef)))
    && (task.unknowns === undefined || (Array.isArray(task.unknowns)
      && task.unknowns.every((entry) => entry !== null && typeof entry === 'object'
        && isTodoIdentifier(entry.kind) && typeof entry.ref === 'string' && entry.ref.length > 0)))
    && (task.concern_anchors === undefined || (Array.isArray(task.concern_anchors)
      && task.concern_anchors.every((anchor) => anchor !== null && typeof anchor === 'object'
        && isTodoRef(anchor.within) && Array.isArray(anchor.symbols)
        && anchor.symbols.length > 0 && anchor.symbols.every(isTodoIdentifier)))));
}

function queryIdFor(index) {
  return `witness-affected-${String(index).padStart(3, '0')}`;
}

/** 下書きから、観測に要るquery setを組む。所有pathごとに1つのaffected queryを引く。 */
export function buildWitnessObservationQuerySet(draft) {
  const paths = sortedUnique(Object.values(draft.tasks).flatMap(({ owns }) => owns));
  return {
    queries: [
      { id: 'witness-status', operation: 'status' },
      ...paths.map((target, index) => ({
        id: queryIdFor(index), operation: 'affected', target,
      })),
    ],
    paths,
  };
}

/**
 * 下書きと観測から、そのまま通るwitness setを組む。
 *
 * @param {object} options
 * @param {object} options.draft `lattice.todo_witness_draft.v1`
 * @param {object} options.affectedTestsByPath 所有pathごとのfresh観測
 */
export function buildWitnessSet({ draft, affectedTestsByPath } = {}) {
  if (!validateWitnessDraft(draft)) return reject(['draft_invalid']);
  const { paths } = buildWitnessObservationQuerySet(draft);
  const queryIdByPath = new Map(paths.map((target, index) => [target, queryIdFor(index)]));

  const reasons = [];
  const manualWitness = {};
  for (const [taskId, task] of Object.entries(draft.tasks).sort(([left], [right]) => compareText(left, right))) {
    const owns = sortedUnique(task.owns);
    if (owns.length === 0) { reasons.push(`owns_empty:${taskId}`); continue; }
    // affected_testsは宣言とfresh観測をbinding単位でexact比較する。複数pathを所有すると
    // 観測集合が一致しない限り必ず落ちるので、今の契約では表現できない（2026-07-27の実測）。
    if (owns.length > 1) { reasons.push(`multiple_owned_paths_unsupported:${taskId}`); continue; }
    const [target] = owns;
    const affected = affectedTestsByPath?.[target];
    // 観測できていないことを空配列へ丸めない。丸めるとdriftでcompileが落ちる。
    if (!Array.isArray(affected)) { reasons.push(`affected_tests_unobserved:${target}`); continue; }
    for (const anchor of task.concern_anchors ?? []) {
      // `within`は自分が所有している資源に限る。所有していない資源の内側に担当を主張させない。
      if (!owns.includes(anchor.within)) reasons.push(`anchor_outside_owned:${taskId}:${anchor.within}`);
    }
    manualWitness[taskId] = {
      owns: [{ kind: 'path', target }],
      reads: sortedUnique(task.reads ?? []),
      writes: [target],
      resources: [],
      state_effects: [],
      sensor_provenance: {
        queries: [{
          query_id: queryIdByPath.get(target),
          expect: { kind: 'affected', path: target },
        }],
      },
      affected_tests: sortedUnique(affected),
      // 明示unknownは下書きが持つ。観測で埋まる欄ではなく、書き手が「ここは確定していない」と
      // 述べる欄なので、道具が発明も削除もしない。
      unknowns: [...(task.unknowns ?? [])]
        .map(({ kind, ref }) => ({ kind, ref }))
        .sort((left, right) => compareText(`${left.kind}\u0000${left.ref}`, `${right.kind}\u0000${right.ref}`)),
      ...(Array.isArray(task.concern_anchors) && task.concern_anchors.length > 0
        ? {
          concern_anchors: [...task.concern_anchors]
            .map((anchor) => ({
              within: { kind: 'path', target: anchor.within },
              symbols: sortedUnique(anchor.symbols),
            }))
            .sort((left, right) => compareText(left.within.target, right.within.target)),
        }
        : {}),
    };
  }
  if (reasons.length > 0) return reject(reasons);

  const witnessSet = {
    schema: TODO_WITNESS_SET_SCHEMA,
    project_id: draft.project_id,
    plan_key: draft.plan_key,
    capacity: { executors: draft.capacity.executors },
    sensor_query_set: {
      queries: [
        ...paths.map((target) => ({
          id: queryIdByPath.get(target), operation: 'affected', target,
        })),
        { id: 'witness-status', operation: 'status' },
      ].sort((left, right) => compareText(left.id, right.id)),
    },
    manual_witness: manualWitness,
    witness_set_digest: '',
  };
  witnessSet.witness_set_digest = todoSelfDigest(witnessSet, 'witness_set_digest');
  return { witnessSet, reasons: [] };
}

/** storeへ置くbytes。canonical＋末尾LFでないと、判定は通るのにseam提案で落ちる。 */
export function serializeWitnessSet(witnessSet) {
  return `${canonicalizeTodoArtifact(witnessSet)}\n`;
}
