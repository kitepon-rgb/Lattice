import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, open, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

import {
  BRIDGE_PORT_MAX, BRIDGE_PORT_MIN, BridgeConfigError, bridgeConfigPaths, readBridgeConfig,
} from './bridge-config.mjs';

const DESCRIPTOR_SCHEMA = 'lattice.bridge_daemon.v1';
const START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 3_000;
const STOP_REQUEST_SCHEMA = 'lattice.bridge_stop_request.v1';
const STOP_RECEIPT_SCHEMA = 'lattice.bridge_stop_receipt.v1';
const ACTIVE_MARKER_SCHEMA = 'lattice.bridge_daemon_active.v1';
const CONTROL_MAX_BYTES = 65_536;

export function bridgeDaemonDescriptorPath(env = process.env) {
  return path.join(bridgeConfigPaths(env).root, 'bridge-daemon.json');
}

export function bridgeDaemonActiveMarkerPath(env = process.env) {
  return path.join(bridgeConfigPaths(env).root, 'bridge-daemon-active.json');
}

function bridgeStopPaths(env) {
  const root = bridgeConfigPaths(env).root;
  return { request: path.join(root, 'bridge-stop-request.json'),
    receipt: path.join(root, 'bridge-stop-receipt.json') };
}

export async function removeBridgeDaemonDescriptor({ env = process.env } = {}) {
  await rm(bridgeDaemonDescriptorPath(env), { force: true });
}

export async function removeBridgeDaemonActiveMarker({ env = process.env } = {}) {
  await rm(bridgeDaemonActiveMarkerPath(env), { force: true });
}

