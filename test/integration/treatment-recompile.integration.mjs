import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanDiff,
  validatePlanGraph,
} from '../../src/artifact-contracts.mjs';
import { runRc1TreatmentRecompile } from '../../src/treatment-runner.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

function git(cwd, args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd, encoding });
  assert.equal(result.status, 0, result.stderr?.toString?.() ?? result.stderr);
  return result.stdout;
}

const sourceRoot = process.cwd();
const sourceHead = git(sourceRoot, ['rev-parse', 'HEAD']).trim();
const sourceStatus = git(sourceRoot, ['status', '--porcelain=v1', '-z'], 'buffer');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-treatment-recompile-integration-'));
const repoRoot = path.join(tempRoot, 'repo');

try {
  git(tempRoot, ['clone', '--no-hardlinks', '--quiet', sourceRoot, repoRoot]);
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
    readFile(new URL('../../research/campaigns/rc1/artifacts/treatment-v2/transform/seam.patch', import.meta.url)),
    readJson('research/campaigns/rc1/artifacts/control-v2/compilation-evidence.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/plan-v1.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-plan-v1.json'),
  ]);
  const options = {
    repoRoot,
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
  const cloneHead = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const cloneStatus = git(repoRoot, ['status', '--porcelain=v1', '-z'], 'buffer');
  const cloneWorktrees = git(repoRoot, ['worktree', 'list', '--porcelain']);

  const first = await runRc1TreatmentRecompile(options);
  const secondOptions = structuredClone({ ...options, transformPatch: [] });
  secondOptions.transformPatch = Buffer.from(transformPatch);
  const second = await runRc1TreatmentRecompile(secondOptions);

  assert.deepEqual(second.compiled, first.compiled);
  assert.notEqual(second.execution.raw_outcomes_digest, first.execution.raw_outcomes_digest);
  assert.equal(second.execution.portable_outcomes_digest, first.execution.portable_outcomes_digest);
  assert.equal(validateBoundaryManifest(first.compiled.normal.boundary_manifest), true);
  assert.equal(validateBoundaryVerdict(first.compiled.normal.boundary_verdict), true);
  assert.equal(validatePlanGraph(first.compiled.normal.plan_graph), true);
  assert.equal(validateBoundaryManifest(first.compiled.negative.boundary_manifest), true);
  assert.equal(validateBoundaryVerdict(first.compiled.negative.boundary_verdict), true);
  assert.equal(validatePlanGraph(first.compiled.negative.plan_graph), true);
  assert.equal(validatePlanDiff(first.compiled.plan_diff), true);
  assert.equal(first.compiled.normal.boundary_verdict.verdicts[0].verdict, 'parallel_ready');
  assert.equal(first.compiled.normal.plan_graph.minimum_feasible_waves, 1);
  assert.equal(first.compiled.negative.boundary_verdict.verdicts[0].verdict, 'intentional_serial');
  assert.equal(first.compiled.negative.plan_graph.minimum_feasible_waves, 2);
  assert.equal(first.execution.sensor_cleanup, 'passed');
  await assert.rejects(access(path.join(repoRoot, '.codegraph-rc1-treatment')), /ENOENT/);
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']).trim(), cloneHead);
  assert.equal(git(repoRoot, ['status', '--porcelain=v1', '-z'], 'buffer').equals(cloneStatus), true);
  assert.equal(git(repoRoot, ['worktree', 'list', '--porcelain']), cloneWorktrees);
  assert.equal(git(sourceRoot, ['rev-parse', 'HEAD']).trim(), sourceHead);
  assert.equal(git(sourceRoot, ['status', '--porcelain=v1', '-z'], 'buffer').equals(sourceStatus), true);

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    base_sha: transformArtifact.source.base_sha,
    transform_artifact_digest: first.execution.transform_artifact_digest,
    raw_outcomes_equal: false,
    portable_outcomes_digest: first.execution.portable_outcomes_digest,
    normal: {
      verdict: first.compiled.normal.boundary_verdict.verdicts[0].verdict,
      conflicts: first.compiled.normal.boundary_manifest.conflicts.length,
      unknowns: first.compiled.normal.boundary_manifest.unknowns.length,
      waves: first.compiled.normal.plan_graph.minimum_feasible_waves,
    },
    negative: {
      verdict: first.compiled.negative.boundary_verdict.verdicts[0].verdict,
      conflict_kinds: first.compiled.negative.boundary_manifest.conflicts.map(({ kind }) => kind),
      waves: first.compiled.negative.plan_graph.minimum_feasible_waves,
    },
    plan_diff_digest: first.compiled.plan_diff_digest,
    comparison_digest: first.compiled.comparison_digest,
    source_unchanged: true,
    sensor_cleanup: 'passed',
    worktree_cleanup: 'passed',
  })}\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
