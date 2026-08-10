/**
 * bh4 — hub + 疑似端末2台の統合テスト（plan_bridge-hub.md 受入条件2の閉じ）。
 *
 * bh2の`test/bridge-hub-server.test.mjs`は各エンドポイントを単体で検証する。
 * ここでは複数端末が同時に混在する状態（片方online・片方offline）と、
 * SSEの接続ライフサイクル（初回state・切断後の再接続での再送）という、
 * 単体testでは組み合わせないと見えない振る舞いだけを対象にする。
 * 実LAN・実Caddyには依存せずloopback上の疑似端末で完結させる。
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { startBridgeHubServer } from '../src/bridge-hub-server.mjs';

function terminalServer(handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve(server));
  });
}

function portOf(server) { return server.address().port; }
function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function memoryRegistryStore(initial = []) {
  let entries = initial;
  return { read: async () => entries, write: async (next) => { entries = next; } };
}

async function registerTerminal(hub, overrides = {}) {
  const body = {
    schema: 'lattice.bridge_hub_registration_request.v1',
    terminal_id: 'terminal', display_name: 'terminal', port: 1,
    project_ids: ['project'], adopt: [], ...overrides,
  };
  const response = await fetch(`http://127.0.0.1:${hub.port}/__lattice/hub/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `registration must succeed: ${JSON.stringify(result)}`);
  return result;
}

test('疑似2端末が同時に登録された状態で片方だけheartbeatが途絶えると、合成一覧は両方の状態を同時に正しく出す', async (context) => {
  const online = await terminalServer((_request, response) => response.end('online-body'));
  const offline = await terminalServer((_request, response) => response.end('offline-body'));
  context.after(() => Promise.all([close(online), close(offline)]));
  let clock = new Date('2026-08-10T00:00:00.000Z');
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
    now: () => clock, ttlMs: 1_000,
  });
  context.after(() => hub.close());

  await registerTerminal(hub, {
    terminal_id: 'kikoeru-mac', display_name: 'kikoeru', port: portOf(online), project_ids: ['kikoeru'],
  });
  await registerTerminal(hub, {
    terminal_id: 'chromeblocker-win', display_name: 'ChromeBlocker', port: portOf(offline),
    project_ids: ['chromeblocker'],
  });
  // kikoeruだけがheartbeatを継続し、chromeblockerは以後heartbeatが来ない（端末が落ちた想定）。
  clock = new Date(clock.getTime() + 1_500);
  await registerTerminal(hub, {
    terminal_id: 'kikoeru-mac', display_name: 'kikoeru', port: portOf(online), project_ids: ['kikoeru'],
  });

  const listing = await (await fetch(`http://127.0.0.1:${hub.port}/projects/`,
    { headers: { accept: 'application/json' } })).json();
  const byId = Object.fromEntries(listing.map((entry) => [entry.project_id, entry]));
  assert.equal(byId.kikoeru.status, 'online');
  assert.equal(byId.chromeblocker.status, 'offline', 'the terminal that stopped heartbeating must show offline');

  const onlineProxy = await fetch(`http://127.0.0.1:${hub.port}/projects/kikoeru/`);
  assert.equal(onlineProxy.status, 200);
  assert.equal(await onlineProxy.text(), 'online-body');

  const offlineProxy = await fetch(`http://127.0.0.1:${hub.port}/projects/chromeblocker/`);
  assert.equal(offlineProxy.status, 503, 'proxying to the offline project must not silently hang or 200');
  assert.equal((await offlineProxy.json()).code, 'BRIDGE_HUB_PROJECT_OFFLINE');
});

test('SSEは新しい接続のたびに初回stateを即座に送る（再接続はhub側に持ち越し状態を残さない）', async (context) => {
  let connectionCount = 0;
  // 各接続は「初回eventを送ってすぐ終える」ことで、実際のSSE配信を模しつつも
  // client/hub/terminal間のstream終了処理に依存せず短時間で完結させる
  // （読みかけのstreamをclient側でcancelする経路はhung-close耐性が層を跨ぐほど
  // 弱くなるため、疑似端末を「即応して閉じる」設計にして避けた）。
  const terminal = await terminalServer((request, response) => {
    if (request.url !== '/projects/live/events') { response.writeHead(404).end(); return; }
    connectionCount += 1;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`event: state\ndata: {"connection":${connectionCount}}\n\n`);
  });
  context.after(() => close(terminal));
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { project_ids: ['live'], port: portOf(terminal) });

  const readInitialEvent = async () => {
    const response = await fetch(`http://127.0.0.1:${hub.port}/projects/live/events`);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    return response.text();
  };

  const first = await readInitialEvent();
  assert.match(first, /event: state/u);
  assert.match(first, /"connection":1/u);
  // 「再接続」＝クライアントが新しいHTTP requestを張ること。hubはconnection単位で
  // stateを覚えていないので、2回目も独立した初回eventが即座に届くはずである。
  const second = await readInitialEvent();
  assert.match(second, /event: state/u);
  assert.match(second, /"connection":2/u);
  assert.equal(connectionCount, 2, 'each fetch must open its own upstream connection, not reuse a cached one');
});

test('heartbeatはonlineのまま端末processが停止していると、proxyはhangせず502で失敗を明示する', async (context) => {
  const terminal = await terminalServer((_request, response) => response.end('will-be-stopped'));
  const port = portOf(terminal);
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { project_ids: ['dying'], port });
  // registry上はまだTTL内＝onlineのまま。だが実processは落ちている——
  // heartbeatだけでは検知できないこの隙間を、proxy自体のエラー処理が拾う想定。
  await close(terminal);

  const listing = await (await fetch(`http://127.0.0.1:${hub.port}/projects/`,
    { headers: { accept: 'application/json' } })).json();
  assert.equal(listing.find((entry) => entry.project_id === 'dying').status, 'online',
    'registry staleness is heartbeat-based only; a dead process does not flip this by itself');

  const response = await fetch(`http://127.0.0.1:${hub.port}/projects/dying/`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'BRIDGE_HUB_UPSTREAM_REFUSED');
});
