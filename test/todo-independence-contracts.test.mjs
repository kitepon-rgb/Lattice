import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TODO_INDEPENDENCE_PROJECTION_SCHEMA,
  TODO_INDEPENDENCE_SCHEMA,
  TODO_WITNESS_SET_SCHEMA,
  explainTodoWitnessSet,
  synthesizeWitnessRunRequest,
  validateTodoIndependence,
  validateTodoIndependenceProjection,
  validateTodoWitnessSet,
} from '../src/todo-independence-contracts.mjs';
import { validateRunRequest } from '../src/runtime-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// ADR 0127。依存線の不在と境界の非干渉は別概念であり、未検査（unknown）と
// 検証済み独立（verified）を同じ「conflictが無い」へ丸めないことを契約で固定する。

const BASE_SHA = 'a'.repeat(40);
const DIGEST = (character) => character.repeat(64);

const witness = (overrides = {}) => ({
  owns: [{ kind: 'path', target: 'src/alpha.mjs' }],
  reads: [],
  writes: ['src/alpha.mjs'],
  resources: [],
  state_effects: [],
  sensor_provenance: {
    queries: [{ query_id: 'q-alpha', expect: { kind: 'path', path: 'src/alpha.mjs' } }],
  },
  affected_tests: [],
  unknowns: [],
  ...overrides,
});

function witnessSet(overrides = {}) {
  const value = {
    schema: TODO_WITNESS_SET_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    capacity: { executors: 2 },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-alpha', operation: 'affected', target: 'src/alpha.mjs' },
      ],
    },
    manual_witness: { 'tip-001': witness() },
    witness_set_digest: '',
    ...overrides,
  };
  value.witness_set_digest = todoSelfDigest(value, 'witness_set_digest');
  return value;
}

function independence(overrides = {}) {
  const value = {
    schema: TODO_INDEPENDENCE_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    plan_version: 'v1',
    topology_digest: DIGEST('c'),
    base_sha: BASE_SHA,
    witness_set_digest: DIGEST('d'),
    compiled_at: '2026-07-26T00:00:00.000Z',
    task_ids: ['tip-001', 'tip-002'],
    conflicts: [],
    precedences: [],
    unknowns: [],
    wave_plan: null,
    outcome: 'unknown',
    result_digest: '',
    ...overrides,
  };
  value.result_digest = todoSelfDigest(value, 'result_digest');
  return value;
}

function projection(overrides = {}) {
  const value = {
    schema: TODO_INDEPENDENCE_PROJECTION_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    coverage: 'verified',
    compiled_base_sha: BASE_SHA,
    current_base_sha: BASE_SHA,
    plan_version: 'v1',
    topology_digest: DIGEST('c'),
    frontier: { parallel_groups: [], serialize_pairs: [], unknown: [] },
    result_digest: '',
    ...overrides,
  };
  value.result_digest = todoSelfDigest(value, 'result_digest');
  return value;
}

test('witness setはexact shapeと自己digestを要求する', () => {
  assert.equal(validateTodoWitnessSet(witnessSet()), true);

  const tampered = witnessSet();
  tampered.plan_key = 'plan-b';
  assert.equal(explainTodoWitnessSet(tampered).reason, 'witness_set_digest_mismatch');

  const extra = witnessSet();
  extra.unexpected = 1;
  assert.equal(explainTodoWitnessSet(extra).reason, 'unexpected_or_missing_top_level_keys');

  const empty = witnessSet({ manual_witness: {} });
  assert.equal(explainTodoWitnessSet(empty).reason, 'bounded_collection_violation');
});

test('witness本体の判定はexplainRunRequestへ委譲され、pathがそのまま返る', () => {
  const broken = witnessSet({
    manual_witness: { 'tip-001': witness({ writes: ['/absolute/path.mjs'] }) },
  });
  const explained = explainTodoWitnessSet(broken);
  assert.equal(explained.valid, false);
  assert.equal(explained.reason, 'invalid_repo_relative_paths');
  assert.equal(explained.path, '/manual_witness/tip-001/writes');
});

test('合成したrun requestはrun_request.v1契約を満たす', () => {
  const set = witnessSet({
    manual_witness: { 'tip-002': witness(), 'tip-001': witness() },
  });
  const request = synthesizeWitnessRunRequest(set, {
    baseSha: BASE_SHA, requestId: 'independence-probe',
  });
  assert.equal(validateRunRequest(request), true);
  // todo順序は宣言順でなくtask_id順に正規化される（同じwitness setから同じbytesが出る）。
  assert.deepEqual(request.todos.map(({ todo_id: id }) => id), ['tip-001', 'tip-002']);
  assert.equal(request.repo.base_sha, BASE_SHA);
});

