import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
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

import { digestArtifact, validateTransformArtifact } from '../src/artifact-contracts.mjs';
import {
  applyRc1SeamTransform,
  runRc1SeamTreatment,
} from '../src/seam-transform.mjs';

const FIXTURE_PATH = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const CAMPAIGN_INPUTS = [
  'research/campaigns/rc1/inputs/plan-input.json',
  'research/campaigns/rc1/inputs/manual-evidence.normal.json',
  'research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json',
  'research/campaigns/rc1/inputs/query-set.json',
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

async function controlInputs() {
  const [
    boundaryManifest,
    boundaryVerdict,
    controlPlan,
    querySet,
    controlCompilationEvidence,
  ] = await Promise.all([
    readJson('research/campaigns/rc1/artifacts/control/boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control/boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control/plan-v1.json'),
    readJson('research/campaigns/rc1/inputs/query-set.json'),
    readJson('research/campaigns/rc1/artifacts/control/compilation-evidence.json'),
  ]);
  return {
    boundaryManifest,
    boundaryVerdict,
    controlPlan,
    querySet,
    controlCompilationEvidence,
  };
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function copyRepoFile(repoRoot, relativePath) {
  const content = await readFile(new URL(`../${relativePath}`, import.meta.url));
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function makeFixtureRepo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-seam-unit-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, FIXTURE_PATH),
    copyRepoFile(repoRoot, 'test/research-dispatch-record.test.mjs'),
    ...CAMPAIGN_INPUTS.map((relativePath) => copyRepoFile(repoRoot, relativePath)),
  ]);
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-m', 'fixture baseline']);
  return repoRoot;
}

test('fixed seam writer emits separate channel, label, and composition modules', async (t) => {
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'lattice-seam-writer-'));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  await mkdir(path.join(worktreePath, 'research/fixtures/dispatch-record/src'), { recursive: true });

  await applyRc1SeamTransform({ worktreePath });
  const first = await Promise.all([
    readFile(path.join(worktreePath, 'research/fixtures/dispatch-record/src/dispatch-channel.mjs'), 'utf8'),
    readFile(path.join(worktreePath, 'research/fixtures/dispatch-record/src/dispatch-label.mjs'), 'utf8'),
    readFile(path.join(worktreePath, FIXTURE_PATH), 'utf8'),
  ]);
  await applyRc1SeamTransform({ worktreePath });
  const second = await Promise.all([
    readFile(path.join(worktreePath, 'research/fixtures/dispatch-record/src/dispatch-channel.mjs'), 'utf8'),
    readFile(path.join(worktreePath, 'research/fixtures/dispatch-record/src/dispatch-label.mjs'), 'utf8'),
    readFile(path.join(worktreePath, FIXTURE_PATH), 'utf8'),
  ]);

  assert.deepEqual(second, first);
  assert.match(first[0], /export function selectDispatchChannel/);
  assert.match(first[1], /export function formatDispatchLabel/);
  assert.match(first[2], /selectDispatchChannel\(input\.priority\)/);
  assert.match(first[2], /formatDispatchLabel\(input\.recipient, input\.title\)/);
});

test('candidate or query-set drift fails before isolated execution', async () => {
  const values = await controlInputs();
  const candidateDrift = structuredClone(values);
  candidateDrift.boundaryVerdict.verdicts[0].seam_candidate.id = 'other-candidate';
  await assert.rejects(
    runRc1SeamTreatment({ repoRoot: '/not-used', ...candidateDrift }),
    /candidate/i,
  );

  const queryDrift = structuredClone(values);
  queryDrift.querySet.queries[0].id = 'status-drifted';
  await assert.rejects(
    runRc1SeamTreatment({ repoRoot: '/not-used', ...queryDrift }),
    /digest chain|query set/i,
  );

  const controlBaseDrift = structuredClone(values);
  controlBaseDrift.controlCompilationEvidence.head = 'not-a-git-sha';
  await assert.rejects(
    runRc1SeamTreatment({ repoRoot: '/not-used', ...controlBaseDrift }),
    /control compilation evidence|base/i,
  );

  await assert.rejects(
    runRc1SeamTreatment({ repoRoot: '/not-used', ...values, baseRef: 'HEAD' }),
    /baseRef override/i,
  );
});

test('shared-state negative control is not admitted to seam execution', async () => {
  const values = await controlInputs();
  [
    values.boundaryManifest,
    values.boundaryVerdict,
    values.controlPlan,
  ] = await Promise.all([
    readJson('research/campaigns/rc1/artifacts/control/negative-shared-state-boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control/negative-shared-state-boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control/negative-shared-state-plan-v1.json'),
  ]);

  await assert.rejects(
    runRc1SeamTreatment({ repoRoot: '/not-used', ...values }),
    /normal control|seam intervention/i,
  );
});

test('accepted treatment is deterministic, behavior-verified, and source-preserving', async (t) => {
  const repoRoot = await makeFixtureRepo(t);
  const values = await controlInputs();
  const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
  values.controlCompilationEvidence.head = sourceHead;
  const original = await readFile(path.join(repoRoot, FIXTURE_PATH), 'utf8');

  const first = await runRc1SeamTreatment({ repoRoot, ...values });
  const second = await runRc1SeamTreatment({ repoRoot, ...structuredClone(values) });

  assert.equal(validateTransformArtifact(first.artifact), true);
  assert.equal(first.artifact.status, 'accepted');
  assert.equal(first.artifact.source.base_sha, sourceHead);
  assert.equal(first.artifact_digest, digestArtifact(first.artifact));
  assert.equal(first.artifact.patch.digest, createHash('sha256').update(first.patch).digest('hex'));
  assert.deepEqual(first.artifact.scope.changed_paths, [
    'research/fixtures/dispatch-record/src/dispatch-channel.mjs',
    'research/fixtures/dispatch-record/src/dispatch-label.mjs',
    'research/fixtures/dispatch-record/src/dispatch-record.mjs',
  ]);
  assert.equal(first.artifact.verification.receipts[0].outcome, 'passed');
  assert.deepEqual(second.artifact, first.artifact);
  assert.equal(second.patch.equals(first.patch), true);
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), sourceHead);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(repoRoot, FIXTURE_PATH), 'utf8'), original);
  assert.equal(
    git(repoRoot, ['worktree', 'list', '--porcelain']).split('\n')
      .filter((line) => line.startsWith('worktree ')).length,
    1,
  );
});
