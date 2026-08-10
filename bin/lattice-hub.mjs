#!/usr/bin/env node
/**
 * bridge-hub server daemon entry point (bh5). Meant to run under systemd on a
 * fixed, non-DHCP server — unlike `lattice-bridge.mjs`, there is no address
 * reconciliation loop, health-attestation dance, or LaunchAgent coordination:
 * systemd is the single process supervisor, and the hub's own host does not
 * move. Configuration is environment-only (opt-in-via-environment, matching
 * `bridge-registrar.mjs`'s posture) rather than a persisted CLI-managed
 * config file, since this daemon has exactly one deployment target.
 */

import { isIP } from 'node:net';
import { startBridgeHubServer } from '../src/bridge-hub-server.mjs';

const env = process.env;

function fail(code, message) {
  process.stderr.write(`${JSON.stringify({ schema: 'lattice.hub_daemon_error.v1', code, message })}\n`);
  process.exit(1);
}

// Defaults to loopback (bh2's original behavior) for local/dev use. Production
// deployment sets this explicitly — see src/bridge-hub-server.mjs's
// `listenAddress` doc comment for why a Docker-networked Caddy needs this to
// be the host's docker-bridge gateway address rather than 127.0.0.1.
const listenAddress = env.LATTICE_HUB_LISTEN ?? '127.0.0.1';
if (isIP(listenAddress) === 0) fail('LATTICE_HUB_LISTEN_INVALID', 'LATTICE_HUB_LISTEN must be an IP literal');

// No default port: an ephemeral (port 0) hub would give Caddy a moving
// upstream target every restart, defeating the point of a fixed endpoint.
const portValue = env.LATTICE_HUB_PORT;
if (typeof portValue !== 'string' || portValue.length === 0) {
  fail('LATTICE_HUB_PORT_REQUIRED', 'LATTICE_HUB_PORT must be set to a fixed port (Caddy needs a stable upstream)');
}
const port = Number(portValue);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  fail('LATTICE_HUB_PORT_INVALID', 'LATTICE_HUB_PORT must be an integer in 1..65535');
}

const allowedHostsValue = env.LATTICE_HUB_ALLOWED_HOSTS ?? '';
const allowedHosts = new Set(allowedHostsValue.split(',').map((host) => host.trim()).filter((host) => host.length > 0));
if (allowedHosts.size === 0) {
  fail('LATTICE_HUB_ALLOWED_HOSTS_REQUIRED',
    'LATTICE_HUB_ALLOWED_HOSTS must list at least one allowed Host (comma-separated), e.g. lattice.kitepon.dev');
}

let hub;
try {
  hub = await startBridgeHubServer({ port, allowedHosts, listenAddress, env });
} catch (error) {
  fail(error?.code ?? 'BRIDGE_HUB_START_FAILED', error?.message ?? 'bridge hub server failed to start');
}

process.stdout.write(`${JSON.stringify({
  schema: 'lattice.hub_daemon_started.v1', host: hub.host, port: hub.port,
  allowed_hosts: [...allowedHosts].sort((left, right) => left.localeCompare(right, 'en')),
})}\n`);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await hub.close();
};
// systemd sends SIGTERM on stop/restart; ExecStop is unnecessary with this handler.
process.once('SIGINT', () => close().finally(() => process.exit(0)));
process.once('SIGTERM', () => close().finally(() => process.exit(0)));
