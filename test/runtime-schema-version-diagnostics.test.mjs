import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const RUN_REF = '.lattice/runs/schema-version';
const UPGRADE_COMMAND = 'npm install -g @quolu/lattice@latest --prefer-online';

function command(commandName, args, cwd) {
  const result = spawnSync(commandName, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${commandName}: ${result.stderr}`);
}

async function fixture(t, { meta, pointer = null, bundle = null }) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-runtime-schema-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  command('git', ['init', '--quiet', '--initial-branch=main'], root);
  const runDir = path.join(root, RUN_REF);
  await mkdir(runDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(runDir, 'events.json'), '[]\n'),
    writeFile(path.join(runDir, 'run-meta.json'), `${JSON.stringify(meta)}\n`),
    writeFile(path.join(runDir, 'plan-compile-result.json'), '{}\n'),
    writeFile(path.join(runDir, 'request.json'), '{}\n'),
  ]);
  if (pointer !== null) {
    await writeFile(path.join(runDir, 'committed-epoch.json'), `${JSON.stringify(pointer)}\n`);
  }
  if (bundle !== null) {
    const epochDir = path.join(runDir, 'epochs', '00000001');
    await mkdir(epochDir, { recursive: true });
    await writeFile(path.join(epochDir, 'epoch-bundle.json'), `${JSON.stringify(bundle)}\n`);
  }
  return root;
}

function status(root) {
  return spawnSync(process.execPath, [CLI, 'run', 'status', '--run', RUN_REF], {
    cwd: root,
    encoding: 'utf8',
  });
}

function assertUnsupported(result, expected) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.schema, 'lattice.cli_error.v2');
  assert.equal(failure.code, 'UNSUPPORTED_RUNTIME_STORE_VERSION');
  assert.deepEqual(failure.detail, {
    artifact: expected.artifact,
    observed_schema: expected.observedSchema,
    expected_schema: expected.expectedSchema,
    observed_version: expected.observedVersion,
    expected_version: expected.expectedVersion,
    upgrade_command: UPGRADE_COMMAND,
  });
}

test('future run metaは期待versionと更新手順をtypedで返す', async (t) => {
  const root = await fixture(t, { meta: { schema: 'lattice.run_meta.v3' } });
  assertUnsupported(status(root), {
    artifact: 'run_meta',
    observedSchema: 'lattice.run_meta.v3',
    expectedSchema: 'lattice.run_meta.v2',
    observedVersion: 3,
    expectedVersion: 2,
  });
});

test('future pointerはartifact別の期待versionをtypedで返す', async (t) => {
  const root = await fixture(t, {
    meta: { schema: 'lattice.run_meta.v2' },
    pointer: { schema: 'lattice.committed_epoch_pointer.v2' },
  });
  assertUnsupported(status(root), {
    artifact: 'committed_epoch_pointer',
    observedSchema: 'lattice.committed_epoch_pointer.v2',
    expectedSchema: 'lattice.committed_epoch_pointer.v1',
    observedVersion: 2,
    expectedVersion: 1,
  });
});

test('保存されたfuture epoch bundleも破損扱いへ潰さない', async (t) => {
  const root = await fixture(t, {
    meta: { schema: 'lattice.run_meta.v2' },
    pointer: { schema: 'lattice.committed_epoch_pointer.v1', plan_epoch: 1 },
    bundle: { schema: 'lattice.runtime_epoch_bundle.v2' },
  });
  assertUnsupported(status(root), {
    artifact: 'runtime_epoch_bundle',
    observedSchema: 'lattice.runtime_epoch_bundle.v2',
    expectedSchema: 'lattice.runtime_epoch_bundle.v1',
    observedVersion: 2,
    expectedVersion: 1,
  });
});

test('既知familyでないschemaは既存unsupported、現行世代の破損はINVALID_RUN_STOREに残す', async (t) => {
  const unknownRoot = await fixture(t, { meta: { schema: 'lattice.run_meta.experimental' } });
  const unknown = status(unknownRoot);
  assert.equal(unknown.status, 1, unknown.stderr);
  assert.equal(JSON.parse(unknown.stderr).code, 'UNSUPPORTED_RUN_STORE_SCHEMA');

  const malformedCurrentRoot = await fixture(t, { meta: { schema: 'lattice.run_meta.v2' } });
  const malformedCurrent = status(malformedCurrentRoot);
  assert.equal(malformedCurrent.status, 1, malformedCurrent.stderr);
  assert.equal(JSON.parse(malformedCurrent.stderr).code, 'INVALID_RUN_STORE');
});
