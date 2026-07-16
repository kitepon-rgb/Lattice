import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';

const MODULE = '../src/rc2-delivery-policy-transform.mjs';
const ADAPTER_PATH = 'src/rc2-delivery-policy-transform.mjs';
const ENTRY_PATH = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const ORACLE_PATH = 'src/rc2-delivery-policy-oracle.mjs';
const SHARED_TEST_PATH = 'test/rc2-delivery-policy-fixture.test.mjs';

const PATHS = Object.freeze([
  ENTRY_PATH,
  'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
  'test/rc2-delivery-policy-email.test.mjs',
  SHARED_TEST_PATH,
  'test/rc2-delivery-policy-push.test.mjs',
  'test/rc2-delivery-policy-sms.test.mjs',
]);

const SURFACE_PATHS = Object.freeze([...PATHS, ORACLE_PATH].sort());
const CASE_IDS = Object.freeze([
  'email-routine',
  'email-urgent',
  'sms-routine',
  'sms-urgent',
  'push-routine',
  'push-urgent',
]);

const CHANNELS = Object.freeze({
  email: Object.freeze({
    todo_id: 'email-policy',
    resolver: 'resolveEmailPolicy',
    production_path: 'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
    contract: 'emailPolicyContract',
    test_path: 'test/rc2-delivery-policy-email.test.mjs',
    case_ids: Object.freeze(['email-routine', 'email-urgent']),
  }),
  sms: Object.freeze({
    todo_id: 'sms-policy',
    resolver: 'resolveSmsPolicy',
    production_path: 'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
    contract: 'smsPolicyContract',
    test_path: 'test/rc2-delivery-policy-sms.test.mjs',
    case_ids: Object.freeze(['sms-routine', 'sms-urgent']),
  }),
  push: Object.freeze({
    todo_id: 'push-policy',
    resolver: 'resolvePushPolicy',
    production_path: 'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
    contract: 'pushPolicyContract',
    test_path: 'test/rc2-delivery-policy-push.test.mjs',
    case_ids: Object.freeze(['push-routine', 'push-urgent']),
  }),
});

const TEST_CONTRACTS = Object.freeze([
  Object.freeze({ test_id: CHANNELS.email.contract, path: CHANNELS.email.test_path }),
  Object.freeze({ test_id: CHANNELS.sms.contract, path: CHANNELS.sms.test_path }),
  Object.freeze({ test_id: CHANNELS.push.contract, path: CHANNELS.push.test_path }),
  Object.freeze({ test_id: 'deliveryPolicyCompositionContract', path: SHARED_TEST_PATH }),
]);

const CURRENT_PRESENT = new Set([ENTRY_PATH, SHARED_TEST_PATH, ORACLE_PATH]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function applyGitPatch(cwd, patchBytes) {
  const result = spawnSync('git', ['apply', '--binary', '-'], {
    cwd,
    input: patchBytes,
    encoding: 'buffer',
  });
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
}

function changedPaths(repoRoot) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const status = result.stdout.trimEnd();
  if (status.length === 0) return [];
  return status.split('\n').map((line) => line.slice(3)).sort();
}

function worktreeCount(repoRoot) {
  return git(repoRoot, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .length;
}

async function copyRepoFile(repoRoot, relativePath) {
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(new URL(`../${relativePath}`, import.meta.url)));
}

async function makeFixtureRepo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc2-transform-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, ENTRY_PATH),
    copyRepoFile(repoRoot, SHARED_TEST_PATH),
    copyRepoFile(repoRoot, ORACLE_PATH),
  ]);
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-m', 'RC2 delivery policy transform基準']);
  return repoRoot;
}

async function candidateSpec() {
  return JSON.parse(await readFile(
    new URL('../research/campaigns/rc2/inputs/candidate-spec-v1.json', import.meta.url),
    'utf8',
  ));
}

async function transformModule() {
  return import(MODULE);
}

async function readPaths(repoRoot, relativePaths) {
  const entries = await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(repoRoot, relativePath)),
  ]));
  return new Map(entries);
}

