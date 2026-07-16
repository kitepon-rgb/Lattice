import { createHash } from 'node:crypto';

import {
  digestArtifact,
  validateBoundaryManifest,
  validatePlanInput,
} from './artifact-contracts.mjs';
import {
  validateBoundaryVerdictV2,
  validateNormalizedBoundaryBundleV2,
  validatePlanGraphV2,
} from './artifact-contracts-v2.mjs';
import { compileBoundaryObservationV2 } from './boundary-observation-compiler-v2.mjs';
import { compileSchedulabilityGraphV2 } from './schedulability-compiler-v2.mjs';

const INPUT_KEYS = [
  'planInput',
  'candidateSpec',
  'manualEvidence',
  'querySet',
  'boundaryManifest',
];
const EXPECTED_CANDIDATE_DIGEST = '3250c93a8bd0958acee046f2b7ea371170290b7e256d6392421009db2e1cd8ac';
const EXPECTED_CANDIDATE_ID = 'extract-dispatch-production-and-test-policies';
const QUERY_OPERATIONS = new Set([
  'status',
  'query',
  'callers',
  'callees',
  'impact',
  'affected',
]);
const V2_CODEGRAPH_STATUSES = new Set([
  'ready',
  'symbol_absent',
  'empty',
  'unresolved',
  'command_failure',
  'invalid_json',
  'stale',
  'unsupported',
]);

function fail(reason) {
  throw new TypeError(`RC1 transfer front-end契約違反: ${reason}`);
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

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

function sameStringSet(left, right) {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function resourceKey(kind, target) {
  return `${kind}\u0000${target}`;
}

function resourceId(kind, target) {
  const digest = createHash('sha256').update(resourceKey(kind, target)).digest('hex');
  return `rc1-${kind}-${digest.slice(0, 20)}`;
}

function validateCandidateSpec(candidateSpec) {
  if (!plainRecord(candidateSpec)
    || candidateSpec.schema !== 'lattice.rc1.boundary_candidate_spec.v2'
    || candidateSpec.candidate_id !== EXPECTED_CANDIDATE_ID) {
    fail('candidate spec identityが不正');
  }
  const candidateDigest = digestArtifact(candidateSpec);
  if (candidateDigest !== EXPECTED_CANDIDATE_DIGEST) {
    fail('candidate specがRC1 v6 accepted witnessと一致しない');
  }
  requireArray(candidateSpec.todos, 'candidateSpec.todos');
  return candidateDigest;
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
    ]) || !boundedText(entry.todo_id) || byTodo.has(entry.todo_id)) {
      fail('manual evidence entryが不正またはTODO重複している');
    }
    uniqueBoundedStrings(entry.state_reads, `${entry.todo_id}.state_reads`);
    uniqueBoundedStrings(entry.state_writes, `${entry.todo_id}.state_writes`);
    uniqueBoundedStrings(entry.effects, `${entry.todo_id}.effects`);
    uniqueBoundedStrings(entry.unknowns, `${entry.todo_id}.unknowns`);
    if (entry.state_reads.length > 0) {
      fail('RC1 v6 transferはread/write別を失うstate_readsを受理しない');
    }
    byTodo.set(entry.todo_id, entry);
  }
  if (byTodo.size < 1) fail('manual evidenceが空である');
  return byTodo;
}

