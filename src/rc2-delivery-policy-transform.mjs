import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';
import { runRc2DeliveryPolicyOracle } from './rc2-delivery-policy-oracle.mjs';

const ADAPTER_PATH = 'src/rc2-delivery-policy-transform.mjs';
const ENTRY_PATH = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const ORACLE_PATH = 'src/rc2-delivery-policy-oracle.mjs';
const SHARED_TEST_PATH = 'test/rc2-delivery-policy-fixture.test.mjs';
const EXPECTED_CANDIDATE_ID = 'shard-delivery-policy-registry-by-channel';
const EXPECTED_CANDIDATE_DIGEST = '30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5';
const GIT_SHA1 = /^[0-9a-f]{40}$/;

export const RC2_DELIVERY_POLICY_TRANSFORM_PATHS = Object.freeze([
  ENTRY_PATH,
  'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
  'test/rc2-delivery-policy-email.test.mjs',
  SHARED_TEST_PATH,
  'test/rc2-delivery-policy-push.test.mjs',
  'test/rc2-delivery-policy-sms.test.mjs',
]);

const SURFACE_PATHS = Object.freeze([
  ...RC2_DELIVERY_POLICY_TRANSFORM_PATHS,
  ORACLE_PATH,
].sort());

const CURRENT_PATHS = new Set([ENTRY_PATH, SHARED_TEST_PATH, ORACLE_PATH]);

const CHANNELS = Object.freeze({
  email: Object.freeze({
    todoId: 'email-policy',
    resolver: 'resolveEmailPolicy',
    productionPath: 'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
    contract: 'emailPolicyContract',
    testPath: 'test/rc2-delivery-policy-email.test.mjs',
    caseIds: Object.freeze(['email-routine', 'email-urgent']),
  }),
  sms: Object.freeze({
    todoId: 'sms-policy',
    resolver: 'resolveSmsPolicy',
    productionPath: 'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
    contract: 'smsPolicyContract',
    testPath: 'test/rc2-delivery-policy-sms.test.mjs',
    caseIds: Object.freeze(['sms-routine', 'sms-urgent']),
  }),
  push: Object.freeze({
    todoId: 'push-policy',
    resolver: 'resolvePushPolicy',
    productionPath: 'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
    contract: 'pushPolicyContract',
    testPath: 'test/rc2-delivery-policy-push.test.mjs',
    caseIds: Object.freeze(['push-routine', 'push-urgent']),
  }),
});

const TEST_CONTRACTS = Object.freeze([
  Object.freeze({ testId: CHANNELS.email.contract, path: CHANNELS.email.testPath }),
  Object.freeze({ testId: CHANNELS.sms.contract, path: CHANNELS.sms.testPath }),
  Object.freeze({ testId: CHANNELS.push.contract, path: CHANNELS.push.testPath }),
  Object.freeze({ testId: 'deliveryPolicyCompositionContract', path: SHARED_TEST_PATH }),
]);

const MUTATIONS = Object.freeze([
  Object.freeze({
    caseId: 'email-routine',
    owner: CHANNELS.email,
    needle: "routine: Object.freeze({ transport: 'smtp', retry_limit: 3, delay_seconds: 60 }),",
    replacement: "routine: Object.freeze({ transport: 'smtp', retry_limit: 103, delay_seconds: 60 }),",
  }),
  Object.freeze({
    caseId: 'email-urgent',
    owner: CHANNELS.email,
    needle: "urgent: Object.freeze({ transport: 'smtp', retry_limit: 5, delay_seconds: 0 }),",
    replacement: "urgent: Object.freeze({ transport: 'smtp', retry_limit: 105, delay_seconds: 0 }),",
  }),
  Object.freeze({
    caseId: 'sms-routine',
    owner: CHANNELS.sms,
    needle: "routine: Object.freeze({ transport: 'sms', retry_limit: 2, delay_seconds: 30 }),",
    replacement: "routine: Object.freeze({ transport: 'sms', retry_limit: 2, delay_seconds: 130 }),",
  }),
  Object.freeze({
    caseId: 'sms-urgent',
    owner: CHANNELS.sms,
    needle: "urgent: Object.freeze({ transport: 'sms', retry_limit: 4, delay_seconds: 0 }),",
    replacement: "urgent: Object.freeze({ transport: 'sms', retry_limit: 104, delay_seconds: 0 }),",
  }),
  Object.freeze({
    caseId: 'push-routine',
    owner: CHANNELS.push,
    needle: "routine: Object.freeze({ transport: 'push', retry_limit: 1, delay_seconds: 10 }),",
    replacement: "routine: Object.freeze({ transport: 'push', retry_limit: 1, delay_seconds: 110 }),",
  }),
  Object.freeze({
    caseId: 'push-urgent',
    owner: CHANNELS.push,
    needle: "urgent: Object.freeze({ transport: 'push', retry_limit: 3, delay_seconds: 0 }),",
    replacement: "urgent: Object.freeze({ transport: 'push', retry_limit: 103, delay_seconds: 0 }),",
  }),
]);

