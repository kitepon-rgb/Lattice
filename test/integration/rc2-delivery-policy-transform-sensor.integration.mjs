import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectSensorEvidence } from '../../src/sensor-adapter.mjs';
import { applyRc2DeliveryPolicyTransform } from '../../src/rc2-delivery-policy-transform.mjs';

const ENTRY_PATH = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const SHARED_TEST_PATH = 'test/rc2-delivery-policy-fixture.test.mjs';
const ORACLE_PATH = 'src/rc2-delivery-policy-oracle.mjs';
const RESOLVERS = Object.freeze([
  Object.freeze({
    symbol: 'resolveEmailPolicy',
    path: 'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
  }),
  Object.freeze({
    symbol: 'resolvePushPolicy',
    path: 'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
  }),
  Object.freeze({
    symbol: 'resolveSmsPolicy',
    path: 'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
  }),
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

async function copyRepoFile(repoRoot, relativePath) {
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(new URL(`../../${relativePath}`, import.meta.url)));
}

function exactSummary(entries, symbol, relativePath) {
  return entries.some((entry) => entry.name === symbol && entry.filePath === relativePath);
}

function exactQuery(entries, symbol, relativePath) {
  return entries.some((entry) => (
    entry.node?.name === symbol && entry.node.filePath === relativePath
  ));
}

test('accepted registry shardはfresh LatticeSensorで3 resolverへのexact calleeを持つ', async (context) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc2-lattice-sensor-transform-'));
  context.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    copyRepoFile(repoRoot, ENTRY_PATH),
    copyRepoFile(repoRoot, SHARED_TEST_PATH),
    copyRepoFile(repoRoot, ORACLE_PATH),
  ]);
  run('git', ['init'], repoRoot);
  run('git', ['config', 'user.email', 'test@example.invalid'], repoRoot);
  run('git', ['config', 'user.name', 'Lattice Test'], repoRoot);
  run('git', ['add', '.'], repoRoot);
  run('git', ['commit', '-m', 'RC2 LatticeSensor observability基準'], repoRoot);

  await applyRc2DeliveryPolicyTransform({ worktreePath: repoRoot });
  invokeSensorCli(run, ['init', '.'], repoRoot);

  const status = JSON.parse(invokeSensorCli(run, ['status', '.', '--json'], repoRoot));
  assert.equal(status.initialized, true);
  assert.deepEqual(status.pendingChanges, { added: 0, modified: 0, removed: 0 });
  assert.equal(status.worktreeMismatch, null);
  assert.equal(status.index.state, 'complete');
  assert.equal(status.index.pendingRefs, 0);

  const files = JSON.parse(invokeSensorCli(run, ['files', '--json'], repoRoot));
  const indexedPaths = new Set(files.map(({ path: relativePath }) => relativePath));
  for (const relativePath of [ENTRY_PATH, ...RESOLVERS.map((entry) => entry.path)]) {
    assert.equal(indexedPaths.has(relativePath), true, relativePath);
  }

  const querySet = {
    schema: 'lattice.rc2.sensor_observability_query_set.v1',
    queries: [
      { id: 'entry-query', operation: 'query', target: 'resolveDeliveryPolicy' },
      { id: 'entry-callees', operation: 'callees', target: 'resolveDeliveryPolicy' },
      ...RESOLVERS.map(({ symbol }, index) => ({
        id: `resolver-${index + 1}-query`,
        operation: 'query',
        target: symbol,
      })),
    ],
  };
  const evidence = await collectSensorEvidence({ cwd: repoRoot, querySet });
  assert.deepEqual(evidence.outcomes.map(({ outcome }) => outcome),
    querySet.queries.map(() => 'ready'));
  assert.equal(
    exactQuery(evidence.outcomes[0].data, 'resolveDeliveryPolicy', ENTRY_PATH),
    true,
  );
  for (let index = 0; index < RESOLVERS.length; index += 1) {
    const resolver = RESOLVERS[index];
    assert.equal(exactQuery(evidence.outcomes[index + 2].data, resolver.symbol, resolver.path), true);
    assert.equal(
      exactSummary(evidence.outcomes[1].data.callees, resolver.symbol, resolver.path),
      true,
      `${resolver.symbol} direct callee link`,
    );
  }
});
