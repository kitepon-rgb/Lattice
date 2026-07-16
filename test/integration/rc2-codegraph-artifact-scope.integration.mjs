import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const LIVE_PATHS = Object.freeze([
  'src/rc2-campaign.mjs',
  'src/rc2-delivery-policy-oracle.mjs',
  'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs',
]);
const ORACLE_TESTS = Object.freeze([
  'test/rc2-artifact-version-witness.test.mjs',
  'test/rc2-campaign.test.mjs',
  'test/rc2-delivery-policy-fixture.test.mjs',
  'test/rc2-delivery-policy-transform.test.mjs',
]);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

test('fresh Codegraphはimmutable artifact identityをlive graphから除外する', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc2-artifact-scope-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = path.join(temporaryRoot, 'repo');
  run('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, repoRoot], REPO_ROOT);
  run('codegraph', ['init', '.'], repoRoot);

  const status = JSON.parse(run('codegraph', ['status', '.', '--json'], repoRoot));
  assert.equal(status.initialized, true);
  assert.deepEqual(status.pendingChanges, { added: 0, modified: 0, removed: 0 });
  assert.equal(status.worktreeMismatch, null);
  assert.equal(status.index.state, 'complete');
  assert.equal(status.index.pendingRefs, 0);

  const files = JSON.parse(run('codegraph', ['files', '--path', '.', '--json'], repoRoot));
  const indexedPaths = files.map(({ path: relativePath }) => relativePath);
  const artifactIdentityPaths = indexedPaths.filter((relativePath) => (
    /^research\/campaigns\/[^/]+\/artifacts\/[^/]+\/identity\//u.test(relativePath)
  ));
  assert.deepEqual(artifactIdentityPaths, []);
  for (const relativePath of LIVE_PATHS) {
    assert.equal(indexedPaths.includes(relativePath), true, relativePath);
  }

  const campaignQuery = JSON.parse(run(
    'codegraph',
    ['query', 'runRc2Campaign', '--path', '.', '--json'],
    repoRoot,
  ));
  assert.equal(campaignQuery.filter(({ node }) => (
    node?.name === 'runRc2Campaign' && node.filePath === 'src/rc2-campaign.mjs'
  )).length, 1);

  const affected = JSON.parse(run(
    'codegraph',
    ['affected', 'src/rc2-delivery-policy-oracle.mjs', '--path', '.', '--json'],
    repoRoot,
  ));
  assert.deepEqual(affected.changedFiles, ['src/rc2-delivery-policy-oracle.mjs']);
  assert.deepEqual([...affected.affectedTests].sort(), [...ORACLE_TESTS].sort());
  assert.ok(affected.totalDependentsTraversed >= ORACLE_TESTS.length);
});
