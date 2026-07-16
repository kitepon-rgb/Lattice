import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const CONTRACTS_MODULE = '../src/artifact-contracts-v2.mjs';
const OBSERVATION_COMPILER_MODULE = '../src/boundary-observation-compiler-v2.mjs';
const SCHEDULABILITY_COMPILER_MODULE = '../src/schedulability-compiler-v2.mjs';

function digest(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

function provenance(source, status, evidenceRef = `${source}-evidence`) {
  return {
    source,
    evidence_ref: evidenceRef,
    evidence_digest: digest(evidenceRef),
    status,
  };
}

function observationSet({ resources = [], precedences = [], todos = ['A', 'B', 'C'], capacity = 3 } = {}) {
  return {
    schema_version: 'lattice.boundary_observation_set.v2',
    source: {
      snapshot_digest: digest('snapshot'),
      candidate_witness_digest: digest('candidate-witness'),
      query_set_digest: digest('query-set'),
      manual_evidence_digest: digest('manual-evidence'),
    },
    capacity,
    todos,
    resources,
    precedences,
  };
}

function resource({
  resourceId = 'shared-symbol',
  kind = 'symbol',
  target = 'sharedSymbol',
  todoIds = ['A', 'B', 'C'],
  provenanceEntries = [
    provenance('codegraph', 'ready'),
    provenance('manual_candidate_spec', 'asserted'),
  ],
} = {}) {
  return {
    resource_id: resourceId,
    kind,
    target,
    todo_ids: todoIds,
    provenance: provenanceEntries,
  };
}

function plan(waves, minimumFeasibleWaves = waves.length) {
  return {
    schema_version: 'lattice.plan_graph.v2',
    waves: waves.map((todoIds) => ({ todo_ids: todoIds })),
    minimum_feasible_waves: minimumFeasibleWaves,
  };
}

function clone(value) {
  return structuredClone(value);
}

test('v2 observation compiler emits an observed K3 bundle with a valid normalized graph', async () => {
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  const {
    validateNormalizedBoundaryBundleV2,
    validateNormalizedBoundaryGraphV2,
  } = await import(CONTRACTS_MODULE);
  const bundle = compileBoundaryObservationV2(observationSet({ resources: [resource()] }));

  assert.equal(bundle.schema_version, 'lattice.normalized_boundary_bundle.v2');
  assert.deepEqual(Object.keys(bundle.graph).sort(), [
    'capacity', 'conflicts', 'precedences', 'schema_version', 'todos', 'unknowns',
  ]);
  assert.equal(bundle.resources[0].status, 'observed');
  assert.equal(bundle.graph.conflicts.length, 3);
  assert.deepEqual(bundle.graph.unknowns, []);
  assert.equal(validateNormalizedBoundaryGraphV2(bundle.graph), true);
  assert.equal(validateNormalizedBoundaryBundleV2(bundle), true);
});

test('v2 observation compiler canonicalizes resource, TODO, and provenance input permutations', async () => {
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  await import(CONTRACTS_MODULE);
  const first = observationSet({ resources: [resource()] });
  const second = clone(first);
  second.todos.reverse();
  second.resources[0].todo_ids.reverse();
  second.resources[0].provenance.reverse();

  assert.deepEqual(compileBoundaryObservationV2(second), compileBoundaryObservationV2(first));
});

test('v2 observation compiler preserves Codegraph empty ownership as per-TODO unknowns', async () => {
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  await import(CONTRACTS_MODULE);
  const { compileSchedulabilityGraphV2 } = await import(SCHEDULABILITY_COMPILER_MODULE);
  const bundle = compileBoundaryObservationV2(observationSet({
    resources: [resource({ provenanceEntries: [
      provenance('codegraph', 'empty'),
      provenance('manual_candidate_spec', 'asserted'),
    ] })],
  }));

  assert.equal(bundle.graph.conflicts.length, 0);
  assert.deepEqual(bundle.graph.unknowns.map(({ todo_id: todoId }) => todoId), ['A', 'B', 'C']);
  assert.equal(compileSchedulabilityGraphV2(bundle.graph).outcome, 'unknown');
});

test('v2 observation compiler derives only the manual state partial conflict', async () => {
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  await import(CONTRACTS_MODULE);
  const bundle = compileBoundaryObservationV2(observationSet({
    resources: [resource({
      resourceId: 'shared-state',
      kind: 'state',
      target: 'deliveryPolicy',
      todoIds: ['B', 'C'],
      provenanceEntries: [provenance('manual_state_effect', 'asserted')],
    })],
  }));

  assert.equal(bundle.resources[0].status, 'observed');
  assert.deepEqual(bundle.graph.conflicts, [{ todo_ids: ['B', 'C'], resource_id: 'shared-state' }]);
});

test('v2 observation compiler fails loudly when symbol ownership lacks manual candidate provenance', async () => {
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  await import(CONTRACTS_MODULE);
  const input = observationSet({ resources: [resource({
    provenanceEntries: [provenance('codegraph', 'ready')],
  })] });

  assert.throws(() => compileBoundaryObservationV2(input));
});

test('v2 bundle validator rechecks graph, graph digest, and resource provenance', async () => {
  const { validateNormalizedBoundaryBundleV2 } = await import(CONTRACTS_MODULE);
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  const bundle = compileBoundaryObservationV2(observationSet({ resources: [resource()] }));

  const graphCorruption = clone(bundle);
  graphCorruption.graph.conflicts[0].resource_id = 'mutated-resource';
  assert.equal(validateNormalizedBoundaryBundleV2(graphCorruption), false);

  const digestCorruption = clone(bundle);
  digestCorruption.graph_digest = digest('wrong-graph-digest');
  assert.equal(validateNormalizedBoundaryBundleV2(digestCorruption), false);

  const provenanceCorruption = clone(bundle);
  provenanceCorruption.resources[0].provenance[0].source = 'manual_state_effect';
  assert.equal(validateNormalizedBoundaryBundleV2(provenanceCorruption), false);
});

test('v2 boundary verdict validator requires the exact graph-derived verdict set and digest', async () => {
  const { validateBoundaryVerdictV2 } = await import(CONTRACTS_MODULE);
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  const { compileSchedulabilityGraphV2 } = await import(SCHEDULABILITY_COMPILER_MODULE);
  const bundle = compileBoundaryObservationV2(observationSet({ resources: [resource()] }));
  const compiled = compileSchedulabilityGraphV2(bundle.graph);
  const verdict = {
    schema_version: 'lattice.boundary_verdict.v2',
    normalized_graph_digest: bundle.graph_digest,
    verdicts: compiled.pairwise_verdicts,
  };

  assert.equal(validateBoundaryVerdictV2(verdict, bundle.graph), true);

  const missing = clone(verdict);
  missing.verdicts.pop();
  assert.equal(validateBoundaryVerdictV2(missing, bundle.graph), false);

  const extra = clone(verdict);
  extra.verdicts.push({ type: 'conflict', todo_ids: ['A', 'B'], resource_id: 'extra' });
  assert.equal(validateBoundaryVerdictV2(extra, bundle.graph), false);

  const wrongDigest = clone(verdict);
  wrongDigest.normalized_graph_digest = digest('wrong-normalized-graph');
  assert.equal(validateBoundaryVerdictV2(wrongDigest, bundle.graph), false);
});

test('v2 plan validator accepts only independently verified minimum plans', async () => {
  const { validatePlanGraphV2 } = await import(CONTRACTS_MODULE);
  const { compileBoundaryObservationV2 } = await import(OBSERVATION_COMPILER_MODULE);
  const stateBundle = compileBoundaryObservationV2(observationSet({ resources: [resource({
    resourceId: 'shared-state',
    kind: 'state',
    target: 'deliveryPolicy',
    todoIds: ['B', 'C'],
    provenanceEntries: [provenance('manual_state_effect', 'asserted')],
  })] }));

  assert.equal(validatePlanGraphV2(plan([['A', 'B'], ['C']], 2), stateBundle.graph), true);
  assert.equal(validatePlanGraphV2(plan([['A'], ['B'], ['C']], 3), stateBundle.graph), false);
  assert.equal(validatePlanGraphV2(plan([['A', 'B', 'C']], 1), stateBundle.graph), false);

  const precedenceBundle = compileBoundaryObservationV2(observationSet({
    precedences: [{
      from_todo_id: 'A',
      to_todo_id: 'B',
      reason: 'hard-need',
      provenance: [provenance('manual_candidate_spec', 'asserted')],
    }],
  }));
  assert.equal(validatePlanGraphV2(plan([['B', 'C'], ['A']], 2), precedenceBundle.graph), false);

  const capacityBundle = compileBoundaryObservationV2(observationSet({ capacity: 2 }));
  assert.equal(validatePlanGraphV2(plan([['A', 'B', 'C']], 1), capacityBundle.graph), false);
});
