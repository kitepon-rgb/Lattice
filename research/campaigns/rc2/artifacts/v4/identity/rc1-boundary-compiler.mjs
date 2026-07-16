import {
  canonicalizeArtifact,
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
  validatePlanInput,
} from './artifact-contracts.mjs';
import { portableCodegraphOutcome } from './codegraph-adapter.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const OPERATIONS = new Set(['status', 'query', 'callers', 'callees', 'impact', 'affected']);
const OPTION_KEYS = [
  'candidateSpec',
  'codeSnapshotDigest',
  'codegraphEvidence',
  'manualEvidence',
  'planInput',
  'planVersion',
  'querySet',
];

export const RC1_BOUNDARY_COMPILER_CONTRACT = Object.freeze({
  export_name: 'compileBoundaryCondition',
  condition_selector: 'forbidden',
  surface_resolution: 'exact_graph_name_or_qualified_name_at_expected_path',
  conflict_rule: 'pairwise_write_resource_intersection',
});

function fail(reason) {
  throw new TypeError(`RC1 v4 boundary compiler契約違反: ${reason}`);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4_096;
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function repoPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1_024
    && !value.includes('\0')
    && !value.startsWith('/')
    && !value.split('/').includes('..');
}

function unique(values) {
  return [...new Set(values)];
}

function resourceKey(value) {
  return `${value.kind}\0${value.target}`;
}

function uniqueResources(values) {
  return [...new Map(values.map((value) => [resourceKey(value), value])).values()]
    .sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));
}

function assertManualEvidence(planInput, manualEvidence) {
  if (!exactRecord(manualEvidence, ['schema', 'evidence'])
    || manualEvidence.schema !== 'lattice.manual_boundary_evidence.v1'
    || !Array.isArray(manualEvidence.evidence)
    || manualEvidence.evidence.length !== planInput.todos.length) {
    fail('manual evidence rootがplan inputと一致しない');
  }
  const todoIds = planInput.todos.map(({ id }) => id);
  if (new Set(manualEvidence.evidence.map(({ todo_id: todoId }) => todoId)).size !== todoIds.length) {
    fail('manual evidence todo IDが一意でない');
  }
  for (const entry of manualEvidence.evidence) {
    if (!exactRecord(entry, ['todo_id', 'state_reads', 'state_writes', 'effects', 'unknowns'])
      || !todoIds.includes(entry.todo_id)
      || ![entry.state_reads, entry.state_writes, entry.effects, entry.unknowns]
        .every((values) => Array.isArray(values)
          && values.every(nonEmptyText)
          && new Set(values).size === values.length)) {
      fail('manual evidence recordが不正');
    }
  }
}

function assertTestSurface(value, { proposed }) {
  if (!exactRecord(value, [
    'symbol',
    'path',
    'query_id',
    'impact_id',
    'assertion_id',
    'provenance',
  ])
    || (proposed ? !nonEmptyText(value.symbol) : value.symbol !== null)
    || !repoPath(value.path)
    || !identifier(value.query_id)
    || (proposed ? !identifier(value.impact_id) : value.impact_id !== null)
    || !identifier(value.assertion_id)
    || !exactRecord(value.provenance, ['kind', 'ref'])
    || value.provenance.kind !== 'todo_outcome'
    || !nonEmptyText(value.provenance.ref)) {
    fail(`${proposed ? 'proposed' : 'current'} test surfaceが不正`);
  }
}

function assertProductionSurface(value) {
  if (!exactRecord(value, ['symbol', 'path', 'query_id', 'impact_id', 'link_query_id'])
    || !nonEmptyText(value.symbol)
    || !repoPath(value.path)
    || !identifier(value.query_id)
    || !identifier(value.impact_id)
    || !identifier(value.link_query_id)) {
    fail('production surfaceが不正');
  }
}

