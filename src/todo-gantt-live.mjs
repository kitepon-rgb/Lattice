import { createServer } from 'node:http';

const LOOPBACK = '127.0.0.1';
const POLL_MS = 500;

function liveHtml(html, headDigest, eventsPath) {
  const controller = `<script>(()=>{const badge=document.createElement('div');badge.setAttribute('role','status');badge.style.cssText='position:fixed;right:12px;bottom:12px;z-index:99;padding:6px 10px;border:1px solid #d9d8d4;border-radius:4px;background:#fcfcfb;font:600 12px system-ui';badge.textContent='進捗: 接続中';document.body.append(badge);let head=${JSON.stringify(headDigest)};const stream=new EventSource(${JSON.stringify(eventsPath)});stream.addEventListener('state',event=>{const next=JSON.parse(event.data);badge.textContent='進捗: 最新';if(next.head_digest!==head){badge.textContent='進捗: 更新を反映中';location.reload();}});stream.addEventListener('lattice-error',event=>{const detail=JSON.parse(event.data);badge.textContent='進捗: エラー '+detail.code;badge.style.borderColor='#d03b3b';});stream.onerror=()=>{badge.textContent='進捗: 再接続中';};})();</script>`;
  return html
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
    .replace('</body>', `${controller}</body>`);
}

function sendEvent(response, name, id, value) {
  response.write(`id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
}

export async function startTodoGanttLiveServer({ projectId, port = 0, render, readHead }) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new TypeError('port must be 0..65535');
  if (typeof projectId !== 'string' || projectId.length === 0) throw new TypeError('projectId required');
  if (typeof render !== 'function' || typeof readHead !== 'function') throw new TypeError('render/readHead required');
  const projectPath = `/projects/${encodeURIComponent(projectId)}/`;
  const eventsPath = `${projectPath}events`;
  const clients = new Set();
  let eventId = 0;
  let lastHead = null;
  let checking = false;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${LOOPBACK}`);
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(302, { location: projectPath, 'cache-control': 'no-store' });
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === projectPath) {
        const rendered = await render();
        lastHead = rendered.head_digest;
        const html = liveHtml(rendered.html, rendered.head_digest, eventsPath);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        response.end(html);
        return;
      }
      if (request.method === 'GET' && url.pathname === eventsPath) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
        clients.add(response);
        request.on('close', () => clients.delete(response));
        const head = await readHead();
        lastHead = head;
        sendEvent(response, 'state', ++eventId, { head_digest: head });
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('not found\n');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`${JSON.stringify({ code: error?.code ?? 'GANTT_RENDER_FAILED' })}\n`);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK, port }, resolve);
  });
  const timer = setInterval(async () => {
    if (checking || clients.size === 0) return;
    checking = true;
    try {
      const head = await readHead();
      if (lastHead !== head) {
        lastHead = head;
        for (const client of clients) sendEvent(client, 'state', ++eventId, { head_digest: head });
      }
    } catch (error) {
      for (const client of clients) sendEvent(client, 'lattice-error', ++eventId,
        { code: error?.code ?? 'STORE_READ_FAILED' });
    } finally { checking = false; }
  }, POLL_MS);
  timer.unref();
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  return {
    projectId, host: LOOPBACK, port: actualPort, projectPath, eventsPath,
    url: `http://${LOOPBACK}:${actualPort}${projectPath}`,
    eventsUrl: `http://${LOOPBACK}:${actualPort}${eventsPath}`,
    close: async () => {
      clearInterval(timer);
      for (const client of clients) client.end();
      clients.clear();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
