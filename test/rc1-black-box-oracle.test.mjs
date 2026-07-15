import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  runRc1BlackBoxOracle,
  validateRc1BlackBoxOracle,
} from '../src/rc1-black-box-oracle.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function oracleInput() {
  return JSON.parse(await readFile(new URL(
    '../research/campaigns/rc1/inputs/behavior-oracle-v2.json',
    import.meta.url,
  ), 'utf8'));
}

test('fixed transform-external oracle passes all current behavior cases deterministically', async () => {
  const oracle = await oracleInput();
  const before = structuredClone(oracle);
  const first = await runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle });
  const second = await runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: structuredClone(oracle) });

  assert.equal(validateRc1BlackBoxOracle(oracle), true);
  assert.deepEqual(oracle, before);
  assert.equal(first.schema, 'lattice.rc1.black_box_behavior_receipt.v2');
  assert.equal(first.outcome, 'passed');
  assert.deepEqual(first.case_results.map(({ outcome }) => outcome), Array(8).fill('passed'));
  assert.equal(first.oracle_digest.length, 64);
  assert.equal(first.receipt_digest.length, 64);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(first).includes(REPO_ROOT), false);
});

test('oracle divergence is a typed failed receipt and does not rewrite the expectation', async () => {
  const oracle = await oracleInput();
  const drifted = structuredClone(oracle);
  drifted.cases.find(({ id }) => id === 'routine-record').expected.value.channel = 'wrong';
  const before = structuredClone(drifted);
  const receipt = await runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: drifted });

  assert.deepEqual(drifted, before);
  assert.equal(receipt.outcome, 'failed');
  assert.deepEqual(
    receipt.case_results.filter(({ outcome }) => outcome === 'failed').map(({ id }) => id),
    ['routine-record'],
  );
  assert.ok(receipt.case_results.every(({ expected_digest, observed_digest }) => (
    expected_digest.length === 64 && observed_digest.length === 64
  )));
});

test('oracle schema and transform-external scope fail closed', async () => {
  const oracle = await oracleInput();
  const traversal = structuredClone(oracle);
  traversal.entrypoint = '../outside.mjs';
  assert.equal(validateRc1BlackBoxOracle(traversal), false);
  await assert.rejects(
    runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: traversal }),
    /oracle.*contract|entrypoint/i,
  );

  const writableExecutor = structuredClone(oracle);
  writableExecutor.transform_scope_contract.executor_writable = true;
  assert.equal(validateRc1BlackBoxOracle(writableExecutor), false);
  await assert.rejects(
    runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: writableExecutor }),
    /oracle.*contract|scope/i,
  );
});
