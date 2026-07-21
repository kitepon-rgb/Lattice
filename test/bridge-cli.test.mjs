import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readBridgeConfig } from '../src/bridge-config.mjs';
import { runBridgeCli } from '../src/bridge-cli.mjs';

function output(isTTY = false) {
  let value = '';
  return { stream: { isTTY, write(chunk) { value += chunk; } }, read: () => value };
}

function launchAgentDouble({ calls = [], install = null } = {}) {
  let state = { installed: false, loaded: false, content: null };
  return {
    snapshot: async () => ({ ...state }),
    install: async (options) => {
      calls.push(`install:${options.config.listen.port}`);
      if (install !== null) await install(options);
      state = { installed: true, loaded: true, content: '<plist/>' };
    },
    disable: async () => { calls.push('disable'); state = { installed: false, loaded: false, content: null }; },
    restore: async ({ snapshot }) => { calls.push('restore'); state = { ...snapshot }; },
    state: () => ({ ...state }),
  };
}

test('bridge CLIはsetup/status/reconfigure/disableをJSON契約で提供する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_CONFIG_DIR: root };
  const calls = [];
  const daemon = { ensure: async () => { calls.push('ensure'); }, stop: async () => { calls.push('stop'); } };
  const launchAgent = launchAgentDouble({ calls });
  const invoke = async (argv) => {
    const stdout = output(); const stderr = output();
    const code = await runBridgeCli({ argv, stdout: stdout.stream, stderr: stderr.stream,
      env, daemon, launchAgent });
    return { code, stdout: stdout.read(), stderr: stderr.read() };
  };
  const initial = await invoke(['status', '--json']);
  assert.equal(initial.code, 0);
  assert.equal(JSON.parse(initial.stdout).enabled, false);
  const setup = await invoke(['setup', '--listen', '127.0.0.1', '--port', '58742', '--dashboard',
    '--allow-host', 'lattice.kitepon.dev', '--allow-host', 'dashboard.example', '--json']);
  assert.equal(setup.code, 0, setup.stderr);
  assert.equal(JSON.parse(setup.stdout).listen.port, 58_742);
  assert.deepEqual(JSON.parse(setup.stdout).allowed_hosts,
    ['127.0.0.1', 'dashboard.example', 'lattice.kitepon.dev']);
  const changed = await invoke(['reconfigure', '--upstream', 'http://127.0.0.1:4318', '--json']);
  assert.equal(changed.code, 0, changed.stderr);
  assert.equal(JSON.parse(changed.stdout).upstream.mode, 'url');
  const disabled = await invoke(['disable', '--json']);
  assert.equal(disabled.code, 0);
  assert.equal(JSON.parse(disabled.stdout).enabled, false);
  assert.deepEqual(calls, ['install:58742', 'install:58742', 'disable']);
});

test('bridge CLIは非JSON・低port・未知flagをtyped errorにする', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-cli-fail-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const argv of [
    ['setup'],
    ['setup', '--port', '4318', '--json'],
    ['setup', '--wat', '--json'],
  ]) {
    const stdout = output(); const stderr = output();
    const code = await runBridgeCli({ argv, stdout: stdout.stream, stderr: stderr.stream,
      env: { LATTICE_CONFIG_DIR: root }, daemon: { ensure: async () => {}, stop: async () => {} },
      launchAgent: launchAgentDouble() });
    assert.notEqual(code, 0);
    assert.equal(JSON.parse(stderr.read()).schema, 'lattice.cli_error.v2');
  }
});

test('daemon bind失敗はsetup configをrollbackし成功を返さない', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-cli-rollback-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const stdout = output(); const stderr = output();
  const failure = Object.assign(new Error('bind failed'), { code: 'BRIDGE_DAEMON_UNAVAILABLE' });
  const launchAgent = launchAgentDouble({ install: async () => { throw failure; } });
  const code = await runBridgeCli({
    argv: ['setup', '--listen', '127.0.0.1', '--port', '58743', '--json'],
    stdout: stdout.stream, stderr: stderr.stream, env: { LATTICE_CONFIG_DIR: root },
    daemon: { ensure: async () => {}, stop: async () => {} }, launchAgent,
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stderr.read()).code, 'BRIDGE_DAEMON_UNAVAILABLE');
  const statusOut = output();
  await runBridgeCli({ argv: ['status', '--json'], stdout: statusOut.stream, stderr: output().stream,
    env: { LATTICE_CONFIG_DIR: root } });
  assert.equal(JSON.parse(statusOut.read()).configured, false);
});

