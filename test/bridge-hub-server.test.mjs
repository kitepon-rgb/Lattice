import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyBridgeHubRegistration } from '../src/bridge-hub-protocol.mjs';
import {
  readBridgeHubRegistry, startBridgeHubServer, writeBridgeHubRegistry,
} from '../src/bridge-hub-server.mjs';

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
  return {
    read: async () => entries,
    write: async (next) => { entries = next; },
  };
}

async function registerTerminal(hub, overrides = {}) {
  const body = {
    schema: 'lattice.bridge_hub_registration_request.v1',
    terminal_id: 'terminal-a',
    display_name: 'terminal-a',
    port: 1,
    project_ids: ['project-a'],
    adopt: [],
    ...overrides,
  };
  const response = await fetch(`http://127.0.0.1:${hub.port}/__lattice/hub/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('2台の疑似端末を登録すると/projects/が合成一覧をJSON/HTML両方で返す', async (context) => {
  const terminalA = await terminalServer((_request, response) => response.end('a'));
  const terminalB = await terminalServer((_request, response) => response.end('b'));
  context.after(() => Promise.all([close(terminalA), close(terminalB)]));
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());

  const first = await registerTerminal(hub, {
    terminal_id: 'kikoeru-mac', display_name: 'kikoeru', port: portOf(terminalA), project_ids: ['kikoeru'],
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.registered, ['kikoeru']);
  const second = await registerTerminal(hub, {
    terminal_id: 'yuzu-win', display_name: 'yuzu-pc', port: portOf(terminalB), project_ids: ['chromeblocker'],
  });
  assert.equal(second.status, 200);

  const json = await (await fetch(`http://127.0.0.1:${hub.port}/projects/`, {
    headers: { accept: 'application/json' },
  })).json();
  assert.deepEqual(json.map((entry) => entry.project_id).sort(), ['chromeblocker', 'kikoeru']);
  assert.ok(json.every((entry) => entry.status === 'online'));
  // 内部の経路情報（terminal_id/address/port）は公開一覧に漏らさない。
  assert.ok(json.every((entry) => entry.address === undefined && entry.terminal_id === undefined));

  const htmlResponse = await fetch(`http://127.0.0.1:${hub.port}/projects/`);
  assert.match(htmlResponse.headers.get('content-type'), /text\/html/u);
  const html = await htmlResponse.text();
  assert.match(html, /kikoeru/u);
  assert.match(html, /yuzu-pc/u);
});

test('/projects/一覧の意匠はtodo-gantt-live.mjsの旧公開landingと同じ（LIVE DEVELOPMENT・カード型・kitepon.dev/GitHub誘導）を保つ', async (context) => {
  const terminal = await terminalServer((_request, response) => response.end('ok'));
  context.after(() => close(terminal));
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { terminal_id: 'kikoeru-mac', display_name: 'kikoeru',
    port: portOf(terminal), project_ids: ['kikoeru'] });

  const html = await (await fetch(`http://127.0.0.1:${hub.port}/projects/`)).text();
  // オーナー指摘（room 2474）: 旧landing（todo-gantt-live.mjsのdashboardHtml）の意匠から
  // 退行させない。ブランド・見出し・GitHub誘導・カード型list itemの構造を固定する。
  assert.match(html, /LIVE DEVELOPMENT/u);
  assert.match(html, /<h1>公開中の工程表<\/h1>/u);
  assert.match(html, /kitepon\.dev/u);
  assert.match(html, /github\.com\/kitepon-rgb\/Lattice/u);
  assert.match(html, /<li><a href="[^"]*"><strong>kikoeru<\/strong>/u);
  assert.match(html, /class="status-online">オンライン<\/span>/u);
});

test('オフライン端末は"status-offline"の語彙で明示される（意匠は保ったまま）', async (context) => {
  let clock = new Date('2026-08-10T00:00:00.000Z');
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
    now: () => clock, ttlMs: 1_000,
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { terminal_id: 'stale-term', display_name: 'stale',
    project_ids: ['stale-project'], port: 1 });
  clock = new Date(clock.getTime() + 2_000);

  const html = await (await fetch(`http://127.0.0.1:${hub.port}/projects/`)).text();
  assert.match(html, /class="status-offline">オフライン<\/span>/u);
});

test('/projects/<id>/*は所有端末のレスポンスへ中継される', async (context) => {
  let observedPath = null;
  const terminal = await terminalServer((request, response) => {
    observedPath = request.url;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('owned-terminal-body');
  });
  context.after(() => close(terminal));
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { project_ids: ['proj-a'], port: portOf(terminal) });

  const response = await fetch(`http://127.0.0.1:${hub.port}/projects/proj-a/widget?x=1`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'owned-terminal-body');
  assert.equal(observedPath, '/projects/proj-a/widget?x=1');
});

