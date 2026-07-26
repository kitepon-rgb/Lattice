import {
  exactRecord,
  isNonNegativeSafeInteger,
  isStrictTodoTimestamp,
  isTodoDigest,
  isTodoIdentifier,
  todoSelfDigest,
} from './todo-contracts.mjs';
import {
  RUN_REQUEST_CLAIM_MODE,
  explainRunRequest,
  selfDigest as runtimeSelfDigest,
} from './runtime-contracts.mjs';

export const TODO_WITNESS_SET_SCHEMA = 'lattice.todo_witness_set.v1';
export const TODO_INDEPENDENCE_SCHEMA = 'lattice.todo_independence.v2';
export const TODO_INDEPENDENCE_PROJECTION_SCHEMA = 'lattice.todo_independence_projection.v1';

/** boundary compileが一度に扱えるToDo数（runtime front-endのMAX_COLLECTIONと同じ閉じ方）。 */
export const TODO_INDEPENDENCE_TASK_LIMIT = 256;
export const TODO_INDEPENDENCE_LIST_LIMIT = 4_096;
export const TODO_INDEPENDENCE_COVERAGE = Object.freeze([
  'verified', 'stale', 'superseded', 'missing',
]);

/** conflictを生んだresourceの種別。切断可能性の導出はこの種別だけを根拠にする。 */
export const TODO_INDEPENDENCE_CONFLICT_KINDS = Object.freeze([
  'symbol', 'path', 'state', 'effect',
]);

/** 切断可能性。code seamで切れるのはsymbol/path起因のconflictだけ（ADR 0128 Decision 2）。 */
export const TODO_INDEPENDENCE_SEVERABILITY = Object.freeze(['code_seam', 'serial']);

/**
 * conflict kindから切断可能性を導く。
 *
 * 共有state／effectはcode seamでは切断できない（RC1 boundary compilerの分類規則と同一）。
 * read×write交差から実体化される`rw-*`はkind=stateなのでserialへ倒れる。seam候補を
 * 見逃す方向にしか外れない保守的な誤りであり、既知の限界として受け入れる。
 */
export function severabilityOfConflictKind(kind) {
  return ['symbol', 'path'].includes(kind) ? 'code_seam' : 'serial';
}

const GIT_SHA = /^[0-9a-f]{40}$/u;
const PROBE_BASE_SHA = '0'.repeat(40);

export const isGitSha = (value) => typeof value === 'string' && GIT_SHA.test(value);

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedList(value, validator, limit = TODO_INDEPENDENCE_LIST_LIMIT) {
  return Array.isArray(value) && value.length <= limit && value.every(validator);
}

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function strictlySorted(values, key = (value) => value) {
  return values.every((value, index) => index === 0 || compareText(key(values[index - 1]), key(value)) < 0);
}

function sorted(values, key = (value) => value) {
  return values.every((value, index) => index === 0 || compareText(key(values[index - 1]), key(value)) <= 0);
}

function boundedText(value, maximumBytes = 4_096) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value) <= maximumBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * witness setを、同じ宣言を持つ`lattice.run_request.v1`へ写す。
 *
 * manual witnessとsensor query setの判定正本は`explainRunRequest`だけが持つ（ADR 0123）。
 * ここで同じ規則を書き直すと契約が二箇所へ分裂するため、検証もcompileもこの合成を通す。
 * `requestId`はplan identityとwitness digestから導出され、run lifecycleへは登録されない。
 */
export function synthesizeWitnessRunRequest(witnessSet, { baseSha, requestId }) {
  const taskIds = Object.keys(witnessSet.manual_witness).sort(compareText);
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: requestId,
    repo: { base_sha: baseSha, root_kind: 'git' },
    capacity: witnessSet.capacity,
    todos: taskIds.map((taskId) => ({ todo_id: taskId })),
    manual_witness: witnessSet.manual_witness,
    sensor_query_set: witnessSet.sensor_query_set,
    executor_capability: { adapters: ['todo-independence'] },
    claim_mode: RUN_REQUEST_CLAIM_MODE,
    request_digest: '',
  };
  request.request_digest = runtimeSelfDigest(request, 'request_digest');
  return request;
}