function assertCandidateSpec(planInput, candidateSpec) {
  if (!exactRecord(candidateSpec, [
    'schema',
    'candidate_id',
    'plan_input_ref',
    'query_set_ref',
    'behavior_oracle_ref',
    'compiler_contract',
    'stable_surfaces',
    'todos',
  ])
    || candidateSpec.schema !== 'lattice.rc1.boundary_candidate_spec.v2'
    || !identifier(candidateSpec.candidate_id)
    || !repoPath(candidateSpec.plan_input_ref)
    || !repoPath(candidateSpec.query_set_ref)
    || !repoPath(candidateSpec.behavior_oracle_ref)
    || !exactRecord(candidateSpec.compiler_contract, [
      'condition_selector',
      'surface_resolution',
      'proposed_activation',
      'unresolved_policy',
      'conflict_rule',
    ])
    || candidateSpec.compiler_contract.condition_selector !== 'forbidden'
    || candidateSpec.compiler_contract.surface_resolution
      !== 'exact_graph_name_or_qualified_name_at_expected_path'
    || candidateSpec.compiler_contract.proposed_activation
      !== 'all_proposed_production_and_test_surfaces_exact'
    || candidateSpec.compiler_contract.unresolved_policy !== 'typed_unknown'
    || candidateSpec.compiler_contract.conflict_rule !== 'pairwise_write_resource_intersection'
    || !Array.isArray(candidateSpec.stable_surfaces)
    || candidateSpec.stable_surfaces.length === 0
    || !Array.isArray(candidateSpec.todos)
    || candidateSpec.todos.length !== planInput.todos.length) {
    fail('candidate spec rootが不正');
  }

  for (const surface of candidateSpec.stable_surfaces) {
    if (!exactRecord(surface, ['kind', 'target', 'path', 'role', 'active_when'])
      || !new Set(['symbol', 'path']).has(surface.kind)
      || !nonEmptyText(surface.target)
      || !repoPath(surface.path)
      || !identifier(surface.role)
      || !new Set(['always', 'proposed']).has(surface.active_when)) {
      fail('stable surfaceが不正');
    }
  }

  const planTodos = new Map(planInput.todos.map((todo) => [todo.id, todo]));
  for (const todo of candidateSpec.todos) {
    if (!exactRecord(todo, ['todo_id', 'outcome', 'current', 'proposed'])
      || !planTodos.has(todo.todo_id)
      || todo.outcome !== planTodos.get(todo.todo_id).outcome) {
      fail('candidate TODOがplan inputと一致しない');
    }
    for (const [mode, proposed] of [['current', false], ['proposed', true]]) {
      const value = todo[mode];
      if (!exactRecord(value, ['production', 'tests'])
        || !Array.isArray(value.tests)
        || value.tests.length === 0) {
        fail(`${mode} surface setが不正`);
      }
      assertProductionSurface(value.production);
      for (const test of value.tests) assertTestSurface(test, { proposed });
    }
  }
  if (new Set(candidateSpec.todos.map(({ todo_id: todoId }) => todoId)).size
    !== planInput.todos.length) {
    fail('candidate TODO IDが一意でない');
  }
}

function assertQuerySet(querySet, candidateSpec) {
  if (!exactRecord(querySet, ['schema', 'queries'])
    || querySet.schema !== 'lattice.codegraph_query_set.v2'
    || !Array.isArray(querySet.queries)
    || querySet.queries.length === 0
    || querySet.queries.length > 256) {
    fail('query set rootが不正');
  }
  const ids = new Set();
  for (const query of querySet.queries) {
    if (!isPlainObject(query) || !identifier(query.id) || ids.has(query.id)
      || !OPERATIONS.has(query.operation)) {
      fail('query set recordが不正');
    }
    ids.add(query.id);
    if (query.operation === 'status') {
      if (!exactRecord(query, ['id', 'operation'])) fail('status query shapeが不正');
    } else if (query.operation === 'affected') {
      if (!exactRecord(query, ['id', 'operation', 'targets'])
        || !Array.isArray(query.targets)
        || query.targets.length === 0
        || !query.targets.every(repoPath)
        || new Set(query.targets).size !== query.targets.length) {
        fail('affected query shapeが不正');
      }
    } else if (!exactRecord(query, ['id', 'operation', 'target'])
      || !nonEmptyText(query.target)) {
      fail('graph query shapeが不正');
    }
  }
  if (querySet.queries.filter(({ operation }) => operation === 'status').length !== 1
    || querySet.queries.filter(({ operation }) => operation === 'affected').length !== 1) {
    fail('query setにstatusとaffectedがexactly one必要');
  }

  const referenced = candidateSpec.todos.flatMap((todo) => [todo.current, todo.proposed]
    .flatMap((surface) => [
      surface.production.query_id,
      surface.production.impact_id,
      surface.production.link_query_id,
      ...surface.tests.flatMap((entry) => [entry.query_id, entry.impact_id].filter(Boolean)),
    ]));
  if (referenced.some((id) => !ids.has(id))) {
    fail('candidate specがquery set外のIDを参照する');
  }
}