const ENTRY_SOURCE = `import { resolveEmailPolicy } from './email-policy.mjs';
import { resolvePushPolicy } from './push-policy.mjs';
import { resolveSmsPolicy } from './sms-policy.mjs';

const INPUT_KEYS = Object.freeze(['channel', 'urgency']);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactInputKeys(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === INPUT_KEYS.length
    && keys.every((key, index) => key === INPUT_KEYS[index]);
}

/** 公開inputを検証し、channel別resolverへroutingするcomposition entry。 */
export function resolveDeliveryPolicy(input) {
  if (!hasExactInputKeys(input)) {
    throw new TypeError('delivery policy input must be a plain object with exact keys: channel, urgency');
  }
  let policy;
  if (input.channel === 'email') {
    policy = resolveEmailPolicy(input.urgency);
  } else if (input.channel === 'push') {
    policy = resolvePushPolicy(input.urgency);
  } else if (input.channel === 'sms') {
    policy = resolveSmsPolicy(input.urgency);
  } else {
    throw new RangeError('channel must be email, sms, or push');
  }
  return { channel: input.channel, ...policy };
}
`;

const EMAIL_SOURCE = `const POLICIES = Object.freeze({
  routine: Object.freeze({ transport: 'smtp', retry_limit: 3, delay_seconds: 60 }),
  urgent: Object.freeze({ transport: 'smtp', retry_limit: 5, delay_seconds: 0 }),
});

export function resolveEmailPolicy(urgency) {
  if (!Object.hasOwn(POLICIES, urgency)) {
    throw new RangeError('urgency must be routine or urgent');
  }
  return { ...POLICIES[urgency] };
}
`;

const SMS_SOURCE = `const POLICIES = Object.freeze({
  routine: Object.freeze({ transport: 'sms', retry_limit: 2, delay_seconds: 30 }),
  urgent: Object.freeze({ transport: 'sms', retry_limit: 4, delay_seconds: 0 }),
});

export function resolveSmsPolicy(urgency) {
  if (!Object.hasOwn(POLICIES, urgency)) {
    throw new RangeError('urgency must be routine or urgent');
  }
  return { ...POLICIES[urgency] };
}
`;

const PUSH_SOURCE = `const POLICIES = Object.freeze({
  routine: Object.freeze({ transport: 'push', retry_limit: 1, delay_seconds: 10 }),
  urgent: Object.freeze({ transport: 'push', retry_limit: 3, delay_seconds: 0 }),
});

export function resolvePushPolicy(urgency) {
  if (!Object.hasOwn(POLICIES, urgency)) {
    throw new RangeError('urgency must be routine or urgent');
  }
  return { ...POLICIES[urgency] };
}
`;

const EMAIL_TEST_SOURCE = `import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmailPolicy } from '../research/fixtures/delivery-policy-registry/src/email-policy.mjs';

export function emailPolicyContract() {
  assert.deepEqual(resolveEmailPolicy('routine'), {
    transport: 'smtp', retry_limit: 3, delay_seconds: 60,
  });
  assert.deepEqual(resolveEmailPolicy('urgent'), {
    transport: 'smtp', retry_limit: 5, delay_seconds: 0,
  });
}

test('email-routine and email-urgent policy contract', emailPolicyContract);
`;

const SMS_TEST_SOURCE = `import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSmsPolicy } from '../research/fixtures/delivery-policy-registry/src/sms-policy.mjs';

export function smsPolicyContract() {
  assert.deepEqual(resolveSmsPolicy('routine'), {
    transport: 'sms', retry_limit: 2, delay_seconds: 30,
  });
  assert.deepEqual(resolveSmsPolicy('urgent'), {
    transport: 'sms', retry_limit: 4, delay_seconds: 0,
  });
}

test('sms-routine and sms-urgent policy contract', smsPolicyContract);
`;

const PUSH_TEST_SOURCE = `import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePushPolicy } from '../research/fixtures/delivery-policy-registry/src/push-policy.mjs';

export function pushPolicyContract() {
  assert.deepEqual(resolvePushPolicy('routine'), {
    transport: 'push', retry_limit: 1, delay_seconds: 10,
  });
  assert.deepEqual(resolvePushPolicy('urgent'), {
    transport: 'push', retry_limit: 3, delay_seconds: 0,
  });
}

test('push-routine and push-urgent policy contract', pushPolicyContract);
`;

