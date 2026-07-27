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
import { readFile } from 'node:fs/promises';

import { digestArtifact } from './artifact-contracts.mjs';
import { commitSeamTransform } from './seam-commit.mjs';
import { applySeamConflict } from './seam-apply.mjs';
import { resolveRuntimeSeamTreatment } from './runtime-seam-treatment.mjs';
import { collectWitnessSensorEvidence, compileTodoIndependence } from './todo-independence.mjs';
import { todoSelfDigest } from './todo-contracts.mjs';

export const RUNTIME_SEAM_REQUEST_SCHEMA = 'lattice.runtime_seam_request.v1';
export const RUNTIME_SEAM_RESOLUTION_SCHEMA = 'lattice.runtime_seam_resolution.v1';

/** 合成するtodo planのkey。実行時planとは別空間なので固定でよい。 */
const SYNTHETIC_PLAN_KEY = 'runtime';
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/u;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

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
 * 実行時witnessへconcern anchorを足してtodo witness setにする。
 *
 * 実行時のmanual_witnessはconcern_anchorsを持たない（`lattice.run_request.v3`）。持たせるのでなく、
 * 宣言から足す——係争資源の中のどのsymbolを触るかは実行時に確定する情報であり、run開始時点の
 * 契約に書けるものではないからである。
 */
export function buildRuntimeSeamWitnessSet({ request, declaration, contestedPath, executors }) {
  const todoIds = Object.keys(declaration.concern_symbols).sort(compareText);
  const manual = {};
  for (const todoId of todoIds) {
    const witness = request.manual_witness?.[todoId];
    if (!plainObject(witness)) return { witnessSet: null, reasons: [`witness_absent:${todoId}`] };
    manual[todoId] = {
      ...structuredClone(witness),
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
  return { witnessSet, reasons: [] };
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
    return { lane: 'intentional_serial', reasons: ['finding_not_write_conflict'], split: null };
  }
  const findingTodoIds = [...finding.todo_ids].sort(compareText);
  if (findingTodoIds.join('\0') !== todoIds.join('\0')) {
    return {
      lane: 'intentional_serial',
      reasons: ['declared_todos_differ_from_finding'],
      split: null,
    };
  }

  const built = buildRuntimeSeamWitnessSet({
    request, declaration, contestedPath: finding.path,
    executors: request.capacity.executors,
  });
  if (built.witnessSet === null) {
    return { lane: 'intentional_serial', reasons: built.reasons, split: null };
  }
  const witnessSet = built.witnessSet;
  const plan = syntheticTodoPlan(todoIds);

  // 観測したaffected testsだけを検証に使う。宣言から発明しない。
  const affectedTests = [...new Set(todoIds
    .flatMap((todoId) => request.manual_witness[todoId].affected_tests))].sort(compareText);

  const baseArtifact = compileTodoIndependence({
    witnessSet, plan, baseSha, compiledAt,
    sensorEvidence: await collectWitnessSensorEvidence({ cwd: repoRoot, witnessSet }),
  });

  const pathNames = { ...declaration.path_names };
  return resolveRuntimeSeamTreatment({
    finding,
    witnessSet,
    pathNames,
    baseSha,
    manifestDigest: baseArtifact.result_digest,
    affectedTests,
    taskMigrationDigest: declaration.task_migration_digest,
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
}

/** 決着をartifactにする。branchを動かすのは操作するAIなので、行き先を明示して返す。 */
export function buildRuntimeSeamResolution({ runId, findingDigest, resolved }) {
  const resolution = {
    schema: RUNTIME_SEAM_RESOLUTION_SCHEMA,
    run_id: runId,
    finding_digest: findingDigest,
    lane: resolved.lane,
    reasons: [...resolved.reasons].sort(compareText),
    split: resolved.split ?? null,
    successor_base_sha: resolved.successor_base_sha ?? null,
    successor_base_ref: resolved.successor_base_ref ?? null,
    resolution_digest: '',
  };
  resolution.resolution_digest = todoSelfDigest(resolution, 'resolution_digest');
  return resolution;
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
