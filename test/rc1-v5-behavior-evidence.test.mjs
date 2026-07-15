import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { evaluateRc1Hypothesis } from '../src/rc1-comparison.mjs';

const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const REQUIRED_BEHAVIOR_PATHS = Object.freeze([
  'behavior/evidence-envelope.json',
  'behavior/post-receipt.json',
  'behavior/pre-receipt.json',
  'transform/seam.patch',
  'transform/transform-artifact.json',
].sort());

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeSurface(paths, presentFiles) {
  return {
    schema: 'lattice.rc1.behavior_surface_snapshot.v1',
    files: [...paths].sort().map((surfacePath) => ({
      path: surfacePath,
      state: presentFiles.has(surfacePath) ? 'present' : 'absent',
      content_digest: presentFiles.get(surfacePath) ?? null,
    })),
  };
}

function sealReceipt(value) {
  const receipt = structuredClone(value);
  delete receipt.receipt_digest;
  return { ...receipt, receipt_digest: digestArtifact(receipt) };
}

function sealEnvelope(value) {
  const envelope = structuredClone(value);
  delete envelope.envelope_digest;
  return { ...envelope, envelope_digest: digestArtifact(envelope) };
}

function resealEvidence(value) {
  const {
    pre_receipt: preReceipt,
    post_receipt: postReceipt,
    transform_artifact: transformArtifact,
    patch_digest: patchDigest,
  } = value.behaviorEvidence;
  value.behaviorEvidence.envelope = sealEnvelope({
    schema: 'lattice.rc1.behavior_evidence_envelope.v1',
    base_sha: preReceipt.base_sha,
    oracle_digest: preReceipt.oracle_digest,
    pre_receipt_digest: preReceipt.receipt_digest,
    post_receipt_digest: postReceipt.receipt_digest,
    pre_surface_digest: preReceipt.surface_digest,
    post_surface_digest: postReceipt.surface_digest,
    transform_artifact_digest: digestArtifact(transformArtifact),
    patch_digest: patchDigest,
    output_snapshot_digest: transformArtifact.output.snapshot_digest,
  });
  value.comparison.behavior.evidence_envelope_digest =
    value.behaviorEvidence.envelope.envelope_digest;
}

function makeReceipt({ role, baseSha, oracleDigest, entrypointDigest, surface }) {
  const surfaceDigest = digestArtifact(surface);
  return sealReceipt({
    schema: 'lattice.rc1.black_box_behavior_receipt.v3',
    role,
    base_sha: baseSha,
    oracle_digest: oracleDigest,
    entrypoint: FIXTURE,
    export_name: 'buildDispatchRecord',
    entrypoint_content_digest: entrypointDigest,
    surface,
    surface_digest: surfaceDigest,
    observation: {
      before_surface_digest: surfaceDigest,
      after_surface_digest: surfaceDigest,
    },
    outcome: 'passed',
    case_results: [{
      id: 'routine-record',
      outcome: 'passed',
      observed_kind: 'return',
      expected_digest: 'a'.repeat(64),
      observed_digest: 'a'.repeat(64),
    }],
  });
}

async function validFixture() {
  const [comparison, transformArtifact, transformReceipt, patch] = await Promise.all([
    readJson('research/campaigns/rc1/artifacts/v4/comparison.json'),
    readJson('research/campaigns/rc1/artifacts/v4/transform/transform-artifact.json'),
    readJson('research/campaigns/rc1/artifacts/v4/transform/transform-receipt.json'),
    readFile(new URL(
      '../research/campaigns/rc1/artifacts/v4/transform/seam.patch',
      import.meta.url,
    )),
  ]);
  const postFiles = new Map(transformArtifact.output.files.map(({ path, content_digest: digest }) => (
    [path, digest]
  )));
  const preFiles = new Map([
    [FIXTURE, '1'.repeat(64)],
    [SHARED_TEST, '2'.repeat(64)],
  ]);
  const preSurface = makeSurface(transformArtifact.scope.allowed_paths, preFiles);
  const postSurface = makeSurface(transformArtifact.scope.allowed_paths, postFiles);
  transformArtifact.source.code_snapshot_digest = digestArtifact(preSurface);
  const base = {
    baseSha: transformArtifact.source.base_sha,
    oracleDigest: transformReceipt.behavior.oracle_digest,
  };
  const preReceipt = makeReceipt({
    role: 'pre',
    ...base,
    entrypointDigest: preFiles.get(FIXTURE),
    surface: preSurface,
  });
  const postReceipt = makeReceipt({
    role: 'post',
    ...base,
    entrypointDigest: postFiles.get(FIXTURE),
    surface: postSurface,
  });
  const v5Comparison = structuredClone(comparison);
  v5Comparison.schema = 'lattice.rc1.control_treatment_comparison.v3';
  v5Comparison.behavior = { evidence_envelope_digest: null };
  return {
    comparison: v5Comparison,
    transformArtifact,
    patch,
    patchDigest: sha256(patch),
    preReceipt,
    postReceipt,
  };
}

