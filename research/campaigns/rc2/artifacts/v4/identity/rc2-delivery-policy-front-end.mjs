import { createHash } from 'node:crypto';

import {
  digestArtifact,
  validatePlanInput,
} from './artifact-contracts.mjs';
import { compileBoundaryObservationV2 } from './boundary-observation-compiler-v2.mjs';

const INPUT_KEYS = [
  'planInput',
  'candidateSpec',
  'manualEvidence',
  'querySet',
  'sourceSnapshot',
  'codegraphEvidence',
];
const EXPECTED_CANDIDATE_ID = 'shard-delivery-policy-registry-by-channel';
const EXPECTED_ORACLE_DIGEST_BY_CANDIDATE_DIGEST = Object.freeze({
  '30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5':
    'c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe',
  '4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907':
    'c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c',
});
const ORACLE_RUNNER = 'runRc2DeliveryPolicyOracle';
const QUERY_OPERATIONS = new Set([
  'status',
  'query',
  'callers',
  'callees',
  'impact',
  'affected',
]);
const CODEGRAPH_OUTCOMES = new Set([
  'ready',
  'symbol_absent',
  'empty',
  'unresolved',
  'command_failure',
  'invalid_json',
  'stale',
  'unsupported',
]);
const DIGEST = /^[0-9a-f]{64}$/;