async function captureSurfaceFiles(repoRoot) {
  return Promise.all(SURFACE_PATHS.map(async (relativePath) => {
    try {
      const bytes = await readFile(path.join(repoRoot, relativePath));
      return { path: relativePath, state: 'present', content_digest: sha256(bytes) };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return { path: relativePath, state: 'absent', content_digest: null };
    }
  }));
}

function exactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function digestWithout(value, key) {
  const preimage = structuredClone(value);
  delete preimage[key];
  return digestArtifact(preimage);
}

function assertSnapshot(snapshot, expectedState) {
  exactKeys(snapshot, ['schema', 'files', 'digest']);
  assert.equal(snapshot.schema, 'lattice.rc2.delivery_policy_surface_snapshot.v1');
  assert.deepEqual(snapshot.files.map(({ path: relativePath }) => relativePath), SURFACE_PATHS);
  assert.equal(snapshot.digest, digestArtifact({
    schema: snapshot.schema,
    files: snapshot.files,
  }));
  for (const file of snapshot.files) {
    exactKeys(file, ['path', 'state', 'content_digest']);
    assert.equal(file.state, expectedState(file.path));
    if (file.state === 'present') assert.match(file.content_digest, /^[0-9a-f]{64}$/);
    else assert.equal(file.content_digest, null);
  }
}

function assertOracleReceipt(receipt) {
  exactKeys(receipt, ['schema', 'outcome', 'case_results']);
  assert.equal(receipt.schema, 'lattice.rc2.delivery_policy_oracle_receipt.v1');
  assert.equal(receipt.outcome, 'passed');
  assert.deepEqual(receipt.case_results.map(({ id }) => id), CASE_IDS);
  for (const result of receipt.case_results) {
    exactKeys(result, ['id', 'outcome', 'output_digest']);
    assert.equal(result.outcome, 'passed');
    assert.match(result.output_digest, /^[0-9a-f]{64}$/);
  }
}

function oracleCaseSetDigest(receipt) {
  return digestArtifact({
    case_results: receipt.case_results.map(({ id, output_digest }) => ({ id, output_digest })),
  });
}

function channelForCase(caseId) {
  const channel = caseId.split('-')[0];
  assert.ok(Object.hasOwn(CHANNELS, channel));
  return CHANNELS[channel];
}

test('transform moduleはexact allowed paths、deterministic writer、isolated runnerだけを公開する', async () => {
  const module = await transformModule();

  assert.deepEqual(Object.keys(module).sort(), [
    'RC2_DELIVERY_POLICY_TRANSFORM_PATHS',
    'applyRc2DeliveryPolicyTransform',
    'runRc2DeliveryPolicySeamTransform',
  ]);
  assert.equal(Object.isFrozen(module.RC2_DELIVERY_POLICY_TRANSFORM_PATHS), true);
  assert.deepEqual(module.RC2_DELIVERY_POLICY_TRANSFORM_PATHS, PATHS);
  assert.equal(typeof module.applyRc2DeliveryPolicyTransform, 'function');
  assert.equal(typeof module.runRc2DeliveryPolicySeamTransform, 'function');
});

