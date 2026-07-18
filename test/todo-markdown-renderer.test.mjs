import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderTodoMarkdown,
  renderTodoMarkdownAst,
  renderTodoMarkdownDocument,
  serializeJsonForScript,
  TODO_MARKDOWN_SECTION_MAX_BYTES,
  TodoMarkdownSectionTooLargeError,
} from '../src/todo-markdown-renderer.mjs';

test('文書表示はGFM checkbox行を安全な静的markとして維持する', () => {
  assert.deepEqual(renderTodoMarkdownDocument('- [ ] pending\n- [x] done'), {
    html: '<ul><li class="markdown-task"><span title="状態表示（更新は lattice todo CLI）" class="markdown-checkbox" role="img" aria-label="unchecked">☐</span><p>pending</p></li><li class="markdown-task"><span title="状態表示（更新は lattice todo CLI）" class="markdown-checkbox" role="img" aria-label="checked">☑</span><p>done</p></li></ul>',
    discarded: [],
  });
});

test('正常系snapshot: 見出し・リスト・コード・絶対HTTPリンクを固定出力する', () => {
  const markdown = [
    '# Heading & safety',
    '',
    '- **strong** and *emphasis*',
    '- `a < b`',
    '',
    '```js',
    'const tag = "<safe>";',
    '```',
    '',
    '[docs](https://example.com/a?x=1&y=2 "Guide")',
  ].join('\n');

  assert.deepEqual(renderTodoMarkdown(markdown), {
    html: '<h1>Heading &amp; safety</h1><ul><li><p><strong>strong</strong> and <em>emphasis</em></p></li><li><p><code>a &lt; b</code></p></li></ul><pre><code>const tag = &quot;&lt;safe&gt;&quot;;</code></pre><p><a href="https://example.com/a?x=1&amp;y=2" title="Guide">docs</a></p>',
    discarded: [],
  });
});

test('正常系snapshot: mdast table familyを限定HTMLへ変換する', () => {
  const text = (value) => ({ type: 'text', value });
  const cell = (value) => ({ type: 'tableCell', children: [text(value)] });
  const row = (...values) => ({ type: 'tableRow', children: values.map(cell) });
  const tree = {
    type: 'root',
    children: [{
      type: 'table',
      align: ['left', 'right'],
      children: [row('Name', 'Value'), row('<safe>', '1 & 2')],
    }],
  };

  assert.deepEqual(renderTodoMarkdownAst(tree), {
    html: '<table><tbody><tr><th>Name</th><th>Value</th></tr><tr><td>&lt;safe&gt;</td><td>1 &amp; 2</td></tr></tbody></table>',
    discarded: [],
  });
});

test('正常系snapshot: GFM pipe tableをparseしてtable allow-listへ描画する', () => {
  const markdown = [
    '| Task | Result |',
    '| :--- | ---: |',
    '| **build** | `green` |',
    '| docs | [guide](https://example.com/guide) |',
  ].join('\n');

  assert.deepEqual(renderTodoMarkdown(markdown), {
    html: '<table><tbody><tr><th>Task</th><th>Result</th></tr><tr><td><strong>build</strong></td><td><code>green</code></td></tr><tr><td>docs</td><td><a href="https://example.com/guide">guide</a></td></tr></tbody></table>',
    discarded: [],
  });
});

test('XSS fixture: GFM tableセル内の危険URLとraw HTMLを棄却する', () => {
  const markdown = [
    '| Link | Markup |',
    '| --- | --- |',
    '| [label](javascript:alert(1)) | <svg onload=alert(2)> |',
  ].join('\n');
  const result = renderTodoMarkdown(markdown);

  assert.equal(
    result.html,
    '<table><tbody><tr><th>Link</th><th>Markup</th></tr><tr><td>label</td><td></td></tr></tbody></table>',
  );
  assert.deepEqual(result.discarded.map(({ type, reason }) => ({ type, reason })), [
    { type: 'link', reason: 'unsafe_url' },
    { type: 'html', reason: 'raw_html' },
  ]);
});

