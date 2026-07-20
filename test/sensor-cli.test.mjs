import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin',
      CODEGRAPH_ALLOW_UNSAFE_NODE: '1',
    },
  });
}

test('lattice sensor init/syncは同梱sensorだけでtyped resultを返す', async (t) => {
  const repo = await mkdtemp(path.join(tmpdir(), 'lattice-sensor-cli-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await writeFile(path.join(repo, 'fixture.mjs'), 'export function fixture() { return 1; }\n');

  for (const command of ['init', 'sync']) {
    const result = run(['sensor', command, '.', '--json'], repo);
    assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload, {
      schema: 'lattice.sensor_command_result.v1',
      provider: 'lattice',
      sensor_owner: 'lattice',
      sensor_version: '0.7.1-lattice.1',
      command,
      status: 'ok',
    });
  }
});

test('lattice sensorは未知commandをtyped usage errorで拒否する', () => {
  const result = run(['sensor', 'unknown', '--json'], ROOT);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'USAGE');
});

test('公開packageは旧Codegraph CLIを同梱せずsensorをprivate実装へ固定する', async () => {
  const rootPackage = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const sensorPackage = JSON.parse(await readFile(path.join(ROOT, 'sensor', 'package.json'), 'utf8'));

  assert.equal(rootPackage.files.includes('sensor/dist'), true);
  assert.equal(rootPackage.files.includes('!sensor/dist/bin'), true);
  assert.equal(sensorPackage.private, true);
  assert.equal(sensorPackage.files.includes('!dist/bin'), true);
  assert.equal(Object.hasOwn(sensorPackage.scripts, 'cli'), false);
  assert.doesNotMatch(sensorPackage.scripts.build, /codegraph|chmodSync/u);
});
