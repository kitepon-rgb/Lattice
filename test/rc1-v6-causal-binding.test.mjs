import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { verifyRc1V5CampaignArtifactSet } from '../src/rc1-v5-artifact-set.mjs';
import { evaluateRc1V5Hypothesis } from '../src/rc1-v5-behavior-evidence.mjs';

const ARTIFACT_ROOT = new URL('../research/campaigns/rc1/artifacts/v5/', import.meta.url);
const ORACLE_URL = new URL(
  '../research/campaigns/rc1/inputs/behavior-oracle-v2.json',
  import.meta.url,
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function reseal(value, field) {
  const { [field]: ignored, ...preimage } = value;
  value[field] = digestArtifact(preimage);
}

function behaviorEvidence(json, raw) {
  return {
    pre_receipt: json.get('behavior/pre-receipt.json'),
    post_receipt: json.get('behavior/post-receipt.json'),
    envelope: json.get('behavior/evidence-envelope.json'),
    transform_artifact: json.get('transform/transform-artifact.json'),
    patch_digest: sha256(raw.get('transform/seam.patch')),
  };
}

async function canonicalV5ArtifactSet() {
  const manifest = JSON.parse(await readFile(new URL('artifact-manifest.json', ARTIFACT_ROOT)));
  const payloads = await Promise.all(manifest.files.map(async ({ path: relativePath }) => ({
    path: relativePath,
    bytes: await readFile(new URL(relativePath, ARTIFACT_ROOT)),
  })));
  return { manifest, payloads };
}

function corruptV5ReceiptsAndReseal(source, mutateReceipts) {
  const manifest = structuredClone(source.manifest);
  const raw = new Map(source.payloads.map(({ path: relativePath, bytes }) => (
    [relativePath, Buffer.from(bytes)]
  )));
  const json = new Map([...raw]
    .filter(([relativePath]) => relativePath.endsWith('.json'))
    .map(([relativePath, bytes]) => [relativePath, JSON.parse(bytes.toString('utf8'))]));

  const pre = json.get('behavior/pre-receipt.json');
  const post = json.get('behavior/post-receipt.json');
  mutateReceipts(pre, post);
  reseal(pre, 'receipt_digest');
  reseal(post, 'receipt_digest');

  const envelope = json.get('behavior/evidence-envelope.json');
  envelope.oracle_digest = pre.oracle_digest;
  envelope.pre_receipt_digest = pre.receipt_digest;
  envelope.post_receipt_digest = post.receipt_digest;
  reseal(envelope, 'envelope_digest');

  const transformReceipt = json.get('transform/transform-receipt.json');
  transformReceipt.behavior_envelope_digest = envelope.envelope_digest;
  reseal(transformReceipt, 'receipt_digest');

  const planDiff = json.get('plan-diff.json');
  planDiff.transform.receipt_digest = transformReceipt.receipt_digest;

  const comparison = json.get('comparison.json');
  comparison.independent_variable.transform_receipt_digest = transformReceipt.receipt_digest;
  comparison.behavior.evidence_envelope_digest = envelope.envelope_digest;
  comparison.version_barrier.plan_diff_digest = digestArtifact(planDiff);

  const evaluation = evaluateRc1V5Hypothesis({
    comparison,
    behaviorEvidence: behaviorEvidence(json, raw),
  });
  json.set('hypothesis-evaluation.json', evaluation);

  const execution = json.get('execution-evidence.json');
  execution.transform.receipt_digest = transformReceipt.receipt_digest;
  execution.behavior.pre_receipt_digest = pre.receipt_digest;
  execution.behavior.post_receipt_digest = post.receipt_digest;
  execution.behavior.envelope_digest = envelope.envelope_digest;
  execution.plan_diff_digest = digestArtifact(planDiff);
  execution.comparison_digest = digestArtifact(comparison);
  execution.hypothesis_evaluation_digest = digestArtifact(evaluation);
  manifest.result_digest = envelope.envelope_digest;

  const payloads = source.payloads.map(({ path: relativePath }) => {
    const bytes = relativePath.endsWith('.json')
      ? jsonBytes(json.get(relativePath))
      : Buffer.from(raw.get(relativePath));
    const entry = manifest.files.find(({ path: manifestPath }) => manifestPath === relativePath);
    entry.bytes = bytes.byteLength;
    entry.sha256 = sha256(bytes);
    return { path: relativePath, bytes };
  });
  return { manifest, payloads };
}

function expectedCaseContract(oracle) {
  return oracle.cases.map(({ id, expected }) => ({
    id,
    expected_kind: expected.kind,
    expected_digest: digestArtifact(expected),
  }));
}

function v6Receipt(v5Receipt, oracle, runtimeIdentity) {
  const receipt = structuredClone(v5Receipt);
  receipt.schema = 'lattice.rc1.black_box_behavior_receipt.v4';
  receipt.oracle_digest = digestArtifact(oracle);
  receipt.case_contract_digest = digestArtifact(expectedCaseContract(oracle));
  receipt.runtime_identity = structuredClone(runtimeIdentity);
  receipt.runtime_identity_digest = digestArtifact(runtimeIdentity);
  reseal(receipt, 'receipt_digest');
  return receipt;
}

function v6RunFixture(v5Bundle) {
  const snapshot = {
    schema: 'lattice.rc1.source_snapshot.v1',
    files: [
      {
        path: 'research/fixtures/dispatch-record/src/dispatch-record.mjs',
        state: 'file',
        content_digest: '1'.repeat(64),
      },
      {
        path: 'test/research-dispatch-record.test.mjs',
        state: 'file',
        content_digest: '2'.repeat(64),
      },
    ],
  };
  const codegraphIdentity = {
    schema: 'lattice.rc1.codegraph_identity.v1',
    version: '1.4.1',
    executable_ref: 'codegraph',
    executable_digest: '3'.repeat(64),
  };
  const bundle = structuredClone(v5Bundle);
  bundle.schema = 'lattice.rc1.evidence_bundle.v2';
  bundle.measurement = {
    schema: 'lattice.rc1.codegraph_measurement.v1',
    base_sha: '4'.repeat(40),
    patch_digest: null,
    snapshot,
    snapshot_digest: digestArtifact(snapshot),
    codegraph_identity: codegraphIdentity,
    codegraph_identity_digest: digestArtifact(codegraphIdentity),
    query_set_digest: bundle.query_set_digest,
    raw_evidence_digest: bundle.raw.payload_digest,
  };
  bundle.measurement_digest = digestArtifact(bundle.measurement);
  const run = {
    schema: 'lattice.rc1.condition_run.v2',
    condition: bundle.condition,
    run_id: bundle.run_id,
    evidence_bundle_digest: digestArtifact(bundle),
    measurement_digest: bundle.measurement_digest,
  };
  const expected = {
    base_sha: bundle.measurement.base_sha,
    patch_digest: null,
    snapshot,
    codegraph_identity: codegraphIdentity,
    query_set_digest: bundle.query_set_digest,
  };
  return { run, bundle, expected };
}

function predecessorFixture(v5PlanDiff) {
  const expectedPredecessors = [
    {
      kind: 'rejected_plan_archive',
      ref: 'docs/archive/2026-07-16-plan-lattice-research-campaign-1-v5-phase-rejected.md',
      digest: '5'.repeat(64),
    },
    {
      kind: 'phase_decision',
      ref: 'docs/adr/0028-rc1-v5-phase-gate-rejection.md',
      digest: '6'.repeat(64),
    },
    {
      kind: 'accepted_transform',
      ref: 'transform/transform-artifact.json',
      digest: '7'.repeat(64),
    },
    {
      kind: 'behavior_envelope',
      ref: 'behavior/evidence-envelope.json',
      digest: '8'.repeat(64),
    },
    ...['control-1', 'control-2', 'treatment-1', 'treatment-2'].map((runId, index) => ({
      kind: 'evidence_bundle',
      ref: `evidence/${runId}.json`,
      digest: String(index + 9).repeat(64).slice(0, 64),
    })),
  ];
  const planDiff = structuredClone(v5PlanDiff);
  planDiff.schema = 'lattice.plan_diff.v3';
  delete planDiff.causal_predecessor;
  planDiff.causal_predecessors = structuredClone(expectedPredecessors);
  return { planDiff, expectedPredecessors };
}

test('v5 full verifier accepts resealed oracle, false pass, and truncated case semantics', async () => {
  const canonical = await canonicalV5ArtifactSet();
  const oracleSubstitution = corruptV5ReceiptsAndReseal(canonical, (pre, post) => {
    pre.oracle_digest = 'a'.repeat(64);
    post.oracle_digest = 'a'.repeat(64);
  });
  const falsePassedCase = corruptV5ReceiptsAndReseal(canonical, (pre, post) => {
    pre.case_results[0].observed_digest = 'b'.repeat(64);
    post.case_results[0].observed_digest = 'b'.repeat(64);
  });
  const truncatedCases = corruptV5ReceiptsAndReseal(canonical, (pre, post) => {
    pre.case_results = pre.case_results.slice(0, 1);
    post.case_results = post.case_results.slice(0, 1);
  });

  assert.equal(verifyRc1V5CampaignArtifactSet(canonical).valid, true);
  assert.equal(verifyRc1V5CampaignArtifactSet(oracleSubstitution).valid, true);
  assert.equal(verifyRc1V5CampaignArtifactSet(falsePassedCase).valid, true);
  assert.equal(verifyRc1V5CampaignArtifactSet(truncatedCases).valid, true);
});

test('v6 causal binding rejects semantic and measurement substitutions after resealing', async () => {
  const {
    verifyRc1V6BehaviorReceipt,
    verifyRc1V6PlanPredecessors,
    verifyRc1V6RunEvidence,
  } = await import('../src/rc1-v6-causal-binding.mjs');
  const canonical = await canonicalV5ArtifactSet();
  const payload = new Map(canonical.payloads
    .filter(({ path: relativePath }) => relativePath.endsWith('.json'))
    .map(({ path: relativePath, bytes }) => (
      [relativePath, JSON.parse(bytes.toString('utf8'))]
    )));
  const oracle = JSON.parse(await readFile(ORACLE_URL, 'utf8'));
  const runtimeIdentity = {
    schema: 'lattice.rc1.oracle_runtime_identity.v1',
    node_version: 'v22.13.1',
    exec_argv: [],
    environment: { TZ: 'UTC' },
    executor_source_digest: 'c'.repeat(64),
  };
  const receipt = v6Receipt(payload.get('behavior/pre-receipt.json'), oracle, runtimeIdentity);
  const verifyReceipt = (candidate) => verifyRc1V6BehaviorReceipt({
    receipt: candidate,
    oracle,
    expectedRole: 'pre_transform',
    expectedRuntimeIdentity: runtimeIdentity,
  });

  assert.equal(verifyReceipt(receipt).valid, true);

  const wrongOracle = structuredClone(receipt);
  wrongOracle.oracle_digest = 'd'.repeat(64);
  reseal(wrongOracle, 'receipt_digest');
  assert.equal(verifyReceipt(wrongOracle).valid, false);

  const missingCase = structuredClone(receipt);
  missingCase.case_results = missingCase.case_results.slice(0, -1);
  reseal(missingCase, 'receipt_digest');
  assert.equal(verifyReceipt(missingCase).valid, false);

  const addedCase = structuredClone(receipt);
  addedCase.case_results.push({
    ...structuredClone(addedCase.case_results.at(-1)),
    id: 'injected_extra_case',
  });
  reseal(addedCase, 'receipt_digest');
  assert.equal(verifyReceipt(addedCase).valid, false);

  const reorderedCases = structuredClone(receipt);
  reorderedCases.case_results.reverse();
  reseal(reorderedCases, 'receipt_digest');
  assert.equal(verifyReceipt(reorderedCases).valid, false);

  const falsePass = structuredClone(receipt);
  falsePass.case_results[0].observed_digest = 'e'.repeat(64);
  reseal(falsePass, 'receipt_digest');
  assert.equal(verifyReceipt(falsePass).valid, false);

  const runtimeDrift = structuredClone(receipt);
  runtimeDrift.runtime_identity.node_version = 'v99.0.0';
  runtimeDrift.runtime_identity_digest = digestArtifact(runtimeDrift.runtime_identity);
  reseal(runtimeDrift, 'receipt_digest');
  assert.equal(verifyReceipt(runtimeDrift).valid, false);

  const { run, bundle, expected } = v6RunFixture(payload.get('evidence/control-1.json'));
  assert.equal(verifyRc1V6RunEvidence({ run, bundle, expected }).valid, true);

  const snapshotSubstitution = structuredClone({ run, bundle });
  snapshotSubstitution.bundle.measurement.snapshot.files[0].content_digest = 'f'.repeat(64);
  snapshotSubstitution.bundle.measurement.snapshot_digest = digestArtifact(
    snapshotSubstitution.bundle.measurement.snapshot,
  );
  snapshotSubstitution.bundle.measurement_digest = digestArtifact(
    snapshotSubstitution.bundle.measurement,
  );
  snapshotSubstitution.run.measurement_digest = snapshotSubstitution.bundle.measurement_digest;
  snapshotSubstitution.run.evidence_bundle_digest = digestArtifact(snapshotSubstitution.bundle);
  assert.equal(verifyRc1V6RunEvidence({ ...snapshotSubstitution, expected }).valid, false);

  const codegraphDrift = structuredClone({ run, bundle });
  codegraphDrift.bundle.measurement.codegraph_identity.version = '9.9.9';
  codegraphDrift.bundle.measurement.codegraph_identity_digest = digestArtifact(
    codegraphDrift.bundle.measurement.codegraph_identity,
  );
  codegraphDrift.bundle.measurement_digest = digestArtifact(codegraphDrift.bundle.measurement);
  codegraphDrift.run.measurement_digest = codegraphDrift.bundle.measurement_digest;
  codegraphDrift.run.evidence_bundle_digest = digestArtifact(codegraphDrift.bundle);
  assert.equal(verifyRc1V6RunEvidence({ ...codegraphDrift, expected }).valid, false);

  const rawSubstitution = structuredClone({ run, bundle });
  rawSubstitution.bundle.raw.payload_base64 = Buffer.from('substituted').toString('base64');
  rawSubstitution.bundle.raw.canonical_bytes = Buffer.byteLength('substituted');
  rawSubstitution.bundle.raw.payload_digest = sha256(Buffer.from('substituted'));
  rawSubstitution.bundle.measurement.raw_evidence_digest = rawSubstitution.bundle.raw.payload_digest;
  rawSubstitution.bundle.measurement_digest = digestArtifact(rawSubstitution.bundle.measurement);
  rawSubstitution.run.measurement_digest = rawSubstitution.bundle.measurement_digest;
  rawSubstitution.run.evidence_bundle_digest = digestArtifact(rawSubstitution.bundle);
  assert.equal(verifyRc1V6RunEvidence({ ...rawSubstitution, expected }).valid, false);

  const { planDiff, expectedPredecessors } = predecessorFixture(payload.get('plan-diff.json'));
  assert.equal(
    verifyRc1V6PlanPredecessors({ planDiff, expectedPredecessors }).valid,
    true,
  );
  const predecessorSubstitution = structuredClone(planDiff);
  predecessorSubstitution.causal_predecessors[2].digest = '0'.repeat(64);
  assert.equal(
    verifyRc1V6PlanPredecessors({
      planDiff: predecessorSubstitution,
      expectedPredecessors,
    }).valid,
    false,
  );
});