const SHARED_TEST_SOURCE = `import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDeliveryPolicy } from '../research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';

export function deliveryPolicyCompositionContract() {
  for (const channel of ['email', 'sms', 'push']) {
    const output = resolveDeliveryPolicy({ channel, urgency: 'routine' });
    assert.equal(output.channel, channel);
    assert.deepEqual(Object.keys(output).sort(), [
      'channel', 'delay_seconds', 'retry_limit', 'transport',
    ]);
    assert.equal(typeof output.transport, 'string');
    assert.equal(typeof output.retry_limit, 'number');
    assert.equal(typeof output.delay_seconds, 'number');
  }
  assert.throws(() => resolveDeliveryPolicy(null), { name: 'TypeError' });
  assert.throws(() => resolveDeliveryPolicy({ channel: 'email' }), { name: 'TypeError' });
  assert.throws(
    () => resolveDeliveryPolicy({ channel: 'email', urgency: 'routine', extra: true }),
    { name: 'TypeError' },
  );
  assert.throws(
    () => resolveDeliveryPolicy({ channel: 'webhook', urgency: 'routine' }),
    { name: 'RangeError' },
  );
  assert.throws(
    () => resolveDeliveryPolicy({ channel: 'email', urgency: 'later' }),
    { name: 'RangeError' },
  );
}

test('delivery policy composition routing, shape, and fail-loud contract',
  deliveryPolicyCompositionContract);
`;

const WRITER_FILES = new Map([
  [ENTRY_PATH, ENTRY_SOURCE],
  [CHANNELS.email.productionPath, EMAIL_SOURCE],
  [CHANNELS.push.productionPath, PUSH_SOURCE],
  [CHANNELS.sms.productionPath, SMS_SOURCE],
  [CHANNELS.email.testPath, EMAIL_TEST_SOURCE],
  [SHARED_TEST_PATH, SHARED_TEST_SOURCE],
  [CHANNELS.push.testPath, PUSH_TEST_SOURCE],
  [CHANNELS.sms.testPath, SMS_TEST_SOURCE],
]);

class TransformContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TransformContractError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function statusPaths(status) {
  const fields = status.split('\0');
  const paths = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (code[0] === 'R' || code[0] === 'C') paths.push(fields[++index]);
  }
  return [...new Set(paths)].sort();
}

function spawnCapture(command, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

async function git(repoRoot, args) {
  const result = await spawnCapture('git', ['-C', repoRoot, ...args]);
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout.toString('utf8');
}

async function resolveRepository(repoRoot, baseRef) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0) {
    throw new TypeError('repoRoot and baseRef must be non-empty strings');
  }
  const root = await realpath(repoRoot);
  const status = await git(root, ['status', '--porcelain=v1', '-z']);
  if (status.length !== 0) throw new Error('canonical source repository must be clean');
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const baseSha = (await git(root, ['rev-parse', '--verify', `${baseRef}^{commit}`])).trim();
  if (!GIT_SHA1.test(head) || !GIT_SHA1.test(baseSha)) {
    throw new TypeError('HEAD or baseRef did not resolve to a Git SHA-1');
  }
  if (head !== baseSha) throw new Error('canonical HEAD must equal the exact baseRef commit');
  return { root, baseSha };
}

async function worktreeCount(repoRoot) {
  const output = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  return output.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

async function inspectPath(repoRoot, relativePath) {
  const segments = relativePath.split('/');
  let current = repoRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: 'absent', path: current };
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new TransformContractError(
        'LATTICE_RC2_SCOPE_VIOLATION',
        `symlink surface is not allowed: ${relativePath}`,
      );
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new TransformContractError(
        'LATTICE_RC2_SCOPE_VIOLATION',
        `non-directory surface ancestor is not allowed: ${relativePath}`,
      );
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new TransformContractError(
        'LATTICE_RC2_SCOPE_VIOLATION',
        `special surface is not allowed: ${relativePath}`,
      );
    }
  }
  return { state: 'present', path: current };
}

async function readRegularFile(repoRoot, relativePath) {
  const inspected = await inspectPath(repoRoot, relativePath);
  if (inspected.state !== 'present') {
    throw new TransformContractError(
      'LATTICE_RC2_INCOMPLETE_TRANSFORM',
      `required transform surface is absent: ${relativePath}`,
    );
  }
  return readFile(inspected.path);
}

async function safeWrite(repoRoot, relativePath, bytes) {
  const segments = relativePath.split('/');
  let current = repoRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new TransformContractError(
          'LATTICE_RC2_SCOPE_VIOLATION',
          `unsafe writer ancestor: ${relativePath}`,
        );
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
  const target = path.join(repoRoot, relativePath);
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new TransformContractError(
        'LATTICE_RC2_SCOPE_VIOLATION',
        `unsafe writer target: ${relativePath}`,
      );
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(target, bytes);
}

async function captureSurfaceSnapshot(repoRoot) {
  const files = [];
  for (const relativePath of SURFACE_PATHS) {
    const inspected = await inspectPath(repoRoot, relativePath);
    files.push(inspected.state === 'present'
      ? {
        path: relativePath,
        state: 'present',
        content_digest: sha256(await readFile(inspected.path)),
      }
      : { path: relativePath, state: 'absent', content_digest: null });
  }
  const value = {
    schema: 'lattice.rc2.delivery_policy_surface_snapshot.v1',
    files,
  };
  return { ...value, digest: digestArtifact(value) };
}

function assertControlSnapshot(snapshot) {
  for (const file of snapshot.files) {
    const expected = CURRENT_PATHS.has(file.path) ? 'present' : 'absent';
    if (file.state !== expected) {
      throw new TypeError('candidate control surface is not the exact current topology');
    }
  }
}