test('writerは8 pathをidempotentに作りproduction／test ownershipをexact分割する', async (t) => {
  const { applyRc2DeliveryPolicyTransform } = await transformModule();
  const repoRoot = await makeFixtureRepo(t);

  await applyRc2DeliveryPolicyTransform({ worktreePath: repoRoot });
  const first = await readPaths(repoRoot, PATHS);
  await applyRc2DeliveryPolicyTransform({ worktreePath: repoRoot });
  const second = await readPaths(repoRoot, PATHS);
  for (const relativePath of PATHS) {
    assert.equal(second.get(relativePath).equals(first.get(relativePath)), true, relativePath);
  }

  const source = Object.fromEntries(
    [...first].map(([relativePath, bytes]) => [relativePath, bytes.toString('utf8')]),
  );
  for (const channel of Object.values(CHANNELS)) {
    assert.match(source[ENTRY_PATH], new RegExp(`import \\{ ${channel.resolver} \\}`));
    assert.match(source[ENTRY_PATH], new RegExp(`${channel.resolver}\\(`));
    assert.match(
      source[channel.production_path],
      new RegExp(`export function ${channel.resolver}\\(`),
    );
    for (const other of Object.values(CHANNELS).filter((entry) => entry !== channel)) {
      assert.doesNotMatch(source[channel.production_path], new RegExp(other.resolver));
    }

    const dedicated = source[channel.test_path];
    assert.match(dedicated, new RegExp(`import \\{ ${channel.resolver} \\}`));
    assert.match(dedicated, new RegExp(`export function ${channel.contract}\\(`));
    assert.match(dedicated, new RegExp(`${channel.resolver}\\(`));
    for (const caseId of channel.case_ids) assert.match(dedicated, new RegExp(caseId));
    for (const otherCaseId of CASE_IDS.filter((caseId) => !channel.case_ids.includes(caseId))) {
      assert.doesNotMatch(dedicated, new RegExp(otherCaseId));
    }
    for (const other of Object.values(CHANNELS).filter((entry) => entry !== channel)) {
      assert.doesNotMatch(dedicated, new RegExp(other.resolver));
    }
  }

  const shared = source[SHARED_TEST_PATH];
  assert.match(shared, /export function deliveryPolicyCompositionContract\(/);
  assert.match(shared, /resolveDeliveryPolicy\(/);
  assert.doesNotMatch(shared, /rc2-delivery-policy-oracle/);
  for (const caseId of CASE_IDS) assert.doesNotMatch(shared, new RegExp(caseId));
  assert.doesNotMatch(shared, /retry_limit:\s*(?:1|2|3|4|5)\b/);
  assert.doesNotMatch(shared, /delay_seconds:\s*(?:0|10|30|60)\b/);
});

test('accepted transactionはactual preimage、patch、oracle、6×4 matrix、cleanupをcross-bindする', async (t) => {
  const { runRc2DeliveryPolicySeamTransform } = await transformModule();
  const repoRoot = await makeFixtureRepo(t);
  const candidate = await candidateSpec();
  const candidateDigest = digestArtifact(candidate);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const originalEntry = await readFile(path.join(repoRoot, ENTRY_PATH));
  const originalOracle = await readFile(path.join(repoRoot, ORACLE_PATH));
  const actualControlFiles = await captureSurfaceFiles(repoRoot);

  assert.deepEqual(candidate.fixed_oracle.case_ids, CASE_IDS);
  assert.deepEqual(
    candidate.todos.map(({ todo_id, case_ids }) => ({ todo_id, case_ids })),
    Object.values(CHANNELS).map(({ todo_id, case_ids }) => ({ todo_id, case_ids })),
  );

  const result = await runRc2DeliveryPolicySeamTransform({
    repoRoot,
    baseRef: baseSha,
    candidateSpec: candidate,
  });

  exactKeys(result, [
    'schema',
    'status',
    'artifact',
    'artifact_digest',
    'receipt',
    'receipt_digest',
    'patch',
    'behavior_evidence',
    'mutation_evidence',
  ]);
  assert.equal(result.schema, 'lattice.rc2.delivery_policy_seam_transform_result.v1');
  assert.equal(result.status, 'accepted');
  assert.ok(Buffer.isBuffer(result.patch));
  assert.ok(result.patch.byteLength > 0);

  const { artifact, behavior_evidence: behavior, mutation_evidence: mutation, receipt } = result;
  exactKeys(artifact, [
    'schema',
    'status',
    'candidate',
    'source',
    'scope',
    'patch',
    'output',
    'behavior',
    'mutation',
    'verification',
    'cleanup',
    'rejection',
  ]);
  assert.equal(artifact.schema, 'lattice.rc2.delivery_policy_transform_artifact.v1');
  assert.equal(artifact.status, 'accepted');
  assert.equal(artifact.rejection, null);
  assert.equal(result.artifact_digest, digestArtifact(artifact));

  assert.deepEqual(artifact.candidate, {
    candidate_id: candidate.candidate_id,
    digest: candidateDigest,
  });
  exactKeys(artifact.source, [
    'base_sha',
    'adapter',
    'control_snapshot_digest',
    'fixed_oracle',
  ]);
  assert.equal(artifact.source.base_sha, baseSha);
  assert.deepEqual(artifact.source.adapter, {
    path: ADAPTER_PATH,
    digest: sha256(await readFile(new URL(MODULE, import.meta.url))),
  });
  assert.deepEqual(artifact.source.fixed_oracle, {
    path: ORACLE_PATH,
    source_digest: candidate.fixed_oracle.source_digest,
  });

  exactKeys(behavior, [
    'schema',
    'candidate_digest',
    'adapter_source_digest',
    'control_snapshot',
    'output_snapshot',
    'fixed_oracle',
    'pre_oracle',
    'post_oracle',
    'case_set_digest',
    'equivalent',
    'evidence_digest',
  ]);
  assert.equal(behavior.schema, 'lattice.rc2.delivery_policy_behavior_evidence.v1');
  assert.equal(behavior.candidate_digest, candidateDigest);
  assert.equal(behavior.adapter_source_digest, artifact.source.adapter.digest);
  assertSnapshot(
    behavior.control_snapshot,
    (relativePath) => (CURRENT_PRESENT.has(relativePath) ? 'present' : 'absent'),
  );
  assert.deepEqual(behavior.control_snapshot.files, actualControlFiles);
  assertSnapshot(behavior.output_snapshot, () => 'present');
  assert.equal(artifact.source.control_snapshot_digest, behavior.control_snapshot.digest);
  assert.deepEqual(artifact.output, {
    snapshot_digest: behavior.output_snapshot.digest,
    files: behavior.output_snapshot.files,
  });

  exactKeys(behavior.fixed_oracle, ['path', 'source_base64', 'source_digest']);
  assert.equal(behavior.fixed_oracle.path, ORACLE_PATH);
  assert.equal(behavior.fixed_oracle.source_digest, candidate.fixed_oracle.source_digest);
  assert.equal(sha256(Buffer.from(behavior.fixed_oracle.source_base64, 'base64')),
    behavior.fixed_oracle.source_digest);
  assert.equal(
    Buffer.from(behavior.fixed_oracle.source_base64, 'base64').equals(originalOracle),
    true,
  );
  for (const snapshot of [behavior.control_snapshot, behavior.output_snapshot]) {
    assert.equal(
      snapshot.files.find(({ path: relativePath }) => relativePath === ORACLE_PATH).content_digest,
      candidate.fixed_oracle.source_digest,
    );
  }

  assertOracleReceipt(behavior.pre_oracle);
  assertOracleReceipt(behavior.post_oracle);
  assert.deepEqual(behavior.post_oracle.case_results, behavior.pre_oracle.case_results);
  assert.equal(behavior.case_set_digest, oracleCaseSetDigest(behavior.pre_oracle));
  assert.equal(behavior.equivalent, true);
  assert.equal(behavior.evidence_digest, digestWithout(behavior, 'evidence_digest'));
  assert.deepEqual(artifact.behavior, {
    evidence_digest: behavior.evidence_digest,
    pre_oracle_digest: digestArtifact(behavior.pre_oracle),
    post_oracle_digest: digestArtifact(behavior.post_oracle),
    case_set_digest: behavior.case_set_digest,
    equivalent: true,
  });

  assert.deepEqual(artifact.scope, {
    allowed_paths: PATHS,
    changed_paths: PATHS,
  });
  assert.equal(artifact.patch.digest, sha256(result.patch));
  assert.equal(artifact.patch.bytes, result.patch.byteLength);
  assert.equal(artifact.verification.status, 'passed');
  assert.deepEqual(
    artifact.verification.receipts.map(({ args }) => args.at(-1)),
    TEST_CONTRACTS.map(({ path: relativePath }) => relativePath),
  );
  assert.equal(artifact.verification.receipts.every(({ outcome }) => outcome === 'passed'), true);

  exactKeys(mutation, [
    'schema',
    'candidate_digest',
    'case_set_digest',
    'rows',
    'matrix_digest',
    'evidence_digest',
  ]);
  assert.equal(mutation.schema, 'lattice.rc2.delivery_policy_mutation_evidence.v1');
  assert.equal(mutation.candidate_digest, candidateDigest);
  assert.equal(mutation.case_set_digest, behavior.case_set_digest);
  assert.deepEqual(mutation.rows.map(({ case_id }) => case_id), CASE_IDS);
  assert.equal(mutation.matrix_digest, digestArtifact({ rows: mutation.rows }));
  assert.equal(mutation.evidence_digest, digestWithout(mutation, 'evidence_digest'));

  for (const row of mutation.rows) {
    const owner = channelForCase(row.case_id);
    exactKeys(row, [
      'case_id',
      'owner_todo_id',
      'resolver_symbol',
      'mutated_path',
      'oracle_mismatch_id',
      'cells',
      'restore_digest',
    ]);
    assert.equal(row.owner_todo_id, owner.todo_id);
    assert.equal(row.resolver_symbol, owner.resolver);
    assert.equal(row.mutated_path, owner.production_path);
    assert.equal(row.oracle_mismatch_id, row.case_id);
    assert.deepEqual(
      row.cells.map(({ test_id, path: relativePath }) => ({ test_id, path: relativePath })),
      TEST_CONTRACTS,
    );
    for (const cell of row.cells) {
      exactKeys(cell, [
        'test_id',
        'path',
        'outcome',
        'exit_code',
        'stdout_digest',
        'stderr_digest',
      ]);
      const isOwner = cell.test_id === owner.contract;
      assert.equal(cell.outcome, isOwner ? 'failed' : 'passed');
      if (isOwner) assert.notEqual(cell.exit_code, 0);
      else assert.equal(cell.exit_code, 0);
      assert.match(cell.stdout_digest, /^[0-9a-f]{64}$/);
      assert.match(cell.stderr_digest, /^[0-9a-f]{64}$/);
    }
    assert.equal(row.restore_digest, behavior.output_snapshot.digest);
  }
  assert.deepEqual(artifact.mutation, {
    evidence_digest: mutation.evidence_digest,
    matrix_digest: mutation.matrix_digest,
    row_count: CASE_IDS.length,
    cell_count: CASE_IDS.length * TEST_CONTRACTS.length,
  });

  exactKeys(receipt, [
    'schema',
    'status',
    'transform_artifact_digest',
    'behavior_evidence_digest',
    'mutation_evidence_digest',
    'source_invariant',
    'cleanup',
    'receipt_digest',
  ]);
  assert.equal(receipt.schema, 'lattice.rc2.delivery_policy_transform_receipt.v1');
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.transform_artifact_digest, result.artifact_digest);
  assert.equal(receipt.behavior_evidence_digest, behavior.evidence_digest);
  assert.equal(receipt.mutation_evidence_digest, mutation.evidence_digest);
  assert.equal(receipt.source_invariant.outcome, 'passed');
  assert.deepEqual(receipt.cleanup, {
    schema: 'lattice.rc2.delivery_policy_cleanup_receipt.v1',
    outcome: 'passed',
    worktree_count_before: 1,
    worktree_count_after: 1,
  });
  assert.deepEqual(artifact.cleanup, {
    status: 'passed',
    source_status: 'unchanged',
    receipt_digest: digestArtifact(receipt.cleanup),
  });
  assert.equal(receipt.receipt_digest, digestWithout(receipt, 'receipt_digest'));
  assert.equal(result.receipt_digest, receipt.receipt_digest);

  const patchRoot = await makeFixtureRepo(t);
  applyGitPatch(patchRoot, result.patch);
  assert.deepEqual(changedPaths(patchRoot), PATHS);
  assert.deepEqual(await captureSurfaceFiles(patchRoot), behavior.output_snapshot.files);

  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), baseSha);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal((await readFile(path.join(repoRoot, ENTRY_PATH))).equals(originalEntry), true);
  assert.equal((await readFile(path.join(repoRoot, ORACLE_PATH))).equals(originalOracle), true);
  assert.equal(worktreeCount(repoRoot), 1);
});

