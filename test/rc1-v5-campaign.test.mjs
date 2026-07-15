import assert from 'node:assert/strict';
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

import { validateRc1EvidenceCampaign } from '../src/rc1-evidence-bundle.mjs';
import { verifyRc1V5BehaviorArtifactSet } from '../src/rc1-v5-behavior-evidence.mjs';

const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const ORACLE_PATH = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';
const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v5';

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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v5-campaign-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, FIXTURE),
    copyRepoFile(repoRoot, SHARED_TEST),
    copyRepoFile(repoRoot, ORACLE_PATH),
  ]);
  await mkdir(path.join(repoRoot, '.codegraph'), { recursive: true });
  await writeFile(
    path.join(repoRoot, '.codegraph', '.gitignore'),
    [
      '# CodeGraph data files — local to each machine, not for committing.',
      '# Ignore everything in .codegraph/ except this file itself.',
      '*',
      '!.gitignore',
      '',
    ].join('\n'),
  );
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-m', 'RC1 v5 campaign fixture基準']);
  return repoRoot;
}

async function v5Module() {
  return import('../src/rc1-v5-campaign.mjs');
}

test('actual 2+2 v5 campaign binds transform behavior, reindex, recompile, and immutable bytes', async (t) => {
  const {
    runRc1V5Campaign,
    writeRc1V5Artifacts,
  } = await v5Module();
  const repoRoot = await makeFixtureRepo(t);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const result = await runRc1V5Campaign({
    repoRoot,
    baseRef: baseSha,
    inputs: await fixedInputs(),
  });

  assert.equal(result.schema, 'lattice.rc1.corrected_campaign_result.v5');
  assert.equal(result.base_sha, baseSha);
  assert.equal(result.evidence_bundles.length, 4);
  assert.equal(validateRc1EvidenceCampaign(result.evidence_bundles), true);
  const [controlOne, controlTwo, treatmentOne, treatmentTwo] = result.evidence_bundles;
  assert.notEqual(controlOne.raw.payload_digest, controlTwo.raw.payload_digest);
  assert.equal(controlOne.portable.aggregate_digest, controlTwo.portable.aggregate_digest);
  assert.equal(treatmentOne.portable.aggregate_digest, treatmentTwo.portable.aggregate_digest);

  assert.equal(result.control.normal.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
  assert.ok(result.control.normal.boundary_manifest.conflicts.some(({ resource }) => (
    resource.kind === 'path' && resource.target === SHARED_TEST
  )));
  assert.equal(result.treatment.normal.boundary_verdict.verdicts[0].verdict, 'parallel_ready');
  assert.equal(result.treatment.normal.boundary_manifest.conflicts.length, 0);
  assert.equal(result.treatment.normal.plan_graph.minimum_feasible_waves, 1);
  assert.equal(result.control.negative.plan_graph.minimum_feasible_waves, 2);
  assert.equal(result.treatment.negative.boundary_verdict.verdicts[0].verdict, 'intentional_serial');

  assert.equal(result.transform.artifact.status, 'accepted');
  assert.ok(result.transform.behavior_evidence);
  assert.equal(
    result.transform.artifact.source.code_snapshot_digest,
    result.transform.behavior_evidence.pre_receipt.surface_digest,
  );
  assert.equal(
    result.transform.behavior_evidence.envelope.output_snapshot_digest,
    result.transform.artifact.output.snapshot_digest,
  );
  assert.ok(result.condition_runs.control.every(({ source_invariant: receipt }) => (
    receipt.outcome === 'passed'
  )));
  assert.ok(result.condition_runs.treatment.every(({ source_invariant: receipt }) => (
    receipt.outcome === 'passed'
  )));
  assert.ok(result.condition_runs.treatment.every(({ patch_digest: digest }) => (
    digest === result.transform.artifact.patch.digest
  )));

  assert.equal(result.comparison.schema, 'lattice.rc1.control_treatment_comparison.v3');
  assert.deepEqual(Object.keys(result.comparison.behavior), ['evidence_envelope_digest']);
  assert.equal(
    result.comparison.behavior.evidence_envelope_digest,
    result.transform.behavior_evidence.envelope.envelope_digest,
  );
  assert.equal(result.hypothesis_evaluation.schema, 'lattice.rc1.hypothesis_evaluation.v3');
  assert.equal(result.hypothesis_evaluation.checks.length, 15);
  assert.equal(result.hypothesis_evaluation.supported, true);
  assert.deepEqual(result.hypothesis_evaluation.failed_conditions, []);
  assert.equal(result.plan_diff.causal_predecessor.plan_version, 'lattice-research-campaign-1-v4');
  assert.equal(result.plan_diff.causal_predecessor.status, 'phase_rejected');
  assert.deepEqual(
    result.plan_diff.invalidated_contexts.map(({ kind }) => kind).sort(),
    ['agent_context', 'interface_assumption', 'old_plan', 'partial_patch'],
  );

  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), baseSha);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(
    git(repoRoot, ['worktree', 'list', '--porcelain'])
      .split('\n').filter((line) => line.startsWith('worktree ')).length,
    1,
  );

  const manifest = await writeRc1V5Artifacts({ repoRoot, result });
  assert.equal(manifest.schema, 'lattice.rc1.artifact_manifest.v5');
  assert.equal(
    manifest.result_digest,
    result.transform.behavior_evidence.envelope.envelope_digest,
  );
  const required = [
    'behavior/evidence-envelope.json',
    'behavior/post-receipt.json',
    'behavior/pre-receipt.json',
    'transform/seam.patch',
    'transform/transform-artifact.json',
  ];
  assert.ok(required.every((relativePath) => (
    manifest.files.some(({ path: manifestPath }) => manifestPath === relativePath)
  )));
  await Promise.all(manifest.files.map(({ path: relativePath }) => (
    access(path.join(repoRoot, ARTIFACT_ROOT, relativePath))
  )));
  const payloads = await Promise.all(manifest.files.map(async ({ path: relativePath }) => ({
    path: relativePath,
    bytes: await readFile(path.join(repoRoot, ARTIFACT_ROOT, relativePath)),
  })));
  const verification = verifyRc1V5BehaviorArtifactSet({ manifest, payloads });
  assert.equal(verification.valid, true);
  assert.deepEqual(verification.failed_conditions, []);
  await assert.rejects(
    writeRc1V5Artifacts({ repoRoot, result }),
    /already exists/i,
  );
  assert.equal(JSON.stringify(result.comparison).includes(repoRoot), false);
});