function assertCodegraphEvidence(querySet, codegraphEvidence) {
  if (!isPlainObject(codegraphEvidence)
    || !Array.isArray(codegraphEvidence.outcomes)
    || codegraphEvidence.outcomes.length !== querySet.queries.length) {
    fail('Codegraph evidence rootがquery setと一致しない');
  }
  for (let index = 0; index < querySet.queries.length; index += 1) {
    const query = querySet.queries[index];
    const outcome = codegraphEvidence.outcomes[index];
    if (!isPlainObject(outcome)
      || outcome.id !== query.id
      || outcome.operation !== query.operation
      || !nonEmptyText(outcome.outcome)) {
      fail(`Codegraph evidence ${query.id}がID／operation／順序と一致しない`);
    }
    if (query.operation !== 'status' && query.operation !== 'affected'
      && outcome.target !== query.target) {
      fail(`Codegraph evidence ${query.id}のtargetがquery setと一致しない`);
    }
    if (query.operation === 'affected'
      && (!Array.isArray(outcome.targets)
        || outcome.targets.length !== query.targets.length
        || outcome.targets.some((entry, targetIndex) => (
          !isPlainObject(entry) || entry.target !== query.targets[targetIndex]
        )))) {
      fail(`Codegraph evidence ${query.id}のaffected targetがquery setと一致しない`);
    }
  }
}

function exactNodeAt(records, target, expectedPath) {
  if (!Array.isArray(records)) return false;
  const exact = records.filter((entry) => isPlainObject(entry?.node)
    && (entry.node.name === target || entry.node.qualifiedName === target)
    && entry.node.filePath === expectedPath);
  return exact.length === 1;
}

function exactQueryStatus(outcome, target, expectedPath) {
  if (outcome?.outcome === 'symbol_absent') return 'absent';
  if (outcome?.outcome !== 'ready') return 'unknown';
  return exactNodeAt(outcome.data, target, expectedPath) ? 'ready' : 'unknown';
}

function exactResolutionStatus(outcome, target, expectedPath) {
  if (outcome?.outcome === 'symbol_absent') return 'absent';
  if (outcome?.outcome !== 'ready') return 'unknown';
  return exactNodeAt(outcome.resolution, target, expectedPath) ? 'ready' : 'unknown';
}

function callerLinkStatus(outcome, production, anchor) {
  const resolution = exactResolutionStatus(outcome, production.symbol, production.path);
  if (resolution !== 'ready') return resolution;
  const callers = outcome.data?.callers;
  if (!Array.isArray(callers)) return 'unknown';
  return callers.some((entry) => entry?.name === anchor.symbol && entry?.filePath === anchor.path)
    ? 'ready'
    : 'unknown';
}

function outcomeMap(querySet, codegraphEvidence) {
  return new Map(querySet.queries.map((query, index) => [
    query.id,
    codegraphEvidence.outcomes[index],
  ]));
}

function statusesForSurface(surface, outcomes, anchor, { proposed }) {
  const statuses = [
    exactQueryStatus(
      outcomes.get(surface.production.query_id),
      surface.production.symbol,
      surface.production.path,
    ),
    exactResolutionStatus(
      outcomes.get(surface.production.impact_id),
      surface.production.symbol,
      surface.production.path,
    ),
  ];
  if (proposed) {
    statuses.push(callerLinkStatus(
      outcomes.get(surface.production.link_query_id),
      surface.production,
      anchor,
    ));
  }
  for (const test of surface.tests) {
    const target = test.symbol ?? test.path;
    statuses.push(exactQueryStatus(outcomes.get(test.query_id), target, test.path));
    if (test.impact_id !== null) {
      statuses.push(exactResolutionStatus(outcomes.get(test.impact_id), target, test.path));
    }
  }
  return statuses;
}

function deriveSurfaceMode(planInput, candidateSpec, outcomes) {
  const current = [];
  const proposed = [];
  for (const candidate of candidateSpec.todos) {
    const anchor = planInput.todos.find(({ id }) => id === candidate.todo_id).anchor;
    current.push(...statusesForSurface(candidate.current, outcomes, anchor, { proposed: false }));
    proposed.push(...statusesForSurface(candidate.proposed, outcomes, anchor, { proposed: true }));
  }
  if (current.every((status) => status === 'ready')
    && proposed.every((status) => status === 'absent')) {
    return { mode: 'current', unknowns: [] };
  }
  if (current.every((status) => status === 'ready')
    && proposed.every((status) => status === 'ready')) {
    return { mode: 'proposed', unknowns: [] };
  }
  return {
    mode: 'current',
    unknowns: [
      `surface_resolution_unknown:current=${current.join(',')}:proposed=${proposed.join(',')}`,
    ],
  };
}

