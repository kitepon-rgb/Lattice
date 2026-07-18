import { createHash } from 'node:crypto';

import {
  renderTodoMarkdown,
  serializeJsonForScript,
} from './todo-markdown-renderer.mjs';
import { renderTodoGanttSvg } from './todo-gantt-svg.mjs';

export const TODO_GANTT_RENDERER_VERSION = 'lattice.todo_gantt_renderer.v1';
export const TODO_GANTT_PROSE_MAX_BYTES = 8 * 1024 * 1024;
export const TODO_GANTT_HTML_MAX_BYTES = 24 * 1024 * 1024;

export class TodoGanttRenderError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'TodoGanttRenderError';
    this.code = code;
    this.detail = detail;
  }
}

function escapeHtmlAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replace(/[\u0000-\u001f\u007f]/gu, '');
}

function escapeHtmlText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function refKey(ref) {
  return JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// The Markdown renderer deliberately permits safe web links for its standalone API.
// A self-contained gantt permits fragments only, so its known allow-list output is de-linked here.
function removeNavigation(markup) {
  return markup.replace(/<a href="[^"]*"(?: title="[^"]*")?>/gu, '<span class="deactivated-link">')
    .replaceAll('</a>', '</span>');
}

function normalizeSections(readModel, narratives) {
  const supplied = new Map(narratives.map((entry) => [refKey(entry.ref), entry]));
  const result = [];
  let proseBytes = 0;
  for (const member of readModel.members) {
    const states = new Map(member.tasks.map((state) => [state.task_id, state]));
    for (const task of member.plan.tasks) {
      const ref = { project_id: member.plan.project_id, plan_key: member.plan.plan_key, task_id: task.task_id };
      const narrative = supplied.get(refKey(ref));
      const markdown = narrative?.markdown ?? '';
      proseBytes += Buffer.byteLength(markdown, 'utf8');
      if (proseBytes > TODO_GANTT_PROSE_MAX_BYTES) {
        throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt embedded prose limit exceeded', {
          prose_bytes: proseBytes, prose_limit: TODO_GANTT_PROSE_MAX_BYTES,
        });
      }
      let rendered;
      try { rendered = removeNavigation(renderTodoMarkdown(markdown).html); }
      catch (error) {
        if (error?.code === 'TODO_MARKDOWN_SECTION_TOO_LARGE') {
          throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt narrative section limit exceeded', {
            narrative_ref: task.narrative_ref,
            prose_section_bytes: error.detail.actual_bytes,
            prose_section_limit: error.detail.maximum_bytes,
          });
        }
        throw error;
      }
      result.push({ ref, task, state: states.get(task.task_id), narrative, rendered });
    }
  }
  return { sections: result, proseBytes };
}

function renderEvidence(evidence, unverified) {
  if (evidence === null || evidence === undefined) return '<p class="evidence">Evidence: none</p>';
  return `<dl class="evidence"><dt>Evidence</dt><dd>${escapeHtmlText(evidence.evidence_id)}</dd><dt>Path</dt><dd>${escapeHtmlText(evidence.path)}</dd><dt>Content digest</dt><dd><code>${escapeHtmlText(evidence.content_digest)}</code></dd><dt>Verification</dt><dd>${unverified ? 'local-unverified' : 'local-verified'}</dd></dl>`;
}

function renderSection(section) {
  const key = refKey(section.ref);
  const { state } = section;
  return `<article class="narrative-section" data-narrative-key="${escapeHtmlAttribute(key)}"><h2>${escapeHtmlText(`${section.ref.plan_key}/${section.ref.task_id}: ${section.task.title}`)}</h2><dl class="task-facts"><dt>Status</dt><dd>${escapeHtmlText(state.status)}</dd><dt>Lane</dt><dd>${escapeHtmlText(section.task.lane)}</dd><dt>Started at (local-untrusted)</dt><dd>${escapeHtmlText(state.started_at ?? '—')}</dd><dt>Done at (local-untrusted)</dt><dd>${escapeHtmlText(state.done_at ?? '—')}</dd><dt>Blocked reason</dt><dd>${escapeHtmlText(state.blocked_reason ?? '—')}</dd></dl><div class="narrative-body">${section.rendered || '<p>散文なし</p>'}</div>${renderEvidence(state.evidence, state.evidence_unverified)}</article>`;
}

