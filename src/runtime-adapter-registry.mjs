import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import { canonicalizeArtifact } from './artifact-contracts.mjs';
import {
  CONTROLLER_OPERATIONS,
  validateAdapterLaunchDescriptor,
  validateAdapterRegistry,
  validateRuntimeAdapterCapabilities,
} from './runtime-controller-protocol.mjs';
import { selfDigest } from './runtime-contracts.mjs';
import { observeMacosBinaryIdentity } from './runtime-managed-supervisor.mjs';

const INPUT_SCHEMA = 'lattice.runtime_adapter_registration_input.v2';
const LEGACY_INPUT_SCHEMA = 'lattice.runtime_adapter_registration_input.v1';
const REGISTRY_SCHEMA = 'lattice.runtime_adapter_registry.v1';
const DESCRIPTOR_SCHEMA = 'lattice.runtime_adapter_launch_descriptor.v1';
const REGISTRY_REF = '.lattice/runtime/adapter-registry/registry.json';
const DESCRIPTOR_ROOT_REF = '.lattice/runtime/adapter-registry/descriptors';
const ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;

export class AdapterRegistryError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'AdapterRegistryError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new AdapterRegistryError(code, message, detail);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function inputFailure(reason, inputPath = '') {
  fail(
    'INVALID_ADAPTER_REGISTRATION_INPUT',
    'adapter registration inputが公開契約を満たさない',
    { reason, path: inputPath },
  );
}

function validateRegistrationInput(value) {
  if (!plain(value)) inputFailure('input_must_be_object');
  if (![LEGACY_INPUT_SCHEMA, INPUT_SCHEMA].includes(value.schema)) {
    inputFailure('unsupported_schema', '/schema');
  }
  if (!ID.test(value.adapter_kind ?? '')) inputFailure('invalid_adapter_kind', '/adapter_kind');
  const hostDrivenFields = value.schema === INPUT_SCHEMA ? ['host_driven_epoch'] : [];
  if (value.schema === INPUT_SCHEMA && typeof value.host_driven_epoch !== 'boolean') {
    inputFailure('host_driven_epoch_must_be_boolean', '/host_driven_epoch');
  }
  if (value.launch_kind === 'host_binary') {
    if (!exact(value, ['schema', 'adapter_kind', 'launch_kind', 'binary_path', 'argv',
      'config_ref', ...hostDrivenFields])) {
      inputFailure('unexpected_or_missing_keys');
    }
    if (typeof value.binary_path !== 'string' || !path.isAbsolute(value.binary_path)) {
      inputFailure('binary_path_must_be_absolute', '/binary_path');
    }
    if (!Array.isArray(value.argv) || value.argv.length > 64
      || !value.argv.every((arg) => typeof arg === 'string' && !arg.includes('\0'))) {
      inputFailure('invalid_argv', '/argv');
    }
    if (typeof value.config_ref !== 'string' || value.config_ref.length === 0) {
      inputFailure('invalid_config_ref', '/config_ref');
    }
    return;
  }
  if (value.launch_kind === 'existing_endpoint') {
    if (!exact(value, ['schema', 'adapter_kind', 'launch_kind', 'endpoint',
      ...hostDrivenFields])) {
      inputFailure('unexpected_or_missing_keys');
    }
    if (typeof value.endpoint !== 'string' || value.endpoint.length === 0) {
      inputFailure('invalid_endpoint', '/endpoint');
    }
    // activateはendpointへ絶対pathを要求する（ADAPTER_LAUNCH_INVALID）。登録時点で
    // 確定する条件をここで揃え、「登録できたのにactivateできない」descriptorを作らせない。
    // 親directoryがcanonicalかはactivate時にしか判定できないため、そこは動的検査へ残す。
    if (!path.isAbsolute(value.endpoint)) {
      inputFailure('endpoint_must_be_absolute', '/endpoint');
    }
    return;
  }
  inputFailure('unsupported_launch_kind', '/launch_kind');
}

