import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import {
  RUNTIME_NON_DISPATCHABLE_CODES,
  compileRuntimePlanV1,
  evidenceFromCollectedOutcomes,
} from '../src/runtime-front-end.mjs';
import { collectSensorEvidence } from '../src/sensor-adapter.mjs';
import {
  selfDigest,
  validateRuntimeBoundaryManifest,
  validateRuntimePlan,
  verifyRuntimePlanBinding,
} from '../src/runtime-contracts.mjs';
import { verifySchedulabilityPlanV2 } from '../src/schedulability-verifier-v2.mjs';

// RC3-D focused test（ADR 0044 Decision 2・8・10.4、plan RC3-D）。
// generic front-endがfixture特判なしで2 topologyをcompileし、
// 9 TODO／unknown／query drift／affected test driftをtyped non-dispatchableにし、
// dispatchable時はproducer・verifier・binding・manifest契約を同時に満たすことを固定する。

const BASE_SHA = 'c'.repeat(40);

function symbolQueryRaw(entries) {
  return { operation: 'query', data: entries.map(([name, filePath]) => ({ node: { name, filePath } })) };
}

function affectedRaw(changedFile, affectedTests) {
  return {
    operation: 'affected',
    data: { changedFiles: [changedFile], affectedTests, totalDependentsTraversed: affectedTests.length + 1 },
  };
}

function statusRaw() {
  return {
    operation: 'status',
    data: {
      initialized: true,
      version: '1.4.1',
      projectPath: '/tmp/somewhere',
      indexPath: '/tmp/somewhere/.lattice/sensor',
      lastIndexed: '2026-07-17T00:00:00.000Z',
      dbSizeBytes: 12345,
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      worktreeMismatch: null,
      index: {
        builtWithVersion: '1.4.1',
        builtWithExtractionVersion: 24,
        currentExtractionVersion: 24,
        reindexRecommended: false,
        state: 'complete',
        pendingRefs: 0,
      },
    },
  };
}

/**
 * topology記述からrun_request＋evidenceを組み立てる汎用builder。
 * fixture名・期待conflictを一切持たない（front-end非分岐の検査対象と同じ規律）。
 */
function buildCase({ requestId, todos, capacity = 2, sharedState = [], affectedDrift = null, extraUnknown = null }) {
  const queries = [{ id: 'q-status', operation: 'status' }];
  const outcomes = [{ query_id: 'q-status', operation: 'status', status: 'ready', raw: statusRaw() }];
  const witness = {};
  for (const todo of todos) {
    const symbolQueryId = `q-sym-${todo.id}`;
    const affectedQueryId = `q-aff-${todo.id}`;
    queries.push({ id: symbolQueryId, operation: 'query', target: todo.symbol });
    queries.push({ id: affectedQueryId, operation: 'affected', target: todo.path });
    outcomes.push({
      query_id: symbolQueryId,
      operation: 'query',
      status: 'ready',
      raw: symbolQueryRaw([[todo.symbol, todo.path]]),
    });
    outcomes.push({
      query_id: affectedQueryId,
      operation: 'affected',
      status: 'ready',
      raw: affectedRaw(todo.path, affectedDrift === todo.id ? ['test/other.test.mjs'] : todo.tests),
    });
    witness[todo.id] = {
      owns: [
        { kind: 'symbol', target: todo.symbol },
        { kind: 'path', target: todo.path },
      ],
      reads: todo.reads ?? [],
      writes: [todo.path],
      resources: (todo.states ?? []).map(({ id }) => id),
      state_effects: (todo.states ?? []).map(({ id, kind }) => ({ resource_id: id, kind })),
      sensor_provenance: {
        queries: [
          { query_id: symbolQueryId, expect: { kind: 'symbol', name: todo.symbol, path: todo.path } },
          { query_id: affectedQueryId, expect: { kind: 'affected', path: todo.path } },
        ],
      },
      affected_tests: todo.tests,
      unknowns: extraUnknown === todo.id ? [{ kind: 'semantic_probe', ref: 'shared invariant?' }] : [],
    };
  }
  void sharedState;
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: requestId,
    repo: { base_sha: BASE_SHA, root_kind: 'git-worktree' },
    capacity: { executors: capacity },
    todos: todos.map((todo) => ({ todo_id: todo.id })),
    manual_witness: witness,
    sensor_query_set: { queries },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  return { request, sensorEvidence: { outcomes } };
}

