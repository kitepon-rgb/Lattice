import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MANUAL_WITNESS_FIELDS,
  RUN_REQUEST_CLAIM_MODE,
  RUN_REQUEST_FIELDS,
  SENSOR_EXPECT_KINDS,
  SENSOR_QUERY_OPERATIONS,
  explainRunRequest,
  selfDigest,
  validateRunRequest,
} from '../src/runtime-contracts.mjs';

// ADR 0123。配布するJSON Schemaとruntime validatorが乖離しないことを機械検査する。
// 「契約は公開しているが配布物に無い」「schemaで通ってから後段で落ちる」を再発させない。

const SCHEMA_DIR = new URL('../docs/schemas/', import.meta.url);
const PACKAGE = new URL('../package.json', import.meta.url);

const loadSchema = async (title) => JSON.parse(
  await readFile(new URL(`${title}.schema.json`, SCHEMA_DIR), 'utf8'),
);

const BASE_SHA = 'a'.repeat(40);

function witness(overrides = {}) {
  return {
    owns: [{ kind: 'path', target: 'src/add.mjs' }],
    reads: [],
    writes: ['src/add.mjs'],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: 'q1', expect: { kind: 'path', path: 'src/add.mjs' } }],
    },
    affected_tests: [],
    unknowns: [],
    ...overrides,
  };
}

function validRequest(overrides = {}) {
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'req-1',
    repo: { base_sha: BASE_SHA, root_kind: 'git' },
    capacity: { executors: 1 },
    todos: [{ todo_id: 'T1' }],
    manual_witness: { T1: witness() },
    sensor_query_set: {
      queries: [
        { id: 'q0', operation: 'status' },
        { id: 'q1', operation: 'query', target: 'src/add.mjs' },
      ],
    },
    executor_capability: { adapters: ['isolated-worktree'] },
    claim_mode: RUN_REQUEST_CLAIM_MODE,
    ...overrides,
  };
  request.request_digest = selfDigest(request, 'request_digest');
  return request;
}

test('runtime schemaは配布物のfilesへ含まれる', async () => {
  const manifest = JSON.parse(await readFile(PACKAGE, 'utf8'));
  for (const title of [
    'lattice.run_request.v1',
    'lattice.executor_packet.v1',
    'lattice.executor_receipt.v1',
  ]) {
    assert.ok(
      manifest.files.includes(`docs/schemas/${title}.schema.json`),
      `${title} が package.json files に無い（配布されない契約を作らない）`,
    );
    const schema = await loadSchema(title);
    assert.equal(schema.title, title);
  }
});

test('run_request schemaのtop-level keyはvalidatorのexact key集合と一致する', async () => {
  const schema = await loadSchema('lattice.run_request.v1');
  assert.deepEqual([...schema.required].sort(), [...RUN_REQUEST_FIELDS].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...RUN_REQUEST_FIELDS].sort());
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.claim_mode.const, RUN_REQUEST_CLAIM_MODE);
});

test('run_request schemaの閉集合はruntime定数と一致する', async () => {
  const schema = await loadSchema('lattice.run_request.v1');
  assert.deepEqual(
    schema.$defs.sensorQuery.properties.operation.enum,
    [...SENSOR_QUERY_OPERATIONS],
  );
  const expectKinds = schema.$defs.sensorExpect.oneOf
    .flatMap((branch) => branch.properties.kind.const ?? branch.properties.kind.enum);
  assert.deepEqual([...expectKinds].sort(), [...SENSOR_EXPECT_KINDS].sort());
  assert.deepEqual(
    [...schema.$defs.manualWitness.required].sort(),
    [...MANUAL_WITNESS_FIELDS].sort(),
  );
});

test('validateRunRequestはexplainRunRequestへ委譲する（判定と診断が乖離しない）', () => {
  const request = validRequest();
  assert.equal(explainRunRequest(request).valid, true);
  assert.equal(validateRunRequest(request), true);
  const broken = { ...request, claim_mode: 'best_effort' };
  assert.equal(explainRunRequest(broken).valid, false);
  assert.equal(validateRunRequest(broken), false);
});

test('拒否はreasonと違反pathを返す', () => {
  const cases = [
    [{}, 'unexpected_or_missing_top_level_keys', ''],
    [validRequest({ request_id: '' }), 'invalid_identifier', '/request_id'],
    [validRequest({ repo: { base_sha: 'zz', root_kind: 'git' } }), 'invalid_git_sha', '/repo/base_sha'],
    [validRequest({ capacity: { executors: 0 } }), 'not_a_positive_integer', '/capacity/executors'],
    [validRequest({ todos: [] }), 'bounded_collection_violation', '/todos'],
    [validRequest({ claim_mode: 'best_effort' }), 'claim_mode_must_be_exact_minimum', '/claim_mode'],
  ];
  for (const [value, reason, at] of cases) {
    const verdict = explainRunRequest(value);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.reason, reason, `reason mismatch for ${at}`);
    assert.equal(verdict.path, at);
  }
});

test('todo_idが重複するrequestは違反pathつきで拒否される', () => {
  const request = validRequest({
    todos: [{ todo_id: 'T1' }, { todo_id: 'T1' }],
    manual_witness: { T1: witness() },
  });
  const verdict = explainRunRequest(request);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, 'duplicate_todo_id');
  assert.equal(verdict.path, '/todos');
});

test('manual_witnessのkeyはtodo_id集合と一致しなければならない', () => {
  const request = validRequest({ manual_witness: { T2: witness() } });
  const verdict = explainRunRequest(request);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, 'manual_witness_keys_must_equal_todo_ids');
  assert.equal(verdict.path, '/manual_witness');
});

// 契約分裂の回帰テスト。schemaで受理してからfront-endが落とす構造を再発させない。
test('front-endが要求するnested shapeはschema段で拒否される', () => {
  const sensorQuerySet = explainRunRequest(validRequest({ sensor_query_set: {} }));
  assert.equal(sensorQuerySet.reason, 'unexpected_or_missing_keys');
  assert.equal(sensorQuerySet.path, '/sensor_query_set');

  const unknownOperation = explainRunRequest(validRequest({
    sensor_query_set: { queries: [{ id: 'q0', operation: 'nope' }] },
  }));
  assert.equal(unknownOperation.reason, 'unknown_sensor_query_operation');
  assert.equal(unknownOperation.path, '/sensor_query_set/queries/0/operation');

  const capability = explainRunRequest(validRequest({ executor_capability: {} }));
  assert.equal(capability.reason, 'unexpected_or_missing_keys');
  assert.equal(capability.path, '/executor_capability');

  const provenance = explainRunRequest(validRequest({
    manual_witness: { T1: witness({ sensor_provenance: {} }) },
  }));
  assert.equal(provenance.reason, 'unexpected_or_missing_keys');
  assert.equal(provenance.path, '/manual_witness/T1/sensor_provenance');

  const expectShape = explainRunRequest(validRequest({
    manual_witness: {
      T1: witness({
        sensor_provenance: { queries: [{ query_id: 'q1', expect: { kind: 'symbol', path: 'src/add.mjs' } }] },
      }),
    },
  }));
  assert.equal(expectShape.reason, 'invalid_sensor_expect');
  assert.equal(expectShape.path, '/manual_witness/T1/sensor_provenance/queries/0/expect');
});

test('request_digestの自己digest規則を破ると拒否される', () => {
  const request = validRequest();
  const verdict = explainRunRequest({ ...request, request_digest: '0'.repeat(64) });
  assert.equal(verdict.reason, 'request_digest_mismatch');
  assert.equal(verdict.path, '/request_digest');
});
