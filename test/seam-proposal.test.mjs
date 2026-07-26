import assert from 'node:assert/strict';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { compileRuntimePlanV1 } from '../src/runtime-front-end.mjs';
import {
  buildVirtualWitness,
  compileSeamProposalDecision,
  createVirtualCompileReceipt,
  declaredConcernSymbols,
  deriveVirtualBoundary,
  enumerateCutSkeletons,
  evaluateSeamProposalCandidates,
  resolveConcernAnchors,
  verifyVirtualCompileReceipt,
} from '../src/seam-proposal.mjs';
import { validateSeamProposal } from '../src/seam-proposal-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';

const BASE_SHA = 'a'.repeat(40);
const DIGEST = (character) => character.repeat(64);

function statusRaw() {
  return {
    operation: 'status',
    data: {
      initialized: true,
      version: 'test',
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      index: { state: 'complete', pendingRefs: 0 },
    },
  };
}

function symbolRaw(name, path) {
  return {
    operation: 'query',
    data: [{ node: { name, qualifiedName: name, filePath: path } }],
  };
}

function affectedRaw(path, tests) {
  return {
    operation: 'affected',
    data: {
      changedFiles: [path],
      affectedTests: tests,
      totalDependentsTraversed: tests.length + 1,
    },
  };
}

function sealRequest(request) {
  request.request_digest = '';
  request.request_digest = selfDigest(request, 'request_digest');
  return request;
}

function runtimeParityFixture() {
  const todos = [
    {
      id: 'SP1',
      symbol: 'validateSeamProposal',
      path: 'src/seam-proposal-contracts.mjs',
      tests: ['test/seam-proposal-contracts.test.mjs'],
    },
    {
      id: 'SP2',
      symbol: 'buildSeamProposalQuerySet',
      path: 'src/seam-proposal-queries.mjs',
      tests: ['test/seam-proposal-queries.test.mjs'],
    },
  ];
  const queries = [{ id: 'q-status', operation: 'status' }];
  const outcomes = [{
    query_id: 'q-status', operation: 'status', status: 'ready', raw: statusRaw(),
  }];
  const manualWitness = {};
  for (const todo of todos) {
    const symbolId = `q-symbol-${todo.id}`;
    const affectedId = `q-affected-${todo.id}`;
    queries.push({ id: symbolId, operation: 'query', target: todo.symbol });
    queries.push({ id: affectedId, operation: 'affected', target: todo.path });
    outcomes.push({
      query_id: symbolId,
      operation: 'query',
      status: 'ready',
      raw: symbolRaw(todo.symbol, todo.path),
    });
    outcomes.push({
      query_id: affectedId,
      operation: 'affected',
      status: 'ready',
      raw: affectedRaw(todo.path, todo.tests),
    });
    manualWitness[todo.id] = {
      owns: [
        { kind: 'symbol', target: todo.symbol },
        { kind: 'path', target: todo.path },
      ],
      reads: todo.id === 'SP1' ? ['src/seam-proposal-queries.mjs'] : [],
      writes: [todo.path],
      resources: ['shared-bare', 'shared-effect', 'shared-state'],
      state_effects: [
        { resource_id: 'shared-effect', kind: 'effect' },
        { resource_id: 'shared-state', kind: 'state' },
      ],
      sensor_provenance: {
        queries: [
          {
            query_id: symbolId,
            expect: { kind: 'symbol', name: todo.symbol, path: todo.path },
          },
          { query_id: affectedId, expect: { kind: 'affected', path: todo.path } },
        ],
      },
      affected_tests: todo.tests,
      unknowns: [],
    };
  }
  return {
    request: sealRequest({
      schema: 'lattice.run_request.v1',
      request_id: 'seam-runtime-parity',
      repo: { base_sha: BASE_SHA, root_kind: 'git-worktree' },
      capacity: { executors: 2 },
      todos: todos.map(({ id }) => ({ todo_id: id })),
      manual_witness: manualWitness,
      sensor_query_set: { queries },
      executor_capability: { adapters: ['scripted'] },
      claim_mode: 'exact_minimum',
      request_digest: '',
    }),
    sensorEvidence: { outcomes },
  };
}

function proposalEvidence() {
  const value = {
    query_set_digest: DIGEST('b'),
    evidence_digest: '',
    queries: [{
      query_id: 'q-current-path',
      operation: 'affected',
      target: 'src/seam-proposal.mjs',
      outcome: 'resolved',
      resolved_name: null,
      resolved_path: 'src/seam-proposal.mjs',
      candidate_paths: [],
      result_digest: DIGEST('c'),
    }],
  };
  value.evidence_digest = todoSelfDigest(value, 'evidence_digest');
  return value;
}