function surfaceMap(candidateTodo, mode) {
  const modeSpec = candidateTodo[mode];
  const surfaces = new Map();
  const add = (kind, target, queryId, queryTarget, ref) => {
    const key = resourceKey(kind, target);
    const existing = surfaces.get(key);
    const value = { queryId, queryTarget, ref };
    if (existing && (existing.queryId !== queryId || existing.queryTarget !== queryTarget)) {
      fail(`candidate ${candidateTodo.todo_id}/${mode} surfaceが曖昧である`);
    }
    surfaces.set(key, value);
  };

  add(
    'symbol',
    modeSpec.production.symbol,
    modeSpec.production.query_id,
    modeSpec.production.symbol,
    `${candidateTodo.todo_id}/${mode}/production`,
  );
  add(
    'path',
    modeSpec.production.path,
    modeSpec.production.query_id,
    modeSpec.production.symbol,
    `${candidateTodo.todo_id}/${mode}/production`,
  );
  modeSpec.tests.forEach((testSurface, index) => {
    const queryTarget = testSurface.symbol ?? testSurface.path;
    add(
      'path',
      testSurface.path,
      testSurface.query_id,
      queryTarget,
      `${candidateTodo.todo_id}/${mode}/tests/${index}`,
    );
    if (testSurface.symbol !== null) {
      add(
        'symbol',
        testSurface.symbol,
        testSurface.query_id,
        queryTarget,
        `${candidateTodo.todo_id}/${mode}/tests/${index}`,
      );
    }
  });
  return surfaces;
}

function activeModeFor(candidateByTodo, manifestByTodo) {
  const modes = ['current', 'proposed'].filter((mode) => {
    for (const [todoId, candidateTodo] of candidateByTodo) {
      const manifestTodo = manifestByTodo.get(todoId);
      const actual = manifestTodo.writes
        .filter(({ kind }) => kind === 'symbol' || kind === 'path')
        .map(({ kind, target }) => resourceKey(kind, target));
      const expected = [...surfaceMap(candidateTodo, mode).keys()];
      if (!sameStringSet(actual, expected)) return false;
    }
    return true;
  });
  if (modes.length !== 1) {
    fail('manifest structural writesがcurrent/proposedの一方へexact対応しない');
  }
  return modes[0];
}

function assertTodoBindings({ planInput, candidateSpec, manualByTodo, boundaryManifest }) {
  const planIds = planInput.todos.map(({ id }) => id);
  const candidateIds = candidateSpec.todos.map(({ todo_id: todoId }) => todoId);
  const manualIds = [...manualByTodo.keys()];
  const manifestIds = boundaryManifest.todos.map(({ id }) => id);
  if (!sameStringSet(planIds, candidateIds)
    || !sameStringSet(planIds, manualIds)
    || !sameStringSet(planIds, manifestIds)) {
    fail('plan/candidate/manual/manifestのTODO集合が一致しない');
  }

  const planByTodo = new Map(planInput.todos.map((todo) => [todo.id, todo]));
  for (const candidateTodo of candidateSpec.todos) {
    const planTodo = planByTodo.get(candidateTodo.todo_id);
    if (candidateTodo.outcome !== planTodo.outcome
      || candidateTodo.current.production.symbol !== planTodo.anchor.symbol
      || candidateTodo.current.production.path !== planTodo.anchor.path) {
      fail(`candidate ${candidateTodo.todo_id}がplan TODOへbindしていない`);
    }
  }
}

function graphEvidenceById(boundaryManifest, queryById) {
  const evidenceById = new Map();
  for (const evidence of boundaryManifest.graph_evidence) {
    const query = queryById.get(evidence.id);
    if (!query || query.operation !== evidence.operation || evidenceById.has(evidence.id)) {
      fail(`graph evidence ${evidence.id}がquery setへexact bindしていない`);
    }
    evidenceById.set(evidence.id, evidence);
  }
  if (evidenceById.size !== queryById.size
    || [...queryById.keys()].some((queryId) => !evidenceById.has(queryId))) {
    fail('query setとgraph evidenceのID集合が一致しない');
  }
  return evidenceById;
}

function assertManualBindings(manualByTodo, boundaryManifest) {
  const manifestByTodo = new Map(boundaryManifest.manual_evidence
    .map((entry) => [entry.todo_id, entry]));
  for (const [todoId, entry] of manualByTodo) {
    const manifestEntry = manifestByTodo.get(todoId);
    if (!manifestEntry
      || manifestEntry.id !== `manual-${todoId}`
      || manifestEntry.result_digest !== digestArtifact(entry)) {
      fail(`manual evidence ${todoId}がmanifest entryへbindしていない`);
    }
  }
}

