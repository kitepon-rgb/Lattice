import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';
import { renderTodoGanttHtml } from '../src/todo-gantt-html.mjs';

const URL_ATTRIBUTES = new Set([
  'href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'cite', 'background',
  'longdesc', 'usemap', 'manifest', 'data', 'codebase', 'archive', 'profile',
]);

function scanAttributes(html) {
  const findings = [];
  const tagPattern = /<(?![!/])([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/gu;
  for (const tagMatch of html.matchAll(tagPattern)) {
    const tag = tagMatch[1].toLowerCase();
    const source = tagMatch[2];
    const attributePattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
    for (const match of source.matchAll(attributePattern)) {
      const name = match[1].toLowerCase();
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      if (name.startsWith('on')) findings.push(`${tag}[${name}] inline handler`);
      if (name === 'style') findings.push(`${tag}[style] style attribute`);
      if (URL_ATTRIBUTES.has(name) && !(name === 'href' && /^#[A-Za-z][A-Za-z0-9_.:-]*$/u.test(value))) {
        findings.push(`${tag}[${name}]=${value}`);
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(value) && name !== 'xmlns') {
        findings.push(`${tag}[${name}] network-like value`);
      }
    }
  }
  return findings;
}

function fixtureHtml() {
  const task = { task_id: 'T1', title: 'Safe', lane: 'main', narrative_ref: null, compile_binding: null };
  const read = {
    schema: 'lattice.todo_store_read.v1', project_id: 'project', members: [{
      plan: { project_id: 'project', plan_key: 'main', tasks: [task], hard_dependencies: [], joins: [] },
      tasks: [{ task_id: 'T1', status: 'pending', started_at: null, done_at: null,
        blocked_reason: null, evidence: null, evidence_unverified: false }],
    }],
  };
  const node = { project_id: 'project', plan_key: 'main', task_id: 'T1' };
  const chain = projectTodoChainV1({ nodes: [node], hard_edges: [], joins: [] });
  return renderTodoGanttHtml({
    readModel: read, layout: layoutTodoGantt(read),
    narratives: [{ ref: node, markdown: '[external](https://example.com/x) ![image](data:image/png,x)' }],
  }).html;
}

test('generated HTML has CSP and a mechanical allow-list proves zero network references', () => {
  const html = fixtureHtml();
  assert.match(html, /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">/u);
  assert.deepEqual(scanAttributes(html), []);
  assert.doesNotMatch(html, /<base(?:\s|>)/iu);
  for (const style of html.matchAll(/<style>([\s\S]*?)<\/style>/giu)) {
    assert.doesNotMatch(style[1], /url\s*\(|@import|\/\//iu);
  }
  assert.doesNotMatch(html, /<(?:script|img|iframe|audio|video|source|track|embed|object|link)\b[^>]+\b(?:src|href|data)\s*=/iu);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/iu);
  assert.equal(html.includes('innerHTML'), false);
});

test('allow-list scanner rejects non-http bypass families, not merely http(s)', () => {
  for (const unsafe of [
    '<img src="//host/x">', '<a href="data:text/html,x">x</a>',
    '<form action="/submit"></form>', '<svg><use xlink:href="other.svg#x"></use></svg>',
    '<div style="background:url(//host/x)"></div>', '<script src="relative.js"></script>',
  ]) assert.notDeepEqual(scanAttributes(unsafe), [], unsafe);
  assert.doesNotThrow(() => assert.deepEqual(scanAttributes('<a href="#section-1">ok</a>'), []));
});
