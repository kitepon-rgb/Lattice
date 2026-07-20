import assert from 'node:assert/strict';
import test from 'node:test';

import { startTodoGanttLiveServer } from '../src/todo-gantt-live.mjs';

test('live ganttはloopback限定でHTMLを配信しhead変更をSSE通知する', async (context) => {
  let head = 'a'.repeat(64);
  const live = await startTodoGanttLiveServer({
    port: 0,
    render: async () => ({
      html: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'\"></head><body>fixture</body></html>",
      head_digest: head,
    }),
    readHead: async () => head,
  });
  context.after(() => live.close());
  assert.equal(live.host, '127.0.0.1');
  const page = await fetch(live.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /connect-src 'self'/u);
  assert.match(html, /EventSource\('\/events'\)/u);

  const controller = new AbortController();
  context.after(() => controller.abort());
  const events = await fetch(`${live.url}events`, { signal: controller.signal });
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