function structuralResources({
  candidateSpec,
  candidateDigest,
  manifestByTodo,
  activeMode,
  queryById,
  evidenceById,
}) {
  const groups = new Map();
  const candidateByTodo = new Map(candidateSpec.todos
    .map((todo) => [todo.todo_id, todo]));

  for (const [todoId, manifestTodo] of manifestByTodo) {
    const surfaces = surfaceMap(candidateByTodo.get(todoId), activeMode);
    for (const { kind, target } of manifestTodo.writes) {
      if (kind !== 'symbol' && kind !== 'path') continue;
      const key = resourceKey(kind, target);
      const surface = surfaces.get(key);
      if (!surface) fail(`manifest resource ${kind}:${target}がcandidate surfaceにない`);
      const query = queryById.get(surface.queryId);
      if (!query
        || query.operation !== 'query'
        || query.target !== surface.queryTarget) {
        fail(`candidate surface ${surface.ref}のquery bindingが不正`);
      }
      const group = groups.get(key) ?? {
        kind,
        target,
        todoIds: new Set(),
        queryIds: new Set(),
        surfaceRefs: new Set(),
      };
      group.todoIds.add(todoId);
      group.queryIds.add(surface.queryId);
      group.surfaceRefs.add(surface.ref);
      groups.set(key, group);
    }
  }

  return [...groups.values()].map((group) => {
    if (group.queryIds.size !== 1) {
      fail(`shared resource ${group.kind}:${group.target}のquery provenanceが曖昧である`);
    }
    const queryId = [...group.queryIds][0];
    const evidence = evidenceById.get(queryId);
    if (!evidence || !V2_CODEGRAPH_STATUSES.has(evidence.status)) {
      fail(`resource ${group.kind}:${group.target}のCodegraph statusをv2へ保持できない`);
    }
    return {
      resource_id: resourceId(group.kind, group.target),
      kind: group.kind,
      target: group.target,
      todo_ids: [...group.todoIds].sort(compareText),
      provenance: [
        {
          source: 'codegraph',
          evidence_ref: `boundary-manifest.graph_evidence#${queryId}`,
          evidence_digest: evidence.result_digest,
          status: evidence.status,
        },
        {
          source: 'manual_candidate_spec',
          evidence_ref: `candidate-spec#${[...group.surfaceRefs].sort(compareText).join(',')}`,
          evidence_digest: candidateDigest,
          status: 'asserted',
        },
      ],
    };
  });
}

