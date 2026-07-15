import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateTransformArtifact } from '../src/artifact-contracts.mjs';
import {
  applyRc1V4Transform,
  RC1_V4_TRANSFORM_PATHS,
  runRc1V4SeamTransform,
} from '../src/rc1-v4-transform.mjs';

const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const CHANNEL = 'research/fixtures/dispatch-record/src/dispatch-channel.mjs';
const ORACLE_PATH = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function copyRepoFile(repoRoot, relativePath) {
  const content = await readFile(new URL(`../${relativePath}`, import.meta.url));
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function makeFixtureRepo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v4-transform-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, FIXTURE),
    copyRepoFile(repoRoot, SHARED_TEST),
    copyRepoFile(repoRoot, ORACLE_PATH),
  ]);
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-m', 'RC1 v4 fixture baseline']);
  return repoRoot;
}

async function oracleInput() {
  return JSON.parse(await readFile(new URL(`../${ORACLE_PATH}`, import.meta.url), 'utf8'));
}

function sourceBindings() {
  return {
    boundary_manifest_digest: 'a'.repeat(64),
    boundary_verdict_digest: 'b'.repeat(64),
    control_plan_digest: 'c'.repeat(64),
    query_set_digest: 'd'.repeat(64),
    code_snapshot_digest: 'e'.repeat(64),
  };
}

function worktreeCount(repoRoot) {
  return git(repoRoot, ['worktree', 'list', '--porcelain'])
    .split('\n').filter((line) => line.startsWith('worktree ')).length;
}

test('writer creates production and TODO-owned test seams while shared test stays compositional', async (t) => {
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v4-writer-'));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(worktreePath, 'research/fixtures/dispatch-record/src'), { recursive: true }),
    mkdir(path.join(worktreePath, 'test'), { recursive: true }),
  ]);

  await applyRc1V4Transform({ worktreePath });
  const first = await Promise.all(RC1_V4_TRANSFORM_PATHS.map((relativePath) => (
    readFile(path.join(worktreePath, relativePath), 'utf8')
  )));
  await applyRc1V4Transform({ worktreePath });
  const second = await Promise.all(RC1_V4_TRANSFORM_PATHS.map((relativePath) => (
    readFile(path.join(worktreePath, relativePath), 'utf8')
  )));

  assert.deepEqual(second, first);
  const byPath = new Map(RC1_V4_TRANSFORM_PATHS.map((relativePath, index) => (
    [relativePath, first[index]]
  )));
  assert.match(byPath.get(CHANNEL), /export function selectDispatchChannel/);
  assert.match(byPath.get('research/fixtures/dispatch-record/src/dispatch-label.mjs'), /export function formatDispatchLabel/);
  assert.match(byPath.get('test/research-dispatch-channel.test.mjs'), /export function channelPolicyContract/);
  assert.match(byPath.get('test/research-dispatch-label.test.mjs'), /export function labelPolicyContract/);
  assert.doesNotMatch(byPath.get(SHARED_TEST), /pager|queue|ops:|team-a:/);
  assert.match(byPath.get(SHARED_TEST), /Object\.keys\(actual\)/);
});

