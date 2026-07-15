import {
  canonicalizeArtifact,
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
  validatePlanInput,
} from './artifact-contracts.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const OPERATIONS = new Set(['status', 'query', 'callers', 'callees', 'impact', 'affected']);
const SEAM_BY_CONCERN = new Map([
  ['dispatch.channel_policy', {
    symbol: 'selectDispatchChannel',
    path: 'research/fixtures/dispatch-record/src/dispatch-channel.mjs',
  }],
  ['dispatch.label_policy', {
    symbol: 'formatDispatchLabel',
    path: 'research/fixtures/dispatch-record/src/dispatch-label.mjs',
  }],
]);

function fail(reason) {
  throw new TypeError(`control compile契約違反: ${reason}`);
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function nonEmptyText(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && Buffer.byteLength(value, 'utf8') <= 4_096;
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function repoPath(value) {
  return nonEmptyText(value)
    && Buffer.byteLength(value, 'utf8') <= 1_024
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.includes('\\')
    && !/^[A-Za-z]:/.test(value)
    && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function uniqueTextArray(value) {
  return Array.isArray(value)
    && value.length <= 256
    && value.every(nonEmptyText)
    && new Set(value).size === value.length;
}

function assertManualEvidence(planInput, manualEvidence) {
  if (!exactRecord(manualEvidence, ['schema', 'evidence'])
    || manualEvidence.schema !== 'lattice.manual_boundary_evidence.v1'
    || !Array.isArray(manualEvidence.evidence)
    || manualEvidence.evidence.length !== planInput.todos.length) {
    fail('manual evidence rootが不正');
  }
  const todoIds = new Set(planInput.todos.map(({ id }) => id));
  const observed = new Set();
  for (const entry of manualEvidence.evidence) {
    if (!exactRecord(entry, [
      'todo_id',
      'state_reads',
      'state_writes',
      'effects',
      'unknowns',
    ])
      || !identifier(entry.todo_id)
      || !todoIds.has(entry.todo_id)
      || observed.has(entry.todo_id)
      || !uniqueTextArray(entry.state_reads)
      || !uniqueTextArray(entry.state_writes)
      || !uniqueTextArray(entry.effects)
      || !uniqueTextArray(entry.unknowns)) {
      fail('manual evidence recordがplan TODOと一致しない');
    }
    observed.add(entry.todo_id);
  }
}

function assertQuerySet(querySet) {
  if (!exactRecord(querySet, ['schema', 'queries'])
    || querySet.schema !== 'lattice.codegraph_query_set.v1'
    || !Array.isArray(querySet.queries)
    || querySet.queries.length === 0
    || querySet.queries.length > 256) {
    fail('query set rootが不正');
  }
  const ids = new Set();
  for (const query of querySet.queries) {
    if (!query || typeof query !== 'object' || Array.isArray(query)
      || !identifier(query.id) || ids.has(query.id) || !OPERATIONS.has(query.operation)) {
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
      fail('symbol query shapeが不正');
    }
  }
}

function assertCodegraphEvidence(querySet, codegraphEvidence) {
  if (!exactRecord(codegraphEvidence, ['cwd', 'outcomes'])
    || !nonEmptyText(codegraphEvidence.cwd)
    || !Array.isArray(codegraphEvidence.outcomes)
    || codegraphEvidence.outcomes.length !== querySet.queries.length) {
    fail('Codegraph evidence rootがquery setと一致しない');
  }
  for (let index = 0; index < querySet.queries.length; index += 1) {
    const query = querySet.queries[index];
    const outcome = codegraphEvidence.outcomes[index];
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)
      || outcome.id !== query.id
      || outcome.operation !== query.operation
      || !nonEmptyText(outcome.outcome)) {
      fail(`Codegraph evidence ${query.id}がID／operation／順序と一致しない`);
    }
  }
}

function findSingleQuery(querySet, operation, target) {
  const matches = querySet.queries.filter((query) => query.operation === operation
    && (target === undefined || query.target === target));
  if (matches.length !== 1) fail(`query setに${operation}:${target ?? ''}がexactly one存在しない`);
  return matches[0];
}

function rc1Seams(planInput) {
  if (planInput.todos.length !== 2
    || planInput.plan_version !== 'rc1-control-v1'
    || planInput.capacity.writers !== 2
    || new Set(planInput.todos.map(({ anchor }) => anchor.symbol)).size !== 1
    || new Set(planInput.todos.map(({ anchor }) => anchor.path)).size !== 1
    || planInput.todos[0].anchor.path !== planInput.project.fixture_entry) {
    fail('RC1 control planはcapacity 2で同じmonolithic anchorを持つ2 TODOでなければならない');
  }
  return planInput.todos.map((todo) => {
    const seam = SEAM_BY_CONCERN.get(todo.concern);
    if (!seam) fail(`query setへ接続できないconcern: ${todo.concern}`);
    return { todo_id: todo.id, ...seam };
  });
}

function assertRc1QueryCoverage(planInput, querySet, seams) {
  const anchorSymbol = planInput.todos[0].anchor.symbol;
  const anchorPath = planInput.todos[0].anchor.path;
  findSingleQuery(querySet, 'status');
  for (const operation of ['query', 'callers', 'callees', 'impact']) {
    findSingleQuery(querySet, operation, anchorSymbol);
  }
  for (const seam of seams) {
    findSingleQuery(querySet, 'query', seam.symbol);
    findSingleQuery(querySet, 'impact', seam.symbol);
  }
  const affected = querySet.queries.filter(({ operation }) => operation === 'affected');
  const expectedTargets = [anchorPath, ...seams.map(({ path }) => path)];
  if (affected.length !== 1
    || JSON.stringify(affected[0].targets) !== JSON.stringify(expectedTargets)
    || querySet.queries.length !== 10) {
    fail('query setがRC1 controlの固定coverageからdriftした');
  }
}

function outcomeById(querySet, codegraphEvidence) {
  return new Map(querySet.queries.map((query, index) => [
    query.id,
    codegraphEvidence.outcomes[index],
  ]));
}

function assertOutcome(outcomes, query, expected) {
  const outcome = outcomes.get(query.id);
  if (outcome.outcome !== expected) {
    fail(`Codegraph evidence ${query.id}は${expected}でなく${outcome.outcome}`);
  }
  return outcome;
}

function controlGraphFacts(planInput, querySet, codegraphEvidence, seams) {
  const outcomes = outcomeById(querySet, codegraphEvidence);
  const statusQuery = findSingleQuery(querySet, 'status');
  const status = assertOutcome(outcomes, statusQuery, 'ready');
  if (!status.data || !nonEmptyText(status.data.version)) {
    fail('Codegraph statusにversionがない');
  }

  const anchorSymbol = planInput.todos[0].anchor.symbol;
  for (const operation of ['query', 'callers', 'callees', 'impact']) {
    assertOutcome(outcomes, findSingleQuery(querySet, operation, anchorSymbol), 'ready');
  }
  for (const seam of seams) {
    assertOutcome(outcomes, findSingleQuery(querySet, 'query', seam.symbol), 'symbol_absent');
    assertOutcome(outcomes, findSingleQuery(querySet, 'impact', seam.symbol), 'symbol_absent');
  }

  const affectedQuery = querySet.queries.find(({ operation }) => operation === 'affected');
  const affected = assertOutcome(outcomes, affectedQuery, 'unresolved');
  if (!Array.isArray(affected.targets)
    || affected.targets.length !== affectedQuery.targets.length
    || affected.targets.some((entry, index) => entry.target !== affectedQuery.targets[index])) {
    fail('affected Codegraph evidenceがquery targetsと一致しない');
  }
  const anchorEvidence = affected.targets[0];
  if (anchorEvidence.outcome !== 'ready'
    || !anchorEvidence.data
    || !Array.isArray(anchorEvidence.data.affectedTests)
    || anchorEvidence.data.affectedTests.length === 0
    || !anchorEvidence.data.affectedTests.every(repoPath)) {
    fail('anchorのaffected testを取得できない');
  }
  for (const proposed of affected.targets.slice(1)) {
    if (proposed.outcome !== 'empty'
      || !proposed.data
      || !Array.isArray(proposed.data.affectedTests)
      || proposed.data.affectedTests.length !== 0) {
      fail('未作成seam pathのaffected evidenceがemptyでない');
    }
  }
  return {
    codegraphVersion: status.data.version,
    affectedTests: [...new Set(anchorEvidence.data.affectedTests)].sort(),
    outcomes,
  };
}

function manualByTodo(manualEvidence) {
  return new Map(manualEvidence.evidence.map((entry) => [entry.todo_id, entry]));
}

function manualRecordId(todoId) {
  return `manual-${todoId}`;
}

function resourcesForTodo(todo, manual) {
  const owns = [
    { kind: 'symbol', target: todo.anchor.symbol },
    { kind: 'path', target: todo.anchor.path },
  ];
  return {
    owns,
    reads: manual.state_reads.map((target) => ({ kind: 'state', target })),
    writes: [
      ...owns.map((entry) => ({ ...entry })),
      ...manual.state_writes.map((target) => ({ kind: 'state', target })),
      ...manual.effects.map((target) => ({ kind: 'effect', target })),
    ],
  };
}

function sharedManualConflicts(planInput, manualRecords) {
  const [leftTodo, rightTodo] = planInput.todos;
  const left = manualRecords.get(leftTodo.id);
  const right = manualRecords.get(rightTodo.id);
  const conflicts = [];
  const stateTargets = [...new Set([
    ...left.state_reads,
    ...left.state_writes,
  ].filter((target) => (right.state_reads.includes(target) || right.state_writes.includes(target))
    && (left.state_writes.includes(target) || right.state_writes.includes(target))))].sort();
  for (const target of stateTargets) {
    conflicts.push({
      id: `shared-state-${target}`,
      kind: 'state',
      todo_ids: [leftTodo.id, rightTodo.id],
      resource: { kind: 'state', target },
      evidence_refs: [manualRecordId(leftTodo.id), manualRecordId(rightTodo.id)],
    });
  }
  const effectTargets = left.effects.filter((target) => right.effects.includes(target)).sort();
  for (const target of effectTargets) {
    conflicts.push({
      id: `shared-effect-${target}`,
      kind: 'effect',
      todo_ids: [leftTodo.id, rightTodo.id],
      resource: { kind: 'effect', target },
      evidence_refs: [manualRecordId(leftTodo.id), manualRecordId(rightTodo.id)],
    });
  }
  if (conflicts.some(({ id }) => !identifier(id))) {
    fail('manual conflict targetからbounded IDを作れない');
  }
  return conflicts;
}

function graphRecords(querySet, codegraphEvidence) {
  return querySet.queries.map((query, index) => ({
    id: query.id,
    operation: query.operation,
    status: codegraphEvidence.outcomes[index].outcome,
    result_digest: digestArtifact(codegraphEvidence.outcomes[index]),
  }));
}

function compileManifest({
  planInput,
  manualEvidence,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest,
  seams,
  facts,
}) {
  const manuals = manualByTodo(manualEvidence);
  const anchorSymbol = planInput.todos[0].anchor.symbol;
  const anchorQuery = findSingleQuery(querySet, 'query', anchorSymbol);
  const anchorImpact = findSingleQuery(querySet, 'impact', anchorSymbol);
  const affectedQuery = querySet.queries.find(({ operation }) => operation === 'affected');
  const graphRefs = [anchorQuery.id, anchorImpact.id, affectedQuery.id];
  const manualEvidenceRecords = planInput.todos.map((todo) => ({
    id: manualRecordId(todo.id),
    todo_id: todo.id,
    result_digest: digestArtifact(manuals.get(todo.id)),
  }));
  const expectedUnknowns = seams.flatMap((seam) => [
    `new_surface_unknown:${seam.symbol}`,
    `path_not_indexed_unknown:${seam.path}`,
  ]);
  const manualUnknowns = planInput.todos.flatMap((todo) => manuals.get(todo.id).unknowns
    .map((unknown) => `manual_unknown:${todo.id}:${unknown}`));
  const unknowns = [...new Set([...expectedUnknowns, ...manualUnknowns])];
  const writeConflict = {
    id: 'shared-dispatch-boundary',
    kind: 'write_boundary',
    todo_ids: planInput.todos.map(({ id }) => id),
    resource: { kind: 'symbol', target: anchorSymbol },
    evidence_refs: [anchorQuery.id, anchorImpact.id],
  };
  const manualConflicts = sharedManualConflicts(planInput, manuals);
  const conflicts = [writeConflict, ...manualConflicts];
  const conflictIds = conflicts.map(({ id }) => id);
  const todos = planInput.todos.map((todo, index) => {
    const resources = resourcesForTodo(todo, manuals.get(todo.id));
    return {
      id: todo.id,
      owns: resources.owns,
      reads: resources.reads,
      writes: resources.writes,
      hard_needs: [],
      conflict_ids: conflictIds,
      unknowns: [
        `new_surface_unknown:${seams[index].symbol}`,
        `path_not_indexed_unknown:${seams[index].path}`,
        ...manuals.get(todo.id).unknowns.map((unknown) => `manual_unknown:${todo.id}:${unknown}`),
      ],
      tests: facts.affectedTests,
      evidence_refs: [...graphRefs, manualRecordId(todo.id)],
    };
  });
  const manifest = {
    schema: 'lattice.boundary_manifest.v1',
    plan_input_digest: digestArtifact(planInput),
    source: {
      code_snapshot_digest: codeSnapshotDigest,
      query_set_digest: digestArtifact(querySet),
      manual_evidence_digest: digestArtifact(manualEvidence),
      codegraph_version: facts.codegraphVersion,
    },
    graph_evidence: graphRecords(querySet, codegraphEvidence),
    manual_evidence: manualEvidenceRecords,
    todos,
    conflicts,
    unknowns,
  };
  if (!validateBoundaryManifest(manifest)) {
    fail('生成したboundary manifestがpublic contractを満たさない');
  }
  return manifest;
}

function compileVerdict(manifest, seams, manualEvidence) {
  const manualBlocking = manualEvidence.evidence.some(({ unknowns }) => unknowns.length > 0);
  const nonCodeConflict = manifest.conflicts.some(({ kind }) => kind === 'state' || kind === 'effect');
  let verdict;
  let seamCandidate = null;
  let reasons;
  if (manualBlocking) {
    verdict = 'unknown_requires_evidence';
    reasons = ['manual unknownが残るためindependenceまたはseam safetyを確定できない'];
  } else if (nonCodeConflict) {
    verdict = 'intentional_serial';
    reasons = ['shared manual state/effect conflictはcode seamだけでは切断できない'];
  } else {
    verdict = 'seam_candidate';
    reasons = ['shared code write boundaryは非重複ownershipへ抽出できる'];
    seamCandidate = {
      id: 'extract-dispatch-policies',
      proposed_owns: seams.map((seam) => ({
        todo_id: seam.todo_id,
        resources: [
          { kind: 'symbol', target: seam.symbol },
          { kind: 'path', target: seam.path },
        ],
      })),
      preconditions: [
        'characterization verifier is green',
        'post-transform Codegraph query set resolves proposed surfaces',
      ],
    };
  }
  const artifact = {
    schema: 'lattice.boundary_verdict.v1',
    boundary_manifest_digest: digestArtifact(manifest),
    verdicts: [{
      id: 'channel-label-verdict',
      todo_ids: manifest.todos.map(({ id }) => id),
      verdict,
      conflict_ids: manifest.conflicts.map(({ id }) => id),
      seam_candidate: seamCandidate,
      reasons,
      unknowns: manifest.unknowns,
    }],
  };
  if (!validateBoundaryVerdict(artifact)) {
    fail('生成したboundary verdictがpublic contractを満たさない');
  }
  return artifact;
}

function compilePlan(planInput, manifest) {
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
  const serialized = edges.length > 0;
  const waves = serialized
    ? planInput.todos.map((todo, index) => ({ index, todo_ids: [todo.id] }))
    : [{ index: 0, todo_ids: planInput.todos.map(({ id }) => id) }];
  const graph = {
    schema: 'lattice.plan_graph.v1',
    plan_version: planInput.plan_version,
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
  if (!validatePlanGraph(graph)) {
    fail('生成したcontrol plan graphがpublic contractを満たさない');
  }
  return graph;
}

/**
 * RC1 original fixtureをboundary manifest、typed verdict、control planへcompileする。
 * @param {object} options
 * @returns {object}
 */
export function compileControlArtifacts({
  planInput,
  manualEvidence,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest,
} = {}) {
  for (const value of [planInput, manualEvidence, querySet, codegraphEvidence]) {
    canonicalizeArtifact(value);
  }
  if (!validatePlanInput(planInput)) fail('plan inputがpublic contractを満たさない');
  if (typeof codeSnapshotDigest !== 'string' || !SHA256.test(codeSnapshotDigest)) {
    fail('code snapshot digestがSHA-256でない');
  }
  assertManualEvidence(planInput, manualEvidence);
  assertQuerySet(querySet);
  assertCodegraphEvidence(querySet, codegraphEvidence);
  const seams = rc1Seams(planInput);
  assertRc1QueryCoverage(planInput, querySet, seams);
  const facts = controlGraphFacts(planInput, querySet, codegraphEvidence, seams);
  const boundaryManifest = compileManifest({
    planInput,
    manualEvidence,
    querySet,
    codegraphEvidence,
    codeSnapshotDigest,
    seams,
    facts,
  });
  const boundaryVerdict = compileVerdict(boundaryManifest, seams, manualEvidence);
  const planGraph = compilePlan(planInput, boundaryManifest);
  return {
    boundary_manifest: boundaryManifest,
    boundary_manifest_digest: digestArtifact(boundaryManifest),
    boundary_verdict: boundaryVerdict,
    boundary_verdict_digest: digestArtifact(boundaryVerdict),
    plan_graph: planGraph,
    plan_graph_digest: digestArtifact(planGraph),
  };
}
