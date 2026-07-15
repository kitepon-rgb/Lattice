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

import { digestArtifact, validateTransformArtifact } from '../src/artifact-contracts.mjs';
import {
  validateRc1V5BehaviorReceipt,
} from '../src/rc1-v5-behavior-evidence.mjs';
import {
  applyRc1V4Transform,
  runRc1V4SeamTransform,
} from '../src/rc1-v4-transform.mjs';

const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const CHANNEL = 'research/fixtures/dispatch-record/src/dispatch-channel.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const ORACLE_PATH = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function copyRepoFile(repoRoot, relativePath) {
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(new URL(`../${relativePath}`, import.meta.url)));
}

async function makeFixtureRepo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v5-transform-'));
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
  git(repoRoot, ['commit', '-m', 'RC1 v5変換fixture基準']);
  return repoRoot;
}

async function oracleInput() {
  return JSON.parse(await readFile(new URL(`../${ORACLE_PATH}`, import.meta.url), 'utf8'));
}

function v4SourceBindings() {
  return {
    boundary_manifest_digest: 'a'.repeat(64),
    boundary_verdict_digest: 'b'.repeat(64),
    control_plan_digest: 'c'.repeat(64),
    query_set_digest: 'd'.repeat(64),
    code_snapshot_digest: 'e'.repeat(64),
  };
}

function v5SourceBindings() {
  const { code_snapshot_digest: ignored, ...bindings } = v4SourceBindings();
  return bindings;
}

function worktreeCount(repoRoot) {
  return git(repoRoot, ['worktree', 'list', '--porcelain'])
    .split('\n').filter((line) => line.startsWith('worktree ')).length;
}

async function v5Module() {
  return import('../src/rc1-v5-transform.mjs');
}

test('v4 transform receipt is a concrete non-identifiable control for v5 binding', async (t) => {
  const repoRoot = await makeFixtureRepo(t);
  const result = await runRc1V4SeamTransform({
    repoRoot,
    baseRef: 'HEAD',
    oracle: await oracleInput(),
    sourceBindings: v4SourceBindings(),
  });

  assert.equal(result.artifact.status, 'accepted');
  assert.equal(result.receipt.behavior.pre.receipt_digest, result.receipt.behavior.post.receipt_digest);
  assert.equal(validateRc1V5BehaviorReceipt(result.receipt.behavior.pre), false);
  assert.equal(validateRc1V5BehaviorReceipt(result.receipt.behavior.post), false);
  assert.equal('surface' in result.receipt.behavior.pre, false);
  assert.equal('role' in result.receipt.behavior.post, false);
});

