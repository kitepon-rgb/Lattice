import { isIP } from 'node:net';
import * as clack from '@clack/prompts';

import {
  BridgeConfigError, configureBridge, disableBridge, readBridgeConfig, restoreBridgeConfig,
  normalizeBridgeAllowedHost, withBridgeOperationLock,
} from './bridge-config.mjs';
import {
  clearBridgeStopControl, ensureBridgeDaemon, readBridgeDaemonDescriptor,
  removeBridgeDaemonActiveMarker, removeBridgeDaemonDescriptor, requestBridgeDaemonStop,
  stopBridgeDaemon,
} from './bridge-daemon.mjs';

const RESULT_SCHEMA = 'lattice.bridge_cli_result.v1';

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

function result(action, config, recovery = null) {
  return { schema: RESULT_SCHEMA, action, configured: config !== null, enabled: config?.enabled ?? false,
    listen: config?.listen ?? null, allowed_hosts: config?.allowed_hosts ?? null,
    upstream: config?.upstream ?? null, updated_at: config?.updated_at ?? null, recovery };
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
  prompts = clack } = {}) {
  if (!Array.isArray(argv)) {
    return fail(stderr, 'USAGE', 'usage: lattice bridge <setup|reconfigure|status|disable> [options] --json');
  }
  const wizard = argv.length === 1 && argv[0] === 'setup';
  if (!wizard && argv.at(-1) !== '--json') {
    return fail(stderr, 'USAGE', 'usage: lattice bridge <setup|reconfigure|status|disable> [options] --json');
  }
  if (wizard && (!stdin?.isTTY || !stdout?.isTTY)) {
    return fail(stderr, 'BRIDGE_SETUP_REQUIRES_TTY',
      'interactive setup requires a TTY; use lattice bridge setup --listen <IP> --port auto --dashboard --json');
  }
  const [command, ...words] = wizard ? argv : argv.slice(0, -1);
  try {
    let config;
    let recovery = null;
    if (command === 'status' && words.length === 0) config = await readBridgeConfig({ env });
    else if (command === 'disable' && words.length === 0) {
      config = await withBridgeOperationLock({ env }, async () => {
        let previous;
        let invalidConfig = false;
        let invalidDescriptor = false;
        try {
          previous = await readBridgeConfig({ env });
        } catch (error) {
          if (!['BRIDGE_CONFIG_INVALID', 'BRIDGE_CONFIG_MODE_INVALID'].includes(error?.code)) throw error;
          invalidConfig = true;
        }
        try { await readBridgeDaemonDescriptor({ env }); } catch (error) {
          if (error?.code !== 'BRIDGE_DAEMON_DESCRIPTOR_INVALID') throw error;
          invalidDescriptor = true;
        }
        const requestStop = daemon.requestStop ?? daemon.stop ?? requestBridgeDaemonStop;
        const stopResult = await requestStop({ env, listen: previous?.listen ?? null });
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
        const configured = await configureBridge({
          address: options.address ?? current?.listen.address,
          port: options.port === undefined ? (command === 'reconfigure' ? current?.listen.port ?? null : null) : options.port,
          upstream: options.upstream ?? current?.upstream ?? { mode: 'dashboard_descriptor' }, env,
          allowedHosts: options.allowedHosts.length > 0 ? options.allowedHosts
            : current?.allowed_hosts?.filter((host) => host !== current.listen.address) ?? [],
          reuseCurrentPort: options.port === undefined,
        });
        try { await daemon.ensure({ env }); } catch (error) {
          await restoreBridgeConfig(current, { env });
          if (current?.enabled) await daemon.ensure({ env });
          else await daemon.stop({ env });
          throw error;
        }
        return configured;
      });
    } else return fail(stderr, 'USAGE', 'unknown bridge command or options');
    if (wizard) stdout.write(`Lattice bridgeを${config.listen.address}:${config.listen.port}で有効にしました。\n`);
    else stdout.write(`${JSON.stringify(result(command, config, recovery))}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2',
      code: error?.code ?? 'BRIDGE_FAILED', message: error?.message ?? 'bridge command failed' })}\n`);
    return error?.code === 'USAGE' ? 2 : 1;
  }
}