function fail(reason) {
  throw new TypeError(`delivery policy front-end契約違反: ${reason}`);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requireArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label}がarrayではない`);
  }
}

function boundedText(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, 'utf8') <= 4_096;
}

function uniqueBoundedStrings(value, label) {
  requireArray(value, label);
  if (!value.every(boundedText) || new Set(value).size !== value.length) {
    fail(`${label}がunique bounded string arrayではない`);
  }
  return [...value];
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameStringSet(left, right) {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((entry) => right.includes(entry));
}

function resourceKey(kind, target) {
  return `${kind}\u0000${target}`;
}

function resourceId(kind, target) {
  const digest = createHash('sha256').update(resourceKey(kind, target)).digest('hex');
  return `rc2-${kind}-${digest.slice(0, 20)}`;
}

function queryMapFor(querySet) {
  if (!exactRecord(querySet, ['schema', 'queries'])
    || querySet.schema !== 'lattice.codegraph_query_set.v2') {
    fail('query set shapeまたはschemaが不正');
  }
  requireArray(querySet.queries, 'querySet.queries');
  const byId = new Map();
  for (const query of querySet.queries) {
    if (!plainRecord(query)
      || !boundedText(query.id)
      || !QUERY_OPERATIONS.has(query.operation)
      || byId.has(query.id)) {
      fail('query set entryが不正または重複している');
    }
    if (query.operation === 'status') {
      if (!exactRecord(query, ['id', 'operation'])) fail(`query ${query.id} shapeが不正`);
    } else if (query.operation === 'affected') {
      if (!exactRecord(query, ['id', 'operation', 'targets'])) {
        fail(`query ${query.id} shapeが不正`);
      }
      uniqueBoundedStrings(query.targets, `query ${query.id}.targets`);
    } else if (!exactRecord(query, ['id', 'operation', 'target'])
      || !boundedText(query.target)) {
      fail(`query ${query.id} shapeが不正`);
    }
    byId.set(query.id, query);
  }
  if (byId.size < 1) fail('query setが空である');
  return byId;
}

function collectQueryReferences(value, references = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectQueryReferences(entry, references));
    return references;
  }
  if (!plainRecord(value)) return references;
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'query_id' || key === 'impact_id' || key.endsWith('_query_id'))
      && typeof entry === 'string') {
      references.add(entry);
    }
    collectQueryReferences(entry, references);
  }
  return references;
}

function expectQuery(queryById, id, operation, target, label) {
  const query = queryById.get(id);
  if (!query
    || query.operation !== operation
    || (operation !== 'status'
      && operation !== 'affected'
      && query.target !== target)) {
    fail(`${label}のquery bindingが不正`);
  }
  return query;
}

function surfaceQueryIds(surface) {
  return [
    surface.query_id,
    surface.callers_query_id,
    surface.callees_query_id,
    surface.impact_id,
    surface.composition_link_query_id,
  ].filter((entry) => entry !== undefined);
}

function validateSurfaceShape(surface, label, { proposedProduction = false } = {}) {
  const basicKeys = ['symbol', 'path', 'query_id', 'impact_id'];
  const linkedKeys = [...basicKeys, 'callers_query_id', 'callees_query_id'];
  const productionKeys = proposedProduction
    ? [...linkedKeys, 'composition_link_query_id']
    : linkedKeys;
  if ((!exactRecord(surface, basicKeys)
      && !exactRecord(surface, linkedKeys)
      && !exactRecord(surface, productionKeys))
    || (surface.symbol !== null && !boundedText(surface.symbol))
    || !boundedText(surface.path)
    || !boundedText(surface.query_id)
    || !boundedText(surface.impact_id)) {
    fail(`${label} surface shapeが不正`);
  }
  for (const id of surfaceQueryIds(surface)) {
    if (!boundedText(id)) fail(`${label} query referenceが不正`);
  }
}

function validateSurfaceQueries(surface, queryById, label, fixedOracle) {
  const target = surface.symbol ?? surface.path;
  expectQuery(queryById, surface.query_id, 'query', target, `${label}.query_id`);
  expectQuery(queryById, surface.impact_id, 'impact', target, `${label}.impact_id`);
  if (surface.callers_query_id !== undefined) {
    expectQuery(
      queryById,
      surface.callers_query_id,
      'callers',
      fixedOracle ? ORACLE_RUNNER : target,
      `${label}.callers_query_id`,
    );
  }
  if (surface.callees_query_id !== undefined) {
    expectQuery(
      queryById,
      surface.callees_query_id,
      'callees',
      fixedOracle ? ORACLE_RUNNER : target,
      `${label}.callees_query_id`,
    );
  }
  if (surface.composition_link_query_id !== undefined) {
    expectQuery(
      queryById,
      surface.composition_link_query_id,
      'callees',
      'resolveDeliveryPolicy',
      `${label}.composition_link_query_id`,
    );
  }
}

function validateCandidateSpec(candidateSpec, queryById) {
  if (!exactRecord(candidateSpec, [
    'schema',
    'candidate_id',
    'plan_input_ref',
    'query_set_ref',
    'compiler_contract',
    'fixed_oracle',
    'stable_surfaces',
    'todos',
  ])
    || candidateSpec.schema !== 'lattice.rc2.boundary_candidate_spec.v1'
    || candidateSpec.candidate_id !== EXPECTED_CANDIDATE_ID) {
    fail('candidate spec identityまたはshapeが不正');
  }
  const candidateDigest = digestArtifact(candidateSpec);
  const expectedOracleDigest = EXPECTED_ORACLE_DIGEST_BY_CANDIDATE_DIGEST[candidateDigest];
  if (expectedOracleDigest === undefined) {
    fail('candidate specがaccepted RC2 witnessと一致しない');
  }
  if (!exactRecord(candidateSpec.compiler_contract, [
    'condition_selector',
    'surface_resolution',
    'unresolved_policy',
    'status_query_id',
    'affected_query_id',
  ])
    || candidateSpec.compiler_contract.condition_selector !== 'forbidden'
    || candidateSpec.compiler_contract.surface_resolution !== 'exact_name_path_and_link'
    || candidateSpec.compiler_contract.unresolved_policy !== 'typed_unknown') {
    fail('candidate compiler contractが不正');
  }
  expectQuery(
    queryById,
    candidateSpec.compiler_contract.status_query_id,
    'status',
    undefined,
    'candidate compiler status',
  );
  const affected = queryById.get(candidateSpec.compiler_contract.affected_query_id);
  if (!affected || affected.operation !== 'affected') {
    fail('candidate compiler affected query bindingが不正');
  }

  if (!exactRecord(candidateSpec.fixed_oracle, [
    'path',
    'source_digest',
    'case_ids',
    'path_query_id',
    'runner_query_id',
    'callers_query_id',
    'callees_query_id',
    'impact_id',
  ])
    || !boundedText(candidateSpec.fixed_oracle.path)
    || candidateSpec.fixed_oracle.source_digest !== expectedOracleDigest) {
    fail('candidate fixed oracle identityが不正');
  }
  uniqueBoundedStrings(candidateSpec.fixed_oracle.case_ids, 'fixed_oracle.case_ids');
  expectQuery(
    queryById,
    candidateSpec.fixed_oracle.path_query_id,
    'query',
    candidateSpec.fixed_oracle.path,
    'fixed oracle path',
  );
  expectQuery(
    queryById,
    candidateSpec.fixed_oracle.runner_query_id,
    'query',
    ORACLE_RUNNER,
    'fixed oracle runner',
  );
  expectQuery(
    queryById,
    candidateSpec.fixed_oracle.callers_query_id,
    'callers',
    ORACLE_RUNNER,
    'fixed oracle callers',
  );
  expectQuery(
    queryById,
    candidateSpec.fixed_oracle.callees_query_id,
    'callees',
    ORACLE_RUNNER,
    'fixed oracle callees',
  );
  expectQuery(
    queryById,
    candidateSpec.fixed_oracle.impact_id,
    'impact',
    candidateSpec.fixed_oracle.path,
    'fixed oracle impact',
  );

  requireArray(candidateSpec.stable_surfaces, 'candidateSpec.stable_surfaces');
  if (candidateSpec.stable_surfaces.length !== 3) fail('stable surface件数が不正');
  const stableRoles = new Set();
  for (const surface of candidateSpec.stable_surfaces) {
    if (!exactRecord(surface, [
      'kind',
      'target',
      'path',
      'role',
      'active_when',
      'query_id',
      'callers_query_id',
      'callees_query_id',
      'impact_id',
    ])
      || !new Set(['symbol', 'path']).has(surface.kind)
      || !boundedText(surface.target)
      || !boundedText(surface.path)
      || !new Set(['proposed', 'always']).has(surface.active_when)
      || stableRoles.has(surface.role)) {
      fail('stable surface shapeまたはroleが不正');
    }
    stableRoles.add(surface.role);
    const fixedOracle = surface.role === 'fixed-oracle';
    expectQuery(queryById, surface.query_id, 'query', surface.target, `${surface.role}.query`);
    expectQuery(
      queryById,
      surface.callers_query_id,
      'callers',
      fixedOracle ? ORACLE_RUNNER : surface.target,
      `${surface.role}.callers`,
    );
    expectQuery(
      queryById,
      surface.callees_query_id,
      'callees',
      fixedOracle ? ORACLE_RUNNER : surface.target,
      `${surface.role}.callees`,
    );
    expectQuery(queryById, surface.impact_id, 'impact', surface.target, `${surface.role}.impact`);
  }
  if (!sameStringSet(
    [...stableRoles],
    ['composition-entry', 'composition-test', 'fixed-oracle'],
  )) {
    fail('stable surface role集合が不正');
  }

  requireArray(candidateSpec.todos, 'candidateSpec.todos');
  if (candidateSpec.todos.length !== 3) fail('candidate TODO件数が不正');
  const todoIds = new Set();
  const caseIds = [];
  for (const candidateTodo of candidateSpec.todos) {
    if (!exactRecord(candidateTodo, [
      'todo_id',
      'outcome',
      'case_ids',
      'current',
      'proposed',
    ])
      || !boundedText(candidateTodo.todo_id)
      || !boundedText(candidateTodo.outcome)
      || todoIds.has(candidateTodo.todo_id)) {
      fail('candidate TODO shapeまたはIDが不正');
    }
    todoIds.add(candidateTodo.todo_id);
    caseIds.push(...uniqueBoundedStrings(candidateTodo.case_ids, `${candidateTodo.todo_id}.case_ids`));
    for (const mode of ['current', 'proposed']) {
      const modeSpec = candidateTodo[mode];
      if (!exactRecord(modeSpec, ['production', 'tests'])) {
        fail(`${candidateTodo.todo_id}/${mode} shapeが不正`);
      }
      validateSurfaceShape(
        modeSpec.production,
        `${candidateTodo.todo_id}/${mode}/production`,
        { proposedProduction: mode === 'proposed' },
      );
      requireArray(modeSpec.tests, `${candidateTodo.todo_id}/${mode}.tests`);
      const expectedTests = mode === 'current' ? 2 : 1;
      if (modeSpec.tests.length !== expectedTests) {
        fail(`${candidateTodo.todo_id}/${mode} test surface件数が不正`);
      }
      modeSpec.tests.forEach((surface, index) => {
        validateSurfaceShape(surface, `${candidateTodo.todo_id}/${mode}/tests/${index}`);
      });
      validateSurfaceQueries(
        modeSpec.production,
        queryById,
        `${candidateTodo.todo_id}/${mode}/production`,
        false,
      );
      modeSpec.tests.forEach((surface, index) => validateSurfaceQueries(
        surface,
        queryById,
        `${candidateTodo.todo_id}/${mode}/tests/${index}`,
        surface.path === candidateSpec.fixed_oracle.path,
      ));
    }
  }
  if (new Set(caseIds).size !== caseIds.length
    || !sameStringSet(caseIds, candidateSpec.fixed_oracle.case_ids)) {
    fail('candidate case IDがfixed oracleのexact partitionではない');
  }

  const queryReferences = [...collectQueryReferences(candidateSpec)];
  if (!sameStringSet(queryReferences, [...queryById.keys()])) {
    fail('candidate query referenceとquery setがexact／exhaustiveではない');
  }
  return candidateDigest;
}

function manualEvidenceByTodo(manualEvidence) {
  if (!exactRecord(manualEvidence, ['schema', 'evidence'])
    || manualEvidence.schema !== 'lattice.manual_boundary_evidence.v1') {
    fail('manual evidence shapeまたはschemaが不正');
  }
  requireArray(manualEvidence.evidence, 'manualEvidence.evidence');
  const byTodo = new Map();
  for (const entry of manualEvidence.evidence) {
    if (!exactRecord(entry, [
      'todo_id',
      'state_reads',
      'state_writes',
      'effects',
      'unknowns',
    ])
      || !boundedText(entry.todo_id)
      || byTodo.has(entry.todo_id)) {
      fail('manual evidence entryが不正またはTODO重複している');
    }
    uniqueBoundedStrings(entry.state_reads, `${entry.todo_id}.state_reads`);
    uniqueBoundedStrings(entry.state_writes, `${entry.todo_id}.state_writes`);
    uniqueBoundedStrings(entry.effects, `${entry.todo_id}.effects`);
    uniqueBoundedStrings(entry.unknowns, `${entry.todo_id}.unknowns`);
    if (entry.state_reads.length > 0) {
      fail('manual state_readsをwrite conflictへ損失変換できない');
    }
    byTodo.set(entry.todo_id, entry);
  }
  if (byTodo.size < 1) fail('manual evidenceが空である');
  return byTodo;
}

function assertTodoBindings(planInput, candidateSpec, manualByTodo) {
  const planIds = planInput.todos.map(({ id }) => id);
  const candidateIds = candidateSpec.todos.map(({ todo_id: todoId }) => todoId);
  const manualIds = [...manualByTodo.keys()];
  if (!sameStringSet(planIds, candidateIds) || !sameStringSet(planIds, manualIds)) {
    fail('plan/candidate/manualのTODO集合が一致しない');
  }
  if (planInput.query_set_ref !== candidateSpec.query_set_ref
    || planInput.project.fixture_entry !== candidateSpec.todos[0].current.production.path) {
    fail('plan inputがcandidate fixture／query setへbindしていない');
  }
  const planByTodo = new Map(planInput.todos.map((todo) => [todo.id, todo]));
  for (const candidateTodo of candidateSpec.todos) {
    const planTodo = planByTodo.get(candidateTodo.todo_id);
    if (planTodo.outcome !== candidateTodo.outcome
      || planTodo.anchor.symbol !== candidateTodo.current.production.symbol
      || planTodo.anchor.path !== candidateTodo.current.production.path) {
      fail(`candidate ${candidateTodo.todo_id}がplan TODOへbindしていない`);
    }
  }
}

function candidatePaths(candidateSpec) {
  const current = new Set([candidateSpec.fixed_oracle.path]);
  const all = new Set([candidateSpec.fixed_oracle.path]);
  for (const candidateTodo of candidateSpec.todos) {
    current.add(candidateTodo.current.production.path);
    all.add(candidateTodo.current.production.path);
    for (const testSurface of candidateTodo.current.tests) {
      current.add(testSurface.path);
      all.add(testSurface.path);
    }
    all.add(candidateTodo.proposed.production.path);
    for (const testSurface of candidateTodo.proposed.tests) all.add(testSurface.path);
  }
  for (const stable of candidateSpec.stable_surfaces) all.add(stable.path);
  return {
    current: [...current].sort(compareText),
    all: [...all].sort(compareText),
  };
}

function validateSourceSnapshot(sourceSnapshot, candidateSpec) {
  if (!exactRecord(sourceSnapshot, ['schema_version', 'files'])
    || sourceSnapshot.schema_version !== 'lattice.rc2.source_snapshot.v1') {
    fail('sourceSnapshot shapeまたはschemaが不正');
  }
  requireArray(sourceSnapshot.files, 'sourceSnapshot.files');
  const paths = candidatePaths(candidateSpec);
  if (sourceSnapshot.files.length !== paths.all.length) {
    fail('sourceSnapshot path件数がcandidateと一致しない');
  }
  const byPath = new Map();
  for (const file of sourceSnapshot.files) {
    if (!exactRecord(file, ['path', 'state', 'content_digest'])
      || !boundedText(file.path)
      || !new Set(['file', 'absent']).has(file.state)
      || (file.state === 'file' && (typeof file.content_digest !== 'string'
        || !DIGEST.test(file.content_digest)))
      || (file.state === 'absent' && file.content_digest !== null)
      || byPath.has(file.path)) {
      fail('sourceSnapshot file entryが不正または重複している');
    }
    byPath.set(file.path, file);
  }
  if (!sameStringSet([...byPath.keys()], paths.all)) {
    fail('sourceSnapshot path集合がcandidate exact surfaceと一致しない');
  }
  const oracle = byPath.get(candidateSpec.fixed_oracle.path);
  if (oracle.state !== 'file'
    || oracle.content_digest !== candidateSpec.fixed_oracle.source_digest) {
    fail('sourceSnapshot fixed oracle digestがcandidateと一致しない');
  }
  const present = [...byPath.values()]
    .filter(({ state }) => state === 'file')
    .map(({ path }) => path)
    .sort(compareText);
  if (sameStringSet(present, paths.current)) {
    return { topology: 'current', filesByPath: byPath, paths };
  }
  if (sameStringSet(present, paths.all)) {
    return { topology: 'proposed', filesByPath: byPath, paths };
  }
  fail('sourceSnapshotがcurrent／proposed exact topologyのどちらでもない');
}

function validatePortableOutcomeShape(outcome, query) {
  if (!plainRecord(outcome)
    || outcome.id !== query.id
    || outcome.operation !== query.operation
    || !CODEGRAPH_OUTCOMES.has(outcome.outcome)) {
    fail(`portable outcome ${query.id} identityが不正`);
  }
  if (query.operation === 'status') {
    if (outcome.outcome !== 'ready'
      || !exactRecord(outcome, ['id', 'operation', 'outcome', 'data'])
      || !plainRecord(outcome.data)) {
      fail('portable statusがready preimageではない');
    }
    return;
  }
  if (query.operation === 'affected') {
    if (!exactRecord(outcome, ['id', 'operation', 'outcome', 'targets'])) {
      fail('portable affected shapeが不正');
    }
    requireArray(outcome.targets, `portable ${query.id}.targets`);
    return;
  }
  if (outcome.target !== query.target) {
    fail(`portable outcome ${query.id} targetがqueryと一致しない`);
  }
  if (outcome.outcome === 'ready') {
    const keys = query.operation === 'query'
      ? ['id', 'operation', 'target', 'outcome', 'data']
      : ['id', 'operation', 'target', 'outcome', 'data', 'resolution'];
    if (!exactRecord(outcome, keys)) fail(`portable ready outcome ${query.id} shapeが不正`);
    if (query.operation === 'query') requireArray(outcome.data, `${query.id}.data`);
    else {
      if (!plainRecord(outcome.data)) fail(`${query.id}.dataがrecordではない`);
      requireArray(outcome.resolution, `${query.id}.resolution`);
    }
    return;
  }
  if (outcome.outcome === 'symbol_absent') {
    const keys = query.operation === 'query'
      ? ['id', 'operation', 'target', 'outcome', 'data']
      : ['id', 'operation', 'target', 'outcome'];
    if (!exactRecord(outcome, keys)
      || (query.operation === 'query' && (!Array.isArray(outcome.data)
        || outcome.data.length !== 0))) {
      fail(`portable symbol_absent outcome ${query.id} shapeが不正`);
    }
  }
}

function assertFreshStatus(statusOutcome) {
  const status = statusOutcome.data;
  if (status.initialized !== true
    || !exactRecord(status.pendingChanges, ['added', 'modified', 'removed'])
    || Object.values(status.pendingChanges).some((value) => value !== 0)
    || status.worktreeMismatch !== null
    || !plainRecord(status.index)
    || status.index.state !== 'complete'
    || status.index.pendingRefs !== 0
    || status.index.reindexRecommended !== false) {
    fail('portable Codegraph statusがfresh／completeではない');
  }
}

function validateAffectedOutcome(outcome, query, filesByPath) {
  if (outcome.targets.length !== query.targets.length) {
    fail('portable affected target件数がqueryと一致しない');
  }
  for (let index = 0; index < query.targets.length; index += 1) {
    const target = query.targets[index];
    const result = outcome.targets[index];
    const present = filesByPath.get(target)?.state === 'file';
    if (!exactRecord(result, ['target', 'outcome', 'data'])
      || result.target !== target
      || result.outcome !== (present ? 'ready' : 'empty')
      || !plainRecord(result.data)
      || !Array.isArray(result.data.changedFiles)
      || !sameStringSet(result.data.changedFiles, [target])
      || !Array.isArray(result.data.affectedTests)
      || (present && result.data.affectedTests.length < 1)
      || (!present && result.data.affectedTests.length !== 0)) {
      fail(`portable affected ${target}がsnapshot存在状態へbindしていない`);
    }
  }
  const expected = outcome.targets.every(({ outcome: status }) => status === 'ready')
    ? 'ready'
    : 'unresolved';
  if (outcome.outcome !== expected) {
    fail('portable affected aggregate outcomeがtarget outcomesと一致しない');
  }
}

function validatePortableEvidence({
  codegraphEvidence,
  querySet,
  queryById,
  candidateSpec,
  filesByPath,
}) {
  if (!exactRecord(codegraphEvidence, [
    'schema',
    'projection',
    'query_set_digest',
    'outcomes',
    'per_query',
    'aggregate_digest',
  ])
    || codegraphEvidence.schema !== 'lattice.codegraph_portable_preimage.v1'
    || codegraphEvidence.projection !== 'lattice.codegraph_portable_outcome.v1'
    || codegraphEvidence.query_set_digest !== digestArtifact(querySet)) {
    fail('portable evidence identity／query bindingが不正');
  }
  requireArray(codegraphEvidence.outcomes, 'portable.outcomes');
  requireArray(codegraphEvidence.per_query, 'portable.per_query');
  if (codegraphEvidence.outcomes.length !== querySet.queries.length
    || codegraphEvidence.per_query.length !== querySet.queries.length) {
    fail('portable outcome件数がquery setと一致しない');
  }
  const byId = new Map();
  for (let index = 0; index < querySet.queries.length; index += 1) {
    const query = querySet.queries[index];
    const outcome = codegraphEvidence.outcomes[index];
    const receipt = codegraphEvidence.per_query[index];
    validatePortableOutcomeShape(outcome, query);
    if (!exactRecord(receipt, ['id', 'operation', 'outcome', 'result_digest'])
      || receipt.id !== query.id
      || receipt.operation !== query.operation
      || receipt.outcome !== outcome.outcome
      || receipt.result_digest !== digestArtifact(outcome)) {
      fail(`portable per-query digest ${query.id}がoutcomeと一致しない`);
    }
    byId.set(query.id, outcome);
  }
  const aggregatePreimage = {
    projection: codegraphEvidence.projection,
    query_set_digest: codegraphEvidence.query_set_digest,
    outcomes: codegraphEvidence.outcomes,
  };
  if (!DIGEST.test(codegraphEvidence.aggregate_digest)
    || codegraphEvidence.aggregate_digest !== digestArtifact(aggregatePreimage)) {
    fail('portable aggregate digestがfull preimageから再計算できない');
  }
  assertFreshStatus(byId.get(candidateSpec.compiler_contract.status_query_id));
  const affectedQuery = queryById.get(candidateSpec.compiler_contract.affected_query_id);
  validateAffectedOutcome(
    byId.get(candidateSpec.compiler_contract.affected_query_id),
    affectedQuery,
    filesByPath,
  );
  return byId;
}

function isExactNodeCandidate(entry, target, path) {
  const node = entry?.node;
  if (!plainRecord(node) || node.filePath !== path) return false;
  if (target.includes('/')) return node.qualifiedName === target;
  return node.name === target || node.qualifiedName === target;
}

function assertReadyQuery(outcomeById, id, target, path, label) {
  const outcome = outcomeById.get(id);
  if (!outcome || outcome.outcome !== 'ready' || outcome.operation !== 'query') {
    fail(`${label} queryがreadyではない`);
  }
  const exact = outcome.data.filter((entry) => isExactNodeCandidate(entry, target, path));
  if (exact.length !== 1) fail(`${label} exact name/path resolutionが一意でない`);
}

function assertReadyResolution(outcomeById, id, target, path, operation, label) {
  const outcome = outcomeById.get(id);
  if (!outcome || outcome.outcome !== 'ready' || outcome.operation !== operation) {
    fail(`${label} ${operation}がreadyではない`);
  }
  const exact = outcome.resolution.filter((entry) => isExactNodeCandidate(entry, target, path));
  if (exact.length !== 1) fail(`${label} ${operation} exact resolutionが一意でない`);
}

function assertSurfaceReady(outcomeById, surface, label, fixedOracle = false) {
  const target = surface.symbol ?? surface.path;
  assertReadyQuery(outcomeById, surface.query_id, target, surface.path, label);
  assertReadyResolution(
    outcomeById,
    surface.impact_id,
    target,
    surface.path,
    'impact',
    label,
  );
  if (surface.callers_query_id !== undefined) {
    assertReadyResolution(
      outcomeById,
      surface.callers_query_id,
      fixedOracle ? ORACLE_RUNNER : target,
      surface.path,
      'callers',
      label,
    );
  }
  if (surface.callees_query_id !== undefined) {
    assertReadyResolution(
      outcomeById,
      surface.callees_query_id,
      fixedOracle ? ORACLE_RUNNER : target,
      surface.path,
      'callees',
      label,
    );
  }
}

function containsExactSummary(entries, target, path) {
  return Array.isArray(entries)
    && entries.some((entry) => plainRecord(entry)
      && entry.name === target
      && entry.filePath === path);
}

function assertCalleeLink(outcomeById, queryId, target, path, label) {
  const outcome = outcomeById.get(queryId);
  if (!outcome
    || outcome.outcome !== 'ready'
    || outcome.operation !== 'callees'
    || !containsExactSummary(outcome.data?.callees, target, path)) {
    fail(`${label} exact callee linkが観測されない`);
  }
}

function stableByRole(candidateSpec, role) {
  return candidateSpec.stable_surfaces.find((surface) => surface.role === role);
}

function assertActivation(candidateSpec, topology, outcomeById, queryById) {
  const fixed = candidateSpec.fixed_oracle;
  const fixedSurface = {
    symbol: null,
    path: fixed.path,
    query_id: fixed.path_query_id,
    callers_query_id: fixed.callers_query_id,
    callees_query_id: fixed.callees_query_id,
    impact_id: fixed.impact_id,
  };
  assertSurfaceReady(outcomeById, fixedSurface, 'fixed oracle', true);
  assertReadyQuery(outcomeById, fixed.runner_query_id, ORACLE_RUNNER, fixed.path, 'fixed oracle runner');

  if (topology === 'current') {
    const inactive = new Set();
    for (const candidateTodo of candidateSpec.todos) {
      assertSurfaceReady(
        outcomeById,
        candidateTodo.current.production,
        `${candidateTodo.todo_id}/current/production`,
      );
      candidateTodo.current.tests.forEach((surface, index) => assertSurfaceReady(
        outcomeById,
        surface,
        `${candidateTodo.todo_id}/current/tests/${index}`,
        surface.path === fixed.path,
      ));
      const proposed = candidateTodo.proposed;
      [proposed.production, ...proposed.tests].forEach((surface) => {
        surfaceQueryIds(surface)
          .filter((id) => id !== proposed.production.composition_link_query_id)
          .forEach((id) => inactive.add(id));
      });
    }
    const compositionTest = stableByRole(candidateSpec, 'composition-test');
    surfaceQueryIds(compositionTest).forEach((id) => inactive.add(id));
    for (const id of inactive) {
      const outcome = outcomeById.get(id);
      if (!outcome || outcome.outcome !== 'symbol_absent') {
        fail(`current topologyのinactive proposed query ${id}がsymbol_absentではない`);
      }
    }
    return;
  }

  for (const query of queryById.values()) {
    if (query.operation === 'status' || query.operation === 'affected') continue;
    if (outcomeById.get(query.id)?.outcome !== 'ready') {
      fail(`proposed topologyのquery ${query.id}がreadyではない`);
    }
  }
  const compositionEntry = stableByRole(candidateSpec, 'composition-entry');
  const compositionTest = stableByRole(candidateSpec, 'composition-test');
  assertSurfaceReady(outcomeById, {
    symbol: compositionEntry.target,
    path: compositionEntry.path,
    query_id: compositionEntry.query_id,
    callers_query_id: compositionEntry.callers_query_id,
    callees_query_id: compositionEntry.callees_query_id,
    impact_id: compositionEntry.impact_id,
  }, 'composition entry');
  assertSurfaceReady(outcomeById, {
    symbol: compositionTest.target,
    path: compositionTest.path,
    query_id: compositionTest.query_id,
    callers_query_id: compositionTest.callers_query_id,
    callees_query_id: compositionTest.callees_query_id,
    impact_id: compositionTest.impact_id,
  }, 'composition test');
  for (const candidateTodo of candidateSpec.todos) {
    const production = candidateTodo.proposed.production;
    const testSurface = candidateTodo.proposed.tests[0];
    assertSurfaceReady(
      outcomeById,
      production,
      `${candidateTodo.todo_id}/proposed/production`,
    );
    assertSurfaceReady(
      outcomeById,
      testSurface,
      `${candidateTodo.todo_id}/proposed/test`,
    );
    assertCalleeLink(
      outcomeById,
      production.composition_link_query_id,
      production.symbol,
      production.path,
      `${candidateTodo.todo_id}/composition-entry`,
    );
    assertCalleeLink(
      outcomeById,
      testSurface.callees_query_id,
      production.symbol,
      production.path,
      `${candidateTodo.todo_id}/dedicated-test`,
    );
  }
  assertCalleeLink(
    outcomeById,
    compositionTest.callees_query_id,
    compositionEntry.target,
    compositionEntry.path,
    'composition-test/entry',
  );
}

function evidenceIdsForSurface(surface, candidateSpec) {
  const ids = surfaceQueryIds(surface);
  if (surface.path === candidateSpec.fixed_oracle.path) {
    ids.push(candidateSpec.fixed_oracle.runner_query_id);
  }
  return [...new Set(ids)].sort(compareText);
}

function structuralResources({
  candidateSpec,
  candidateDigest,
  topology,
  outcomeById,
  codegraphEvidence,
}) {
  const groups = new Map();
  const add = (kind, target, todoId, surface, ref) => {
    const key = resourceKey(kind, target);
    const group = groups.get(key) ?? {
      kind,
      target,
      todoIds: new Set(),
      queryIds: new Set(),
      candidateRefs: new Set(),
    };
    group.todoIds.add(todoId);
    evidenceIdsForSurface(surface, candidateSpec).forEach((id) => group.queryIds.add(id));
    group.candidateRefs.add(ref);
    groups.set(key, group);
  };

  for (const candidateTodo of candidateSpec.todos) {
    const mode = topology === 'current' ? 'current' : 'proposed';
    const modeSpec = candidateTodo[mode];
    add(
      'symbol',
      modeSpec.production.symbol,
      candidateTodo.todo_id,
      modeSpec.production,
      `${candidateTodo.todo_id}/${mode}/production/symbol`,
    );
    add(
      'path',
      modeSpec.production.path,
      candidateTodo.todo_id,
      modeSpec.production,
      `${candidateTodo.todo_id}/${mode}/production/path`,
    );
    modeSpec.tests.forEach((surface, index) => {
      add(
        'path',
        surface.path,
        candidateTodo.todo_id,
        surface,
        `${candidateTodo.todo_id}/${mode}/tests/${index}/path`,
      );
      if (surface.symbol !== null) {
        add(
          'symbol',
          surface.symbol,
          candidateTodo.todo_id,
          surface,
          `${candidateTodo.todo_id}/${mode}/tests/${index}/symbol`,
        );
      }
    });
  }

  return [...groups.values()].map((group) => {
    const queryIds = [...group.queryIds].sort(compareText);
    const outcomes = queryIds.map((id) => outcomeById.get(id));
    if (outcomes.some((outcome) => !outcome || outcome.outcome !== 'ready')) {
      fail(`active resource ${group.kind}:${group.target}のCodegraph evidenceがreadyではない`);
    }
    const evidenceDigest = digestArtifact({
      schema: 'lattice.rc2.codegraph_resource_evidence.v1',
      topology,
      portable_aggregate_digest: codegraphEvidence.aggregate_digest,
      query_ids: queryIds,
      outcomes,
    });
    return {
      resource_id: resourceId(group.kind, group.target),
      kind: group.kind,
      target: group.target,
      todo_ids: [...group.todoIds].sort(compareText),
      provenance: [
        {
          source: 'codegraph',
          evidence_ref: `portable-codegraph#${queryIds.join(',')}`,
          evidence_digest: evidenceDigest,
          status: 'ready',
        },
        {
          source: 'manual_candidate_spec',
          evidence_ref: `candidate-spec#${[...group.candidateRefs].sort(compareText).join(',')}`,
          evidence_digest: candidateDigest,
          status: 'asserted',
        },
      ],
    };
  });
}

