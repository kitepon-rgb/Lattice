import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { BridgeConfigError, readBridgeConfig } from './bridge-config.mjs';
import { readBridgeDaemonDescriptor } from './bridge-daemon.mjs';

export const BRIDGE_LAUNCH_AGENT_LABEL = 'dev.kitepon.lattice.bridge';
const START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 3_000;
const execFileAsync = promisify(execFile);

function fail(code, message, cause = undefined) {
  return new BridgeConfigError(code, message, undefined, cause);
}

function userId() {
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw fail('BRIDGE_LAUNCH_AGENT_UID_INVALID', 'current user id is unavailable');
  }
  return uid;
}

export function bridgeLaunchAgentPaths(env = process.env) {
  const home = env.HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) {
    throw fail('BRIDGE_LAUNCH_AGENT_HOME_INVALID', 'HOME must be an absolute path');
  }
  const directory = path.join(home, 'Library', 'LaunchAgents');
  return Object.freeze({ directory,
    plist: path.join(directory, `${BRIDGE_LAUNCH_AGENT_LABEL}.plist`) });
}

async function prepareDirectory(directory, uid = userId()) {
  const home = path.dirname(path.dirname(directory));
  const library = path.dirname(directory);
  await mkdir(home, { recursive: true, mode: 0o700 });
  for (const ref of [home, library, directory]) {
    await mkdir(ref, { mode: 0o700 }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    const stats = await lstat(ref);
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== uid
      || (stats.mode & 0o022) !== 0) {
      throw fail('BRIDGE_LAUNCH_AGENT_DIR_UNSAFE', 'LaunchAgents path is unsafe');
    }
  }
}

async function strictPlist(ref, uid = userId()) {
  let before;
  let handle;
  try {
    before = await lstat(ref);
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid
      || (before.mode & 0o777) !== 0o600 || before.size > 65_536) {
      throw new Error('unsafe plist');
    }
    handle = await open(ref, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.uid !== uid || opened.dev !== before.dev
      || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error('plist changed during validation');
    }
    const content = await handle.readFile('utf8');
    const after = await lstat(ref);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new Error('plist changed during read');
    }
    return content;
  } catch (error) {
    if (error?.code === 'ENOENT' && before === undefined) return null;
    throw fail('BRIDGE_LAUNCH_AGENT_PLIST_UNSAFE', 'bridge LaunchAgent plist is unsafe', error);
  } finally {
    await handle?.close();
  }
}