test('incomplete shardとactual oracle bytes driftはdistinct rejected transactionになる', async (t) => {
  const {
    applyRc2DeliveryPolicyTransform,
    runRc2DeliveryPolicySeamTransform,
  } = await transformModule();
  const candidate = await candidateSpec();

  const incompleteRoot = await makeFixtureRepo(t);
  const incomplete = await runRc2DeliveryPolicySeamTransform({
    repoRoot: incompleteRoot,
    baseRef: 'HEAD',
    candidateSpec: candidate,
    transform: async (context) => {
      await applyRc2DeliveryPolicyTransform(context);
      await rm(path.join(context.worktreePath, CHANNELS.email.production_path));
    },
  });

  const scopeRoot = await makeFixtureRepo(t);
  const scope = await runRc2DeliveryPolicySeamTransform({
    repoRoot: scopeRoot,
    baseRef: 'HEAD',
    candidateSpec: candidate,
    transform: async (context) => {
      await applyRc2DeliveryPolicyTransform(context);
      const oraclePath = path.join(context.worktreePath, ORACLE_PATH);
      const oracleBytes = await readFile(oraclePath);
      await writeFile(oraclePath, Buffer.concat([
        oracleBytes,
        Buffer.from('\n// intentional scope drift\n', 'utf8'),
      ]));
    },
  });

  for (const [result, kind, repoRoot] of [
    [incomplete, 'incomplete_transform', incompleteRoot],
    [scope, 'scope_violation', scopeRoot],
  ]) {
    assert.equal(result.schema, 'lattice.rc2.delivery_policy_seam_transform_result.v1');
    assert.equal(result.status, 'rejected');
    assert.equal(result.artifact.status, 'rejected');
    assert.equal(result.artifact.rejection.kind, kind);
    assert.equal(result.artifact.output, null);
    assert.equal(result.artifact.behavior, null);
    assert.equal(result.artifact.mutation, null);
    assert.equal(result.behavior_evidence, null);
    assert.equal(result.mutation_evidence, null);
    assert.equal(result.receipt.status, 'rejected');
    assert.equal(result.receipt.behavior_evidence_digest, null);
    assert.equal(result.receipt.mutation_evidence_digest, null);
    assert.equal(result.receipt.source_invariant.outcome, 'passed');
    assert.equal(result.receipt.cleanup.outcome, 'passed');
    assert.equal(result.artifact.cleanup.status, 'passed');
    assert.equal(result.artifact.cleanup.source_status, 'unchanged');
    assert.equal(Object.hasOwn(result, 'accepted_output'), false);
    assert.equal(Object.hasOwn(result, 'new_plan'), false);
    assert.equal(result.artifact_digest, digestArtifact(result.artifact));
    assert.equal(result.receipt.receipt_digest, digestWithout(result.receipt, 'receipt_digest'));
    assert.equal(result.receipt_digest, result.receipt.receipt_digest);
    assert.equal(git(repoRoot, ['status', '--porcelain']), '');
    assert.equal(worktreeCount(repoRoot), 1);
  }
});

