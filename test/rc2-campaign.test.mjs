import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test, { after } from 'node:test';

import {
  canonicalizeArtifact,
  digestArtifact,
} from '../src/artifact-contracts.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CAMPAIGN_MODULE = '../src/rc2-campaign.mjs';
const ARTIFACT_MODULE = '../src/rc2-artifact-set.mjs';
const ARTIFACT_VERSION = 'v4';
const PREDECESSOR_ARTIFACT_VERSIONS = Object.freeze(['v1', 'v2', 'v3']);

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
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
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
      const result = await campaign.runRc2Campaign({
        repoRoot,
        baseRef: 'HEAD',
        artifactVersion: ARTIFACT_VERSION,
      });
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
      const artifactRoot = path.join(
        fixture.repoRoot,
        `research/campaigns/rc2/artifacts/${ARTIFACT_VERSION}`,
      );
      await rm(artifactRoot, { recursive: true, force: true });
      const manifest = await fixture.campaign.writeRc2CampaignArtifacts({
        repoRoot: fixture.repoRoot,
        result: fixture.result,
      });
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

function artifactJson(set, relativePath) {
  const payload = set.payloads.find(({ path: candidate }) => candidate === relativePath);
  assert.ok(payload, `missing JSON payload ${relativePath}`);
  return JSON.parse(payload.bytes.toString('utf8'));
}

function digestWithout(value, key) {
  const preimage = structuredClone(value);
  delete preimage[key];
  return digestArtifact(preimage);
}

function refreshCausalPredecessors(set, predecessors) {
  for (const predecessor of predecessors) {
    const payload = set.payloads.find(({ path: candidate }) => candidate === predecessor.ref);
    assert.ok(payload, `missing predecessor payload ${predecessor.ref}`);
    predecessor.digest = sha256(payload.bytes);
  }
}