function surfaceResources(surface) {
  return uniqueResources([
    { kind: 'symbol', target: surface.production.symbol },
    { kind: 'path', target: surface.production.path },
    ...surface.tests.flatMap((test) => [
      ...(test.symbol === null ? [] : [{ kind: 'symbol', target: test.symbol }]),
      { kind: 'path', target: test.path },
    ]),
  ]);
}

function surfaceEvidenceRefs(surface) {
  return unique([
    surface.production.query_id,
    surface.production.impact_id,
    surface.production.link_query_id,
    ...surface.tests.flatMap((test) => [test.query_id, test.impact_id].filter(Boolean)),
  ]).sort();
}

function manualByTodo(manualEvidence) {
  return new Map(manualEvidence.evidence.map((entry) => [entry.todo_id, entry]));
}

function manualRecordId(todoId) {
  return `manual-${todoId}`;
}

function conflictId(kind, index) {
  return `${kind}-${String(index + 1).padStart(3, '0')}`;
}

function compileConflicts(todoDrafts, graphUnknowns) {
  const conflicts = [];
  let writeIndex = 0;
  let stateIndex = 0;
  let effectIndex = 0;
  for (let leftIndex = 0; leftIndex < todoDrafts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < todoDrafts.length; rightIndex += 1) {
      const left = todoDrafts[leftIndex];
      const right = todoDrafts[rightIndex];
      const rightOwns = new Set(right.owns.map(resourceKey));
      for (const resource of left.owns.filter((entry) => rightOwns.has(resourceKey(entry)))) {
        conflicts.push({
          id: conflictId('write-overlap', writeIndex++),
          kind: 'write_boundary',
          todo_ids: [left.id, right.id],
          resource,
          evidence_refs: unique([...left.graphRefs, ...right.graphRefs]).sort(),
        });
      }

      const stateTargets = unique([
        ...left.manual.state_reads,
        ...left.manual.state_writes,
      ].filter((target) => (
        right.manual.state_reads.includes(target) || right.manual.state_writes.includes(target)
      ) && (
        left.manual.state_writes.includes(target) || right.manual.state_writes.includes(target)
      ))).sort();
      for (const target of stateTargets) {
        conflicts.push({
          id: conflictId('state-overlap', stateIndex++),
          kind: 'state',
          todo_ids: [left.id, right.id],
          resource: { kind: 'state', target },
          evidence_refs: [manualRecordId(left.id), manualRecordId(right.id)],
        });
      }

      for (const target of left.manual.effects
        .filter((entry) => right.manual.effects.includes(entry)).sort()) {
        conflicts.push({
          id: conflictId('effect-overlap', effectIndex++),
          kind: 'effect',
          todo_ids: [left.id, right.id],
          resource: { kind: 'effect', target },
          evidence_refs: [manualRecordId(left.id), manualRecordId(right.id)],
        });
      }
    }
  }

  const allUnknowns = unique([
    ...graphUnknowns,
    ...todoDrafts.flatMap(({ unknowns }) => unknowns),
  ]);
  if (allUnknowns.length > 0 && todoDrafts.length >= 2) {
    const resource = { kind: 'dynamic', target: 'unresolved-boundary' };
    for (const draft of todoDrafts) draft.dynamicWrites.push(resource);
    conflicts.push({
      id: 'dynamic-unknown-001',
      kind: 'dynamic_unknown',
      todo_ids: [todoDrafts[0].id, todoDrafts[1].id],
      resource,
      evidence_refs: unique([
        ...todoDrafts.flatMap(({ graphRefs }) => graphRefs),
        ...todoDrafts.map(({ id }) => manualRecordId(id)),
      ]).sort(),
    });
  }
  return { conflicts, allUnknowns };
}

function graphRecords(querySet, codegraphEvidence) {
  return querySet.queries.map((query, index) => ({
    id: query.id,
    operation: query.operation,
    status: codegraphEvidence.outcomes[index].outcome,
    result_digest: digestArtifact(portableCodegraphOutcome(codegraphEvidence.outcomes[index])),
  }));
}

