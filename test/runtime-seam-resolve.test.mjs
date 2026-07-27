import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RUNTIME_SEAM_REQUEST_SCHEMA, buildRuntimeSeamResolution, buildRuntimeSeamWitnessSet,
  readRuntimeFindingRecord, validateRuntimeSeamRequest,
} from '../src/runtime-seam-resolve.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// 請求項8の入口。AIが宣言できるのは「係争fileの中で自分が触るsymbol」と「新しい面の名前」だけで、
// Latticeはそれ以上を推定しない。宣言が実態と噛み合わない時は受けずに直列へ倒す。

const DIGEST = (character) => character.repeat(64);

function sealedRequest(overrides = {}) {
  const value = {
    schema: RUNTIME_SEAM_REQUEST_SCHEMA,
    run_id: 'run-1',
    finding_digest: DIGEST('a'),
    concern_symbols: { T1: ['renderLeft'], T2: ['CSS'] },
    path_names: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs' },
    task_migration_digest: DIGEST('2'),
    request_digest: '',
    ...overrides,
  };
  value.request_digest = todoSelfDigest(value, 'request_digest');
  return value;
}

test('宣言が揃っていれば受理する', () => {
  assert.equal(validateRuntimeSeamRequest(sealedRequest()), true);
});

test('digestが合わない宣言を受けない', () => {
  const value = sealedRequest();
  value.task_migration_digest = DIGEST('3');
  assert.equal(validateRuntimeSeamRequest(value), false);
});

test('名前が片方しか無い宣言を受けない', () => {
  // 所有面が2つ揃わなければ切断は成立しない。片方だけで通すと、
  // splitが所有を宣言しない資源が残る。
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    path_names: { T1: 'src/page-left.mjs', shared: 'src/page-shared.mjs' },
  })), false);
});

test('共有面の名前が無い宣言を受けない', () => {
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    path_names: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs' },
  })), false);
});

test('symbolを1つも挙げていないTODOがある宣言を受けない', () => {
  // 触るsymbolが無いなら、その資源に対する切断の当事者ではない。
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    concern_symbols: { T1: ['renderLeft'], T2: [] },
  })), false);
});

test('repoの外を指す名前を受けない', () => {
  assert.equal(validateRuntimeSeamRequest(sealedRequest({
    path_names: { T1: '../outside.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs' },
  })), false);
});

test('実行時witnessへconcern anchorを足してtodo witness setにする', () => {
  const witness = (tests) => ({
    owns: [{ kind: 'path', target: 'src/page.mjs' }],
    reads: [], writes: ['src/page.mjs'], resources: [], state_effects: [],
    sensor_provenance: { queries: [] }, affected_tests: tests, unknowns: [],
  });
  const { witnessSet, reasons } = buildRuntimeSeamWitnessSet({
    request: {
      manual_witness: { T1: witness(['test/a.test.mjs']), T2: witness(['test/b.test.mjs']) },
      sensor_query_set: { queries: [{ id: 'q-status', operation: 'status' }] },
    },
    declaration: sealedRequest(),
    contestedPath: 'src/page.mjs',
    executors: 2,
  });
  assert.deepEqual(reasons, []);
  assert.equal(witnessSet.schema, 'lattice.todo_witness_set.v3');
  assert.deepEqual(witnessSet.manual_witness.T1.concern_anchors, [
    { within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['renderLeft'] },
  ]);
  // 実行時witnessの中身は書き換えない。anchorを足すだけ。
  assert.deepEqual(witnessSet.manual_witness.T2.affected_tests, ['test/b.test.mjs']);
  assert.equal(witnessSet.witness_set_digest, todoSelfDigest(witnessSet, 'witness_set_digest'));
});

test('宣言されたTODOのwitnessが無ければ組まない', () => {
  const { witnessSet, reasons } = buildRuntimeSeamWitnessSet({
    request: { manual_witness: {}, sensor_query_set: { queries: [] } },
    declaration: sealedRequest(),
    contestedPath: 'src/page.mjs',
    executors: 2,
  });
  assert.equal(witnessSet, null);
  assert.deepEqual(reasons, ['witness_absent:T1']);
});

test('別epochのfindingを受けない', async (context) => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'lattice-seam-resolve-'));
  context.after(() => rm(runDir, { recursive: true, force: true }));
  await mkdir(path.join(runDir, 'findings'), { recursive: true });
  const record = { finding_digest: DIGEST('a'), plan_epoch: 1, finding: { kind: 'observed_write_conflict' } };
  await writeFile(path.join(runDir, 'findings', `${DIGEST('a')}.json`), JSON.stringify(record));

  const same = await readRuntimeFindingRecord({ runDir, findingDigest: DIGEST('a'), planEpoch: 1 });
  assert.equal(same.record.plan_epoch, 1);

  const other = await readRuntimeFindingRecord({ runDir, findingDigest: DIGEST('a'), planEpoch: 2 });
  assert.equal(other.record, null);
  assert.equal(other.reason, 'finding_from_other_epoch');

  const missing = await readRuntimeFindingRecord({ runDir, findingDigest: DIGEST('b'), planEpoch: 1 });
  assert.equal(missing.reason, 'finding_not_recorded');
});

test('拒否された処置は後継baseを持たない決着になる', () => {
  const resolution = buildRuntimeSeamResolution({
    runId: 'run-1', findingDigest: DIGEST('a'),
    resolved: { lane: 'intentional_serial', reasons: ['transform_not_committed'], split: null },
  });
  assert.equal(resolution.lane, 'intentional_serial');
  assert.equal(resolution.successor_base_sha, null);
  assert.equal(resolution.split, null);
  assert.equal(resolution.resolution_digest, todoSelfDigest(resolution, 'resolution_digest'));
});
