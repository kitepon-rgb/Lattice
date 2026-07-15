import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  runRc1V4Campaign,
  writeRc1V4Artifacts,
} from '../../src/rc1-v4-campaign.mjs';

const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v4';

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(process.cwd(), relativePath), 'utf8'));
}

const [planInput, candidateSpec, normalManualEvidence, negativeManualEvidence, querySet, oracle] =
  await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/candidate-spec-v2.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson('research/campaigns/rc1/inputs/query-set-v2.json'),
    readJson('research/campaigns/rc1/inputs/behavior-oracle-v2.json'),
  ]);

const result = await runRc1V4Campaign({
  repoRoot: process.cwd(),
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
const manifest = await writeRc1V4Artifacts({ repoRoot: process.cwd(), result });
for (const file of manifest.files) {
  const bytes = await readFile(path.join(process.cwd(), ARTIFACT_ROOT, file.path));
  if (bytes.byteLength !== file.bytes
    || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`written RC1 v4 artifact failed byte verification: ${file.path}`);
  }
}

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
