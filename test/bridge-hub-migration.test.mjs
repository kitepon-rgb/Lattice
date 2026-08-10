import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL, migrateBridgeToHub, retireBridgeTunnelLaunchAgent,
} from '../src/bridge-hub-migration.mjs';

const REGISTRAR_ENV = Object.freeze({
  LATTICE_BRIDGE_REGISTRAR_SSH_HOST: 'main-server',
  LATTICE_BRIDGE_REGISTRAR_SCRIPT: '/home/kite/license-server/bin/lattice-bridge-register.sh',
});

const LOOPBACK_CONFIG = Object.freeze({
  schema: 'lattice.bridge_config.v1', enabled: true,
  listen: { address: '127.0.0.1', port: 53_939 },
  allowed_hosts: ['127.0.0.1', 'lattice.example.com'],
  upstream: { mode: 'dashboard_descriptor' }, hub: null,
  updated_at: '2026-08-01T00:00:00.000Z',
});

const LAN_INTERFACES = Object.freeze({
  en0: [{ address: '192.168.1.103', internal: false }],
  lo0: [{ address: '127.0.0.1', internal: true }],
});

function registrarResultOk(hubUrl) {
  return async () => ({
    schema: 'lattice.bridge_registrar_result.v1', state: 'unchanged', port: 53_939, host: 'main-server',
    remote: hubUrl === null ? { schema: 'lattice.bridge_registration.v1', changed: false }
      : { schema: 'lattice.bridge_registration.v2', changed: false, hub_url: hubUrl },
    detail: null,
  });
}

test('registrar未設定ならbridge_not_enabledより前にmigrated:falseで即返す（config読取もregisterも呼ばない）', async () => {
  let readConfigCalled = false; let registerCalled = false;
  const result = await migrateBridgeToHub({
    env: {}, readConfig: async () => { readConfigCalled = true; return LOOPBACK_CONFIG; },
    register: async () => { registerCalled = true; },
  });
  assert.deepEqual(result, { migrated: false, reason: 'registrar_not_configured' });
  assert.equal(readConfigCalled, false);
  assert.equal(registerCalled, false);
});