/**
 * `lattice.todo_witness_set.v1`を検証し、拒否理由とpathを返す。
 *
 * 自分のshapeだけをここで見て、witness本体はprobe requestへ合成して
 * `explainRunRequest`へ委譲する。probeのbase_shaは検証専用の定数であり永続化しない。
 */
export function explainTodoWitnessSet(value) {
  const reject = (reason, at = '') => ({ valid: false, reason, path: at });
  try {
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'capacity', 'sensor_query_set',
      'manual_witness', 'witness_set_digest',
    ])) return reject('unexpected_or_missing_top_level_keys');
    if (value.schema !== TODO_WITNESS_SET_SCHEMA) return reject('schema_mismatch', '/schema');
    if (!isTodoIdentifier(value.project_id)) return reject('invalid_identifier', '/project_id');
    if (!isTodoIdentifier(value.plan_key)) return reject('invalid_identifier', '/plan_key');
    if (!plain(value.manual_witness)) return reject('not_an_object', '/manual_witness');
    const taskIds = Object.keys(value.manual_witness);
    if (taskIds.length < 1 || taskIds.length > TODO_INDEPENDENCE_TASK_LIMIT) {
      return reject('bounded_collection_violation', '/manual_witness');
    }
    if (!taskIds.every(isTodoIdentifier)) return reject('invalid_identifier', '/manual_witness');
    if (value.witness_set_digest !== todoSelfDigest(value, 'witness_set_digest')) {
      return reject('witness_set_digest_mismatch', '/witness_set_digest');
    }
    const probe = synthesizeWitnessRunRequest(value, {
      baseSha: PROBE_BASE_SHA, requestId: 'witness-set-probe',
    });
    const explained = explainRunRequest(probe);
    if (!explained.valid) return reject(explained.reason, explained.path);
    return { valid: true };
  } catch {
    return reject('non_canonical_witness_set_bytes');
  }
}

export function validateTodoWitnessSet(value) {
  return explainTodoWitnessSet(value).valid;
}

function conflictEntry(value) {
  return exactRecord(value, ['task_ids', 'resource_id', 'kind'])
    && Array.isArray(value.task_ids) && value.task_ids.length === 2
    && value.task_ids.every(isTodoIdentifier)
    && compareText(value.task_ids[0], value.task_ids[1]) < 0
    && boundedText(value.resource_id)
    && TODO_INDEPENDENCE_CONFLICT_KINDS.includes(value.kind);
}

/**
 * task別の宣言境界。鮮度判定をartifactとgit diffだけで閉じるために持つ（ADR 0128 Decision 4）。
 * witness setを読み直さないので、参照コストは定数のまま保たれる。
 */
function taskBoundaryEntry(value) {
  return exactRecord(value, ['task_id', 'paths'])
    && isTodoIdentifier(value.task_id)
    && Array.isArray(value.paths) && value.paths.length <= TODO_INDEPENDENCE_LIST_LIMIT
    && value.paths.every((path) => boundedText(path)) && strictlySorted(value.paths);
}

function precedenceEntry(value) {
  return exactRecord(value, ['from_task_id', 'to_task_id', 'reason'])
    && isTodoIdentifier(value.from_task_id) && isTodoIdentifier(value.to_task_id)
    && value.from_task_id !== value.to_task_id && boundedText(value.reason);
}

function unknownEntry(value) {
  return exactRecord(value, ['task_id', 'kind', 'ref'])
    && isTodoIdentifier(value.task_id) && isTodoIdentifier(value.kind) && boundedText(value.ref);
}

function waveEntry(value) {
  return exactRecord(value, ['task_ids'])
    && Array.isArray(value.task_ids) && value.task_ids.length >= 1
    && value.task_ids.length <= TODO_INDEPENDENCE_TASK_LIMIT
    && value.task_ids.every(isTodoIdentifier) && strictlySorted(value.task_ids);
}

