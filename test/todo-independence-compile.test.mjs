import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TodoIndependenceError,
  compileTodoIndependence,
  projectIndependenceFrontier,
} from '../src/todo-independence.mjs';
import { TODO_WITNESS_SET_SCHEMA } from '../src/todo-independence-contracts.mjs';
import { evidenceFromCollectedOutcomes } from '../src/runtime-front-end.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// ADR 0127 Decision 4。compileは宣言済みtaskの部分集合へ閉じる。
// 観測が揃わない時にverified独立を主張しないこと、失敗をunknownへ丸めないことを固定する。

const BASE_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const COMPILED_AT = '2026-07-26T00:00:00.000Z';

const plan = (overrides = {}) => ({
  project_id: 'lattice',
  plan_key: 'plan-a',
  plan_version: 'v1',
  topology_digest: 'c'.repeat(64),
  tasks: [{ task_id: 'tip-001' }, { task_id: 'tip-002' }, { task_id: 'tip-003' }],
  ...overrides,
});

function witness(path, { queryId = null, affectedTests = [] } = {}) {
  return {
    owns: [{ kind: 'path', target: path }],
    reads: [],
    writes: [path],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{
        query_id: queryId ?? `q-${path.replace(/[^a-z]/gu, '')}`,
        expect: { kind: 'affected', path },
      }],
    },
    affected_tests: affectedTests,
    unknowns: [],
  };
}

function witnessSet(manualWitness, queries) {
  const value = {
    schema: TODO_WITNESS_SET_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    capacity: { executors: 4 },
    sensor_query_set: { queries },
    manual_witness: manualWitness,
    witness_set_digest: '',
  };
  value.witness_set_digest = todoSelfDigest(value, 'witness_set_digest');
  return value;
}

function affectedOutcome(queryId, path, { status = 'ready', affectedTests = [] } = {}) {
  return {
    id: queryId,
    operation: 'affected',
    outcome: status,
    targets: [{
      target: path,
      outcome: status,
      path_state: 'present',
      data: { changedFiles: [path], affectedTests },
    }],
  };
}

const evidenceFor = (witnessSetValue, outcomes) => evidenceFromCollectedOutcomes({
  querySet: witnessSetValue.sensor_query_set,
  collected: { cwd: '/repo', outcomes },
});

// 別々のpathを所有する2 task。観測が揃う。
function disjointFixture({ statusOutcome = 'ready' } = {}) {
  const set = witnessSet(
    { 'tip-001': witness('src/alpha.mjs'), 'tip-002': witness('src/beta.mjs') },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-srcalphamjs', operation: 'affected', target: 'src/alpha.mjs' },
      { id: 'q-srcbetamjs', operation: 'affected', target: 'src/beta.mjs' },
    ],
  );
  const evidence = evidenceFor(set, [
    { id: 'q-status', operation: 'status', outcome: statusOutcome },
    affectedOutcome('q-srcalphamjs', 'src/alpha.mjs'),
    affectedOutcome('q-srcbetamjs', 'src/beta.mjs'),
  ]);
  return { set, evidence };
}

test('宣言と観測が揃えばcompiledとして記録され、独立な2 taskは1 waveになる', () => {
  const { set, evidence } = disjointFixture();
  const artifact = compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  });

  assert.equal(artifact.outcome, 'compiled');
  assert.deepEqual(artifact.task_ids, ['tip-001', 'tip-002']);
  assert.deepEqual(artifact.conflicts, []);
  assert.deepEqual(artifact.unknowns, []);
  assert.equal(artifact.wave_plan.minimum_feasible_waves, 1);
  assert.equal(artifact.base_sha, BASE_SHA);
  // 未宣言のtip-003はcompileへ入れない（宣言済み同士の判定を巻き添えにしない）。
  assert.equal(artifact.task_ids.includes('tip-003'), false);
});

test('同一pathを両方が所有すればconflictとして記録され、waveが割れる', () => {
  const set = witnessSet(
    { 'tip-001': witness('src/shared.mjs'), 'tip-002': witness('src/shared.mjs') },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-srcsharedmjs', operation: 'affected', target: 'src/shared.mjs' },
    ],
  );
  const evidence = evidenceFor(set, [
    { id: 'q-status', operation: 'status', outcome: 'ready' },
    affectedOutcome('q-srcsharedmjs', 'src/shared.mjs'),
  ]);
  const artifact = compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  });

  assert.equal(artifact.outcome, 'compiled');
  assert.equal(artifact.conflicts.length, 1);
  assert.deepEqual(artifact.conflicts[0].task_ids, ['tip-001', 'tip-002']);
  assert.equal(artifact.wave_plan.minimum_feasible_waves, 2);
});

test('sensorがreadyでなければunknownとして記録し、wave planを持たない', () => {
  const { set, evidence } = disjointFixture({ statusOutcome: 'stale' });
  const artifact = compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  });

  assert.equal(artifact.outcome, 'unknown');
  assert.equal(artifact.wave_plan, null);
  assert.deepEqual(artifact.conflicts, []);
  assert.ok(artifact.unknowns.length >= 2);
  assert.deepEqual([...new Set(artifact.unknowns.map(({ task_id: id }) => id))].sort(),
    ['tip-001', 'tip-002']);
});

