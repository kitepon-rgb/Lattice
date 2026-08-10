/**
 * Terminal-side bridge-hub heartbeat client (bh3).
 *
 * Wires the pure wire contract in `bridge-hub-protocol.mjs` (bh1) around this
 * terminal's own state: a persisted terminal identity, the locally active
 * project set (`todo-dashboard-registry.mjs`), and the configured hub origin
 * (`bridge-config.mjs`'s `hub` field). It sends `POST /__lattice/hub/register`
 * on `bridge-hub-server.mjs`'s (bh2) contract — the request body is the raw
 * `lattice.bridge_hub_registration_request.v1` object, unmodified in transit.
 *
 * DHCP addresses are never read or sent here: ADR 0162 has the hub derive
 * `address` from the registration connection's own source, the same safety
 * property `bridge-registrar.mjs` relies on. A moved lease is invisible to
 * this module by design — the next heartbeat just arrives from a new source.
 */

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { bridgeConfigPaths } from './bridge-config.mjs';
import { BRIDGE_HUB_HEARTBEAT_INTERVAL_MS, validateBridgeHubRegistrationRequest } from './bridge-hub-protocol.mjs';
import { readActiveTodoDashboardProjects } from './todo-dashboard-registry.mjs';

export { BRIDGE_HUB_HEARTBEAT_INTERVAL_MS };

const TERMINAL_IDENTITY_SCHEMA = 'lattice.bridge_hub_terminal_identity.v1';
const HEARTBEAT_RESULT_SCHEMA = 'lattice.bridge_hub_heartbeat_result.v1';
const REGISTRATION_REQUEST_SCHEMA = 'lattice.bridge_hub_registration_request.v1';
const REGISTER_PATH = '__lattice/hub/register';
const DEFAULT_TIMEOUT_MS = 5_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class BridgeHubHeartbeatError extends Error {
  constructor(code, message, detail = undefined, cause = undefined) {
    super(message, { cause });
    this.name = 'BridgeHubHeartbeatError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

function terminalIdentityPath(env) {
  return path.join(bridgeConfigPaths(env).root, 'bridge-hub-terminal.json');
}

/**
 * This terminal's stable bridge-hub identity, created once and reused across
 * restarts. It must survive restarts: registration is a full-state
 * reconciliation keyed by terminal_id (ADR 0162 Decision 4), so a fresh id on
 * every daemon start would make the hub see "a new terminal" contesting the
 * same project_ids the old id still owns until its TTL lapses — a
 * self-inflicted `BRIDGE_HUB_PROJECT_CONFLICT`.
 */
export async function readOrCreateBridgeHubTerminalId({ env = process.env } = {}) {
  const refs = bridgeConfigPaths(env);
  await mkdir(refs.root, { recursive: true, mode: 0o700 });
  const ref = terminalIdentityPath(env);
  for (;;) {
    try {
      const value = JSON.parse(await readFile(ref, 'utf8'));
      if (value?.schema === TERMINAL_IDENTITY_SCHEMA && IDENTIFIER.test(value.terminal_id)) return value.terminal_id;
      throw new BridgeHubHeartbeatError('BRIDGE_HUB_TERMINAL_IDENTITY_INVALID',
        'bridge hub terminal identity file is invalid');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const terminalId = randomBytes(16).toString('hex');
    try {
      await writeFile(ref, `${JSON.stringify({ schema: TERMINAL_IDENTITY_SCHEMA, terminal_id: terminalId })}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return terminalId;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      // Lost the create race to another process; loop back and read what it wrote.
    }
  }
}

/**
 * The terminal's own display name, shown for every project it registers
 * (registry entries are per-project but `display_name` is terminal-wide —
 * ADR 0162 Decision 2). Hostname, not a project name: the active project set
 * changes heartbeat to heartbeat but the terminal's identity does not.
 */
function terminalDisplayName() {
  return hostname().slice(0, 128) || 'terminal';
}

/** Build and validate one registration/heartbeat request. Throws rather than
  * sending a request the hub would reject as malformed. */
export function buildBridgeHubRegistrationRequest({ terminalId, port, projectIds, adopt = [] }) {
  const request = {
    schema: REGISTRATION_REQUEST_SCHEMA,
    terminal_id: terminalId,
    display_name: terminalDisplayName(),
    port,
    project_ids: [...new Set(projectIds)].sort((left, right) => left.localeCompare(right, 'en')),
    adopt: [...adopt],
  };
  if (!validateBridgeHubRegistrationRequest(request)) {
    throw new BridgeHubHeartbeatError('BRIDGE_HUB_HEARTBEAT_REQUEST_INVALID',
      'constructed bridge hub registration request is invalid', { request });
  }
  return request;
}

/**
 * Send one heartbeat. Never throws for a remote or network failure — the
 * bridge daemon loop calling this must keep serving locally even when the
 * hub is unreachable, matching `bridge-registrar.mjs`'s posture. Failures are
 * returned typed so callers can surface or log them instead of losing them.
 */
export async function sendBridgeHubHeartbeat({ hubUrl, request, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let response;
  try {
    response = await fetchImpl(new URL(REGISTER_PATH, hubUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { schema: HEARTBEAT_RESULT_SCHEMA, state: 'unreachable',
      detail: (error?.message ?? 'network error').slice(0, 500) };
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.status !== 200) {
    return { schema: HEARTBEAT_RESULT_SCHEMA, state: 'rejected', status: response.status, detail: body };
  }
  return { schema: HEARTBEAT_RESULT_SCHEMA, state: 'accepted', result: body };
}

/**
 * Periodic controller for the bridge daemon's own poll loop
 * (`bin/lattice-bridge.mjs`). Call `tick({ config })` on every iteration; it
 * self-throttles to `intervalMs` and is a no-op (no disk or network access)
 * whenever the terminal has no hub configured, so callers pay only a null
 * check on the common path.
 */
export function createBridgeHubHeartbeatController({
  env = process.env, fetchImpl = fetch, now = () => Date.now(),
  intervalMs = BRIDGE_HUB_HEARTBEAT_INTERVAL_MS,
  readActiveProjects = readActiveTodoDashboardProjects,
} = {}) {
  let lastSentAt = null;
  let lastResult = null;
  return Object.freeze({
    async tick({ config }) {
      if (config?.hub == null) { lastSentAt = null; lastResult = null; return null; }
      const nowMs = now();
      if (lastSentAt !== null && nowMs - lastSentAt < intervalMs) return lastResult;
      lastSentAt = nowMs;
      const projects = await readActiveProjects({ env });
      if (projects.length === 0) {
        lastResult = { schema: HEARTBEAT_RESULT_SCHEMA, state: 'skipped_no_projects' };
        return lastResult;
      }
      const terminalId = await readOrCreateBridgeHubTerminalId({ env });
      const request = buildBridgeHubRegistrationRequest({
        terminalId, port: config.listen.port, projectIds: projects.map((project) => project.project_id),
      });
      lastResult = await sendBridgeHubHeartbeat({ hubUrl: config.hub.url, request, fetchImpl });
      return lastResult;
    },
    lastHeartbeatResult: () => lastResult,
  });
}
