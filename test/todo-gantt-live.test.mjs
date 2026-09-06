import assert from 'node:assert/strict';
import { connect } from 'node:net';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';
import { renderTodoGanttHtml } from '../src/todo-gantt-html.mjs';
import {
  createTodoGanttProjectRegistry,
  startTodoGanttDashboardServer,
  startTodoGanttLiveServer,
} from '../src/todo-gantt-live.mjs';

const EXTERNAL_PANE = Object.freeze({
  title: '円卓',
  url: 'https://pane.example/room-a',
  probeUrl: 'https://probe.example/api/room-a/members',
  frameOrigin: 'https://pane.example',
  probeOrigin: 'https://probe.example',
});

/**
 * 注入点は描画部品が持つ実物のmarkupである。fixtureの自作HTMLでは注入点の変化を
 * 捕まえられないので、ここだけは本物のrenderTodoGanttHtmlを通す。
 */
function ganttHtml() {
  const readModel = {
    schema: 'lattice.todo_store_read.v1',
    project_id: 'project-1',
    members: [{
      plan: { project_id: 'project-1', plan_key: 'main', joins: [], hard_dependencies: [],
        tasks: [{ task_id: 't1', title: '工程1', lane: 'dev', narrative_ref: null, compile_binding: null }] },
      tasks: [{ task_id: 't1', status: 'pending', started_at: null, done_at: null,
        blocked_reason: null, evidence: null, evidence_unverified: false }],
    }],
  };
  const chain = projectTodoChainV1({
    nodes: [{ project_id: 'project-1', plan_key: 'main', task_id: 't1' }], hard_edges: [], joins: [],
  });
  return renderTodoGanttHtml({ readModel, layout: layoutTodoGantt(readModel) }).html;
}

test('live ganttは最新headを積んだpingを25秒ごとに送る', async (context) => {
  const head = 'a'.repeat(64);
  const live = await startTodoGanttLiveServer({
    projectId: 'heartbeat-project',
    port: 0,
    render: async () => ({
      html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'\"></head><body>fixture</body></html>",
      head_digest: head,
    }),
    readHead: async () => head,
  });
  const controller = new AbortController();
  const realNow = Date.now;
  context.after(() => {
    Date.now = realNow;
    controller.abort();
    return live.close();
  });

  const events = await fetch(live.eventsUrl, { signal: controller.signal });
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let text = decoder.decode((await reader.read()).value, { stream: true });
  let now = realNow();
  Date.now = () => now;
  now += 25_000;
  text = await Promise.race([
    (async () => {
      while (!text.includes('event: ping')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SSE ping was not emitted')), 1_500)),
  ]);
  assert.match(text, /event: ping\ndata: \{"head_digest":"a{64}"\}/u);
});

test('live gantt controllerはping差分を回収し62.5秒の途絶で接続を張り直す', async (context) => {
  const head = 'a'.repeat(64);
  const live = await startTodoGanttLiveServer({
    projectId: 'watchdog-project',
    port: 0,
    render: async () => ({
      html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'\"></head><body>fixture</body></html>",
      head_digest: head,
    }),
    readHead: async () => head,
  });
  context.after(() => live.close());
  const html = await (await fetch(live.url)).text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  const controller = scripts.at(-1)?.[1];
  assert.equal(typeof controller, 'string');

  let now = 1_000;
  let reloads = 0;
  const intervals = [];
  const streams = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      streams.push(this);
    }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    close() { this.closed = true; }
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
  }
  const badge = { setAttribute() {}, style: {}, textContent: '' };
  runInNewContext(controller, {
    document: { createElement: () => badge, body: { append() {} } },
    EventSource: FakeEventSource,
    location: { reload: () => { reloads += 1; } },
    Date: { now: () => now },
    JSON,
    setInterval: (callback, milliseconds) => {
      intervals.push({ callback, milliseconds });
      return intervals.length;
    },
  });

  assert.equal(streams.length, 1);
  streams[0].emit('ping', { head_digest: head });
  assert.equal(reloads, 0);
  streams[0].emit('ping', { head_digest: 'b'.repeat(64) });
  assert.equal(reloads, 1);
  const watchdog = intervals.find(({ milliseconds }) => milliseconds === 12_500);
  assert.ok(watchdog);
  now += 62_501;
  watchdog.callback();
  assert.equal(streams[0].closed, true);
  assert.equal(streams.length, 2);
});

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
  assert.match(html, /name="description" content="Latticeで管理しているプロジェクトの依存工程と進捗を確認できます。"/u);
  assert.doesNotMatch(html, /noindex/u); // ADR 0164 Decision 5: noindexはサイト全体で撤去
  assert.match(html, /class="lattice-live-brand"/u);
  assert.match(html, /href="https:\/\/kitepon\.dev\/"/u);
  assert.match(html, /href="\/projects\/">一覧へ戻る/u);

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
    assert.match(html, /https:\/\/github\.com\/kitepon\/Lattice/u);
    assert.doesNotMatch(html, /noindex/u); // ADR 0164 Decision 5: noindexはサイト全体で撤去
  }
  const project = await fetch(new URL('/projects/aishell/', dashboard.url));
  assert.equal(project.status, 200);
  assert.match(await project.text(), /AIShell/u);
  assert.deepEqual(renderCalls, [{ projectId: 'aishell', displayName: 'AIShell' }]);
});