function manualResources({ manualByTodo, manualEvidenceDigest, manifestByTodo }) {
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

    const manifestTodo = manifestByTodo.get(todoId);
    const actualManualWrites = manifestTodo.writes
      .filter(({ kind }) => kind === 'state' || kind === 'effect')
      .map(({ kind, target }) => resourceKey(kind, target));
    const expectedManualWrites = [
      ...entry.state_writes.map((target) => resourceKey('state', target)),
      ...entry.effects.map((target) => resourceKey('effect', target)),
    ];
    if (!sameStringSet(actualManualWrites, expectedManualWrites)
      || !sameStringSet(manifestTodo.unknowns, entry.unknowns)) {
      fail(`manual evidence ${todoId}とmanifest state/effect/unknownが一致しない`);
    }
    const unsupportedWrites = manifestTodo.writes.filter(({ kind }) => (
      kind !== 'symbol' && kind !== 'path' && kind !== 'state' && kind !== 'effect'
    ));
    if (unsupportedWrites.length > 0) {
      fail(`manifest ${todoId}に未対応write kindがある`);
    }
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
 * immutable RC1 v6 evidenceをcandidate非依存のv2 bundle／verdict／planへ再compileする。
 * @param {unknown} inputs
 * @returns {{bundle: object, verdict: object, plan: object}}
 */
export function compileRc1TransferBundleV2(inputs) {
  if (!exactRecord(inputs, INPUT_KEYS)) fail('input shapeが不正');
  const {
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
    boundaryManifest,
  } = inputs;

  if (!validatePlanInput(planInput)) fail('plan inputが不正');
  if (!validateBoundaryManifest(boundaryManifest)) fail('boundary manifestが不正');
  const candidateDigest = validateCandidateSpec(candidateSpec);
  const queryById = queryMapFor(querySet);
  const manualByTodo = manualEvidenceByTodo(manualEvidence);
  const planInputDigest = digestArtifact(planInput);
  const querySetDigest = digestArtifact(querySet);
  const manualEvidenceDigest = digestArtifact(manualEvidence);

  if (boundaryManifest.plan_input_digest !== planInputDigest
    || boundaryManifest.source.query_set_digest !== querySetDigest
    || boundaryManifest.source.manual_evidence_digest !== manualEvidenceDigest) {
    fail('manifest source binding digestが入力と一致しない');
  }

  assertTodoBindings({ planInput, candidateSpec, manualByTodo, boundaryManifest });
  assertManualBindings(manualByTodo, boundaryManifest);
  const queryEvidenceById = graphEvidenceById(boundaryManifest, queryById);
  const manifestByTodo = new Map(boundaryManifest.todos.map((todo) => [todo.id, todo]));
  if (boundaryManifest.unknowns.length > 0) {
    fail('RC1 v6 transferはsource不明のmanifest global unknownを受理しない');
  }
  if ([...manifestByTodo.values()].some((todo) => todo.reads.length > 0)) {
    fail('RC1 v6 transferはread/write区別を失うmanifest readsを受理しない');
  }
  if ([...manifestByTodo.values()].some((todo) => todo.hard_needs.length > 0)) {
    fail('RC1 v6 transferはcandidate witnessにないhard_needsを受理しない');
  }
  const candidateByTodo = new Map(candidateSpec.todos
    .map((todo) => [todo.todo_id, todo]));
  const activeMode = activeModeFor(candidateByTodo, manifestByTodo);

  const resources = [
    ...structuralResources({
      candidateSpec,
      candidateDigest,
      manifestByTodo,
      activeMode,
      queryById,
      evidenceById: queryEvidenceById,
    }),
    ...manualResources({ manualByTodo, manualEvidenceDigest, manifestByTodo }),
  ];
  if (new Set(resources.map(({ resource_id: resourceIdValue }) => resourceIdValue)).size
    !== resources.length) {
    fail('resource ID collisionを検出した');
  }

  const bundle = compileBoundaryObservationV2({
    schema_version: 'lattice.boundary_observation_set.v2',
    source: {
      snapshot_digest: boundaryManifest.source.code_snapshot_digest,
      candidate_witness_digest: candidateDigest,
      query_set_digest: querySetDigest,
      manual_evidence_digest: manualEvidenceDigest,
    },
    capacity: planInput.capacity.writers,
    todos: planInput.todos.map(({ id }) => id),
    resources,
    precedences: [],
  });
  const compiled = compileSchedulabilityGraphV2(bundle.graph);
  if (compiled.outcome !== 'compiled') {
    throw new Error(`RC1 transfer v2 compile失敗: ${compiled.code ?? compiled.outcome}`);
  }
  const verdict = {
    schema_version: 'lattice.boundary_verdict.v2',
    normalized_graph_digest: bundle.graph_digest,
    verdicts: compiled.pairwise_verdicts,
  };
  const plan = compiled.plan;

  if (!validateNormalizedBoundaryBundleV2(bundle)
    || !validateBoundaryVerdictV2(verdict, bundle.graph)
    || !validatePlanGraphV2(plan, bundle.graph)) {
    throw new Error('RC1 transferが生成したv2 artifactの独立検証に失敗した');
  }
  return { bundle, verdict, plan };
}