function wavePlan(value, taskIds) {
  if (value === null) return true;
  if (!exactRecord(value, ['waves', 'minimum_feasible_waves'])
    || !boundedList(value.waves, waveEntry, TODO_INDEPENDENCE_TASK_LIMIT)
    || !isNonNegativeSafeInteger(value.minimum_feasible_waves)
    || value.waves.length !== value.minimum_feasible_waves) return false;
  const scheduled = value.waves.flatMap((wave) => wave.task_ids).sort(compareText);
  return scheduled.length === taskIds.length
    && scheduled.every((taskId, index) => taskId === taskIds[index]);
}

/**
 * `lattice.todo_independence.v2`。
 *
 * conflict／precedence／unknownはnormalized boundary graphから採る（ADR 0127 Decision 4）。
 * conflictはresource kindを併せて持ち、切断可能性の導出を投影側に許す（ADR 0128 Decision 1）。
 * `task_boundaries`はtask別の宣言境界で、鮮度のdiff交差判定をartifactだけで閉じるために持つ。
 * `wave_plan`はschedulability compileが`compiled`を返した時だけ持ち、unknownが残る間はnullになる。
 * verdictに現れないペアをverified独立と読めるのは、両taskにunknownが無いときだけである。
 */
export function validateTodoIndependence(value) {
  try {
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'topology_digest', 'base_sha',
      'witness_set_digest', 'compiled_at', 'task_ids', 'task_boundaries', 'conflicts',
      'precedences', 'unknowns', 'wave_plan', 'outcome', 'result_digest',
    ])) return false;
    if (value.schema !== TODO_INDEPENDENCE_SCHEMA) return false;
    if (!isTodoIdentifier(value.project_id) || !isTodoIdentifier(value.plan_key)
      || !isTodoIdentifier(value.plan_version)) return false;
    if (!isTodoDigest(value.topology_digest) || !isGitSha(value.base_sha)
      || !isTodoDigest(value.witness_set_digest)
      || !isStrictTodoTimestamp(value.compiled_at)) return false;
    if (!Array.isArray(value.task_ids) || value.task_ids.length < 1
      || value.task_ids.length > TODO_INDEPENDENCE_TASK_LIMIT
      || !value.task_ids.every(isTodoIdentifier) || !strictlySorted(value.task_ids)) return false;
    const known = new Set(value.task_ids);
    // 宣言境界はcompile対象taskとちょうど一対一で対応する。欠けたtaskがあると、
    // そのtaskだけ交差判定ができないのに全体はverifiedを名乗れてしまう。
    if (!boundedList(value.task_boundaries, taskBoundaryEntry, TODO_INDEPENDENCE_TASK_LIMIT)
      || value.task_boundaries.length !== value.task_ids.length
      || !strictlySorted(value.task_boundaries, (entry) => entry.task_id)
      || !value.task_boundaries.every((entry, index) => entry.task_id === value.task_ids[index])) {
      return false;
    }
    if (!boundedList(value.conflicts, conflictEntry)
      || !value.conflicts.every((entry) => entry.task_ids.every((taskId) => known.has(taskId)))
      || !strictlySorted(value.conflicts, (entry) => (
        `${entry.task_ids[0]}\0${entry.task_ids[1]}\0${entry.resource_id}`))) return false;
    if (!boundedList(value.precedences, precedenceEntry)
      || !value.precedences.every((entry) => known.has(entry.from_task_id) && known.has(entry.to_task_id))
      || !strictlySorted(value.precedences, (entry) => (
        `${entry.from_task_id}\0${entry.to_task_id}\0${entry.reason}`))) return false;
    if (!boundedList(value.unknowns, unknownEntry)
      || !value.unknowns.every((entry) => known.has(entry.task_id))
      || !sorted(value.unknowns, (entry) => (
        `${entry.task_id}\0${entry.kind}\0${entry.ref}`))) return false;
    if (!['compiled', 'unknown'].includes(value.outcome)) return false;
    // unknownが残る限りwave planは主張しない。compiledならunknownは空でなければならない。
    if (value.outcome === 'compiled' && value.unknowns.length > 0) return false;
    if (value.outcome === 'unknown' && value.wave_plan !== null) return false;
    if (!wavePlan(value.wave_plan, value.task_ids)) return false;
    return isTodoDigest(value.result_digest)
      && value.result_digest === todoSelfDigest(value, 'result_digest');
  } catch {
    return false;
  }
}