test('外部ペイン設定があるprojectだけタブ・iframe・CSPを注入する', async (context) => {
  const html = ganttHtml();
  const registry = createTodoGanttProjectRegistry([
    { projectId: 'with-pane', displayName: 'ペインあり',
      render: async () => ({ html, head_digest: 'a', external_pane: EXTERNAL_PANE }),
      readHead: async () => 'a' },
    { projectId: 'plain', displayName: 'ペインなし',
      render: async () => ({ html, head_digest: 'b' }), readHead: async () => 'b' },
  ]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port: 0 });
  context.after(() => dashboard.close());

  const paned = await (await fetch(new URL('/projects/with-pane/', dashboard.url))).text();
  assert.match(paned, /connect-src 'self' https:\/\/probe\.example; frame-src https:\/\/pane\.example;/u);
  assert.match(paned, /<iframe data-src="https:\/\/pane\.example\/room-a" title="円卓">/u);
  assert.match(paned, /data-right-panel="external" hidden/u);
  assert.match(paned, /fetch\("https:\/\/probe\.example\/api\/room-a\/members",\{cache:'no-store'\}\)/u);
  // タブは「概要」の左に出す。順序そのものが受入条件なので位置で確かめる。
  assert.ok(paned.indexOf('data-show-external-pane') < paned.indexOf('data-show-overview'));
  assert.match(paned, /\[data-right-panel="external"\]>iframe/u);

  const plain = await (await fetch(new URL('/projects/plain/', dashboard.url))).text();
  assert.match(plain, /connect-src 'self';/u);
  assert.doesNotMatch(plain, /frame-src/u);
  assert.doesNotMatch(plain, /data-show-external-pane/u);
  assert.doesNotMatch(plain, /data-right-panel="external"/u);
});

test('注入点が無いHTMLへ外部ペインを差すとtyped errorで落ちる', async (context) => {
  const registry = createTodoGanttProjectRegistry([
    { projectId: 'no-marker', displayName: '注入点なし',
      render: async () => ({ html: '<!doctype html><html><head></head><body>plain</body></html>',
        head_digest: 'a', external_pane: EXTERNAL_PANE }),
      readHead: async () => 'a' },
  ]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port: 0 });
  context.after(() => dashboard.close());
  const response = await fetch(new URL('/projects/no-marker/', dashboard.url));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'EXTERNAL_PANE_INJECTION_FAILED');
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

test('明示されたlocalhost shutdown handlerだけをPOSTで起動する', async (context) => {
  let shutdowns = 0;
  const dashboard = await startTodoGanttDashboardServer({
    registry: createTodoGanttProjectRegistry([]), port: 0,
    onShutdown: () => { shutdowns += 1; },
  });
  context.after(() => dashboard.close());
  const response = await fetch(new URL('/__lattice/shutdown', dashboard.url), { method: 'POST' });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    schema: 'lattice.todo_dashboard_shutdown.v1', accepted: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdowns, 1);
});

test('dashboardはブラウザの未知GETだけを戻り先つきHTML 404にする', async (context) => {
  const dashboard = await startTodoGanttDashboardServer({
    registry: createTodoGanttProjectRegistry([]), port: 0,
  });
  context.after(() => dashboard.close());

  for (const path of ['/unknown', '/projects/unknown/']) {
    const response = await fetch(new URL(path, dashboard.url), {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/html/u);
    const html = await response.text();
    assert.match(html, /<title>ページが見つかりません — Lattice<\/title>/u);
    assert.doesNotMatch(html, /noindex/u); // ADR 0164 Decision 5: noindexはサイト全体で撤去
    assert.match(html, /href="\/projects\/">公開工程表の一覧へ/u);
    assert.match(html, /href="https:\/\/kitepon\.dev\/">kitepon\.devへ/u);
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