const CSS = `
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;line-height:1.45}*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#e2e8f0}.notice{margin:0;padding:.65rem 1rem;background:#312e81;font-weight:700}.shell{display:grid;grid-template-columns:minmax(48%,1fr) minmax(24rem,42%);height:calc(100vh - 2.8rem)}.gantt-pane{overflow:auto;border-right:1px solid #475569;background:#f8fafc}.narrative-pane{overflow:auto;padding:0 1.25rem 3rem}.toolbar{position:sticky;top:0;z-index:3;padding:.75rem 0;background:#0f172a}.toolbar button{padding:.55rem .8rem;border:1px solid #94a3b8;border-radius:.35rem;background:#1e293b;color:#fff}.narrative-section{padding:1rem 0;border-bottom:1px solid #475569}.narrative-section[hidden]{display:none}.task-facts,.evidence{display:grid;grid-template-columns:max-content 1fr;gap:.25rem .75rem}.task-facts dt,.evidence dt{font-weight:700}.task-facts dd,.evidence dd{margin:0;overflow-wrap:anywhere}.narrative-body{max-width:72ch}.narrative-body code{white-space:pre-wrap}.narrative-body table{border-collapse:collapse}.narrative-body td,.narrative-body th{border:1px solid #64748b;padding:.25rem}.deactivated-link{text-decoration:underline dotted}.todo-gantt text{font:12px system-ui,sans-serif;fill:#0f172a;pointer-events:none}.todo-node rect{stroke:#475569;stroke-width:1.5}.todo-node:focus rect,.selected-node rect{stroke:#111827;stroke-width:4}.status-pending rect{fill:#94a3b8}.status-in-progress rect{fill:#3b82f6}.status-done rect{fill:#16a34a}.status-blocked rect{fill:#dc2626}.longest-chain-node rect{stroke:#7c3aed;stroke-width:4}.active-node rect{stroke-dasharray:6 3}.next-ready-node rect{filter:drop-shadow(0 0 3px #f59e0b)}.dependency-edge polyline{fill:none;stroke:#64748b;stroke-width:2}.edge-arrow{fill:#64748b}.longest-chain-edge polyline{stroke:#7c3aed;stroke-width:4}.longest-chain-edge .edge-arrow{fill:#7c3aed}.selected-incident-edge polyline{stroke:#0f172a;stroke-width:4}.join-marker polygon{fill:#f59e0b;stroke:#92400e}.group-badge rect{fill:#e2e8f0;stroke:#64748b}.bundle-badge{fill:#475569}@media(max-width:900px){.shell{display:block;height:auto}.gantt-pane,.narrative-pane{height:70vh}.gantt-pane{border-right:0;border-bottom:1px solid #475569}}
`;

const CONTROLLER = `
(()=>{const root=document.querySelector('[data-gantt-root]');if(!root)return;const sections=[...root.querySelectorAll('[data-narrative-key]')];const nodes=[...root.querySelectorAll('[data-node-key]')];const reset=()=>{for(const section of sections)section.hidden=false;for(const node of nodes){node.setAttribute('aria-selected','false');node.classList.remove('selected-node');}root.dataset.viewState='all';};const select=(key)=>{for(const section of sections)section.hidden=section.dataset.narrativeKey!==key;for(const node of nodes){const selected=node.dataset.nodeKey===key;node.setAttribute('aria-selected',String(selected));node.classList.toggle('selected-node',selected);}root.dataset.viewState='selected';};root.addEventListener('click',event=>{const resetButton=event.target.closest('[data-show-all]');if(resetButton&&root.contains(resetButton)){reset();return;}const node=event.target.closest('[data-node-key]');if(node&&root.contains(node))select(node.dataset.nodeKey);});root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();reset();return;}const node=event.target.closest('[data-node-key]');if(node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();select(node.dataset.nodeKey);}});})();
`;

export function renderTodoGanttHtml({ readModel, layout, narratives = [], metadata = {} }) {
  if (readModel?.schema !== 'lattice.todo_store_read.v1' || !Array.isArray(readModel.members)) {
    throw new TypeError('readModel must be lattice.todo_store_read.v1');
  }
  if (!Array.isArray(narratives)) throw new TypeError('narratives must be an array');
  const normalized = normalizeSections(readModel, narratives);
  const taskStates = new Map(normalized.sections.map((section) => [refKey(section.ref), section.state]));
  const svg = renderTodoGanttSvg(layout, { taskStates });
  const sections = normalized.sections.map(renderSection).join('');
  const staticData = serializeJsonForScript({ renderer_version: TODO_GANTT_RENDERER_VERSION, metadata });
  const html = `<!doctype html><html lang="ja"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lattice Todo Gantt</title><style>${CSS}</style></head><body data-gantt-root data-view-state="all"><p class="notice">最長依存鎖はunit-weightの構造深さであり実時間・資源律速ではない。</p><main class="shell"><section class="gantt-pane" aria-label="依存工程図">${svg}</section><aside class="narrative-pane" aria-label="task散文"><div class="toolbar"><button type="button" data-show-all>全文表示へ戻る</button></div><div class="narrative-list">${sections}</div></aside></main><script type="application/json" id="todo-gantt-data">${staticData}</script><script>${CONTROLLER}</script></body></html>`;
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > TODO_GANTT_HTML_MAX_BYTES) {
    throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt HTML limit exceeded', {
      html_bytes: htmlBytes, html_limit: TODO_GANTT_HTML_MAX_BYTES,
    });
  }
  return { html, html_digest: digest(html), prose_bytes: normalized.proseBytes, html_bytes: htmlBytes };
}