function payloadSet({ preReceipt, postReceipt, envelope, transformArtifact, patch }) {
  return [
    { path: 'behavior/pre-receipt.json', bytes: jsonBytes(preReceipt) },
    { path: 'behavior/post-receipt.json', bytes: jsonBytes(postReceipt) },
    { path: 'behavior/evidence-envelope.json', bytes: jsonBytes(envelope) },
    { path: 'transform/transform-artifact.json', bytes: jsonBytes(transformArtifact) },
    { path: 'transform/seam.patch', bytes: Buffer.from(patch) },
  ];
}

function artifactManifest(baseSha, envelope, payloads) {
  return {
    schema: 'lattice.rc1.artifact_manifest.v5',
    base_sha: baseSha,
    result_digest: envelope.envelope_digest,
    files: payloads.map(({ path, bytes }) => ({
      path,
      media_type: path.endsWith('.json') ? 'application/json' : 'text/x-diff',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

test('v4 machine predicate cannot distinguish a reused pre receipt from post observation', async () => {
  const [comparison, transformReceipt] = await Promise.all([
    readJson('research/campaigns/rc1/artifacts/v4/comparison.json'),
    readJson('research/campaigns/rc1/artifacts/v4/transform/transform-receipt.json'),
  ]);
  const reused = structuredClone(comparison);
  reused.behavior.treatment = {
    outcome: transformReceipt.behavior.pre.outcome,
    oracle_digest: transformReceipt.behavior.oracle_digest,
  };
  const evaluation = evaluateRc1Hypothesis(reused);

  assert.equal(
    transformReceipt.behavior.pre.receipt_digest,
    transformReceipt.behavior.post.receipt_digest,
  );
  assert.deepEqual(reused.behavior.treatment, reused.behavior.control);
  assert.equal(evaluation.supported, true);
  assert.equal(evaluation.checks.find(({ id }) => id === 'behavior')?.passed, true);
});

test('v5 evidence binds full receipts to role, snapshot, transform, patch, and manifest bytes', async () => {
  const {
    compileRc1V5BehaviorEvidence,
    evaluateRc1V5Hypothesis,
    validateRc1V5BehaviorSurface,
    verifyRc1V5BehaviorArtifactSet,
  } = await import('../src/rc1-v5-behavior-evidence.mjs');
  assert.equal(validateRc1V5BehaviorSurface({
    schema: 'lattice.rc1.behavior_surface_snapshot.v1',
    files: [null],
  }), false);
  const fixture = await validFixture();
  const envelope = compileRc1V5BehaviorEvidence({
    preReceipt: fixture.preReceipt,
    postReceipt: fixture.postReceipt,
    transformArtifact: fixture.transformArtifact,
    patchDigest: fixture.patchDigest,
  });
  const expectedEnvelopeKeys = [
    'schema',
    'base_sha',
    'oracle_digest',
    'pre_receipt_digest',
    'post_receipt_digest',
    'pre_surface_digest',
    'post_surface_digest',
    'transform_artifact_digest',
    'patch_digest',
    'output_snapshot_digest',
    'envelope_digest',
  ].sort();
  assert.deepEqual(Object.keys(envelope).sort(), expectedEnvelopeKeys);
  assert.equal(envelope.schema, 'lattice.rc1.behavior_evidence_envelope.v1');
  assert.notEqual(envelope.pre_receipt_digest, envelope.post_receipt_digest);
  fixture.comparison.behavior.evidence_envelope_digest = envelope.envelope_digest;

  const behaviorEvidence = {
    pre_receipt: fixture.preReceipt,
    post_receipt: fixture.postReceipt,
    envelope,
    transform_artifact: fixture.transformArtifact,
    patch_digest: fixture.patchDigest,
  };
  const evaluation = evaluateRc1V5Hypothesis({
    comparison: fixture.comparison,
    behaviorEvidence,
  });
  assert.equal(evaluation.schema, 'lattice.rc1.hypothesis_evaluation.v3');
  assert.equal(evaluation.supported, true);
  assert.deepEqual(evaluation.failed_conditions, []);
  assert.equal(evaluation.checks.find(({ id }) => id === 'behavior_binding')?.passed, true);

  const corruptions = [
    ['post_receipt_reuse', (value) => {
      value.behaviorEvidence.post_receipt = structuredClone(value.behaviorEvidence.pre_receipt);
    }],
    ['role', (value) => {
      value.behaviorEvidence.post_receipt.role = 'pre';
      value.behaviorEvidence.post_receipt = sealReceipt(value.behaviorEvidence.post_receipt);
    }],
    ['base_sha', (value) => {
      value.behaviorEvidence.post_receipt.base_sha = 'f'.repeat(40);
      value.behaviorEvidence.post_receipt = sealReceipt(value.behaviorEvidence.post_receipt);
    }],
    ['oracle_digest', (value) => {
      value.behaviorEvidence.post_receipt.oracle_digest = 'e'.repeat(64);
      value.behaviorEvidence.post_receipt = sealReceipt(value.behaviorEvidence.post_receipt);
    }],
    ['entrypoint_content', (value) => {
      value.behaviorEvidence.post_receipt.entrypoint_content_digest = 'd'.repeat(64);
      value.behaviorEvidence.post_receipt = sealReceipt(value.behaviorEvidence.post_receipt);
    }],
    ['surface_snapshot', (value) => {
      value.behaviorEvidence.post_receipt.surface.files
        .find(({ path }) => path === SHARED_TEST).content_digest = 'c'.repeat(64);
      value.behaviorEvidence.post_receipt.surface_digest = digestArtifact(
        value.behaviorEvidence.post_receipt.surface,
      );
      value.behaviorEvidence.post_receipt.observation.before_surface_digest =
        value.behaviorEvidence.post_receipt.surface_digest;
      value.behaviorEvidence.post_receipt.observation.after_surface_digest =
        value.behaviorEvidence.post_receipt.surface_digest;
      value.behaviorEvidence.post_receipt = sealReceipt(value.behaviorEvidence.post_receipt);
    }],
    ['pre_source_snapshot', (value) => {
      value.behaviorEvidence.pre_receipt.surface.files
        .find(({ path }) => path === SHARED_TEST).content_digest = '7'.repeat(64);
      value.behaviorEvidence.pre_receipt.surface_digest = digestArtifact(
        value.behaviorEvidence.pre_receipt.surface,
      );
      value.behaviorEvidence.pre_receipt.observation.before_surface_digest =
        value.behaviorEvidence.pre_receipt.surface_digest;
      value.behaviorEvidence.pre_receipt.observation.after_surface_digest =
        value.behaviorEvidence.pre_receipt.surface_digest;
      value.behaviorEvidence.pre_receipt = sealReceipt(value.behaviorEvidence.pre_receipt);
    }],
    ['observation_drift', (value) => {
      value.behaviorEvidence.post_receipt.observation.after_surface_digest = 'b'.repeat(64);
      value.behaviorEvidence.post_receipt = sealReceipt(value.behaviorEvidence.post_receipt);
    }],
    ['patch_digest', (value) => {
      value.behaviorEvidence.patch_digest = '9'.repeat(64);
    }],
    ['transform_artifact', (value) => {
      value.behaviorEvidence.transform_artifact.output.files[0].content_digest = '8'.repeat(64);
      value.behaviorEvidence.transform_artifact.output.snapshot_digest = digestArtifact({
        files: value.behaviorEvidence.transform_artifact.output.files,
      });
    }],
  ];
  for (const [id, corrupt] of corruptions) {
    const value = structuredClone({ comparison: fixture.comparison, behaviorEvidence });
    corrupt(value);
    resealEvidence(value);
    const corrupted = evaluateRc1V5Hypothesis(value);
    assert.equal(corrupted.supported, false, id);
    assert.ok(corrupted.failed_conditions.includes('behavior_binding'), id);
  }

  const payloads = payloadSet({
    preReceipt: fixture.preReceipt,
    postReceipt: fixture.postReceipt,
    envelope,
    transformArtifact: fixture.transformArtifact,
    patch: fixture.patch,
  });
  const manifest = artifactManifest(fixture.transformArtifact.source.base_sha, envelope, payloads);
  const validSet = verifyRc1V5BehaviorArtifactSet({ manifest, payloads });
  assert.equal(validSet.valid, true);
  assert.deepEqual(validSet.failed_conditions, []);
  assert.deepEqual(
    manifest.files.map(({ path }) => path).sort(),
    REQUIRED_BEHAVIOR_PATHS,
  );

  const missingManifest = structuredClone(manifest);
  missingManifest.files = missingManifest.files.filter(({ path }) => (
    path !== 'behavior/post-receipt.json'
  ));
  assert.equal(verifyRc1V5BehaviorArtifactSet({
    manifest: missingManifest,
    payloads,
  }).valid, false);

  const tamperedPayloads = payloads.map((payload) => ({ ...payload, bytes: Buffer.from(payload.bytes) }));
  tamperedPayloads.find(({ path }) => path === 'behavior/post-receipt.json').bytes[0] ^= 1;
  assert.equal(verifyRc1V5BehaviorArtifactSet({
    manifest,
    payloads: tamperedPayloads,
  }).valid, false);
});
