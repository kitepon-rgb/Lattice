/**
 * Bridge upstream self-registration.
 *
 * The public site is reverse-proxied to a literal LAN address held by another
 * host. When this host's address moves — a DHCP lease change is enough — that
 * literal goes stale and the site starts failing, with nothing on either side
 * noticing. Registration closes that loop: after the bridge binds, it tells the
 * reverse proxy where it actually is.
 *
 * This is an explicit connector, not a hook into someone else's tooling. It
 * runs one fixed shape — `ssh <host> <script> <port>` — over the operator's
 * existing ssh trust, and both operands are validated. Lattice never sends a
 * command string, so the reverse proxy host decides what registration means and
 * can refuse anything it does not like. The remote script is expected to derive
 * the address from the ssh source rather than trusting anything sent to it.
 *
 * Opt-in via environment, so an unconfigured host simply never registers:
 *   LATTICE_BRIDGE_REGISTRAR_SSH_HOST   ssh destination (an ssh_config alias)
 *   LATTICE_BRIDGE_REGISTRAR_SCRIPT     absolute path of the remote script
 */

import { execFile } from 'node:child_process';

import { normalizeBridgeHubUrl } from './bridge-config.mjs';

export const REGISTRAR_RESULT_SCHEMA = 'lattice.bridge_registrar_result.v1';

const SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,253}$/u;
const REMOTE_SCRIPT = /^\/[A-Za-z0-9._\-/]{1,255}$/u;
const DEFAULT_TIMEOUT_MS = 15_000;

export class BridgeRegistrarError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'BridgeRegistrarError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Registrar settings, or null when the operator has not opted in.
 * A half-configured registrar is an error rather than a silent no-op: it means
 * someone intended to register and the site will quietly rot if we skip it.
 */
export function bridgeRegistrarSettings(env = process.env) {
  const host = env.LATTICE_BRIDGE_REGISTRAR_SSH_HOST ?? '';
  const script = env.LATTICE_BRIDGE_REGISTRAR_SCRIPT ?? '';
  if (host === '' && script === '') return null;
  if (!SSH_HOST.test(host)) {
    throw new BridgeRegistrarError('BRIDGE_REGISTRAR_INVALID',
      'LATTICE_BRIDGE_REGISTRAR_SSH_HOST must be a bare ssh destination', { host });
  }
  if (!REMOTE_SCRIPT.test(script)) {
    throw new BridgeRegistrarError('BRIDGE_REGISTRAR_INVALID',
      'LATTICE_BRIDGE_REGISTRAR_SCRIPT must be an absolute path without spaces', { script });
  }
  return Object.freeze({ host, script });
}

function runSsh({ host, script, port, timeoutMs, runner }) {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, script, String(port)];
  return new Promise((resolve) => {
    runner('ssh', args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/**
 * Register `port` on the reverse proxy host. The address is deliberately NOT
 * sent: the remote end reads it from the ssh connection, so this host can only
 * ever register itself.
 *
 * Never throws for a remote failure — the bridge is still serving locally and
 * taking it down would turn a proxy-config problem into an outage. The failure
 * is returned typed so callers surface it instead of swallowing it.
 */
export async function registerBridgeUpstream({
  port, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, runner = execFile,
} = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new BridgeRegistrarError('BRIDGE_REGISTRAR_INVALID', 'registration port is invalid', { port });
  }
  const settings = bridgeRegistrarSettings(env);
  if (settings === null) {
    return { schema: REGISTRAR_RESULT_SCHEMA, state: 'not_configured', port,
      host: null, remote: null, detail: null };
  }
  const { error, stdout, stderr } = await runSsh({ ...settings, port, timeoutMs, runner });
  if (error) {
    return { schema: REGISTRAR_RESULT_SCHEMA, state: 'failed', port, host: settings.host,
      remote: null, detail: (stderr.trim() || error.message || 'ssh registration failed').slice(0, 500) };
  }
  let remote = null;
  try { remote = JSON.parse(stdout.trim()); } catch { remote = null; }
  if (remote === null) {
    return { schema: REGISTRAR_RESULT_SCHEMA, state: 'failed', port, host: settings.host,
      remote: null, detail: `registrar returned no parsable result: ${stdout.trim().slice(0, 200)}` };
  }
  return { schema: REGISTRAR_RESULT_SCHEMA,
    state: remote.changed === true ? 'updated' : 'unchanged',
    port, host: settings.host, remote, detail: null };
}

/**
 * Extract a validated hub URL from a `registerBridgeUpstream` result, or
 * `null` if this response carries none (old `lattice.bridge_registration.v1`
 * script, a failed/not_configured registration, or a malformed value).
 *
 * Never throws: the caller is bh5's auto-migration path, which must fail
 * safe into the legacy (no-hub) configuration rather than crash the daemon
 * over a malformed hint from a remote script it does not control the
 * deployment of.
 */
export function deriveBridgeHubUrlFromRegistration(result) {
  const hubUrl = result?.remote?.hub_url;
  if (typeof hubUrl !== 'string' || hubUrl.length === 0) return null;
  try { return normalizeBridgeHubUrl({ url: hubUrl }).url; } catch { return null; }
}
