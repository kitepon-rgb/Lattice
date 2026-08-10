import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BRIDGE_HUB_HEARTBEAT_INTERVAL_MS, BridgeHubHeartbeatError,
  buildBridgeHubRegistrationRequest, createBridgeHubHeartbeatController,
  readOrCreateBridgeHubTerminalId, sendBridgeHubHeartbeat,
} from '../src/bridge-hub-heartbeat.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-hub-heartbeat-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, env: { LATTICE_CONFIG_DIR: root } };
}

function fetchStub(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  fn.calls = calls;
  return fn;
}

const jsonResponse = (status, body) => ({
  status, json: async () => body,
});

test('readOrCreateBridgeHubTerminalIdは初回に生成し以後同じ値を返す', async (context) => {
  const { env } = await fixture(context);
  const first = await readOrCreateBridgeHubTerminalId({ env });
  assert.match(first, /^[0-9a-f]{32}$/u);
  const second = await readOrCreateBridgeHubTerminalId({ env });
  assert.equal(second, first);
});

test('壊れたterminal identity fileはtypedに拒否し黙って作り直さない', async (context) => {
  const { root, env } = await fixture(context);
  await readOrCreateBridgeHubTerminalId({ env });
  await writeFile(path.join(root, 'bridge-hub-terminal.json'), '{"schema":"wrong"}\n', 'utf8');
  await assert.rejects(readOrCreateBridgeHubTerminalId({ env }),
    (error) => error instanceof BridgeHubHeartbeatError
      && error.code === 'BRIDGE_HUB_TERMINAL_IDENTITY_INVALID');
});

test('同時生成はcreate raceに負けた側も勝者の値を読む', async (context) => {
  const { env } = await fixture(context);
  const [left, right] = await Promise.all([
    readOrCreateBridgeHubTerminalId({ env }),
    readOrCreateBridgeHubTerminalId({ env }),
  ]);
  assert.equal(left, right);
});

test('buildBridgeHubRegistrationRequestはproject_idsを重複排除・整列しadoptなしで組む', () => {
  const request = buildBridgeHubRegistrationRequest({
    terminalId: 'terminal-1', port: 53_939, projectIds: ['zeta', 'alpha', 'alpha'],
  });
  assert.equal(request.schema, 'lattice.bridge_hub_registration_request.v1');
  assert.equal(request.terminal_id, 'terminal-1');
  assert.equal(request.port, 53_939);
  assert.deepEqual(request.project_ids, ['alpha', 'zeta']);
  assert.deepEqual(request.adopt, []);
  assert.equal(typeof request.display_name, 'string');
  assert.ok(request.display_name.length > 0);
});

test('project_idsが空ならtypedに拒否する（wireは1件以上を要求）', () => {
  assert.throws(
    () => buildBridgeHubRegistrationRequest({ terminalId: 'terminal-1', port: 53_939, projectIds: [] }),
    (error) => error instanceof BridgeHubHeartbeatError
      && error.code === 'BRIDGE_HUB_HEARTBEAT_REQUEST_INVALID',
  );
});

test('sendBridgeHubHeartbeatは200をacceptedとして返しbh2契約のpathへPOSTする', async () => {
  const fetchImpl = fetchStub(async () => jsonResponse(200, {
    schema: 'lattice.bridge_hub_registration_result.v1', terminal_id: 't1', registered: ['p1'], adopted: [],
  }));
  const request = buildBridgeHubRegistrationRequest({ terminalId: 't1', port: 53_939, projectIds: ['p1'] });
  const result = await sendBridgeHubHeartbeat({ hubUrl: 'http://192.168.1.2:8080/', request, fetchImpl });
  assert.equal(result.state, 'accepted');
  assert.equal(result.result.terminal_id, 't1');
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'http://192.168.1.2:8080/__lattice/hub/register');
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), request);
});

test('sendBridgeHubHeartbeatは非200をrejectedとして返す', async () => {
  const fetchImpl = fetchStub(async () => jsonResponse(409, {
    schema: 'lattice.bridge_hub_http_error.v1', code: 'BRIDGE_HUB_PROJECT_CONFLICT',
  }));
  const request = buildBridgeHubRegistrationRequest({ terminalId: 't1', port: 53_939, projectIds: ['p1'] });
  const result = await sendBridgeHubHeartbeat({ hubUrl: 'http://192.168.1.2:8080/', request, fetchImpl });
  assert.equal(result.state, 'rejected');
  assert.equal(result.status, 409);
  assert.equal(result.detail.code, 'BRIDGE_HUB_PROJECT_CONFLICT');
});

