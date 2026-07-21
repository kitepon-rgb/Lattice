import assert from 'node:assert/strict';
import test from 'node:test';

import { startTodoGanttLiveServer } from '../src/todo-gantt-live.mjs';

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