function sharedFixture({ uniqueAnchors = true } = {}) {
  const taskRows = [
    {
      id: 'CUT1',
      symbol: uniqueAnchors ? 'buildVirtualWitness' : 'deriveVirtualBoundary',
      path: 'src/seam-proposal.mjs',
      testPath: uniqueAnchors
        ? 'test/seam-proposal-contracts.test.mjs'
        : 'test/seam-proposal.test.mjs',
    },
    {
      id: 'CUT2',
      symbol: 'deriveVirtualBoundary',
      path: 'src/seam-proposal.mjs',
      testPath: 'test/seam-proposal.test.mjs',
    },
  ];
  const queries = [{ id: 'q-status', operation: 'status' }];
  const outcomes = [{
    query_id: 'q-status', operation: 'status', status: 'ready', raw: statusRaw(),
  }];
  const manualWitness = {};
  for (const task of taskRows) {
    const queryId = `q-symbol-${task.id}`;
    if (!queries.some((query) => query.id === queryId)) {
      queries.push({ id: queryId, operation: 'query', target: task.symbol });
      outcomes.push({
        query_id: queryId,
        operation: 'query',
        status: 'ready',
        raw: symbolRaw(task.symbol, task.path),
      });
    }
    manualWitness[task.id] = {
      owns: uniqueAnchors
        ? [
          { kind: 'path', target: 'src/seam-proposal.mjs' },
          { kind: 'symbol', target: task.symbol },
        ]
        : [{ kind: 'path', target: 'src/seam-proposal.mjs' }],
      reads: [],
      writes: ['src/seam-proposal.mjs'],
      resources: [],
      state_effects: [],
      sensor_provenance: uniqueAnchors ? {
        queries: [{
          query_id: queryId,
          expect: { kind: 'symbol', name: task.symbol, path: task.path },
        }],
      } : { queries: [] },
      affected_tests: uniqueAnchors
        ? [task.testPath]
        : ['test/seam-proposal.test.mjs'],
      unknowns: [],
    };
  }
  return {
    request: sealRequest({
      schema: 'lattice.run_request.v1',
      request_id: uniqueAnchors ? 'seam-cut' : 'seam-cut-unbound',
      repo: { base_sha: BASE_SHA, root_kind: 'git-worktree' },
      capacity: { executors: 2 },
      todos: taskRows.map(({ id }) => ({ todo_id: id })),
      manual_witness: manualWitness,
      sensor_query_set: { queries },
      executor_capability: { adapters: ['scripted'] },
      claim_mode: 'exact_minimum',
      request_digest: '',
    }),
    sensorEvidence: { outcomes },
    component: {
      component_id: 'component-cut',
      task_ids: ['CUT1', 'CUT2'],
      conflicts: [{
        resource_id: 'own-path-current',
        kind: 'path',
        target: 'src/seam-proposal.mjs',
        task_pairs: [['CUT1', 'CUT2']],
      }],
    },
    evidence: proposalEvidence(),
  };
}

function candidateSpec(fixture, suffix, mutate = () => {}) {
  const paths = {
    CUT1: `src/cuts/${suffix}-one.mjs`,
    CUT2: `src/cuts/${suffix}-two.mjs`,
  };
  const ownershipDiff = fixture.component.task_ids.map((taskId) => {
    const original = fixture.request.manual_witness[taskId];
    const symbolOwns = original.owns.filter(({ kind }) => kind === 'symbol');
    return {
      todo_id: taskId,
      owns: [...symbolOwns, { kind: 'path', target: paths[taskId] }],
      reads: [],
      writes: [paths[taskId]],
      resources: [],
      state_effects: [],
      sensor_provenance: structuredClone(original.sensor_provenance),
      affected_tests: structuredClone(original.affected_tests),
      unknowns: [],
    };
  });
  const proposedSurfaces = fixture.component.task_ids.map((taskId) => ({
    kind: 'path',
    target: paths[taskId],
    path: paths[taskId],
    role: 'task_owned',
    owner_task_ids: [taskId],
  }));
  const surfaceHypotheses = fixture.component.task_ids.map((taskId) => ({
    kind: 'path',
    target: paths[taskId],
    path: paths[taskId],
    owner_task_id: taskId,
    affected_tests: structuredClone(
      fixture.request.manual_witness[taskId].affected_tests,
    ),
    provenance: 'extraction_hypothesis',
  }));
  const spec = {
    candidate_id: `candidate-${suffix}`,
    ownership_diff: ownershipDiff,
    proposed_surfaces: proposedSurfaces,
    surface_hypotheses: surfaceHypotheses,
    raw_graph: {
      nodes: [{
        kind: 'path',
        target: 'src/seam-proposal.mjs',
        path: 'src/seam-proposal.mjs',
      }],
      edges: [],
    },
  };
  mutate(spec, paths);
  return spec;
}

function compileDecision(fixture, candidateSpecs, overrides = {}) {
  return evaluateSeamProposalCandidates({
    component: fixture.component,
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    evidence: fixture.evidence,
    candidateSpecs,
    ...overrides,
  });
}