function createCapabilities(input = { schema: LEGACY_INPUT_SCHEMA }) {
  const capabilities = {
    schema: input.schema === INPUT_SCHEMA
      ? 'lattice.runtime_adapter_capabilities.v2'
      : 'lattice.runtime_adapter_capabilities.v1',
    operations: [...CONTROLLER_OPERATIONS],
    process_observation: true,
    worktree_fingerprint: true,
    staged_write_lease: true,
    durable_dispatch: true,
    capabilities_digest: '',
  };
  if (input.schema === INPUT_SCHEMA) {
    capabilities.host_driven_epoch = input.host_driven_epoch;
  }
  capabilities.capabilities_digest = selfDigest(capabilities, 'capabilities_digest');
  if (!validateRuntimeAdapterCapabilities(capabilities)) {
    throw new TypeError('runtime adapter capabilities生成不正');
  }
  return capabilities;
}

async function readCanonicalRegular(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw error;
    fail('ADAPTER_REGISTRY_INVALID', `${label}を読めない`, { path: filePath, reason: 'unreadable' });
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('ADAPTER_REGISTRY_INVALID', `${label}がregular fileではない`, {
      path: filePath,
      reason: 'not_regular_file',
    });
  }
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    fail('ADAPTER_REGISTRY_INVALID', `${label}を読めない`, { path: filePath, reason: 'unreadable' });
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('ADAPTER_REGISTRY_INVALID', `${label}がJSONとして不正`, {
      path: filePath,
      reason: 'invalid_json',
    });
  }
  if (bytes.toString('utf8') !== `${canonicalizeArtifact(value)}\n`) {
    fail('ADAPTER_REGISTRY_INVALID', `${label}がcanonical bytesではない`, {
      path: filePath,
      reason: 'noncanonical_bytes',
    });
  }
  return { value, bytes };
}

async function durableReplaceBytes(directory, name, bytes) {
  const temporaryPath = path.join(directory, `.${name}-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, path.join(directory, name));
    const directoryHandle = await open(directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function ensureRegistryDirectories(repoRoot) {
  const registryDir = path.join(repoRoot, '.lattice/runtime/adapter-registry');
  const descriptorDir = path.join(registryDir, 'descriptors');
  await mkdir(descriptorDir, { recursive: true, mode: 0o700 });
  for (const directory of [registryDir, descriptorDir]) {
    let observed;
    try {
      observed = await realpath(directory);
    } catch {
      fail('ADAPTER_REGISTRY_INVALID', 'adapter registry directoryを解決できない', {
        path: directory,
        reason: 'directory_unresolved',
      });
    }
    if (observed !== directory) {
      fail('ADAPTER_REGISTRY_INVALID', 'adapter registry directoryにsymlinkを使えない', {
        path: directory,
        reason: 'directory_not_canonical',
      });
    }
  }
  return { registryDir, descriptorDir };
}

async function acquireRegistryLock(registryDir) {
  const lockPath = path.join(registryDir, '.registry.lock');
  let handle;
  try {
    handle = await open(
      lockPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${process.pid}\n`);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === 'EEXIST') {
      fail('ADAPTER_REGISTRY_BUSY', 'adapter registryを別processが更新中', {
        path: lockPath,
        reason: 'lock_exists',
      });
    }
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true });
  };
}

async function readRegistry(repoRoot, { missingIsEmpty }) {
  const registryPath = path.join(repoRoot, REGISTRY_REF);
  let artifact;
  try {
    artifact = await readCanonicalRegular(registryPath, 'adapter registry');
  } catch (error) {
    if (error?.code === 'ENOENT' && missingIsEmpty) return null;
    if (error?.code === 'ENOENT') {
      fail('ADAPTER_REGISTRY_INVALID', 'adapter registryが存在しない', {
        path: registryPath,
        reason: 'missing',
      });
    }
    throw error;
  }
  if (!validateAdapterRegistry(artifact.value)) {
    fail('ADAPTER_REGISTRY_INVALID', 'adapter registry contract不正', {
      path: registryPath,
      reason: 'contract_violation',
    });
  }
  return artifact;
}