function compile(built, overrides = {}) {
  return compileRuntimePlanV1({
    request: built.request,
    sensorEvidence: built.sensorEvidence,
    planRef: 'plan-v1',
    planEpoch: 1,
    predecessorRefs: [],
    ...overrides,
  });
}

const TOPOLOGY_A = Object.freeze([
  { id: 'TA1', symbol: 'alphaOne', path: 'src/alpha-one.mjs', tests: ['test/alpha-one.test.mjs'] },
  { id: 'TA2', symbol: 'alphaTwo', path: 'src/alpha-two.mjs', tests: ['test/alpha-two.test.mjs'] },
  { id: 'TA3', symbol: 'alphaThree', path: 'src/alpha-three.mjs', tests: ['test/alpha-three.test.mjs'] },
]);

const TOPOLOGY_B = Object.freeze([
  {
    id: 'TB1',
    symbol: 'betaOne',
    path: 'src/beta/one.mjs',
    tests: ['test/beta-one.test.mjs'],
    states: [{ id: 'beta-ledger', kind: 'state' }],
  },
  {
    id: 'TB2',
    symbol: 'betaTwo',
    path: 'src/beta/two.mjs',
    tests: ['test/beta-two.test.mjs'],
    states: [{ id: 'beta-ledger', kind: 'state' }],
  },
  { id: 'TB3', symbol: 'betaThree', path: 'src/beta/three.mjs', tests: ['test/beta-three.test.mjs'] },
  { id: 'TB4', symbol: 'betaFour', path: 'src/beta/four.mjs', tests: ['test/beta-four.test.mjs'] },
]);

test('非交差topology Aはdispatchableで1 waveへcompileされる', () => {
  const built = buildCase({ requestId: 'req-topo-a', todos: TOPOLOGY_A, capacity: 3 });
  const result = compile(built);
  assert.equal(result.outcome, 'dispatchable');
  assert.equal(validateRuntimePlan(result.plan), true);
  assert.equal(verifyRuntimePlanBinding({ plan: result.plan, request: built.request }), true);
  assert.deepEqual(result.plan.conflicts, []);
  assert.equal(result.schedule.minimum_feasible_waves, 1);
  assert.deepEqual(result.schedule.waves, [{ todo_ids: ['TA1', 'TA2', 'TA3'] }]);
  for (const todoId of ['TA1', 'TA2', 'TA3']) {
    assert.equal(validateRuntimeBoundaryManifest(result.manifests[todoId]), true);
    assert.equal(result.plan.manifest_digests[todoId], result.manifests[todoId].manifest_digest);
  }
});

test('shared state topology Bは同じadapterでconflictつきdispatchableへcompileされる', () => {
  const built = buildCase({ requestId: 'req-topo-b', todos: TOPOLOGY_B, capacity: 2 });
  const result = compile(built);
  assert.equal(result.outcome, 'dispatchable');
  assert.deepEqual(result.plan.conflicts, [
    { todo_ids: ['TB1', 'TB2'], resource_id: 'beta-ledger' },
  ]);
  assert.ok(result.schedule.minimum_feasible_waves >= 2);
  const verified = verifySchedulabilityPlanV2(result.graph, result.schedule);
  assert.equal(verified.outcome, 'verified');
  assert.equal(verified.minimum_feasible_waves, result.schedule.minimum_feasible_waves);
  const manifest = result.manifests.TB1;
  assert.equal(manifest.witness_provenance['beta-ledger'], 'manual_state_effect');
  assert.equal(
    manifest.graph_evidence.every((entry) => entry.status === 'ready'),
    true,
  );
});

