import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateTransformArtifact } from '../../src/artifact-contracts.mjs';
import { runRc1SeamTreatment } from '../../src/seam-transform.mjs';

const FIXTURE_PATH = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

function git(cwd, args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd, encoding });
  assert.equal(result.status, 0, result.stderr?.toString?.() ?? result.stderr);
  return result.stdout;
}

const sourceRoot = process.cwd();
const sourceStatus = git(sourceRoot, ['status', '--porcelain=v1', '-z'], 'buffer');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-seam-integration-'));
const repoRoot = path.join(tempRoot, 'repo');

try {
  git(tempRoot, ['clone', '--no-hardlinks', '--quiet', sourceRoot, repoRoot]);
  const [
    boundaryManifest,
    boundaryVerdict,
    controlPlan,
    querySet,
    controlCompilationEvidence,
  ] = await Promise.all([
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/plan-v1.json'),
    readJson('research/campaigns/rc1/inputs/query-set.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/compilation-evidence.json'),
  ]);
  const options = {
    repoRoot,
    boundaryManifest,
    boundaryVerdict,
    controlPlan,
    querySet,
    controlCompilationEvidence,
  };
  const cloneHead = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const originalFixture = await readFile(path.join(repoRoot, FIXTURE_PATH), 'utf8');

  const accepted = await runRc1SeamTreatment(options);
  const scopeRejected = await runRc1SeamTreatment({
    ...options,
    transform: ({ worktreePath }) => writeFile(path.join(worktreePath, 'outside.mjs'), 'scope leak\n'),
  });
  const behaviorRejected = await runRc1SeamTreatment({
    ...options,
    transform: ({ worktreePath }) => writeFile(
      path.join(worktreePath, FIXTURE_PATH),
      "export function buildDispatchRecord() { return Object.freeze({ channel: 'broken', label: 'broken' }); }\n",
    ),
  });

  for (const result of [accepted, scopeRejected, behaviorRejected]) {
    assert.equal(validateTransformArtifact(result.artifact), true);
  }
  assert.equal(accepted.artifact.status, 'accepted');
  assert.equal(accepted.artifact.source.base_sha, controlCompilationEvidence.head);
  assert.equal(Buffer.isBuffer(accepted.patch), true);
  assert.equal(scopeRejected.artifact.status, 'rejected');
  assert.equal(scopeRejected.artifact.rejection.kind, 'scope_violation');
  assert.equal(scopeRejected.patch, null);
  assert.equal(behaviorRejected.artifact.status, 'rejected');
  assert.equal(behaviorRejected.artifact.rejection.kind, 'behavior_verification_failed');
  assert.equal(behaviorRejected.artifact.verification.receipts[0].outcome, 'failed');
  assert.equal(behaviorRejected.patch, null);

  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']).trim(), cloneHead);
  assert.equal(git(repoRoot, ['status', '--porcelain']).trim(), '');
  assert.equal(await readFile(path.join(repoRoot, FIXTURE_PATH), 'utf8'), originalFixture);
  assert.equal(
    git(repoRoot, ['worktree', 'list', '--porcelain']).split('\n')
      .filter((line) => line.startsWith('worktree ')).length,
    1,
  );
  assert.equal(git(sourceRoot, ['status', '--porcelain=v1', '-z'], 'buffer').equals(sourceStatus), true);

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    control_base_sha: accepted.artifact.source.base_sha,
    accepted_artifact_digest: accepted.artifact_digest,
    patch_digest: accepted.artifact.patch.digest,
    verification_digest: accepted.artifact.verification.digest,
    changed_paths: accepted.artifact.scope.changed_paths,
    scope_rejection: scopeRejected.artifact.rejection.kind,
    behavior_rejection: behaviorRejected.artifact.rejection.kind,
    source_unchanged: true,
    cleanup: 'passed',
  })}\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
