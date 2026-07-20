import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
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

const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const ORACLE_PATH = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';
const REJECTED_PLAN = 'docs/archive/2026-07-16-plan-lattice-research-campaign-1-v5-phase-rejected.md';
const PHASE_DECISION = 'docs/adr/0028-rc1-v5-phase-gate-rejection.md';
const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v6';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

async function copyRepoFile(repoRoot, relativePath) {
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(new URL(`../${relativePath}`, import.meta.url)));
}

async function fixedInputs() {
  const [planInput, candidateSpec, normalManualEvidence, negativeManualEvidence, querySet, oracle] =
    await Promise.all([
      readJson('research/campaigns/rc1/inputs/plan-input.json'),
      readJson('research/campaigns/rc1/inputs/candidate-spec-v2.json'),
      readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
      readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
      readJson('research/campaigns/rc1/inputs/query-set-v2.json'),
      readJson(ORACLE_PATH),
    ]);
  return {
    planInput,
    candidateSpec,
    normalManualEvidence,
    negativeManualEvidence,
    querySet,
    oracle,
  };
}

async function makeFixtureRepo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v6-campaign-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, FIXTURE),
    copyRepoFile(repoRoot, SHARED_TEST),
    copyRepoFile(repoRoot, ORACLE_PATH),
    copyRepoFile(repoRoot, REJECTED_PLAN),
    copyRepoFile(repoRoot, PHASE_DECISION),
  ]);
  await mkdir(path.join(repoRoot, '.lattice/sensor'), { recursive: true });
  await writeFile(path.join(repoRoot, '.lattice/sensor', '.gitignore'), [
    '*',
    '!.gitignore',
    '',
  ].join('\n'));
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-m', 'RC1 v6 campaign fixture基準']);
  return repoRoot;
}

function resealedArtifactSet(manifest, payloads, relativePath, mutate) {
  const nextManifest = structuredClone(manifest);
  const nextPayloads = payloads.map(({ path: payloadPath, bytes }) => {
    if (payloadPath !== relativePath) return { path: payloadPath, bytes: Buffer.from(bytes) };
    const value = JSON.parse(bytes.toString('utf8'));
    mutate(value);
    const nextBytes = jsonBytes(value);
    const entry = nextManifest.files.find(({ path: manifestPath }) => manifestPath === payloadPath);
    entry.bytes = nextBytes.byteLength;
    entry.sha256 = sha256(nextBytes);
    return { path: payloadPath, bytes: nextBytes };
  });
  return { manifest: nextManifest, payloads: nextPayloads };
}

function resealedBinaryArtifactSet(manifest, payloads, relativePath) {
  const nextManifest = structuredClone(manifest);
  const nextPayloads = payloads.map(({ path: payloadPath, bytes }) => {
    if (payloadPath !== relativePath) return { path: payloadPath, bytes: Buffer.from(bytes) };
    const nextBytes = Buffer.from(bytes);
    assert.ok(nextBytes.byteLength > 0);
    nextBytes[0] ^= 0xff;
    const entry = nextManifest.files.find(({ path: manifestPath }) => manifestPath === payloadPath);
    entry.sha256 = sha256(nextBytes);
    return { path: payloadPath, bytes: nextBytes };
  });
  return { manifest: nextManifest, payloads: nextPayloads };
}

