import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { configureBridge, disableBridge } from '../src/bridge-config.mjs';
import { writeTodoDashboardDaemonDescriptor } from '../src/todo-dashboard-registry.mjs';
import {
  bridgeRuntimeController, resolveBridgeUpstream, startBridgeServer,
} from '../src/bridge-server.mjs';
import {
  createTodoGanttProjectRegistry, startTodoGanttDashboardServer,
} from '../src/todo-gantt-live.mjs';

function upstreamServer(handler) {
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

async function rootFixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-runtime-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { LATTICE_CONFIG_DIR: root, LATTICE_DASHBOARD_RUNTIME_DIR: path.join(root, 'dashboard') };
}

test('bridgeはHTMLとSSEを透過proxyしhealthはupstreamへ流さない', async (context) => {
  const upstream = await upstreamServer((request, response) => {
    if (request.url === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('event: state\ndata: {"ok":true}\n\n');
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<h1>Lattice</h1>');
    }
  });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_738 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  assert.match(await (await fetch('http://127.0.0.1:58738/')).text(), /Lattice/u);
  const events = await fetch('http://127.0.0.1:58738/events');
  assert.equal(events.headers.get('content-type'), 'text/event-stream');
  assert.match(await events.text(), /event: state/u);
  const publicHealth = await (await fetch('http://127.0.0.1:58738/__lattice/bridge-health')).json();
  assert.equal(publicHealth.schema, 'lattice.bridge_health.v1');
  assert.equal(publicHealth.pid, undefined);
  assert.equal(publicHealth.updated_at, undefined);
});

test('dynamic descriptor modeはdashboard restart後のportを毎requestで再解決する', async (context) => {
  const first = await upstreamServer((_request, response) => response.end('first'));
  const second = await upstreamServer((_request, response) => response.end('second'));
  context.after(() => Promise.all([close(first), close(second)]));
  let selected = portOf(first);
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_739 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'dashboard_descriptor' } };
  const bridge = await startBridgeServer({ config,
    resolveUpstream: async () => new URL(`http://127.0.0.1:${selected}/`) });
  context.after(() => bridge.close());
  assert.equal(await (await fetch('http://127.0.0.1:58739/')).text(), 'first');
  selected = portOf(second);
  assert.equal(await (await fetch('http://127.0.0.1:58739/')).text(), 'second');
});

test('runtime controllerは設定変更を反映しdisableでbridgeだけ停止する', async (context) => {
  const env = await rootFixture(context);
  const upstream = await upstreamServer((_request, response) => response.end('local dashboard alive'));
  context.after(() => close(upstream));
  await configureBridge({ address: '127.0.0.1', port: 58_740, env,
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } });
  const controller = bridgeRuntimeController({ env });
  context.after(() => controller.close());
  const active = await controller.reconcile();
  assert.equal(await (await fetch('http://127.0.0.1:58740/')).text(), 'local dashboard alive');
  await configureBridge({ address: '127.0.0.1', env,
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/base` } });
  assert.equal(await controller.reconcile(), active);
  await disableBridge({ env });
  assert.equal(await controller.reconcile(), null);
  await assert.rejects(fetch('http://127.0.0.1:58740/', { signal: AbortSignal.timeout(300) }));
  assert.equal(await (await fetch(`http://127.0.0.1:${portOf(upstream)}/`)).text(), 'local dashboard alive');
});

test('upstream unavailableはtyped 503でbridge processを維持する', async (context) => {
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_741 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'dashboard_descriptor' } };
  const error = new Error('missing'); error.code = 'BRIDGE_UPSTREAM_UNAVAILABLE';
  const bridge = await startBridgeServer({ config, resolveUpstream: async () => { throw error; } });
  context.after(() => bridge.close());
  const response = await fetch('http://127.0.0.1:58741/');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'BRIDGE_UPSTREAM_UNAVAILABLE');
  assert.equal((await fetch('http://127.0.0.1:58741/__lattice/bridge-health')).status, 200);
});

test('absolute-form・base path逸脱request-targetを400で拒否し外部originへ転送しない', async (context) => {
  let requests = 0;
  const upstream = await upstreamServer((_request, response) => { requests += 1; response.end('unexpected'); });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_744 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/base/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  for (const target of ['http://127.0.0.1:1/evil', '/../escape']) {
    const raw = await new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: 58_744 });
      let received = '';
      socket.setEncoding('utf8');
      socket.once('error', reject);
      socket.on('data', (chunk) => { received += chunk; });
      socket.once('close', () => resolve(received));
      socket.once('connect', () => socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    });
    assert.match(raw, /^HTTP\/1\.1 400/u);
    assert.match(raw, /BRIDGE_REQUEST_TARGET_INVALID/u);
  }
  assert.equal(requests, 0);
});

