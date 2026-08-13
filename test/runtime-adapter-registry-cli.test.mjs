import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeTest from 'node:test';

const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

import {
  validateAdapterLaunchDescriptor,
  validateAdapterRegistry,
  validateRuntimeAdapterCapabilities,
} from '../src/runtime-controller-protocol.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { registerRuntimeAdapter } from '../src/runtime-adapter-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const SCHEMA_TITLE = 'lattice.runtime_adapter_registration_input.v2';
const LEGACY_SCHEMA_TITLE = 'lattice.runtime_adapter_registration_input.v1';
const CAPABILITIES_SCHEMA_TITLE = 'lattice.runtime_adapter_capabilities.v2';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
  assert.equal(result.error, undefined);
  return result;
}

function runCli(args, cwd) {
  return run(process.execPath, [CLI, ...args], cwd);
}

async function createGitRepo(prefix) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(repoRoot);
  const initialized = run('git', ['init', '--quiet', '--initial-branch=main'], repoRoot);
  assert.equal(initialized.status, 0, initialized.stderr);
  return { temporaryRoot, repoRoot };
}

test('register入力schemaは公開CLIとpackage配布物から取得でき、digest欄を要求しない', async () => {
  const result = runCli(['run', 'adapter', 'register', '--schema', '--json'], ROOT);
  assert.equal(result.status, 0, result.stderr);
  const schema = JSON.parse(result.stdout);
  assert.equal(schema.title, SCHEMA_TITLE);
  for (const branch of schema.oneOf) {
    assert.equal(branch.additionalProperties, false);
    assert.ok(branch.required.includes('host_driven_epoch'));
    assert.deepEqual(branch.properties.host_driven_epoch, { type: 'boolean' });
    assert.ok(!branch.required.some((field) => field.endsWith('_digest')));
    assert.ok(!Object.keys(branch.properties).some((field) => field.endsWith('_digest')));
  }
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(manifest.files.includes(`docs/schemas/${SCHEMA_TITLE}.schema.json`));
  assert.ok(manifest.files.includes(`docs/schemas/${LEGACY_SCHEMA_TITLE}.schema.json`));
  assert.ok(manifest.files.includes(`docs/schemas/${CAPABILITIES_SCHEMA_TITLE}.schema.json`));
  const capabilitiesSchema = JSON.parse(await readFile(path.join(
    ROOT,
    'docs',
    'schemas',
    `${CAPABILITIES_SCHEMA_TITLE}.schema.json`,
  ), 'utf8'));
  assert.equal(capabilitiesSchema.title, CAPABILITIES_SCHEMA_TITLE);
  assert.equal(capabilitiesSchema.additionalProperties, false);
  assert.ok(capabilitiesSchema.required.includes('host_driven_epoch'));
  assert.deepEqual(capabilitiesSchema.properties.host_driven_epoch, { type: 'boolean' });
  assert.deepEqual(capabilitiesSchema.properties.operations.const, [
    'dispatch', 'observe', 'inventory', 'barrier', 'rebind', 'prepare',
    'activate', 'release', 'revoke',
  ]);
  for (const hostDrivenEpoch of [true, false]) {
    const capabilities = {
      schema: CAPABILITIES_SCHEMA_TITLE,
      operations: [...capabilitiesSchema.properties.operations.const],
      process_observation: true,
      worktree_fingerprint: true,
      staged_write_lease: true,
      durable_dispatch: true,
      host_driven_epoch: hostDrivenEpoch,
      capabilities_digest: '',
    };
    capabilities.capabilities_digest = selfDigest(capabilities, 'capabilities_digest');
    assert.deepEqual(Object.keys(capabilities).sort(), [...capabilitiesSchema.required].sort());
    assert.equal(validateRuntimeAdapterCapabilities(capabilities), true);
  }
});

test('registry未作成のlistは空のversioned resultを返す', async (t) => {
  const { temporaryRoot, repoRoot } = await createGitRepo('lattice-adapter-list-empty-');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const result = runCli(['run', 'adapter', 'list', '--json'], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema, 'lattice.runtime_adapter_list_result.v1');
  assert.equal(output.registry_digest, null);
  assert.deepEqual(output.adapters, []);
  assert.equal(selfDigest(output, 'result_digest'), output.result_digest);
});

