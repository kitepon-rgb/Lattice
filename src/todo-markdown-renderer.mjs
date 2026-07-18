import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';

export const TODO_MARKDOWN_SECTION_MAX_BYTES = 256 * 1024;

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const unicodeDirectionControl = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const unicodeDirectionControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const scriptUnsafeCharacters = /[<>&\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

export class TodoMarkdownRenderError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'TodoMarkdownRenderError';
    this.code = code;
    this.detail = detail;
  }
}

export class TodoMarkdownSectionTooLargeError extends TodoMarkdownRenderError {
  constructor(actualBytes) {
    super(
      'TODO_MARKDOWN_SECTION_TOO_LARGE',
      `todo Markdown section is ${actualBytes} bytes; maximum is ${TODO_MARKDOWN_SECTION_MAX_BYTES}`,
      { actual_bytes: actualBytes, maximum_bytes: TODO_MARKDOWN_SECTION_MAX_BYTES },
    );
    this.name = 'TodoMarkdownSectionTooLargeError';
  }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isNode(value) {
  return value !== null && typeof value === 'object' && typeof value.type === 'string';
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//iu.test(value)) return null;
  if (/[\u0000-\u0020\u007f]/u.test(value)) return null;
  if (unicodeDirectionControl.test(value)) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.hostname === '') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function renderChildren(node, path, state, context = {}) {
  if (!Array.isArray(node.children)) {
    state.discarded.push({ path, type: node.type, reason: 'invalid_children' });
    return '';
  }
  return node.children
    .map((child, index) => renderNode(child, `${path}.children[${index}]`, state, context))
    .join('');
}

function renderText(node, path, state) {
  if (typeof node.value !== 'string') {
    state.discarded.push({ path, type: node.type, reason: 'invalid_value' });
    return '';
  }
  const withoutDirectionControls = node.value.replace(unicodeDirectionControls, '');
  if (withoutDirectionControls !== node.value) {
    state.discarded.push({ path, type: node.type, reason: 'unicode_direction_control' });
  }
  return escapeHtml(withoutDirectionControls);
}

function renderNode(node, path, state, context = {}) {
  if (!isNode(node)) {
    state.discarded.push({ path, type: 'invalid', reason: 'invalid_node' });
    return '';
  }

  switch (node.type) {
    case 'root':
      return renderChildren(node, path, state, context);
    case 'text':
      return renderText(node, path, state);
    case 'heading': {
      if (!Number.isInteger(node.depth) || node.depth < 1 || node.depth > 6) {
        state.discarded.push({ path, type: node.type, reason: 'invalid_depth' });
        return '';
      }
      return `<h${node.depth}>${renderChildren(node, path, state)}</h${node.depth}>`;
    }
    case 'paragraph': {
      const content = renderChildren(node, path, state);
      return content === '' ? '' : `<p>${content}</p>`;
    }
    case 'list': {
      const tag = node.ordered === true ? 'ol' : 'ul';
      let start = '';
      if (tag === 'ol' && Number.isSafeInteger(node.start) && node.start > 1) {
        start = ` start="${node.start}"`;
      }
      return `<${tag}${start}>${renderChildren(node, path, state, context)}</${tag}>`;
    }
    case 'listItem': {
      const line = node.position?.start?.line;
      const taskState = context.taskCheckboxes === true && typeof node.checked === 'boolean'
        && Number.isSafeInteger(line) ? context.taskStatesByLine?.get(line) : undefined;
      const checkbox = taskState === undefined
        ? (context.taskCheckboxes === true && typeof node.checked === 'boolean'
          ? `<span title="状態表示（更新は lattice todo CLI）" class="markdown-checkbox" role="img" aria-label="${node.checked ? 'checked' : 'unchecked'}">${node.checked ? '☑' : '☐'}</span>` : '')
        : `<span title="状態表示（更新は lattice todo CLI）" class="document-status status-${escapeHtml(String(taskState.status))}" data-narrative-key="${escapeHtml(String(taskState.narrativeKey))}" role="img" aria-label="${escapeHtml(String(taskState.label))}">${escapeHtml(String(taskState.mark))}</span>`;
      const taskClass = checkbox === '' ? '' : ' class="markdown-task"';
      const blockedReason = taskState?.status === 'blocked'
        ? `<span class="blocked-reason"> — ${escapeHtml(String(taskState.blockedReason ?? '理由未記録'))}</span>` : '';
      return `<li${taskClass}>${checkbox}${renderChildren(node, path, state, context)}${blockedReason}</li>`;
    }
    case 'strong':
      return `<strong>${renderChildren(node, path, state)}</strong>`;
    case 'emphasis':
      return `<em>${renderChildren(node, path, state)}</em>`;
    case 'inlineCode':
      return `<code>${renderText(node, path, state)}</code>`;
    case 'code':
      return `<pre><code>${renderText(node, path, state)}</code></pre>`;
    case 'blockquote':
      return `<blockquote>${renderChildren(node, path, state, context)}</blockquote>`;
    case 'link': {
      const href = safeHttpUrl(node.url);
      const label = renderChildren(node, path, state);
      if (href === null) {
        state.discarded.push({ path, type: node.type, reason: 'unsafe_url' });
        return label;
      }
      let title = '';
      if (typeof node.title === 'string') {
        const safeTitle = node.title.replace(unicodeDirectionControls, '');
        if (safeTitle !== node.title) {
          state.discarded.push({ path, type: node.type, reason: 'unicode_direction_control' });
        }
        title = ` title="${escapeHtml(safeTitle)}"`;
      }
      return `<a href="${escapeHtml(href)}"${title}>${label}</a>`;
    }
    case 'break':
      return '<br>';
    case 'thematicBreak':
      return '<hr>';
    case 'table': {
      if (!Array.isArray(node.children)) {
        state.discarded.push({ path, type: node.type, reason: 'invalid_children' });
        return '';
      }
      const rows = node.children.map((child, index) => renderNode(
        child,
        `${path}.children[${index}]`,
        state,
        { ...context, tableHeader: index === 0 },
      )).join('');
      return `<table><tbody>${rows}</tbody></table>`;
    }
    case 'tableRow':
      return `<tr>${renderChildren(node, path, state, context)}</tr>`;
    case 'tableCell': {
      const tag = context.tableHeader ? 'th' : 'td';
      return `<${tag}>${renderChildren(node, path, state, context)}</${tag}>`;
    }
    case 'html':
      state.discarded.push({ path, type: node.type, reason: 'raw_html' });
      return '';
    case 'image':
      state.discarded.push({ path, type: node.type, reason: 'image' });
      return '';
    default:
      state.discarded.push({ path, type: node.type, reason: 'unknown_type' });
      return '';
  }
}

export function renderTodoMarkdownAst(tree) {
  if (!isNode(tree) || tree.type !== 'root') {
    throw new TodoMarkdownRenderError(
      'TODO_MARKDOWN_INVALID_AST',
      'todo Markdown AST must be an mdast root node',
    );
  }
  const state = { discarded: [] };
  return {
    html: renderNode(tree, 'root', state),
    discarded: state.discarded,
  };
}

export function renderTodoMarkdown(markdown) {
  if (typeof markdown !== 'string') {
    throw new TodoMarkdownRenderError(
      'TODO_MARKDOWN_INVALID_INPUT',
      'todo Markdown section must be a string',
    );
  }
  const actualBytes = Buffer.byteLength(markdown, 'utf8');
  if (actualBytes > TODO_MARKDOWN_SECTION_MAX_BYTES) {
    throw new TodoMarkdownSectionTooLargeError(actualBytes);
  }
  return renderTodoMarkdownAst(markdownParser.parse(markdown));
}

export function parseTodoMarkdownDocument(markdown) {
  if (typeof markdown !== 'string') {
    throw new TodoMarkdownRenderError(
      'TODO_MARKDOWN_INVALID_INPUT',
      'todo Markdown section must be a string',
    );
  }
  const actualBytes = Buffer.byteLength(markdown, 'utf8');
  if (actualBytes > TODO_MARKDOWN_SECTION_MAX_BYTES) {
    throw new TodoMarkdownSectionTooLargeError(actualBytes);
  }
  return markdownParser.parse(markdown);
}

export function renderTodoMarkdownDocument(markdown, { taskStatesByLine = new Map() } = {}) {
  if (!(taskStatesByLine instanceof Map)) {
    throw new TodoMarkdownRenderError(
      'TODO_MARKDOWN_INVALID_OPTIONS',
      'taskStatesByLine must be a Map',
    );
  }
  const tree = parseTodoMarkdownDocument(markdown);
  if (!isNode(tree) || tree.type !== 'root') {
    throw new TodoMarkdownRenderError(
      'TODO_MARKDOWN_INVALID_AST',
      'todo Markdown AST must be an mdast root node',
    );
  }
  const state = { discarded: [] };
  return {
    html: renderNode(tree, 'root', state, { taskCheckboxes: true, taskStatesByLine }),
    discarded: state.discarded,
  };
}

export function serializeJsonForScript(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TodoMarkdownRenderError(
      'TODO_MARKDOWN_JSON_NOT_SERIALIZABLE',
      'script JSON value must be JSON-serializable',
    );
  }
  return serialized.replace(scriptUnsafeCharacters, (character) => (
    `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`
  ));
}
