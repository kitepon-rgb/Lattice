import { digestTodoArtifact, isTodoIdentifier, todoSelfDigest } from './todo-contracts.mjs';
import {
  TODO_INDEPENDENCE_SCHEMA,
  isGitSha,
  synthesizeWitnessRunRequest,
  validateTodoIndependence,
  validateTodoWitnessSet,
} from './todo-independence-contracts.mjs';
import { compileRuntimePlanV1, evidenceFromCollectedOutcomes } from './runtime-front-end.mjs';
import { collectSensorEvidence } from './sensor-adapter.mjs';

export class TodoIndependenceError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoIndependenceError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail) {
  throw new TodoIndependenceError(code, reason, detail);
}

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/**
 * compile一回を識別するid。plan identityとwitness digestだけから決まるので、
 * 同じ入力からは同じrequest bytesが出る。run lifecycleへは登録しない。
 */
export function witnessRequestId(witnessSet, planVersion) {
  const digest = digestTodoArtifact({
    schema: 'lattice.todo_independence_request_id.v1',
    project_id: witnessSet.project_id,
    plan_key: witnessSet.plan_key,
    plan_version: planVersion,
    witness_set_digest: witnessSet.witness_set_digest,
  });
  return `independence-${digest.slice(0, 24)}`;
}

/** 実sensorを引いてfront-end evidence契約へ整形する。失敗をunknownへ丸めない。 */
export async function collectWitnessSensorEvidence({ cwd, witnessSet, execute = undefined }) {
  const querySet = witnessSet.sensor_query_set;
  const collected = await collectSensorEvidence({
    cwd, querySet, ...(execute === undefined ? {} : { execute }),
  });
  return evidenceFromCollectedOutcomes({ querySet, collected });
}

function conflictsFrom(verdicts) {
  return verdicts
    .filter((verdict) => verdict.type === 'conflict')
    .map((verdict) => ({
      task_ids: [...verdict.todo_ids].sort(compareText),
      resource_id: verdict.resource_id,
    }))
    .sort((left, right) => compareText(
      `${left.task_ids[0]}\0${left.task_ids[1]}\0${left.resource_id}`,
      `${right.task_ids[0]}\0${right.task_ids[1]}\0${right.resource_id}`,
    ));
}

function precedencesFrom(verdicts) {
  return verdicts
    .filter((verdict) => verdict.type === 'precedence')
    .map((verdict) => ({
      from_task_id: verdict.from_todo_id,
      to_task_id: verdict.to_todo_id,
      reason: verdict.reason,
    }))
    .sort((left, right) => compareText(
      `${left.from_task_id}\0${left.to_task_id}\0${left.reason}`,
      `${right.from_task_id}\0${right.to_task_id}\0${right.reason}`,
    ));
}

