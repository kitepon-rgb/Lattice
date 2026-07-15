import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  runRc1V4Campaign,
  writeRc1V4Artifacts,
} from '../../src/rc1-v4-campaign.mjs';

const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v4';
const sourceRoot = process.cwd();

async function readJson(repoRoot, relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const sourceHead = git(sourceRoot, ['rev-parse', 'HEAD']).trim();
const sourceStatus = git(sourceRoot, ['status', '--porcelain=v1']);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-v4-campaign-integration-'));
const repoRoot = path.join(tempRoot, 'repo');

try {
  git(tempRoot, ['clone', '--no-hardlinks', '--quiet', sourceRoot, repoRoot]);
  const [
    planInput,
    candidateSpec,
    normalManualEvidence,
    negativeManualEvidence,
    querySet,
    oracle,
  ] = await Promise.all([
    readJson(repoRoot, 'research/campaigns/rc1/inputs/plan-input.json'),
    readJson(repoRoot, 'research/campaigns/rc1/inputs/candidate-spec-v2.json'),
    readJson(repoRoot, 'research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson(repoRoot, 'research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson(repoRoot, 'research/campaigns/rc1/inputs/query-set-v2.json'),
    readJson(repoRoot, 'research/campaigns/rc1/inputs/behavior-oracle-v2.json'),
  ]);

  const result = await runRc1V4Campaign({
    repoRoot,
    baseRef: 'HEAD',
    inputs: {
      planInput,
      candidateSpec,
      normalManualEvidence,
      negativeManualEvidence,
      querySet,
      oracle,
    },
  });
  await rm(path.join(repoRoot, ARTIFACT_ROOT), { recursive: true, force: true });
  const manifest = await writeRc1V4Artifacts({ repoRoot, result });
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(repoRoot, ARTIFACT_ROOT, file.path));
    if (bytes.byteLength !== file.bytes
      || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`written RC1 v4 artifact failed byte verification: ${file.path}`);
    }
  }
  assert.equal(git(sourceRoot, ['rev-parse', 'HEAD']).trim(), sourceHead);
  assert.equal(git(sourceRoot, ['status', '--porcelain=v1']), sourceStatus);

  process.stdout.write(`${JSON.stringify({
    schema: 'lattice.rc1.integration_summary.v4',
    base_sha: result.base_sha,
    supported: result.hypothesis_evaluation.supported,
    checks: result.hypothesis_evaluation.checks.length,
    failed_conditions: result.hypothesis_evaluation.failed_conditions,
    transform_artifact_digest: result.transform.artifact_digest,
    patch_digest: result.transform.artifact.patch.digest,
    portable_digests: result.evidence_bundles.map((bundle) => ({
      run_id: bundle.run_id,
      digest: bundle.portable.aggregate_digest,
    })),
    artifact_files: manifest.files.length,
  })}\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
