import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { sourceSnapshotFromRc1BehaviorSurface } from '../src/rc1-v6-measurement.mjs';

const ARTIFACT_ROOT = new URL('../research/campaigns/rc1/artifacts/v5/', import.meta.url);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readArtifact(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, ARTIFACT_ROOT), 'utf8'));
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

function v6Receipt(v5Receipt, oracle, runtimeIdentity) {
  const receipt = structuredClone(v5Receipt);
  receipt.schema = 'lattice.rc1.black_box_behavior_receipt.v4';
  receipt.role = receipt.role === 'pre' ? 'pre_transform' : 'post_transform';
  receipt.oracle_digest = digestArtifact(oracle);
  receipt.case_contract_digest = digestArtifact(oracle.cases.map(({ id, expected }) => ({
    id,
    expected_kind: expected.kind,
    expected_digest: digestArtifact(expected),
  })));
  receipt.runtime_identity = structuredClone(runtimeIdentity);
  receipt.runtime_identity_digest = digestArtifact(runtimeIdentity);
  return sealReceipt(receipt);
}

async function validFixture() {
  const [
    oracle,
    preV5,
    postV5,
    transformArtifact,
    patch,
  ] = await Promise.all([
    readArtifact('inputs/behavior-oracle-v2.json'),
    readArtifact('behavior/pre-receipt.json'),
    readArtifact('behavior/post-receipt.json'),
    readArtifact('transform/transform-artifact.json'),
    readFile(new URL('transform/seam.patch', ARTIFACT_ROOT)),
  ]);
  const runtimeIdentity = {
    schema: 'lattice.rc1.oracle_runtime_identity.v1',
    node_version: 'v22.13.1',
    exec_argv: [],
    environment: {},
    executor_source_digest: 'a'.repeat(64),
  };
  const preReceipt = v6Receipt(preV5, oracle, runtimeIdentity);
  const postReceipt = v6Receipt(postV5, oracle, runtimeIdentity);
  transformArtifact.source.code_snapshot_digest = digestArtifact(
    sourceSnapshotFromRc1BehaviorSurface(preReceipt.surface),
  );
  return {
    oracle,
    runtimeIdentity,
    preReceipt,
    postReceipt,
    transformArtifact,
    patchDigest: sha256(patch),
  };
}

test('v6 behavior envelope cross-binds saved oracle, runtime, receipts, and transform', async () => {
  const {
    compileRc1V6BehaviorEvidence,
    verifyRc1V6BehaviorEvidence,
  } = await import('../src/rc1-v6-behavior-evidence.mjs');
  const fixture = await validFixture();
  const envelope = compileRc1V6BehaviorEvidence(fixture);
  const verification = verifyRc1V6BehaviorEvidence({ ...fixture, envelope });

  assert.equal(envelope.schema, 'lattice.rc1.behavior_evidence_envelope.v2');
  assert.equal(envelope.oracle_digest, digestArtifact(fixture.oracle));
  assert.equal(envelope.runtime_identity_digest, digestArtifact(fixture.runtimeIdentity));
  assert.equal(envelope.case_contract_digest, fixture.preReceipt.case_contract_digest);
  assert.equal(envelope.pre_receipt_digest, fixture.preReceipt.receipt_digest);
  assert.equal(envelope.post_receipt_digest, fixture.postReceipt.receipt_digest);
  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));

  const runtimeDrift = structuredClone(fixture);
  runtimeDrift.postReceipt.runtime_identity.node_version = 'v99.0.0';
  runtimeDrift.postReceipt.runtime_identity_digest = digestArtifact(
    runtimeDrift.postReceipt.runtime_identity,
  );
  runtimeDrift.postReceipt = sealReceipt(runtimeDrift.postReceipt);
  assert.throws(
    () => compileRc1V6BehaviorEvidence(runtimeDrift),
    /runtime|receipt|cross-binding/i,
  );

  const substitutedOracle = structuredClone(fixture.oracle);
  substitutedOracle.cases[0].expected.value = { substituted: true };
  assert.equal(verifyRc1V6BehaviorEvidence({
    ...fixture,
    oracle: substitutedOracle,
    envelope,
  }).valid, false);

  const substitutedEnvelope = sealEnvelope({
    ...envelope,
    runtime_identity_digest: 'b'.repeat(64),
  });
  assert.equal(verifyRc1V6BehaviorEvidence({
    ...fixture,
    envelope: substitutedEnvelope,
  }).valid, false);
});