async function atomicDescriptor(ref, value) {
  const temporary = `${ref}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, ref);
    await chmod(ref, 0o600);
  } finally { await rm(temporary, { force: true }); }
}

function duplicateJsonKey(node) {
  if (node?.type === 'object') {
    const keys = new Set();
    for (const property of node.children ?? []) {
      const [key, child] = property.children ?? [];
      if (keys.has(key?.value) || duplicateJsonKey(child)) return true;
      keys.add(key?.value);
    }
  } else if (node?.type === 'array') return (node.children ?? []).some(duplicateJsonKey);
  return false;
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

async function readStrictJson(ref, code, label) {
  let before;
  let handle;
  try {
    before = await lstat(ref);
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
      || before.size > CONTROL_MAX_BYTES) throw new Error(`${label} unsafe`);
    handle = await open(ref, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.size > CONTROL_MAX_BYTES) {
      throw new Error(`${label} changed during validation`);
    }
    const text = await handle.readFile('utf8');
    const after = await lstat(ref);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new Error(`${label} changed during read`);
    }
    const errors = [];
    const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
    if (errors.length > 0 || tree === undefined || duplicateJsonKey(tree)) {
      throw new Error(`${label} JSON invalid`);
    }
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === 'ENOENT' && before === undefined) return null;
    throw new BridgeConfigError(code, `${label} invalid`, undefined, error);
  } finally { await handle?.close(); }
}

async function readStrictControl(ref, schema, keys) {
  const value = await readStrictJson(ref, 'BRIDGE_STOP_CONTROL_INVALID', 'bridge stop control');
  if (value === null) return null;
  const timestampKey = keys.find((key) => key.endsWith('_at'));
  if (value?.schema !== schema || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
    || keys.includes('nonce')
      && (typeof value.nonce !== 'string' || !/^[0-9a-f]{64}$/u.test(value.nonce))
    || keys.includes('address') && isIP(value.address) === 0
    || keys.includes('port')
      && (!Number.isSafeInteger(value.port) || value.port < BRIDGE_PORT_MIN || value.port > BRIDGE_PORT_MAX)
    || timestampKey === undefined || !isIsoTimestamp(value[timestampKey])) {
    throw new BridgeConfigError('BRIDGE_STOP_CONTROL_INVALID', 'bridge stop control schema invalid');
  }
  return value;
}

async function readBridgeDaemonActiveMarker(env) {
  return (await readStrictControl(bridgeDaemonActiveMarkerPath(env), ACTIVE_MARKER_SCHEMA,
    ['schema', 'address', 'port', 'started_at']));
}

export async function readBridgeStopRequest({ env = process.env } = {}) {
  return readStrictControl(bridgeStopPaths(env).request, STOP_REQUEST_SCHEMA,
    ['schema', 'nonce', 'requested_at']);
}

export async function writeBridgeStopReceipt({ nonce, env = process.env }) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{64}$/u.test(nonce)) {
    throw new BridgeConfigError('BRIDGE_STOP_CONTROL_INVALID', 'bridge stop nonce invalid');
  }
  await atomicDescriptor(bridgeStopPaths(env).receipt, {
    schema: STOP_RECEIPT_SCHEMA, nonce, stopped_at: new Date().toISOString(),
  });
}

export async function clearBridgeStopControl({ env = process.env } = {}) {
  const refs = bridgeStopPaths(env);
  await rm(refs.request, { force: true });
  await rm(refs.receipt, { force: true });
}

export async function requestBridgeDaemonStop({ env = process.env, listen = null } = {}) {
  let descriptor = null;
  try { descriptor = await readBridgeDaemonDescriptor({ env }); } catch {}
  if (descriptor === null) {
    const refs = bridgeStopPaths(env);
    let descriptorExists = true;
    try { await lstat(bridgeDaemonDescriptorPath(env)); } catch (error) {
      if (error?.code === 'ENOENT') descriptorExists = false;
    }
    let activeMarker;
    let activeMarkerInvalid = false;
    try { activeMarker = await readBridgeDaemonActiveMarker(env); } catch (error) {
      if (error?.code !== 'BRIDGE_STOP_CONTROL_INVALID') throw error;
      activeMarkerInvalid = true;
      activeMarker = null;
    }
    if (!descriptorExists) {
      const witnessedListen = activeMarker === null ? listen : activeMarker;
      if (!activeMarkerInvalid
        && (witnessedListen === null || !await bridgeEndpointAvailable(witnessedListen))) {
        return { state: 'not_running', nonce: null };
      }
    }
  }
  const refs = bridgeStopPaths(env);
  const nonce = randomBytes(32).toString('hex');
  await rm(refs.receipt, { force: true });
  await atomicDescriptor(refs.request, {
    schema: STOP_REQUEST_SCHEMA, nonce, requested_at: new Date().toISOString(),
  });
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const receipt = await readStrictControl(refs.receipt, STOP_RECEIPT_SCHEMA,
      ['schema', 'nonce', 'stopped_at']);
    if (receipt?.nonce === nonce) return { state: 'stopped', nonce };
  }
  throw new BridgeConfigError('BRIDGE_DAEMON_STOP_FAILED', 'bridge daemon stop receipt timed out');
}

export async function writeBridgeDaemonDescriptor({ config, env = process.env }) {
  const instanceToken = env.LATTICE_BRIDGE_INSTANCE_TOKEN;
  if (typeof instanceToken !== 'string' || !/^[0-9a-f]{64}$/u.test(instanceToken)) {
    throw new BridgeConfigError('BRIDGE_INSTANCE_TOKEN_INVALID', 'bridge instance token is invalid');
  }
  const descriptor = { schema: DESCRIPTOR_SCHEMA, pid: process.pid,
    address: config.listen.address, port: config.listen.port,
    config_updated_at: config.updated_at, instance_token: instanceToken,
    started_at: new Date().toISOString() };
  await atomicDescriptor(bridgeDaemonDescriptorPath(env), descriptor);
  await atomicDescriptor(bridgeDaemonActiveMarkerPath(env), {
    schema: ACTIVE_MARKER_SCHEMA, address: descriptor.address, port: descriptor.port,
    started_at: descriptor.started_at,
  });
  return descriptor;
}

export async function readBridgeDaemonDescriptor({ env = process.env } = {}) {
  const value = await readStrictJson(bridgeDaemonDescriptorPath(env),
    'BRIDGE_DAEMON_DESCRIPTOR_INVALID', 'bridge daemon descriptor');
  if (value === null) return null;
  if (value?.schema !== DESCRIPTOR_SCHEMA || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || typeof value.address !== 'string' || isIP(value.address) === 0
    || !Number.isSafeInteger(value.port) || value.port < BRIDGE_PORT_MIN || value.port > BRIDGE_PORT_MAX
    || !isIsoTimestamp(value.config_updated_at) || !isIsoTimestamp(value.started_at)
    || typeof value.instance_token !== 'string' || !/^[0-9a-f]{64}$/u.test(value.instance_token)
    || Object.keys(value).sort().join(',')
      !== 'address,config_updated_at,instance_token,pid,port,schema,started_at') {
    throw new BridgeConfigError('BRIDGE_DAEMON_DESCRIPTOR_INVALID', 'bridge daemon descriptor schema invalid');
  }
  return value;
}

function healthHost(address) {
  if (address === '0.0.0.0') return '127.0.0.1';
  if (address === '::') return '[::1]';
  return address.includes(':') ? `[${address}]` : address;
}

async function bridgeEndpointAvailable(listen) {
  try {
    const response = await fetch(`http://${healthHost(listen.address)}:${listen.port}/__lattice/bridge-health`,
      { signal: AbortSignal.timeout(300) });
    const body = response.status === 200 ? await response.json() : null;
    return body?.schema === 'lattice.bridge_health.v1';
  } catch { return false; }
}