function manualResources(manualByTodo, manualEvidenceDigest) {
  const groups = new Map();
  const add = (kind, target, todoId) => {
    const key = resourceKey(kind, target);
    const group = groups.get(key) ?? { kind, target, todoIds: new Set() };
    group.todoIds.add(todoId);
    groups.set(key, group);
  };
  for (const [todoId, entry] of manualByTodo) {
    entry.state_writes.forEach((target) => add('state', target, todoId));
    entry.effects.forEach((target) => add('effect', target, todoId));
    entry.unknowns.forEach((target) => add('dynamic', target, todoId));
  }
  return [...groups.values()].map((group) => ({
    resource_id: resourceId(group.kind, group.target),
    kind: group.kind,
    target: group.target,
    todo_ids: [...group.todoIds].sort(compareText),
    provenance: [{
      source: 'manual_state_effect',
      evidence_ref: `manual-evidence#${group.kind}/${resourceId(group.kind, group.target)}`,
      evidence_digest: manualEvidenceDigest,
      status: 'asserted',
    }],
  }));
}

/**
 * RC2 delivery-policy witnessをprovenance付きnormalized boundary bundleへ変換する。
 * @param {unknown} inputs
 * @returns {object}
 */
export function compileDeliveryPolicyBoundaryBundleV2(inputs) {
  if (!exactRecord(inputs, INPUT_KEYS)) fail('input shapeが不正');
  const {
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
    sourceSnapshot,
    codegraphEvidence,
  } = inputs;

  if (!validatePlanInput(planInput)) fail('plan inputが不正');
  const queryById = queryMapFor(querySet);
  const candidateDigest = validateCandidateSpec(candidateSpec, queryById);
  const manualByTodo = manualEvidenceByTodo(manualEvidence);
  assertTodoBindings(planInput, candidateSpec, manualByTodo);
  const snapshot = validateSourceSnapshot(sourceSnapshot, candidateSpec);
  const outcomeById = validatePortableEvidence({
    codegraphEvidence,
    querySet,
    queryById,
    candidateSpec,
    filesByPath: snapshot.filesByPath,
  });
  assertActivation(candidateSpec, snapshot.topology, outcomeById, queryById);

  const manualEvidenceDigest = digestArtifact(manualEvidence);
  const resources = [
    ...structuralResources({
      candidateSpec,
      candidateDigest,
      topology: snapshot.topology,
      outcomeById,
      codegraphEvidence,
    }),
    ...manualResources(manualByTodo, manualEvidenceDigest),
  ];
  if (new Set(resources.map(({ resource_id: id }) => id)).size !== resources.length) {
    fail('resource ID collisionを検出した');
  }

  return compileBoundaryObservationV2({
    schema_version: 'lattice.boundary_observation_set.v2',
    source: {
      snapshot_digest: digestArtifact(sourceSnapshot),
      candidate_witness_digest: candidateDigest,
      query_set_digest: digestArtifact(querySet),
      manual_evidence_digest: manualEvidenceDigest,
    },
    capacity: planInput.capacity.writers,
    todos: planInput.todos.map(({ id }) => id),
    resources,
    precedences: [],
  });
}