test('Connectionで指名されたhop-by-hop headerをrequest/response双方から除去する', async (context) => {
  let leakedRequestHeader = null;
  const upstream = await upstreamServer((request, response) => {
    leakedRequestHeader = request.headers['x-remove-me'];
    response.writeHead(200, { connection: 'x-secret', 'x-secret': 'must-not-forward', 'x-end-to-end': 'kept' });
    response.end('ok');
  });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_745 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest('http://127.0.0.1:58745/', {
      headers: { connection: 'x-remove-me', 'x-remove-me': 'must-not-forward' },
    }, (incoming) => {
      let body = '';
      incoming.setEncoding('utf8'); incoming.on('data', (chunk) => { body += chunk; });
      incoming.on('end', () => resolve({ incoming, body }));
    });
    request.once('error', reject); request.end();
  });
  assert.equal(response.body, 'ok');
  assert.equal(leakedRequestHeader, undefined);
  assert.equal(response.incoming.headers['x-secret'], undefined);
  assert.equal(response.incoming.headers['x-end-to-end'], 'kept');
});

test('percent-encoded route delimiter/dot/controlをfail closedにする', async (context) => {
  let requests = 0;
  const upstream = await upstreamServer((_request, response) => { requests += 1; response.end('unexpected'); });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_753 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/base/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  for (const target of ['/safe%2Fescape', '/safe%5cescape', '/%2e%2E/escape', '/%252fescape', '/%00',
    '/safe/../__lattice/health']) {
    const raw = await new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: 58_753 });
      let received = ''; socket.setEncoding('utf8'); socket.once('error', reject);
      socket.on('data', (chunk) => { received += chunk; }); socket.once('close', () => resolve(received));
      socket.once('connect', () => socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    });
    assert.match(raw, /^HTTP\/1\.1 400/u, target);
  }
  assert.equal(requests, 0);
});

test('downstream abortはupstream SSE connectionをdestroyして残留させない', async (context) => {
  let upstreamClosed = false;
  const upstream = await upstreamServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: state\ndata: {}\n\n');
    request.socket.once('close', () => { upstreamClosed = true; });
  });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_754 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  const controller = new AbortController();
  const response = await fetch('http://127.0.0.1:58754/events', { signal: controller.signal });
  await response.body.getReader().read();
  controller.abort();
  const deadline = Date.now() + 2_000;
  while (!upstreamClosed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(upstreamClosed, true);
});

test('dashboard descriptor modeはloopback healthのpid/port不一致を503相当で拒否する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-stale-dashboard-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const unrelated = await upstreamServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ schema: 'lattice.todo_dashboard_health.v1', pid: 999, port: portOf(unrelated) }));
  });
  context.after(() => close(unrelated));
  const runtime = path.join(root, 'dashboard'); await mkdir(runtime);
  await writeFile(path.join(runtime, 'daemon.json'), `${JSON.stringify({
    schema: 'lattice.todo_dashboard_daemon.v1', pid: 123, port: portOf(unrelated),
    started_at: '2026-07-21T12:00:00.000Z',
  })}\n`, { mode: 0o600 });
  await assert.rejects(resolveBridgeUpstream({ mode: 'dashboard_descriptor' }, {
    env: { LATTICE_CONFIG_DIR: root, LATTICE_DASHBOARD_RUNTIME_DIR: runtime },
  }), (error) => error.code === 'BRIDGE_UPSTREAM_UNAVAILABLE');
});

test('dashboard descriptor modeは実loopback dashboardのdescriptor/health一致だけを受理する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-real-dashboard-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_CONFIG_DIR: root, LATTICE_DASHBOARD_RUNTIME_DIR: path.join(root, 'dashboard') };
  const dashboard = await startTodoGanttDashboardServer({
    registry: createTodoGanttProjectRegistry([]), port: 0,
  });
  context.after(() => dashboard.close());
  await writeTodoDashboardDaemonDescriptor({ port: dashboard.port, env });
  const resolved = await resolveBridgeUpstream({ mode: 'dashboard_descriptor' }, { env });
  assert.equal(resolved.href, `http://127.0.0.1:${dashboard.port}/`);
});