async function resolveHostBinary(repoRoot, input, binaryIdentityObserver) {
  let binaryInfo;
  try {
    binaryInfo = await lstat(input.binary_path);
  } catch {
    inputFailure('binary_unreadable', '/binary_path');
  }
  if (!binaryInfo.isFile() || binaryInfo.isSymbolicLink() || (binaryInfo.mode & 0o111) === 0) {
    inputFailure('binary_must_be_executable_regular_file', '/binary_path');
  }
  let binaryReal;
  try {
    binaryReal = await realpath(input.binary_path);
  } catch {
    inputFailure('binary_unreadable', '/binary_path');
  }
  if (binaryReal !== input.binary_path) {
    inputFailure('binary_path_must_be_canonical', '/binary_path');
  }

  const configPath = path.resolve(repoRoot, input.config_ref);
  if (!configPath.startsWith(`${repoRoot}${path.sep}`)) {
    inputFailure('config_ref_outside_repo', '/config_ref');
  }
  let configInfo;
  let configReal;
  try {
    [configInfo, configReal] = await Promise.all([lstat(configPath), realpath(configPath)]);
  } catch {
    inputFailure('config_unreadable', '/config_ref');
  }
  if (!configInfo.isFile() || configInfo.isSymbolicLink() || configReal !== configPath) {
    inputFailure('config_must_be_canonical_regular_file', '/config_ref');
  }

  let binaryIdentity = null;
  let observation;
  if (process.platform !== 'darwin') {
    observation = {
      status: 'not_observed',
      reason: 'platform_not_darwin',
      message: 'macOS binary identity観測はdarwin以外では利用できない',
    };
  } else {
    try {
      binaryIdentity = await binaryIdentityObserver(binaryReal);
      observation = { status: 'observed', reason: null, message: null };
    } catch (error) {
      observation = {
        status: 'not_observed',
        reason: 'identity_observation_failed',
        message: error?.message ?? 'macOS binary identity観測に失敗した',
      };
    }
  }

  return {
    binaryPath: binaryReal,
    binaryDigest: sha256Bytes(await readFile(binaryReal)),
    binaryIdentity,
    configDigest: sha256Bytes(await readFile(configReal)),
    observation,
  };
}

async function buildLaunchDescriptor(repoRoot, input, binaryIdentityObserver) {
  const capabilities = createCapabilities(input);
  let observation = { status: 'not_applicable', reason: null, message: null };
  let descriptor;
  if (input.launch_kind === 'host_binary') {
    const host = await resolveHostBinary(repoRoot, input, binaryIdentityObserver);
    observation = host.observation;
    descriptor = {
      schema: DESCRIPTOR_SCHEMA,
      adapter_kind: input.adapter_kind,
      launch_kind: input.launch_kind,
      binary_path: host.binaryPath,
      binary_digest: host.binaryDigest,
      binary_identity: host.binaryIdentity,
      argv: [...input.argv],
      config_ref: input.config_ref,
      config_digest: host.configDigest,
      endpoint: null,
      capabilities_digest: capabilities.capabilities_digest,
      descriptor_digest: '',
    };
  } else {
    descriptor = {
      schema: DESCRIPTOR_SCHEMA,
      adapter_kind: input.adapter_kind,
      launch_kind: input.launch_kind,
      binary_path: null,
      binary_digest: null,
      binary_identity: null,
      argv: [],
      config_ref: null,
      config_digest: null,
      endpoint: input.endpoint,
      capabilities_digest: capabilities.capabilities_digest,
      descriptor_digest: '',
    };
  }
  descriptor.descriptor_digest = selfDigest(descriptor, 'descriptor_digest');
  // 公開入力から導出した成果物も、activationと同じ正本validatorを通過した時だけ永続化する。
  if (!validateAdapterLaunchDescriptor(descriptor)) {
    throw new TypeError('adapter launch descriptor生成不正');
  }
  return { descriptor, observation };
}