test('front-end sourceはfixture名・期待conflict・期待waveの分岐を持たない', async () => {
  const source = await readFile(new URL('../src/runtime-front-end.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    'delivery-policy',
    'deliveryPolicy',
    'dispatch-record',
    'dispatchRecord',
    'rc1',
    'rc2',
    'TA1',
    'TB1',
    'expected_wave',
    'expectedWave',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('9 TODOはNODE_LIMIT_EXCEEDEDでdispatchable planを発行しない', () => {
  const todos = Array.from({ length: 9 }, (_, index) => ({
    id: `TN${index + 1}`,
    symbol: `node${index + 1}`,
    path: `src/node-${index + 1}.mjs`,
    tests: [`test/node-${index + 1}.test.mjs`],
  }));
  const result = compile(buildCase({ requestId: 'req-nine', todos }));
  assert.equal(result.outcome, 'non_dispatchable');
  assert.equal(result.code, 'NODE_LIMIT_EXCEEDED');
  assert.equal('plan' in result, false);
});

test('witness unknownはBOUNDARY_UNKNOWNへ落ちevidence acquisitionを要求する', () => {
  const result = compile(buildCase({ requestId: 'req-unknown', todos: TOPOLOGY_A, extraUnknown: 'TA2' }));
  assert.equal(result.outcome, 'non_dispatchable');
  assert.equal(result.code, 'BOUNDARY_UNKNOWN');
  assert.ok(result.detail.unknowns.some((entry) => entry.todo_id === 'TA2'));
});

test('query set外参照とcovering query曖昧化はQUERY_DRIFTになる', () => {
  const built = buildCase({ requestId: 'req-drift', todos: TOPOLOGY_A });
  built.request.manual_witness.TA1.sensor_provenance.queries[0].query_id = 'q-ghost';
  built.request.request_digest = selfDigest(built.request, 'request_digest');
  const drifted = compile(built);
  assert.equal(drifted.outcome, 'non_dispatchable');
  assert.equal(drifted.code, 'QUERY_DRIFT');

  const relabeled = buildCase({ requestId: 'req-relabel', todos: TOPOLOGY_A });
  relabeled.request.manual_witness.TA1.sensor_provenance.queries[0].expect = {
    kind: 'symbol', name: 'alphaGhost', path: 'src/alpha-one.mjs',
  };
  relabeled.request.request_digest = selfDigest(relabeled.request, 'request_digest');
  const relabelDrift = compile(relabeled);
  assert.equal(relabelDrift.outcome, 'non_dispatchable');
  assert.equal(relabelDrift.code, 'QUERY_DRIFT');
  assert.ok(relabelDrift.detail.references.some((entry) => (
    entry.reason.includes('expectとquery')
  )));

  const ambiguousBuilt = buildCase({ requestId: 'req-ambiguous', todos: TOPOLOGY_A });
  ambiguousBuilt.request.sensor_query_set.queries.push({
    id: 'q-sym-TA1-dup', operation: 'query', target: 'alphaOne',
  });
  ambiguousBuilt.sensorEvidence.outcomes.push({
    query_id: 'q-sym-TA1-dup',
    operation: 'query',
    status: 'ready',
    raw: symbolQueryRaw([['alphaOne', 'src/alpha-one.mjs']]),
  });
  ambiguousBuilt.request.manual_witness.TA1.sensor_provenance.queries.push({
    query_id: 'q-sym-TA1-dup',
    expect: { kind: 'symbol', name: 'alphaOne', path: 'src/alpha-one.mjs' },
  });
  ambiguousBuilt.request.request_digest = selfDigest(ambiguousBuilt.request, 'request_digest');
  const ambiguous = compile(ambiguousBuilt);
  assert.equal(ambiguous.outcome, 'non_dispatchable');
  assert.equal(ambiguous.code, 'QUERY_DRIFT');
  assert.ok(ambiguous.detail.ambiguous_targets.length >= 1);
});

test('affected観測とwitness宣言の不一致はAFFECTED_TEST_DRIFTになる', () => {
  const result = compile(buildCase({ requestId: 'req-aff-drift', todos: TOPOLOGY_A, affectedDrift: 'TA3' }));
  assert.equal(result.outcome, 'non_dispatchable');
  assert.equal(result.code, 'AFFECTED_TEST_DRIFT');
  assert.equal(result.detail.mismatches.length, 1);
  assert.equal(result.detail.mismatches[0].todo_id, 'TA3');
});

test('stale index・fuzzy解決・未束縛owns・write交差はunknownとして丸められない', () => {
  const staleBuilt = buildCase({ requestId: 'req-stale', todos: TOPOLOGY_A });
  staleBuilt.sensorEvidence.outcomes[0].status = 'stale';
  const stale = compile(staleBuilt);
  assert.equal(stale.outcome, 'non_dispatchable');
  assert.equal(stale.code, 'BOUNDARY_UNKNOWN');

  const fuzzyBuilt = buildCase({ requestId: 'req-fuzzy', todos: TOPOLOGY_A });
  fuzzyBuilt.sensorEvidence.outcomes[1].raw = symbolQueryRaw([['alphaOneLegacy', 'src/alpha-one.mjs']]);
  const fuzzy = compile(fuzzyBuilt);
  assert.equal(fuzzy.outcome, 'non_dispatchable');
  assert.equal(fuzzy.code, 'BOUNDARY_UNKNOWN');
  assert.ok(fuzzy.detail.unknowns.some((entry) => entry.reason.includes('symbol_absent')));

  const overlapBuilt = buildCase({ requestId: 'req-overlap', todos: TOPOLOGY_A });
  overlapBuilt.request.manual_witness.TA1.writes = ['src/alpha-one.mjs', 'src/alpha-two.mjs'];
  overlapBuilt.request.request_digest = selfDigest(overlapBuilt.request, 'request_digest');
  const overlap = compile(overlapBuilt);
  assert.equal(overlap.outcome, 'non_dispatchable');
  assert.equal(overlap.code, 'BOUNDARY_UNKNOWN');
});

test('創作を宣言したTODOは、不存在pathでも裏付けありとして判定される', async () => {
  // ADR 0136。fresh absentはfsのlstat結果であり、存在しないfileに依存するものは
  // 構造的に存在しえない。宣言があるときだけ、その観測を裏付けとして受ける。
  const built = buildCase({
    requestId: 'req-declared-new-path',
    todos: [{ id: 'TA1', symbol: 'futureService', path: 'src/future-service.mjs', tests: [] }],
  });
  // symbol所有は外す。まだ存在しないfileの中のsymbolは、それ自体が未観測である。
  built.request.schema = 'lattice.run_request.v2';
  built.request.manual_witness.TA1.owns = [
    { kind: 'path', target: 'src/future-service.mjs', creates: true },
  ];
  built.request.manual_witness.TA1.sensor_provenance.queries = built.request.manual_witness
    .TA1.sensor_provenance.queries.filter(({ expect }) => expect.kind === 'affected');
  built.request.sensor_query_set.queries = built.request.sensor_query_set.queries
    .filter(({ operation }) => operation !== 'query');
  built.request.request_digest = selfDigest(built.request, 'request_digest');

  const collected = await collectSensorEvidence({
    cwd: '/repo',
    querySet: built.request.sensor_query_set,
    execute: async ({ operation }) => {
      if (operation === 'status') return { code: 0, stdout: JSON.stringify(statusRaw().data), stderr: '' };
      throw new Error(`不存在pathのaffected commandは起動してはならない: ${operation}`);
    },
    inspectAffectedPath: async () => 'absent',
  });
  built.sensorEvidence = evidenceFromCollectedOutcomes({
    querySet: built.request.sensor_query_set,
    collected,
  });

  const result = compile(built);
  assert.equal(result.outcome, 'dispatchable', JSON.stringify(result.detail ?? {}));

  // 宣言が実態とずれている側は止める。既に在るpathへ創作を宣言しても黙って通さない。
  const present = buildCase({
    requestId: 'req-declared-present-path',
    todos: [{ id: 'TA1', symbol: 'futureService', path: 'src/future-service.mjs', tests: [] }],
  });
  present.request.schema = 'lattice.run_request.v2';
  present.request.manual_witness.TA1.owns = [
    { kind: 'symbol', target: 'futureService' },
    { kind: 'path', target: 'src/future-service.mjs', creates: true },
  ];
  present.request.request_digest = selfDigest(present.request, 'request_digest');
  const presentCollected = await collectSensorEvidence({
    cwd: '/repo',
    querySet: present.request.sensor_query_set,
    execute: async ({ operation }) => {
      if (operation === 'status') return { code: 0, stdout: JSON.stringify(statusRaw().data), stderr: '' };
      if (operation === 'query') {
        return { code: 0, stdout: JSON.stringify(symbolQueryRaw([['futureService', 'src/future-service.mjs']]).data), stderr: '' };
      }
      return {
        code: 0,
        stdout: JSON.stringify(affectedRaw('src/future-service.mjs', []).data),
        stderr: '',
      };
    },
    inspectAffectedPath: async () => 'file',
  });
  present.sensorEvidence = evidenceFromCollectedOutcomes({
    querySet: present.request.sensor_query_set,
    collected: presentCollected,
  });
  const presentResult = compile(present);
  assert.equal(presentResult.outcome, 'non_dispatchable');
  assert.ok(presentResult.detail.unresolved_witnesses.some(({ kind }) => (
    kind === 'sensor_creates_path_present'
  )), JSON.stringify(presentResult.detail.unresolved_witnesses));

  // fs観測そのものが記録に無い証拠では、宣言だけで裏付けにしない。
  const unverified = buildCase({
    requestId: 'req-declared-unverified',
    todos: [{ id: 'TA1', symbol: 'futureService', path: 'src/future-service.mjs', tests: [] }],
  });
  unverified.request.schema = 'lattice.run_request.v2';
  unverified.request.manual_witness.TA1.owns = [
    { kind: 'symbol', target: 'futureService' },
    { kind: 'path', target: 'src/future-service.mjs', creates: true },
  ];
  unverified.request.request_digest = selfDigest(unverified.request, 'request_digest');
  const unverifiedResult = compile(unverified);
  assert.equal(unverifiedResult.outcome, 'non_dispatchable');
  assert.ok(unverifiedResult.detail.unresolved_witnesses.some(({ kind }) => (
    kind === 'sensor_creates_unverified'
  )), JSON.stringify(unverifiedResult.detail.unresolved_witnesses));
});

test('実Sensorのfresh path不存在だけがseam bootstrapを返し、未束縛ownershipは証拠取得を返す', async () => {
  const built = buildCase({
    requestId: 'req-new-path',
    todos: [{ id: 'TA1', symbol: 'futureService', path: 'src/future-service.mjs', tests: [] }],
  });
  const collected = await collectSensorEvidence({
    cwd: '/repo',
    querySet: built.request.sensor_query_set,
    execute: async ({ operation }) => {
      if (operation === 'status') return { code: 0, stdout: JSON.stringify(statusRaw().data), stderr: '' };
      if (operation === 'query') return { code: 0, stdout: '[]', stderr: '' };
      throw new Error(`不存在pathのaffected commandは起動してはならない: ${operation}`);
    },
    inspectAffectedPath: async () => 'absent',
  });
  built.sensorEvidence = evidenceFromCollectedOutcomes({
    querySet: built.request.sensor_query_set,
    collected,
  });

  const result = compile(built);

  assert.equal(result.outcome, 'non_dispatchable');
  assert.equal(result.code, 'BOUNDARY_UNKNOWN');
  assert.ok(result.detail.unresolved_witnesses.some((entry) => (
    entry.todo_id === 'TA1'
      && entry.kind === 'sensor_empty'
      && entry.ref === 'q-aff-TA1'
  )));
  assert.equal(result.detail.guidance.code, 'BOOTSTRAP_OWNERSHIP_SEAM');

  const unbound = buildCase({ requestId: 'req-unbound-path', todos: TOPOLOGY_A });
  unbound.request.manual_witness.TA1.sensor_provenance.queries = [];
  unbound.request.request_digest = selfDigest(unbound.request, 'request_digest');
  const unboundResult = compile(unbound);
  assert.equal(unboundResult.code, 'BOUNDARY_UNKNOWN');
  assert.equal(unboundResult.detail.guidance.code, 'ACQUIRE_OWNERSHIP_EVIDENCE');
});

test('非readyなaffected evidenceはdispatchableへ丸められずBOUNDARY_UNKNOWNになる', () => {
  const built = buildCase({ requestId: 'req-aff-empty', todos: TOPOLOGY_A });
  // TA1のaffected観測をempty（affected testsゼロ・changedFiles不一致）へ差し替える。
  const outcome = built.sensorEvidence.outcomes.find((entry) => entry.query_id === 'q-aff-TA1');
  outcome.status = 'empty';
  outcome.raw = { operation: 'affected', data: { changedFiles: [], affectedTests: [], totalDependentsTraversed: 0 } };
  const result = compile(built);
  assert.equal(result.outcome, 'non_dispatchable');
  assert.equal(result.code, 'BOUNDARY_UNKNOWN');
  assert.ok(result.detail.unknowns.some((entry) => (
    entry.todo_id === 'TA1' && entry.reason.includes('empty')
  )));
});

test('write→read交差はunknownでなくstate conflictとしてserial化される', () => {
  const todos = [
    { id: 'TR1', symbol: 'writerOne', path: 'src/writer-one.mjs', tests: ['test/writer-one.test.mjs'] },
    { id: 'TR2', symbol: 'readerTwo', path: 'src/reader-two.mjs', tests: ['test/reader-two.test.mjs'], reads: ['src/writer-one.mjs'] },
  ];
  const built = buildCase({ requestId: 'req-rw', todos });
  const result = compile(built);
  assert.equal(result.outcome, 'dispatchable');
  assert.equal(result.plan.conflicts.length, 1);
  assert.deepEqual(result.plan.conflicts[0].todo_ids, ['TR1', 'TR2']);
  assert.equal(result.schedule.minimum_feasible_waves, 2);
});

test('state_effect宣言のないbare shared resourceはconflictとしてserial化される', () => {
  const built = buildCase({ requestId: 'req-bare', todos: TOPOLOGY_A });
  built.request.manual_witness.TA1.resources = ['shared-ledger'];
  built.request.manual_witness.TA3.resources = ['shared-ledger'];
  built.request.request_digest = selfDigest(built.request, 'request_digest');
  const result = compile(built);
  assert.equal(result.outcome, 'dispatchable');
  assert.deepEqual(result.plan.conflicts, [
    { todo_ids: ['TA1', 'TA3'], resource_id: 'shared-ledger' },
  ]);
  assert.equal(result.schedule.minimum_feasible_waves, 2);
});

test('owns pathのabsolute path・遡上はTypeErrorでfail closedする', () => {
  const absolute = buildCase({ requestId: 'req-abs', todos: TOPOLOGY_A });
  absolute.request.manual_witness.TA1.owns[1] = { kind: 'path', target: '/tmp/escape.mjs' };
  absolute.request.request_digest = selfDigest(absolute.request, 'request_digest');
  assert.throws(() => compile(absolute), TypeError);

  const traversal = buildCase({ requestId: 'req-dotdot', todos: TOPOLOGY_A });
  traversal.request.manual_witness.TA1.sensor_provenance.queries[0].expect.path = '../escape.mjs';
  traversal.request.request_digest = selfDigest(traversal.request, 'request_digest');
  assert.throws(() => compile(traversal), TypeError);
});

test('共有owns pathはwrite conflictとしてserial scheduleへ落ちる', () => {
  const todos = [
    { id: 'TS1', symbol: 'sharedOne', path: 'src/shared-target.mjs', tests: ['test/shared.test.mjs'] },
    { id: 'TS2', symbol: 'sharedTwo', path: 'src/shared-target.mjs', tests: ['test/shared.test.mjs'] },
  ];
  const built = buildCase({ requestId: 'req-shared-path', todos });
  // 同一pathを両者がownsで主張する場合、covering queryも同一でなければQUERY_DRIFT。
  // ここでは同じqueryを両witnessが参照する正規形へ直す。
  const witness = built.request.manual_witness;
  witness.TS2.sensor_provenance.queries = witness.TS1.sensor_provenance.queries.map((entry) => ({
    query_id: entry.query_id,
    expect: { ...entry.expect },
  }));
  witness.TS2.owns = [{ kind: 'path', target: 'src/shared-target.mjs' }];
  witness.TS1.owns = [{ kind: 'path', target: 'src/shared-target.mjs' }];
  witness.TS1.affected_tests = ['test/shared.test.mjs'];
  witness.TS2.affected_tests = ['test/shared.test.mjs'];
  built.request.request_digest = selfDigest(built.request, 'request_digest');
  const result = compile(built);
  assert.equal(result.outcome, 'dispatchable');
  assert.equal(result.plan.conflicts.length, 1);
  assert.deepEqual(result.plan.conflicts[0].todo_ids, ['TS1', 'TS2']);
  assert.equal(result.schedule.minimum_feasible_waves, 2);
});

test('入力shape違反はtyped non-dispatchableでなくTypeErrorでfail closedする', () => {
  const built = buildCase({ requestId: 'req-shape', todos: TOPOLOGY_A });
  assert.throws(() => compileRuntimePlanV1({}), TypeError);
  assert.throws(() => compile(built, { planRef: 'not valid!' }), TypeError);
  const tampered = buildCase({ requestId: 'req-shape-2', todos: TOPOLOGY_A });
  tampered.request.request_digest = 'f'.repeat(64);
  assert.throws(() => compile(tampered), TypeError);
  const shortEvidence = buildCase({ requestId: 'req-shape-3', todos: TOPOLOGY_A });
  shortEvidence.sensorEvidence.outcomes.pop();
  assert.throws(() => compile(shortEvidence), TypeError);
});

test('non-dispatchable code集合は固定enumである', () => {
  assert.deepEqual([...RUNTIME_NON_DISPATCHABLE_CODES].sort(), [
    'AFFECTED_TEST_DRIFT',
    'BOUNDARY_UNKNOWN',
    'NODE_LIMIT_EXCEEDED',
    'QUERY_DRIFT',
    'SEARCH_BUDGET_EXHAUSTED',
  ]);
});

test('portable digestはraw telemetryへ依存しない', () => {
  const left = buildCase({ requestId: 'req-portable', todos: TOPOLOGY_A });
  const right = buildCase({ requestId: 'req-portable', todos: TOPOLOGY_A });
  right.sensorEvidence.outcomes[0].raw.data.projectPath = '/entirely/different/path';
  right.sensorEvidence.outcomes[0].raw.data.dbSizeBytes = 999999;
  right.sensorEvidence.outcomes[0].raw.data.lastIndexed = '2026-07-17T09:99:99.000Z';
  const leftResult = compile(left);
  const rightResult = compile(right);
  assert.equal(leftResult.outcome, 'dispatchable');
  assert.equal(rightResult.outcome, 'dispatchable');
  assert.equal(
    digestArtifact(leftResult.manifests.TA1),
    digestArtifact(rightResult.manifests.TA1),
  );
  assert.equal(leftResult.plan.plan_digest, rightResult.plan.plan_digest);
});