test('v6 2+2 campaign writes a snapshot-bound causal artifact set and rejects resealed substitution', async (t) => {
  const {
    runRc1V6Campaign,
    verifyRc1V6ArtifactsOnDisk,
    writeRc1V6Artifacts,
  } = await import('../src/rc1-v6-campaign.mjs');
  const { verifyRc1V6CampaignArtifactSet } = await import('../src/rc1-v6-artifact-set.mjs');
  const repoRoot = await makeFixtureRepo(t);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const result = await runRc1V6Campaign({
    repoRoot,
    baseRef: baseSha,
    inputs: await fixedInputs(),
  });

  assert.equal(result.schema, 'lattice.rc1.corrected_campaign_result.v6');
  assert.equal(result.base_sha, baseSha);
  assert.equal(result.evidence_bundles.length, 4);
  assert.ok(result.evidence_bundles.every(({ schema }) => (
    schema === 'lattice.rc1.evidence_bundle.v2'
  )));
  assert.equal(result.condition_runs.control.length, 2);
  assert.equal(result.condition_runs.treatment.length, 2);
  assert.ok(result.condition_runs.control.every(({ patch_digest: digest }) => digest === null));
  assert.ok(result.condition_runs.treatment.every(({ patch_digest: digest }) => (
    digest === result.transform.artifact.patch.digest
  )));
  assert.equal(result.transform.behavior_evidence.pre_receipt.schema,
    'lattice.rc1.black_box_behavior_receipt.v4');
  assert.equal(result.transform.behavior_evidence.envelope.schema,
    'lattice.rc1.behavior_evidence_envelope.v2');
  assert.equal(result.plan_diff.schema, 'lattice.plan_diff.v3');
  assert.equal(result.plan_diff.causal_predecessors.length, 8);
  assert.equal(result.hypothesis_evaluation.supported, true);
  assert.deepEqual(result.hypothesis_evaluation.failed_conditions, []);
  assert.equal(result.control.normal.plan_graph.minimum_feasible_waves, 2);
  assert.equal(result.treatment.normal.plan_graph.minimum_feasible_waves, 1);
  assert.equal(result.treatment.normal.boundary_manifest.conflicts.length, 0);
  assert.equal(result.treatment.negative.plan_graph.minimum_feasible_waves, 2);
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), baseSha);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(
    git(repoRoot, ['worktree', 'list', '--porcelain'])
      .split('\n').filter((line) => line.startsWith('worktree ')).length,
    1,
  );

  const manifest = await writeRc1V6Artifacts({ repoRoot, result });
  assert.equal(manifest.schema, 'lattice.rc1.artifact_manifest.v6');
  for (const identityPath of [
    'identity/boundary-compiler.mjs',
    'identity/black-box-oracle.mjs',
    'identity/lattice-sensor-executable',
  ]) {
    assert.ok(manifest.files.some(({ path: relativePath }) => relativePath === identityPath));
  }
  assert.equal(
    manifest.files.find(({ path: relativePath }) => (
      relativePath === 'identity/lattice-sensor-executable'
    )).media_type,
    'application/javascript',
  );
  await access(path.join(repoRoot, ARTIFACT_ROOT, 'artifact-manifest.json'));
  const diskVerification = await verifyRc1V6ArtifactsOnDisk({ repoRoot });
  assert.equal(diskVerification.valid, true, JSON.stringify(diskVerification.failed_conditions));
  const payloads = await Promise.all(manifest.files.map(async ({ path: relativePath }) => ({
    path: relativePath,
    bytes: await readFile(path.join(repoRoot, ARTIFACT_ROOT, relativePath)),
  })));
  const baseline = verifyRc1V6CampaignArtifactSet({ manifest, payloads });
  assert.equal(baseline.valid, true, JSON.stringify(baseline.failed_conditions));

  const oracleSubstitution = resealedArtifactSet(
    manifest,
    payloads,
    'inputs/behavior-oracle-v2.json',
    (oracle) => {
      oracle.cases[0].expected.value = { substituted: true };
    },
  );
  assert.equal(verifyRc1V6CampaignArtifactSet(oracleSubstitution).valid, false);

  const predecessorSubstitution = resealedArtifactSet(
    manifest,
    payloads,
    'plan-diff.json',
    (planDiff) => {
      planDiff.causal_predecessors[2].digest = 'f'.repeat(64);
    },
  );
  assert.equal(verifyRc1V6CampaignArtifactSet(predecessorSubstitution).valid, false);

  const mediaTypeSubstitution = structuredClone(manifest);
  mediaTypeSubstitution.files.find(({ path: relativePath }) => (
    relativePath === 'identity/lattice-sensor-executable'
  )).media_type = 'text/markdown';
  assert.equal(verifyRc1V6CampaignArtifactSet({
    manifest: mediaTypeSubstitution,
    payloads,
  }).valid, false);

  for (const identityPath of [
    'identity/boundary-compiler.mjs',
    'identity/black-box-oracle.mjs',
    'identity/lattice-sensor-executable',
  ]) {
    assert.equal(verifyRc1V6CampaignArtifactSet(
      resealedBinaryArtifactSet(manifest, payloads, identityPath),
    ).valid, false);
  }
});
