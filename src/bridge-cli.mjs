import { createConnection, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import * as clack from '@clack/prompts';

import { resolveBridgeListenAddress } from './bridge-address.mjs';
import { registerBridgeUpstream } from './bridge-registrar.mjs';
import {
  BridgeConfigError, configureBridge, disableBridge, readBridgeConfig, restoreBridgeConfig,
  normalizeBridgeAllowedHost, withBridgeOperationLock,
} from './bridge-config.mjs';
import {
  clearBridgeStopControl, ensureBridgeDaemon, readBridgeDaemonDescriptor,
  removeBridgeDaemonActiveMarker, removeBridgeDaemonDescriptor, requestBridgeDaemonStop,
  stopBridgeDaemon,
} from './bridge-daemon.mjs';
import {
  disableBridgeLaunchAgent, installBridgeLaunchAgent, restoreBridgeLaunchAgent,
  snapshotBridgeLaunchAgent,
} from './bridge-launch-agent.mjs';

// v2 adds the liveness fields. `enabled` only says the configuration is on;
// it never said the bridge could actually be reached, which let a DHCP lease
// change take the published surface down while status kept reporting health.
const RESULT_SCHEMA = 'lattice.bridge_cli_result.v2';
const REACHABILITY_PROBE_TIMEOUT_MS = 750;

/** TCP connect probe. Answers "is anything accepting there right now". */
export function probeBridgeListener({ address, port, timeoutMs = REACHABILITY_PROBE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = createConnection({ host: address, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Liveness of the configured listen address: does it still exist on this host,
 * did it move inside its subnet, and is anything accepting connections there.
 */
async function bridgeLiveness(config, { interfaces = networkInterfaces(), probe = probeBridgeListener } = {}) {
  if (config === null || config.enabled !== true) {
    return { listen_state: 'unconfigured', effective_listen: null, listen_candidates: [],
      reachable: null, liveness_reason: null };
  }
  const resolved = resolveBridgeListenAddress({ configured: config.listen.address, interfaces });
  const effective = resolved.effective === null ? null
    : { address: resolved.effective, port: config.listen.port };
  const reachable = effective === null ? false
    : await probe({ address: effective.address, port: effective.port });
  return {
    listen_state: resolved.state,
    effective_listen: effective,
    listen_candidates: resolved.candidates,
    reachable,
    liveness_reason: resolved.reason ?? (reachable ? null : 'listener_not_accepting'),
  };
}

function fail(stderr, code, message) {
  stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2', code, message })}\n`);
  return 2;
}

function parseOptions(words) {
  const options = { address: undefined, port: undefined, upstream: undefined, allowedHosts: [] };
  for (let index = 0; index < words.length; index += 1) {
    const flag = words[index];
    if (flag === '--listen') {
      if (options.address !== undefined) throw new BridgeConfigError('USAGE', 'duplicate --listen');
      options.address = words[++index];
    }
    else if (flag === '--port') {
      if (options.port !== undefined) throw new BridgeConfigError('USAGE', 'duplicate --port');
      const value = words[++index];
      options.port = value === 'auto' ? null : Number(value);
    } else if (flag === '--dashboard') {
      if (options.upstream !== undefined) throw new BridgeConfigError('USAGE', 'upstream option is ambiguous');
      options.upstream = { mode: 'dashboard_descriptor' };
    } else if (flag === '--upstream') {
      if (options.upstream !== undefined) throw new BridgeConfigError('USAGE', 'upstream option is ambiguous');
      options.upstream = { mode: 'url', url: words[++index] };
    } else if (flag === '--allow-host') options.allowedHosts.push(words[++index]);
    else throw new BridgeConfigError('USAGE', `unknown bridge option: ${flag}`);
    if ((flag === '--listen' || flag === '--port' || flag === '--upstream' || flag === '--allow-host')
      && words[index] === undefined) throw new BridgeConfigError('USAGE', `missing value for ${flag}`);
  }
  return options;
}

function result(action, config, recovery = null, liveness = null) {
  return { schema: RESULT_SCHEMA, action, configured: config !== null, enabled: config?.enabled ?? false,
    listen: config?.listen ?? null, allowed_hosts: config?.allowed_hosts ?? null,
    upstream: config?.upstream ?? null, updated_at: config?.updated_at ?? null, recovery,
    listen_state: liveness?.listen_state ?? null,
    effective_listen: liveness?.effective_listen ?? null,
    listen_candidates: liveness?.listen_candidates ?? null,
    reachable: liveness?.reachable ?? null,
    liveness_reason: liveness?.liveness_reason ?? null };
}

export async function collectBridgeSetupWizard({ input, output, prompts = clack } = {}) {
  const common = { input, output };
  const enabled = await prompts.confirm({ ...common,
    message: 'Lattice dashboardのnetwork bridgeを有効にしますか？', initialValue: false });
  if (prompts.isCancel(enabled) || enabled !== true) return null;
  const address = await prompts.text({ ...common, message: 'listenするIP address',
    placeholder: '192.168.1.102', validate: (value) => isIP(value) === 0 ? 'IP literalを入力してください' : undefined });
  if (prompts.isCancel(address)) return null;
  const portMode = await prompts.select({ ...common, message: 'bridge port', initialValue: 'auto', options: [
    { value: 'auto', label: '自動選択', hint: '49152–65535からexclusive bind' },
    { value: 'custom', label: '指定する' },
  ] });
  if (prompts.isCancel(portMode)) return null;
  let port = null;
  if (portMode === 'custom') {
    const selected = await prompts.text({ ...common, message: 'port (49152–65535)',
      validate: (value) => /^\d+$/u.test(value) && Number(value) >= 49_152 && Number(value) <= 65_535
        ? undefined : '49152–65535の整数を入力してください' });
    if (prompts.isCancel(selected)) return null;
    port = Number(selected);
  }
  const upstreamMode = await prompts.select({ ...common, message: 'upstream', initialValue: 'dashboard', options: [
    { value: 'dashboard', label: '現在のLattice dashboard', hint: '再起動時もdescriptorから追従' },
    { value: 'custom', label: '固定URL' },
  ] });
  if (prompts.isCancel(upstreamMode)) return null;
  let upstream = { mode: 'dashboard_descriptor' };
  if (upstreamMode === 'custom') {
    const url = await prompts.text({ ...common, message: 'upstream HTTP(S) URL',
      placeholder: 'http://127.0.0.1:4318/' });
    if (prompts.isCancel(url)) return null;
    upstream = { mode: 'url', url };
  }
  const publicHost = await prompts.text({ ...common,
    message: '追加で許可する公開hostname（なければ空欄）', placeholder: 'lattice.kitepon.dev',
    validate: (value) => {
      if (value === '') return undefined;
      try { normalizeBridgeAllowedHost(value); return undefined; } catch {
        return 'portやschemeを含まないhostnameを入力してください';
      }
    } });
  if (prompts.isCancel(publicHost)) return null;
  return { address, port, upstream, allowedHosts: publicHost === '' ? [] : [publicHost] };
}

export async function runBridgeCli({ argv, stdout, stderr, env = process.env,
  stdin = process.stdin, daemon = { ensure: ensureBridgeDaemon, requestStop: requestBridgeDaemonStop,
    stop: stopBridgeDaemon, clearStop: clearBridgeStopControl },
  launchAgent = { snapshot: snapshotBridgeLaunchAgent, install: installBridgeLaunchAgent,
    disable: disableBridgeLaunchAgent, restore: restoreBridgeLaunchAgent },
  prompts = clack, probe = probeBridgeListener, interfaces = networkInterfaces() } = {}) {
  if (!Array.isArray(argv)) {
    return fail(stderr, 'USAGE', 'usage: lattice bridge <setup|reconfigure|status|disable|register> [options] --json');
  }
  const wizard = argv.length === 1 && argv[0] === 'setup';
  if (!wizard && argv.at(-1) !== '--json') {
    return fail(stderr, 'USAGE', 'usage: lattice bridge <setup|reconfigure|status|disable|register> [options] --json');
  }
  if (wizard && (!stdin?.isTTY || !stdout?.isTTY)) {
    return fail(stderr, 'BRIDGE_SETUP_REQUIRES_TTY',
      'interactive setup requires a TTY; use lattice bridge setup --listen <IP> --port auto --dashboard --json');
  }
  const [command, ...words] = wizard ? argv : argv.slice(0, -1);
  try {
    if (command === 'register' && words.length === 0) {
      const current = await readBridgeConfig({ env });
      if (current === null || current.enabled !== true) {
        return fail(stderr, 'BRIDGE_DISABLED', 'bridge is not enabled; nothing to register');
      }
      const resolved = resolveBridgeListenAddress({ configured: current.listen.address, interfaces });
      if (resolved.effective === null) {
        return fail(stderr, 'BRIDGE_LISTEN_ADDRESS_ABSENT',
          'configured bridge listen address is not present on this host');
      }
      const registration = await registerBridgeUpstream({ port: current.listen.port, env });
      stdout.write(`${JSON.stringify(registration)}\n`);
      return registration.state === 'failed' ? 1 : 0;
    }
    let config;
    let recovery = null;
    if (command === 'status' && words.length === 0) config = await readBridgeConfig({ env });
    else if (command === 'disable' && words.length === 0) {
      config = await withBridgeOperationLock({ env }, async () => {
        let previous;
        let descriptor = null;
        let invalidConfig = false;
        let invalidDescriptor = false;
        try {
          previous = await readBridgeConfig({ env });
        } catch (error) {
          if (!['BRIDGE_CONFIG_INVALID', 'BRIDGE_CONFIG_MODE_INVALID'].includes(error?.code)) throw error;
          invalidConfig = true;
        }
        try { descriptor = await readBridgeDaemonDescriptor({ env }); } catch (error) {
          if (error?.code !== 'BRIDGE_DAEMON_DESCRIPTOR_INVALID') throw error;
          invalidDescriptor = true;
        }
        const agentSnapshot = await launchAgent.snapshot({ env });
        const witnessedListen = previous?.listen ?? (descriptor === null ? null
          : { address: descriptor.address, port: descriptor.port });
        let stopResult = null;
        try {
          await launchAgent.disable({ snapshot: agentSnapshot, listen: witnessedListen, env });
          if (!agentSnapshot.loaded) {
            const requestStop = daemon.requestStop ?? daemon.stop ?? requestBridgeDaemonStop;
            stopResult = await requestStop({ env, listen: witnessedListen });
          }
          const disabled = invalidConfig ? await restoreBridgeConfig(null, { env })
            : await disableBridge({ env });
          if (invalidConfig) recovery = 'invalid_config_removed_after_fail_closed_shutdown';
          else if (invalidDescriptor) recovery = 'invalid_descriptor_removed_after_fail_closed_shutdown';
          await removeBridgeDaemonDescriptor({ env });
          await removeBridgeDaemonActiveMarker({ env });
          const clearStop = daemon.clearStop ?? clearBridgeStopControl;
          await clearStop({ env });
          if (stopResult?.state === 'not_running' && recovery === null) recovery = 'bridge_was_not_running';
          return disabled;
        } catch (error) {
          try {
            await launchAgent.restore({ snapshot: agentSnapshot, listen: witnessedListen,
              config: previous, env });
          }
          catch (rollbackError) {
            throw new BridgeConfigError('BRIDGE_ROLLBACK_FAILED',
              `bridge disable failed and LaunchAgent rollback failed: ${rollbackError.message}`, undefined, error);
          }
          throw error;
        }
      });
    }
    else if (command === 'setup' || command === 'reconfigure') {
      const options = wizard ? await collectBridgeSetupWizard({ input: stdin, output: stdout, prompts })
        : parseOptions(words);
      if (options === null) {
        stdout.write('Lattice bridge setupを取り消しました。設定は変更していません。\n');
        return 0;
      }
      if (command === 'setup' && options.address === undefined) {
        throw new BridgeConfigError('USAGE', 'setup requires explicit --listen <IP> opt-in');
      }
      config = await withBridgeOperationLock({ env }, async () => {
        const clearStop = daemon.clearStop ?? clearBridgeStopControl;
        await clearStop({ env });
        const current = await readBridgeConfig({ env });
        const agentSnapshot = await launchAgent.snapshot({ env });
        const configured = await configureBridge({
          address: options.address ?? current?.listen.address,
          port: options.port === undefined ? (command === 'reconfigure' ? current?.listen.port ?? null : null) : options.port,
          upstream: options.upstream ?? current?.upstream ?? { mode: 'dashboard_descriptor' }, env,
          allowedHosts: options.allowedHosts.length > 0 ? options.allowedHosts
            : current?.allowed_hosts?.filter((host) => host !== current.listen.address) ?? [],
          reuseCurrentPort: options.port === undefined,
        });
        try {
          if (!agentSnapshot.loaded && current !== null) {
            const requestStop = daemon.requestStop ?? daemon.stop ?? requestBridgeDaemonStop;
            await requestStop({ env, listen: current.listen });
            await clearStop({ env });
          }
          await launchAgent.install({ config: configured, previousListen: current?.listen ?? null, env });
        } catch (error) {
          try {
            await restoreBridgeConfig(current, { env });
            await clearStop({ env });
            await launchAgent.restore({ snapshot: agentSnapshot, listen: configured.listen,
              config: current, env });
            if (current?.enabled && !agentSnapshot.loaded) await daemon.ensure({ env });
          } catch (rollbackError) {
            throw new BridgeConfigError('BRIDGE_ROLLBACK_FAILED',
              `bridge setup failed and rollback failed: ${rollbackError.message}`, undefined, error);
          }
          throw error;
        }
        return configured;
      });
    } else return fail(stderr, 'USAGE', 'unknown bridge command or options');
    // Liveness is only meaningful for a read: the mutating commands have just
    // reconfigured the daemon and the socket may not have settled yet.
    const liveness = command === 'status' ? await bridgeLiveness(config, { probe, interfaces }) : null;
    if (wizard) stdout.write(`Lattice bridgeを${config.listen.address}:${config.listen.port}で有効にしました。\n`);
    else stdout.write(`${JSON.stringify(result(command, config, recovery, liveness))}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2',
      code: error?.code ?? 'BRIDGE_FAILED', message: error?.message ?? 'bridge command failed' })}\n`);
    return error?.code === 'USAGE' ? 2 : 1;
  }
}