function enumerationFixture({ uniqueAnchors = true } = {}) {
  const fixture = sharedFixture({ uniqueAnchors });
  const target = 'compileSeamProposalDecision';
  const path = 'src/seam-proposal.mjs';
  fixture.component = {
    component_id: 'component-symbol-cut',
    task_ids: ['CUT1', 'CUT2'],
    conflicts: [{
      resource_id: 'own-symbol-compile',
      kind: 'symbol',
      target,
      task_pairs: [['CUT1', 'CUT2']],
    }],
  };
  const operations = ['callers', 'callees', 'impact', 'query'];
  const queries = operations.map((operation) => ({
    query_id: `raw-${operation}`,
    operation,
    target,
    outcome: 'resolved',
    resolved_name: target,
    resolved_path: path,
    candidate_paths: [],
    result_digest: DIGEST(operation[0]),
  })).sort((left, right) => left.query_id.localeCompare(right.query_id));
  fixture.evidence = {
    query_set_digest: DIGEST('7'),
    evidence_digest: '',
    queries,
  };
  fixture.evidence.evidence_digest = todoSelfDigest(fixture.evidence, 'evidence_digest');
  const existing = [
    { name: 'buildVirtualWitness', kind: 'function', filePath: path, startLine: 95 },
    { name: 'deriveVirtualBoundary', kind: 'function', filePath: path, startLine: 345 },
  ];
  fixture.rawCollected = {
    cwd: '/repo',
    outcomes: operations.map((operation) => ({
      id: `raw-${operation}`,
      operation,
      target,
      outcome: 'ready',
      ...(operation === 'query'
        ? { data: [{ node: { name: target, qualifiedName: target, filePath: path } }] }
        : operation === 'callers'
          ? { data: { symbol: target, callers: [] } }
          : operation === 'callees'
            ? { data: { symbol: target, callees: existing } }
            : {
              data: {
                symbol: target,
                affected: [
                  ...existing,
                  {
                    name: 'seam-proposal.test.mjs',
                    kind: 'file',
                    filePath: 'test/seam-proposal.test.mjs',
                    startLine: 1,
                  },
                ],
              },
            }),
    })),
    graph_closure: {
      complete: true,
      node_limit: 64,
      expansions: existing.map((parent) => ({
        parent,
        query_outcome: {
          operation: 'query',
          outcome: 'ready',
          data: [{ node: { name: parent.name, filePath: parent.filePath } }],
        },
        callees_outcome: {
          operation: 'callees',
          outcome: 'ready',
          data: { symbol: parent.name, callees: [] },
        },
        exact: true,
      })),
    },
  };
  return fixture;
}

test('実runtime front-endと実在surfaceのresource/conflict集合が一致する', () => {
  const fixture = runtimeParityFixture();
  const runtime = compileRuntimePlanV1({
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    planRef: 'seam-parity-v1',
    planEpoch: 1,
    predecessorRefs: [],
  });
  const virtual = deriveVirtualBoundary(fixture);

  assert.equal(runtime.outcome, 'dispatchable');
  assert.equal(virtual.outcome, 'derived');
  assert.deepEqual(virtual.resources, runtime.resources);
  assert.deepEqual(virtual.conflicts, runtime.graph.conflicts);
  assert.deepEqual(virtual.unknowns, runtime.graph.unknowns);
  assert.ok(virtual.resources.some(({ resource_id: id }) => id.startsWith('rw-')));
  assert.ok(virtual.resources.some(({ resource_id: id }) => id === 'shared-bare'));
  assert.ok(virtual.resources.some(({ kind }) => kind === 'effect'));
});

test('query driftとaffected-test driftもruntime front-endと同じtyped outcomeになる', () => {
  const queryDrift = runtimeParityFixture();
  queryDrift.request.manual_witness.SP1.sensor_provenance.queries[0].expect.name = 'notTheQueryTarget';
  sealRequest(queryDrift.request);
  const runtimeQuery = compileRuntimePlanV1({
    request: queryDrift.request,
    sensorEvidence: queryDrift.sensorEvidence,
    planRef: 'seam-drift-v1',
    planEpoch: 1,
    predecessorRefs: [],
  });
  assert.equal(runtimeQuery.code, 'QUERY_DRIFT');
  assert.equal(deriveVirtualBoundary(queryDrift).outcome, 'query_drift');

  const affectedDrift = runtimeParityFixture();
  affectedDrift.request.manual_witness.SP2.affected_tests = ['test/other.test.mjs'];
  sealRequest(affectedDrift.request);
  const runtimeAffected = compileRuntimePlanV1({
    request: affectedDrift.request,
    sensorEvidence: affectedDrift.sensorEvidence,
    planRef: 'seam-affected-v1',
    planEpoch: 1,
    predecessorRefs: [],
  });
  assert.equal(runtimeAffected.code, 'AFFECTED_TEST_DRIFT');
  assert.equal(deriveVirtualBoundary(affectedDrift).outcome, 'affected_test_drift');
});