test('dashboard descriptorはregular 0600・symlinkなし・duplicate keyなしを必須にする', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-dashboard-descriptor-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'dashboard'); await mkdir(runtime);
  const ref = path.join(runtime, 'daemon.json');
  const env = { LATTICE_CONFIG_DIR: root, LATTICE_DASHBOARD_RUNTIME_DIR: runtime };
  const valid = '{"schema":"lattice.todo_dashboard_daemon.v1","pid":123,"port":58759,"started_at":"2026-07-21T12:00:00.000Z"}\n';
  await writeFile(ref, valid, { mode: 0o644 });
  await assert.rejects(resolveBridgeUpstream({ mode: 'dashboard_descriptor' }, { env }),
    (error) => error.code === 'BRIDGE_UPSTREAM_UNAVAILABLE');
  await chmod(ref, 0o600);
  await writeFile(ref,
    '{"schema":"lattice.todo_dashboard_daemon.v1","pid":123,"pid":123,"port":58759,"started_at":"2026-07-21T12:00:00.000Z"}\n');
  await assert.rejects(resolveBridgeUpstream({ mode: 'dashboard_descriptor' }, { env }),
    (error) => error.code === 'BRIDGE_UPSTREAM_UNAVAILABLE');
  const target = path.join(runtime, 'target.json');
  await writeFile(target, valid, { mode: 0o600 });
  await rm(ref); await symlink(target, ref);
  await assert.rejects(resolveBridgeUpstream({ mode: 'dashboard_descriptor' }, { env }),
    (error) => error.code === 'BRIDGE_UPSTREAM_UNAVAILABLE');
});

test('bridge経由のdashboard内部healthはdenyしmetadataを公開しない', async (context) => {
  let requests = 0;
  const upstream = await upstreamServer((_request, response) => { requests += 1; response.end('secret metadata'); });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_755 }, allowed_hosts: ['127.0.0.1'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  const response = await fetch('http://127.0.0.1:58755/__lattice/health');
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, 'BRIDGE_INTERNAL_PATH_DENIED');
  assert.equal(requests, 0);
  const encoded = await fetch('http://127.0.0.1:58755/__lattice/%68ealth');
  assert.equal(encoded.status, 404);
  assert.equal((await encoded.json()).code, 'BRIDGE_INTERNAL_PATH_DENIED');
  assert.equal(requests, 0);
});

test('inbound Forwarded系を全削除して検証済Hostとremote addressから再生成する', async (context) => {
  let observed;
  const upstream = await upstreamServer((request, response) => { observed = request.headers; response.end('ok'); });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_756 },
    allowed_hosts: ['127.0.0.1', 'lattice.kitepon.dev'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest('http://127.0.0.1:58756/', { headers: {
      host: 'lattice.kitepon.dev', forwarded: 'for=evil;host=evil.example;proto=https',
      'x-forwarded-for': '203.0.113.9', 'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https', 'x-forwarded-port': '443', 'x-real-ip': '203.0.113.9',
      'cf-connecting-ip': '203.0.113.9', 'true-client-ip': '203.0.113.9',
    } }, (incoming) => { incoming.resume(); incoming.once('end', () => resolve(incoming)); });
    request.once('error', reject); request.end();
  });
  assert.equal(response.statusCode, 200);
  assert.equal(observed['x-forwarded-host'], 'lattice.kitepon.dev');
  assert.equal(observed['x-forwarded-proto'], 'http');
  assert.equal(observed['x-forwarded-port'], undefined);
  assert.equal(observed['cf-connecting-ip'], undefined);
  assert.equal(observed['true-client-ip'], undefined);
  assert.notEqual(observed['x-forwarded-for'], '203.0.113.9');
  assert.notEqual(observed['x-real-ip'], '203.0.113.9');
  assert.match(observed.forwarded, /host="lattice\.kitepon\.dev";proto=http/u);
  assert.doesNotMatch(observed.forwarded, /evil/u);
});

test('Host allowlist不一致を421で拒否しDNS rebinding originへ工程情報を返さない', async (context) => {
  let requests = 0;
  const upstream = await upstreamServer((_request, response) => { requests += 1; response.end('private graph'); });
  context.after(() => close(upstream));
  const config = { enabled: true, listen: { address: '127.0.0.1', port: 58_757 },
    allowed_hosts: ['127.0.0.1', 'lattice.kitepon.dev'],
    upstream: { mode: 'url', url: `http://127.0.0.1:${portOf(upstream)}/` } };
  const bridge = await startBridgeServer({ config });
  context.after(() => bridge.close());
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest('http://127.0.0.1:58757/', { headers: { host: 'attacker.example' } },
      (incoming) => { let body = ''; incoming.on('data', (chunk) => { body += chunk; });
        incoming.on('end', () => resolve({ status: incoming.statusCode, body })); });
    request.once('error', reject); request.end();
  });
  assert.equal(result.status, 421);
  assert.match(result.body, /BRIDGE_HOST_NOT_ALLOWED/u);
  assert.equal(requests, 0);
});