test('GFM非許可拡張: footnoteとstrikethroughをsubtree棄却しtask metadataを属性化しない', () => {
  const markdown = [
    'before ~~removed~~ after[^1]',
    '',
    '- [x] task body',
    '',
    '[^1]: footnote body',
  ].join('\n');
  const result = renderTodoMarkdown(markdown);

  assert.equal(result.html, '<p>before  after</p><ul><li><p>task body</p></li></ul>');
  assert.deepEqual(result.discarded.map(({ type, reason }) => ({ type, reason })), [
    { type: 'delete', reason: 'unknown_type' },
    { type: 'footnoteReference', reason: 'unknown_type' },
    { type: 'footnoteDefinition', reason: 'unknown_type' },
  ]);
});

test('XSS fixture: 危険scheme・protocol-relative・相対URLは拒否しlabelだけ残す', () => {
  const markdown = [
    '[js](javascript:alert(1))',
    '[network](//host/x)',
    '[data](data:text/html,<script>alert(1)</script>)',
    '[relative](../secret)',
    '[bidi-url](https://example.com/\u202efile)',
    '[safe](http://example.com/path "safe\u202etitle")',
  ].join(' ');
  const result = renderTodoMarkdown(markdown);

  assert.equal(
    result.html,
    '<p>js network data relative bidi-url <a href="http://example.com/path" title="safetitle">safe</a></p>',
  );
  assert.deepEqual(
    result.discarded.map(({ type, reason }) => ({ type, reason })),
    [
      ...Array.from({ length: 5 }, () => ({ type: 'link', reason: 'unsafe_url' })),
      { type: 'link', reason: 'unicode_direction_control' },
    ],
  );
});

test('XSS fixture: raw HTML・SVG event属性・Markdown image・未知nodeをsubtreeごと棄却する', () => {
  const markdownResult = renderTodoMarkdown([
    '<script>alert(1)</script>',
    '<svg onload=alert(2)>visible</svg>',
    '<img src=x onerror=alert(3)>',
    '![alt](https://example.com/a.png)',
  ].join('\n\n'));

  assert.equal(markdownResult.html, '<p>visible</p>');
  assert.equal(markdownResult.discarded.filter(({ type }) => type === 'html').length, 4);
  assert.equal(markdownResult.discarded.filter(({ type }) => type === 'image').length, 1);

  const unknownResult = renderTodoMarkdownAst({
    type: 'root',
    children: [{ type: 'customDanger', children: [{ type: 'text', value: 'must not render' }] }],
  });
  assert.deepEqual(unknownResult, {
    html: '',
    discarded: [{
      path: 'root.children[0]',
      type: 'customDanger',
      reason: 'unknown_type',
    }],
  });
});

test('XSS fixture: entityを一度だけ解釈して再escapeし、方向制御文字を除去する', () => {
  const result = renderTodoMarkdown(
    '&lt;script&gt; &amp;lt;img src=x onerror=alert(1)&amp;gt; safe\u202etxt\u2066!',
  );

  assert.equal(
    result.html,
    '<p>&lt;script&gt; &amp;lt;img src=x onerror=alert(1)&amp;gt; safetxt!</p>',
  );
  assert.deepEqual(result.discarded.map(({ type, reason }) => ({ type, reason })), [
    { type: 'text', reason: 'unicode_direction_control' },
  ]);
});

test('XSS fixture: script用JSONはtag脱出文字・行区切り・方向制御をUnicode escapeする', () => {
  const serialized = serializeJsonForScript({
    payload: '</script><svg onload="x">&\u2028\u2029\u202e',
  });

  assert.equal(
    serialized,
    '{"payload":"\\u003c/script\\u003e\\u003csvg onload=\\"x\\"\\u003e\\u0026\\u2028\\u2029\\u202e"}',
  );
  assert.equal(serialized.includes('</script>'), false);
});

test('散文節byte上限: 256 KiBちょうどを許可し1 byte超過をtyped errorにする', () => {
  const atLimit = 'a'.repeat(TODO_MARKDOWN_SECTION_MAX_BYTES);
  assert.equal(renderTodoMarkdown(atLimit).discarded.length, 0);

  assert.throws(
    () => renderTodoMarkdown(`${atLimit}b`),
    (error) => (
      error instanceof TodoMarkdownSectionTooLargeError
      && error.code === 'TODO_MARKDOWN_SECTION_TOO_LARGE'
      && error.detail.actual_bytes === TODO_MARKDOWN_SECTION_MAX_BYTES + 1
      && error.detail.maximum_bytes === TODO_MARKDOWN_SECTION_MAX_BYTES
    ),
  );
});