function assertOutputSnapshot(snapshot, oracleDigest) {
  if (snapshot.files.some(({ state }) => state !== 'present')) {
    throw new TransformContractError(
      'LATTICE_RC2_INCOMPLETE_TRANSFORM',
      'post-transform surface is incomplete',
    );
  }
  const oracle = snapshot.files.find(({ path: relativePath }) => relativePath === ORACLE_PATH);
  if (oracle?.content_digest !== oracleDigest) {
    throw new TransformContractError(
      'LATTICE_RC2_SCOPE_VIOLATION',
      'fixed oracle bytes changed during transform',
    );
  }
}

function assertAcceptedCandidate(candidateSpec) {
  const candidateDigest = digestArtifact(candidateSpec);
  if (candidateDigest !== EXPECTED_CANDIDATE_DIGEST
    || candidateSpec?.schema !== 'lattice.rc2.boundary_candidate_spec.v1'
    || candidateSpec?.candidate_id !== EXPECTED_CANDIDATE_ID
    || candidateSpec?.fixed_oracle?.path !== ORACLE_PATH
    || !sameArray(candidateSpec.fixed_oracle.case_ids, MUTATIONS.map(({ caseId }) => caseId))) {
    throw new TypeError('candidateSpec is not the accepted RC2 delivery policy witness');
  }
  const todoProjection = candidateSpec.todos.map((todo) => ({
    todoId: todo.todo_id,
    caseIds: todo.case_ids,
    resolver: todo.proposed.production.symbol,
    productionPath: todo.proposed.production.path,
    contract: todo.proposed.tests[0].symbol,
    testPath: todo.proposed.tests[0].path,
  }));
  const expectedProjection = Object.values(CHANNELS).map((channel) => ({
    todoId: channel.todoId,
    caseIds: channel.caseIds,
    resolver: channel.resolver,
    productionPath: channel.productionPath,
    contract: channel.contract,
    testPath: channel.testPath,
  }));
  if (digestArtifact(todoProjection) !== digestArtifact(expectedProjection)) {
    throw new TypeError('candidateSpec case partition or proposed ownership is invalid');
  }
  return { candidateDigest, fixedCandidate: structuredClone(candidateSpec) };
}

function assertOracleReceipt(receipt, candidateSpec) {
  if (!exactRecord(receipt, ['schema', 'outcome', 'case_results'])
    || receipt.schema !== 'lattice.rc2.delivery_policy_oracle_receipt.v1'
    || receipt.outcome !== 'passed'
    || !sameArray(
      receipt.case_results.map(({ id }) => id),
      candidateSpec.fixed_oracle.case_ids,
    )
    || receipt.case_results.some((result) => (
      !exactRecord(result, ['id', 'outcome', 'output_digest'])
      || result.outcome !== 'passed'
      || typeof result.output_digest !== 'string'
      || !/^[0-9a-f]{64}$/.test(result.output_digest)
    ))) {
    throw new TransformContractError(
      'LATTICE_RC2_ORACLE_DIVERGENCE',
      'fixed oracle receipt is invalid',
    );
  }
}

function oracleCaseSetDigest(receipt) {
  return digestArtifact({
    case_results: receipt.case_results.map(({ id, output_digest }) => ({ id, output_digest })),
  });
}

async function assertCompleteTransform(worktreePath, oracleDigest) {
  const changedPaths = statusPaths(await git(worktreePath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching',
  ]));
  const outside = changedPaths.find((relativePath) => (
    !RC2_DELIVERY_POLICY_TRANSFORM_PATHS.includes(relativePath)
  ));
  if (outside !== undefined) {
    throw new TransformContractError(
      'LATTICE_RC2_SCOPE_VIOLATION',
      `writer changed a path outside the exact allowlist: ${outside}`,
    );
  }
  const oracle = await inspectPath(worktreePath, ORACLE_PATH);
  if (oracle.state !== 'present') {
    throw new TransformContractError(
      'LATTICE_RC2_SCOPE_VIOLATION',
      'fixed oracle was removed during writer execution',
    );
  }
  const actualOracleDigest = sha256(await readFile(oracle.path));
  if (actualOracleDigest !== oracleDigest) {
    throw new TransformContractError(
      'LATTICE_RC2_SCOPE_VIOLATION',
      'fixed oracle bytes changed during writer execution',
    );
  }
  for (const relativePath of RC2_DELIVERY_POLICY_TRANSFORM_PATHS) {
    await readRegularFile(worktreePath, relativePath);
  }
}

function testEnvironment() {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  return env;
}

async function runMutationCell(worktreePath, contract) {
  const result = await spawnCapture(process.execPath, [
    '--test',
    '--test-reporter=dot',
    contract.path,
  ], { cwd: worktreePath, env: testEnvironment() });
  const exitCode = Number.isSafeInteger(result.code) && result.code >= 0 ? result.code : 1;
  return {
    test_id: contract.testId,
    path: contract.path,
    outcome: exitCode === 0 && result.signal === null ? 'passed' : 'failed',
    exit_code: exitCode,
    stdout_digest: sha256(result.stdout),
    stderr_digest: sha256(result.stderr),
  };
}