test('明示unknownのdynamic resource集合もruntime front-endと一致する', () => {
  const fixture = runtimeParityFixture();
  fixture.request.manual_witness.SP1.unknowns = [{
    kind: 'semantic_probe',
    ref: 'unresolved owner',
  }];
  sealRequest(fixture.request);
  const runtime = compileRuntimePlanV1({
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    planRef: 'seam-unknown-v1',
    planEpoch: 1,
    predecessorRefs: [],
  });
  const virtual = deriveVirtualBoundary(fixture);

  assert.equal(runtime.code, 'BOUNDARY_UNKNOWN');
  assert.equal(virtual.outcome, 'unknown');
  assert.deepEqual(virtual.unknowns, runtime.detail.unknowns);
  assert.ok(virtual.resources.some(({ kind }) => kind === 'dynamic'));
});

test('sensor stale・absent・unboundのdynamic unknown集合もruntimeと一致する', () => {
  const fixtures = [
    (() => {
      const fixture = runtimeParityFixture();
      fixture.sensorEvidence.outcomes[0].status = 'stale';
      return fixture;
    })(),
    (() => {
      const fixture = runtimeParityFixture();
      fixture.sensorEvidence.outcomes
        .find(({ query_id: queryId }) => queryId === 'q-symbol-SP1').raw = {
          operation: 'query',
          data: [],
        };
      return fixture;
    })(),
    (() => {
      const fixture = runtimeParityFixture();
      fixture.request.manual_witness.SP1.sensor_provenance.queries = [];
      sealRequest(fixture.request);
      return fixture;
    })(),
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const runtime = compileRuntimePlanV1({
      request: fixture.request,
      sensorEvidence: fixture.sensorEvidence,
      planRef: `seam-sensor-unknown-${index}`,
      planEpoch: 1,
      predecessorRefs: [],
    });
    const virtual = deriveVirtualBoundary(fixture);
    assert.equal(runtime.code, 'BOUNDARY_UNKNOWN', `runtime ${index}`);
    assert.equal(virtual.outcome, 'unknown', `virtual ${index}`);
    assert.deepEqual(virtual.unknowns, runtime.detail.unknowns, `unknowns ${index}`);
  }
});

test('full ownership diffを要求し、ownsだけのpatchを拒否する', () => {
  const fixture = sharedFixture();
  assert.throws(() => buildVirtualWitness({
    request: fixture.request,
    ownershipDiff: [{
      todo_id: 'CUT1',
      owns: [{ kind: 'path', target: 'src/cuts/one.mjs' }],
    }],
  }), /full-field/u);
});

test('旧共有pathがwritesに残る候補はresidual conflict 0にならない', () => {
  const fixture = sharedFixture();
  const spec = candidateSpec(fixture, 'stale-write', (value, paths) => {
    for (const patch of value.ownership_diff) {
      patch.writes.push('src/seam-proposal.mjs');
      const hypothesis = value.surface_hypotheses.find(
        ({ owner_task_id: taskId }) => taskId === patch.todo_id,
      );
      assert.equal(patch.writes.includes(paths[patch.todo_id]), true);
      assert.ok(hypothesis);
    }
  });
  const decision = compileDecision(fixture, [spec]);

  assert.equal(decision.verdict, 'unknown_requires_evidence');
  assert.ok(decision.unknowns.some(({ kind }) => kind === 'virtual_boundary_unknown'));
});

test('read×write、bare resource、state/effectが残る候補はseam_candidateにならない', () => {
  const variants = [
    (spec, paths) => {
      spec.ownership_diff[1].reads = [paths.CUT1];
    },
    (spec) => {
      for (const patch of spec.ownership_diff) patch.resources = ['shared-bare'];
    },
    (spec) => {
      for (const patch of spec.ownership_diff) {
        patch.resources = ['shared-state'];
        patch.state_effects = [{ resource_id: 'shared-state', kind: 'state' }];
      }
    },
    (spec) => {
      for (const patch of spec.ownership_diff) {
        patch.resources = ['shared-effect'];
        patch.state_effects = [{ resource_id: 'shared-effect', kind: 'effect' }];
      }
    },
  ];
  for (const [index, mutate] of variants.entries()) {
    const fixture = sharedFixture();
    const decision = compileDecision(fixture, [
      candidateSpec(fixture, `residual-${index}`, mutate),
    ]);
    assert.notEqual(decision.verdict, 'seam_candidate', `variant ${index}`);
    assert.notEqual(decision.verdict, 'intentional_serial', `variant ${index}`);
  }
});

test('task固有anchorが無ければsemantic owner binding missingになる', () => {
  const fixture = sharedFixture({ uniqueAnchors: false });
  const decision = compileDecision(fixture, []);
  assert.equal(decision.verdict, 'unknown_requires_evidence');
  assert.deepEqual(decision.unknowns, [
    { kind: 'semantic_owner_binding_missing', ref: 'CUT1' },
    { kind: 'semantic_owner_binding_missing', ref: 'CUT2' },
  ]);
});