test('run startはwork-orderを既知adapterとしてrequest読取へ進める', async (t) => {
  const { temporaryRoot, repoRoot } = await createGitRepo('lattice-work-order-start-');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const missingRequest = path.join(repoRoot, 'missing-request.json');

  const admitted = runCli([
    'run', 'start', '--request', missingRequest, '--executor', 'work-order',
  ], repoRoot);
  assert.equal(admitted.status, 1);
  assert.equal(admitted.stdout, '');
  assert.equal(JSON.parse(admitted.stderr).code, 'INPUT_UNREADABLE');

  const unknown = runCli([
    'run', 'start', '--request', missingRequest, '--executor', 'unknown-adapter',
  ], repoRoot);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, '');
  const unknownError = JSON.parse(unknown.stderr);
  assert.equal(unknownError.code, 'UNKNOWN_ADAPTER');
  assert.match(unknownError.message, /未知のexecutor adapter/u);
});

test('公開CLIはexisting endpointを登録・再登録し、listへdescriptor要約を返す', async (t) => {
  const { temporaryRoot, repoRoot } = await createGitRepo('lattice-adapter-register-');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const inputPath = path.join(repoRoot, 'adapter.json');
  const input = {
    schema: LEGACY_SCHEMA_TITLE,
    adapter_kind: 'scripted',
    launch_kind: 'existing_endpoint',
    endpoint: path.join(temporaryRoot, 'controller.sock'),
  };
  await writeFile(inputPath, `${JSON.stringify(input)}\n`);

  const created = runCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot);
  assert.equal(created.status, 0, created.stderr);
  const createdOutput = JSON.parse(created.stdout);
  assert.equal(createdOutput.schema, 'lattice.runtime_adapter_register_result.v1');
  assert.equal(createdOutput.outcome, 'created');
  assert.deepEqual(createdOutput.binary_identity_observation, {
    status: 'not_applicable',
    reason: null,
    message: null,
  });
  assert.equal(selfDigest(createdOutput, 'result_digest'), createdOutput.result_digest);

  const registry = JSON.parse(await readFile(path.join(
    repoRoot,
    '.lattice/runtime/adapter-registry/registry.json',
  )));
  const descriptor = JSON.parse(await readFile(path.join(
    repoRoot,
    '.lattice/runtime/adapter-registry/descriptors/scripted.json',
  )));
  assert.equal(validateAdapterRegistry(registry), true);
  assert.equal(validateAdapterLaunchDescriptor(descriptor), true);
  assert.equal(descriptor.descriptor_digest, registry.entries[0].launch_descriptor_digest);

  input.endpoint = path.join(temporaryRoot, 'replacement.sock');
  await writeFile(inputPath, `${JSON.stringify(input)}\n`);
  const replaced = runCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(JSON.parse(replaced.stdout).outcome, 'replaced');

  const listed = runCli(['run', 'adapter', 'list', '--json'], repoRoot);
  assert.equal(listed.status, 0, listed.stderr);
  const list = JSON.parse(listed.stdout);
  assert.equal(list.adapters.length, 1);
  assert.equal(list.adapters[0].adapter_kind, 'scripted');
  assert.equal(list.adapters[0].launch_kind, 'existing_endpoint');
  assert.equal(list.adapters[0].endpoint, input.endpoint);
  assert.equal(selfDigest(list, 'result_digest'), list.result_digest);
});

test('host binary登録はbinary/config/capabilities/self digestをCLI側で導出する', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-adapter-host-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = await realpath(temporaryRoot);
  const binaryPath = path.join(repoRoot, 'controller-host');
  const configPath = path.join(repoRoot, 'adapter-config.json');
  const binaryBytes = Buffer.from('#!/bin/sh\nexit 17\n');
  const configBytes = Buffer.from('{"mode":"test"}\n');
  await writeFile(binaryPath, binaryBytes);
  await chmod(binaryPath, 0o700);
  await writeFile(configPath, configBytes);
  const input = {
    schema: SCHEMA_TITLE,
    adapter_kind: 'isolated-worktree',
    launch_kind: 'host_binary',
    binary_path: binaryPath,
    argv: ['--fixture'],
    config_ref: 'adapter-config.json',
    host_driven_epoch: true,
  };
  const result = await registerRuntimeAdapter({
    repoRoot,
    input,
    binaryIdentityObserver: async () => {
      throw new Error('fixture identity observer unavailable');
    },
  });
  assert.equal(result.binary_identity_observation.status, 'not_observed');
  assert.ok(['identity_observation_failed', 'platform_not_darwin'].includes(
    result.binary_identity_observation.reason,
  ));
  const descriptor = JSON.parse(await readFile(path.join(
    repoRoot,
    '.lattice/runtime/adapter-registry/descriptors/isolated-worktree.json',
  )));
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(descriptor.binary_digest, sha256(binaryBytes));
  assert.equal(descriptor.config_digest, sha256(configBytes));
  const capabilities = {
    schema: 'lattice.runtime_adapter_capabilities.v2',
    operations: ['dispatch', 'observe', 'inventory', 'barrier', 'rebind', 'prepare',
      'activate', 'release', 'revoke'],
    process_observation: true,
    worktree_fingerprint: true,
    staged_write_lease: true,
    durable_dispatch: true,
    host_driven_epoch: true,
    capabilities_digest: '',
  };
  capabilities.capabilities_digest = selfDigest(capabilities, 'capabilities_digest');
  assert.equal(descriptor.capabilities_digest, capabilities.capabilities_digest);
  assert.equal(descriptor.binary_identity, null);
  assert.equal(validateAdapterLaunchDescriptor(descriptor), true);
});

