#!/usr/bin/env node

import { readBridgeConfig } from '../src/bridge-config.mjs';
import {
  readBridgeStopRequest, removeBridgeDaemonActiveMarker, removeBridgeDaemonDescriptor,
  writeBridgeDaemonDescriptor, writeBridgeStopReceipt,
} from '../src/bridge-daemon.mjs';
import { createBridgeHubHeartbeatController } from '../src/bridge-hub-heartbeat.mjs';
import { bridgeRuntimeController } from '../src/bridge-server.mjs';

const env = process.env;
const hubHeartbeat = createBridgeHubHeartbeatController({ env });
const instanceToken = env.LATTICE_BRIDGE_INSTANCE_TOKEN;
if (typeof instanceToken !== 'string' || !/^[0-9a-f]{64}$/u.test(instanceToken)) {
  process.stderr.write(`${JSON.stringify({ schema: 'lattice.bridge_daemon_error.v1',
    code: 'BRIDGE_INSTANCE_TOKEN_INVALID', message: 'bridge instance token is invalid' })}\n`);
  process.exit(1);
}
const controller = bridgeRuntimeController({ env, instanceToken });
let timer;
let closing = false;
let descriptorFingerprint = null;
let checking = false;
let failClosedError = null;
let hubHeartbeatError = null;
const close = async () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await controller.close();
};

try {
  const stopRequest = await readBridgeStopRequest({ env });
  if (stopRequest !== null) {
    await writeBridgeStopReceipt({ nonce: stopRequest.nonce, env });
    await removeBridgeDaemonDescriptor({ env });
    await removeBridgeDaemonActiveMarker({ env });
    process.exit(0);
  }
  const config = await readBridgeConfig({ env });
  if (config === null || !config.enabled) throw Object.assign(new Error('bridge disabled'), { code: 'BRIDGE_DISABLED' });
  await controller.reconcile();
  await writeBridgeDaemonDescriptor({ config, env });
  descriptorFingerprint = config.updated_at;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ schema: 'lattice.bridge_daemon_error.v1',
    code: error?.code ?? 'BRIDGE_DAEMON_FAILED', message: error?.message ?? 'bridge daemon failed' })}\n`);
  process.exit(1);
}

timer = setInterval(async () => {
  if (checking || closing) return;
  checking = true;
  try {
    const stopRequest = await readBridgeStopRequest({ env });
    if (stopRequest !== null) {
      await close();
      await writeBridgeStopReceipt({ nonce: stopRequest.nonce, env });
      await removeBridgeDaemonDescriptor({ env });
      await removeBridgeDaemonActiveMarker({ env });
      process.exit(0);
    }
    const config = await readBridgeConfig({ env });
    if (config === null || !config.enabled) {
      await close();
      await removeBridgeDaemonDescriptor({ env });
      await removeBridgeDaemonActiveMarker({ env });
      process.exit(0);
    }
    await controller.reconcile();
    failClosedError = null;
    if (descriptorFingerprint !== config.updated_at) {
      await writeBridgeDaemonDescriptor({ config, env });
      descriptorFingerprint = config.updated_at;
    }
    // Hub heartbeat failures are reported but never fail-close local traffic:
    // an unreachable hub is a routing problem for the hub's aggregate view,
    // not a reason to stop serving this terminal's own dashboard directly.
    // Network/hub-rejection failures already come back as typed results, not
    // throws (sendBridgeHubHeartbeat's contract) — only a local error (e.g.
    // the terminal identity file) reaches this catch.
    try {
      const heartbeat = await hubHeartbeat.tick({ config });
      hubHeartbeatError = null;
      if (heartbeat?.state === 'unreachable' || heartbeat?.state === 'rejected') {
        const fingerprint = JSON.stringify(heartbeat);
        if (fingerprint !== hubHeartbeatError) process.stderr.write(`${fingerprint}\n`);
        hubHeartbeatError = fingerprint;
      }
    } catch (error) {
      const failure = { schema: 'lattice.bridge_daemon_error.v1',
        code: error?.code ?? 'BRIDGE_HUB_HEARTBEAT_FAILED',
        message: error?.message ?? 'bridge hub heartbeat failed' };
      const fingerprint = JSON.stringify(failure);
      if (fingerprint !== hubHeartbeatError) process.stderr.write(`${fingerprint}\n`);
      hubHeartbeatError = fingerprint;
    }
  } catch (error) {
    const failure = { schema: 'lattice.bridge_daemon_error.v1',
      code: error?.code ?? 'BRIDGE_RECONCILE_FAILED',
      message: error?.message ?? 'bridge reconcile failed' };
    const fingerprint = JSON.stringify(failure);
    if (fingerprint !== failClosedError) process.stderr.write(`${fingerprint}\n`);
    failClosedError = fingerprint;
    // Public traffic fails closed immediately. Keep only the local control loop alive so an
    // authenticated nonce stop request can still receive a socket-closed receipt.
    await controller.close();
  } finally { checking = false; }
}, 250);
process.once('SIGINT', () => close().finally(() => process.exit(0)));
process.once('SIGTERM', () => close().finally(() => process.exit(0)));
