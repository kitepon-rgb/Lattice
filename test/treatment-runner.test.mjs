import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runRc1TreatmentRecompile } from '../src/treatment-runner.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

async function runnerInputs() {
  const [
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    transformExecutionEvidence,
    transformPatch,
    controlCompilationEvidence,
    normalManifest,
    normalVerdict,
    normalPlan,
    negativeManifest,
    negativeVerdict,
    negativePlan,
  ] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson('research/campaigns/rc1/inputs/query-set.json'),
    readJson('research/campaigns/rc1/artifacts/treatment-v2/transform/transform-artifact.json'),
    readJson('research/campaigns/rc1/artifacts/treatment-v2/transform/execution-evidence.json'),
    readFile(new URL('../research/campaigns/rc1/artifacts/treatment-v2/transform/seam.patch', import.meta.url)),
    readJson('research/campaigns/rc1/artifacts/control-v2/compilation-evidence.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/plan-v1.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-plan-v1.json'),
  ]);
  return {
    repoRoot: '/not-used',
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    transformExecutionEvidence,
    transformPatch,
    controlCompilationEvidence,
    control: {
      normal: {
        boundary_manifest: normalManifest,
        boundary_verdict: normalVerdict,
        plan_graph: normalPlan,
      },
      negative: {
        boundary_manifest: negativeManifest,
        boundary_verdict: negativeVerdict,
        plan_graph: negativePlan,
      },
    },
  };
}

test('runner rejects non-accepted or byte-drifted transform before worktree creation', async () => {
  const rejected = await runnerInputs();
  rejected.transformArtifact = await readJson(
    'research/campaigns/rc1/artifacts/treatment-v2/transform/behavior-rejection-artifact.json',
  );
  await assert.rejects(runRc1TreatmentRecompile(rejected), /accepted transform/i);

  const patchDrift = await runnerInputs();
  patchDrift.transformPatch = Buffer.concat([patchDrift.transformPatch, Buffer.from('\n')]);
  await assert.rejects(runRc1TreatmentRecompile(patchDrift), /patch digest|patch bytes/i);
});

test('runner rejects legacy evidence and fixed-input drift before worktree creation', async () => {
  const legacy = await runnerInputs();
  legacy.controlCompilationEvidence = await readJson(
    'research/campaigns/rc1/artifacts/control/compilation-evidence.json',
  );
  await assert.rejects(runRc1TreatmentRecompile(legacy), /portable control evidence v2/i);

  const queryDrift = await runnerInputs();
  queryDrift.querySet.queries[0].id = 'drifted-status';
  await assert.rejects(runRc1TreatmentRecompile(queryDrift), /query set|digest chain/i);

  const controlDrift = await runnerInputs();
  controlDrift.control.normal.boundary_manifest.source.query_set_digest = '0'.repeat(64);
  await assert.rejects(runRc1TreatmentRecompile(controlDrift), /control artifact|digest chain/i);

  const transformReceiptDrift = await runnerInputs();
  transformReceiptDrift.transformExecutionEvidence.input_digests.control_compilation_evidence
    = '0'.repeat(64);
  await assert.rejects(
    runRc1TreatmentRecompile(transformReceiptDrift),
    /transform execution evidence|predecessor chain/i,
  );
});
