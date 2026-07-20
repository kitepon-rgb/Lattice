import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// RC3-B integration safety net（ADR 0044 Decision 10.3）:
// RC3 event store root `research/runs/`はtracked exclusionでLatticeSensor coverageから
// 除外され、JSON非index挙動への暗黙依存なしに`sensor files`照合で検証できる。
// 除外の生きた証明として、言語index対象になり得る.mjs probeをevent store側と
// fixture側の両方へ置き、fixture側だけが収載されることを固定する。
const REPO_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const EXCLUDED_PROBE_PATH = 'research/runs/rc3/it-run-01/state/rc3-scope-probe-excluded.mjs';
const EXCLUDED_EVENT_PATH = 'research/runs/rc3/it-run-01/events/000000.json';
const INDEXED_PROBE_PATH = 'research/fixtures/rc3-scope-probe/rc3-scope-probe-indexed.mjs';
const LIVE_PATHS = Object.freeze([
  'src/rc2-campaign.mjs',
  'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs',
]);

import { invokeSensorCli } from '../../src/sensor-runtime.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

async function writeProbe(repoRoot, relativePath, contents) {
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

test('LatticeSensor tracked exclusionはRC3 event storeをlive coverageから除外する', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3-event-store-scope-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = path.join(temporaryRoot, 'repo');
  run('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, repoRoot], REPO_ROOT);

  // commit済みHEADでなく、現在のworking treeのexclusion設定を検証対象にする。
  await copyFile(path.join(REPO_ROOT, 'lattice-sensor.json'), path.join(repoRoot, 'lattice-sensor.json'));
  await writeProbe(repoRoot, EXCLUDED_PROBE_PATH, [
    '/** RC3 event store側のprobe。live coverageへ収載されてはならない。 */',
    'export function rc3ScopeProbeExcluded() {',
    "  return 'excluded';",
    '}',
    '',
  ].join('\n'));
  await writeProbe(repoRoot, EXCLUDED_EVENT_PATH, `${JSON.stringify({
    schema: 'lattice.run_event.v1',
    run_id: 'it-run-01',
    sequence: 0,
    previous_digest: null,
    kind: 'run_initialized',
    actor: 'lattice-runtime',
    plan_epoch: 0,
    subject: { kind: 'run_request', ref: 'request.json' },
    payload: { request_digest: 'a'.repeat(64) },
    recorded_at: '2026-07-17T00:00:00.000Z',
    event_digest: 'b'.repeat(64),
  })}\n`);
  await writeProbe(repoRoot, INDEXED_PROBE_PATH, [
    '/** fixture側のcontrol probe。exclusionの過剰適用をここで検出する。 */',
    'export function rc3ScopeProbeIndexed() {',
    "  return 'indexed';",
    '}',
    '',
  ].join('\n'));
  run('git', ['add', '--all'], repoRoot);
  run('git', [
    '-c', 'user.name=lattice-rc3-integration',
    '-c', 'user.email=lattice-rc3-integration@invalid',
    'commit', '--quiet', '-m', 'RC3 event store scope probes',
  ], repoRoot);

  invokeSensorCli(run, ['init', '.'], repoRoot);

  const status = JSON.parse(invokeSensorCli(run, ['status', '.', '--json'], repoRoot));
  assert.equal(status.initialized, true);
  assert.deepEqual(status.pendingChanges, { added: 0, modified: 0, removed: 0 });
  assert.equal(status.worktreeMismatch, null);
  assert.equal(status.index.state, 'complete');
  assert.equal(status.index.pendingRefs, 0);

  const files = JSON.parse(invokeSensorCli(run, ['files', '--path', '.', '--json'], repoRoot));
  const indexedPaths = files.map(({ path: relativePath }) => relativePath);
  assert.deepEqual(indexedPaths.filter((relativePath) => (
    relativePath.startsWith('research/runs/')
  )), []);
  assert.equal(indexedPaths.includes(INDEXED_PROBE_PATH), true);
  for (const relativePath of LIVE_PATHS) {
    assert.equal(indexedPaths.includes(relativePath), true, relativePath);
  }

  const indexedQuery = JSON.parse(invokeSensorCli(
    run,
    ['query', 'rc3ScopeProbeIndexed', '--path', '.', '--json'],
    repoRoot,
  ));
  assert.equal(indexedQuery.filter(({ node }) => (
    node?.name === 'rc3ScopeProbeIndexed' && node.filePath === INDEXED_PROBE_PATH
  )).length, 1);

  // fuzzy解決があり得るため、exact名一致のnodeが存在しないことを検査する。
  const excludedQuery = JSON.parse(invokeSensorCli(
    run,
    ['query', 'rc3ScopeProbeExcluded', '--path', '.', '--json'],
    repoRoot,
  ));
  assert.deepEqual(excludedQuery.filter(({ node }) => (
    node?.name === 'rc3ScopeProbeExcluded'
  )), []);
});