test('reconfigureのLaunchAgent起動失敗は旧config・旧agent・旧daemon所有状態へrollbackする',
  async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-agent-rollback-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const env = { LATTICE_CONFIG_DIR: root };
    let installCount = 0;
    const launchAgent = launchAgentDouble({ install: async () => {
      installCount += 1;
      if (installCount === 2) {
        throw Object.assign(new Error('bootstrap failed'), { code: 'BRIDGE_LAUNCHCTL_BOOTSTRAP_FAILED' });
      }
    } });
    const daemon = { ensure: async () => { throw new Error('loaded agent rollback must own daemon'); },
      stop: async () => {} };
    const invoke = async (argv) => {
      const stdout = output(); const stderr = output();
      const code = await runBridgeCli({ argv, stdout: stdout.stream, stderr: stderr.stream,
        env, daemon, launchAgent });
      return { code, stdout: stdout.read(), stderr: stderr.read() };
    };
    assert.equal((await invoke(['setup', '--listen', '127.0.0.1', '--port', '58746',
      '--dashboard', '--json'])).code, 0);
    const original = await readBridgeConfig({ env });
    const failed = await invoke(['reconfigure', '--port', '58747', '--json']);
    assert.equal(failed.code, 1);
    assert.equal(JSON.parse(failed.stderr).code, 'BRIDGE_LAUNCHCTL_BOOTSTRAP_FAILED');
    assert.deepEqual(await readBridgeConfig({ env }), original);
    assert.deepEqual(launchAgent.state(), { installed: true, loaded: true, content: '<plist/>' });
  });

test('対話setup wizardは安全側confirmからlisten/port/upstreamを収集して実行する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-wizard-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const answers = [true, '127.0.0.1', 'custom', '58750', 'dashboard', 'lattice.kitepon.dev'];
  const prompts = { isCancel: () => false,
    confirm: async () => answers.shift(), text: async () => answers.shift(), select: async () => answers.shift() };
  const stdout = output(true); const stderr = output();
  const code = await runBridgeCli({ argv: ['setup'], stdin: { isTTY: true }, stdout: stdout.stream,
    stderr: stderr.stream, env: { LATTICE_CONFIG_DIR: root }, prompts,
    daemon: { ensure: async () => {}, stop: async () => {} }, launchAgent: launchAgentDouble() });
  assert.equal(code, 0, stderr.read());
  assert.match(stdout.read(), /127\.0\.0\.1:58750/u);
  const statusOut = output();
  await runBridgeCli({ argv: ['status', '--json'], stdout: statusOut.stream, stderr: output().stream,
    env: { LATTICE_CONFIG_DIR: root } });
  const status = JSON.parse(statusOut.read());
  assert.equal(status.listen.port, 58_750);
  assert.deepEqual(status.allowed_hosts, ['127.0.0.1', 'lattice.kitepon.dev']);
});