function concernEvidence(resolutions) {
  return {
    queries: Object.entries(resolutions).map(([name, path]) => ({
      query_id: `q-${name}`,
      operation: 'query',
      target: name,
      outcome: path === null ? 'absent' : 'resolved',
      resolved_name: path === null ? null : name,
      resolved_path: path,
      candidate_paths: [],
      result_digest: DIGEST('9'),
    })),
  };
}

test('宣言concern anchorはexact解決と資源内包含を満たした分だけanchorになる', () => {
  const manualWitness = {
    T1: {
      concern_anchors: [{
        within: { kind: 'path', target: 'src/shared.mjs' },
        symbols: ['renderRightPane', 'summarizeIndependence'],
      }],
    },
    T2: { concern_anchors: [] },
  };
  const resolved = resolveConcernAnchors({
    manualWitness,
    taskIds: ['T1', 'T2'],
    evidence: concernEvidence({
      renderRightPane: 'src/shared.mjs',
      summarizeIndependence: 'src/shared.mjs',
    }),
  });
  assert.deepEqual(resolved.unknowns, []);
  assert.deepEqual(resolved.anchorsByTask.get('T1'), [
    'concern:src/shared.mjs\0renderRightPane',
    'concern:src/shared.mjs\0summarizeIndependence',
  ]);
  assert.deepEqual(resolved.anchorsByTask.get('T2'), []);
});

test('解決しない・資源の外にある宣言はanchorにならずtyped unknownになる', () => {
  const manualWitness = {
    T1: {
      concern_anchors: [{
        within: { kind: 'path', target: 'src/shared.mjs' },
        symbols: ['movedAway', 'neverExisted', 'stillHere'],
      }],
    },
  };
  const resolved = resolveConcernAnchors({
    manualWitness,
    taskIds: ['T1'],
    evidence: concernEvidence({
      movedAway: 'src/elsewhere.mjs',
      neverExisted: null,
      stillHere: 'src/shared.mjs',
    }),
  });
  // 生き残るのは実在してかつ資源の中にあるものだけ。
  assert.deepEqual(resolved.anchorsByTask.get('T1'), ['concern:src/shared.mjs\0stillHere']);
  assert.deepEqual(resolved.unknowns, [
    { kind: 'concern_anchor_outside_resource', ref: 'T1:movedAway:src/elsewhere.mjs' },
    { kind: 'concern_anchor_unresolved', ref: 'T1:neverExisted' },
  ]);
});

function ambiguousEvidence(name, candidatePaths) {
  return {
    queries: [{
      query_id: `q-${name}`,
      operation: 'query',
      target: name,
      outcome: 'ambiguous',
      resolved_name: name,
      resolved_path: null,
      candidate_paths: [...candidatePaths].sort(),
      result_digest: DIGEST('a'),
    }],
  };
}

test('同名が複数fileに居ても、宣言した資源の中で一意なら束縛できる', () => {
  // ADR 0134。receiptが候補を持つ前は、この状況がまるごとunknownへ潰れていた。
  const resolved = resolveConcernAnchors({
    manualWitness: {
      T1: {
        concern_anchors: [{
          within: { kind: 'path', target: 'src/shared.mjs' },
          symbols: ['summarizeIndependence'],
        }],
      },
    },
    taskIds: ['T1'],
    evidence: ambiguousEvidence('summarizeIndependence',
      ['src/shared.mjs', 'src/elsewhere.mjs']),
  });
  assert.deepEqual(resolved.unknowns, []);
  assert.deepEqual(resolved.anchorsByTask.get('T1'),
    ['concern:src/shared.mjs\0summarizeIndependence']);
});

test('候補が資源の中に無い／中で複数ある曖昧さは、束縛せずunknownのままにする', () => {
  const anchorFor = (within) => ({
    T1: { concern_anchors: [{ within, symbols: ['duplicated'] }] },
  });

  // 資源の外にしか居ない。宣言した資源についての束縛根拠にはならない。
  const outside = resolveConcernAnchors({
    manualWitness: anchorFor({ kind: 'path', target: 'src/shared.mjs' }),
    taskIds: ['T1'],
    evidence: ambiguousEvidence('duplicated', ['src/a.mjs', 'src/b.mjs']),
  });
  assert.deepEqual(outside.anchorsByTask.get('T1'), []);
  assert.deepEqual(outside.unknowns, [
    { kind: 'concern_anchor_unresolved', ref: 'T1:duplicated' },
  ]);

  // 資源がディレクトリで、その中に2つ居る。絞っても決まらないので片方を勝たせない。
  const stillAmbiguous = resolveConcernAnchors({
    manualWitness: anchorFor({ kind: 'path', target: 'src/' }),
    taskIds: ['T1'],
    evidence: ambiguousEvidence('duplicated', ['src/a.mjs', 'src/b.mjs']),
  });
  assert.deepEqual(stillAmbiguous.anchorsByTask.get('T1'), []);
  assert.deepEqual(stillAmbiguous.unknowns, [
    { kind: 'concern_anchor_unresolved', ref: 'T1:duplicated' },
  ]);
});