function resealSemanticTransformCorruption(set) {
  const behavior = artifactJson(set, 'transform/behavior-evidence.json');
  const mutation = artifactJson(set, 'transform/mutation-evidence.json');
  behavior.evidence_digest = digestWithout(behavior, 'evidence_digest');
  mutation.matrix_digest = digestArtifact({ rows: mutation.rows });
  mutation.evidence_digest = digestWithout(mutation, 'evidence_digest');
  replacePayload(set, 'transform/behavior-evidence.json', jsonBytes(behavior));
  replacePayload(set, 'transform/mutation-evidence.json', jsonBytes(mutation));

  const accepted = artifactJson(set, 'transform/accepted-artifact.json');
  accepted.behavior = {
    evidence_digest: behavior.evidence_digest,
    pre_oracle_digest: digestArtifact(behavior.pre_oracle),
    post_oracle_digest: digestArtifact(behavior.post_oracle),
    case_set_digest: behavior.case_set_digest,
    equivalent: behavior.equivalent,
  };
  accepted.mutation = {
    evidence_digest: mutation.evidence_digest,
    matrix_digest: mutation.matrix_digest,
    row_count: mutation.rows.length,
    cell_count: mutation.rows.reduce((sum, row) => sum + row.cells.length, 0),
  };
  replacePayload(set, 'transform/accepted-artifact.json', jsonBytes(accepted));

  const receipt = artifactJson(set, 'transform/accepted-receipt.json');
  receipt.transform_artifact_digest = digestArtifact(accepted);
  receipt.behavior_evidence_digest = behavior.evidence_digest;
  receipt.mutation_evidence_digest = mutation.evidence_digest;
  receipt.receipt_digest = digestWithout(receipt, 'receipt_digest');
  replacePayload(set, 'transform/accepted-receipt.json', jsonBytes(receipt));

  const newPlan = artifactJson(set, 'new-plan-version.json');
  refreshCausalPredecessors(set, newPlan.causal_predecessors);
  replacePayload(set, 'new-plan-version.json', jsonBytes(newPlan));

  const planDiff = artifactJson(set, 'plan-diff.json');
  refreshCausalPredecessors(set, planDiff.causal_predecessors);
  planDiff.new_plan.digest = digestArtifact(newPlan);
  replacePayload(set, 'plan-diff.json', jsonBytes(planDiff));

  const comparison = artifactJson(set, 'comparison.json');
  comparison.independent_variable.transform_artifact_digest = digestArtifact(accepted);
  comparison.version_barrier.new_plan_version_digest = digestArtifact(newPlan);
  comparison.version_barrier.plan_diff_digest = digestArtifact(planDiff);
  comparison.version_barrier.causal_predecessors_digest = digestArtifact(
    planDiff.causal_predecessors,
  );
  replacePayload(set, 'comparison.json', jsonBytes(comparison));

  const execution = artifactJson(set, 'execution-evidence.json');
  execution.transform_artifact_digest = digestArtifact(accepted);
  execution.new_plan_version_digest = digestArtifact(newPlan);
  execution.plan_diff_digest = digestArtifact(planDiff);
  execution.comparison_digest = digestArtifact(comparison);
  replacePayload(set, 'execution-evidence.json', jsonBytes(execution));
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
  assert.equal(result.schema, 'lattice.rc2.campaign_result.v4');
  assert.equal(result.artifact_version, ARTIFACT_VERSION);
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
    assert.equal(runRecord.measurement.sensor_identity_digest,
      result.identity.sensor_identity_digest);
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
    sha256(jsonBytes(result.runs.primary.treatment[0].measurement.snapshot)),
  );
  assert.deepEqual(
    result.runs.primary.treatment[0].measurement.snapshot.files,
    result.transform.accepted.artifact.output.files.map((file) => ({
      path: file.path,
      state: file.state === 'present' ? 'file' : 'absent',
      content_digest: file.content_digest,
    })),
  );
  assert.equal(result.identity.before_digest, result.identity.after_digest);
  assert.equal(result.identity.schema, 'lattice.rc2.execution_identity.v4');
  assert.equal(result.identity.sensor_identity.schema, 'lattice.rc2.sensor_identity.v2');
  assert.equal(
    result.identity.sensor_identity.project_config_ref,
    'identity/lattice-sensor-config.json',
  );
  const configBytes = result.identity_payloads.get('identity/lattice-sensor-config.json');
  assert.ok(Buffer.isBuffer(configBytes));
  assert.equal(
    result.identity.sensor_identity.project_config_digest,
    sha256(configBytes),
  );
  assert.deepEqual(JSON.parse(configBytes.toString('utf8')), {
    exclude: [
      'research/campaigns/**/artifacts/**/identity/',
      'research/runs/',
      '.lattice/todo/',
      '.lattice/generated/',
    ],
  });
  assert.equal(result.identity.before_digest, digestArtifact({
    sources: result.identity.sources,
    sensor_identity: result.identity.sensor_identity,
  }));
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
  assert.equal(result.new_plan_version.version, 'rc2-delivery-policy-v5');
  assert.equal(result.new_plan_version.predecessor_version, 'rc2-delivery-policy-v4');
  assert.equal(result.new_plan_version.plan.minimum_feasible_waves, 1);
  assert.deepEqual(
    [...result.new_plan_version.affected_todos].sort(),
    ['email-policy', 'push-policy', 'sms-policy'],
  );
  assert.equal(result.plan_diff.schema, 'lattice.rc2.plan_diff.v1');
  assert.equal(result.plan_diff.old_plan.version, 'rc2-delivery-policy-v4');
  assert.equal(result.plan_diff.new_plan.version, 'rc2-delivery-policy-v5');
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
  assert.equal(result.plan_diff.causal_predecessors.length, 39);
  for (const ref of [
    'identity/lattice-sensor-config.json',
    'predecessors/adr-0040.md',
    'predecessors/rc2-v1-artifact-manifest.json',
    'predecessors/rc2-v1-new-plan-version.json',
    'predecessors/adr-0041.md',
    'predecessors/rc2-semantic-reseal-characterization.md',
    'predecessors/rc2-v2-artifact-manifest.json',
    'predecessors/rc2-v2-new-plan-version.json',
    'predecessors/adr-0042.md',
    'predecessors/rc2-v3-version-downgrade-refutation.md',
    'predecessors/rc2-v3-artifact-manifest.json',
    'predecessors/rc2-v3-new-plan-version.json',
  ]) {
    assert.ok(result.plan_diff.causal_predecessors.some((entry) => entry.ref === ref));
  }
  assert.equal(
    result.plan_diff.invalidated_contexts.find(({ kind }) => kind === 'boundary_evidence').ref,
    'rc2-delivery-policy-v4-boundary-evidence',
  );
  assert.equal(result.hypothesis_evaluation.supported, true);
  assert.deepEqual(result.hypothesis_evaluation.failed_conditions, []);
});