test('bridgeが未設定/無効ならbridge_not_enabled', async () => {
  const result = await migrateBridgeToHub({
    env: REGISTRAR_ENV, readConfig: async () => null,
    register: async () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(result, { migrated: false, reason: 'bridge_not_enabled' });
});

test('既にhubを持つconfigはalready_migratedで再migrationしない', async () => {
  const result = await migrateBridgeToHub({
    env: REGISTRAR_ENV,
    readConfig: async () => ({ ...LOOPBACK_CONFIG, hub: { url: 'http://192.168.1.2:53943/' } }),
    register: async () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(result, { migrated: false, reason: 'already_migrated' });
});

test('旧v1応答（hub_url無し）はno_hub_url_availableで現状維持', async () => {
  const result = await migrateBridgeToHub({
    env: REGISTRAR_ENV, readConfig: async () => LOOPBACK_CONFIG, register: registrarResultOk(null),
    configure: async () => { throw new Error('must not be called'); },
  });
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'no_hub_url_available');
});

test('hub_urlは得られてもLANアドレスが無ければno_lan_address_available', async () => {
  const result = await migrateBridgeToHub({
    env: REGISTRAR_ENV, readConfig: async () => LOOPBACK_CONFIG,
    register: registrarResultOk('http://192.168.1.2:53943'),
    interfaces: { lo0: [{ address: '127.0.0.1', internal: true }] },
    configure: async () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(result, { migrated: false, reason: 'no_lan_address_available' });
});

test('成功時はLAN addressへ切替えhubを設定し、既存upstream/allowed_hostsを引き継ぐ', async () => {
  let configureArgs = null;
  const result = await migrateBridgeToHub({
    env: REGISTRAR_ENV, readConfig: async () => LOOPBACK_CONFIG,
    register: registrarResultOk('http://192.168.1.2:53943'),
    interfaces: LAN_INTERFACES,
    configure: async (args) => { configureArgs = args; return { ...LOOPBACK_CONFIG, ...args }; },
  });
  assert.equal(result.migrated, true);
  assert.equal(result.hubUrl, 'http://192.168.1.2:53943/');
  assert.equal(configureArgs.address, '192.168.1.103');
  assert.equal(configureArgs.port, null);
  assert.equal(configureArgs.reuseCurrentPort, false);
  assert.deepEqual(configureArgs.hub, { url: 'http://192.168.1.2:53943/' });
  assert.deepEqual(configureArgs.upstream, { mode: 'dashboard_descriptor' });
  // 旧listen addressそのもの（127.0.0.1）は新しいallowed_hostsに引き継がない——
  // configureBridgeが新addressを自動で加えるため、旧loopbackだけ落とす。
  assert.deepEqual(configureArgs.allowedHosts, ['lattice.example.com']);
});

test('registrar呼び出しには現在のlisten portを渡す', async () => {
  let registeredPort = null;
  await migrateBridgeToHub({
    env: REGISTRAR_ENV, readConfig: async () => LOOPBACK_CONFIG,
    register: async ({ port }) => { registeredPort = port; return registrarResultOk('http://192.168.1.2:53943')(); },
    interfaces: LAN_INTERFACES,
    configure: async (args) => ({ ...LOOPBACK_CONFIG, ...args }),
  });
  assert.equal(registeredPort, 53_939);
});

// --- retireBridgeTunnelLaunchAgent ---

function tunnelLaunchctlDouble({ loaded = true, bootoutFails = false } = {}) {
  const calls = [];
  const runner = async (args) => {
    calls.push([...args]);
    if (args[0] === 'print') return { code: loaded ? 0 : 113, stdout: '', stderr: '' };
    if (args[0] === 'bootout') return bootoutFails ? { code: 5, stdout: '', stderr: 'failed' } : { code: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  return { runner, calls };
}

test('uidが取得できなければ（Windows等でprocess.getuidが無い相当）何もせずuid_unavailable', async () => {
  // `uid: undefined`は関数の既定値(process.getuid?.())へ差し戻ってしまいこの環境の
  // 実uidが入るため、getuidが存在しない環境を模すにはnullを明示する。
  const control = tunnelLaunchctlDouble();
  const result = await retireBridgeTunnelLaunchAgent({ uid: null, runner: control.runner });
  assert.deepEqual(result, { retired: false, reason: 'uid_unavailable' });
  assert.deepEqual(control.calls, []);
});

test('tunnelが未loadなら何もせずnot_loaded（bootoutを呼ばない）', async () => {
  const control = tunnelLaunchctlDouble({ loaded: false });
  const result = await retireBridgeTunnelLaunchAgent({ uid: 501, runner: control.runner, env: {} });
  assert.deepEqual(result, { retired: false, reason: 'not_loaded' });
  assert.deepEqual(control.calls, [['print', `gui/501/${BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL}`]]);
});

test('loaded中のtunnelはbootoutしplistを除去する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-tunnel-retire-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const plistDir = path.join(root, 'Library', 'LaunchAgents');
  await mkdir(plistDir, { recursive: true });
  const plistPath = path.join(plistDir, `${BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL}.plist`);
  await writeFile(plistPath, '<plist/>', 'utf8');

  const control = tunnelLaunchctlDouble({ loaded: true });
  const result = await retireBridgeTunnelLaunchAgent({ uid: 502, runner: control.runner, env: { HOME: root } });
  assert.deepEqual(result, { retired: true });
  assert.deepEqual(control.calls, [
    ['print', `gui/502/${BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL}`],
    ['bootout', `gui/502/${BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL}`],
  ]);
  await assert.rejects(stat(plistPath), { code: 'ENOENT' });
});

test('bootout失敗はbootout_failedを返しplistは残す（勝手に消さない）', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-tunnel-retire-fail-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const plistDir = path.join(root, 'Library', 'LaunchAgents');
  await mkdir(plistDir, { recursive: true });
  const plistPath = path.join(plistDir, `${BRIDGE_TUNNEL_LAUNCH_AGENT_LABEL}.plist`);
  await writeFile(plistPath, '<plist/>', 'utf8');

  const control = tunnelLaunchctlDouble({ loaded: true, bootoutFails: true });
  const result = await retireBridgeTunnelLaunchAgent({ uid: 503, runner: control.runner, env: { HOME: root } });
  assert.deepEqual(result, { retired: false, reason: 'bootout_failed' });
  assert.equal(await readFile(plistPath, 'utf8'), '<plist/>');
});

test('runnerが例外を投げても（launchctl不在等）throwせずlaunchctl_unavailableを返す', async () => {
  const result = await retireBridgeTunnelLaunchAgent({
    uid: 504, runner: async () => { throw new Error('ENOENT'); }, env: {},
  });
  assert.deepEqual(result, { retired: false, reason: 'launchctl_unavailable' });
});