async function observeOracleMismatch(worktreePath, expectedCaseId) {
  try {
    await runRc2DeliveryPolicyOracle({ repoRoot: worktreePath });
  } catch (error) {
    const match = String(error?.message ?? error)
      .match(/delivery policy behavior mismatch: ([a-z]+-(?:routine|urgent))/);
    if (match?.[1] === expectedCaseId) return match[1];
    throw new TransformContractError(
      'LATTICE_RC2_MUTATION_MATRIX_FAILURE',
      `mutation oracle mismatch was not ${expectedCaseId}`,
    );
  }
  throw new TransformContractError(
    'LATTICE_RC2_MUTATION_MATRIX_FAILURE',
    `mutation oracle unexpectedly passed: ${expectedCaseId}`,
  );
}

async function runMutationMatrix({
  worktreePath,
  outputSnapshot,
  candidateDigest,
  caseSetDigest,
}) {
  const rows = [];
  for (const mutation of MUTATIONS) {
    const original = await readRegularFile(worktreePath, mutation.owner.productionPath);
    const source = original.toString('utf8');
    if (source.split(mutation.needle).length !== 2) {
      throw new TransformContractError(
        'LATTICE_RC2_MUTATION_MATRIX_FAILURE',
        `mutation target is not unique: ${mutation.caseId}`,
      );
    }
    await safeWrite(
      worktreePath,
      mutation.owner.productionPath,
      Buffer.from(source.replace(mutation.needle, mutation.replacement), 'utf8'),
    );

    let primaryError;
    let oracleMismatchId;
    let cells;
    try {
      oracleMismatchId = await observeOracleMismatch(worktreePath, mutation.caseId);
      cells = [];
      for (const contract of TEST_CONTRACTS) {
        cells.push(await runMutationCell(worktreePath, contract));
      }
      for (const cell of cells) {
        const owner = cell.test_id === mutation.owner.contract;
        if ((owner && (cell.outcome !== 'failed' || cell.exit_code === 0))
          || (!owner && (cell.outcome !== 'passed' || cell.exit_code !== 0))) {
          throw new TransformContractError(
            'LATTICE_RC2_MUTATION_MATRIX_FAILURE',
            `owner-only test partition failed: ${mutation.caseId}/${cell.test_id}`,
          );
        }
      }
    } catch (error) {
      primaryError = error;
    }

    try {
      await safeWrite(worktreePath, mutation.owner.productionPath, original);
    } catch (error) {
      throw new TransformContractError(
        'LATTICE_RC2_RESTORE_FAILURE',
        `mutation source restore failed: ${mutation.caseId}: ${error.message}`,
      );
    }
    const restored = await captureSurfaceSnapshot(worktreePath);
    if (restored.digest !== outputSnapshot.digest) {
      throw new TransformContractError(
        'LATTICE_RC2_RESTORE_FAILURE',
        `mutation snapshot restore failed: ${mutation.caseId}`,
      );
    }
    if (primaryError) throw primaryError;

    rows.push({
      case_id: mutation.caseId,
      owner_todo_id: mutation.owner.todoId,
      resolver_symbol: mutation.owner.resolver,
      mutated_path: mutation.owner.productionPath,
      oracle_mismatch_id: oracleMismatchId,
      cells,
      restore_digest: restored.digest,
    });
  }
  const matrixDigest = digestArtifact({ rows });
  const value = {
    schema: 'lattice.rc2.delivery_policy_mutation_evidence.v1',
    candidate_digest: candidateDigest,
    case_set_digest: caseSetDigest,
    rows,
    matrix_digest: matrixDigest,
  };
  return { ...value, evidence_digest: digestArtifact(value) };
}

function makeBehaviorEvidence({
  candidateDigest,
  adapterSourceDigest,
  controlSnapshot,
  outputSnapshot,
  oracleBytes,
  oracleDigest,
  preOracle,
  postOracle,
}) {
  const value = {
    schema: 'lattice.rc2.delivery_policy_behavior_evidence.v1',
    candidate_digest: candidateDigest,
    adapter_source_digest: adapterSourceDigest,
    control_snapshot: structuredClone(controlSnapshot),
    output_snapshot: structuredClone(outputSnapshot),
    fixed_oracle: {
      path: ORACLE_PATH,
      source_base64: oracleBytes.toString('base64'),
      source_digest: oracleDigest,
    },
    pre_oracle: structuredClone(preOracle),
    post_oracle: structuredClone(postOracle),
    case_set_digest: oracleCaseSetDigest(preOracle),
    equivalent: true,
  };
  return { ...value, evidence_digest: digestArtifact(value) };
}

