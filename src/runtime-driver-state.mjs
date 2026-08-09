import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { canonicalizeArtifact } from './artifact-contracts.mjs';
import { selfDigest } from './runtime-contracts.mjs';

const DRIVER_STATE_SCHEMA = 'lattice.runtime_driver_state.v1';
const DIGEST = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;
const DESCRIPTOR_REF = /^supervisor\/(?:descriptor\.json|restart-candidates\/[0-9a-f]{64}\/descriptor\.json)$/u;
const WAIT_KINDS = new Set(['frontier_dispatch', 'executor_completion']);
const MAX_STATE_BYTES = 65_536;

export class RuntimeDriverStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeDriverStateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuntimeDriverStateError(code, message);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  return plain(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function validWaitingOn(value) {
  return exact(value, ['kind', 'todo_ids'])
    && WAIT_KINDS.has(value.kind)
    && Array.isArray(value.todo_ids)
    && value.todo_ids.length > 0
    && value.todo_ids.length <= 256
    && value.todo_ids.every((todoId) => IDENTIFIER.test(todoId))
    && value.todo_ids.every((todoId, index) => index === 0 || value.todo_ids[index - 1] < todoId);
}

export function validateRuntimeDriverState(value) {
  if (!exact(value, [
    'schema',
    'run_id',
    'supervisor_descriptor_ref',
    'supervisor_descriptor_digest',
    'supervisor_process_start_identity_digest',
    'driver_state',
    'waiting_on',
    'updated_at',
    'state_digest',
  ])
    || value.schema !== DRIVER_STATE_SCHEMA
    || !IDENTIFIER.test(value.run_id ?? '')
    || !DESCRIPTOR_REF.test(value.supervisor_descriptor_ref ?? '')
    || !DIGEST.test(value.supervisor_descriptor_digest ?? '')
    || !DIGEST.test(value.supervisor_process_start_identity_digest ?? '')
    || !['driving', 'stopped'].includes(value.driver_state)
    || typeof value.updated_at !== 'string'
    || Number.isNaN(Date.parse(value.updated_at))
    || !DIGEST.test(value.state_digest ?? '')
    || value.state_digest !== selfDigest(value, 'state_digest')) return false;
  return value.driver_state === 'stopped'
    ? value.waiting_on === null
    : validWaitingOn(value.waiting_on);
}

function statePath(runDir) {
  return path.join(runDir, 'supervisor', 'driver-state.json');
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function replaceRuntimeDriverState({
  runDir,
  runId,
  supervisorDescriptorRef,
  supervisorDescriptorDigest,
  supervisorProcessStartIdentityDigest,
  driverState,
  waitingOn,
  updatedAt,
} = {}) {
  if (typeof runDir !== 'string' || runDir.length === 0) {
    throw new TypeError('runDirが不正');
  }
  const state = {
    schema: DRIVER_STATE_SCHEMA,
    run_id: runId,
    supervisor_descriptor_ref: supervisorDescriptorRef,
    supervisor_descriptor_digest: supervisorDescriptorDigest,
    supervisor_process_start_identity_digest: supervisorProcessStartIdentityDigest,
    driver_state: driverState,
    waiting_on: waitingOn === null ? null : structuredClone(waitingOn),
    updated_at: updatedAt,
    state_digest: '',
  };
  state.state_digest = selfDigest(state, 'state_digest');
  if (!validateRuntimeDriverState(state)) throw new TypeError('runtime driver state入力が不正');

  const supervisorDir = path.join(runDir, 'supervisor');
  await mkdir(supervisorDir, { recursive: true, mode: 0o700 });
  const target = statePath(runDir);
  const temporary = path.join(supervisorDir, `.driver-state-${process.pid}-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${canonicalizeArtifact(state)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    await fsyncDirectory(supervisorDir);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return state;
}

export async function readRuntimeDriverState({ runDir } = {}) {
  if (typeof runDir !== 'string' || runDir.length === 0) {
    throw new TypeError('runDirが不正');
  }
  const target = statePath(runDir);
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('INVALID_RUN_STORE', 'driver stateを読めない');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) {
    fail('INVALID_RUN_STORE', 'driver stateが安全なbounded regular fileでない');
  }
  let bytes;
  let value;
  try {
    bytes = await readFile(target);
    value = JSON.parse(bytes);
  } catch {
    fail('INVALID_RUN_STORE', 'driver stateがJSONとして不正');
  }
  if (bytes.toString('utf8') !== `${canonicalizeArtifact(value)}\n`
    || !validateRuntimeDriverState(value)) {
    fail('INVALID_RUN_STORE', 'driver stateのschemaまたはcanonical bytesが不正');
  }
  return value;
}
