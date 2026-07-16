import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test, { after } from 'node:test';

import { canonicalizeArtifact } from '../src/artifact-contracts.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CAMPAIGN_MODULE = '../src/rc2-campaign.mjs';
const ARTIFACT_MODULE = '../src/rc2-artifact-set.mjs';

let temporaryRoot;
let fixturePromise;
let artifactFixturePromise;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(canonicalizeArtifact(value), 'utf8');
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (code === 0 && signal === null) resolve(result);
      else reject(Object.assign(
        new Error(`${command} failed (${signal ?? code}): ${result.stderr.toString('utf8').trim()}`),
        result,
      ));
    });
  });
}

async function loadFixture() {
  if (!fixturePromise) {
    fixturePromise = (async () => {
      const campaign = await import(CAMPAIGN_MODULE);
      const artifactSet = await import(ARTIFACT_MODULE);
      temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc2-campaign-test-'));
      const repoRoot = path.join(temporaryRoot, 'repo');
      await run('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, repoRoot]);
      const result = await campaign.runRc2Campaign({ repoRoot, baseRef: 'HEAD' });
      const statusBeforeWrite = (await run(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=all'],
        { cwd: repoRoot },
      )).stdout.toString('utf8');
      return { campaign, artifactSet, repoRoot, result, statusBeforeWrite };
    })();
  }
  return fixturePromise;
}

async function loadArtifactFixture() {
  if (!artifactFixturePromise) {
    artifactFixturePromise = (async () => {
      const fixture = await loadFixture();
      const manifest = await fixture.campaign.writeRc2CampaignArtifacts({
        repoRoot: fixture.repoRoot,
        result: fixture.result,
      });
      const artifactRoot = path.join(
        fixture.repoRoot,
        'research/campaigns/rc2/artifacts/v1',
      );
      const payloads = await Promise.all(
        fixture.artifactSet.RC2_ARTIFACT_PATHS.map(async (relativePath) => ({
          path: relativePath,
          bytes: await readFile(path.join(artifactRoot, relativePath)),
        })),
      );
      return { ...fixture, artifactRoot, manifest, payloads };
    })();
  }
  return artifactFixturePromise;
}

function copyArtifactSet({ manifest, payloads }) {
  return {
    manifest: structuredClone(manifest),
    payloads: payloads.map(({ path: relativePath, bytes }) => ({
      path: relativePath,
      bytes: Buffer.from(bytes),
    })),
  };
}

function replacePayload(set, relativePath, bytes) {
  const payload = set.payloads.find(({ path: candidate }) => candidate === relativePath);
  assert.ok(payload, `missing payload ${relativePath}`);
  payload.bytes = Buffer.from(bytes);
  const entry = set.manifest.files.find(({ path: candidate }) => candidate === relativePath);
  assert.ok(entry, `missing manifest entry ${relativePath}`);
  entry.bytes = payload.bytes.byteLength;
  entry.sha256 = sha256(payload.bytes);
}

function mutateJson(set, relativePath, mutate) {
  const payload = set.payloads.find(({ path: candidate }) => candidate === relativePath);
  assert.ok(payload, `missing JSON payload ${relativePath}`);
  const value = JSON.parse(payload.bytes.toString('utf8'));
  mutate(value);
  replacePayload(set, relativePath, jsonBytes(value));
}

function conflictPairs(graph) {
  return new Set(graph.conflicts.map(({ todo_ids: todoIds }) => (
    [...todoIds].sort().join('\u0000')
  ))).size;
}

function assertCompiled(record, { conflicts, pairs, waves }) {
  assert.equal(record.schema, 'lattice.rc2.compiled_condition.v1');
  assert.equal(record.outcome, 'compiled');
  assert.equal(record.bundle.graph.conflicts.length, conflicts);
  assert.equal(conflictPairs(record.bundle.graph), pairs);
  assert.equal(record.plan.minimum_feasible_waves, waves);
  assert.equal(record.verification.outcome, 'verified');
  assert.equal(record.verification.minimum_feasible_waves, waves);
}

after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('RC2 campaignとartifact setはfixture lifecycleをgeneric coreから分離したexact exportsを持つ', async () => {
  const [campaign, artifactSet] = await Promise.all([
    import(CAMPAIGN_MODULE),
    import(ARTIFACT_MODULE),
  ]);

  assert.deepEqual(Object.keys(campaign).sort(), [
    'runRc2Campaign',
    'verifyRc2CampaignArtifactsOnDisk',
    'writeRc2CampaignArtifacts',
  ]);
  assert.deepEqual(Object.keys(artifactSet).sort(), [
    'RC2_ARTIFACT_PATHS',
    'verifyRc2CampaignArtifactSet',
  ]);
  assert.equal(Object.isFrozen(artifactSet.RC2_ARTIFACT_PATHS), true);
  assert.deepEqual(
    artifactSet.RC2_ARTIFACT_PATHS,
    [...artifactSet.RC2_ARTIFACT_PATHS].sort(),
  );
  assert.equal(
    new Set(artifactSet.RC2_ARTIFACT_PATHS).size,
    artifactSet.RC2_ARTIFACT_PATHS.length,
  );
  assert.ok(artifactSet.RC2_ARTIFACT_PATHS.length >= 50);
});

test('RC2 campaignはaccepted patchだけを変数に6 fresh worktree runとfixed identityを作る', async () => {
  const { result, statusBeforeWrite } = await loadFixture();

  assert.equal(statusBeforeWrite, '');
  assert.equal(result.schema, 'lattice.rc2.campaign_result.v1');
  assert.match(result.base_sha, /^[0-9a-f]{40}$/);
  assert.equal(result.transform.accepted.status, 'accepted');
  assert.equal(result.transform.accepted.artifact.status, 'accepted');
  assert.ok(Buffer.isBuffer(result.transform.accepted.patch));
  assert.equal(
    sha256(result.transform.accepted.patch),
    result.transform.accepted.artifact.patch.digest,
  );

  const primary = [
    ...result.runs.primary.control,
    ...result.runs.primary.treatment,
  ];
  const transfer = [
    ...result.runs.rc1_transfer.control,
    ...result.runs.rc1_transfer.treatment,
  ];
  assert.equal(result.runs.primary.control.length, 2);
  assert.equal(result.runs.primary.treatment.length, 2);
  assert.equal(result.runs.rc1_transfer.control.length, 1);
  assert.equal(result.runs.rc1_transfer.treatment.length, 1);
  assert.equal(new Set([...primary, ...transfer]
    .map(({ isolation_instance_digest: digest }) => digest)).size, 6);
  for (const runRecord of [...primary, ...transfer]) {
    assert.match(runRecord.isolation_instance_digest, /^[0-9a-f]{64}$/);
    assert.equal(runRecord.fresh_index, true);
    assert.equal(runRecord.source_invariant.outcome, 'passed');
    assert.equal(runRecord.cleanup.outcome, 'passed');
    assert.equal(runRecord.measurement.codegraph_identity_digest,
      result.identity.codegraph_identity_digest);
    assert.equal(runRecord.measurement.base_sha, result.base_sha);
    assert.equal(runRecord.cost.index.state, 'measured');
    assert.equal(runRecord.cost.query.state, 'measured');
    assert.equal(runRecord.cost.oracle.state, 'measured');
  }
  assert.ok(result.runs.primary.control.every(({ measurement }) => (
    measurement.patch_digest === null
  )));
  assert.ok(result.runs.primary.treatment.every(({ measurement }) => (
    measurement.patch_digest === result.transform.accepted.artifact.patch.digest
  )));
  assert.equal(
    new Set(result.runs.primary.control.map(({ evidence }) => (
      evidence.portable.aggregate_digest
    ))).size,
    1,
  );
  assert.equal(
    new Set(result.runs.primary.treatment.map(({ evidence }) => (
      evidence.portable.aggregate_digest
    ))).size,
    1,
  );
  assert.notEqual(
    result.runs.primary.control[0].measurement.snapshot_digest,
    result.runs.primary.treatment[0].measurement.snapshot_digest,
  );
  assert.equal(
    result.runs.primary.treatment[0].measurement.snapshot_digest,
    result.transform.accepted.artifact.output.snapshot_digest,
  );
  assert.equal(result.identity.before_digest, result.identity.after_digest);
});

test('同じv2 coreはprimary、partial、capacity、unknown、RC1 transferを識別してnew plan全体を再compileする', async () => {
  const { result } = await loadFixture();
  const primary = result.compiled.primary;
  const transfer = result.compiled.rc1_transfer;

  assert.equal(primary.control.length, 2);
  assert.equal(primary.treatment.length, 2);
  primary.control.forEach((record) => assertCompiled(record, {
    conflicts: 12,
    pairs: 3,
    waves: 3,
  }));
  primary.treatment.forEach((record) => assertCompiled(record, {
    conflicts: 0,
    pairs: 0,
    waves: 1,
  }));
  assert.equal(new Set(primary.control.map(({ artifact_digest: digest }) => digest)).size, 1);
  assert.equal(new Set(primary.treatment.map(({ artifact_digest: digest }) => digest)).size, 1);

  assertCompiled(primary.partial_state, { conflicts: 1, pairs: 1, waves: 2 });
  assert.ok(primary.partial_state.plan.waves.some(({ todo_ids: todoIds }) => (
    todoIds.includes('push-policy') && todoIds.length === 2
  )));
  assertCompiled(primary.capacity_2, { conflicts: 0, pairs: 0, waves: 2 });
  assert.equal(primary.capacity_2.bundle.graph.capacity, 2);

  assert.equal(primary.third_only_unknown.schema, 'lattice.rc2.non_dispatchable_condition.v1');
  assert.equal(primary.third_only_unknown.outcome.outcome, 'unknown');
  assert.equal(primary.third_only_unknown.outcome.code, 'BOUNDARY_UNKNOWN');
  assert.equal(primary.third_only_unknown.verification.outcome, 'unknown');
  assert.equal(Object.hasOwn(primary.third_only_unknown, 'plan'), false);
  assert.equal(Object.hasOwn(primary.third_only_unknown, 'verdict'), false);

  assertCompiled(transfer.control.normal, { conflicts: 3, pairs: 1, waves: 2 });
  assertCompiled(transfer.treatment.normal, { conflicts: 0, pairs: 0, waves: 1 });
  assertCompiled(transfer.control.negative, { conflicts: 4, pairs: 1, waves: 2 });
  assertCompiled(transfer.treatment.negative, { conflicts: 1, pairs: 1, waves: 2 });

  assert.equal(result.new_plan_version.schema, 'lattice.rc2.plan_version.v1');
  assert.equal(result.new_plan_version.version, 'rc2-delivery-policy-v2');
  assert.equal(result.new_plan_version.plan.minimum_feasible_waves, 1);
  assert.deepEqual(
    [...result.new_plan_version.affected_todos].sort(),
    ['email-policy', 'push-policy', 'sms-policy'],
  );
  assert.equal(result.plan_diff.schema, 'lattice.rc2.plan_diff.v1');
  assert.equal(result.plan_diff.old_plan.version, 'rc2-delivery-policy-v1');
  assert.equal(result.plan_diff.new_plan.version, 'rc2-delivery-policy-v2');
  assert.deepEqual(
    result.plan_diff.invalidated_contexts.map(({ kind }) => kind),
    ['old_plan', 'agent_context', 'partial_patch', 'interface_assumption', 'boundary_evidence'],
  );
  assert.ok(result.plan_diff.causal_predecessors.some(({ kind }) => (
    kind === 'accepted_transform'
  )));
  assert.ok(result.plan_diff.causal_predecessors.some(({ kind }) => (
    kind === 'rc1_v6_phase_archive'
  )));
  assert.equal(result.hypothesis_evaluation.supported, true);
  assert.deepEqual(result.hypothesis_evaluation.failed_conditions, []);
});

test('RC2 artifact writerはatomic immutableでdisk-only verifierが意味論的corruptionを拒否する', async () => {
  const fixture = await loadArtifactFixture();
  const pure = fixture.artifactSet.verifyRc2CampaignArtifactSet({
    manifest: fixture.manifest,
    payloads: fixture.payloads,
  });
  assert.equal(pure.schema, 'lattice.rc2.artifact_set_verification.v1');
  assert.equal(pure.valid, true);
  assert.deepEqual(pure.failed_conditions, []);
  assert.ok(pure.checks.length >= 10);

  const disk = await fixture.campaign.verifyRc2CampaignArtifactsOnDisk({
    repoRoot: fixture.repoRoot,
  });
  assert.equal(disk.valid, true);
  await assert.rejects(
    () => fixture.campaign.writeRc2CampaignArtifacts({
      repoRoot: fixture.repoRoot,
      result: fixture.result,
    }),
    /already exists|immutable|上書き/i,
  );

  const patchCorruption = copyArtifactSet(fixture);
  const patchPayload = patchCorruption.payloads.find(({ path: relativePath }) => (
    relativePath === 'transform/seam.patch'
  ));
  const changedPatch = Buffer.from(patchPayload.bytes);
  changedPatch[0] ^= 1;
  replacePayload(patchCorruption, 'transform/seam.patch', changedPatch);
  const patchVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(patchCorruption);
  assert.equal(patchVerification.valid, false);
  assert.ok(patchVerification.failed_conditions.includes('transform_binding'));

  const planCorruption = copyArtifactSet(fixture);
  mutateJson(planCorruption, 'new-plan-version.json', (value) => {
    value.version = 'rc2-corrupt-plan';
  });
  const planVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(planCorruption);
  assert.equal(planVerification.valid, false);
  assert.ok(planVerification.failed_conditions.includes('version_barrier'));

  const predecessorCorruption = copyArtifactSet(fixture);
  const predecessorPath = 'predecessors/rc1-v6-plan.md';
  const predecessor = predecessorCorruption.payloads.find(({ path: relativePath }) => (
    relativePath === predecessorPath
  ));
  replacePayload(
    predecessorCorruption,
    predecessorPath,
    Buffer.concat([predecessor.bytes, Buffer.from('\ncorrupt', 'utf8')]),
  );
  const predecessorVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(
    predecessorCorruption,
  );
  assert.equal(predecessorVerification.valid, false);
  assert.ok(predecessorVerification.failed_conditions.includes('predecessor_binding'));

  const costCorruption = copyArtifactSet(fixture);
  mutateJson(costCorruption, 'cost.json', (value) => {
    value.aggregate.elapsed_ms += 1;
  });
  const costVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(costCorruption);
  assert.equal(costVerification.valid, false);
  assert.ok(costVerification.failed_conditions.includes('cost_arithmetic'));

  const diskPatchPath = path.join(fixture.artifactRoot, 'transform/seam.patch');
  const originalPatch = await readFile(diskPatchPath);
  const diskCorruption = Buffer.from(originalPatch);
  diskCorruption[diskCorruption.length - 1] ^= 1;
  await writeFile(diskPatchPath, diskCorruption);
  const rejectedDisk = await fixture.campaign.verifyRc2CampaignArtifactsOnDisk({
    repoRoot: fixture.repoRoot,
  });
  assert.equal(rejectedDisk.valid, false);
  await writeFile(diskPatchPath, originalPatch);
});

test('typed rejected transformとthird-only unknownはaccepted outputまたはplanを発行しない', async () => {
  const { result } = await loadFixture();
  const { incomplete, scope } = result.transform.rejected;

  for (const [rejected, kind] of [
    [incomplete, 'incomplete_transform'],
    [scope, 'scope_violation'],
  ]) {
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.artifact.status, 'rejected');
    assert.equal(rejected.artifact.rejection.kind, kind);
    assert.equal(rejected.artifact.output, null);
    assert.equal(Object.hasOwn(rejected, 'plan'), false);
    assert.equal(Object.hasOwn(rejected, 'new_plan_version'), false);
  }

  const unknown = result.compiled.primary.third_only_unknown;
  assert.equal(unknown.outcome.outcome, 'unknown');
  assert.equal(Object.hasOwn(unknown, 'plan'), false);
  assert.equal(Object.hasOwn(unknown, 'new_plan_version'), false);
  assert.ok(result.new_plan_version.causal_predecessors.every(({ kind }) => (
    kind !== 'rejected_transform' && kind !== 'unknown_condition'
  )));
});