function makeCleanupReceipt(beforeCount, afterCount, forcedFailure = false) {
  return {
    schema: 'lattice.rc2.delivery_policy_cleanup_receipt.v1',
    outcome: !forcedFailure && beforeCount === afterCount ? 'passed' : 'failed',
    worktree_count_before: beforeCount,
    worktree_count_after: afterCount,
  };
}

function makeReceipt({
  status,
  artifactDigest,
  behaviorEvidenceDigest,
  mutationEvidenceDigest,
  sourceInvariant,
  cleanup,
}) {
  const value = {
    schema: 'lattice.rc2.delivery_policy_transform_receipt.v1',
    status,
    transform_artifact_digest: artifactDigest,
    behavior_evidence_digest: behaviorEvidenceDigest,
    mutation_evidence_digest: mutationEvidenceDigest,
    source_invariant: sourceInvariant ?? null,
    cleanup: structuredClone(cleanup),
  };
  return { ...value, receipt_digest: digestArtifact(value) };
}

function makeResult({ artifact, patch, behaviorEvidence, mutationEvidence, cleanup, sourceInvariant }) {
  const artifactDigest = digestArtifact(artifact);
  const receipt = makeReceipt({
    status: artifact.status,
    artifactDigest,
    behaviorEvidenceDigest: behaviorEvidence?.evidence_digest ?? null,
    mutationEvidenceDigest: mutationEvidence?.evidence_digest ?? null,
    sourceInvariant,
    cleanup,
  });
  return {
    schema: 'lattice.rc2.delivery_policy_seam_transform_result.v1',
    status: artifact.status,
    artifact,
    artifact_digest: artifactDigest,
    receipt,
    receipt_digest: receipt.receipt_digest,
    patch: Buffer.isBuffer(patch) ? Buffer.from(patch) : null,
    behavior_evidence: behaviorEvidence ? structuredClone(behaviorEvidence) : null,
    mutation_evidence: mutationEvidence ? structuredClone(mutationEvidence) : null,
  };
}

function flattenErrors(error) {
  if (error instanceof AggregateError) return error.errors.flatMap(flattenErrors);
  return [error];
}

function transformEvidence(error) {
  return flattenErrors(error)
    .map((entry) => entry?.transformEvidence)
    .find((entry) => entry && typeof entry.baseSha === 'string');
}

function rejectionFacts(error) {
  const errors = flattenErrors(error);
  const codes = new Set(errors.map((entry) => entry?.code).filter(Boolean));
  const messages = errors.map((entry) => String(entry?.message ?? entry)).join('\n');
  if (codes.has('LATTICE_RC2_INCOMPLETE_TRANSFORM')) {
    return { kind: 'incomplete_transform', reason: 'required production or test seam is incomplete' };
  }
  if (codes.has('LATTICE_RC2_SCOPE_VIOLATION')
    || /outside allowed paths|symlink change|submodule change|special file change/i.test(messages)) {
    return { kind: 'scope_violation', reason: 'transform changed or traversed a forbidden surface' };
  }
  if (codes.has('LATTICE_RC2_MUTATION_MATRIX_FAILURE')) {
    return { kind: 'mutation_matrix_failure', reason: 'owner-only mutation sensitivity was not proven' };
  }
  if (codes.has('LATTICE_RC2_RESTORE_FAILURE')) {
    return { kind: 'restore_failure', reason: 'mutation bytes did not restore to the accepted snapshot' };
  }
  if (codes.has('LATTICE_RC2_ORACLE_DIVERGENCE')
    || /delivery policy behavior mismatch|oracle child failed/i.test(messages)) {
    return { kind: 'oracle_divergence', reason: 'fixed oracle did not preserve the ordered behavior set' };
  }
  if (/verifier failed/i.test(messages)) {
    return { kind: 'behavior_verification_failed', reason: 'focused production or test seam verifier failed' };
  }
  if (/mutated isolated snapshot/i.test(messages)) {
    return { kind: 'snapshot_mutation', reason: 'observer or verifier changed the accepted isolated patch' };
  }
  if (/source repository changed/i.test(messages)) {
    return { kind: 'source_invariant_violation', reason: 'canonical source changed during isolation' };
  }
  if (/cleanup failed/i.test(messages)) {
    return { kind: 'cleanup_failure', reason: 'disposable worktree cleanup failed' };
  }
  if (codes.has('LATTICE_RC2_CLEANUP_FAILURE')) {
    return { kind: 'cleanup_failure', reason: 'disposable worktree cleanup evidence failed' };
  }
  return { kind: 'execution_failure', reason: 'isolated delivery policy transaction failed' };
}

function verificationArtifact(status, receipts) {
  return { status, receipts: structuredClone(receipts) };
}