test('v5 isolated transform binds ordered full receipts to exact source, output, and patch', async (t) => {
  const {
    RC1_V5_TRANSFORM_PATHS,
    runRc1V5SeamTransform,
  } = await v5Module();
  const repoRoot = await makeFixtureRepo(t);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const originalFixture = await readFile(path.join(repoRoot, FIXTURE));
  const result = await runRc1V5SeamTransform({
    repoRoot,
    baseRef: baseSha,
    oracle: await oracleInput(),
    sourceBindings: v5SourceBindings(),
  });

  assert.equal(result.schema, 'lattice.rc1.seam_transform_result.v5');
  assert.equal(validateTransformArtifact(result.artifact), true);
  assert.equal(result.artifact.status, 'accepted');
  assert.equal(result.artifact_digest, digestArtifact(result.artifact));
  assert.equal(result.receipt.schema, 'lattice.rc1.seam_transform_receipt.v5');
  assert.equal(result.receipt.status, 'accepted');
  assert.equal(result.receipt_digest, result.receipt.receipt_digest);
  assert.equal(result.receipt_digest, digestArtifact({
    schema: result.receipt.schema,
    status: result.receipt.status,
    transform_artifact_digest: result.receipt.transform_artifact_digest,
    behavior_envelope_digest: result.receipt.behavior_envelope_digest,
    fixed_inputs_digest: result.receipt.fixed_inputs_digest,
    source_invariant: result.receipt.source_invariant,
  }));
  assert.ok(Buffer.isBuffer(result.patch));
  assert.equal(
    createHash('sha256').update(result.patch).digest('hex'),
    result.artifact.patch.digest,
  );

  const evidence = result.behavior_evidence;
  assert.ok(evidence);
  assert.equal(validateRc1V5BehaviorReceipt(evidence.pre_receipt), true);
  assert.equal(validateRc1V5BehaviorReceipt(evidence.post_receipt), true);
  assert.equal(evidence.pre_receipt.role, 'pre');
  assert.equal(evidence.post_receipt.role, 'post');
  assert.equal(evidence.pre_receipt.base_sha, baseSha);
  assert.equal(evidence.post_receipt.base_sha, baseSha);
  assert.equal(evidence.pre_receipt.outcome, 'passed');
  assert.equal(evidence.post_receipt.outcome, 'passed');
  assert.notEqual(evidence.pre_receipt.receipt_digest, evidence.post_receipt.receipt_digest);
  assert.deepEqual(
    evidence.pre_receipt.surface.files.map(({ path: relativePath }) => relativePath),
    RC1_V5_TRANSFORM_PATHS,
  );
  assert.ok(evidence.pre_receipt.surface.files.some(({ state }) => state === 'absent'));
  assert.ok(evidence.post_receipt.surface.files.every(({ state }) => state === 'present'));

  assert.equal(
    result.artifact.source.code_snapshot_digest,
    evidence.pre_receipt.surface_digest,
  );
  assert.deepEqual(result.artifact.scope.allowed_paths, RC1_V5_TRANSFORM_PATHS);
  assert.deepEqual(result.artifact.scope.changed_paths, RC1_V5_TRANSFORM_PATHS);
  assert.deepEqual(
    result.artifact.output.files,
    evidence.post_receipt.surface.files.map(({ path: relativePath, content_digest }) => ({
      path: relativePath,
      content_digest,
    })),
  );
  assert.equal(
    result.artifact.output.snapshot_digest,
    digestArtifact({ files: result.artifact.output.files }),
  );
  assert.deepEqual(evidence.transform_artifact, result.artifact);
  assert.equal(evidence.patch_digest, result.artifact.patch.digest);
  assert.equal(evidence.envelope.pre_receipt_digest, evidence.pre_receipt.receipt_digest);
  assert.equal(evidence.envelope.post_receipt_digest, evidence.post_receipt.receipt_digest);
  assert.equal(evidence.envelope.pre_surface_digest, evidence.pre_receipt.surface_digest);
  assert.equal(evidence.envelope.post_surface_digest, evidence.post_receipt.surface_digest);
  assert.equal(evidence.envelope.transform_artifact_digest, result.artifact_digest);
  assert.equal(evidence.envelope.patch_digest, result.artifact.patch.digest);
  assert.equal(evidence.envelope.output_snapshot_digest, result.artifact.output.snapshot_digest);
  assert.equal(result.receipt.behavior_envelope_digest, evidence.envelope.envelope_digest);
  assert.equal(result.receipt.source_invariant.outcome, 'passed');

  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), baseSha);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal((await readFile(path.join(repoRoot, FIXTURE))).equals(originalFixture), true);
  assert.equal(worktreeCount(repoRoot), 1);
});

test('rejected v5 transform produces no behavior envelope or accepted downstream predecessor', async (t) => {
  const { runRc1V5SeamTransform } = await v5Module();
  const repoRoot = await makeFixtureRepo(t);
  const common = {
    repoRoot,
    baseRef: 'HEAD',
    oracle: await oracleInput(),
    sourceBindings: v5SourceBindings(),
  };

  const behaviorFailure = await runRc1V5SeamTransform({
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
  const scopeFailure = await runRc1V5SeamTransform({
    ...common,
    transform: async (context) => {
      await applyRc1V4Transform(context);
      await writeFile(path.join(context.worktreePath, ORACLE_PATH), '{}\n');
    },
  });

  assert.equal(behaviorFailure.artifact.status, 'rejected');
  assert.equal(behaviorFailure.artifact.rejection.kind, 'behavior_verification_failed');
  assert.equal(scopeFailure.artifact.status, 'rejected');
  assert.equal(scopeFailure.artifact.rejection.kind, 'scope_violation');
  for (const result of [behaviorFailure, scopeFailure]) {
    assert.equal(result.schema, 'lattice.rc1.seam_transform_result.v5');
    assert.equal(validateTransformArtifact(result.artifact), true);
    assert.equal(result.receipt.status, 'rejected');
    assert.equal(result.receipt.behavior_envelope_digest, null);
    assert.equal(result.behavior_evidence, null);
    assert.equal(result.artifact.cleanup.status, 'passed');
    assert.equal(result.artifact.cleanup.source_status, 'unchanged');
  }
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(worktreeCount(repoRoot), 1);
});