test('query drift・affected drift・plan不一致はunknownへ丸めずtyped errorで止まる', () => {
  const drifted = witnessSet(
    { 'tip-001': witness('src/alpha.mjs', { queryId: 'q-absent' }) },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-srcalphamjs', operation: 'affected', target: 'src/alpha.mjs' },
    ],
  );
  assert.throws(() => compileTodoIndependence({
    witnessSet: drifted,
    plan: plan(),
    baseSha: BASE_SHA,
    compiledAt: COMPILED_AT,
    sensorEvidence: evidenceFor(drifted, [
      { id: 'q-status', operation: 'status', outcome: 'ready' },
      affectedOutcome('q-srcalphamjs', 'src/alpha.mjs'),
    ]),
  }), (error) => error instanceof TodoIndependenceError
    && error.code === 'INDEPENDENCE_COMPILE_FAILED'
    && error.detail.code === 'QUERY_DRIFT');

  const declaresTests = witnessSet(
    { 'tip-001': witness('src/alpha.mjs', { affectedTests: ['test/alpha.test.mjs'] }) },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-srcalphamjs', operation: 'affected', target: 'src/alpha.mjs' },
    ],
  );
  assert.throws(() => compileTodoIndependence({
    witnessSet: declaresTests,
    plan: plan(),
    baseSha: BASE_SHA,
    compiledAt: COMPILED_AT,
    sensorEvidence: evidenceFor(declaresTests, [
      { id: 'q-status', operation: 'status', outcome: 'ready' },
      affectedOutcome('q-srcalphamjs', 'src/alpha.mjs', { affectedTests: [] }),
    ]),
  }), (error) => error.detail.code === 'AFFECTED_TEST_DRIFT');

  const { set, evidence } = disjointFixture();
  assert.throws(() => compileTodoIndependence({
    witnessSet: set, plan: plan({ tasks: [{ task_id: 'tip-001' }] }),
    baseSha: BASE_SHA, compiledAt: COMPILED_AT, sensorEvidence: evidence,
  }), (error) => error.code === 'INDEPENDENCE_TASK_ABSENT');

  assert.throws(() => compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: 'not-a-sha', compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  }), (error) => error.code === 'INDEPENDENCE_BASE_INVALID');
});

function compiledArtifact() {
  const { set, evidence } = disjointFixture();
  return compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  });
}

test('artifactが無ければready全件をwitness_missingとして未検査に置く', () => {
  const projected = projectIndependenceFrontier({
    artifact: null, readyTaskIds: ['tip-002', 'tip-001'], plan: plan(), currentBaseSha: BASE_SHA,
  });
  assert.equal(projected.coverage, 'missing');
  assert.deepEqual(projected.frontier.parallel_groups, []);
  assert.deepEqual(projected.frontier.unknown.map(({ task_id: id }) => id), ['tip-001', 'tip-002']);
  assert.equal(projected.frontier.unknown[0].unknowns[0].kind, 'witness_missing');
});

test('HEADが一致する時だけverifiedとして並列グループを作る', () => {
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-001', 'tip-002'],
    plan: plan(), currentBaseSha: BASE_SHA,
  });
  assert.equal(projected.coverage, 'verified');
  assert.deepEqual(projected.frontier.parallel_groups, [{ task_ids: ['tip-001', 'tip-002'] }]);
  assert.deepEqual(projected.frontier.unknown, []);
});

test('HEADが進めばstaleへ落ち、記録済みtaskもverified扱いにしない', () => {
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-001', 'tip-002'],
    plan: plan(), currentBaseSha: OTHER_SHA,
  });
  assert.equal(projected.coverage, 'stale');
  assert.deepEqual(projected.frontier.parallel_groups, []);
  assert.deepEqual(projected.frontier.unknown.map(({ task_id: id }) => id), ['tip-001', 'tip-002']);
  assert.equal(projected.frontier.unknown[0].unknowns[0].kind, 'record_stale');
});

test('planが進めばsupersededになる', () => {
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-001'],
    plan: plan({ plan_version: 'v2' }), currentBaseSha: BASE_SHA,
  });
  assert.equal(projected.coverage, 'superseded');
  assert.deepEqual(projected.frontier.parallel_groups, []);
  assert.equal(projected.frontier.unknown[0].unknowns[0].kind, 'record_superseded');
});

test('conflictのある組は同じ並列グループへ入らない', () => {
  const set = witnessSet(
    { 'tip-001': witness('src/shared.mjs'), 'tip-002': witness('src/shared.mjs') },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-srcsharedmjs', operation: 'affected', target: 'src/shared.mjs' },
    ],
  );
  const artifact = compileTodoIndependence({
    witnessSet: set,
    plan: plan(),
    baseSha: BASE_SHA,
    compiledAt: COMPILED_AT,
    sensorEvidence: evidenceFor(set, [
      { id: 'q-status', operation: 'status', outcome: 'ready' },
      affectedOutcome('q-srcsharedmjs', 'src/shared.mjs'),
    ]),
  });
  const projected = projectIndependenceFrontier({
    artifact, readyTaskIds: ['tip-001', 'tip-002'], plan: plan(), currentBaseSha: BASE_SHA,
  });

  assert.equal(projected.coverage, 'verified');
  assert.deepEqual(projected.frontier.parallel_groups,
    [{ task_ids: ['tip-001'] }, { task_ids: ['tip-002'] }]);
  assert.equal(projected.frontier.serialize_pairs.length, 1);
  assert.equal(projected.frontier.serialize_pairs[0].type, 'conflict');
});

test('宣言のないready taskは、宣言済みが検証済みでも未検査のまま残る', () => {
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-001', 'tip-002', 'tip-003'],
    plan: plan(), currentBaseSha: BASE_SHA,
  });
  assert.equal(projected.coverage, 'verified');
  assert.deepEqual(projected.frontier.parallel_groups, [{ task_ids: ['tip-001', 'tip-002'] }]);
  assert.deepEqual(projected.frontier.unknown, [{
    task_id: 'tip-003',
    unknowns: [{ kind: 'witness_missing', ref: 'task_not_in_witness_set' }],
  }]);
});