function compileManifest({
  planInput,
  candidateSpec,
  manualEvidence,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest,
  surfaceMode,
  graphUnknowns,
  codegraphVersion,
}) {
  const manuals = manualByTodo(manualEvidence);
  const candidates = new Map(candidateSpec.todos.map((todo) => [todo.todo_id, todo]));
  const stableTests = candidateSpec.stable_surfaces
    .filter((surface) => surface.kind === 'path'
      && (surface.active_when === 'always' || surfaceMode === 'proposed'))
    .map(({ path: testPath }) => testPath);
  const drafts = planInput.todos.map((todo) => {
    const active = candidates.get(todo.id)[surfaceMode];
    const manual = manuals.get(todo.id);
    return {
      id: todo.id,
      owns: surfaceResources(active),
      graphRefs: surfaceEvidenceRefs(active),
      manual,
      dynamicWrites: [],
      unknowns: manual.unknowns.map((unknown) => `manual_unknown:${todo.id}:${unknown}`),
      tests: unique([...active.tests.map(({ path: testPath }) => testPath), ...stableTests]).sort(),
    };
  });
  const { conflicts, allUnknowns } = compileConflicts(drafts, graphUnknowns);
  const todos = drafts.map((draft) => ({
    id: draft.id,
    owns: draft.owns,
    reads: draft.manual.state_reads.map((target) => ({ kind: 'state', target })),
    writes: uniqueResources([
      ...draft.owns,
      ...draft.manual.state_writes.map((target) => ({ kind: 'state', target })),
      ...draft.manual.effects.map((target) => ({ kind: 'effect', target })),
      ...draft.dynamicWrites,
    ]),
    hard_needs: [],
    conflict_ids: conflicts.filter(({ todo_ids: todoIds }) => todoIds.includes(draft.id))
      .map(({ id }) => id),
    unknowns: unique([...graphUnknowns, ...draft.unknowns]),
    tests: draft.tests,
    evidence_refs: unique([...draft.graphRefs, manualRecordId(draft.id)]).sort(),
  }));
  const manifest = {
    schema: 'lattice.boundary_manifest.v1',
    plan_input_digest: digestArtifact(planInput),
    source: {
      code_snapshot_digest: codeSnapshotDigest,
      query_set_digest: digestArtifact(querySet),
      manual_evidence_digest: digestArtifact(manualEvidence),
      codegraph_version: codegraphVersion,
    },
    graph_evidence: graphRecords(querySet, codegraphEvidence),
    manual_evidence: planInput.todos.map((todo) => ({
      id: manualRecordId(todo.id),
      todo_id: todo.id,
      result_digest: digestArtifact(manuals.get(todo.id)),
    })),
    todos,
    conflicts,
    unknowns: allUnknowns,
  };
  if (!validateBoundaryManifest(manifest)) fail('生成manifestがpublic contractを満たさない');
  return manifest;
}

function compileVerdict(manifest, candidateSpec, surfaceMode) {
  const hasUnknown = manifest.unknowns.length > 0;
  const hasManualConflict = manifest.conflicts.some(({ kind }) => kind === 'state' || kind === 'effect');
  const hasWriteConflict = manifest.conflicts.some(({ kind }) => kind === 'write_boundary');
  let verdict;
  let reasons;
  let seamCandidate = null;
  if (hasUnknown) {
    verdict = 'unknown_requires_evidence';
    reasons = ['graphまたはmanual unknownが残るためindependenceを確定できない'];
  } else if (hasManualConflict) {
    verdict = 'intentional_serial';
    reasons = ['shared manual state/effect conflictはcode seamでは切断できない'];
  } else if (hasWriteConflict && surfaceMode === 'current') {
    verdict = 'seam_candidate';
    reasons = ['current production/test write overlapはcandidate specのproposed surfaceへ切断可能'];
    seamCandidate = {
      id: candidateSpec.candidate_id,
      proposed_owns: candidateSpec.todos.map((todo) => ({
        todo_id: todo.todo_id,
        resources: surfaceResources(todo.proposed),
      })),
      preconditions: [
        'all proposed production and test surfaces resolve exactly',
        'transform-external black-box oracle passes before and after',
      ],
    };
  } else if (hasWriteConflict) {
    verdict = 'intentional_serial';
    reasons = ['proposed surfaceにもwrite overlapが残るため追加seamまたはjoinが必要'];
  } else {
    verdict = 'parallel_ready';
    reasons = ['same compilerが全production/test write resourceの非重複を導出した'];
  }
  const artifact = {
    schema: 'lattice.boundary_verdict.v1',
    boundary_manifest_digest: digestArtifact(manifest),
    verdicts: [{
      id: 'channel-label-verdict-v4',
      todo_ids: manifest.todos.map(({ id }) => id),
      verdict,
      conflict_ids: manifest.conflicts.map(({ id }) => id),
      seam_candidate: seamCandidate,
      reasons,
      unknowns: manifest.unknowns,
    }],
  };
  if (!validateBoundaryVerdict(artifact)) fail('生成verdictがpublic contractを満たさない');
  return artifact;
}