test('sendBridgeHubHeartbeatはnetwork failureを投げずunreachableとして返す', async () => {
  const fetchImpl = fetchStub(async () => { throw new Error('fetch failed'); });
  const request = buildBridgeHubRegistrationRequest({ terminalId: 't1', port: 53_939, projectIds: ['p1'] });
  const result = await sendBridgeHubHeartbeat({ hubUrl: 'http://192.168.1.2:8080/', request, fetchImpl });
  assert.equal(result.state, 'unreachable');
  assert.equal(typeof result.detail, 'string');
});

test('controllerはhub未設定ならfetchせずnullを返す', async (context) => {
  const { env } = await fixture(context);
  const fetchImpl = fetchStub(async () => jsonResponse(200, {}));
  const controller = createBridgeHubHeartbeatController({ env, fetchImpl });
  const result = await controller.tick({ config: { hub: null, listen: { address: '127.0.0.1', port: 1 } } });
  assert.equal(result, null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('controllerは活動projectが無ければfetchせずskipped_no_projectsを返す', async (context) => {
  const { env } = await fixture(context);
  const fetchImpl = fetchStub(async () => jsonResponse(200, {}));
  const controller = createBridgeHubHeartbeatController({ env, fetchImpl, readActiveProjects: async () => [] });
  const config = { hub: { url: 'http://192.168.1.2:8080/' }, listen: { address: '127.0.0.1', port: 53_939 } };
  const result = await controller.tick({ config });
  assert.equal(result.state, 'skipped_no_projects');
  assert.equal(fetchImpl.calls.length, 0);
});

test('controllerは初回tickで即送信しintervalMs未満の次tickは再送しない', async (context) => {
  const { env } = await fixture(context);
  const fetchImpl = fetchStub(async () => jsonResponse(200, {
    schema: 'lattice.bridge_hub_registration_result.v1', terminal_id: 't1', registered: ['p1'], adopted: [],
  }));
  let clock = 1_000_000;
  const controller = createBridgeHubHeartbeatController({
    env, fetchImpl, now: () => clock,
    readActiveProjects: async () => [{ project_id: 'p1', display_name: 'p1' }],
  });
  const config = { hub: { url: 'http://192.168.1.2:8080/' }, listen: { address: '127.0.0.1', port: 53_939 } };
  const first = await controller.tick({ config });
  assert.equal(first.state, 'accepted');
  assert.equal(fetchImpl.calls.length, 1);
  clock += 250;
  const second = await controller.tick({ config });
  assert.equal(second, first, 'must reuse the last result rather than resend inside the interval');
  assert.equal(fetchImpl.calls.length, 1, 'must not send again before BRIDGE_HUB_HEARTBEAT_INTERVAL_MS elapses');
  clock += BRIDGE_HUB_HEARTBEAT_INTERVAL_MS;
  await controller.tick({ config });
  assert.equal(fetchImpl.calls.length, 2, 'must send again once the interval elapses');
});

test('controllerはhubが外れたら次にhubが戻った時すぐ送信する（間隔状態を持ち越さない）', async (context) => {
  const { env } = await fixture(context);
  const fetchImpl = fetchStub(async () => jsonResponse(200, {
    schema: 'lattice.bridge_hub_registration_result.v1', terminal_id: 't1', registered: ['p1'], adopted: [],
  }));
  let clock = 0;
  const controller = createBridgeHubHeartbeatController({
    env, fetchImpl, now: () => clock,
    readActiveProjects: async () => [{ project_id: 'p1', display_name: 'p1' }],
  });
  const hubUrl = 'http://192.168.1.2:8080/';
  await controller.tick({ config: { hub: { url: hubUrl }, listen: { address: '127.0.0.1', port: 1 } } });
  assert.equal(fetchImpl.calls.length, 1);
  await controller.tick({ config: { hub: null, listen: { address: '127.0.0.1', port: 1 } } });
  clock += 1;
  await controller.tick({ config: { hub: { url: hubUrl }, listen: { address: '127.0.0.1', port: 1 } } });
  assert.equal(fetchImpl.calls.length, 2, 'must not treat disabling and re-enabling the hub as still inside the prior interval');
});