test('曖昧なsymbolを資源として指した宣言は、資源の解決から絞れないのでunknownになる', () => {
  // withinがsymbolの時、その資源自身を絞る外側の宣言は無い。
  const resolved = resolveConcernAnchors({
    manualWitness: {
      T1: {
        concern_anchors: [{
          within: { kind: 'symbol', target: 'duplicated' },
          symbols: ['inner'],
        }],
      },
    },
    taskIds: ['T1'],
    evidence: ambiguousEvidence('duplicated', ['src/a.mjs', 'src/b.mjs']),
  });
  assert.deepEqual(resolved.anchorsByTask.get('T1'), []);
  assert.deepEqual(resolved.unknowns, [
    { kind: 'concern_anchor_resource_unresolved', ref: 'T1:symbol:duplicated' },
  ]);
});

test('symbol資源の宣言は資源自身の解決に依存し、未解決ならunknownへ倒れる', () => {
  const manualWitness = {
    T1: {
      concern_anchors: [{
        within: { kind: 'symbol', target: 'renderGantt' },
        symbols: ['renderRightPane'],
      }],
    },
  };
  const inside = resolveConcernAnchors({
    manualWitness,
    taskIds: ['T1'],
    evidence: concernEvidence({
      renderGantt: 'src/shared.mjs',
      renderRightPane: 'src/shared.mjs',
    }),
  });
  assert.deepEqual(inside.unknowns, []);
  assert.deepEqual(inside.anchorsByTask.get('T1'), ['concern:src/shared.mjs\0renderRightPane']);

  const unresolved = resolveConcernAnchors({
    manualWitness,
    taskIds: ['T1'],
    evidence: concernEvidence({ renderGantt: null, renderRightPane: 'src/shared.mjs' }),
  });
  assert.deepEqual(unresolved.anchorsByTask.get('T1'), []);
  assert.deepEqual(unresolved.unknowns, [
    { kind: 'concern_anchor_resource_unresolved', ref: 'T1:symbol:renderGantt' },
  ]);
});

test('同じsymbolを2 taskが主張したらどちらのanchorにもならない', () => {
  const anchorFor = (symbols) => ({
    concern_anchors: [{ within: { kind: 'path', target: 'src/shared.mjs' }, symbols }],
  });
  const resolved = resolveConcernAnchors({
    manualWitness: {
      T1: anchorFor(['contested', 'onlyT1']),
      T2: anchorFor(['contested', 'onlyT2']),
      T3: anchorFor(['onlyT3']),
    },
    taskIds: ['T1', 'T2', 'T3'],
    evidence: concernEvidence({
      contested: 'src/shared.mjs',
      onlyT1: 'src/shared.mjs',
      onlyT2: 'src/shared.mjs',
      onlyT3: 'src/shared.mjs',
    }),
  });
  // 争っているanchorは両者から落ち、固有の宣言だけが残る。
  assert.deepEqual(resolved.anchorsByTask.get('T1'), ['concern:src/shared.mjs\0onlyT1']);
  assert.deepEqual(resolved.anchorsByTask.get('T2'), ['concern:src/shared.mjs\0onlyT2']);
  assert.deepEqual(resolved.anchorsByTask.get('T3'), ['concern:src/shared.mjs\0onlyT3']);
  assert.deepEqual(resolved.unknowns, [
    { kind: 'concern_anchor_overlap', ref: 'T1,T2:src/shared.mjs:contested' },
  ]);
});

test('sensorへ問い合わせる宣言symbolは資源名まで含めて重複なく集まる', () => {
  assert.deepEqual(declaredConcernSymbols({
    T2: {
      concern_anchors: [{
        within: { kind: 'symbol', target: 'renderGantt' },
        symbols: ['renderRightPane'],
      }],
    },
    T1: {
      concern_anchors: [{
        within: { kind: 'path', target: 'src/shared.mjs' },
        symbols: ['summarizeIndependence', 'renderRightPane'],
      }],
    },
    T3: {},
  }), ['renderGantt', 'renderRightPane', 'summarizeIndependence']);
  assert.deepEqual(declaredConcernSymbols({ T1: {} }), []);
});

test('複数incomparable候補はv1のseam_candidateを名乗らない', () => {
  const fixture = sharedFixture();
  const decision = compileDecision(fixture, [
    candidateSpec(fixture, 'alpha'),
    candidateSpec(fixture, 'beta'),
  ], { explorationComplete: true });

  assert.equal(decision.verdict, 'unknown_requires_evidence');
  assert.equal(decision.seam_candidate, null);
  assert.deepEqual(decision.unknowns, [{
    kind: 'multiple_incomparable_candidates',
    ref: 'candidate-alpha,candidate-beta',
  }]);
});

