import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  canonicalizeArtifact,
  digestArtifact,
} from '../src/artifact-contracts.mjs';
import { verifyRc2CampaignArtifactSet } from '../src/rc2-artifact-set.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_ROOT = path.join(REPO_ROOT, 'research/campaigns/rc2/artifacts');
const V3_ONLY_PATHS = new Set([
  'predecessors/adr-0041.md',
  'predecessors/rc2-semantic-reseal-characterization.md',
  'predecessors/rc2-v2-artifact-manifest.json',
  'predecessors/rc2-v2-new-plan-version.json',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(canonicalizeArtifact(value), 'utf8');
}

function parseJson(bytes) {
  return JSON.parse(bytes.toString('utf8'));
}

async function loadArtifactSet(version) {
  const root = path.join(ARTIFACT_ROOT, version);
  const manifest = parseJson(await readFile(path.join(root, 'artifact-manifest.json')));
  const payloads = await Promise.all(manifest.files.map(async ({ path: relativePath }) => ({
    path: relativePath,
    bytes: await readFile(path.join(root, relativePath)),
  })));
  return { manifest, payloads };
}

function payloadMap(set) {
  return new Map(set.payloads.map(({ path: relativePath, bytes }) => (
    [relativePath, Buffer.from(bytes)]
  )));
}

function setJson(payloads, relativePath, value) {
  payloads.set(relativePath, jsonBytes(value));
}

function refreshCausalPredecessors(payloads, predecessors) {
  return predecessors.map(({ kind, ref }) => {
    const bytes = payloads.get(ref);
    assert.ok(Buffer.isBuffer(bytes), `missing causal predecessor ${ref}`);
    return { digest: sha256(bytes), kind, ref };
  });
}

/**
 * canonical v2の全共通payloadを、v3固有predecessorだけ加えたv3 envelopeへ再封印する。
 * 単一field corruptionではなく、plan、comparison、execution、manifestの全digestを更新する。
 */
function resealV2AsV3(v2, v3) {
  const v2Payloads = payloadMap(v2);
  const v3Payloads = payloadMap(v3);
  const payloads = new Map();
  for (const { path: relativePath } of v3.manifest.files) {
    const source = V3_ONLY_PATHS.has(relativePath) ? v3Payloads : v2Payloads;
    const bytes = source.get(relativePath);
    assert.ok(Buffer.isBuffer(bytes), `missing downgrade source ${relativePath}`);
    payloads.set(relativePath, Buffer.from(bytes));
  }

  const identity = parseJson(payloads.get('identity.json'));
  identity.schema = 'lattice.rc2.execution_identity.v3';
  setJson(payloads, 'identity.json', identity);

  const predecessorPlan = parseJson(
    payloads.get('predecessors/rc2-v2-new-plan-version.json'),
  );
  const v3PlanTemplate = parseJson(v3Payloads.get('new-plan-version.json'));
  const newPlan = parseJson(v2Payloads.get('new-plan-version.json'));
  newPlan.version = 'rc2-delivery-policy-v4';
  newPlan.predecessor_version = predecessorPlan.version;
  newPlan.causal_predecessors = refreshCausalPredecessors(
    payloads,
    v3PlanTemplate.causal_predecessors,
  );
  setJson(payloads, 'new-plan-version.json', newPlan);

  const planDiff = parseJson(v3Payloads.get('plan-diff.json'));
  planDiff.old_plan = {
    digest: digestArtifact(predecessorPlan),
    version: predecessorPlan.version,
  };
  planDiff.new_plan = {
    digest: digestArtifact(newPlan),
    version: newPlan.version,
  };
  planDiff.affected_todos = structuredClone(newPlan.affected_todos);
  planDiff.causal_predecessors = structuredClone(newPlan.causal_predecessors);
  setJson(payloads, 'plan-diff.json', planDiff);

  const comparison = parseJson(v2Payloads.get('comparison.json'));
  comparison.identity_digest = digestArtifact(identity);
  comparison.version_barrier = {
    causal_predecessors_digest: digestArtifact(planDiff.causal_predecessors),
    new_plan_version_digest: digestArtifact(newPlan),
    plan_diff_digest: digestArtifact(planDiff),
  };
  setJson(payloads, 'comparison.json', comparison);

  const execution = parseJson(v2Payloads.get('execution-evidence.json'));
  execution.identity_digest = digestArtifact(identity);
  execution.new_plan_version_digest = digestArtifact(newPlan);
  execution.plan_diff_digest = digestArtifact(planDiff);
  execution.comparison_digest = digestArtifact(comparison);
  setJson(payloads, 'execution-evidence.json', execution);

  const manifest = structuredClone(v3.manifest);
  manifest.base_sha = v2.manifest.base_sha;
  manifest.result_digest = v2.manifest.result_digest;
  manifest.files = manifest.files.map((entry) => {
    const bytes = payloads.get(entry.path);
    assert.ok(Buffer.isBuffer(bytes), `missing manifest payload ${entry.path}`);
    return {
      path: entry.path,
      media_type: entry.media_type,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
  });

  return {
    manifest,
    payloads: manifest.files.map(({ path: relativePath }) => ({
      path: relativePath,
      bytes: payloads.get(relativePath),
    })),
  };
}

test('canonical RC2 artifact v1／v2／v3のread compatibilityを維持する', async () => {
  for (const [version, checks] of [['v1', 14], ['v2', 15], ['v3', 15]]) {
    const verification = verifyRc2CampaignArtifactSet(await loadArtifactSet(version));
    assert.equal(verification.valid, true, `${version} must remain valid`);
    assert.deepEqual(verification.failed_conditions, []);
    assert.equal(verification.checks.length, checks);
  }
});

test('artifact v3はcanonical v2 witness epochの完全再封印downgradeを拒否する', async () => {
  const [v2, v3] = await Promise.all([
    loadArtifactSet('v2'),
    loadArtifactSet('v3'),
  ]);
  const downgrade = resealV2AsV3(v2, v3);
  const saved = payloadMap(downgrade);
  const candidate = parseJson(saved.get('inputs/primary/candidate-spec-v1.json'));
  const behavior = parseJson(saved.get('transform/behavior-evidence.json'));
  const newPlan = parseJson(saved.get('new-plan-version.json'));

  assert.equal(
    digestArtifact(candidate),
    '30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5',
  );
  assert.equal(
    behavior.fixed_oracle.source_digest,
    'c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe',
  );
  assert.equal(downgrade.manifest.base_sha, '888b32e68c4a960506a24724a9c0a0e47ba81471');
  assert.equal(downgrade.manifest.files.length, 75);
  assert.equal(newPlan.version, 'rc2-delivery-policy-v4');
  assert.equal(newPlan.causal_predecessors.length, 35);

  const verification = verifyRc2CampaignArtifactSet(downgrade);
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('transform_binding'));
});