test('candidate drift、HEAD/base mismatch、dirty canonical sourceはtransform開始前にfail-loudになる', async (t) => {
  const { runRc2DeliveryPolicySeamTransform } = await transformModule();
  const candidate = await candidateSpec();

  const candidateRoot = await makeFixtureRepo(t);
  const driftedCandidate = structuredClone(candidate);
  driftedCandidate.fixed_oracle.source_digest = '0'.repeat(64);
  await assert.rejects(() => runRc2DeliveryPolicySeamTransform({
    repoRoot: candidateRoot,
    baseRef: 'HEAD',
    candidateSpec: driftedCandidate,
  }));
  assert.equal(worktreeCount(candidateRoot), 1);

  const baseRoot = await makeFixtureRepo(t);
  const oldBase = git(baseRoot, ['rev-parse', 'HEAD']);
  git(baseRoot, ['commit', '--allow-empty', '-m', 'HEADをbaseより先へ進める']);
  await assert.rejects(() => runRc2DeliveryPolicySeamTransform({
    repoRoot: baseRoot,
    baseRef: oldBase,
    candidateSpec: candidate,
  }));
  assert.equal(worktreeCount(baseRoot), 1);

  const dirtyRoot = await makeFixtureRepo(t);
  await writeFile(path.join(dirtyRoot, 'dirty.mjs'), 'export const dirty = true;\n');
  await assert.rejects(() => runRc2DeliveryPolicySeamTransform({
    repoRoot: dirtyRoot,
    baseRef: 'HEAD',
    candidateSpec: candidate,
  }));
  assert.equal(worktreeCount(dirtyRoot), 1);
});