async function atomicPlist(ref, content) {
  const temporary = `${ref}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, ref);
    await chmod(ref, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

async function executablePath(ref, label, { executable = true, uid = userId() } = {}) {
  if (typeof ref !== 'string' || !path.isAbsolute(ref)) {
    throw fail('BRIDGE_LAUNCH_AGENT_EXECUTABLE_INVALID', `${label} path must be absolute`);
  }
  let resolved;
  let stats;
  try {
    resolved = await realpath(ref);
    stats = await lstat(resolved);
  } catch (error) {
    throw fail('BRIDGE_LAUNCH_AGENT_EXECUTABLE_INVALID', `${label} is unavailable`, error);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || ![0, uid].includes(stats.uid)
    || (stats.mode & 0o022) !== 0
    || executable && (stats.mode & 0o111) === 0) {
    throw fail('BRIDGE_LAUNCH_AGENT_EXECUTABLE_INVALID', `${label} is unsafe`);
  }
  return resolved;
}

function plistDocument({ nodePath, bridgePath, instanceToken, env }) {
  const environment = [['LATTICE_BRIDGE_INSTANCE_TOKEN', instanceToken]];
  if (env.LATTICE_CONFIG_DIR !== undefined) {
    if (typeof env.LATTICE_CONFIG_DIR !== 'string' || !path.isAbsolute(env.LATTICE_CONFIG_DIR)) {
      throw fail('BRIDGE_CONFIG_DIR_INVALID', 'LATTICE_CONFIG_DIR must be absolute');
    }
    environment.push(['LATTICE_CONFIG_DIR', env.LATTICE_CONFIG_DIR]);
  }
  const environmentXml = environment.map(([key, value]) =>
    `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${BRIDGE_LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(bridgePath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
`;
}

export async function defaultLaunchctlRunner(args) {
  try {
    const result = await execFileAsync('/bin/launchctl', args, { encoding: 'utf8' });
    return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    if (Number.isInteger(error?.code)) {
      return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
    throw fail('BRIDGE_LAUNCHCTL_UNAVAILABLE', 'launchctl could not be executed', error);
  }
}

function domain(uid) { return `gui/${uid}`; }
function service(uid) { return `${domain(uid)}/${BRIDGE_LAUNCH_AGENT_LABEL}`; }

async function launchctl(runner, args, code, message, accepted = [0]) {
  let result;
  try { result = await runner(args); } catch (error) {
    if (error instanceof BridgeConfigError) throw error;
    throw fail(code, message, error);
  }
  if (!result || !Number.isInteger(result.code) || !accepted.includes(result.code)) {
    throw fail(code, message);
  }
  return result;
}

async function loadedState(runner, uid) {
  const result = await launchctl(runner, ['print', service(uid)],
    'BRIDGE_LAUNCHCTL_STATUS_FAILED', 'could not inspect bridge LaunchAgent', [0, 113]);
  return result.code === 0;
}

function healthHost(address) {
  if (address === '0.0.0.0') return '127.0.0.1';
  if (address === '::') return '[::1]';
  return address.includes(':') ? `[${address}]` : address;
}

async function defaultWaitReady({ config, instanceToken, env, timeoutMs = START_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptor = await readBridgeDaemonDescriptor({ env });
    if (descriptor?.address === config.listen.address && descriptor?.port === config.listen.port
      && descriptor?.config_updated_at === config.updated_at) {
      try {
        const response = await fetch(
          `http://${healthHost(descriptor.address)}:${descriptor.port}/__lattice/bridge-health`, {
            headers: { 'x-lattice-bridge-instance-token': instanceToken },
            signal: AbortSignal.timeout(400),
          });
        const body = response.status === 200 ? await response.json() : null;
        if (body?.schema === 'lattice.bridge_health.v1' && body.pid === descriptor.pid
          && body.updated_at === config.updated_at) return descriptor;
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw fail('BRIDGE_LAUNCH_AGENT_START_FAILED', 'bridge LaunchAgent did not become healthy');
}

