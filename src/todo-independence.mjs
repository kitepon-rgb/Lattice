import { digestTodoArtifact, isTodoIdentifier, todoSelfDigest } from './todo-contracts.mjs';
import {
  TODO_INDEPENDENCE_SCHEMA,
  isGitSha,
  severabilityOfConflictKind,
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

/**
 * conflictへresource kindを載せる（ADR 0128 Decision 1）。
 *
 * `graph.conflicts`はresource_idしか持たず、宣言由来のstate resource idは任意文字列なので
 * prefixからkindを復元できない。normalized resourceを引けない場合は、切断可能性を
 * 不明のまま記録するのでなくtyped failで止める。
 */
function conflictsFrom(verdicts, resources) {
  const kindByResourceId = new Map((Array.isArray(resources) ? resources : [])
    .map((resource) => [resource?.resource_id, resource?.kind]));
  return verdicts
    .filter((verdict) => verdict.type === 'conflict')
    .map((verdict) => {
      const kind = kindByResourceId.get(verdict.resource_id);
      if (!['symbol', 'path', 'state', 'effect'].includes(kind)) {
        fail('INDEPENDENCE_RESOURCE_KIND_UNRESOLVED', 'conflict_resource_kind_unresolved', {
          resource_id: verdict.resource_id, observed_kind: kind ?? null,
        });
      }
      return {
        task_ids: [...verdict.todo_ids].sort(compareText),
        resource_id: verdict.resource_id,
        kind,
      };
    })
    .sort((left, right) => compareText(
      `${left.task_ids[0]}\0${left.task_ids[1]}\0${left.resource_id}`,
      `${right.task_ids[0]}\0${right.task_ids[1]}\0${right.resource_id}`,
    ));
}

/**
 * witnessが宣言した境界pathを集める。
 *
 * 鮮度のdiff交差判定に使うので、observationへ効くpathを漏れなく採る——所有path、
 * 書き込み、読み取り、affected test、sensor queryのexpect path。symbol owns自体は
 * pathを持たないが、それを裏取りするqueryのexpect pathが同じ効果を持つ。
 */
function boundaryPathsOf(witness) {
  const paths = new Set();
  for (const own of witness.owns) {
    if (own.kind === 'path') paths.add(own.target);
  }
  for (const path of witness.writes) paths.add(path);
  for (const path of witness.reads) paths.add(path);
  for (const path of witness.affected_tests) paths.add(path);
  for (const entry of witness.sensor_provenance.queries) paths.add(entry.expect.path);
  return [...paths].sort(compareText);
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
    task_boundaries: taskIds.map((taskId) => ({
      task_id: taskId,
      paths: boundaryPathsOf(witnessSet.manual_witness[taskId]),
    })),
    conflicts: dispatchable
      ? conflictsFrom(compiled.pairwise_verdicts, compiled.resources) : [],
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
 * 変更pathが宣言境界に触れたかを判定する。
 *
 * 完全一致か、宣言側が`dir/`形式のprefixで変更pathを覆う場合に交差とみなす
 * （runtime diff observerのscope判定と同一規則）。
 */
function boundaryTouches(declaredPaths, changedPath) {
  return declaredPaths.some((declared) => declared === changedPath
    || (declared.endsWith('/') && changedPath.startsWith(declared)));
}

/**
 * ready frontierを、記録済みartifactだけを根拠に
 * 「検証済み独立」「直列化すべき組」「進行中との競合」「未検査」へ分けて投影する。
 *
 * sensorは引かない。artifactが無い／planが進んだ場合はcoverageで示す。
 * HEADが動いた場合は`changedPaths`と宣言境界の交差を見て、交差したtaskだけを未検査へ落とす
 * （ADR 0128 Decision 4）。宣言境界に触れないdiffは観測を変えないため、
 * 交差しなかったtaskのverified独立は維持する。
 *
 * @param {object} options
 * @param {object|null} options.artifact 記録済みindependence artifact（v2）
 * @param {string[]} options.readyTaskIds 同一plan内のready task
 * @param {string[]} options.activeTaskIds 同一plan内のin-progress task
 * @param {object} options.plan plan_versionとtopology_digestを持つactive plan
 * @param {string} options.currentBaseSha 現在のHEAD
 * @param {string[]|null} options.changedPaths base_sha..HEADの変更path。
 *   nullはdiffを確定できなかったこと（base到達不能）を意味し、全taskを交差扱いにする。
 */
export function projectIndependenceFrontier({
  artifact, readyTaskIds, activeTaskIds = [], plan, currentBaseSha, changedPaths = null,
}) {
  const ready = [...readyTaskIds].sort(compareText);
  const active = [...activeTaskIds].sort(compareText);
  if (!isGitSha(currentBaseSha)) fail('INDEPENDENCE_BASE_INVALID', 'current_base_sha_invalid');

  const emptyFrontier = () => ({
    parallel_groups: [],
    serialize_pairs: [],
    conflicts_with_active: [],
    unknown: ready.map((taskId) => ({
      task_id: taskId,
      unknowns: [{ kind: 'witness_missing', ref: 'no_independence_record' }],
    })),
  });

  if (artifact === null) {
    return {
      coverage: 'missing',
      drift: null,
      active_task_ids: active,
      uncovered_active_task_ids: active,
      frontier: emptyFrontier(),
    };
  }

  const superseded = artifact.plan_version !== plan.plan_version
    || artifact.topology_digest !== plan.topology_digest;
  const coverage = superseded ? 'superseded'
    : artifact.base_sha === currentBaseSha ? 'verified' : 'stale';

  const covered = new Set(artifact.task_ids);
  const boundariesByTask = new Map(artifact.task_boundaries
    .map((entry) => [entry.task_id, entry.paths]));

  // 宣言境界とdiffの交差。coverage==='stale'のときだけ意味を持つ。
  let drift = null;
  const intersecting = new Set();
  if (coverage === 'stale') {
    const baseReachable = changedPaths !== null;
    if (!baseReachable) {
      // 差分を確定できないなら、記録が今も有効だと主張する根拠が無い。
      for (const taskId of artifact.task_ids) intersecting.add(taskId);
    } else {
      for (const taskId of artifact.task_ids) {
        const declared = boundariesByTask.get(taskId) ?? [];
        if (changedPaths.some((changed) => boundaryTouches(declared, changed))) {
          intersecting.add(taskId);
        }
      }
    }
    drift = {
      base_reachable: baseReachable,
      changed_path_count: baseReachable ? changedPaths.length : 0,
      intersecting_task_ids: [...intersecting].sort(compareText),
    };
  }

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
  // planが進んだ記録はtask単位に救えない（topology自体が別物）。
  // HEADだけが進んだ場合は、宣言境界に触れたtaskだけを落とす。
  if (coverage === 'superseded') {
    for (const taskId of ready) {
      if (covered.has(taskId)) noteUnknown(taskId, 'record_superseded', artifact.base_sha);
    }
  } else if (coverage === 'stale') {
    for (const taskId of ready) {
      if (covered.has(taskId) && intersecting.has(taskId)) {
        noteUnknown(taskId, 'record_stale', artifact.base_sha);
      }
    }
  }

  // 記録が今のtaskへ有効か。無効な相手との競合は「競合なし」でなく「判定不能」であり、
  // conflicts_with_activeではなくuncovered_activeとして示す。
  const usable = (taskId) => covered.has(taskId)
    && !(coverage === 'superseded')
    && !(coverage === 'stale' && intersecting.has(taskId));
  const uncoveredActive = active.filter((taskId) => !usable(taskId));

  const readySet = new Set(ready);
  const activeSet = new Set(active);
  const serializePairs = [];
  const activeConflicts = [];
  const blocked = new Set();

  const notePair = (left, right, type, detail, kind) => {
    const severability = type === 'conflict' ? severabilityOfConflictKind(kind) : 'serial';
    const pairKind = type === 'conflict' ? kind : null;
    if (readySet.has(left) && readySet.has(right)) {
      const pair = [left, right].sort(compareText);
      serializePairs.push({
        task_ids: pair, type, detail, kind: pairKind, severability,
      });
      blocked.add(pairKey(left, right));
      return;
    }
    // 片端がactiveなら着手時の警告面へ回す。v1はここで黙って捨てていた。
    const readyId = readySet.has(left) ? left : readySet.has(right) ? right : null;
    const activeId = activeSet.has(left) ? left : activeSet.has(right) ? right : null;
    if (readyId === null || activeId === null || readyId === activeId) return;
    if (!usable(readyId) || !usable(activeId)) return;
    activeConflicts.push({
      ready_task_id: readyId, active_task_id: activeId, type, detail,
      kind: pairKind, severability,
    });
  };

  for (const conflict of artifact.conflicts) {
    notePair(conflict.task_ids[0], conflict.task_ids[1], 'conflict', conflict.resource_id,
      conflict.kind);
  }
  for (const precedence of artifact.precedences) {
    notePair(precedence.from_task_id, precedence.to_task_id, 'precedence', precedence.reason, null);
  }
  serializePairs.sort((left, right) => compareText(
    `${left.task_ids[0]}\0${left.task_ids[1]}\0${left.type}\0${left.detail}`,
    `${right.task_ids[0]}\0${right.task_ids[1]}\0${right.type}\0${right.detail}`,
  ));
  activeConflicts.sort((left, right) => compareText(
    `${left.ready_task_id}\0${left.active_task_id}\0${left.type}\0${left.detail}`,
    `${right.ready_task_id}\0${right.active_task_id}\0${right.type}\0${right.detail}`,
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
    drift,
    active_task_ids: active,
    uncovered_active_task_ids: uncoveredActive,
    frontier: {
      parallel_groups: groups.map((task_ids) => ({ task_ids: [...task_ids].sort(compareText) }))
        .sort((left, right) => compareText(left.task_ids[0], right.task_ids[0])),
      serialize_pairs: serializePairs,
      conflicts_with_active: activeConflicts,
      unknown: [...unknownByTask.entries()]
        .map(([taskId, unknowns]) => ({ task_id: taskId, unknowns }))
        .sort((left, right) => compareText(left.task_id, right.task_id)),
    },
  };
}

export function isIndependenceIdentifier(value) {
  return isTodoIdentifier(value);
}

/**
 * revisionのtask migrationでwitness宣言のtask_idを写す（ADR 0128 Decision 6）。
 *
 * 写像だけを担い、宣言内容が改訂後も意味的に妥当かは主張しない——それは機械には判定できない。
 * 解決できないIDはfail closedにする。既に新IDになっている宣言はそのまま通す（冪等）。
 *
 * @param {object} options
 * @param {object} options.witnessSet 現在の宣言
 * @param {Array<{from_task_id: string, to_task_id: string}>} options.taskMigration
 * @param {string[]} options.planTaskIds 移行後planのtask_id集合
 */
export function migrateWitnessSetTaskIds({ witnessSet, taskMigration, planTaskIds }) {
  const mapping = new Map(taskMigration.map((entry) => [entry.from_task_id, entry.to_task_id]));
  const current = new Set(planTaskIds);
  const migrated = {};
  const unresolved = [];
  let migratedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (const taskId of Object.keys(witnessSet.manual_witness).sort(compareText)) {
    const witness = witnessSet.manual_witness[taskId];
    if (mapping.has(taskId)) {
      const target = mapping.get(taskId);
      if (target === 'removed') { removedCount += 1; continue; }
      migrated[target] = witness;
      if (target === taskId) unchangedCount += 1; else migratedCount += 1;
      continue;
    }
    // 移行表に無くても、既に現planのtaskなら再実行とみなして通す。
    if (current.has(taskId)) { migrated[taskId] = witness; unchangedCount += 1; continue; }
    unresolved.push(taskId);
  }
  if (unresolved.length > 0) {
    fail('WITNESS_MIGRATION_UNRESOLVED', 'witness_task_id_unresolved', {
      task_ids: unresolved.sort(compareText),
      next_action: 'update_witness_set_manually',
    });
  }
  if (Object.keys(migrated).length === 0) {
    fail('WITNESS_MIGRATION_EMPTY', 'witness_set_would_be_empty');
  }

  const next = { ...witnessSet, manual_witness: migrated, witness_set_digest: '' };
  next.witness_set_digest = todoSelfDigest(next, 'witness_set_digest');
  if (!validateTodoWitnessSet(next)) {
    fail('INVALID_TODO_WITNESS_SET', 'migrated_witness_set_invalid');
  }
  return {
    witnessSet: next,
    migrated_count: migratedCount,
    removed_count: removedCount,
    unchanged_count: unchangedCount,
  };
}
