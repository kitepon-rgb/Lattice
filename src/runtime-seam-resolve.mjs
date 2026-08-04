/**
 * 実行時に観測した競合を、実際の変換で解消するproduct入口（請求項8）。
 *
 * これが無い間、変換の中身は動くのに実運転からそこへ行く道が無かった。実運転側が使う
 * `routeConflictTreatment`は「事前宣言済みtreatmentがpathを覆う時だけseam_transform」なので、
 * **予期しなかった競合は変換にかからず直列へ退化していた**。
 *
 * 装置の境界にAIを含める（AGENTS.md）。したがってここでLatticeが供給するのは、AIが自分では
 * 作れないもの——構造観測、隔離実行、五条件の検証、変換の確定と記録——だけである。
 * 「どのTODOが係争fileの中のどのsymbolを触るか」「新しい面をどう名付けるか」はAIが既に
 * 知っているので、宣言として受け取る。推定しない。
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { digestArtifact } from './artifact-contracts.mjs';
import { commitSeamTransform } from './seam-commit.mjs';
import { applySeamConflict } from './seam-apply.mjs';
import { resolveRuntimeSeamTreatment } from './runtime-seam-treatment.mjs';
import { affectedTestsFromEvidence } from './runtime-front-end.mjs';
import { explainSeamGate } from './seam-gate.mjs';
import { collectWitnessSensorEvidence, compileTodoIndependence } from './todo-independence.mjs';
import { todoSelfDigest } from './todo-contracts.mjs';

export const RUNTIME_SEAM_REQUEST_SCHEMA = 'lattice.runtime_seam_request.v1';
// v2は翻訳段（`reconciled`）の追加である。宣言を観測へ合わせてから判定するようになったので、
// どの宣言の上で五条件を見たかが決着の一部になった。v1の形のまま中身を変えると、記録が何に
// ついてのものか確定しなくなる。
export const RUNTIME_SEAM_RESOLUTION_SCHEMA = 'lattice.runtime_seam_resolution.v2';

/** 合成するtodo planのkey。実行時planとは別空間なので固定でよい。 */
const SYNTHETIC_PLAN_KEY = 'runtime';
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/u;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** 資源idはruntime front-endと同じ合成形にする（`own-<kind>-<sha16>`）。 */
const sha16 = (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactRecord(value, keys) {
  if (!plainObject(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * AIが出す宣言。ここに書くのは「係争fileの中で各TODOが触るsymbol」「新しい面の名前」
 * 「後継planへ渡すtask migrationのdigest」だけで、どれもAIが既に持っている情報である。
 */
export function validateRuntimeSeamRequest(value) {
  if (!exactRecord(value, [
    'schema', 'run_id', 'finding_digest', 'concern_symbols', 'path_names',
    'task_migration_digest', 'request_digest',
  ])) return false;
  if (value.schema !== RUNTIME_SEAM_REQUEST_SCHEMA) return false;
  if (!IDENTIFIER.test(value.run_id ?? '')) return false;
  if (!HEX_DIGEST.test(value.finding_digest ?? '')) return false;
  if (!HEX_DIGEST.test(value.task_migration_digest ?? '')) return false;
  if (!plainObject(value.concern_symbols) || !plainObject(value.path_names)) return false;

  const todoIds = Object.keys(value.concern_symbols);
  if (todoIds.length < 2 || todoIds.length > 64) return false;
  for (const todoId of todoIds) {
    if (!IDENTIFIER.test(todoId)) return false;
    const symbols = value.concern_symbols[todoId];
    if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > 256) return false;
    if (!symbols.every((symbol) => IDENTIFIER.test(symbol))) return false;
    if (!REPO_PATH.test(value.path_names[todoId] ?? '')) return false;
  }
  // sharedはresidualから切り出す共有面。TODOに属さないので別枠で必ず要る。
  if (!REPO_PATH.test(value.path_names.shared ?? '')) return false;
  if (!exactRecord(value.path_names, [...todoIds, 'shared'])) return false;
  if (!HEX_DIGEST.test(value.request_digest ?? '')) return false;
  return value.request_digest === todoSelfDigest(value, 'request_digest');
}

/**
 * 観測された実態へ宣言を合わせる（翻訳段）。
 *
 * 実行時のpath競合は、**片方がその資源を所有していないから起きる**。所有していない資源の内側に
 * 担当は主張できない（`concern_anchor_resource_not_owned`）ので、宣言のままでは変換の入力が
 * 組めない——請求項8は、実行時に見つかった競合の形をそのままでは受け取れなかった。
 *
 * 境界は計画時の**予測**であって、workerを閉じ込める制約ではない。予測を超えたのは予測が狭かった
 * からであり、作業が不正だったからではない。したがって操作は「破った側を直す」ではなく、観測が
 * 示した実態へ宣言を合わせることであり、**対称**である——どちらの足跡が予測を超えたかは観測が
 * 決めるので、ここでは関与TODOを同じ規則で扱う。
 *
 * これは3つ目の処置ではない。翻訳を通ると計画時競合の形（`owns`の交差）になり、そこから先は
 * 既存の請求項7／8がそのまま適用できる。競合辺が立つのは翻訳の副産物ではなく目的である——
 * 立たないままだと`overlap_reduced`が最初から満たされたことになり、変換の検証が無意味になる。
 *
 * 広げるのは観測が示した資源だけとする。findingが持つ係争pathも関与TODOも観測であって推定では
 * ない。広げた事実は呼び出し側へ返す。黙って広げると、予測が外れたことも、判定がどの宣言の上で
 * 行われたかも残らない。
 *
 * **所有の宣言は裏取りと対で広げる。** `owns`だけ足すとその資源は`sensor_unbound`になり、compileは
 * 非dispatchable（`BOUNDARY_UNKNOWN`）へ落ちる。そこでは競合が投影されないので、翻訳したのに
 * 競合辺が立たず、変換の便益が測れない。裏取りに使えるqueryがrun のquery setに無ければ、
 * 広げずに理由を返す——証明できない宣言を作らない。
 */
export function reconcileWitnessToObservation({
  manualWitness, contestedPath, todoIds, sensorQuerySet = null, observedAffectedTests = null,
} = {}) {
  const reconciled = {};
  const widened = [];
  const reject = (reason) => ({ manualWitness: null, widened: [], reasons: [reason] });
  // 係争pathを覆えるqueryを、run のquery setから拾う。無ければ翻訳しない。
  //
  // `affected`だけを見る。path所有を裏取りするのはこのoperationであり、構造query（query／callers／
  // callees／impact）はsymbolを的にする。構造queryがたまたま同じ文字列をtargetに持つからといって
  // 所有の裏取りへ流用すると、束縛の意味が変わる。
  const covering = (sensorQuerySet?.queries ?? [])
    .filter((query) => query.operation === 'affected' && query.target === contestedPath)
    .map((query) => query.id)
    .sort(compareText);

  for (const todoId of todoIds) {
    const witness = manualWitness?.[todoId];
    if (!plainObject(witness)) return reject(`witness_absent:${todoId}`);
    const next = structuredClone(witness);
    const ownsPath = (next.owns ?? [])
      .some((own) => own.kind === 'path' && own.target === contestedPath);
    const writesPath = (next.writes ?? []).includes(contestedPath);
    const boundPath = (next.sensor_provenance?.queries ?? [])
      .some((entry) => (entry.expect?.kind === 'affected' || entry.expect?.kind === 'path')
        && entry.expect?.path === contestedPath);
    // 既に所有と書き込みを宣言しているなら、観測は予測の内側にある。合わせるものが無いので
    // 触らない——裏取りが足りているかどうかは、その宣言を書いた側の問題であり、compileが見る。
    // 翻訳が手を入れてよいのは、観測が予測を超えた分だけである。
    if (ownsPath && writesPath) {
      reconciled[todoId] = next;
      continue;
    }
    if (!boundPath) {
      if (covering.length === 0) return reject(`observation_unbacked:${todoId}:${contestedPath}`);
      // 同じ資源は同じqueryで裏取りする。TODOごとに別のqueryを選ぶと、front-endが被覆の
      // 曖昧さとして弾く。
      if (covering.length > 1) return reject(`observation_binding_ambiguous:${contestedPath}`);
      // 観測できていないaffectedを推測で埋めない。
      if (!Array.isArray(observedAffectedTests)) {
        return reject(`observation_affected_unread:${contestedPath}`);
      }
    }
    // 所有・書き込み・裏取りをまとめて足す。観測されたのは「このpathへの書き込み」であり、
    // 宣言の一部だけを合わせると、宣言が実態からずれたまま次の判定の前提になる。`creates`は
    // 付けない——観測できたのはpathが既に在るからである。
    if (!ownsPath) next.owns = [...next.owns, { kind: 'path', target: contestedPath }]
      .sort((left, right) => compareText(`${left.kind}\0${left.target}`, `${right.kind}\0${right.target}`));
    if (!writesPath) next.writes = [...next.writes, contestedPath].sort(compareText);
    if (!boundPath) {
      next.sensor_provenance = {
        ...next.sensor_provenance,
        queries: [...next.sensor_provenance.queries,
          { query_id: covering[0], expect: { kind: 'affected', path: contestedPath } }],
      };
      // 面を1つ引き受けたら、その面のaffected testも引き受ける。宣言と観測はTODO単位で
      // exact一致を要求されるので、片方だけ広げるとdriftになる。
      next.affected_tests = [...new Set([...next.affected_tests, ...observedAffectedTests])]
        .sort(compareText);
    }
    reconciled[todoId] = next;
    widened.push({
      todo_id: todoId,
      resource: { kind: 'path', target: contestedPath },
      fields: [
        ...(ownsPath ? [] : ['owns']),
        ...(writesPath ? [] : ['writes']),
        ...(boundPath ? [] : ['affected_tests', 'sensor_provenance']),
      ].sort(compareText),
    });
  }
  return { manualWitness: reconciled, widened, reasons: [] };
}

/**
 * 実行時witnessへconcern anchorを足してtodo witness setにする。
 *
 * 実行時のmanual_witnessはconcern_anchorsを持たない（`lattice.run_request.v3`）。持たせるのでなく、
 * 宣言から足す——係争資源の中のどのsymbolを触るかは実行時に確定する情報であり、run開始時点の
 * 契約に書けるものではないからである。
 *
 * anchorを足す前に宣言を観測へ合わせる（`reconcileWitnessToObservation`）。この順序でないと、
 * 係争資源を所有していないTODOのanchorが必ず不正になる。
 */
export function buildRuntimeSeamWitnessSet({
  request, declaration, contestedPath, executors, observedAffectedTests = null,
}) {
  const todoIds = Object.keys(declaration.concern_symbols).sort(compareText);
  const translated = reconcileWitnessToObservation({
    manualWitness: request.manual_witness, contestedPath, todoIds,
    sensorQuerySet: request.sensor_query_set, observedAffectedTests,
  });
  if (translated.manualWitness === null) {
    return { witnessSet: null, widened: [], reasons: translated.reasons };
  }
  const manual = {};
  for (const todoId of todoIds) {
    manual[todoId] = {
      ...translated.manualWitness[todoId],
      concern_anchors: [{
        within: { kind: 'path', target: contestedPath },
        symbols: [...declaration.concern_symbols[todoId]].sort(compareText),
      }],
    };
  }
  const witnessSet = {
    schema: 'lattice.todo_witness_set.v3',
    project_id: SYNTHETIC_PLAN_KEY,
    plan_key: SYNTHETIC_PLAN_KEY,
    capacity: { executors },
    sensor_query_set: structuredClone(request.sensor_query_set),
    manual_witness: manual,
    witness_set_digest: '',
  };
  witnessSet.witness_set_digest = todoSelfDigest(witnessSet, 'witness_set_digest');
  return { witnessSet, widened: translated.widened, reasons: [] };
}

function syntheticTodoPlan(todoIds) {
  return {
    schema: 'lattice.todo_plan.v2',
    project_id: SYNTHETIC_PLAN_KEY,
    plan_key: SYNTHETIC_PLAN_KEY,
    plan_version: 'v1',
    topology_digest: digestArtifact({ tasks: [...todoIds].sort(compareText) }),
    tasks: [...todoIds].sort(compareText).map((taskId) => ({ task_id: taskId })),
  };
}

/**
 * 記録済みfindingと宣言から、変換を導出・適用・検証・確定して処置を返す。
 *
 * 五条件（ADR 0138）を1つでも欠いたら意図的直列を返す。確定できなければ採用しない（ADR 0141）。
 * 「変換した」と言いながら再開できない状態を作らない。
 */
export async function resolveRuntimeSeam({
  repoRoot, runDir, findingRecord, bundle, declaration, latticeBin, compiledAt,
} = {}) {
  const finding = findingRecord.finding;
  const request = bundle.request;
  const baseSha = request.repo.base_sha;
  const todoIds = Object.keys(declaration.concern_symbols).sort(compareText);

  if (finding.kind !== 'observed_write_conflict' || typeof finding.path !== 'string') {
    return { lane: 'intentional_serial', reasons: ['finding_not_write_conflict'], split: null, widened: [] };
  }
  const findingTodoIds = [...finding.todo_ids].sort(compareText);
  if (findingTodoIds.join('\0') !== todoIds.join('\0')) {
    return {
      lane: 'intentional_serial',
      reasons: ['declared_todos_differ_from_finding'],
      split: null,
      widened: [],
    };
  }

  // sensorは1回だけ引く。翻訳（宣言を観測へ合わせる）とcompileは同じ観測の上で行う——
  // 別々に引くと、翻訳が見た実態とcompileが見た実態がずれうる。
  const sensorEvidence = await collectWitnessSensorEvidence({
    cwd: repoRoot, witnessSet: { sensor_query_set: request.sensor_query_set },
  });
  const built = buildRuntimeSeamWitnessSet({
    request, declaration, contestedPath: finding.path,
    executors: request.capacity.executors,
    observedAffectedTests: affectedTestsFromEvidence({
      sensorEvidence, querySet: request.sensor_query_set, path: finding.path,
    }),
  });
  if (built.witnessSet === null) {
    return { lane: 'intentional_serial', reasons: built.reasons, split: null, widened: [] };
  }
  const witnessSet = built.witnessSet;
  const plan = syntheticTodoPlan(todoIds);

  // 観測したaffected testsだけを検証に使う。宣言から発明しない。翻訳後の宣言から採る——
  // 所有が広がったTODOは、その面のtestも自分のaffectedとして引き受けている。
  const affectedTests = [...new Set(todoIds
    .flatMap((todoId) => witnessSet.manual_witness[todoId].affected_tests))].sort(compareText);

  const baseArtifact = compileTodoIndependence({
    witnessSet, plan, baseSha, compiledAt, sensorEvidence,
  });

  const pathNames = { ...declaration.path_names };
  // 翻訳で広げた宣言は決着へ載せる。どの宣言の上で五条件を判定したかが残らないと、
  // 「変換して通った」という記録が何についてのものか確定しない。
  const resolved = await resolveRuntimeSeamTreatment({
    finding,
    witnessSet,
    pathNames,
    baseSha,
    manifestDigest: baseArtifact.result_digest,
    affectedTests,
    taskMigrationDigest: declaration.task_migration_digest,
    // storeへ記録されたfindingのidで縛る。再計画側はこのidでfinding recordを読む。
    recordedFindingDigest: findingRecord.finding_digest,
    commitTransform: async ({ files, candidateId }) => commitSeamTransform({
      repoRoot, baseSha, files, candidateId,
    }),
    applyConflict: async ({ conflict }) => {
      const applied = await applySeamConflict({
        repoRoot,
        planKey: SYNTHETIC_PLAN_KEY,
        conflict,
        witnessSet,
        latticeBin,
        sharedPathFor: () => declaration.path_names.shared,
        executors: request.capacity.executors,
        precedences: bundle.plan.precedence,
        pathNames,
        compileIndependence: {
          baseArtifact,
          inWorktree: async ({ worktreePath, witnessSet: postWitness }) => compileTodoIndependence({
            witnessSet: postWitness,
            plan,
            baseSha,
            compiledAt,
            sensorEvidence: await collectWitnessSensorEvidence({
              cwd: worktreePath, witnessSet: postWitness,
            }),
          }),
        },
      });
      return { ...applied, candidate: applied.candidate ?? null };
    },
  });
  return { ...resolved, widened: built.widened };
}

/** 決着をartifactにする。branchを動かすのは操作するAIなので、行き先を明示して返す。 */
export function buildRuntimeSeamResolution({ runId, findingDigest, resolved }) {
  const resolution = {
    schema: RUNTIME_SEAM_RESOLUTION_SCHEMA,
    run_id: runId,
    finding_digest: findingDigest,
    lane: resolved.lane,
    reasons: [...resolved.reasons].sort(compareText),
    // 確実の門（sc-012）。拒否理由を「宣言を直せば機械で通る」「AIが変換すべき」へ分類し、
    // 次に誰が動くべきかを事実として返す。可否は決めない。
    gate: explainSeamGate(resolved.reasons ?? []),
    // 判定の前に宣言をどれだけ観測へ合わせたか。空配列は「予測が実態を覆っていた」という
    // 意味であり、翻訳しなかったことと区別できる。
    reconciled: [...(resolved.widened ?? [])]
      .map((entry) => ({
        todo_id: entry.todo_id,
        resource: { kind: entry.resource.kind, target: entry.resource.target },
        fields: [...entry.fields].sort(compareText),
      }))
      .sort((left, right) => compareText(
        `${left.todo_id}\0${left.resource.kind}\0${left.resource.target}`,
        `${right.todo_id}\0${right.resource.kind}\0${right.resource.target}`,
      )),
    split: resolved.split ?? null,
    successor_base_sha: resolved.successor_base_sha ?? null,
    successor_base_ref: resolved.successor_base_ref ?? null,
    resolution_digest: '',
  };
  resolution.resolution_digest = todoSelfDigest(resolution, 'resolution_digest');
  return resolution;
}

/**
 * seam_split再計画で、後継baseが本当に変換を含むかを検査する（ADR 0141）。
 *
 * これが無い間、`mode: 'seam_split'`の再計画requestは**変換を含まないbaseを指していても通った**。
 * splitは新しい面の所有を宣言するのに、compileされる後継treeにそのfileが無い——rb工程で
 * 直したのと同じ欠陥が、管理runtimeの層に残っていた。
 *
 * 検査するのは3つ。どれもLatticeが既に持っているartifactだけで判定でき、推定を含まない。
 *
 * 1. baseが前進し、かつ旧baseの子孫であること。変換が着地していなければ前進しない。
 * 2. splitが「消える」と述べた競合辺が、後継planに実際に無いこと。後継treeに変換が
 *    載っていなければ両TODOは同じfileを書き続けるので、この辺は消えない。
 * 3. splitが新たに所有すると述べた資源が、後継requestで**creationとして宣言されていない**こと。
 *    seam splitは既存codeを新しい面へ移す操作であり、変換が既に作っている。これから作る、
 *    と宣言されているなら、指しているbaseは変換前である。
 */
export function verifySeamSplitSuccessor({
  split, predecessorBaseSha, successorBaseSha, successorIsDescendant,
  successorConflicts = [], successorWitness = {},
} = {}) {
  const reasons = [];
  if (successorBaseSha === predecessorBaseSha) reasons.push('successor_base_not_advanced');
  else if (successorIsDescendant !== true) reasons.push('successor_base_not_descendant');

  const removedEdges = split?.edge_diff?.removed ?? [];
  const remaining = new Set(successorConflicts
    .map(({ todo_ids: ids }) => [...ids].sort(compareText).join('\0')));
  for (const edge of removedEdges) {
    const key = [edge.from_todo_id, edge.to_todo_id].sort(compareText).join('\0');
    if (remaining.has(key)) reasons.push(`declared_removed_conflict_persists:${key.replace('\0', ',')}`);
  }

  for (const added of split?.ownership_diff?.added ?? []) {
    const owns = successorWitness[added.owner_todo_id]?.owns ?? [];
    for (const own of owns) {
      const resourceId = `own-${own.kind}-${sha16(own.target)}`;
      if (resourceId === added.resource_id && own.creates === true) {
        reasons.push(`declared_owned_surface_is_creation:${added.owner_todo_id}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)].sort(compareText) };
}

/** `<runDir>/findings/<digest>.json`を読む。存在しない／別epochのfindingは受けない。 */
export async function readRuntimeFindingRecord({ runDir, findingDigest, planEpoch }) {
  const filePath = path.join(runDir, 'findings', `${findingDigest}.json`);
  let record;
  try {
    record = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return { record: null, reason: 'finding_not_recorded' };
  }
  if (record?.finding_digest !== findingDigest) return { record: null, reason: 'finding_digest_mismatch' };
  if (record.plan_epoch !== planEpoch) return { record: null, reason: 'finding_from_other_epoch' };
  return { record, reason: null };
}