function unknownsFrom(detail) {
  const entries = [
    ...(Array.isArray(detail?.unknowns) ? detail.unknowns : []),
    ...(Array.isArray(detail?.unresolved_witnesses) ? detail.unresolved_witnesses : []),
  ]
    .filter((entry) => entry !== null && typeof entry === 'object'
      && typeof entry.todo_id === 'string' && typeof entry.kind === 'string'
      && typeof entry.ref === 'string')
    .map((entry) => ({
      task_id: entry.todo_id,
      kind: entry.kind,
      ref: entry.ref,
    }));
  const seen = new Set();
  return entries
    .filter((entry) => {
      const key = `${entry.task_id}\0${entry.kind}\0${entry.ref}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => compareText(
      `${left.task_id}\0${left.kind}\0${left.ref}`,
      `${right.task_id}\0${right.kind}\0${right.ref}`,
    ));
}

/**
 * witness setとsensor evidenceから`lattice.todo_independence.v1`を作る。
 *
 * compileは宣言済みtaskの部分集合へ閉じる（ADR 0127 Decision 4）。未宣言taskを混ぜると、
 * unknownが1件でも出た時点で宣言済みtask同士の判定まで失われるためである。
 * `dispatchable`ならpairwise verdictとwave planを写し、`BOUNDARY_UNKNOWN`なら
 * unknownをtask単位で記録してwave planを持たない。それ以外のnon-dispatchableは
 * 契約違反または観測不成立であり、artifactへ丸めずtyped errorで止める。
 */
export function compileTodoIndependence(options = {}) {
  const { witnessSet, plan, baseSha, compiledAt, sensorEvidence } = options;
  if (!validateTodoWitnessSet(witnessSet)) {
    fail('INDEPENDENCE_WITNESS_INVALID', 'witness_set_invalid');
  }
  if (!isGitSha(baseSha)) fail('INDEPENDENCE_BASE_INVALID', 'base_sha_invalid');
  if (witnessSet.project_id !== plan.project_id || witnessSet.plan_key !== plan.plan_key) {
    fail('INDEPENDENCE_PLAN_MISMATCH', 'witness_set_plan_mismatch', {
      witness_plan_key: witnessSet.plan_key, plan_key: plan.plan_key,
    });
  }

  const planTaskIds = new Set(plan.tasks.map(({ task_id: taskId }) => taskId));
  const taskIds = Object.keys(witnessSet.manual_witness).sort(compareText);
  const absent = taskIds.filter((taskId) => !planTaskIds.has(taskId));
  if (absent.length > 0) {
    fail('INDEPENDENCE_TASK_ABSENT', 'witness_task_absent_from_plan', { task_ids: absent });
  }

  const request = synthesizeWitnessRunRequest(witnessSet, {
    baseSha, requestId: witnessRequestId(witnessSet, plan.plan_version),
  });
  const compiled = compileRuntimePlanV1({
    request,
    sensorEvidence,
    planRef: witnessRequestId(witnessSet, plan.plan_version),
    planEpoch: 0,
    predecessorRefs: [],
  });

  if (compiled.outcome !== 'dispatchable'
    && !(compiled.outcome === 'non_dispatchable' && compiled.code === 'BOUNDARY_UNKNOWN')) {
    fail('INDEPENDENCE_COMPILE_FAILED', 'boundary_compile_not_dispatchable', {
      code: compiled.code ?? null, compile_detail: compiled.detail ?? null,
    });
  }

  const dispatchable = compiled.outcome === 'dispatchable';
  const artifact = {
    schema: TODO_INDEPENDENCE_SCHEMA,
    project_id: plan.project_id,
    plan_key: plan.plan_key,
    plan_version: plan.plan_version,
    topology_digest: plan.topology_digest,
    base_sha: baseSha,
    witness_set_digest: witnessSet.witness_set_digest,
    compiled_at: compiledAt,
    task_ids: taskIds,
    conflicts: dispatchable ? conflictsFrom(compiled.pairwise_verdicts) : [],
    precedences: dispatchable ? precedencesFrom(compiled.pairwise_verdicts) : [],
    unknowns: dispatchable ? [] : unknownsFrom(compiled.detail),
    wave_plan: dispatchable
      ? {
        waves: compiled.schedule.waves.map((wave) => ({
          task_ids: [...wave.todo_ids].sort(compareText),
        })),
        minimum_feasible_waves: compiled.schedule.minimum_feasible_waves,
      }
      : null,
    outcome: dispatchable ? 'compiled' : 'unknown',
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');

  // unknownを1件も持たないのに非dispatchableという状態は、原因を失った成功扱いになる。
  if (!dispatchable && artifact.unknowns.length === 0) {
    fail('INDEPENDENCE_COMPILE_FAILED', 'boundary_unknown_without_cause', {
      compile_detail: compiled.detail ?? null,
    });
  }
  if (!validateTodoIndependence(artifact)) {
    fail('INDEPENDENCE_ARTIFACT_INVALID', 'independence_artifact_invalid');
  }
  return artifact;
}

function pairKey(left, right) {
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

/**
 * ready frontierを、記録済みartifactだけを根拠に
 * 「検証済み独立」「直列化すべき組」「未検査」へ分けて投影する。
 *
 * sensorは引かない。artifactが無い／planが進んだ／HEADが動いた場合はcoverageで示し、
 * 記録が現在のコード状態を指していない間はverified独立を主張しない。
 */
export function projectIndependenceFrontier({ artifact, readyTaskIds, plan, currentBaseSha }) {
  const ready = [...readyTaskIds].sort(compareText);
  if (!isGitSha(currentBaseSha)) fail('INDEPENDENCE_BASE_INVALID', 'current_base_sha_invalid');

  if (artifact === null) {
    return {
      coverage: 'missing',
      frontier: {
        parallel_groups: [],
        serialize_pairs: [],
        unknown: ready.map((taskId) => ({
          task_id: taskId,
          unknowns: [{ kind: 'witness_missing', ref: 'no_independence_record' }],
        })),
      },
    };
  }

  const superseded = artifact.plan_version !== plan.plan_version
    || artifact.topology_digest !== plan.topology_digest;
  const coverage = superseded ? 'superseded'
    : artifact.base_sha === currentBaseSha ? 'verified' : 'stale';

  const covered = new Set(artifact.task_ids);
  const unknownByTask = new Map();
  const noteUnknown = (taskId, kind, ref) => {
    if (!unknownByTask.has(taskId)) unknownByTask.set(taskId, []);
    unknownByTask.get(taskId).push({ kind, ref });
  };
  for (const taskId of ready) {
    if (!covered.has(taskId)) noteUnknown(taskId, 'witness_missing', 'task_not_in_witness_set');
  }
  for (const entry of artifact.unknowns) {
    if (ready.includes(entry.task_id)) noteUnknown(entry.task_id, entry.kind, entry.ref);
  }
  // 記録が現在の状態を指していない間は、記録済みtaskも検証済みとして扱わない。
  if (coverage !== 'verified') {
    for (const taskId of ready) {
      if (covered.has(taskId)) {
        noteUnknown(taskId, coverage === 'stale' ? 'record_stale' : 'record_superseded',
          artifact.base_sha);
      }
    }
  }

  const serializePairs = [];
  const blocked = new Set();
  for (const conflict of artifact.conflicts) {
    const [left, right] = conflict.task_ids;
    if (!ready.includes(left) || !ready.includes(right)) continue;
    serializePairs.push({ task_ids: [left, right], type: 'conflict', detail: conflict.resource_id });
    blocked.add(pairKey(left, right));
  }
  for (const precedence of artifact.precedences) {
    const { from_task_id: from, to_task_id: to } = precedence;
    if (!ready.includes(from) || !ready.includes(to)) continue;
    const pair = [from, to].sort(compareText);
    serializePairs.push({ task_ids: pair, type: 'precedence', detail: precedence.reason });
    blocked.add(pairKey(from, to));
  }
  serializePairs.sort((left, right) => compareText(
    `${left.task_ids[0]}\0${left.task_ids[1]}\0${left.type}\0${left.detail}`,
    `${right.task_ids[0]}\0${right.task_ids[1]}\0${right.type}\0${right.detail}`,
  ));

  // 未検査を並列グループへ入れない。verdictの不在を独立の証拠にできるのは、
  // 両taskがcompile対象であり、どちらにもunknownが無いときだけである。
  const eligible = ready.filter((taskId) => !unknownByTask.has(taskId));
  const groups = [];
  for (const taskId of eligible) {
    const target = groups.find((group) => group.every((member) => !blocked.has(pairKey(member, taskId))));
    if (target === undefined) groups.push([taskId]); else target.push(taskId);
  }

  return {
    coverage,
    frontier: {
      parallel_groups: groups.map((task_ids) => ({ task_ids: [...task_ids].sort(compareText) }))
        .sort((left, right) => compareText(left.task_ids[0], right.task_ids[0])),
      serialize_pairs: serializePairs,
      unknown: [...unknownByTask.entries()]
        .map(([taskId, unknowns]) => ({ task_id: taskId, unknowns }))
        .sort((left, right) => compareText(left.task_id, right.task_id)),
    },
  };
}

export function isIndependenceIdentifier(value) {
  return isTodoIdentifier(value);
}
