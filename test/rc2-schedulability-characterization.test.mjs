import assert from 'node:assert/strict';
import test from 'node:test';

const V2_MODULE = '../src/schedulability-compiler-v2.mjs';
const V2_VERIFIER_MODULE = '../src/schedulability-verifier-v2.mjs';

function graph({
  todos = ['A', 'B', 'C'],
  conflicts = [],
  precedences = [],
  unknowns = [],
  capacity = 3,
} = {}) {
  return {
    schema_version: 'lattice.normalized_boundary_graph.v2',
    todos,
    conflicts,
    precedences,
    unknowns,
    capacity,
  };
}

function conflict(left, right, resourceId = 'shared-resource') {
  return { todo_ids: [left, right], resource_id: resourceId };
}

function precedence(from, to, reason = 'hard-need') {
  return { from_todo_id: from, to_todo_id: to, reason };
}

function assertCompiled(result, waves) {
  assert.equal(result.outcome, 'compiled');
  assert.ok(Array.isArray(result.pairwise_verdicts));
  assert.equal(result.plan.schema_version, 'lattice.plan_graph.v2');
  assert.deepEqual(result.plan.waves, waves.map((todoIds) => ({ todo_ids: todoIds })));
  assert.equal(result.plan.minimum_feasible_waves, waves.length);
}

function assertTypedVerdict(result, type, predicate) {
  assert.ok(result.pairwise_verdicts.some((verdict) => verdict.type === type && predicate(verdict)));
}

function plan(waves, minimumFeasibleWaves = waves.length) {
  return {
    schema_version: 'lattice.plan_graph.v2',
    waves: waves.map((todoIds) => ({ todo_ids: todoIds })),
    minimum_feasible_waves: minimumFeasibleWaves,
  };
}

test('v1 boundary verdict rejects a three-TODO verdict', async () => {
  const { validateBoundaryVerdict } = await import('../src/artifact-contracts.mjs');
  const verdict = {
    schema: 'lattice.boundary_verdict.v1',
    boundary_manifest_digest: 'a'.repeat(64),
    verdicts: [{
      id: 'three-todo-verdict',
      todo_ids: ['A', 'B', 'C'],
      verdict: 'intentional_serial',
      conflict_ids: [],
      seam_candidate: null,
      reasons: ['v1 verdict arity is fixed at two TODOs'],
      unknowns: [],
    }],
  };

  assert.equal(validateBoundaryVerdict(verdict), false);
});

test('v1 plan validator accepts a non-minimal single-edge plus isolated schedule when it self-reports three waves', async () => {
  const { validatePlanGraph } = await import('../src/artifact-contracts.mjs');
  const plan = {
    schema: 'lattice.plan_graph.v1',
    plan_version: 'rc2-characterization-v1',
    source_manifest_digest: 'b'.repeat(64),
    capacity: { writers: 3 },
    nodes: [
      { id: 'A', outcome: 'A', owned_boundaries: [{ kind: 'symbol', target: 'shared' }] },
      { id: 'B', outcome: 'B', owned_boundaries: [{ kind: 'symbol', target: 'shared' }] },
      { id: 'C', outcome: 'C', owned_boundaries: [{ kind: 'symbol', target: 'isolated' }] },
    ],
    edges: [{
      id: 'A-B-conflict',
      from: 'A',
      to: 'B',
      kind: 'write_conflict',
      evidence_refs: ['A-B-conflict'],
    }],
    joins: [],
    waves: [
      { index: 0, todo_ids: ['A'] },
      { index: 1, todo_ids: ['B'] },
      { index: 2, todo_ids: ['C'] },
    ],
    minimum_feasible_waves: 3,
  };

  assert.equal(validatePlanGraph(plan), true);
});

test('v2 compiles K3 into three canonical singleton waves', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({
    conflicts: [conflict('A', 'B', 'AB'), conflict('A', 'C', 'AC'), conflict('B', 'C', 'BC')],
  }));

  assertCompiled(result, [['A'], ['B'], ['C']]);
  assert.equal(result.pairwise_verdicts.filter(({ type }) => type === 'conflict').length, 3);
});

test('v2 packs an empty capacity-three graph into one canonical wave', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph());

  assertCompiled(result, [['A', 'B', 'C']]);
});

test('v2 splits an empty capacity-two graph into canonical waves', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({ capacity: 2 }));

  assertCompiled(result, [['A', 'B'], ['C']]);
});

test('v2 compiles a single conflict edge plus an isolated TODO without over-serializing', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({ conflicts: [conflict('A', 'B')] }));

  assertCompiled(result, [['A', 'C'], ['B']]);
  assertTypedVerdict(result, 'conflict', (verdict) => verdict.resource_id === 'shared-resource');
});

test('v2 compiles an A-B-C conflict path in two canonical waves', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({
    conflicts: [conflict('A', 'B', 'AB'), conflict('B', 'C', 'BC')],
  }));

  assertCompiled(result, [['A', 'C'], ['B']]);
});