function rejectedResult({
  error,
  evidence,
  candidate,
  candidateDigest,
  baseSha,
  adapterSourceDigest,
  controlSnapshot,
  oracleDigest,
  beforeCount,
  afterCount,
}) {
  const facts = rejectionFacts(error);
  const errors = flattenErrors(error);
  const messages = errors.map((entry) => String(entry?.message ?? entry));
  const cleanup = makeCleanupReceipt(
    beforeCount,
    afterCount,
    messages.some((message) => /cleanup failed/i.test(message)),
  );
  const sourceInvariant = evidence?.sourceInvariant ?? null;
  const patch = Buffer.isBuffer(evidence?.patch) ? evidence.patch : null;
  const receipts = Array.isArray(evidence?.verifications) ? evidence.verifications : [];
  const verificationStatus = receipts.length === 0
    ? 'not_run'
    : (receipts.some(({ outcome }) => outcome !== 'passed') ? 'failed' : 'passed');
  const rejection = {
    kind: facts.kind,
    reasons: [facts.reason],
  };
  const artifact = {
    schema: 'lattice.rc2.delivery_policy_transform_artifact.v1',
    status: 'rejected',
    candidate: {
      candidate_id: candidate.candidate_id,
      digest: candidateDigest,
    },
    source: {
      base_sha: baseSha,
      adapter: { path: ADAPTER_PATH, digest: adapterSourceDigest },
      control_snapshot_digest: controlSnapshot.digest,
      fixed_oracle: { path: ORACLE_PATH, source_digest: oracleDigest },
    },
    scope: {
      allowed_paths: [...RC2_DELIVERY_POLICY_TRANSFORM_PATHS],
      changed_paths: Array.isArray(evidence?.changedPaths) ? [...evidence.changedPaths] : [],
    },
    patch: { digest: patch ? sha256(patch) : null, bytes: patch?.byteLength ?? 0 },
    output: null,
    behavior: null,
    mutation: null,
    verification: verificationArtifact(verificationStatus, receipts),
    cleanup: {
      status: cleanup.outcome,
      source_status: sourceInvariant?.outcome === 'passed'
        ? 'unchanged'
        : (sourceInvariant?.outcome === 'failed' ? 'changed' : 'unresolved'),
      receipt_digest: digestArtifact(cleanup),
    },
    rejection: { ...rejection, evidence_digest: digestArtifact(rejection) },
  };
  return makeResult({
    artifact,
    patch,
    behaviorEvidence: null,
    mutationEvidence: null,
    cleanup,
    sourceInvariant,
  });
}

/** 3 channel resolverと対応test seamをdisposable worktreeへ決定的に書く。 */
export async function applyRc2DeliveryPolicyTransform(options = {}) {
  if (!exactRecord(options, ['worktreePath'])
    || typeof options.worktreePath !== 'string'
    || options.worktreePath.length === 0) {
    throw new TypeError('applyRc2DeliveryPolicyTransform requires exact worktreePath');
  }
  const worktreePath = await realpath(options.worktreePath);
  for (const relativePath of RC2_DELIVERY_POLICY_TRANSFORM_PATHS) {
    await safeWrite(worktreePath, relativePath, Buffer.from(WRITER_FILES.get(relativePath), 'utf8'));
  }
}

