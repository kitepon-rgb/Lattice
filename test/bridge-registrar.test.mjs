import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BridgeRegistrarError, bridgeRegistrarSettings, registerBridgeUpstream,
} from '../src/bridge-registrar.mjs';

const ENV = Object.freeze({
  LATTICE_BRIDGE_REGISTRAR_SSH_HOST: 'main-server',
  LATTICE_BRIDGE_REGISTRAR_SCRIPT: '/home/kite/license-server/bin/lattice-bridge-register.sh',
});

function runner(reply) {
  const calls = [];
  const fn = (file, args, options, callback) => {
    calls.push({ file, args, options });
    reply(callback);
  };
  fn.calls = calls;
  return fn;
}
const ok = (stdout) => (callback) => callback(null, stdout, '');
const failure = (message, stderr = '') => (callback) => callback(new Error(message), '', stderr);

test('未設定なら登録せずnot_configuredを返す', async () => {
  const run = runner(ok('{}'));
  const result = await registerBridgeUpstream({ port: 53_939, env: {}, runner: run });
  assert.equal(result.state, 'not_configured');
  assert.deepEqual(run.calls, [], 'ssh must not run when unconfigured');
});

test('片側だけ設定されていたら黙って飛ばさずtypedに落とす', () => {
  assert.throws(
    () => bridgeRegistrarSettings({ LATTICE_BRIDGE_REGISTRAR_SSH_HOST: 'main-server' }),
    (error) => error instanceof BridgeRegistrarError && error.code === 'BRIDGE_REGISTRAR_INVALID',
  );
});

test('ssh宛先とscript pathは形を検証する', () => {
  for (const env of [
    { ...ENV, LATTICE_BRIDGE_REGISTRAR_SSH_HOST: 'main server' },
    { ...ENV, LATTICE_BRIDGE_REGISTRAR_SSH_HOST: '-oProxyCommand=touch /tmp/x' },
    { ...ENV, LATTICE_BRIDGE_REGISTRAR_SCRIPT: 'relative/path.sh' },
    { ...ENV, LATTICE_BRIDGE_REGISTRAR_SCRIPT: '/opt/x.sh; rm -rf /' },
  ]) {
    assert.throws(() => bridgeRegistrarSettings(env),
      (error) => error.code === 'BRIDGE_REGISTRAR_INVALID', JSON.stringify(env));
  }
});

test('アドレスは送らずportだけを固定形で渡す', async () => {
  const run = runner(ok('{"changed":true,"upstream":"192.168.1.103:53939"}'));
  const result = await registerBridgeUpstream({ port: 53_939, env: ENV, runner: run });

  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].file, 'ssh');
  assert.deepEqual(run.calls[0].args, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    'main-server', '/home/kite/license-server/bin/lattice-bridge-register.sh', '53939']);
  assert.equal(run.calls[0].args.some((arg) => arg.includes('192.168.')), false,
    'address must come from the ssh source, never from us');
  assert.equal(result.state, 'updated');
  assert.equal(result.remote.upstream, '192.168.1.103:53939');
});

test('変更が無ければunchangedとして返す', async () => {
  const run = runner(ok('{"changed":false,"upstream":"192.168.1.103:53939"}'));
  const result = await registerBridgeUpstream({ port: 53_939, env: ENV, runner: run });
  assert.equal(result.state, 'unchanged');
});

test('ssh失敗はthrowせずtypedなfailedとして返す', async () => {
  const run = runner(failure('exit 255', 'ssh: connect to host main-server port 22: No route to host'));
  const result = await registerBridgeUpstream({ port: 53_939, env: ENV, runner: run });
  assert.equal(result.state, 'failed');
  assert.match(result.detail, /No route to host/u);
});

test('remoteが解釈不能な出力を返したらfailedにする（成功へ丸めない）', async () => {
  const run = runner(ok('registration complete'));
  const result = await registerBridgeUpstream({ port: 53_939, env: ENV, runner: run });
  assert.equal(result.state, 'failed');
  assert.match(result.detail, /no parsable result/u);
});

test('不正なportはtypedに拒否する', async () => {
  await assert.rejects(registerBridgeUpstream({ port: 0, env: ENV, runner: runner(ok('{}')) }),
    (error) => error.code === 'BRIDGE_REGISTRAR_INVALID');
});