export async function waitForBridgeSocketClose({ listen, timeoutMs = STOP_TIMEOUT_MS } = {}) {
  if (listen === null || typeof listen !== 'object') throw new TypeError('bridge listen required');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await bridgeEndpointAvailable(listen)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !await bridgeEndpointAvailable(listen);
}

async function attest(descriptor) {
  if (descriptor === null) return null;
  try {
    const response = await fetch(`http://${healthHost(descriptor.address)}:${descriptor.port}/__lattice/bridge-health`, {
      headers: { 'x-lattice-bridge-instance-token': descriptor.instance_token },
      signal: AbortSignal.timeout(400),
    });
    if (response.status !== 200) return null;
    const body = await response.json();
    return body?.schema === 'lattice.bridge_health.v1' && body.pid === descriptor.pid ? body : null;
  } catch { return null; }
}

async function healthy(descriptor, config) {
  if (descriptor === null || descriptor.address !== config.listen.address
    || descriptor.port !== config.listen.port) return false;
  const body = await attest(descriptor);
  return body !== null && body.updated_at === config.updated_at;
}

export async function ensureBridgeDaemon({ env = process.env } = {}) {
  const config = await readBridgeConfig({ env });
  if (config === null || !config.enabled) throw new BridgeConfigError('BRIDGE_DISABLED', 'bridge is disabled');
  const previous = await readBridgeDaemonDescriptor({ env });
  if (await healthy(previous, config)) return previous;
  const instanceToken = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../bin/lattice-bridge.mjs')], {
    detached: true, stdio: 'ignore', env: { ...env, LATTICE_BRIDGE_INSTANCE_TOKEN: instanceToken },
  });
  child.unref();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const descriptor = await readBridgeDaemonDescriptor({ env });
    if (await healthy(descriptor, config)) {
      if (previous !== null && previous.pid !== descriptor.pid) {
        if (await attest(previous) !== null) {
          try { process.kill(previous.pid, 'SIGTERM'); } catch {}
        }
      }
      return descriptor;
    }
  }
  throw new BridgeConfigError('BRIDGE_DAEMON_UNAVAILABLE', 'bridge daemon did not bind and become healthy');
}

export async function stopBridgeDaemon({ env = process.env } = {}) {
  const descriptor = await readBridgeDaemonDescriptor({ env });
  if (descriptor === null) return null;
  if (await attest(descriptor) === null) {
    let alive = true;
    try { process.kill(descriptor.pid, 0); } catch { alive = false; }
    if (!alive) {
      await rm(bridgeDaemonDescriptorPath(env), { force: true });
      await removeBridgeDaemonActiveMarker({ env });
      return descriptor;
    }
    throw new BridgeConfigError('BRIDGE_DAEMON_ATTESTATION_FAILED',
      'bridge daemon identity could not be attested; refusing to signal descriptor PID');
  }
  try { process.kill(descriptor.pid, 'SIGTERM'); } catch (error) {
    if (error?.code !== 'ESRCH') throw new BridgeConfigError('BRIDGE_DAEMON_STOP_FAILED', 'bridge daemon signal failed');
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let alive = true;
    try { process.kill(descriptor.pid, 0); } catch { alive = false; }
    if (!alive) {
      await rm(bridgeDaemonDescriptorPath(env), { force: true });
      await removeBridgeDaemonActiveMarker({ env });
      return descriptor;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new BridgeConfigError('BRIDGE_DAEMON_STOP_FAILED', 'bridge daemon did not stop');
}