test('RC2 artifact writerはatomic immutableでdisk-only検査が不整合集合を拒否する', async () => {
  const fixture = await loadArtifactFixture();
  const evidencePayloads = fixture.payloads.filter(({ path: relativePath }) => (
    relativePath.startsWith('evidence/')
  ));
  assert.equal(evidencePayloads.length, 6);
  let over16KiBEvidence = 0;
  for (const payload of evidencePayloads) {
    const storedRun = JSON.parse(payload.bytes.toString('utf8'));
    const storedRaw = storedRun.evidence.raw;
    assert.deepEqual(Object.keys(storedRaw).sort(), [
      'canonical_bytes',
      'media_type',
      'payload_base64_chunks',
      'payload_digest',
      'schema',
      'source_encoding',
      'source_schema',
      'storage_encoding',
    ]);
    assert.equal(storedRaw.schema, 'lattice.rc2.chunked_sensor_raw_receipt.v1');
    assert.equal(storedRaw.source_schema, 'lattice.sensor_raw_opaque_receipt.v1');
    assert.equal(storedRaw.source_encoding, 'canonical-json-base64');
    assert.equal(storedRaw.storage_encoding, 'ordered-base64-chunks');
    assert.ok(storedRaw.payload_base64_chunks.every((chunk) => (
      Buffer.byteLength(chunk, 'utf8') <= 12_000
    )));
    assert.ok(storedRaw.payload_base64_chunks.slice(0, -1).every((chunk) => (
      Buffer.byteLength(chunk, 'utf8') === 12_000
    )));
    assert.equal(Object.hasOwn(storedRaw, 'payload_base64'), false);
    const encoded = storedRaw.payload_base64_chunks.join('');
    const encodedBytes = Buffer.byteLength(encoded, 'utf8');
    assert.equal(
      storedRaw.payload_base64_chunks.length,
      Math.ceil(encodedBytes / 12_000),
    );
    if (encodedBytes > 16 * 1024) {
      over16KiBEvidence += 1;
      assert.ok(storedRaw.payload_base64_chunks.length > 1);
    }
    const decoded = Buffer.from(encoded, 'base64');
    assert.equal(decoded.toString('base64'), encoded);
    assert.equal(decoded.byteLength, storedRaw.canonical_bytes);
    assert.equal(sha256(decoded), storedRaw.payload_digest);
  }
  assert.ok(over16KiBEvidence > 0);
  const pure = fixture.artifactSet.verifyRc2CampaignArtifactSet({
    manifest: fixture.manifest,
    payloads: fixture.payloads,
  });
  assert.equal(fixture.manifest.schema, 'lattice.rc2.artifact_manifest.v4');
  assert.equal(pure.schema, 'lattice.rc2.artifact_set_verification.v1');
  assert.equal(pure.valid, true);
  assert.deepEqual(pure.failed_conditions, []);
  assert.equal(pure.checks.length, 15);

  const disk = await fixture.campaign.verifyRc2CampaignArtifactsOnDisk({
    repoRoot: fixture.repoRoot,
    artifactVersion: ARTIFACT_VERSION,
  });
  assert.equal(disk.valid, true);
  for (const artifactVersion of PREDECESSOR_ARTIFACT_VERSIONS) {
    const predecessorDisk = await fixture.campaign.verifyRc2CampaignArtifactsOnDisk({
      repoRoot: fixture.repoRoot,
      artifactVersion,
    });
    assert.equal(predecessorDisk.valid, true);
    assert.equal(predecessorDisk.checks.length, artifactVersion === 'v1' ? 14 : 15);
  }
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

  const baseMismatch = copyArtifactSet(fixture);
  mutateJson(baseMismatch, 'transform/accepted-artifact.json', (value) => {
    value.source.base_sha = '0'.repeat(40);
  });
  resealSemanticTransformCorruption(baseMismatch);
  const baseVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(baseMismatch);
  assert.equal(baseVerification.valid, false);
  assert.ok(baseVerification.failed_conditions.includes('transform_binding'));

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

  const configCorruption = copyArtifactSet(fixture);
  mutateJson(configCorruption, 'identity/lattice-sensor-config.json', (value) => {
    value.exclude = [];
  });
  const configVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(configCorruption);
  assert.equal(configVerification.valid, false);
  assert.ok(configVerification.failed_conditions.includes('sensor_config_binding'));

  for (const relativePath of [
    'predecessors/rc2-v1-artifact-manifest.json',
    'predecessors/rc2-v1-new-plan-version.json',
    'predecessors/rc2-v2-artifact-manifest.json',
    'predecessors/rc2-v2-new-plan-version.json',
    'predecessors/rc2-v3-artifact-manifest.json',
    'predecessors/rc2-v3-new-plan-version.json',
  ]) {
    const v1PredecessorCorruption = copyArtifactSet(fixture);
    mutateJson(v1PredecessorCorruption, relativePath, (value) => {
      value.schema = `${value.schema}.corrupt`;
    });
    const v1PredecessorVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(
      v1PredecessorCorruption,
    );
    assert.equal(v1PredecessorVerification.valid, false);
    assert.ok(v1PredecessorVerification.failed_conditions.includes('predecessor_binding'));
  }

  const costCorruption = copyArtifactSet(fixture);
  mutateJson(costCorruption, 'cost.json', (value) => {
    value.aggregate.elapsed_ms += 1;
  });
  const costVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(costCorruption);
  assert.equal(costVerification.valid, false);
  assert.ok(costVerification.failed_conditions.includes('cost_arithmetic'));

  const rawChunkCorruption = copyArtifactSet(fixture);
  mutateJson(rawChunkCorruption, 'evidence/primary-control-1.json', (value) => {
    const chunk = value.evidence.raw.payload_base64_chunks[0];
    value.evidence.raw.payload_base64_chunks[0] = `${chunk[0] === 'A' ? 'B' : 'A'}${chunk.slice(1)}`;
  });
  const rawChunkVerification = fixture.artifactSet.verifyRc2CampaignArtifactSet(
    rawChunkCorruption,
  );
  assert.equal(rawChunkVerification.valid, false);
  assert.ok(rawChunkVerification.failed_conditions.includes('fresh_run_binding'));

  const diskPatchPath = path.join(fixture.artifactRoot, 'transform/seam.patch');
  const originalPatch = await readFile(diskPatchPath);
  const diskCorruption = Buffer.from(originalPatch);
  diskCorruption[diskCorruption.length - 1] ^= 1;
  await writeFile(diskPatchPath, diskCorruption);
  const rejectedDisk = await fixture.campaign.verifyRc2CampaignArtifactsOnDisk({
    repoRoot: fixture.repoRoot,
    artifactVersion: ARTIFACT_VERSION,
  });
  assert.equal(rejectedDisk.valid, false);
  await writeFile(diskPatchPath, originalPatch);
});