test('verification digestを同じ入力から再導出し改ざんを検出する', () => {
  const fixture = sharedFixture();
  const spec = candidateSpec(fixture, 'digest');
  const virtualWitness = buildVirtualWitness({
    request: fixture.request,
    ownershipDiff: spec.ownership_diff,
  });
  const receipt = createVirtualCompileReceipt({
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    virtualWitness,
    surfaceHypotheses: spec.surface_hypotheses,
  });
  assert.equal(receipt.derivation.outcome, 'derived');
  assert.deepEqual(receipt.derivation.conflicts, []);
  assert.equal(receipt.derivation.resources
    .filter(({ status }) => status === 'hypothetical').length, 2);
  for (const resource of receipt.derivation.resources
    .filter(({ status }) => status === 'hypothetical')) {
    assert.deepEqual(resource.provenance.map(({ source }) => source), [
      'extraction_hypothesis',
    ]);
  }

  const verified = verifyVirtualCompileReceipt({
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    virtualWitness,
    surfaceHypotheses: spec.surface_hypotheses,
    verification: receipt.verification,
  });
  assert.equal(verified.valid, true);

  const forged = structuredClone(receipt.verification);
  forged.virtual_compile_result_digest = DIGEST('f');
  assert.deepEqual(verifyVirtualCompileReceipt({
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    virtualWitness,
    surfaceHypotheses: spec.surface_hypotheses,
    verification: forged,
  }).mismatches, ['virtual_compile_result_digest']);
});