test('wizardのenable拒否/cancelはconfigを変更せず非TTYはhangせず案内する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-wizard-cancel-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const stdout = output(true); const stderr = output();
  const launchAgent = launchAgentDouble();
  const code = await runBridgeCli({ argv: ['setup'], stdin: { isTTY: true }, stdout: stdout.stream,
    stderr: stderr.stream, env: { LATTICE_CONFIG_DIR: root },
    prompts: { isCancel: () => false, confirm: async () => false },
    daemon: { ensure: async () => { throw new Error('must not run'); }, stop: async () => {} }, launchAgent });
  assert.equal(code, 0);
  assert.match(stdout.read(), /変更していません/u);
  const canceled = Symbol('cancel');
  const canceledOut = output(true);
  const canceledCode = await runBridgeCli({ argv: ['setup'], stdin: { isTTY: true }, stdout: canceledOut.stream,
    stderr: output().stream, env: { LATTICE_CONFIG_DIR: root },
    prompts: { isCancel: (value) => value === canceled, confirm: async () => true, text: async () => canceled },
    daemon: { ensure: async () => { throw new Error('must not run'); }, stop: async () => {} }, launchAgent });
  assert.equal(canceledCode, 0);
  assert.match(canceledOut.read(), /変更していません/u);
  const nonTtyError = output();
  const nonTty = await runBridgeCli({ argv: ['setup'], stdin: { isTTY: false }, stdout: output().stream,
    stderr: nonTtyError.stream, env: { LATTICE_CONFIG_DIR: root }, launchAgent });
  assert.equal(nonTty, 2);
  assert.equal(JSON.parse(nonTtyError.read()).code, 'BRIDGE_SETUP_REQUIRES_TTY');
  const statusOut = output();
  await runBridgeCli({ argv: ['status', '--json'], stdout: statusOut.stream, stderr: output().stream,
    env: { LATTICE_CONFIG_DIR: root } });
  assert.equal(JSON.parse(statusOut.read()).configured, false);
});

test('lifecycle operation lockは遅延失敗Aのrollbackが後発成功Bを消さない', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-operation-lock-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_CONFIG_DIR: root };
  let releaseA;
  let enteredA;
  const aEntered = new Promise((resolve) => { enteredA = resolve; });
  const aGate = new Promise((resolve) => { releaseA = resolve; });
  let firstInstall = true;
  const launchAgent = launchAgentDouble({ install: async () => {
    if (!firstInstall) return;
    firstInstall = false;
    enteredA();
    await aGate;
    throw Object.assign(new Error('A failed'), { code: 'A_FAILED' });
  } });
  const invoke = (argv, daemon) => {
    const stdout = output(); const stderr = output();
    return runBridgeCli({ argv, stdout: stdout.stream, stderr: stderr.stream, env, daemon, launchAgent })
      .then((code) => ({ code, stdout: stdout.read(), stderr: stderr.read() }));
  };
  const first = invoke(['setup', '--listen', '127.0.0.1', '--port', '58751',
    '--upstream', 'http://127.0.0.1:4318', '--json'], { ensure: async () => {}, stop: async () => {} });
  await aEntered;
  const second = invoke(['setup', '--listen', '127.0.0.1', '--port', '58752',
    '--upstream', 'http://127.0.0.1:4319', '--json'], { ensure: async () => {}, stop: async () => {} });
  releaseA();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.code, 1);
  assert.equal(b.code, 0, b.stderr);
  const statusOut = output();
  await runBridgeCli({ argv: ['status', '--json'], stdout: statusOut.stream, stderr: output().stream, env });
  const final = JSON.parse(statusOut.read());
  assert.equal(final.listen.port, 58_752);
  assert.equal(final.upstream.url, 'http://127.0.0.1:4319/');
});

test('disableはdaemon停止受領証が得られなければ設定を消さず失敗する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-stop-gate-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_CONFIG_DIR: root };
  const installedAgent = launchAgentDouble();
  const invoke = async (argv, daemon, launchAgent = installedAgent) => {
    const stdout = output(); const stderr = output();
    const code = await runBridgeCli({ argv, stdout: stdout.stream, stderr: stderr.stream,
      env, daemon, launchAgent });
    return { code, stdout: stdout.read(), stderr: stderr.read() };
  };
  const daemon = { ensure: async () => {}, requestStop: async () => {
    throw Object.assign(new Error('stop receipt timed out'), { code: 'BRIDGE_DAEMON_STOP_FAILED' });
  } };
  assert.equal((await invoke(['setup', '--listen', '127.0.0.1', '--port', '58753',
    '--dashboard', '--json'], daemon)).code, 0);
  const unmanagedAgent = launchAgentDouble();
  const disabled = await invoke(['disable', '--json'], daemon, unmanagedAgent);
  assert.equal(disabled.code, 1);
  assert.equal(JSON.parse(disabled.stderr).code, 'BRIDGE_DAEMON_STOP_FAILED');
  assert.equal((await readBridgeConfig({ env })).enabled, true);
});
