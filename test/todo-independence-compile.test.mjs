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
  assert.deepEqual(artifact.conflict_resources, []);
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
  assert.deepEqual(artifact.conflicts[0], {
    task_ids: ['tip-001', 'tip-002'],
    resource_id: artifact.conflict_resources[0].resource_id,
  });
  assert.deepEqual(artifact.conflict_resources, [{
    resource_id: artifact.conflicts[0].resource_id,
    kind: 'path',
    target: 'src/shared.mjs',
  }]);
  assert.equal(artifact.wave_plan.minimum_feasible_waves, 2);
});

test('line conflictはserial資源として記録し、錨pathを鮮度境界へ含める', () => {
  const writer = {
    ...witness('src/writer.mjs'),
    lines: [{
      line_id: 'src.protocol.mjs--event-shape', role: 'writes',
      anchors: [{ kind: 'path', path: 'src/protocol.mjs' }],
    }],
  };
  const reader = {
    ...witness('src/reader.mjs'),
    lines: [{
      line_id: 'src.protocol.mjs--event-shape', role: 'reads',
      anchors: [{ kind: 'symbol', name: 'consumeEvent', path: 'src/protocol.mjs' }],
    }],
  };
  const set = witnessSet(
    { 'tip-001': writer, 'tip-002': reader },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-srcwritermjs', operation: 'affected', target: 'src/writer.mjs' },
      { id: 'q-srcreadermjs', operation: 'affected', target: 'src/reader.mjs' },
    ],
  );
  const evidence = evidenceFor(set, [
    { id: 'q-status', operation: 'status', outcome: 'ready' },
    affectedOutcome('q-srcwritermjs', 'src/writer.mjs'),
    affectedOutcome('q-srcreadermjs', 'src/reader.mjs'),
  ]);

  const artifact = compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  });

  assert.equal(artifact.outcome, 'compiled');
  assert.deepEqual(artifact.conflict_resources, [{
    resource_id: artifact.conflicts[0].resource_id,
    kind: 'line',
    target: 'src.protocol.mjs--event-shape',
  }]);
  assert.equal(artifact.wave_plan.minimum_feasible_waves, 2);
  for (const boundary of artifact.task_boundaries) {
    assert.equal(boundary.paths.includes('src/protocol.mjs'), true);
  }
  const projected = projectIndependenceFrontier({
    artifact,
    plan: plan(),
    readyTaskIds: ['tip-001', 'tip-002'],
    activeTaskIds: [],
    currentBaseSha: BASE_SHA,
    changedPaths: [],
  });
  assert.equal(projected.frontier.serialize_pairs[0].kind, 'line');
  assert.equal(projected.frontier.serialize_pairs[0].severability, 'serial');
});

test('concern宣言はconflict判定を一切動かさない', () => {
  const queries = [
    { id: 'q-status', operation: 'status' },
    { id: 'q-srcsharedmjs', operation: 'affected', target: 'src/shared.mjs' },
  ];
  const outcomes = [
    { id: 'q-status', operation: 'status', outcome: 'ready' },
    affectedOutcome('q-srcsharedmjs', 'src/shared.mjs'),
  ];
  const compile = (manualWitness) => {
    const set = witnessSet(manualWitness, queries);
    return compileTodoIndependence({
      witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
      sensorEvidence: evidenceFor(set, outcomes),
    });
  };
  const bare = compile({
    'tip-001': witness('src/shared.mjs'),
    'tip-002': witness('src/shared.mjs'),
  });
  const declared = compile({
    'tip-001': {
      ...witness('src/shared.mjs'),
      concern_anchors: [{
        within: { kind: 'path', target: 'src/shared.mjs' },
        symbols: ['renderRightPane'],
      }],
    },
    'tip-002': {
      ...witness('src/shared.mjs'),
      concern_anchors: [{
        within: { kind: 'path', target: 'src/shared.mjs' },
        symbols: ['renderCard'],
      }],
    },
  });

  // 宣言はwitness setの一部なのでwitness_set_digestとその従属digestだけが動く。
  // 判定そのもの——conflict・unknown・波・結論——は一字一句変わらない。
  const judgement = ({ witness_set_digest: _digest, result_digest: _result, ...rest }) => rest;
  assert.deepEqual(judgement(declared), judgement(bare));
  assert.notEqual(declared.witness_set_digest, bare.witness_set_digest);
  assert.equal(declared.outcome, 'compiled');
  assert.equal(declared.conflicts.length, 1);
  assert.equal(declared.wave_plan.minimum_feasible_waves, 2);
});

