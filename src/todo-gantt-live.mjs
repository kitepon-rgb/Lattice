import { createServer } from 'node:http';

import { TODO_DASHBOARD_CODE_VERSION } from './todo-dashboard-registry.mjs';

const LOOPBACK = '127.0.0.1';
const POLL_MS = 500;
const HTTP_ERROR_SCHEMA = 'lattice.todo_gantt_http_error.v1';
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function projectPath(projectId) {
  return `/projects/${encodeURIComponent(projectId)}/`;
}

function liveHtml(html, headDigest, eventsPath) {
  const controller = `<script>(()=>{const badge=document.createElement('div');badge.setAttribute('role','status');badge.style.cssText='position:fixed;right:12px;bottom:12px;z-index:99;padding:6px 10px;border:1px solid #d9d8d4;border-radius:4px;background:#fcfcfb;font:600 12px system-ui';badge.textContent='進捗: 接続中';document.body.append(badge);let head=${JSON.stringify(headDigest)};const stream=new EventSource(${JSON.stringify(eventsPath)});stream.addEventListener('state',event=>{const next=JSON.parse(event.data);badge.textContent='進捗: 最新';if(next.head_digest!==head){badge.textContent='進捗: 更新を反映中';location.reload();}});stream.addEventListener('lattice-error',event=>{const detail=JSON.parse(event.data);badge.textContent='進捗: エラー '+detail.code;badge.style.borderColor='#d03b3b';});stream.onerror=()=>{badge.textContent='進捗: 再接続中';};})();</script>`;
  return html
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
    .replace('</body>', `${controller}</body>`);
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function dashboardHtml(projects) {
  const rows = projects.map(({ projectId, displayName }) => {
    const href = projectPath(projectId);
    const projectIdentity = displayName === projectId
      ? '' : `<code>${escapeHtml(projectId)}</code>`;
    return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(displayName)}</strong>${projectIdentity}<span aria-hidden="true">→</span></a></li>`;
  }).join('');
  const content = rows.length === 0 ? '<p>アクティブなプロジェクトはありません。</p>'
    : `<ul>${rows}</ul>`;
  return `<!doctype html><html lang="ja"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Latticeが管理している公開中の工程と現在地を確認できます。"><meta name="robots" content="noindex, nofollow"><meta property="og:title" content="公開中の工程表 — Lattice"><meta property="og:description" content="Latticeが管理している公開中の工程と現在地を確認できます。"><meta name="theme-color" content="#f7f3ea"><title>公開中の工程表 — Lattice</title><style>:root{color-scheme:light;--paper:#f7f3ea;--panel:#fffdf8;--ink:#201d19;--soft:#6c655d;--line:#d8d0c5;--cobalt:#315cbe;--orange:#e85f2a}*{box-sizing:border-box}body{min-height:100vh;margin:0;color:var(--ink);background:var(--paper);font:16px/1.7 system-ui,-apple-system,sans-serif}.shell{max-width:880px;margin:0 auto;padding:28px 22px 40px}.brand{display:flex;align-items:center;gap:9px;padding-bottom:24px;border-bottom:1px solid var(--line);font-size:.88rem}.brand a,.footer a{color:var(--ink);font-weight:800;text-decoration:none}.brand a:hover,.footer a:hover{color:var(--cobalt)}.brand span{color:var(--soft)}main{padding:64px 0 72px}.eyebrow{margin:0 0 8px;color:var(--orange);font-size:.76rem;font-weight:800;letter-spacing:.14em}.lead{max-width:620px;margin:0 0 34px;color:var(--soft)}h1{margin:0 0 14px;font-size:clamp(2rem,6vw,3.4rem);line-height:1.12;letter-spacing:-.04em}ul{display:grid;gap:12px;margin:0;padding:0;list-style:none}li a{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:20px;padding:18px 20px;border:1px solid var(--line);border-radius:12px;color:inherit;background:var(--panel);text-decoration:none;box-shadow:0 8px 28px rgba(48,39,27,.04)}li a:hover{border-color:var(--cobalt);transform:translateY(-1px)}li strong{font-size:1.04rem}li code{color:var(--soft);font-size:.78rem}li span{color:var(--cobalt);font-weight:800}.note{margin:28px 0 0;padding:16px 18px;border-left:3px solid var(--orange);color:var(--soft);background:rgba(255,253,248,.72);font-size:.88rem}.footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;padding-top:20px;border-top:1px solid var(--line);color:var(--soft);font-size:.82rem}.footer nav{display:flex;gap:18px}@media(max-width:560px){.shell{padding:20px 16px 32px}main{padding:44px 0 56px}li a{grid-template-columns:minmax(0,1fr) auto;padding:16px}li code{grid-column:1/-1;grid-row:2}.footer{display:block}.footer nav{margin-top:10px}}</style></head><body><div class="shell"><header class="brand"><a href="https://kitepon.dev/">kitepon.dev</a><span aria-hidden="true">/</span><strong>Lattice</strong></header><main><p class="eyebrow">LIVE DEVELOPMENT</p><h1>公開中の工程表</h1><p class="lead">Latticeが管理しているプロジェクトの工程と、いまどこまで進んでいるかを公開データから確認できます。</p>${content}<p class="note">表示内容はLatticeの記録から自動生成されます。製品の紹介や使い方はGitHubをご覧ください。</p></main><footer class="footer"><span>kitepon.dev の開発工程を、Latticeで可視化しています。</span><nav aria-label="関連リンク"><a href="https://kitepon.dev/">kitepon.dev</a><a href="https://github.com/kitepon-rgb/Lattice">GitHub</a></nav></footer></div></body></html>`;
}

function validateProject(project) {
  if (project === null || typeof project !== 'object' || Array.isArray(project)
    || typeof project.projectId !== 'string' || !PROJECT_ID.test(project.projectId)
    || typeof project.displayName !== 'string' || project.displayName.length === 0
    || project.displayName !== project.displayName.trim()
    || typeof project.render !== 'function' || typeof project.readHead !== 'function') {
    throw new TypeError('project descriptor is invalid');
  }
  return Object.freeze({
    projectId: project.projectId,
    displayName: project.displayName,
    render: project.render,
    readHead: project.readHead,
  });
}

export function createTodoGanttProjectRegistry(initialProjects = []) {
  if (!Array.isArray(initialProjects)) throw new TypeError('initialProjects must be an array');
  const entries = new Map();
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const register = (project) => {
    const validated = validateProject(project);
    if (entries.has(validated.projectId)) {
      const error = new Error(`project already registered: ${validated.projectId}`);
      error.code = 'PROJECT_ALREADY_REGISTERED';
      throw error;
    }
    entries.set(validated.projectId, validated);
    notify();
    return validated;
  };
  for (const project of initialProjects) register(project);
  return Object.freeze({
    register,
    unregister(projectId) {
      const deleted = entries.delete(projectId);
      if (deleted) notify();
      return deleted;
    },
    get(projectId) { return entries.get(projectId) ?? null; },
    list() {
      return [...entries.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'ja')
        || left.projectId.localeCompare(right.projectId, 'en'));
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('registry listener required');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

function sendEvent(response, name, id, value) {
  response.write(`id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
}

function sendHttpError(response, status, code, path) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(`${JSON.stringify({ schema: HTTP_ERROR_SCHEMA, code, path })}\n`);
}

function finishRequestFailure(response, code, path) {
  try {
    if (!response.headersSent) sendHttpError(response, 500, code, path);
    else if (!response.writableEnded) response.end();
  } catch { response.destroy(); }
}

export async function startTodoGanttDashboardServer({ registry, port = 0, redirectSingleProject = false }) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new TypeError('port must be 0..65535');
  if (registry === null || typeof registry !== 'object' || typeof registry.get !== 'function'
    || typeof registry.list !== 'function') throw new TypeError('registry required');
  const clientsByProject = new Map();
  const lastHeads = new Map();
  let eventId = 0;
  let checking = false;
  let closed = false;
  const reconcileClients = () => {
    const active = new Set(registry.list().map(({ projectId }) => projectId));
    for (const [projectId, clients] of clientsByProject) {
      if (active.has(projectId)) continue;
      for (const client of clients) client.end();
      clientsByProject.delete(projectId);
      lastHeads.delete(projectId);
    }
  };
  const unsubscribe = typeof registry.subscribe === 'function'
    ? registry.subscribe(reconcileClients) : () => {};
  const handleRequest = async (request, response) => {
    let requestPath = request.url ?? '/';
    try {
      const url = new URL(requestPath, `http://${LOOPBACK}`);
      requestPath = url.pathname;
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        sendHttpError(response, 405, 'METHOD_NOT_ALLOWED', requestPath);
        return;
      }
      if (url.pathname === '/__lattice/health') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        // `version` is the package this process loaded at startup, not the one
        // installed on disk. That difference is the whole point: it is how a
        // caller learns the daemon is serving code that has been superseded.
        response.end(`${JSON.stringify({ schema: 'lattice.todo_dashboard_health.v1', pid: process.pid,
          port: actualPort, project_ids: registry.list().map(({ projectId }) => projectId),
          version: TODO_DASHBOARD_CODE_VERSION })}\n`);
        return;
      }
      if (url.pathname === '/' || url.pathname === '/projects/') {
        const projects = registry.list();
        if (url.pathname === '/' && redirectSingleProject && projects.length === 1) {
          response.writeHead(302, { location: projectPath(projects[0].projectId), 'cache-control': 'no-store' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        response.end(dashboardHtml(projects));
        return;
      }
      const match = /^\/projects\/([^/]+)\/(events)?$/u.exec(url.pathname);
      if (match === null) {
        sendHttpError(response, 404, 'ROUTE_NOT_FOUND', url.pathname);
        return;
      }
      let requestedId;
      try { requestedId = decodeURIComponent(match[1]); } catch {
        sendHttpError(response, 400, 'PROJECT_ID_INVALID', url.pathname);
        return;
      }
      const project = registry.get(requestedId);
      if (project === null) {
        sendHttpError(response, 404, 'PROJECT_NOT_FOUND', url.pathname);
        return;
      }
      if (match[2] === 'events') {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
        if (!clientsByProject.has(project.projectId)) clientsByProject.set(project.projectId, new Set());
        clientsByProject.get(project.projectId).add(response);
        request.on('close', () => clientsByProject.get(project.projectId)?.delete(response));
        try {
          const head = await project.readHead();
          lastHeads.set(project.projectId, head);
          sendEvent(response, 'state', ++eventId, { head_digest: head });
        } catch (error) {
          sendEvent(response, 'lattice-error', ++eventId, { code: error?.code ?? 'STORE_READ_FAILED' });
          clientsByProject.get(project.projectId)?.delete(response);
          response.end();
        }
        return;
      }
      const rendered = await project.render({
        projectId: project.projectId,
        displayName: project.displayName,
      });
      lastHeads.set(project.projectId, rendered.head_digest);
      const html = liveHtml(rendered.html, rendered.head_digest, `${projectPath(project.projectId)}events`);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(html);
    } catch (error) {
      finishRequestFailure(response, error?.code ?? 'GANTT_RENDER_FAILED', requestPath);
    }
  };
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      finishRequestFailure(response, error?.code ?? 'GANTT_REQUEST_FAILED', request.url ?? '/');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK, port }, resolve);
  });
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      reconcileClients();
      for (const project of registry.list()) {
        const clients = clientsByProject.get(project.projectId);
        if (clients === undefined || clients.size === 0) continue;
        try {
          const head = await project.readHead();
          if (lastHeads.get(project.projectId) !== head) {
            lastHeads.set(project.projectId, head);
            for (const client of clients) sendEvent(client, 'state', ++eventId, { head_digest: head });
          }
        } catch (error) {
          for (const client of clients) sendEvent(client, 'lattice-error', ++eventId,
            { code: error?.code ?? 'STORE_READ_FAILED' });
        }
      }
    } finally { checking = false; }
  }, POLL_MS);
  timer.unref();
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    unsubscribe();
    for (const clients of clientsByProject.values()) for (const client of clients) client.end();
    clientsByProject.clear();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return Object.freeze({
    host: LOOPBACK,
    port: actualPort,
    url: `http://${LOOPBACK}:${actualPort}/`,
    projectsUrl: `http://${LOOPBACK}:${actualPort}/projects/`,
    registry,
    close,
  });
}

export async function startTodoGanttLiveServer({ projectId, displayName = projectId, port = 0, render, readHead }) {
  const registry = createTodoGanttProjectRegistry([{ projectId, displayName, render, readHead }]);
  const dashboard = await startTodoGanttDashboardServer({ registry, port, redirectSingleProject: true });
  const path = projectPath(projectId);
  return Object.freeze({
    projectId,
    displayName,
    host: dashboard.host,
    port: dashboard.port,
    projectPath: path,
    eventsPath: `${path}events`,
    url: `http://${dashboard.host}:${dashboard.port}${path}`,
    eventsUrl: `http://${dashboard.host}:${dashboard.port}${path}events`,
    projectsUrl: dashboard.projectsUrl,
    registry,
    close: dashboard.close,
  });
}