test('SSEチャンクはバッファリングされず届いた順に中継される', async (context) => {
  const terminal = await terminalServer((request, response) => {
    if (request.url !== '/projects/sse-project/events') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: state\ndata: {"n":1}\n\n');
    setTimeout(() => {
      response.write('event: state\ndata: {"n":2}\n\n');
      response.end();
    }, 200);
  });
  context.after(() => close(terminal));
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { project_ids: ['sse-project'], port: portOf(terminal) });

  const response = await fetch(`http://127.0.0.1:${hub.port}/projects/sse-project/events`);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  const startedWaitingAt = Date.now();
  const second = await reader.read();
  const elapsedMs = Date.now() - startedWaitingAt;
  assert.equal(second.done, false);
  // hubが全レスポンスをバッファしてから転送するなら、2回目のreadは(ほぼ)即座に
  // 返ってしまう。実際に150ms以上待たされることで、chunkごとの中継（非buffering）
  // を確認する。
  assert.ok(elapsedMs >= 150, `chunks should arrive with a gap, got ${elapsedMs}ms`);
});

test('許可外Hostへの421', async (context) => {
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${hub.port}/projects/`, { headers: { host: 'attacker.example' } },
      (incoming) => { let body = ''; incoming.on('data', (chunk) => { body += chunk; });
        incoming.on('end', () => resolve({ status: incoming.statusCode, body })); });
    request.once('error', reject); request.end();
  });
  assert.equal(result.status, 421);
  assert.match(result.body, /BRIDGE_HOST_NOT_ALLOWED/u);
});

test('未登録project_idへの404', async (context) => {
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  const response = await fetch(`http://127.0.0.1:${hub.port}/projects/never-registered/`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, 'BRIDGE_HUB_PROJECT_NOT_FOUND');
  assert.equal(body.project_id, 'never-registered');

  const htmlResponse = await fetch(`http://127.0.0.1:${hub.port}/projects/never-registered/`,
    { headers: { accept: 'text/html' } });
  assert.equal(htmlResponse.status, 404);
  assert.match(htmlResponse.headers.get('content-type'), /text\/html/u);
});

test('rootは/projects/へ301 redirectする（公開URLの玄関が404しない）', async (context) => {
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => hub.close());
  const response = await fetch(`http://127.0.0.1:${hub.port}/`, { redirect: 'manual' });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), '/projects/');
});

test('heartbeatが途絶えTTLを超えた端末は503で配信元オフラインを明示する', async (context) => {
  const terminal = await terminalServer((_request, response) => response.end('unreachable-once-offline'));
  context.after(() => close(terminal));
  const hub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
    ttlMs: 100,
  });
  context.after(() => hub.close());
  await registerTerminal(hub, { project_ids: ['stale-project'], port: portOf(terminal) });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const response = await fetch(`http://127.0.0.1:${hub.port}/projects/stale-project/`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'BRIDGE_HUB_PROJECT_OFFLINE');
  assert.match(body.message, /オフライン/u);

  const listing = await (await fetch(`http://127.0.0.1:${hub.port}/projects/`,
    { headers: { accept: 'application/json' } })).json();
  assert.equal(listing.find((entry) => entry.project_id === 'stale-project').status, 'offline');
});

/**
 * 明示bindの検証に使う「既定ではない、この機械に実在するアドレス」。
 * `127.0.0.2`は使えない——Linuxは127/8全体がloopbackに応答するがmacOSのlo0は
 * `127.0.0.1`しか持たず、EADDRNOTAVAILになる（実測）。この機械が実際に持つ
 * non-internalなIPv4を使えば3 OSとも同じ検証が走り、hubが本番でLAN literalへ
 * bindする形にも近い。持たない機械では既定へ落とす。
 */
function explicitBindAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

test('listenAddressは既定でloopbackだが明示すればそこへbindする', async (context) => {
  const defaultHub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']),
  });
  context.after(() => defaultHub.close());
  assert.equal(defaultHub.host, '127.0.0.1');

  const explicit = explicitBindAddress();
  const explicitHub = await startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set([explicit]), listenAddress: explicit,
  });
  context.after(() => explicitHub.close());
  assert.equal(explicitHub.host, explicit);
  const response = await fetch(`http://${explicit}:${explicitHub.port}/projects/`,
    { headers: { accept: 'application/json' } });
  assert.equal(response.status, 200);
});

test('不正なlistenAddressはtyped failでBRIDGE_HUB_CONFIG_INVALIDになる', async () => {
  await assert.rejects(startBridgeHubServer({
    registryStore: memoryRegistryStore(), allowedHosts: new Set(['127.0.0.1']), listenAddress: 'not-an-ip',
  }), (error) => error.code === 'BRIDGE_HUB_CONFIG_INVALID');
});

test('registryStoreのfile永続化はread/writeを往復できる', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-hub-registry-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_HUB_RUNTIME_DIR: root };

  const empty = await readBridgeHubRegistry({ env });
  assert.deepEqual(empty, []);

  const { registry } = applyBridgeHubRegistration({
    registry: [],
    request: {
      schema: 'lattice.bridge_hub_registration_request.v1',
      terminal_id: 'kikoeru-mac', display_name: 'kikoeru', port: 53_939,
      project_ids: ['kikoeru'], adopt: [],
    },
    remoteAddress: '192.168.1.42',
    now: new Date('2026-08-10T04:00:00.000Z'),
  });
  await writeBridgeHubRegistry({ env, entries: registry });
  const roundTripped = await readBridgeHubRegistry({ env });
  assert.deepEqual(roundTripped, registry);

  const registryFileStat = await stat(path.join(root, 'terminals.json'));
  assert.equal(registryFileStat.mode & 0o777, 0o600);
});