test('isolated v4 transform binds pre/post oracle, test seam, patch, and cleanup', async (t) => {
  const repoRoot = await makeFixtureRepo(t);
  const oracle = await oracleInput();
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const originalSource = await readFile(path.join(repoRoot, FIXTURE));
  const originalTest = await readFile(path.join(repoRoot, SHARED_TEST));

  const first = await runRc1V4SeamTransform({
    repoRoot,
    baseRef: 'HEAD',
    oracle,
    sourceBindings: sourceBindings(),
  });
  const second = await runRc1V4SeamTransform({
    repoRoot,
    baseRef: head,
    oracle: structuredClone(oracle),
    sourceBindings: sourceBindings(),
  });

  assert.equal(validateTransformArtifact(first.artifact), true);
  assert.equal(first.artifact.status, 'accepted');
  assert.equal(first.artifact.source.base_sha, head);
  assert.deepEqual(first.artifact.scope.allowed_paths, RC1_V4_TRANSFORM_PATHS);
  assert.deepEqual(first.artifact.scope.changed_paths, RC1_V4_TRANSFORM_PATHS);
  assert.equal(first.artifact.patch.digest, createHash('sha256').update(first.patch).digest('hex'));
  assert.equal(first.receipt.schema, 'lattice.rc1.seam_transform_receipt.v4');
  assert.equal(first.receipt.status, 'accepted');
  assert.equal(first.receipt.behavior.pre.outcome, 'passed');
  assert.equal(first.receipt.behavior.post.outcome, 'passed');
  assert.equal(first.receipt.behavior.equivalent, true);
  assert.equal(first.receipt.source_invariant.schema, 'lattice.source_invariant_receipt.v1');
  assert.equal(first.receipt.source_invariant.outcome, 'passed');
  assert.deepEqual(second.artifact, first.artifact);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(second.patch.equals(first.patch), true);
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), head);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal((await readFile(path.join(repoRoot, FIXTURE))).equals(originalSource), true);
  assert.equal((await readFile(path.join(repoRoot, SHARED_TEST))).equals(originalTest), true);
  assert.equal(worktreeCount(repoRoot), 1);
});

test('caller-owned source bindings are snapshotted before custom transform execution', async (t) => {
  const repoRoot = await makeFixtureRepo(t);
  const bindings = sourceBindings();
  const original = structuredClone(bindings);
  const result = await runRc1V4SeamTransform({
    repoRoot,
    baseRef: 'HEAD',
    oracle: await oracleInput(),
    sourceBindings: bindings,
    transform: async (context) => {
      bindings.boundary_manifest_digest = 'f'.repeat(64);
      await applyRc1V4Transform(context);
    },
  });

  assert.equal(result.artifact.status, 'accepted');
  for (const [key, digest] of Object.entries(original)) {
    assert.equal(result.artifact.source[key], digest);
  }
});

test('scope violation, oracle divergence, and missing test seam never become accepted', async (t) => {
  const repoRoot = await makeFixtureRepo(t);
  const oracle = await oracleInput();
  const common = {
    repoRoot,
    baseRef: 'HEAD',
    oracle,
    sourceBindings: sourceBindings(),
  };

  const scopeViolation = await runRc1V4SeamTransform({
    ...common,
    transform: async (context) => {
      await applyRc1V4Transform(context);
      await writeFile(path.join(context.worktreePath, ORACLE_PATH), '{}\n');
    },
  });
  assert.equal(scopeViolation.artifact.status, 'rejected');
  assert.equal(scopeViolation.artifact.rejection.kind, 'scope_violation');

  const oracleDivergence = await runRc1V4SeamTransform({
    ...common,
    transform: async (context) => {
      await applyRc1V4Transform(context);
      await writeFile(path.join(context.worktreePath, CHANNEL), [
        'export function selectDispatchChannel() {',
        "  return 'pager';",
        '}',
        '',
      ].join('\n'));
    },
  });
  assert.equal(oracleDivergence.artifact.status, 'rejected');
  assert.equal(oracleDivergence.artifact.rejection.kind, 'behavior_verification_failed');
  assert.equal(oracleDivergence.receipt.behavior.post.outcome, 'failed');

  const missingTest = await runRc1V4SeamTransform({
    ...common,
    transform: async (context) => {
      await applyRc1V4Transform(context);
      await rm(path.join(context.worktreePath, 'test/research-dispatch-channel.test.mjs'));
    },
  });
  assert.equal(missingTest.artifact.status, 'rejected');
  assert.equal(missingTest.artifact.rejection.kind, 'behavior_verification_failed');
  assert.equal(missingTest.artifact.verification.status, 'failed');

  for (const result of [scopeViolation, oracleDivergence, missingTest]) {
    assert.equal(validateTransformArtifact(result.artifact), true);
    assert.equal(result.receipt.status, 'rejected');
    assert.equal(result.artifact.cleanup.status, 'passed');
    assert.equal(result.artifact.cleanup.source_status, 'unchanged');
  }
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(worktreeCount(repoRoot), 1);
});