test('artifact-only整合性検査は全digest再計算後の不一致も拒否する', async (t) => {
  const fixture = await loadArtifactFixture();
  const corruptions = [
    {
      id: 'oracle-source-substitution',
      mutate(set) {
        mutateJson(set, 'transform/behavior-evidence.json', (value) => {
          value.fixed_oracle.source_base64 = Buffer.from(
            'export const substitutedOracle = true;\n',
            'utf8',
          ).toString('base64');
        });
      },
    },
    {
      id: 'false-passed-oracle-receipt',
      mutate(set) {
        mutateJson(set, 'transform/behavior-evidence.json', (value) => {
          for (const receipt of [value.pre_oracle, value.post_oracle]) {
            receipt.case_results[0].output_digest = '0'.repeat(64);
          }
          value.case_set_digest = digestArtifact({
            case_results: value.pre_oracle.case_results.map(({ id, output_digest: outputDigest }) => ({
              id,
              output_digest: outputDigest,
            })),
          });
        });
      },
    },
    {
      id: 'owner-test-mutation-matrix-substitution',
      mutate(set) {
        mutateJson(set, 'transform/mutation-evidence.json', (value) => {
          const ownerCell = value.rows[0].cells.find(({ test_id: testId }) => (
            testId === 'emailPolicyContract'
          ));
          ownerCell.outcome = 'passed';
          ownerCell.exit_code = 0;
        });
      },
    },
  ];

  for (const corruption of corruptions) {
    await t.test(corruption.id, () => {
      const resealed = copyArtifactSet(fixture);
      corruption.mutate(resealed);
      resealSemanticTransformCorruption(resealed);
      const verification = fixture.artifactSet.verifyRc2CampaignArtifactSet(resealed);
      assert.equal(verification.valid, false);
      assert.ok(verification.failed_conditions.includes('transform_binding'));
    });
  }
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
