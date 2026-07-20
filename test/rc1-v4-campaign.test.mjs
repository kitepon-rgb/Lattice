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
import {
  runRc1V4Campaign,
  writeRc1V4Artifacts,
} from '../src/rc1-v4-campaign.mjs';

const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const ORACLE_PATH = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';
const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v4';

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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v4-campaign-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, FIXTURE),
    copyRepoFile(repoRoot, SHARED_TEST),
    copyRepoFile(repoRoot, ORACLE_PATH),
  ]);
  await mkdir(path.join(repoRoot, '.lattice/sensor'), { recursive: true });
  await writeFile(
    path.join(repoRoot, '.lattice/sensor', '.gitignore'),
    [
      '# LatticeSensor data files — local to each machine, not for committing.',
      '# Ignore everything in .lattice/sensor/ except this file itself, so transient',
      '# files (the database, daemon.pid, sockets, logs) never show up in git.',
      '*',
      '!.gitignore',
      '',
    ].join('\n'),
  );
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-m', 'RC1 v4 campaign baseline']);
  return repoRoot;
}

test('actual 2+2 fresh indexes close the v4 compile-transform-reindex-recompile loop', async (t) => {
  const repoRoot = await makeFixtureRepo(t);
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const inputs = await fixedInputs();
  await assert.rejects(
    runRc1V4Campaign({ repoRoot, baseRef: head, inputs, condition: 'treatment' }),
    /fixed exact shape/i,
  );
  const result = await runRc1V4Campaign({
    repoRoot,
    baseRef: head,
    inputs,
  });

  assert.equal(result.schema, 'lattice.rc1.corrected_campaign_result.v4');
  assert.equal(result.base_sha, head);
  assert.equal(result.evidence_bundles.length, 4);
  assert.equal(validateRc1EvidenceCampaign(result.evidence_bundles), true);
  const [controlOne, controlTwo, treatmentOne, treatmentTwo] = result.evidence_bundles;
  assert.notEqual(controlOne.raw.payload_digest, controlTwo.raw.payload_digest);
  assert.equal(controlOne.portable.aggregate_digest, controlTwo.portable.aggregate_digest);
  assert.equal(treatmentOne.portable.aggregate_digest, treatmentTwo.portable.aggregate_digest);

  assert.equal(result.control.normal.surface_mode, 'current');
  assert.equal(result.control.normal.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
  assert.ok(result.control.normal.boundary_manifest.conflicts.some(({ resource }) => (
    resource.kind === 'path' && resource.target === SHARED_TEST
  )));
  assert.equal(result.treatment.normal.surface_mode, 'proposed');
  assert.equal(result.treatment.normal.boundary_manifest.conflicts.length, 0);
  assert.equal(result.treatment.normal.plan_graph.minimum_feasible_waves, 1);
  assert.equal(result.control.negative.plan_graph.minimum_feasible_waves, 2);
  assert.equal(result.treatment.negative.boundary_verdict.verdicts[0].verdict, 'intentional_serial');

  assert.equal(result.transform.artifact.status, 'accepted');
  assert.equal(result.transform.receipt.source_invariant.schema, 'lattice.source_invariant_receipt.v1');
  assert.equal(result.transform.receipt.source_invariant.outcome, 'passed');
  assert.ok(result.condition_runs.control.every(({ source_invariant: receipt }) => (
    receipt.outcome === 'passed'
  )));
  assert.ok(result.condition_runs.treatment.every(({ source_invariant: receipt }) => (
    receipt.outcome === 'passed'
  )));
  assert.ok(result.condition_runs.treatment.every(({ patch_digest: digest }) => (
    digest === result.transform.artifact.patch.digest
  )));

  assert.equal(result.comparison.schema, 'lattice.rc1.control_treatment_comparison.v2');
  assert.equal(result.hypothesis_evaluation.checks.length, 15);
  assert.equal(result.hypothesis_evaluation.supported, true);
  assert.deepEqual(result.hypothesis_evaluation.failed_conditions, []);
  assert.deepEqual(
    result.plan_diff.invalidated_contexts.map(({ kind }) => kind).sort(),
    ['agent_context', 'interface_assumption', 'old_plan', 'partial_patch'],
  );

  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), head);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(
    git(repoRoot, ['worktree', 'list', '--porcelain'])
      .split('\n').filter((line) => line.startsWith('worktree ')).length,
    1,
  );

  const manifest = await writeRc1V4Artifacts({ repoRoot, result });
  assert.equal(manifest.schema, 'lattice.rc1.artifact_manifest.v4');
  assert.equal(manifest.files.length, 23);
  await Promise.all(manifest.files.map(({ path: relativePath }) => (
    access(path.join(repoRoot, ARTIFACT_ROOT, relativePath))
  )));
  await assert.rejects(
    writeRc1V4Artifacts({ repoRoot, result }),
    /already exists/i,
  );
  const unsafe = {
    ...result,
    evidence_bundles: structuredClone(result.evidence_bundles),
  };
  unsafe.evidence_bundles[0].run_id = '../escape';
  await assert.rejects(
    writeRc1V4Artifacts({ repoRoot, result: unsafe }),
    /arguments are invalid/i,
  );
  assert.equal(
    JSON.stringify(result.comparison).includes(repoRoot),
    false,
  );
});
