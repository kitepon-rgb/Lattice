import {
  canonicalizeArtifact,
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanDiff,
  validatePlanGraph,
  validatePlanInput,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { portableCodegraphOutcome } from './sensor-adapter.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const TREATMENT_PLAN_VERSION = 'rc1-treatment-v2';
const AFFECTED_TEST = 'test/research-dispatch-record.test.mjs';
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
  throw new TypeError(`treatment compile契約違反: ${reason}`);
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

function uniqueTextArray(value) {
  return Array.isArray(value)
    && value.length <= 256
    && value.every(nonEmptyText)
    && new Set(value).size === value.length;
}

function assertManualEvidence(planInput, manualEvidence, label) {
  if (!exactRecord(manualEvidence, ['schema', 'evidence'])
    || manualEvidence.schema !== 'lattice.manual_boundary_evidence.v1'
    || !Array.isArray(manualEvidence.evidence)
    || manualEvidence.evidence.length !== planInput.todos.length) {
    fail(`${label} manual evidence rootが不正`);
  }
  const expectedIds = planInput.todos.map(({ id }) => id);
  if (manualEvidence.evidence.some((entry, index) => !exactRecord(entry, [
    'todo_id',
    'state_reads',
    'state_writes',
    'effects',
    'unknowns',
  ])
    || entry.todo_id !== expectedIds[index]
    || !uniqueTextArray(entry.state_reads)
    || !uniqueTextArray(entry.state_writes)
    || !uniqueTextArray(entry.effects)
    || !uniqueTextArray(entry.unknowns))) {
    fail(`${label} manual evidenceがplan TODOと一致しない`);
  }
}

function assertQuerySet(querySet) {
  if (!exactRecord(querySet, ['schema', 'queries'])
    || querySet.schema !== 'lattice.codegraph_query_set.v1'
    || !Array.isArray(querySet.queries)
    || querySet.queries.length !== 10
    || new Set(querySet.queries.map(({ id }) => id)).size !== querySet.queries.length) {
    fail('query setがRC1 fixed setと一致しない');
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

function treatmentSeams(planInput) {
  if (planInput.plan_version !== 'rc1-control-v1'
    || planInput.capacity.writers !== 2
    || planInput.todos.length !== 2
    || new Set(planInput.todos.map(({ anchor }) => anchor.symbol)).size !== 1
    || new Set(planInput.todos.map(({ anchor }) => anchor.path)).size !== 1
    || planInput.todos[0].anchor.path !== planInput.project.fixture_entry) {
    fail('RC1 plan input topologyまたはcapacityがdriftした');
  }
  return planInput.todos.map((todo) => {
    const seam = SEAM_BY_CONCERN.get(todo.concern);
    if (!seam) fail(`treatment seamへ接続できないconcern: ${todo.concern}`);
    return { todo_id: todo.id, ...seam };
  });
}

function findSingleQuery(querySet, operation, target) {
  const matches = querySet.queries.filter((query) => query.operation === operation
    && (target === undefined || query.target === target));
  if (matches.length !== 1) fail(`query setに${operation}:${target ?? ''}がexactly one存在しない`);
  return matches[0];
}

function assertQueryCoverage(planInput, querySet, seams) {
  const anchorSymbol = planInput.todos[0].anchor.symbol;
  findSingleQuery(querySet, 'status');
  for (const operation of ['query', 'callers', 'callees', 'impact']) {
    findSingleQuery(querySet, operation, anchorSymbol);
  }
  for (const seam of seams) {
    findSingleQuery(querySet, 'query', seam.symbol);
    findSingleQuery(querySet, 'impact', seam.symbol);
  }
  const affected = querySet.queries.filter(({ operation }) => operation === 'affected');
  const expectedTargets = [planInput.project.fixture_entry, ...seams.map(({ path }) => path)];
  if (affected.length !== 1
    || JSON.stringify(affected[0].targets) !== JSON.stringify(expectedTargets)) {
    fail('same query setのaffected coverageがdriftした');
  }
}

function outcomeById(querySet, codegraphEvidence) {
  return new Map(querySet.queries.map((query, index) => [
    query.id,
    codegraphEvidence.outcomes[index],
  ]));
}

function exactSymbolAt(records, target, expectedPath) {
  if (!Array.isArray(records)) return false;
  const exact = records.filter((entry) => entry?.node
    && (entry.node.name === target || entry.node.qualifiedName === target));
  return exact.length === 1 && exact[0].node.filePath === expectedPath;
}

function assertReadyOutcome(outcomes, query) {
  const outcome = outcomes.get(query.id);
  if (outcome?.outcome !== 'ready') {
    fail(`Codegraph evidence ${query.id}はreadyでなく${outcome?.outcome ?? 'missing'}`);
  }
  return outcome;
}

function treatmentGraphFacts(planInput, querySet, codegraphEvidence, seams) {
  const outcomes = outcomeById(querySet, codegraphEvidence);
  const status = assertReadyOutcome(outcomes, findSingleQuery(querySet, 'status'));
  if (!status.data || !nonEmptyText(status.data.version)) {
    fail('Codegraph statusにversionがない');
  }

  const anchorSymbol = planInput.todos[0].anchor.symbol;
  const anchorPath = planInput.todos[0].anchor.path;
  const anchorQuery = assertReadyOutcome(
    outcomes,
    findSingleQuery(querySet, 'query', anchorSymbol),
  );
  if (!exactSymbolAt(anchorQuery.data, anchorSymbol, anchorPath)) {
    fail('anchor symbolがexpected pathへexact解決しない');
  }
  for (const operation of ['callers', 'callees', 'impact']) {
    const outcome = assertReadyOutcome(
      outcomes,
      findSingleQuery(querySet, operation, anchorSymbol),
    );
    if (!exactSymbolAt(outcome.resolution, anchorSymbol, anchorPath)) {
      fail(`${operation} anchor resolutionがexpected pathと一致しない`);
    }
  }
  for (const seam of seams) {
    const query = assertReadyOutcome(outcomes, findSingleQuery(querySet, 'query', seam.symbol));
    const impact = assertReadyOutcome(outcomes, findSingleQuery(querySet, 'impact', seam.symbol));
    if (!exactSymbolAt(query.data, seam.symbol, seam.path)
      || !exactSymbolAt(impact.resolution, seam.symbol, seam.path)) {
      fail(`seam ${seam.symbol}がexpected pathへexact解決しない`);
    }
  }

  const affectedQuery = querySet.queries.find(({ operation }) => operation === 'affected');
  const affected = assertReadyOutcome(outcomes, affectedQuery);
  if (!Array.isArray(affected.targets)
    || affected.targets.length !== affectedQuery.targets.length
    || affected.targets.some((entry, index) => entry.target !== affectedQuery.targets[index]
      || entry.outcome !== 'ready'
      || !entry.data
      || JSON.stringify(entry.data.affectedTests) !== JSON.stringify([AFFECTED_TEST]))) {
    fail('treatment source全体のaffected testがfixed verifierと一致しない');
  }
  return {
    codegraphVersion: status.data.version,
    affectedTests: [AFFECTED_TEST],
  };
}

function assertBundle(bundle, label) {
  if (!exactRecord(bundle, ['boundary_manifest', 'boundary_verdict', 'plan_graph'])
    || !validateBoundaryManifest(bundle.boundary_manifest)
    || !validateBoundaryVerdict(bundle.boundary_verdict)
    || !validatePlanGraph(bundle.plan_graph)) {
    fail(`${label} control artifactがpublic contractを満たさない`);
  }
  const manifestDigest = digestArtifact(bundle.boundary_manifest);
  if (bundle.boundary_verdict.boundary_manifest_digest !== manifestDigest
    || bundle.plan_graph.source_manifest_digest !== manifestDigest) {
    fail(`${label} control artifactのdigest chainが不正`);
  }
}

function assertPredecessors({
  planInput,
  manualNormal,
  manualNegative,
  querySet,
  transformArtifact,
  control,
  codeSnapshotDigest,
}) {
  if (!validateTransformArtifact(transformArtifact) || transformArtifact.status !== 'accepted') {
    fail('accepted transform predecessorが必要');
  }
  if (!exactRecord(control, ['normal', 'negative'])) {
    fail('control predecessor setが不正');
  }
  assertBundle(control.normal, 'normal');
  assertBundle(control.negative, 'negative');
  const planInputDigest = digestArtifact(planInput);
  const querySetDigest = digestArtifact(querySet);
  const normalManifestDigest = digestArtifact(control.normal.boundary_manifest);
  const normalVerdictDigest = digestArtifact(control.normal.boundary_verdict);
  const normalPlanDigest = digestArtifact(control.normal.plan_graph);
  if (control.normal.boundary_manifest.plan_input_digest !== planInputDigest
    || control.negative.boundary_manifest.plan_input_digest !== planInputDigest
    || control.normal.boundary_manifest.source.query_set_digest !== querySetDigest
    || control.negative.boundary_manifest.source.query_set_digest !== querySetDigest
    || control.normal.boundary_manifest.source.manual_evidence_digest !== digestArtifact(manualNormal)
    || control.negative.boundary_manifest.source.manual_evidence_digest !== digestArtifact(manualNegative)
    || control.normal.plan_graph.plan_version !== planInput.plan_version
    || control.negative.plan_graph.plan_version !== planInput.plan_version
    || transformArtifact.source.boundary_manifest_digest !== normalManifestDigest
    || transformArtifact.source.boundary_verdict_digest !== normalVerdictDigest
    || transformArtifact.source.control_plan_digest !== normalPlanDigest
    || transformArtifact.source.query_set_digest !== querySetDigest
    || transformArtifact.source.code_snapshot_digest
      !== control.normal.boundary_manifest.source.code_snapshot_digest) {
    fail('control／transform predecessorのdigest chainが不正');
  }
  if (codeSnapshotDigest !== transformArtifact.output.snapshot_digest
    || transformArtifact.source.code_snapshot_digest === codeSnapshotDigest) {
    fail('post-transform code snapshotがaccepted transformと一致しない');
  }
  if (control.normal.boundary_verdict.verdicts[0]?.verdict !== 'seam_candidate'
    || control.normal.plan_graph.minimum_feasible_waves !== 2
    || control.negative.boundary_verdict.verdicts[0]?.verdict !== 'intentional_serial'
    || !control.negative.boundary_manifest.conflicts.some(({ kind }) => kind === 'state')) {
    fail('control predecessorの実験topologyがdriftした');
  }
}

function manualByTodo(manualEvidence) {
  return new Map(manualEvidence.evidence.map((entry) => [entry.todo_id, entry]));
}

function manualRecordId(todoId) {
  return `manual-${todoId}`;
}

function resourcesForTodo(seam, manual) {
  const owns = [
    { kind: 'symbol', target: seam.symbol },
    { kind: 'path', target: seam.path },
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

function sharedManualConflicts(planInput, manuals) {
  const [leftTodo, rightTodo] = planInput.todos;
  const left = manuals.get(leftTodo.id);
  const right = manuals.get(rightTodo.id);
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
    result_digest: digestArtifact(portableCodegraphOutcome(codegraphEvidence.outcomes[index])),
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
  const affectedQuery = querySet.queries.find(({ operation }) => operation === 'affected');
  const conflicts = sharedManualConflicts(planInput, manuals);
  const manualEvidenceRecords = planInput.todos.map((todo) => ({
    id: manualRecordId(todo.id),
    todo_id: todo.id,
    result_digest: digestArtifact(manuals.get(todo.id)),
  }));
  const todos = planInput.todos.map((todo, index) => {
    const seam = seams[index];
    const manual = manuals.get(todo.id);
    const resources = resourcesForTodo(seam, manual);
    const conflictIds = conflicts
      .filter(({ todo_ids: todoIds }) => todoIds.includes(todo.id))
      .map(({ id }) => id);
    const unknowns = manual.unknowns.map((unknown) => `manual_unknown:${todo.id}:${unknown}`);
    return {
      id: todo.id,
      owns: resources.owns,
      reads: resources.reads,
      writes: resources.writes,
      hard_needs: [],
      conflict_ids: conflictIds,
      unknowns,
      tests: facts.affectedTests,
      evidence_refs: [
        findSingleQuery(querySet, 'query', seam.symbol).id,
        findSingleQuery(querySet, 'impact', seam.symbol).id,
        affectedQuery.id,
        manualRecordId(todo.id),
      ],
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
    unknowns: [...new Set(todos.flatMap(({ unknowns }) => unknowns))],
  };
  if (!validateBoundaryManifest(manifest)) {
    fail('生成したtreatment boundary manifestがpublic contractを満たさない');
  }
  return manifest;
}

function compileVerdict(manifest) {
  const manualUnknown = manifest.unknowns.length > 0;
  const nonCodeConflict = manifest.conflicts.some(({ kind }) => kind === 'state' || kind === 'effect');
  const verdict = manualUnknown
    ? 'unknown_requires_evidence'
    : nonCodeConflict ? 'intentional_serial' : 'parallel_ready';
  const reasons = manualUnknown
    ? ['manual unknownが残るためtreatment independenceを確定できない']
    : nonCodeConflict
      ? ['shared manual state/effect conflictはpath分離後も残る']
      : ['accepted seamとpost-transform graph evidenceがnon-overlapping ownershipを示す'];
  const artifact = {
    schema: 'lattice.boundary_verdict.v1',
    boundary_manifest_digest: digestArtifact(manifest),
    verdicts: [{
      id: 'channel-label-verdict',
      todo_ids: manifest.todos.map(({ id }) => id),
      verdict,
      conflict_ids: manifest.conflicts.map(({ id }) => id),
      seam_candidate: null,
      reasons,
      unknowns: manifest.unknowns,
    }],
  };
  if (!validateBoundaryVerdict(artifact)) {
    fail('生成したtreatment boundary verdictがpublic contractを満たさない');
  }
  return artifact;
}

function compilePlan(planInput, manifest) {
  const edgeKinds = new Map([
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
    plan_version: TREATMENT_PLAN_VERSION,
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
    fail('生成したtreatment plan graphがpublic contractを満たさない');
  }
  return graph;
}

function bundle(planInput, manualEvidence, common) {
  const boundaryManifest = compileManifest({
    planInput,
    manualEvidence,
    ...common,
  });
  const boundaryVerdict = compileVerdict(boundaryManifest);
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

function graphChanges(before, after) {
  const beforeById = new Map(before.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.map((entry) => [entry.id, entry]));
  return {
    added: [...afterById.keys()].filter((id) => !beforeById.has(id)).sort(),
    removed: [...beforeById.keys()].filter((id) => !afterById.has(id)).sort(),
    changed: [...beforeById.keys()].filter((id) => afterById.has(id)
      && digestArtifact(beforeById.get(id)) !== digestArtifact(afterById.get(id))).sort(),
  };
}

function compilePlanDiff({ controlPlan, treatmentPlan, transformArtifact, querySet }) {
  const nodeChanges = graphChanges(controlPlan.nodes, treatmentPlan.nodes);
  const edgeChanges = graphChanges(controlPlan.edges, treatmentPlan.edges);
  const diff = {
    schema: 'lattice.plan_diff.v1',
    old_plan: { version: controlPlan.plan_version, digest: digestArtifact(controlPlan) },
    new_plan: { version: treatmentPlan.plan_version, digest: digestArtifact(treatmentPlan) },
    transform: {
      status: transformArtifact.status,
      artifact_digest: digestArtifact(transformArtifact),
      patch_digest: transformArtifact.patch.digest,
      verification_digest: transformArtifact.verification.digest,
      changed_paths: transformArtifact.scope.changed_paths,
    },
    query_set_digest: digestArtifact(querySet),
    snapshots: {
      before_digest: transformArtifact.source.code_snapshot_digest,
      after_digest: transformArtifact.output.snapshot_digest,
    },
    nodes: nodeChanges,
    edges: { added: edgeChanges.added, removed: edgeChanges.removed },
    invalidated_contexts: [
      {
        kind: 'old_plan',
        ref: controlPlan.plan_version,
        reason: 'accepted seam changed the owned boundary topology; active plan is immutable',
      },
      {
        kind: 'agent_context',
        ref: 'rc1-control-agent-context',
        reason: 'the old shared-symbol ownership assumptions no longer apply',
      },
      {
        kind: 'partial_patch',
        ref: 'rc1-control-partial-patch-set',
        reason: 'patches based on the old plan cannot cross the version barrier',
      },
      {
        kind: 'interface_assumption',
        ref: 'shared-buildDispatchRecord-ownership',
        reason: 'each TODO now owns a separate policy symbol and path',
      },
    ],
    metrics: {
      write_conflicts_before: controlPlan.edges.filter(({ kind }) => kind === 'write_conflict').length,
      write_conflicts_after: treatmentPlan.edges.filter(({ kind }) => kind === 'write_conflict').length,
      hard_precedence_before: controlPlan.edges.filter(({ kind }) => kind === 'hard_need').length,
      hard_precedence_after: treatmentPlan.edges.filter(({ kind }) => kind === 'hard_need').length,
      minimum_feasible_waves_before: controlPlan.minimum_feasible_waves,
      minimum_feasible_waves_after: treatmentPlan.minimum_feasible_waves,
    },
  };
  if (!validatePlanDiff(diff)) {
    fail('生成したplan diffがpublic contractを満たさない');
  }
  return diff;
}

function conditionSummary(bundle) {
  return {
    boundary_manifest_digest: bundle.boundary_manifest_digest,
    boundary_verdict_digest: bundle.boundary_verdict_digest,
    plan_graph_digest: bundle.plan_graph_digest,
    verdict: bundle.boundary_verdict.verdicts[0].verdict,
    write_conflicts: bundle.plan_graph.edges.filter(({ kind }) => kind === 'write_conflict').length,
    state_conflicts: bundle.boundary_manifest.conflicts.filter(({ kind }) => kind === 'state').length,
    hard_precedence: bundle.plan_graph.edges.filter(({ kind }) => kind === 'hard_need').length,
    unknowns: bundle.boundary_manifest.unknowns.length,
    minimum_feasible_waves: bundle.plan_graph.minimum_feasible_waves,
  };
}

function controlSummary(bundle) {
  return conditionSummary({
    ...bundle,
    boundary_manifest_digest: digestArtifact(bundle.boundary_manifest),
    boundary_verdict_digest: digestArtifact(bundle.boundary_verdict),
    plan_graph_digest: digestArtifact(bundle.plan_graph),
  });
}

function compileComparison({
  planInput,
  manualNormal,
  manualNegative,
  querySet,
  transformArtifact,
  control,
  normal,
  negative,
  planDiff,
}) {
  const comparison = {
    schema: 'lattice.rc1.control_treatment_comparison.v1',
    fixed_inputs: {
      plan_input: digestArtifact(planInput),
      normal_manual_evidence: digestArtifact(manualNormal),
      negative_manual_evidence: digestArtifact(manualNegative),
      query_set: digestArtifact(querySet),
      capacity_writers: planInput.capacity.writers,
      verifier: transformArtifact.verification.digest,
    },
    independent_variable: {
      kind: 'accepted_seam_transform',
      artifact_digest: digestArtifact(transformArtifact),
      patch_digest: transformArtifact.patch.digest,
    },
    control: controlSummary(control.normal),
    treatment: conditionSummary(normal),
    negative_control: controlSummary(control.negative),
    negative_treatment: conditionSummary(negative),
    version_barrier: {
      old_plan: planDiff.old_plan,
      new_plan: planDiff.new_plan,
      plan_diff_digest: digestArtifact(planDiff),
      invalidated_contexts: planDiff.invalidated_contexts.map(({ kind, ref }) => ({ kind, ref })),
    },
    hypothesis_result: normal.boundary_verdict.verdicts[0].verdict === 'parallel_ready'
      && normal.plan_graph.minimum_feasible_waves === 1
      && negative.boundary_verdict.verdicts[0].verdict === 'intentional_serial'
      && negative.boundary_manifest.conflicts.some(({ kind }) => kind === 'state')
      ? 'supported_in_fixture'
      : 'refuted_in_fixture',
  };
  canonicalizeArtifact(comparison);
  return comparison;
}

/**
 * accepted RC1 seam後の同じquery setをnormal／negative boundaryと新plan versionへ再compileする。
 * @param {object} options
 * @returns {object}
 */
export function compileTreatmentArtifacts({
  planInput,
  manualNormal,
  manualNegative,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest,
  transformArtifact,
  control,
} = {}) {
  for (const value of [
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    codegraphEvidence,
    transformArtifact,
    control,
  ]) {
    canonicalizeArtifact(value);
  }
  if (!validatePlanInput(planInput)) fail('plan inputがpublic contractを満たさない');
  if (typeof codeSnapshotDigest !== 'string' || !SHA256.test(codeSnapshotDigest)) {
    fail('code snapshot digestがSHA-256でない');
  }
  assertManualEvidence(planInput, manualNormal, 'normal');
  assertManualEvidence(planInput, manualNegative, 'negative');
  assertQuerySet(querySet);
  assertCodegraphEvidence(querySet, codegraphEvidence);
  const seams = treatmentSeams(planInput);
  assertQueryCoverage(planInput, querySet, seams);
  assertPredecessors({
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    control,
    codeSnapshotDigest,
  });
  const facts = treatmentGraphFacts(planInput, querySet, codegraphEvidence, seams);
  const common = {
    querySet,
    codegraphEvidence,
    codeSnapshotDigest,
    seams,
    facts,
  };
  const normal = bundle(planInput, manualNormal, common);
  const negative = bundle(planInput, manualNegative, common);
  const planDiff = compilePlanDiff({
    controlPlan: control.normal.plan_graph,
    treatmentPlan: normal.plan_graph,
    transformArtifact,
    querySet,
  });
  const comparison = compileComparison({
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    control,
    normal,
    negative,
    planDiff,
  });
  return {
    normal,
    negative,
    plan_diff: planDiff,
    plan_diff_digest: digestArtifact(planDiff),
    comparison,
    comparison_digest: digestArtifact(comparison),
  };
}