export async function registerRuntimeAdapter({
  repoRoot,
  input,
  binaryIdentityObserver = observeMacosBinaryIdentity,
}) {
  const canonicalRepo = await realpath(repoRoot);
  validateRegistrationInput(input);
  const { descriptor, observation } = await buildLaunchDescriptor(
    canonicalRepo,
    input,
    binaryIdentityObserver,
  );
  const { registryDir, descriptorDir } = await ensureRegistryDirectories(canonicalRepo);
  const releaseLock = await acquireRegistryLock(registryDir);
  try {
    const current = await readRegistry(canonicalRepo, { missingIsEmpty: true });
    const existing = current?.value.entries.find(
      (entry) => entry.adapter_kind === input.adapter_kind,
    );
    const descriptorRef = `${DESCRIPTOR_ROOT_REF}/${input.adapter_kind}.json`;
    const entry = {
      adapter_kind: input.adapter_kind,
      launch_descriptor_ref: descriptorRef,
      launch_descriptor_digest: descriptor.descriptor_digest,
    };
    const entries = [
      ...(current?.value.entries ?? []).filter(
        (candidate) => candidate.adapter_kind !== input.adapter_kind,
      ),
      entry,
    ].sort((left, right) => (
      left.adapter_kind < right.adapter_kind ? -1 : left.adapter_kind > right.adapter_kind ? 1 : 0
    ));
    if (entries.length > 256) {
      fail('ADAPTER_REGISTRY_LIMIT_EXCEEDED', 'adapter registryは256件を超えられない', {
        limit: 256,
      });
    }
    const registry = { schema: REGISTRY_SCHEMA, entries, registry_digest: '' };
    registry.registry_digest = selfDigest(registry, 'registry_digest');
    if (!validateAdapterRegistry(registry)) throw new TypeError('adapter registry生成不正');

    await durableReplaceBytes(
      descriptorDir,
      `${input.adapter_kind}.json`,
      Buffer.from(`${canonicalizeArtifact(descriptor)}\n`),
    );
    await durableReplaceBytes(
      registryDir,
      'registry.json',
      Buffer.from(`${canonicalizeArtifact(registry)}\n`),
    );

    const result = {
      schema: 'lattice.runtime_adapter_register_result.v1',
      outcome: existing === undefined ? 'created' : 'replaced',
      adapter_kind: input.adapter_kind,
      launch_descriptor_ref: descriptorRef,
      launch_descriptor_digest: descriptor.descriptor_digest,
      registry_ref: REGISTRY_REF,
      registry_digest: registry.registry_digest,
      binary_identity_observation: observation,
      result_digest: '',
    };
    result.result_digest = selfDigest(result, 'result_digest');
    return result;
  } finally {
    await releaseLock();
  }
}

export async function listRuntimeAdapters({ repoRoot }) {
  const canonicalRepo = await realpath(repoRoot);
  const registryArtifact = await readRegistry(canonicalRepo, { missingIsEmpty: true });
  const adapters = [];
  for (const entry of registryArtifact?.value.entries ?? []) {
    const descriptorPath = path.join(canonicalRepo, entry.launch_descriptor_ref);
    if (!descriptorPath.startsWith(`${canonicalRepo}${path.sep}`)) {
      fail('ADAPTER_REGISTRY_INVALID', 'launch descriptorがrepo外を指す', {
        path: descriptorPath,
        reason: 'descriptor_outside_repo',
      });
    }
    let artifact;
    try {
      artifact = await readCanonicalRegular(descriptorPath, 'adapter launch descriptor');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        fail('ADAPTER_REGISTRY_INVALID', 'adapter launch descriptorが存在しない', {
          path: descriptorPath,
          reason: 'descriptor_missing',
        });
      }
      throw error;
    }
    const descriptor = artifact.value;
    if (!validateAdapterLaunchDescriptor(descriptor)
      || descriptor.adapter_kind !== entry.adapter_kind
      || descriptor.descriptor_digest !== entry.launch_descriptor_digest) {
      fail('ADAPTER_REGISTRY_INVALID', 'adapter launch descriptor binding不正', {
        path: descriptorPath,
        reason: 'descriptor_binding_invalid',
      });
    }
    adapters.push({
      adapter_kind: descriptor.adapter_kind,
      launch_kind: descriptor.launch_kind,
      launch_descriptor_ref: entry.launch_descriptor_ref,
      launch_descriptor_digest: descriptor.descriptor_digest,
      binary_path: descriptor.binary_path,
      binary_identity_observed: descriptor.binary_identity !== null,
      argv: [...descriptor.argv],
      config_ref: descriptor.config_ref,
      endpoint: descriptor.endpoint,
      capabilities_digest: descriptor.capabilities_digest,
    });
  }
  const result = {
    schema: 'lattice.runtime_adapter_list_result.v1',
    registry_ref: REGISTRY_REF,
    registry_digest: registryArtifact?.value.registry_digest ?? null,
    adapters,
    result_digest: '',
  };
  result.result_digest = selfDigest(result, 'result_digest');
  return result;
}

export const runtimeAdapterRegistryInternal = Object.freeze({
  INPUT_SCHEMA,
  REGISTRY_REF,
  validateRegistrationInput,
  createCapabilities,
});
