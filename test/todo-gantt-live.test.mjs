import assert from 'node:assert/strict';
import { connect } from 'node:net';
import test from 'node:test';

import {
  createTodoGanttProjectRegistry,
  startTodoGanttDashboardServer,
  startTodoGanttLiveServer,
} from '../src/todo-gantt-live.mjs';

test('live ganttはloopback限定でHTMLを配信しhead変更をSSE通知する', async (context) => {
  let head = 'a'.repeat(64);
  const live = await startTodoGanttLiveServer({
    projectId: 'fixture-project',
    port: 0,
    render: async () => ({
      html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'\"></head><body>fixture</body></html>",
      head_digest: head,
    }),
    readHead: async () => head,
  });
  context.after(() => live.close());
  assert.equal(live.host, '127.0.0.1');
  assert.equal(live.projectPath, '/projects/fixture-project/');
  assert.equal(live.eventsPath, '/projects/fixture-project/events');
  const page = await fetch(live.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /connect-src 'self'/u);
  assert.match(html, /EventSource\("\/projects\/fixture-project\/events"\)/u);

  const root = await fetch(`http://${live.host}:${live.port}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/projects/fixture-project/');

  const controller = new AbortController();
  context.after(() => controller.abort());
  const events = await fetch(live.eventsUrl, { signal: controller.signal });
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let text = decoder.decode((await reader.read()).value, { stream: true });
  assert.match(text, new RegExp(`data: \\{"head_digest":"${'a'.repeat(64)}"\\}`, 'u'));
  head = 'b'.repeat(64);
  const deadline = Date.now() + 3_000;
  while (!text.includes(head) && Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.match(text, new RegExp(head, 'u'));
  controller.abort();
});

test('live ganttはprojectごとに固有URLとSSE経路を返す', async (context) => {
  const servers = await Promise.all(['lattice', 'aishell'].map((projectId) =>
    startTodoGanttLiveServer({
      projectId,
      port: 0,
      render: async () => ({ html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'\"></head><body>fixture</body></html>", head_digest: projectId }),
      readHead: async () => projectId,
    })));
  context.after(() => Promise.all(servers.map((server) => server.close())));

  assert.notEqual(servers[0].url, servers[1].url);
  assert.match(servers[0].url, /\/projects\/lattice\/$/u);
  assert.match(servers[1].url, /\/projects\/aishell\/$/u);
  assert.match(servers[0].eventsUrl, /\/projects\/lattice\/events$/u);
  assert.match(servers[1].eventsUrl, /\/projects\/aishell\/events$/u);
});

test('dashboardはactive project一覧とproject別工程表を同じdisplay nameで配信する', async (context) => {
  const renderCalls = [];
  const registry = createTodoGanttProjectRegistry([
    { projectId: 'aishell', displayName: 'AIShell',
      render: async (identity) => {
        renderCalls.push(identity);
        return { html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head><body>AIShell</body></html>", head_digest: 'a' };
      }, readHead: async () => 'a' },
    { projectId: 'lattice', displayName: 'Lattice',
      render: async () => ({ html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head><body>Lattice</body></html>", head_digest: 'b' }),
      readHead: async () => 'b' },
  ]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port: 0 });
  context.after(() => dashboard.close());

  for (const path of ['/', '/projects/']) {
    const response = await fetch(new URL(path, dashboard.url));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /AIShell/u);
    assert.match(html, /Lattice/u);
    assert.match(html, /\/projects\/aishell\//u);
    assert.match(html, /公開中の工程表/u);
    assert.match(html, /https:\/\/kitepon\.dev\//u);
    assert.match(html, /https:\/\/github\.com\/kitepon-rgb\/Lattice/u);
    assert.match(html, /name="robots" content="noindex, nofollow"/u);
  }
  const project = await fetch(new URL('/projects/aishell/', dashboard.url));
  assert.equal(project.status, 200);
  assert.match(await project.text(), /AIShell/u);
  assert.deepEqual(renderCalls, [{ projectId: 'aishell', displayName: 'AIShell' }]);
});

test('dashboardは未知project・未知path・非GETをtyped HTTP errorにしsilent fallbackしない', async (context) => {
  const dashboard = await startTodoGanttDashboardServer({
    registry: createTodoGanttProjectRegistry([]), port: 0,
  });
  context.after(() => dashboard.close());

  const cases = [
    ['/projects/unknown/', {}, 404, 'PROJECT_NOT_FOUND'],
    ['/unknown', {}, 404, 'ROUTE_NOT_FOUND'],
    ['/projects/', { method: 'POST' }, 405, 'METHOD_NOT_ALLOWED'],
  ];
  for (const [path, options, status, code] of cases) {
    const response = await fetch(new URL(path, dashboard.url), options);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), {
      schema: 'lattice.todo_gantt_http_error.v1', code, path,
    });
  }
});

test('dashboard registryは運転中にprojectを追加・除外できcloseは冪等', async () => {
  const registry = createTodoGanttProjectRegistry([]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port: 0 });
  registry.register({ projectId: 'late', displayName: '後から登録',
    render: async () => ({ html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head><body>late</body></html>", head_digest: 'c' }),
    readHead: async () => 'c' });
  assert.equal((await fetch(new URL('/projects/late/', dashboard.url))).status, 200);
  registry.unregister('late');
  assert.equal((await fetch(new URL('/projects/late/', dashboard.url))).status, 404);
  await dashboard.close();
  await dashboard.close();
});

test('async render rejectionとSSE初期head失敗を内部で閉じdaemonを継続する', async (context) => {
  const brokenRender = new Error('render failed'); brokenRender.code = 'RENDER_FAILED';
  const brokenHead = new Error('head failed'); brokenHead.code = 'HEAD_FAILED';
  const registry = createTodoGanttProjectRegistry([
    { projectId: 'render-broken', displayName: 'Render broken',
      render: async () => { throw brokenRender; }, readHead: async () => 'unused' },
    { projectId: 'head-broken', displayName: 'Head broken',
      render: async () => ({ html: '<html><body></body></html>', head_digest: 'unused' }),
      readHead: async () => { throw brokenHead; } },
  ]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port: 0 });
  context.after(() => dashboard.close());

  const renderResponse = await fetch(new URL('/projects/render-broken/', dashboard.url));
  assert.equal(renderResponse.status, 500);
  assert.equal((await renderResponse.json()).code, 'RENDER_FAILED');
  const events = await fetch(new URL('/projects/head-broken/events', dashboard.url));
  assert.equal(events.status, 200);
  const body = await events.text();
  assert.match(body, /event: lattice-error/u);
  assert.match(body, /"code":"HEAD_FAILED"/u);
  assert.equal((await fetch(new URL('/__lattice/health', dashboard.url))).status, 200);
});

test('invalid request-targetを受けてもrequest handler rejectionでdaemonが落ちない', async (context) => {
  const dashboard = await startTodoGanttDashboardServer({
    registry: createTodoGanttProjectRegistry([]), port: 0,
  });
  context.after(() => dashboard.close());
  const rawResponse = await new Promise((resolve, reject) => {
    const socket = connect({ host: dashboard.host, port: dashboard.port });
    let received = '';
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.on('data', (chunk) => { received += chunk; });
    socket.once('close', () => resolve(received));
    socket.once('connect', () => socket.end('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
  });
  assert.match(rawResponse, /^HTTP\/1\.1 (?:400|500)/u);
  assert.equal((await fetch(new URL('/__lattice/health', dashboard.url))).status, 200);
});

test('project unregisterは他projectを残したまま対象SSE viewerを終了する', async (context) => {
  const descriptor = (projectId) => ({ projectId, displayName: projectId,
    render: async () => ({ html: '<html><body></body></html>', head_digest: projectId }),
    readHead: async () => projectId });
  const registry = createTodoGanttProjectRegistry([descriptor('remove-me'), descriptor('keep-me')]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port: 0 });
  context.after(() => dashboard.close());
  const events = await fetch(new URL('/projects/remove-me/events', dashboard.url));
  const reader = events.body.getReader();
  assert.equal((await reader.read()).done, false);
  registry.unregister('remove-me');
  const closed = await Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SSE did not close')), 2_000)),
  ]);
  assert.equal(closed.done, true);
  assert.equal((await fetch(new URL('/projects/keep-me/', dashboard.url))).status, 200);
});