test('不正入力と壊れたregistryを空成功へ丸めずdetail付きtyped errorにする', async (t) => {
  const { temporaryRoot, repoRoot } = await createGitRepo('lattice-adapter-invalid-');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const inputPath = path.join(repoRoot, 'invalid.json');
  await writeFile(inputPath, `${JSON.stringify({
    schema: SCHEMA_TITLE,
    adapter_kind: 'scripted',
    launch_kind: 'existing_endpoint',
    endpoint: '/tmp/controller.sock',
    host_driven_epoch: false,
    descriptor_digest: '0'.repeat(64),
  })}\n`);
  const invalid = runCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot);
  assert.equal(invalid.status, 1);
  const invalidError = JSON.parse(invalid.stderr);
  assert.equal(invalidError.schema, 'lattice.cli_error.v2');
  assert.equal(invalidError.code, 'INVALID_ADAPTER_REGISTRATION_INPUT');
  assert.equal(invalidError.detail.reason, 'unexpected_or_missing_keys');

  // activateはendpointへ絶対pathを要求する。登録時点で確定する条件を揃え、
  // 「登録できたのにactivateできない」descriptorを作らせない（契約分裂の回帰）。
  await writeFile(inputPath, `${JSON.stringify({
    schema: SCHEMA_TITLE,
    adapter_kind: 'scripted',
    launch_kind: 'existing_endpoint',
    endpoint: 'supervisor/adapters/scripted.sock',
    host_driven_epoch: false,
  })}\n`);
  const relativeEndpoint = runCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot);
  assert.equal(relativeEndpoint.status, 1);
  const relativeError = JSON.parse(relativeEndpoint.stderr);
  assert.equal(relativeError.code, 'INVALID_ADAPTER_REGISTRATION_INPUT');
  assert.equal(relativeError.detail.reason, 'endpoint_must_be_absolute');
  assert.equal(relativeError.detail.path, '/endpoint');

  for (const hostDrivenEpoch of [undefined, 'true']) {
    const value = {
      schema: SCHEMA_TITLE,
      adapter_kind: 'scripted',
      launch_kind: 'existing_endpoint',
      endpoint: '/tmp/controller.sock',
    };
    if (hostDrivenEpoch !== undefined) value.host_driven_epoch = hostDrivenEpoch;
    await writeFile(inputPath, `${JSON.stringify(value)}\n`);
    const rejected = runCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot);
    assert.equal(rejected.status, 1);
    const error = JSON.parse(rejected.stderr);
    assert.equal(error.code, 'INVALID_ADAPTER_REGISTRATION_INPUT');
    assert.equal(error.detail.path, '/host_driven_epoch');
  }

  await writeFile(inputPath, '{broken-json\n');
  const invalidJson = runCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot);
  assert.equal(invalidJson.status, 1);
  const invalidJsonError = JSON.parse(invalidJson.stderr);
  assert.equal(invalidJsonError.code, 'INVALID_JSON');
  assert.deepEqual(invalidJsonError.detail, {
    path: inputPath,
    reason: 'invalid_json',
  });

  const registryDir = path.join(repoRoot, '.lattice/runtime/adapter-registry');
  await mkdir(registryDir, { recursive: true });
  await writeFile(path.join(registryDir, 'registry.json'), '{}\n');
  const listed = runCli(['run', 'adapter', 'list', '--json'], repoRoot);
  assert.equal(listed.status, 1);
  assert.equal(listed.stdout, '');
  const listError = JSON.parse(listed.stderr);
  assert.equal(listError.code, 'ADAPTER_REGISTRY_INVALID');
  assert.equal(listError.detail.reason, 'contract_violation');
});
