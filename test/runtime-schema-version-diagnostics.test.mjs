import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const RUN_REF = '.lattice/runs/schema-version';
const UPGRADE_COMMAND = 'npm install -g @quolu/lattice@latest --prefer-online';

function selfDigest(value, field) {
  const body = { ...value };
  delete body[field];
  return { ...body, [field]: digestArtifact(body) };
}

function currentMeta(overrides = {}) {
  return selfDigest({
    schema: 'lattice.run_meta.v2',
    run_id: 'schema-version',
    executor_adapter: 'scripted',
    run_event_schema: 'lattice.run_event.v1',
    control_event_schema: 'lattice.runtime_control_event.v1',
    epoch_bundle_schema: 'lattice.runtime_epoch_bundle.v1',
    created_plan_digest: 'a'.repeat(64),
    ...overrides,
    meta_digest: '',
  }, 'meta_digest');
}

function currentPointer(overrides = {}) {
  return selfDigest({
    schema: 'lattice.committed_epoch_pointer.v1',
    run_id: 'schema-version',
    plan_epoch: 1,
    plan_ref: 'plan-schema-version-e1',
    bundle_digest: 'b'.repeat(64),
    activation_run_event_digest: 'c'.repeat(64),
    activation_control_event_digest: 'd'.repeat(64),
    ...overrides,
    pointer_digest: '',
  }, 'pointer_digest');
}

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
    meta: currentMeta(),
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

test('正当なmeta envelopeが宣言するfuture bundle schemaもtypedで返す', async (t) => {
  const root = await fixture(t, {
    meta: currentMeta({ epoch_bundle_schema: 'lattice.runtime_epoch_bundle.v2' }),
  });
  assertUnsupported(status(root), {
    artifact: 'runtime_epoch_bundle',
    observedSchema: 'lattice.runtime_epoch_bundle.v2',
    expectedSchema: 'lattice.runtime_epoch_bundle.v1',
    observedVersion: 2,
    expectedVersion: 1,
  });
});

test('保存されたfuture epoch bundleも破損扱いへ潰さない', async (t) => {
  const root = await fixture(t, {
    meta: currentMeta(),
    pointer: currentPointer(),
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

test('壊れたcurrent envelope内のfuture文字列はunsupportedへ誤分類しない', async (t) => {
  const malformedMetaRoot = await fixture(t, {
    meta: {
      schema: 'lattice.run_meta.v2',
      epoch_bundle_schema: 'lattice.runtime_epoch_bundle.v2',
    },
  });
  const malformedMeta = status(malformedMetaRoot);
  assert.equal(malformedMeta.status, 1, malformedMeta.stderr);
  assert.equal(JSON.parse(malformedMeta.stderr).code, 'INVALID_RUN_STORE');

  const malformedPointerRoot = await fixture(t, {
    meta: currentMeta(),
    pointer: { schema: 'lattice.committed_epoch_pointer.v1', plan_epoch: 1 },
    bundle: { schema: 'lattice.runtime_epoch_bundle.v2' },
  });
  const malformedPointer = status(malformedPointerRoot);
  assert.equal(malformedPointer.status, 1, malformedPointer.stderr);
  assert.equal(JSON.parse(malformedPointer.stderr).code, 'INVALID_RUN_STORE');
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