async function defaultWaitStopped({ listen, timeoutMs = STOP_TIMEOUT_MS }) {
  if (listen === null) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${healthHost(listen.address)}:${listen.port}/__lattice/bridge-health`,
        { signal: AbortSignal.timeout(300) });
    } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw fail('BRIDGE_LAUNCH_AGENT_STOP_FAILED', 'bridge LaunchAgent socket did not stop');
}

export async function snapshotBridgeLaunchAgent({ env = process.env,
  runner = defaultLaunchctlRunner, uid = userId() } = {}) {
  const refs = bridgeLaunchAgentPaths(env);
  await prepareDirectory(refs.directory, uid);
  const content = await strictPlist(refs.plist, uid);
  const loaded = await loadedState(runner, uid);
  if (loaded && content === null) {
    throw fail('BRIDGE_LAUNCH_AGENT_STATE_INVALID', 'loaded bridge LaunchAgent has no owned plist');
  }
  return Object.freeze({ installed: content !== null, loaded, content });
}

async function bootoutIfLoaded({ runner, uid }) {
  if (!await loadedState(runner, uid)) return false;
  await launchctl(runner, ['bootout', service(uid)], 'BRIDGE_LAUNCHCTL_BOOTOUT_FAILED',
    'could not stop bridge LaunchAgent');
  return true;
}

export async function installBridgeLaunchAgent({ config, env = process.env,
  runner = defaultLaunchctlRunner, uid = userId(), nodePath = process.execPath,
  bridgePath = path.resolve(import.meta.dirname, '../bin/lattice-bridge.mjs'),
  waitReady = defaultWaitReady, waitStopped = defaultWaitStopped,
  previousListen = null } = {}) {
  if (config?.enabled !== true) throw fail('BRIDGE_DISABLED', 'bridge is disabled');
  const refs = bridgeLaunchAgentPaths(env);
  await prepareDirectory(refs.directory, uid);
  await strictPlist(refs.plist, uid);
  const resolvedNode = await executablePath(nodePath, 'node executable', { uid });
  const resolvedBridge = await executablePath(bridgePath, 'bridge executable', { executable: false, uid });
  const instanceToken = randomBytes(32).toString('hex');
  const content = plistDocument({ nodePath: resolvedNode, bridgePath: resolvedBridge, instanceToken, env });
  const stopped = await bootoutIfLoaded({ runner, uid });
  if (stopped) await waitStopped({ listen: previousListen, env });
  await atomicPlist(refs.plist, content);
  await launchctl(runner, ['bootstrap', domain(uid), refs.plist],
    'BRIDGE_LAUNCHCTL_BOOTSTRAP_FAILED', 'could not start bridge LaunchAgent');
  return waitReady({ config, instanceToken, env });
}

export async function disableBridgeLaunchAgent({ snapshot, listen, env = process.env,
  runner = defaultLaunchctlRunner, uid = userId(), waitStopped = defaultWaitStopped } = {}) {
  if (!snapshot || typeof snapshot.installed !== 'boolean' || typeof snapshot.loaded !== 'boolean') {
    throw new TypeError('bridge LaunchAgent snapshot required');
  }
  const refs = bridgeLaunchAgentPaths(env);
  if (snapshot.loaded) {
    await launchctl(runner, ['bootout', service(uid)], 'BRIDGE_LAUNCHCTL_BOOTOUT_FAILED',
      'could not stop bridge LaunchAgent');
    await waitStopped({ listen, env });
  }
  await rm(refs.plist, { force: true });
  return { removed: snapshot.installed, stopped: snapshot.loaded };
}

export async function restoreBridgeLaunchAgent({ snapshot, listen = null, env = process.env,
  runner = defaultLaunchctlRunner, uid = userId(), waitStopped = defaultWaitStopped,
  config = undefined, waitReady = defaultWaitReady } = {}) {
  if (!snapshot || typeof snapshot.installed !== 'boolean' || typeof snapshot.loaded !== 'boolean'
    || (snapshot.installed && typeof snapshot.content !== 'string')) {
    throw new TypeError('bridge LaunchAgent snapshot required');
  }
  const refs = bridgeLaunchAgentPaths(env);
  await prepareDirectory(refs.directory, uid);
  const stopped = await bootoutIfLoaded({ runner, uid });
  if (stopped) await waitStopped({ listen, env });
  if (snapshot.installed) await atomicPlist(refs.plist, snapshot.content);
  else await rm(refs.plist, { force: true });
  if (snapshot.loaded) {
    await launchctl(runner, ['bootstrap', domain(uid), refs.plist],
      'BRIDGE_LAUNCHCTL_ROLLBACK_FAILED', 'could not restore bridge LaunchAgent');
    const restoredConfig = config ?? await readBridgeConfig({ env });
    const tokenMatch = snapshot.content.match(
      /<key>LATTICE_BRIDGE_INSTANCE_TOKEN<\/key>\s*<string>([0-9a-f]{64})<\/string>/u);
    if (restoredConfig?.enabled !== true || tokenMatch === null) {
      throw fail('BRIDGE_LAUNCHCTL_ROLLBACK_FAILED', 'restored bridge LaunchAgent is not attestable');
    }
    await waitReady({ config: restoredConfig, instanceToken: tokenMatch[1], env });
  }
  return snapshot;
}