test('v2 preserves hard precedence separately from conflict semantics', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({
    conflicts: [conflict('B', 'C', 'BC')],
    precedences: [precedence('A', 'B')],
  }));

  assert.equal(result.outcome, 'compiled');
  assertTypedVerdict(result, 'precedence', (verdict) => (
    verdict.from_todo_id === 'A' && verdict.to_todo_id === 'B'
  ));
  assertTypedVerdict(result, 'conflict', (verdict) => (
    verdict.todo_ids.includes('B') && verdict.todo_ids.includes('C')
  ));
  const waveByTodo = new Map(result.plan.waves.flatMap((wave, index) => (
    wave.todo_ids.map((todoId) => [todoId, index])
  )));
  assert.ok(waveByTodo.get('A') < waveByTodo.get('B'));
  assert.notEqual(waveByTodo.get('B'), waveByTodo.get('C'));
});

test('v2 canonicalizes TODO permutations to the same result', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const original = compileSchedulabilityGraphV2(graph({ conflicts: [conflict('A', 'B')] }));
  const permuted = compileSchedulabilityGraphV2(graph({
    todos: ['C', 'B', 'A'],
    conflicts: [conflict('B', 'A')],
  }));

  assert.deepEqual(permuted, original);
});

test('v2 preserves graph shape and minimum under ID and resource rename', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const original = compileSchedulabilityGraphV2(graph({ conflicts: [conflict('A', 'B', 'AB')] }));
  const renamed = compileSchedulabilityGraphV2(graph({
    todos: ['X', 'Y', 'Z'],
    conflicts: [conflict('X', 'Y', 'renamed-resource')],
  }));

  assert.equal(renamed.outcome, original.outcome);
  assert.equal(renamed.plan.minimum_feasible_waves, original.plan.minimum_feasible_waves);
  assert.deepEqual(renamed.plan.waves.map(({ todo_ids: todoIds }) => todoIds.map(() => '*')),
    original.plan.waves.map(({ todo_ids: todoIds }) => todoIds.map(() => '*')));
});

test('v2 fails closed for an unknown on only the third TODO', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({
    unknowns: [{ todo_id: 'C', kind: 'dynamic', reason: 'unresolved third-only boundary' }],
  }));

  assert.equal(result.outcome, 'unknown');
  assert.equal(result.code, 'BOUNDARY_UNKNOWN');
  assert.equal(Object.hasOwn(result, 'plan'), false);
});

test('v2 returns typed unsupported for nine TODO nodes', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph({
    todos: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  }));

  assert.equal(result.outcome, 'unsupported');
  assert.equal(result.code, 'NODE_LIMIT_EXCEEDED');
  assert.equal(Object.hasOwn(result, 'plan'), false);
});

test('v2 returns typed unsupported when its search budget is exhausted', async () => {
  const { compileSchedulabilityGraphV2 } = await import(V2_MODULE);
  const result = compileSchedulabilityGraphV2(graph(), { maxSearchStates: 0 });

  assert.equal(result.outcome, 'unsupported');
  assert.equal(result.code, 'SEARCH_BUDGET_EXHAUSTED');
  assert.equal(Object.hasOwn(result, 'plan'), false);
});

test('v2 verifier independently accepts a feasible minimum conflict schedule', async () => {
  const { verifySchedulabilityPlanV2 } = await import(V2_VERIFIER_MODULE);
  const result = verifySchedulabilityPlanV2(
    graph({ conflicts: [conflict('A', 'B')], capacity: 3 }),
    plan([['A', 'C'], ['B']], 2),
  );

  assert.equal(result.outcome, 'verified');
  assert.equal(result.minimum_feasible_waves, 2);
});

test('v2 verifier rejects a feasible but non-minimum self-reported schedule', async () => {
  const { verifySchedulabilityPlanV2 } = await import(V2_VERIFIER_MODULE);
  const result = verifySchedulabilityPlanV2(
    graph({ conflicts: [conflict('A', 'B')], capacity: 3 }),
    plan([['A'], ['B'], ['C']], 3),
  );

  assert.equal(result.outcome, 'rejected');
  assert.equal(result.code, 'NON_MINIMUM_SCHEDULE');
  assert.equal(result.minimum_feasible_waves, 2);
});

test('v2 verifier rejects conflict co-location', async () => {
  const { verifySchedulabilityPlanV2 } = await import(V2_VERIFIER_MODULE);
  const result = verifySchedulabilityPlanV2(
    graph({ conflicts: [conflict('A', 'B')], capacity: 3 }),
    plan([['A', 'B', 'C']], 1),
  );

  assert.equal(result.outcome, 'rejected');
  assert.equal(result.code, 'CONFLICT_COLOCATED');
});

test('v2 verifier rejects a hard precedence violation', async () => {
  const { verifySchedulabilityPlanV2 } = await import(V2_VERIFIER_MODULE);
  const result = verifySchedulabilityPlanV2(
    graph({ precedences: [precedence('A', 'B')], capacity: 3 }),
    plan([['B', 'C'], ['A']], 2),
  );

  assert.equal(result.outcome, 'rejected');
  assert.equal(result.code, 'PRECEDENCE_VIOLATION');
});

test('v2 verifier rejects a capacity-exceeding wave', async () => {
  const { verifySchedulabilityPlanV2 } = await import(V2_VERIFIER_MODULE);
  const result = verifySchedulabilityPlanV2(
    graph({ capacity: 2 }),
    plan([['A', 'B', 'C']], 1),
  );

  assert.equal(result.outcome, 'rejected');
  assert.equal(result.code, 'CAPACITY_EXCEEDED');
});
