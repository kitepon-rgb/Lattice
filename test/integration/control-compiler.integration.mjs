import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
} from '../../src/artifact-contracts.mjs';
import { collectSensorEvidence } from '../../src/sensor-adapter.mjs';
import { compileControlArtifacts } from '../../src/control-compiler.mjs';
import { spawnSensorCliSync } from '../../src/sensor-runtime.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

const [planInput, manualEvidence, querySet, fixtureSource] = await Promise.all([
  readJson('research/campaigns/rc1/inputs/plan-input.json'),
  readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
  readJson('research/campaigns/rc1/inputs/query-set.json'),
  readFile(new URL('../../research/fixtures/dispatch-record/src/dispatch-record.mjs', import.meta.url)),
]);
const sourceRoot = process.cwd();
const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'lattice-control-compiler-sensor-'));
const worktreePath = path.join(isolatedRoot, 'worktree');
const git = (args) => spawnSync('git', args, { cwd: sourceRoot, encoding: 'utf8' });
const added = git(['worktree', 'add', '--detach', worktreePath, 'HEAD']);
assert.equal(added.status, 0, added.stderr);
let codegraphEvidence;
try {
  const initialized = spawnSensorCliSync(['init', '.'], {
    cwd: worktreePath, encoding: 'utf8', env: { ...process.env,
      CODEGRAPH_DIR: '.lattice-sensor-control-integration', CODEGRAPH_NO_DAEMON: '1',
      CODEGRAPH_NO_WATCH: '1', CODEGRAPH_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', NO_COLOR: '1' },
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  codegraphEvidence = await collectSensorEvidence({ cwd: worktreePath, querySet,
    execute: ({ args, cwd }) => {
      const result = spawnSensorCliSync(args, { cwd, encoding: 'utf8', env: { ...process.env,
        CODEGRAPH_DIR: '.lattice-sensor-control-integration', CODEGRAPH_NO_DAEMON: '1',
        CODEGRAPH_NO_WATCH: '1', CODEGRAPH_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', NO_COLOR: '1' } });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr,
        ...(result.error ? { error: result.error.message } : {}) };
    } });
} finally {
  git(['worktree', 'remove', '--force', worktreePath]);
  await rm(isolatedRoot, { recursive: true, force: true });
}
const codeSnapshotDigest = digestArtifact({
  files: [
    {
      path: planInput.project.fixture_entry,
      content_digest: createHash('sha256').update(fixtureSource).digest('hex'),
    },
  ],
});
const compiled = compileControlArtifacts({
  planInput,
  manualEvidence,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest,
});

assert.equal(validateBoundaryManifest(compiled.boundary_manifest), true);
assert.equal(validateBoundaryVerdict(compiled.boundary_verdict), true);
assert.equal(validatePlanGraph(compiled.plan_graph), true);
assert.equal(compiled.boundary_manifest.conflicts.length, 1);
assert.equal(compiled.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
assert.equal(compiled.plan_graph.minimum_feasible_waves, 2);

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  code_snapshot_digest: codeSnapshotDigest,
  boundary_manifest_digest: compiled.boundary_manifest_digest,
  boundary_verdict_digest: compiled.boundary_verdict_digest,
  plan_graph_digest: compiled.plan_graph_digest,
  graph_outcomes: codegraphEvidence.outcomes.map(({ id, outcome }) => ({ id, outcome })),
})}\n`);