function compilePlan(planInput, manifest, planVersion) {
  const edgeKinds = new Map([
    ['write_boundary', 'write_conflict'],
    ['state', 'state_conflict'],
    ['effect', 'effect_conflict'],
    ['semantic', 'semantic_conflict'],
    ['dynamic_unknown', 'dynamic_unknown'],
  ]);
  const edges = manifest.conflicts.map((conflict) => ({
    id: conflict.id,
    from: conflict.todo_ids[0],
    to: conflict.todo_ids[1],
    kind: edgeKinds.get(conflict.kind),
    evidence_refs: conflict.evidence_refs,
  }));
  const waves = edges.length === 0
    ? [{ index: 0, todo_ids: planInput.todos.map(({ id }) => id) }]
    : planInput.todos.map((todo, index) => ({ index, todo_ids: [todo.id] }));
  const graph = {
    schema: 'lattice.plan_graph.v1',
    plan_version: planVersion,
    source_manifest_digest: digestArtifact(manifest),
    capacity: { writers: planInput.capacity.writers },
    nodes: planInput.todos.map((todo) => ({
      id: todo.id,
      outcome: todo.outcome,
      owned_boundaries: manifest.todos.find(({ id }) => id === todo.id).owns,
    })),
    edges,
    joins: [],
    waves,
    minimum_feasible_waves: waves.length,
  };
  if (!validatePlanGraph(graph)) fail('生成plan graphがpublic contractを満たさない');
  return graph;
}

/**
 * 同じcandidate specと規則から任意code snapshotのRC1 boundaryをcompileする。
 * @param {object} options
 * @returns {object}
 */
export function compileBoundaryCondition(options = {}) {
  if (isPlainObject(options) && Object.hasOwn(options, 'condition')) {
    fail('condition selector is forbidden');
  }
  if (!exactRecord(options, OPTION_KEYS)) fail('compiler optionsがexact shapeでない');
  const {
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
    codegraphEvidence,
    codeSnapshotDigest,
    planVersion,
  } = options;
  for (const value of [planInput, candidateSpec, manualEvidence, querySet, codegraphEvidence]) {
    canonicalizeArtifact(value);
  }
  if (!validatePlanInput(planInput)
    || planInput.todos.length !== 2
    || planInput.capacity.writers !== 2) {
    fail('RC1 plan inputがpublic contractまたは固定topologyを満たさない');
  }
  if (!SHA256.test(codeSnapshotDigest) || !identifier(planVersion)) {
    fail('snapshot digestまたはplan versionが不正');
  }
  assertManualEvidence(planInput, manualEvidence);
  assertCandidateSpec(planInput, candidateSpec);
  assertQuerySet(querySet, candidateSpec);
  assertCodegraphEvidence(querySet, codegraphEvidence);
  const outcomes = outcomeMap(querySet, codegraphEvidence);
  const statusQuery = querySet.queries.find(({ operation }) => operation === 'status');
  const status = outcomes.get(statusQuery.id);
  if (status.outcome !== 'ready' || !nonEmptyText(status.data?.version)) {
    fail(`Codegraph statusがreadyでない: ${status.outcome}`);
  }
  const selection = deriveSurfaceMode(planInput, candidateSpec, outcomes);
  const boundaryManifest = compileManifest({
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
    codegraphEvidence,
    codeSnapshotDigest,
    surfaceMode: selection.mode,
    graphUnknowns: selection.unknowns,
    codegraphVersion: status.data.version,
  });
  const boundaryVerdict = compileVerdict(boundaryManifest, candidateSpec, selection.mode);
  const planGraph = compilePlan(planInput, boundaryManifest, planVersion);
  return {
    compiler: { ...RC1_BOUNDARY_COMPILER_CONTRACT },
    candidate_spec_digest: digestArtifact(candidateSpec),
    surface_mode: selection.mode,
    boundary_manifest: boundaryManifest,
    boundary_manifest_digest: digestArtifact(boundaryManifest),
    boundary_verdict: boundaryVerdict,
    boundary_verdict_digest: digestArtifact(boundaryVerdict),
    plan_graph: planGraph,
    plan_graph_digest: digestArtifact(planGraph),
  };
}
