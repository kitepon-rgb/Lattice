/**
 * Mac auto-migration (bh5): a terminal running the old single-slot topology
 * (loopback bridge + `LATTICE_BRIDGE_REGISTRAR_*` ssh registrar) upgrades to
 * hub registration with zero manual commands. The owner's stated acceptance
 * test is literal: an agent who knows nothing about hub/port/flags/migration
 * runs a normal package update, and the bridge finds its own way onto the
 * public page (room 2446, 2461) — no `--hub` flag, no LaunchAgent surgery.
 *
 * The trigger is the registrar call the daemon already makes on every new
 * binding (`bridge-registrar.mjs`'s `registerBridgeUpstream`, used by
 * `bridge-launch-agent.mjs`'s plist today only to keep the reverse-proxy
 * literal current). The v2 registrar script (room 2452) additionally returns
 * `hub_url` in that same response — this module is what turns "a hub_url
 * showed up in a registration reply" into "reconfigure this bridge to use
 * it and retire the ssh tunnel", entirely from information the terminal
 * already had a reason to ask for.
 */

import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { pickBridgeLanAddress } from './bridge-address.mjs';
import { configureBridge, readBridgeConfig } from './bridge-config.mjs';
import {
  bridgeRegistrarSettings, deriveBridgeHubUrlFromRegistration, registerBridgeUpstream,
} from './bridge-registrar.mjs';

const execFileAsync = promisify(execFile);

/** The ssh reverse-tunnel LaunchAgent from the pre-hub topology
  * (docs/operations/lattice-kitepon-deployment.md) — distinct from
  * `dev.kitepon.lattice.bridge`, which `bridge-launch-agent.mjs` owns and
  * this migration never touches. */
export const BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL = 'dev.kitepon.lattice.bridge-tunnel';

/**
 * Attempt one migration step. Called from the daemon's reconcile loop, so it
 * must be cheap to call when there is nothing to do and must never throw for
 * a condition the caller should just keep running through (no registrar
 * configured, already migrated, hub unreachable this cycle) — only a
 * genuinely invalid registrar env (`bridgeRegistrarSettings`'s own
 * half-configured-pair failure) propagates, matching every other registrar
 * caller's behavior.
 */
export async function migrateBridgeToHub({
  env = process.env, interfaces = networkInterfaces(), readConfig = readBridgeConfig,
  configure = configureBridge, register = registerBridgeUpstream,
} = {}) {
  const registrar = bridgeRegistrarSettings(env);
  if (registrar === null) return { migrated: false, reason: 'registrar_not_configured' };
  const current = await readConfig({ env });
  if (current === null || !current.enabled) return { migrated: false, reason: 'bridge_not_enabled' };
  if (current.hub !== null) return { migrated: false, reason: 'already_migrated' };

  const registration = await register({ port: current.listen.port, env });
  const hubUrl = deriveBridgeHubUrlFromRegistration(registration);
  if (hubUrl === null) return { migrated: false, reason: 'no_hub_url_available', registration };

  const picked = pickBridgeLanAddress({ interfaces });
  if (picked.address === null) return { migrated: false, reason: 'no_lan_address_available' };

  const updated = await configure({
    address: picked.address, port: null, reuseCurrentPort: false,
    upstream: current.upstream, hub: { url: hubUrl },
    allowedHosts: current.allowed_hosts.filter((host) => host !== current.listen.address),
    env,
  });
  return { migrated: true, config: updated, hubUrl };
}

function launchAgentPlistPath(label, env) {
  const home = env.HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) return null;
  return path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
}

/**
 * Retire the pre-hub ssh reverse-tunnel LaunchAgent, once migration has
 * actually landed a hub URL — never speculatively, so a bridge that never
 * reaches `migrateBridgeToHub`'s success path never touches this agent.
 * Idempotent and non-fatal: a tunnel that is not loaded (already retired, or
 * this deployment never had one) is success, not an error, and any
 * `launchctl` failure here must not crash a daemon whose primary job — hub
 * registration — has already succeeded by the time this runs.
 */
export async function retireBridgeTunnelLaunchAgent({
  env = process.env, uid = process.getuid?.(), runner = defaultTunnelLaunchctlRunner,
  label = BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL,
} = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0) return { retired: false, reason: 'uid_unavailable' };
  const service = `gui/${uid}/${label}`;
  let probe;
  try { probe = await runner(['print', service]); } catch { return { retired: false, reason: 'launchctl_unavailable' }; }
  if (probe.code !== 0) return { retired: false, reason: 'not_loaded' };
  try {
    const bootout = await runner(['bootout', service]);
    if (bootout.code !== 0) return { retired: false, reason: 'bootout_failed' };
  } catch { return { retired: false, reason: 'bootout_failed' }; }
  const plistPath = launchAgentPlistPath(label, env);
  if (plistPath !== null) await rm(plistPath, { force: true }).catch(() => {});
  return { retired: true };
}

export async function defaultTunnelLaunchctlRunner(args) {
  try {
    const result = await execFileAsync('/bin/launchctl', args, { encoding: 'utf8' });
    return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    if (Number.isInteger(error?.code)) {
      return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
    throw error;
  }
}

