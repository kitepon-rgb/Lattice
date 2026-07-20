import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { digestArtifact } from '../../src/artifact-contracts.mjs';
import { runRc2DeliveryPolicyOracle } from '../../src/rc2-delivery-policy-oracle.mjs';
import {
  RC3_DOGFOOD_SCAFFOLD_PATHS,
  scaffoldRc3DogfoodRepo,
  verifyRc3DogfoodScaffold,
} from '../../src/rc3-dogfood-scaffold.mjs';

// RC3-D integration（ADR 0044 Decision 11.1〜11.3、plan RC3-D）。
// RC2 fixture 3点のbyte-identical複製によるdisposable dogfood repoの
// allowed path・oracle・candidate・base・LatticeSensor query bindingを検証する。
// 本testはexpected-red先行で置かれ、scaffold実装がgreenへ反転させる。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRANSFORM_ONLY_PATHS = Object.freeze([
  'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
  'test/rc2-delivery-policy-email.test.mjs',
  'test/rc2-delivery-policy-push.test.mjs',
  'test/rc2-delivery-policy-sms.test.mjs',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

import { invokeSensorCli } from '../../src/sensor-runtime.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

let temporaryRoot;
let scaffold;

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3-dogfood-'));
  scaffold = await scaffoldRc3DogfoodRepo({
    latticeRoot: REPO_ROOT,
    workRoot: path.join(temporaryRoot, 'work'),
  });
});

test.after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('scaffoldはRC2 fixture 3点をbyte-identicalに同一相対pathへ複製する', async () => {
  assert.deepEqual([...RC3_DOGFOOD_SCAFFOLD_PATHS], [
    'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs',
    'src/rc2-delivery-policy-oracle.mjs',
    'test/rc2-delivery-policy-fixture.test.mjs',
  ]);
  for (const relativePath of RC3_DOGFOOD_SCAFFOLD_PATHS) {
    const source = await readFile(path.join(REPO_ROOT, relativePath));
    const copied = await readFile(path.join(scaffold.repoRoot, relativePath));
    assert.equal(copied.equals(source), true, relativePath);
    assert.equal(scaffold.target.path_digests[relativePath], sha256(source), relativePath);
  }
});

test('scaffoldはcandidate witnessとoracle bindingをdigestで固定する', async () => {
  const candidateSpec = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'research/campaigns/rc2/inputs/candidate-spec-v1.json'),
    'utf8',
  ));
  assert.equal(
    scaffold.predeclared_treatment.candidate_digest,
    digestArtifact(candidateSpec),
  );
  assert.equal(
    scaffold.predeclared_treatment.candidate_digest,
    '4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907',
  );
  assert.equal(
    scaffold.predeclared_treatment.oracle_source_digest,
    candidateSpec.fixed_oracle.source_digest,
  );
  assert.equal(
    scaffold.target.path_digests['src/rc2-delivery-policy-oracle.mjs'],
    candidateSpec.fixed_oracle.source_digest,
  );
});

test('disposable repoはclean tree・base束縛・transform対象6path不在を満たす', async () => {
  const head = run('git', ['rev-parse', 'HEAD'], scaffold.repoRoot).trim();
  assert.equal(head, scaffold.target.base_sha);
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], scaffold.repoRoot);
  assert.equal(status, '');
  for (const absent of TRANSFORM_ONLY_PATHS) {
    await assert.rejects(readFile(path.join(scaffold.repoRoot, absent)), { code: 'ENOENT' });
  }
  assert.notEqual(scaffold.target.base_sha, scaffold.lattice_source.base_sha);
});

test('oracleはdisposable repo内でaccepted receiptどおりpassする', async () => {
  const receipt = await runRc2DeliveryPolicyOracle({ repoRoot: scaffold.repoRoot });
  assert.equal(receipt.outcome, 'passed');
});

test('Lattice Sensor query bindingはfixture symbolをexact一致で解決する', () => {
  const statusJson = JSON.parse(invokeSensorCli(run, ['status', '.', '--json'], scaffold.repoRoot));
  assert.equal(statusJson.initialized, true);
  assert.equal(statusJson.index.state, 'complete');
  assert.deepEqual(statusJson.pendingChanges, { added: 0, modified: 0, removed: 0 });
  const query = JSON.parse(invokeSensorCli(run, ['query', 'resolveDeliveryPolicy', '--path', '.', '--json'], scaffold.repoRoot));
  const matches = query.filter(({ node }) => (
    node?.name === 'resolveDeliveryPolicy'
    && node.filePath === 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs'
  ));
  assert.equal(matches.length, 1);
});

test('verifyはbyte drift・base drift・oracle改竄をtyped rejectする', async () => {
  const clean = await verifyRc3DogfoodScaffold({
    latticeRoot: REPO_ROOT,
    repoRoot: scaffold.repoRoot,
    expected: scaffold,
  });
  assert.equal(clean.outcome, 'verified');

  const oraclePath = path.join(scaffold.repoRoot, 'src/rc2-delivery-policy-oracle.mjs');
  const original = await readFile(oraclePath);
  await writeFile(oraclePath, Buffer.concat([original, Buffer.from('\n// tampered\n', 'utf8')]));
  try {
    const tampered = await verifyRc3DogfoodScaffold({
      latticeRoot: REPO_ROOT,
      repoRoot: scaffold.repoRoot,
      expected: scaffold,
    });
    assert.equal(tampered.outcome, 'rejected');
    assert.ok(tampered.violations.some((entry) => entry.code === 'PATH_BYTES_DRIFT'));
  } finally {
    await writeFile(oraclePath, original);
    run('git', ['checkout', '--', '.'], scaffold.repoRoot);
  }
});

test('既存repoRootへの上書きscaffoldはrejectされる', async () => {
  await assert.rejects(
    scaffoldRc3DogfoodRepo({
      latticeRoot: REPO_ROOT,
      workRoot: path.join(temporaryRoot, 'work'),
    }),
    TypeError,
  );
});