test('一意なfeasible候補だけをv2 artifactへ落としcontractを満たす', () => {
  const fixture = sharedFixture();
  const decision = compileDecision(fixture, [candidateSpec(fixture, 'only')], {
    explorationComplete: true,
  });
  assert.equal(decision.verdict, 'seam_candidate');
  assert.ok(decision.seam_candidate.limits.includes('hypothetical_new_surfaces'));
  const artifact = {
    schema: 'lattice.seam_proposal.v2',
    project_id: 'lattice',
    plan_key: 'seam-proposal',
    source_binding: {
      independence_schema: 'lattice.todo_independence.v3',
      independence_result_digest: DIGEST('1'),
      witness_set_digest: DIGEST('2'),
      plan_version: 'v1',
      topology_digest: DIGEST('3'),
      base_sha: BASE_SHA,
    },
    compiled_at: '2026-07-26T00:00:00.000Z',
    decisions: [decision],
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  assert.equal(validateSeamProposal(artifact), true);
  assert.equal(
    decision.seam_candidate.verification.virtual_compile_input_digest,
    digestArtifact({
      virtual_witness: buildVirtualWitness({
        request: fixture.request,
        ownershipDiff: candidateSpec(fixture, 'only').ownership_diff,
      }),
      surface_hypotheses: candidateSpec(fixture, 'only').surface_hypotheses,
    }),
  );
});

test('intentional_serialはcomplete探索でstate/effect conflictが実際に残る時だけになる', () => {
  const fixture = sharedFixture();
  fixture.component.conflicts = [{
    resource_id: 'shared-state',
    kind: 'state',
    target: 'shared-state',
    task_pairs: [['CUT1', 'CUT2']],
  }];
  const spec = candidateSpec(fixture, 'serial-state', (value) => {
    for (const patch of value.ownership_diff) {
      patch.resources = ['shared-state'];
      patch.state_effects = [{ resource_id: 'shared-state', kind: 'state' }];
    }
  });

  assert.equal(compileDecision(fixture, [spec]).verdict, 'unknown_requires_evidence');
  const complete = compileDecision(fixture, [spec], { explorationComplete: true });
  assert.equal(complete.verdict, 'intentional_serial');
  assert.deepEqual(complete.reasons.map(({ code }) => code), [
    'unseverable_state_effect_conflict',
  ]);
});

test('実在symbol conflictのraw graphから構造cut skeletonを列挙する', () => {
  const fixture = enumerationFixture();
  const result = enumerateCutSkeletons({
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
    rawCollected: fixture.rawCollected,
  });

  assert.ok(result.skeletons.length >= 1);
  assert.ok(result.skeletons.some(({ cut_kinds: cutKinds }) => cutKinds.includes('scc')));
  assert.ok(result.skeletons.some(({ cut_kinds: cutKinds }) => (
    cutKinds.includes('callee_closure')
  )));
  assert.ok(result.skeletons.every(({ raw_graph: rawGraph }) => (
    rawGraph.nodes.some(({ target }) => target === 'compileSeamProposalDecision')
  )));
});

test('task固有anchorで束縛不能なskeletonはseam_candidateへ昇格しない', () => {
  const fixture = enumerationFixture({ uniqueAnchors: false });
  const decision = compileSeamProposalDecision({
    component: fixture.component,
    request: fixture.request,
    sensorEvidence: fixture.sensorEvidence,
    evidence: fixture.evidence,
    rawCollected: fixture.rawCollected,
  });

  assert.equal(decision.verdict, 'unknown_requires_evidence');
  assert.equal(decision.seam_candidate, null);
  assert.ok(decision.unknowns.every(({ kind }) => kind === 'semantic_owner_binding_missing'));
});

test('path conflictは宣言concernからdeclared_partition skeletonになる', () => {
  const fixture = sharedFixture({ uniqueAnchors: false });
  const path = 'src/seam-proposal.mjs';
  const concernAnchors = new Map([
    ['CUT1', [`concern:${path}\0buildVirtualWitness`]],
    ['CUT2', [`concern:${path}\0deriveVirtualBoundary`]],
  ]);
  const result = enumerateCutSkeletons({
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
    concernAnchors,
  });

  assert.deepEqual(result.unknowns, []);
  assert.equal(result.skeletons.length, 1);
  const [skeleton] = result.skeletons;
  assert.deepEqual(skeleton.cut_kinds, ['declared_partition']);
  assert.deepEqual(skeleton.root_surface, { kind: 'path', target: path, path });
  // 各taskが自分の宣言したpartitionへ、宣言anchorだけで束縛される。
  assert.deepEqual(skeleton.task_bindings.map(({ task_id: id, anchors }) => [id, anchors]), [
    ['CUT1', [`concern:${path}\0buildVirtualWitness`]],
    ['CUT2', [`concern:${path}\0deriveVirtualBoundary`]],
  ]);
  assert.equal(new Set(skeleton.task_bindings.map((b) => b.partition_index)).size, 2);
  // 現在surfaceであるpath自身がraw graphに載っている（後段のsurface照合が通る条件）。
  assert.ok(skeleton.raw_graph.nodes.some((node) => node.kind === 'path' && node.path === path));
});

test('宣言が片側だけのpath conflictは依然として資源unavailableになる', () => {
  // 両taskとも粗いanchorは持つので束縛不能ではない。欠けているのは分け方の宣言だけ。
  const fixture = sharedFixture();
  const result = enumerateCutSkeletons({
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
    concernAnchors: new Map([
      ['CUT1', ['concern:src/seam-proposal.mjs\0buildVirtualWitness']],
    ]),
  });
  assert.deepEqual(result.skeletons, []);
  assert.deepEqual(result.unknowns, [
    { kind: 'raw_graph_unavailable', ref: 'own-path-current' },
  ]);
});

test('宣言anchorは同じskeleton内で粗いanchorより優先される', () => {
  const fixture = enumerationFixture();
  const path = 'src/seam-proposal.mjs';
  // CUT1は係争symbol内のconcernを宣言し、同時にfile全体を粗く所有している。
  const withConcern = enumerateCutSkeletons({
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
    rawCollected: fixture.rawCollected,
    concernAnchors: new Map([['CUT1', [`concern:${path}\0buildVirtualWitness`]]]),
  });
  const bound = withConcern.skeletons
    .flatMap(({ task_bindings: bindings }) => bindings)
    .filter(({ task_id: id }) => id === 'CUT1');
  assert.ok(bound.length > 0);
  // 宣言が当たったskeletonでは、粗いanchorは束縛根拠に混ざらない。
  assert.ok(bound.every(({ anchors }) => anchors.every((anchor) => anchor.startsWith('concern:'))));
});

test('raw graphが無い列挙はraw_graph_unavailableへ倒れる', () => {
  const fixture = enumerationFixture();
  const result = enumerateCutSkeletons({
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
  });

  assert.deepEqual(result.skeletons, []);
  assert.deepEqual(result.unknowns, [{
    kind: 'raw_graph_unavailable',
    ref: 'own-symbol-compile',
  }]);
});

test('callee closureが収集上限で不完備ならraw_graph_incompleteへ倒れる', () => {
  const fixture = enumerationFixture();
  fixture.rawCollected.graph_closure.complete = false;
  const result = enumerateCutSkeletons({
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
    rawCollected: fixture.rawCollected,
  });

  assert.ok(result.unknowns.some(({ kind }) => kind === 'raw_graph_incomplete'));
  assert.ok(result.skeletons.every(({ cut_kinds: cutKinds }) => (
    !cutKinds.includes('scc') && !cutKinds.includes('callee_closure')
  )));
});

test('cut skeleton列挙は集合と順序を含めて決定的である', () => {
  const fixture = enumerationFixture();
  const input = {
    component: fixture.component,
    request: fixture.request,
    evidence: fixture.evidence,
    rawCollected: fixture.rawCollected,
  };
  assert.equal(
    JSON.stringify(enumerateCutSkeletons(input)),
    JSON.stringify(enumerateCutSkeletons(structuredClone(input))),
  );
});