function groupEntry(value) {
  return exactRecord(value, ['task_ids'])
    && Array.isArray(value.task_ids) && value.task_ids.length >= 1
    && value.task_ids.length <= TODO_INDEPENDENCE_TASK_LIMIT
    && value.task_ids.every(isTodoIdentifier) && strictlySorted(value.task_ids);
}

function serializeEntry(value) {
  return exactRecord(value, ['task_ids', 'type', 'detail'])
    && Array.isArray(value.task_ids) && value.task_ids.length === 2
    && value.task_ids.every(isTodoIdentifier)
    && compareText(value.task_ids[0], value.task_ids[1]) < 0
    && ['conflict', 'precedence'].includes(value.type) && boundedText(value.detail);
}

function unknownTaskEntry(value) {
  return exactRecord(value, ['task_id', 'unknowns'])
    && isTodoIdentifier(value.task_id)
    && Array.isArray(value.unknowns) && value.unknowns.length >= 1
    && value.unknowns.length <= TODO_INDEPENDENCE_LIST_LIMIT
    && value.unknowns.every((entry) => exactRecord(entry, ['kind', 'ref'])
      && isTodoIdentifier(entry.kind) && boundedText(entry.ref));
}

/**
 * `lattice.todo_independence_projection.v1`。
 *
 * ready frontierを「検証済み並列グループ」「直列化すべき組」「未検査」へ分けた読み出し面。
 * `todo_status_result.v4`と`dispatch_frontier`は変更せず、加算の別面として持つ（ADR 0124の規律）。
 */
export function validateTodoIndependenceProjection(value) {
  try {
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'coverage', 'compiled_base_sha', 'current_base_sha',
      'plan_version', 'topology_digest', 'frontier', 'result_digest',
    ])) return false;
    if (value.schema !== TODO_INDEPENDENCE_PROJECTION_SCHEMA) return false;
    if (!isTodoIdentifier(value.project_id)) return false;
    if (value.plan_key !== null && !isTodoIdentifier(value.plan_key)) return false;
    if (!TODO_INDEPENDENCE_COVERAGE.includes(value.coverage)) return false;
    if (value.compiled_base_sha !== null && !isGitSha(value.compiled_base_sha)) return false;
    if (!isGitSha(value.current_base_sha)) return false;
    if (value.plan_version !== null && !isTodoIdentifier(value.plan_version)) return false;
    if (value.topology_digest !== null && !isTodoDigest(value.topology_digest)) return false;
    // 記録が無い状態でcompile済みidentityを名乗らない。
    if (value.coverage === 'missing'
      && (value.compiled_base_sha !== null || value.topology_digest !== null)) return false;
    if (value.coverage !== 'missing' && value.compiled_base_sha === null) return false;
    if (!exactRecord(value.frontier, ['parallel_groups', 'serialize_pairs', 'unknown'])) return false;
    if (!boundedList(value.frontier.parallel_groups, groupEntry, TODO_INDEPENDENCE_TASK_LIMIT)
      || !strictlySorted(value.frontier.parallel_groups, (entry) => entry.task_ids[0])) return false;
    if (!boundedList(value.frontier.serialize_pairs, serializeEntry)
      || !strictlySorted(value.frontier.serialize_pairs, (entry) => (
        `${entry.task_ids[0]}\0${entry.task_ids[1]}\0${entry.type}\0${entry.detail}`))) return false;
    if (!boundedList(value.frontier.unknown, unknownTaskEntry, TODO_INDEPENDENCE_TASK_LIMIT)
      || !strictlySorted(value.frontier.unknown, (entry) => entry.task_id)) return false;
    return isTodoDigest(value.result_digest)
      && value.result_digest === todoSelfDigest(value, 'result_digest');
  } catch {
    return false;
  }
}