test('independence artifactは境界とdigestを検査する', () => {
  assert.equal(validateTodoIndependence(independence()), true);

  const unsortedTasks = independence({ task_ids: ['tip-002', 'tip-001'] });
  assert.equal(validateTodoIndependence(unsortedTasks), false);

  const danglingConflict = independence({
    conflicts: [{ task_ids: ['tip-001', 'tip-999'], resource_id: 'own-path-1' }],
  });
  assert.equal(validateTodoIndependence(danglingConflict), false);

  const unorderedPair = independence({
    conflicts: [{ task_ids: ['tip-002', 'tip-001'], resource_id: 'own-path-1' }],
  });
  assert.equal(validateTodoIndependence(unorderedPair), false);

  const tampered = independence();
  tampered.base_sha = 'b'.repeat(40);
  assert.equal(validateTodoIndependence(tampered), false);
});

test('unknownが残る間はwave planもcompiled outcomeも主張できない', () => {
  const claimsPlan = independence({
    outcome: 'unknown',
    unknowns: [{ task_id: 'tip-001', kind: 'sensor_unbound', ref: 'path:src/alpha.mjs' }],
    wave_plan: { waves: [{ task_ids: ['tip-001', 'tip-002'] }], minimum_feasible_waves: 1 },
  });
  assert.equal(validateTodoIndependence(claimsPlan), false);

  const compiledWithUnknown = independence({
    outcome: 'compiled',
    unknowns: [{ task_id: 'tip-001', kind: 'sensor_unbound', ref: 'path:src/alpha.mjs' }],
    wave_plan: null,
  });
  assert.equal(validateTodoIndependence(compiledWithUnknown), false);

  const compiled = independence({
    outcome: 'compiled',
    wave_plan: { waves: [{ task_ids: ['tip-001', 'tip-002'] }], minimum_feasible_waves: 1 },
  });
  assert.equal(validateTodoIndependence(compiled), true);
});

test('wave planは全taskをちょうど一度だけ配置する', () => {
  const missing = independence({
    outcome: 'compiled',
    wave_plan: { waves: [{ task_ids: ['tip-001'] }], minimum_feasible_waves: 1 },
  });
  assert.equal(validateTodoIndependence(missing), false);

  const duplicated = independence({
    outcome: 'compiled',
    wave_plan: {
      waves: [{ task_ids: ['tip-001'] }, { task_ids: ['tip-001'] }],
      minimum_feasible_waves: 2,
    },
  });
  assert.equal(validateTodoIndependence(duplicated), false);

  const miscounted = independence({
    outcome: 'compiled',
    wave_plan: {
      waves: [{ task_ids: ['tip-001'] }, { task_ids: ['tip-002'] }],
      minimum_feasible_waves: 1,
    },
  });
  assert.equal(validateTodoIndependence(miscounted), false);
});

test('projectionはcoverageとidentityの整合を要求する', () => {
  assert.equal(validateTodoIndependenceProjection(projection()), true);

  // 記録が無いのにcompile済みidentityを名乗らない。
  const missingButBound = projection({ coverage: 'missing' });
  assert.equal(validateTodoIndependenceProjection(missingButBound), false);

  const missing = projection({
    coverage: 'missing',
    compiled_base_sha: null,
    plan_version: null,
    topology_digest: null,
  });
  assert.equal(validateTodoIndependenceProjection(missing), true);

  const staleWithoutRecord = projection({ coverage: 'stale', compiled_base_sha: null });
  assert.equal(validateTodoIndependenceProjection(staleWithoutRecord), false);

  const unknownCoverage = projection({ coverage: 'probably-fine' });
  assert.equal(validateTodoIndependenceProjection(unknownCoverage), false);
});

test('projectionのfrontierは安定順序を要求する', () => {
  const ordered = projection({
    frontier: {
      parallel_groups: [{ task_ids: ['tip-001', 'tip-002'] }, { task_ids: ['tip-003'] }],
      serialize_pairs: [{ task_ids: ['tip-001', 'tip-004'], type: 'conflict', detail: 'own-path-1' }],
      unknown: [{ task_id: 'tip-005', unknowns: [{ kind: 'sensor_unbound', ref: 'path:src/e.mjs' }] }],
    },
  });
  assert.equal(validateTodoIndependenceProjection(ordered), true);

  const unsortedGroups = projection({
    frontier: {
      parallel_groups: [{ task_ids: ['tip-003'] }, { task_ids: ['tip-001', 'tip-002'] }],
      serialize_pairs: [],
      unknown: [],
    },
  });
  assert.equal(validateTodoIndependenceProjection(unsortedGroups), false);

  const unsortedUnknown = projection({
    frontier: {
      parallel_groups: [],
      serialize_pairs: [],
      unknown: [
        { task_id: 'tip-005', unknowns: [{ kind: 'sensor_unbound', ref: 'a' }] },
        { task_id: 'tip-004', unknowns: [{ kind: 'sensor_unbound', ref: 'b' }] },
      ],
    },
  });
  assert.equal(validateTodoIndependenceProjection(unsortedUnknown), false);
});