test('sensorがreadyでなければunknownとして記録し、wave planを持たない', () => {
  const { set, evidence } = disjointFixture({ statusOutcome: 'stale' });
  const artifact = compileTodoIndependence({
    witnessSet: set, plan: plan(), baseSha: BASE_SHA, compiledAt: COMPILED_AT,
    sensorEvidence: evidence,
  });

  assert.equal(artifact.outcome, 'unknown');
  assert.equal(artifact.wave_plan, null);
  assert.deepEqual(artifact.conflict_resources, []);
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
  declaresTests.schema = 'lattice.todo_witness_set.v3';
  declaresTests.witness_set_digest = todoSelfDigest(declaresTests, 'witness_set_digest');
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

test('不在pathの予測は判定を止めず、既知conflictだけをserial化する', () => {
  // 実conflictを持つ2 taskへ、新規file（未存在path）だけを作る3件目を足す。
  // compileはBOUNDARY_UNKNOWNで止まり、front endはpairwise verdictを1つも返さない。
  const set = witnessSet(
    {
      'tip-001': witness('src/shared.mjs'),
      'tip-002': witness('src/shared.mjs'),
      'tip-003': {
        ...witness('src/brand-new.mjs', { queryId: 'q-new' }),
      },
    },
    [
      { id: 'q-status', operation: 'status' },
      { id: 'q-new', operation: 'affected', target: 'src/brand-new.mjs' },
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
      {
        id: 'q-new',
        operation: 'affected',
        outcome: 'empty',
        targets: [{
          target: 'src/brand-new.mjs',
          outcome: 'empty',
          path_state: 'absent',
          data: { changedFiles: ['src/brand-new.mjs'], affectedTests: [] },
        }],
      },
      affectedOutcome('q-srcsharedmjs', 'src/shared.mjs'),
    ]),
  });
  assert.equal(artifact.outcome, 'compiled');
  assert.equal(artifact.conflicts.length, 1);
  assert.deepEqual(artifact.conflicts[0].task_ids, ['tip-001', 'tip-002']);

  const projected = projectIndependenceFrontier({
    artifact, readyTaskIds: ['tip-001', 'tip-002', 'tip-003'], plan: plan(),
    currentBaseSha: BASE_SHA,
  });
  assert.equal(projected.coverage, 'verified');
  assert.deepEqual(projected.frontier.unknown, []);
  assert.equal(projected.frontier.serialize_pairs.length, 1);
  assert.deepEqual(projected.frontier.serialize_pairs[0].task_ids, ['tip-001', 'tip-002']);
});

test('宣言境界に触れないdiffではverified独立を維持する', () => {
  const artifact = compiledArtifact();
  // artifactの宣言境界はsrc/alpha.mjsとsrc/beta.mjs（affected queryのexpect pathを含む）。
  const untouched = projectIndependenceFrontier({
    artifact, readyTaskIds: ['tip-001', 'tip-002'], plan: plan(),
    currentBaseSha: OTHER_SHA, changedPaths: ['docs/notes.md'],
  });
  assert.equal(untouched.coverage, 'stale');
  assert.deepEqual(untouched.drift.intersecting_task_ids, []);
  assert.deepEqual(untouched.frontier.parallel_groups, [{ task_ids: ['tip-001', 'tip-002'] }]);

  const touched = projectIndependenceFrontier({
    artifact, readyTaskIds: ['tip-001', 'tip-002'], plan: plan(),
    currentBaseSha: OTHER_SHA, changedPaths: ['src/alpha.mjs'],
  });
  assert.deepEqual(touched.drift.intersecting_task_ids, ['tip-001']);
  assert.deepEqual(touched.frontier.parallel_groups, [{ task_ids: ['tip-002'] }]);
  assert.deepEqual(touched.frontier.unknown.map(({ task_id: id }) => id), ['tip-001']);
});

test('diffを確定できなければ全taskを未検査へ落とす', () => {
  // base到達不能（rebase等）。「変更なし」と同じ扱いにすると、根拠なくverifiedを主張してしまう。
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-001', 'tip-002'], plan: plan(),
    currentBaseSha: OTHER_SHA, changedPaths: null,
  });
  assert.equal(projected.coverage, 'stale');
  assert.equal(projected.drift.base_reachable, false);
  assert.deepEqual(projected.drift.intersecting_task_ids, ['tip-001', 'tip-002']);
  assert.deepEqual(projected.frontier.parallel_groups, []);
});

test('planが進んだ記録はtask単位に救わない', () => {
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-001', 'tip-002'],
    plan: plan({ plan_version: 'v2' }), currentBaseSha: BASE_SHA, changedPaths: [],
  });
  assert.equal(projected.coverage, 'superseded');
  // topology自体が別物なので、diffが宣言境界に触れていなくても維持できない。
  assert.equal(projected.drift, null);
  assert.deepEqual(projected.frontier.parallel_groups, []);
});

test('記録が有効でないactiveは競合なしでなく判定不能として示す', () => {
  const projected = projectIndependenceFrontier({
    artifact: compiledArtifact(), readyTaskIds: ['tip-002'], activeTaskIds: ['tip-001'],
    plan: plan(), currentBaseSha: OTHER_SHA, changedPaths: ['src/alpha.mjs'],
  });
  assert.deepEqual(projected.active_task_ids, ['tip-001']);
  assert.deepEqual(projected.uncovered_active_task_ids, ['tip-001']);
  assert.deepEqual(projected.frontier.conflicts_with_active, []);
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
