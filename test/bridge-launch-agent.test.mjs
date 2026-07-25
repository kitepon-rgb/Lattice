import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BRIDGE_LAUNCH_AGENT_LABEL, bridgeLaunchAgentPaths, disableBridgeLaunchAgent,
  installBridgeLaunchAgent, restoreBridgeLaunchAgent, snapshotBridgeLaunchAgent,
} from '../src/bridge-launch-agent.mjs';

async function fixture(context, prefix) {
  const { mkdtemp } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, env: { HOME: path.join(root, 'home'), LATTICE_CONFIG_DIR: path.join(root, 'config') } };
}

function launchctlDouble() {
  let loaded = false;
  let bootstrapFailure = false;
  const calls = [];
  const runner = async (args) => {
    calls.push([...args]);
    if (args[0] === 'print') return { code: loaded ? 0 : 113, stdout: '', stderr: '' };
    if (args[0] === 'bootout') { loaded = false; return { code: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'bootstrap') {
      if (bootstrapFailure) return { code: 5, stdout: '', stderr: 'failed' };
      loaded = true;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'enable') return { code: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected launchctl call: ${args.join(' ')}`);
  };
  return { runner, calls, isLoaded: () => loaded, reboot: () => { loaded = false; },
    failBootstrap: () => { bootstrapFailure = true; } };
}

function config(port, updatedAt = '2026-07-21T00:00:00.000Z') {
  return { enabled: true, listen: { address: '127.0.0.1', port }, updated_at: updatedAt };
}

test('LaunchAgentは引数分離した絶対pathとKeepAlive/RunAtLoadを0600 plistへatomic installする',
  async (context) => {
    const { env } = await fixture(context, 'lattice-launch-agent-install-');
    const control = launchctlDouble();
    let ready;
    await installBridgeLaunchAgent({ config: config(58_760), env, runner: control.runner,
      waitReady: async (value) => { ready = value; return { pid: 42 }; } });
    const refs = bridgeLaunchAgentPaths(env);
    const stats = await lstat(refs.plist);
    assert.equal(stats.isFile(), true);
    assert.equal(stats.isSymbolicLink(), false);
    assert.equal(stats.mode & 0o777, 0o600);
    const content = await readFile(refs.plist, 'utf8');
    assert.match(content, new RegExp(`<string>${BRIDGE_LAUNCH_AGENT_LABEL}</string>`, 'u'));
    assert.match(content, /<key>ProgramArguments<\/key>[\s\S]*<string>\/.*node<\/string>[\s\S]*lattice-bridge\.mjs<\/string>/u);
    assert.match(content, /<key>RunAtLoad<\/key>\s*<true\/>/u);
    assert.match(content, /<key>KeepAlive<\/key>\s*<true\/>/u);
    assert.match(content, /<key>LATTICE_CONFIG_DIR<\/key>/u);
    assert.match(ready.instanceToken, /^[0-9a-f]{64}$/u);
    assert.equal(control.isLoaded(), true);
    assert.equal(control.calls.at(-1)[0], 'bootstrap');
  });

test('reconfigureは旧service停止確認後にplistを置換し、新しいserviceのreadyを待つ', async (context) => {
  const { env } = await fixture(context, 'lattice-launch-agent-reconfigure-');
  const control = launchctlDouble();
  const stopped = [];
  const ready = [];
  const common = { env, runner: control.runner,
    waitStopped: async ({ listen }) => { stopped.push(listen); },
    waitReady: async ({ config: value }) => { ready.push(value.listen.port); } };
  await installBridgeLaunchAgent({ ...common, config: config(58_761) });
  const first = await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8');
  await installBridgeLaunchAgent({ ...common,
    config: config(58_762, '2026-07-21T00:01:00.000Z'), previousListen: config(58_761).listen });
  const second = await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8');
  assert.notEqual(first, second);
  assert.deepEqual(stopped, [config(58_761).listen]);
  assert.deepEqual(ready, [58_761, 58_762]);
  assert.ok(control.calls.some((args) => args[0] === 'bootout'));
});

test('disableはbootoutとsocket停止確認の後だけplistを除去し、snapshotから復旧できる',
  async (context) => {
    const { env } = await fixture(context, 'lattice-launch-agent-disable-');
    const control = launchctlDouble();
    await installBridgeLaunchAgent({ config: config(58_763), env, runner: control.runner,
      waitReady: async () => {} });
    const snapshot = await snapshotBridgeLaunchAgent({ env, runner: control.runner });
    const stopped = [];
    await disableBridgeLaunchAgent({ snapshot, listen: config(58_763).listen, env, runner: control.runner,
      waitStopped: async ({ listen }) => { stopped.push(listen); } });
    await assert.rejects(readFile(bridgeLaunchAgentPaths(env).plist), { code: 'ENOENT' });
    assert.deepEqual(stopped, [config(58_763).listen]);
    assert.equal(control.isLoaded(), false);
    await restoreBridgeLaunchAgent({ snapshot, config: config(58_763), env, runner: control.runner,
      waitStopped: async () => {}, waitReady: async () => {} });
    assert.equal(await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8'), snapshot.content);
    assert.equal(control.isLoaded(), true);
  });

test('再起動後も永続plistから同じProgramArguments/environmentでbootstrapできる', async (context) => {
  const { env } = await fixture(context, 'lattice-launch-agent-reboot-');
  const control = launchctlDouble();
  await installBridgeLaunchAgent({ config: config(58_764), env, runner: control.runner,
    waitReady: async () => {} });
  const before = await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8');
  control.reboot();
  assert.equal(control.isLoaded(), false);
  const snapshot = await snapshotBridgeLaunchAgent({ env, runner: control.runner });
  assert.equal(snapshot.installed, true);
  assert.equal(snapshot.loaded, false);
  await control.runner(['bootstrap', `gui/${process.getuid()}`, bridgeLaunchAgentPaths(env).plist]);
  assert.equal(control.isLoaded(), true);
  assert.equal(await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8'), before);
});

test('launchctl bootstrap失敗はtyped errorで、symlink/緩いmode plistは変更前に拒否する',
  async (context) => {
    const { root, env } = await fixture(context, 'lattice-launch-agent-fail-');
    const control = launchctlDouble();
    control.failBootstrap();
    await assert.rejects(installBridgeLaunchAgent({ config: config(58_765), env,
      runner: control.runner, waitReady: async () => {} }), { code: 'BRIDGE_LAUNCHCTL_BOOTSTRAP_FAILED' });

    const refs = bridgeLaunchAgentPaths(env);
    await rm(refs.plist, { force: true });
    const target = path.join(root, 'target.plist');
    await writeFile(target, 'unsafe', { mode: 0o600 });
    await symlink(target, refs.plist);
    await assert.rejects(snapshotBridgeLaunchAgent({ env, runner: control.runner }),
      { code: 'BRIDGE_LAUNCH_AGENT_PLIST_UNSAFE' });
    await rm(refs.plist);
    await writeFile(refs.plist, 'unsafe', { mode: 0o644 });
    await chmod(refs.plist, 0o644);
    await assert.rejects(snapshotBridgeLaunchAgent({ env, runner: control.runner }),
      { code: 'BRIDGE_LAUNCH_AGENT_PLIST_UNSAFE' });
  });

test('registrar設定はplistへ焼き込まれる（launchdはshell環境を継承しない）', async (context) => {
  const { env } = await fixture(context, 'lattice-launch-agent-registrar-');
  const control = launchctlDouble();
  await installBridgeLaunchAgent({
    config: config(58_761),
    env: { ...env,
      LATTICE_BRIDGE_REGISTRAR_SSH_HOST: 'main-server',
      LATTICE_BRIDGE_REGISTRAR_SCRIPT: '/home/kite/license-server/bin/lattice-bridge-register.sh' },
    runner: control.runner,
    waitReady: async () => ({ pid: 43 }),
  });
  const content = await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8');
  assert.match(content, /<key>LATTICE_BRIDGE_REGISTRAR_SSH_HOST<\/key>\s*<string>main-server<\/string>/u);
  assert.match(content, /<key>LATTICE_BRIDGE_REGISTRAR_SCRIPT<\/key>\s*<string>\/home\/kite\/license-server\/bin\/lattice-bridge-register\.sh<\/string>/u);
});

test('registrar未設定のplistには登録用の環境変数を入れない', async (context) => {
  const { env } = await fixture(context, 'lattice-launch-agent-no-registrar-');
  const control = launchctlDouble();
  await installBridgeLaunchAgent({ config: config(58_762), env, runner: control.runner,
    waitReady: async () => ({ pid: 44 }) });
  const content = await readFile(bridgeLaunchAgentPaths(env).plist, 'utf8');
  assert.doesNotMatch(content, /LATTICE_BRIDGE_REGISTRAR/u);
});

test('registrarが片側だけの環境ではLaunchAgentを入れずtypedに落とす', async (context) => {
  const { env } = await fixture(context, 'lattice-launch-agent-partial-registrar-');
  const control = launchctlDouble();
  await assert.rejects(
    installBridgeLaunchAgent({ config: config(58_763),
      env: { ...env, LATTICE_BRIDGE_REGISTRAR_SSH_HOST: 'main-server' },
      runner: control.runner, waitReady: async () => ({ pid: 45 }) }),
    (error) => error?.code === 'BRIDGE_REGISTRAR_INVALID',
  );
});
