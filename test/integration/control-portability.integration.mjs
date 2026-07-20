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
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
} from '../../src/artifact-contracts.mjs';
import {
  collectSensorEvidence,
  portableSensorOutcome,
} from '../../src/sensor-adapter.mjs';
import { compileControlArtifacts } from '../../src/control-compiler.mjs';
import { spawnSensorCli } from '../../src/sensor-runtime.mjs';

const CONTROL_BASE_SHA = 'd2d412800492fbed03febe02abc6dca81c09a88b';
const INDEX_DIRECTORY = '.lattice/sensor-rc1-control-v2';
const sourceRoot = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(sourceRoot, relativePath), 'utf8'));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function sensorEnvironment() {
  const env = {
    ...process.env,
    LATTICE_SENSOR_DIR: INDEX_DIRECTORY,
    LATTICE_SENSOR_NO_DAEMON: '1',
    LATTICE_SENSOR_NO_WATCH: '1',
    LATTICE_SENSOR_NO_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
    NO_COLOR: '1',
  };
  delete env.FORCE_COLOR;
  return env;
}

function executeLatticeSensor({ args, cwd }) {
  return new Promise((resolve) => {
    const child = spawnSensorCli(args, {
      cwd,
      env: sensorEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function compileInFreshWorktree({
  repoRoot,
  planInput,
  manualNormal,
  manualNegative,
  querySet,
}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-rc1-control-portability-'));
  const worktreePath = path.join(tempRoot, 'worktree');
  let added = false;
  try {
    git(repoRoot, ['worktree', 'add', '--detach', worktreePath, CONTROL_BASE_SHA]);
    added = true;
    const initialized = await executeLatticeSensor({ args: ['init', '.'], cwd: worktreePath });
    assert.equal(initialized.code, 0, initialized.stderr);
    const sensorEvidence = await collectSensorEvidence({
      cwd: worktreePath,
      querySet,
      execute: executeLatticeSensor,
    });
    const fixtureSource = await readFile(path.join(worktreePath, planInput.project.fixture_entry));
    const codeSnapshotDigest = digestArtifact({
      files: [{
        path: planInput.project.fixture_entry,
        content_digest: createHash('sha256').update(fixtureSource).digest('hex'),
      }],
    });
    const compile = (manualEvidence) => compileControlArtifacts({
      planInput,
      manualEvidence,
      querySet,
      sensorEvidence,
      codeSnapshotDigest,
    });
    return {
      raw_outcomes_digest: digestArtifact(sensorEvidence.outcomes),
      portable_outcomes_digest: digestArtifact(
        sensorEvidence.outcomes.map(portableSensorOutcome),
      ),
      normal: compile(manualNormal),
      negative: compile(manualNegative),
    };
  } finally {
    if (added) git(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const [planInput, manualNormal, manualNegative, querySet] = await Promise.all([
  readJson('research/campaigns/rc1/inputs/plan-input.json'),
  readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
  readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
  readJson('research/campaigns/rc1/inputs/query-set.json'),
]);
const sourceHead = git(sourceRoot, ['rev-parse', 'HEAD']).trim();
const sourceStatus = git(sourceRoot, ['status', '--porcelain=v1']);
const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-control-portability-repo-'));
const repoRoot = path.join(isolatedRoot, 'repo');

try {
  git(isolatedRoot, ['clone', '--no-hardlinks', '--quiet', sourceRoot, repoRoot]);
  const repoHead = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const repoStatus = git(repoRoot, ['status', '--porcelain=v1']);
  const worktreesBefore = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const options = { repoRoot, planInput, manualNormal, manualNegative, querySet };

  const first = await compileInFreshWorktree(options);
  const second = await compileInFreshWorktree(options);

  assert.notEqual(first.raw_outcomes_digest, second.raw_outcomes_digest);
  assert.equal(first.portable_outcomes_digest, second.portable_outcomes_digest);
  assert.deepEqual(first.normal, second.normal);
  assert.deepEqual(first.negative, second.negative);
  for (const compiled of [first.normal, first.negative]) {
    assert.equal(validateBoundaryManifest(compiled.boundary_manifest), true);
    assert.equal(validateBoundaryVerdict(compiled.boundary_verdict), true);
    assert.equal(validatePlanGraph(compiled.plan_graph), true);
  }
  assert.equal(first.normal.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
  assert.equal(first.negative.boundary_verdict.verdicts[0].verdict, 'intentional_serial');
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']).trim(), repoHead);
  assert.equal(git(repoRoot, ['status', '--porcelain=v1']), repoStatus);
  assert.equal(git(repoRoot, ['worktree', 'list', '--porcelain']), worktreesBefore);
  assert.equal(git(sourceRoot, ['rev-parse', 'HEAD']).trim(), sourceHead);
  assert.equal(git(sourceRoot, ['status', '--porcelain=v1']), sourceStatus);

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    control_base_sha: CONTROL_BASE_SHA,
    raw_outcomes_equal: false,
    portable_outcomes_digest: first.portable_outcomes_digest,
    normal: {
      boundary_manifest_digest: first.normal.boundary_manifest_digest,
      boundary_verdict_digest: first.normal.boundary_verdict_digest,
      plan_graph_digest: first.normal.plan_graph_digest,
    },
    negative: {
      boundary_manifest_digest: first.negative.boundary_manifest_digest,
      boundary_verdict_digest: first.negative.boundary_verdict_digest,
      plan_graph_digest: first.negative.plan_graph_digest,
    },
    source_unchanged: true,
    cleanup: 'passed',
  })}\n`);
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