/** actual preimageから隔離transform、oracle、mutation matrix、cleanupを一transactionで実行する。 */
export async function runRc2DeliveryPolicySeamTransform(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'baseRef', 'candidateSpec'])
    && !exactRecord(options, ['repoRoot', 'baseRef', 'candidateSpec', 'transform'])) {
    throw new TypeError('runRc2DeliveryPolicySeamTransform options have an invalid shape');
  }
  const {
    repoRoot,
    baseRef,
    candidateSpec,
    transform = applyRc2DeliveryPolicyTransform,
  } = options;
  if (typeof transform !== 'function') throw new TypeError('transform must be a function');

  const { candidateDigest, fixedCandidate } = assertAcceptedCandidate(candidateSpec);
  const { root, baseSha } = await resolveRepository(repoRoot, baseRef);
  const controlSnapshot = await captureSurfaceSnapshot(root);
  assertControlSnapshot(controlSnapshot);
  const oracleBytes = await readRegularFile(root, ORACLE_PATH);
  const oracleDigest = sha256(oracleBytes);
  if (oracleDigest !== fixedCandidate.fixed_oracle.source_digest) {
    throw new TypeError('fixed oracle source digest differs from the accepted candidate');
  }
  const adapterSourceDigest = sha256(await readFile(new URL(import.meta.url)));
  const preOracle = await runRc2DeliveryPolicyOracle({ repoRoot: root });
  assertOracleReceipt(preOracle, fixedCandidate);
  const beforeCount = await worktreeCount(root);

  let isolated;
  let postOracle;
  let outputSnapshot;
  let mutationEvidence;
  try {
    isolated = await runIsolatedTransform({
      repoRoot: root,
      baseRef: baseSha,
      allowedPaths: [...RC2_DELIVERY_POLICY_TRANSFORM_PATHS],
      transform: async ({ worktreePath }) => {
        await transform({ worktreePath });
        await assertCompleteTransform(worktreePath, oracleDigest);
      },
      verifyCommands: TEST_CONTRACTS.map((contract) => ({
        command: process.execPath,
        args: ['--test', '--test-reporter=dot', contract.path],
      })),
      observe: async ({ worktreePath, changedPaths }) => {
        if (!sameArray(changedPaths, RC2_DELIVERY_POLICY_TRANSFORM_PATHS)) {
          throw new TransformContractError(
            'LATTICE_RC2_INCOMPLETE_TRANSFORM',
            'accepted writer must change the exact eight allowed paths',
          );
        }
        postOracle = await runRc2DeliveryPolicyOracle({ repoRoot: worktreePath });
        assertOracleReceipt(postOracle, fixedCandidate);
        if (digestArtifact(postOracle) !== digestArtifact(preOracle)) {
          throw new TransformContractError(
            'LATTICE_RC2_ORACLE_DIVERGENCE',
            'pre and post fixed oracle receipts differ',
          );
        }
        outputSnapshot = await captureSurfaceSnapshot(worktreePath);
        assertOutputSnapshot(outputSnapshot, oracleDigest);
        mutationEvidence = await runMutationMatrix({
          worktreePath,
          outputSnapshot,
          candidateDigest,
          caseSetDigest: oracleCaseSetDigest(preOracle),
        });
        const afterMatrix = await captureSurfaceSnapshot(worktreePath);
        if (afterMatrix.digest !== outputSnapshot.digest) {
          throw new TransformContractError(
            'LATTICE_RC2_RESTORE_FAILURE',
            'mutation matrix leaked bytes into the accepted snapshot',
          );
        }
      },
    });
    const afterCount = await worktreeCount(root);
    const cleanup = makeCleanupReceipt(beforeCount, afterCount);
    if (cleanup.outcome !== 'passed') {
      throw new TransformContractError(
        'LATTICE_RC2_CLEANUP_FAILURE',
        'disposable worktree count changed after cleanup',
      );
    }
    if (!sameArray(isolated.changedPaths, RC2_DELIVERY_POLICY_TRANSFORM_PATHS)
      || !Buffer.isBuffer(isolated.patch)
      || isolated.verifications.length !== TEST_CONTRACTS.length
      || isolated.verifications.some(({ outcome }) => outcome !== 'passed')
      || isolated.sourceInvariant?.outcome !== 'passed'
      || !postOracle
      || !outputSnapshot
      || !mutationEvidence) {
      throw new TransformContractError(
        'LATTICE_RC2_INCOMPLETE_TRANSFORM',
        'isolated transaction did not produce the complete accepted evidence set',
      );
    }

    const behaviorEvidence = makeBehaviorEvidence({
      candidateDigest,
      adapterSourceDigest,
      controlSnapshot,
      outputSnapshot,
      oracleBytes,
      oracleDigest,
      preOracle,
      postOracle,
    });
    const artifact = {
      schema: 'lattice.rc2.delivery_policy_transform_artifact.v1',
      status: 'accepted',
      candidate: {
        candidate_id: fixedCandidate.candidate_id,
        digest: candidateDigest,
      },
      source: {
        base_sha: baseSha,
        adapter: { path: ADAPTER_PATH, digest: adapterSourceDigest },
        control_snapshot_digest: controlSnapshot.digest,
        fixed_oracle: { path: ORACLE_PATH, source_digest: oracleDigest },
      },
      scope: {
        allowed_paths: [...RC2_DELIVERY_POLICY_TRANSFORM_PATHS],
        changed_paths: [...isolated.changedPaths],
      },
      patch: { digest: sha256(isolated.patch), bytes: isolated.patch.byteLength },
      output: {
        snapshot_digest: outputSnapshot.digest,
        files: structuredClone(outputSnapshot.files),
      },
      behavior: {
        evidence_digest: behaviorEvidence.evidence_digest,
        pre_oracle_digest: digestArtifact(preOracle),
        post_oracle_digest: digestArtifact(postOracle),
        case_set_digest: behaviorEvidence.case_set_digest,
        equivalent: true,
      },
      mutation: {
        evidence_digest: mutationEvidence.evidence_digest,
        matrix_digest: mutationEvidence.matrix_digest,
        row_count: mutationEvidence.rows.length,
        cell_count: mutationEvidence.rows.reduce((sum, row) => sum + row.cells.length, 0),
      },
      verification: verificationArtifact('passed', isolated.verifications),
      cleanup: {
        status: 'passed',
        source_status: 'unchanged',
        receipt_digest: digestArtifact(cleanup),
      },
      rejection: null,
    };
    return makeResult({
      artifact,
      patch: isolated.patch,
      behaviorEvidence,
      mutationEvidence,
      cleanup,
      sourceInvariant: isolated.sourceInvariant,
    });
  } catch (error) {
    const afterCount = await worktreeCount(root);
    const evidence = transformEvidence(error) ?? isolated;
    if (!evidence || typeof evidence.baseSha !== 'string') throw error;
    return rejectedResult({
      error,
      evidence,
      candidate: fixedCandidate,
      candidateDigest,
      baseSha,
      adapterSourceDigest,
      controlSnapshot,
      oracleDigest,
      beforeCount,
      afterCount,
    });
  }
}
