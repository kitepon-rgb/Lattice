import { createHash } from 'node:crypto';

import {
  renderTodoMarkdownDocument,
  serializeJsonForScript,
} from './todo-markdown-renderer.mjs';
import { renderTodoGanttSvg } from './todo-gantt-svg.mjs';

export const TODO_GANTT_RENDERER_VERSION = 'lattice.todo_gantt_renderer.v6';
export const TODO_GANTT_PROSE_MAX_BYTES = 8 * 1024 * 1024;
export const TODO_GANTT_HTML_MAX_BYTES = 24 * 1024 * 1024;

const DOCUMENT_STATUS = Object.freeze({
  pending: Object.freeze({ mark: '☐', label: '未着手' }),
  'in-progress': Object.freeze({ mark: '▶', label: '作業中' }),
  blocked: Object.freeze({ mark: '⛔', label: 'blocked' }),
  done: Object.freeze({ mark: '✅', label: '完了' }),
});

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

function normalizeSections(readModel, narratives, anchorOutcomes) {
  const supplied = new Map(narratives.map((entry) => [refKey(entry.ref), entry]));
  const outcomes = new Map(anchorOutcomes.map((entry) => [refKey(entry.ref), entry]));
  const result = [];
  const documents = new Map();
  let proseBytes = 0;
  for (const member of readModel.members) {
    const states = new Map(member.tasks.map((state) => [state.task_id, state]));
    for (const task of member.plan.tasks) {
      const ref = { project_id: member.plan.project_id, plan_key: member.plan.plan_key, task_id: task.task_id };
      const narrative = supplied.get(refKey(ref));
      const markdown = narrative?.markdown ?? '';
      const narrativeRef = narrative?.narrative_ref ?? task.narrative_ref;
      const documentKey = narrativeRef === null
        ? refKey(ref) : JSON.stringify([member.plan.plan_key, narrativeRef, digest(markdown)]);
      let document = documents.get(documentKey);
      if (document === undefined) {
        proseBytes += Buffer.byteLength(markdown, 'utf8');
        if (proseBytes > TODO_GANTT_PROSE_MAX_BYTES) {
          throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt embedded prose limit exceeded', {
            prose_bytes: proseBytes, prose_limit: TODO_GANTT_PROSE_MAX_BYTES,
          });
        }
        document = { markdown, narrativeRef, tasks: [], rendered: '' };
        documents.set(documentKey, document);
      }
      const anchorOutcome = outcomes.get(refKey(ref)) ?? {
        ref, narrative_ref: narrativeRef, anchored: false, reason: 'anchor_missing',
        origin_line: task.narrative_anchor?.origin_line ?? null,
      };
      const section = {
        ref, task, state: states.get(task.task_id), documentKey, narrativeRef, anchorOutcome, document,
      };
      document.tasks.push(section);
      result.push(section);
    }
  }
  for (const document of documents.values()) {
    const taskStatesByLine = new Map();
    for (const section of document.tasks) {
      if (!section.anchorOutcome.anchored) continue;
      const status = DOCUMENT_STATUS[section.state.status] ?? { mark: '?', label: '状態不明' };
      taskStatesByLine.set(section.anchorOutcome.origin_line, {
        status: section.state.status,
        mark: status.mark,
        label: status.label,
        narrativeKey: refKey(section.ref),
        blockedReason: section.state.blocked_reason,
      });
    }
    try {
      document.rendered = removeNavigation(renderTodoMarkdownDocument(
        document.markdown,
        { taskStatesByLine },
      ).html);
    } catch (error) {
      if (error?.code === 'TODO_MARKDOWN_SECTION_TOO_LARGE') {
        throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt narrative section limit exceeded', {
          narrative_ref: document.narrativeRef,
          prose_section_bytes: error.detail.actual_bytes,
          prose_section_limit: error.detail.maximum_bytes,
        });
      }
      throw error;
    }
  }
  return { sections: result, proseBytes };
}

function renderTaskLine(section) {
  const key = refKey(section.ref);
  const { state } = section;
  const status = DOCUMENT_STATUS[state.status] ?? { mark: '?', label: '状態不明' };
  const blockedReason = state.status === 'blocked'
    ? `<span class="blocked-reason">— ${escapeHtmlText(state.blocked_reason ?? '理由未記録')}</span>` : '';
  return `<header class="task-line" data-narrative-key="${escapeHtmlAttribute(key)}"><span title="状態表示（更新は lattice todo CLI）" class="document-status status-${escapeHtmlAttribute(state.status)}" role="img" aria-label="${escapeHtmlAttribute(status.label)}">${escapeHtmlText(status.mark)}</span><h2>${escapeHtmlText(section.task.title)}</h2>${blockedReason}</header>`;
}

function renderDocuments(sections) {
  const plans = [];
  for (const section of sections) {
    let plan = plans.at(-1);
    if (plan === undefined || plan.planKey !== section.ref.plan_key) {
      plan = { planKey: section.ref.plan_key, documents: [], byKey: new Map() };
      plans.push(plan);
    }
    let document = plan.byKey.get(section.documentKey);
    if (document === undefined) {
      document = { rendered: section.document.rendered, narrativeRef: section.narrativeRef, tasks: [] };
      plan.byKey.set(section.documentKey, document);
      plan.documents.push(document);
    }
    document.tasks.push(section);
  }
  return plans.map((plan) => `<section class="plan-document"><h1 class="plan-title"><code>${escapeHtmlText(plan.planKey)}</code></h1>${plan.documents.map((document) => {
    if (document.narrativeRef === null) {
      return `<article class="narrative-section">${document.tasks.map(renderTaskLine).join('')}<div class="narrative-body">${document.rendered}</div></article>`;
    }
    const fallback = document.tasks.filter((task) => !task.anchorOutcome.anchored);
    const warnings = fallback.length === 0 ? ''
      : `<aside class="narrative-warning" role="status"><strong>WARN</strong>${fallback.map((task) => `<span>行内表示不可: <code>${escapeHtmlText(task.task.task_id)}</code> — ${escapeHtmlText(task.anchorOutcome.reason)}</span>`).join('')}</aside>`;
    return `<article class="narrative-section">${warnings}<div class="narrative-body">${document.rendered}</div>${fallback.map(renderTaskLine).join('')}</article>`;
  }).join('')}</section>`).join('');
}

const CSS = `
:root{
  color-scheme:light;
  --surface-1:#fcfcfb;
  --surface-2:#f4f4f2;
  --text-primary:#0b0b0b;
  --text-secondary:#52514e;
  --border:#d9d8d4;
  --accent:#2a78d6;
  --good:#0ca30c;
  --critical:#d03b3b;
  font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;
  font-size:13.5px;
  font-weight:400;
  line-height:1.6;
}
*{box-sizing:border-box}
body{display:grid;grid-template-rows:minmax(0,1fr);height:100vh;margin:0;background:var(--surface-1);color:var(--text-primary)}
.shell{display:grid;grid-template-columns:minmax(0,var(--split,58%)) auto minmax(24rem,1fr);min-width:0;min-height:0}
.gantt-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;background:var(--surface-1)}
.pane-divider{width:8px;cursor:col-resize;background:rgba(217,216,212,.5);touch-action:none}
.diagram-toolbar,.toolbar{z-index:3;display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary)}
.toolbar{position:sticky;top:0;background:var(--surface-1)}
.diagram-toolbar button,.toolbar button{min-height:32px;padding:0 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface-2);color:var(--text-primary);font:500 12px/1.6 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
.diagram-toolbar button:focus-visible,.toolbar button:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}
.zoom-readout{min-width:48px;text-align:center;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
.diagram-note{margin-left:auto;color:var(--text-secondary);font-size:12px;font-weight:500}
[data-view-state="all"] .narrative-pane>.toolbar{display:none}
.diagram-scroll{min-width:0;min-height:0;max-width:calc(100% - 16px);margin:8px;overflow:auto;overscroll-behavior:contain;border:1px solid rgba(217,216,212,.5)}
.todo-gantt{display:block;max-width:none}
.narrative-pane{min-width:0;overflow:auto;background:var(--surface-1)}
.narrative-document{max-width:72ch;margin:0 auto;padding:16px 24px 48px}
.plan-document+.plan-document{margin-top:24px}
.plan-title{margin:0 0 24px;font-size:19px;font-weight:650;line-height:1.6}
.plan-title code{padding:0;background:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:inherit;font-weight:inherit}
.narrative-section{margin:0 0 24px;padding:0 0 24px;border-bottom:1px solid var(--border)}
.narrative-section[hidden],.task-line[hidden]{display:none}
.narrative-warning{display:flex;flex-direction:column;gap:0;margin:0 0 16px;padding:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary);font-size:12px;font-weight:500}
.narrative-warning code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.task-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin:0 0 8px}
.task-line h2{margin:0;font-size:16px;font-weight:600;line-height:1.6}
.document-status{flex:0 0 16px;color:var(--text-secondary);font-size:13.5px;font-weight:400;cursor:default}
.document-status.status-in-progress{color:var(--accent)}
.document-status.status-done{color:var(--good)}
.document-status.status-blocked{color:var(--critical)}
.blocked-reason{color:var(--text-secondary);font-size:12px;font-weight:500;overflow-wrap:anywhere}
.narrative-body{max-width:72ch;color:var(--text-primary);font-size:13.5px;font-weight:400;line-height:1.6}
.narrative-body h1{margin:24px 0 8px;font-size:19px;font-weight:650;line-height:1.6}
.narrative-body h2,.narrative-body h3,.narrative-body h4,.narrative-body h5,.narrative-body h6{margin:24px 0 8px;font-size:16px;font-weight:600;line-height:1.6}
.narrative-body p{margin:0 0 16px}
.narrative-body ul,.narrative-body ol{margin:0 0 16px;padding-left:24px}
.narrative-body li+li{margin-top:8px}
.narrative-body blockquote{margin:16px 0;padding-left:16px;border-left:1px solid var(--border);color:var(--text-secondary)}
.narrative-body pre{margin:16px 0;overflow:auto;padding:16px;background:var(--surface-2)}
.narrative-body code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap}
.narrative-body table{margin:16px 0;border-collapse:collapse}
.narrative-body td,.narrative-body th{padding:8px;border:1px solid var(--border);text-align:left}
.markdown-task{position:relative;list-style:none}
.markdown-checkbox{position:absolute;left:-24px;width:16px;color:var(--text-secondary);font-size:13.5px;font-weight:400;cursor:default}
.markdown-task>.document-status{position:absolute;left:-24px;width:16px}
.markdown-task>p{display:inline}
.deactivated-link{color:var(--text-primary);text-decoration:underline dotted}
.todo-gantt text{font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;pointer-events:none}
.todo-node .node-surface{fill:var(--surface-2);stroke:var(--border);stroke-width:1}
.todo-node .node-title{fill:var(--text-primary);font-size:13.5px;font-weight:400}
.todo-node .node-id{fill:var(--text-secondary);font-size:13.5px;font-weight:400}
.todo-node .status-mark{fill:var(--text-secondary);font-size:13.5px;font-weight:400}
.status-in-progress .node-surface{fill:var(--surface-1);stroke:var(--accent);stroke-width:2}
.status-in-progress .status-mark{fill:var(--accent)}
.status-in-progress .status-bar{stroke:var(--accent);stroke-width:2;stroke-linecap:round}
.status-done .node-surface{fill:var(--surface-2);stroke:var(--border);stroke-width:1}
.status-done .status-mark{fill:var(--good)}
.status-blocked .node-surface{fill:var(--surface-1);stroke:var(--critical);stroke-width:2}
.status-blocked .status-mark{fill:var(--critical)}
.next-ready-node .node-surface{stroke:var(--accent);stroke-width:2;stroke-dasharray:4 3}
.todo-node:focus .node-surface,.selected-node .node-surface{stroke:var(--text-primary);stroke-width:2.5}
.dependency-edge polyline{fill:none;stroke:var(--text-secondary);stroke-width:1.5;opacity:.4}
.dependency-edge .edge-arrow{fill:var(--text-secondary);opacity:.7}
.longest-chain-edge polyline,.selected-incident-edge polyline{stroke:var(--text-primary);stroke-width:2.5;opacity:1}
.longest-chain-edge .edge-arrow,.selected-incident-edge .edge-arrow{fill:var(--text-primary);opacity:1}
.join-marker polygon{fill:var(--surface-1);stroke:var(--text-secondary);stroke-width:1}
.summary-container{fill:var(--surface-1);stroke:var(--border);stroke-width:1;stroke-opacity:.5}
.summary-chip{fill:var(--surface-2);stroke:none}
.summary-plan text{fill:var(--text-primary);font-size:12px;font-weight:500}
.summary-lane text{fill:var(--text-secondary);font-size:12px;font-weight:500}
.summary-lane{cursor:pointer}
.lane-dimmed{opacity:.35}
@media(max-width:900px){body{display:block;height:auto}.shell{display:block}.pane-divider{display:none}.gantt-pane,.narrative-pane{height:70vh}.gantt-pane{border-bottom:1px solid var(--border)}}
`;

const CONTROLLER = `
(()=>{const root=document.querySelector('[data-gantt-root]');if(!root)return;const shell=root.querySelector('.shell');const divider=root.querySelector('[data-pane-divider]');const narrativeTargets=[...root.querySelectorAll('[data-narrative-key]')];const taskLines=[...root.querySelectorAll('.task-line[data-narrative-key]')];const sections=[...root.querySelectorAll('.narrative-section')];const sectionLines=sections.map(section=>({section,lines:[...section.querySelectorAll('[data-narrative-key]')]}));const nodes=[...root.querySelectorAll('[data-node-key]')];const edges=[...root.querySelectorAll('[data-edge-id]')];const laneChips=[...root.querySelectorAll('.summary-lane[data-lane-key]')];const svg=root.querySelector('[data-gantt-svg]');const scroller=root.querySelector('[data-diagram-scroll]');const zoomOutput=root.querySelector('[data-zoom-output]');const baseWidth=Number(svg?.dataset.svgWidth??0);const baseHeight=Number(svg?.dataset.svgHeight??0);let zoom=1;let activeLaneKey=null;let resizePointerId=null;const stacked=()=>window.matchMedia('(max-width:900px)').matches;const setSplit=(clientX)=>{if(!shell||stacked())return;const bounds=shell.getBoundingClientRect();if(bounds.width<=0)return;const percent=Math.max(30,Math.min(75,(clientX-bounds.left)/bounds.width*100));shell.style.setProperty('--split',percent+'%');};const finishResize=(event)=>{if(event.pointerId!==resizePointerId)return;if(divider?.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);resizePointerId=null;};const setZoom=(value,minimum=.2)=>{if(!svg||!Number.isFinite(value)||value<=0)return;zoom=Math.max(minimum,Math.min(2,value));svg.setAttribute('width',String(Math.max(1,Math.round(baseWidth*zoom))));svg.setAttribute('height',String(Math.max(1,Math.round(baseHeight*zoom))));if(zoomOutput){const percent=zoom>=.1?String(Math.round(zoom*100)):String(Number((zoom*100).toFixed(1)));zoomOutput.textContent=percent+'%';}};const applyLane=(key)=>{activeLaneKey=key;for(const chip of laneChips)chip.setAttribute('aria-pressed',String(chip.dataset.laneKey===key));for(const node of nodes)node.classList.toggle('lane-dimmed',key!==null&&node.dataset.laneKey!==key);for(const edge of edges)edge.classList.toggle('lane-dimmed',key!==null&&edge.dataset.fromLaneKey!==key&&edge.dataset.toLaneKey!==key);};const toggleLane=(key)=>applyLane(activeLaneKey===key?null:key);const reset=()=>{for(const line of taskLines)line.hidden=false;for(const section of sections)section.hidden=false;for(const node of nodes){node.setAttribute('aria-selected','false');node.classList.remove('selected-node');}root.dataset.viewState='all';};const select=(key)=>{for(const line of taskLines)line.hidden=line.dataset.narrativeKey!==key;for(const item of sectionLines)item.section.hidden=!item.lines.some(line=>line.dataset.narrativeKey===key);for(const node of nodes){const selected=node.dataset.nodeKey===key;node.setAttribute('aria-selected',String(selected));node.classList.toggle('selected-node',selected);}root.dataset.viewState='selected';const target=narrativeTargets.find(line=>line.dataset.narrativeKey===key);target?.scrollIntoView({block:'start'});};root.addEventListener('click',event=>{const resetButton=event.target.closest('[data-show-all]');if(resetButton&&root.contains(resetButton)){reset();return;}const zoomButton=event.target.closest('[data-zoom-action]');if(zoomButton&&root.contains(zoomButton)){const action=zoomButton.dataset.zoomAction;if(action==='in')setZoom(zoom<1&&zoom*1.25>=1?1:zoom*1.25,.001);else if(action==='out')setZoom(zoom>1&&zoom/1.25<=1?1:zoom/1.25,.001);else if(action==='reset')setZoom(1);else if(action==='fit'&&scroller){setZoom(Math.min(1,(scroller.clientWidth-16)/baseWidth),.001);scroller.scrollTo(0,0);}return;}const laneChip=event.target.closest('.summary-lane[data-lane-key]');if(laneChip&&root.contains(laneChip)){toggleLane(laneChip.dataset.laneKey);return;}const node=event.target.closest('[data-node-key]');if(node&&root.contains(node))select(node.dataset.nodeKey);});root.addEventListener('dblclick',event=>{const paneDivider=event.target.closest('[data-pane-divider]');if(paneDivider&&root.contains(paneDivider)&&shell&&!stacked())shell.style.setProperty('--split','58%');});root.addEventListener('pointerdown',event=>{const paneDivider=event.target.closest('[data-pane-divider]');if(!paneDivider||!root.contains(paneDivider)||stacked())return;resizePointerId=event.pointerId;paneDivider.setPointerCapture(event.pointerId);setSplit(event.clientX);event.preventDefault();});root.addEventListener('pointermove',event=>{if(event.pointerId===resizePointerId)setSplit(event.clientX);});root.addEventListener('pointerup',finishResize);root.addEventListener('pointercancel',finishResize);root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();reset();applyLane(null);return;}const laneChip=event.target.closest('.summary-lane[data-lane-key]');if(laneChip&&(event.key==='Enter'||event.key===' ')){event.preventDefault();toggleLane(laneChip.dataset.laneKey);return;}const node=event.target.closest('[data-node-key]');if(node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();select(node.dataset.nodeKey);}});})();
`;

export function renderTodoGanttHtml({
  readModel, layout, narratives = [], anchorOutcomes = [], metadata = {},
}) {
  if (readModel?.schema !== 'lattice.todo_store_read.v1' || !Array.isArray(readModel.members)) {
    throw new TypeError('readModel must be lattice.todo_store_read.v1');
  }
  if (!Array.isArray(narratives)) throw new TypeError('narratives must be an array');
  if (!Array.isArray(anchorOutcomes)) throw new TypeError('anchorOutcomes must be an array');
  const normalized = normalizeSections(readModel, narratives, anchorOutcomes);
  const svg = renderTodoGanttSvg(layout);
  const documents = renderDocuments(normalized.sections);
  const staticData = serializeJsonForScript({ renderer_version: TODO_GANTT_RENDERER_VERSION, metadata });
  const html = `<!doctype html><html lang="ja"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lattice Todo Gantt</title><style>${CSS}</style></head><body data-gantt-root data-view-state="all"><main class="shell"><section class="gantt-pane" aria-label="依存工程図"><div class="diagram-toolbar" role="group" aria-label="図のズーム"><button type="button" data-zoom-action="out" aria-label="縮小">−</button><button type="button" data-zoom-action="reset">等倍</button><button type="button" data-zoom-action="in" aria-label="拡大">＋</button><button type="button" data-zoom-action="fit">全体表示</button><output class="zoom-readout" data-zoom-output aria-live="polite">100%</output><span class="diagram-note">最長依存鎖はunit-weightの構造深さであり実時間・資源律速ではない。</span></div><div class="diagram-scroll" data-diagram-scroll tabindex="0" aria-label="縦方向を主にスクロール可能な依存工程図">${svg}</div></section><div class="pane-divider" data-pane-divider aria-hidden="true"></div><aside class="narrative-pane" aria-label="plan Markdown文書"><div class="toolbar"><button type="button" data-show-all>全文表示へ戻る</button></div><div class="narrative-document">${documents}</div></aside></main><script type="application/json" id="todo-gantt-data">${staticData}</script><script>${CONTROLLER}</script></body></html>`;
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > TODO_GANTT_HTML_MAX_BYTES) {
    throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt HTML limit exceeded', {
      html_bytes: htmlBytes, html_limit: TODO_GANTT_HTML_MAX_BYTES,
    });
  }
  return { html, html_digest: digest(html), prose_bytes: normalized.proseBytes, html_bytes: htmlBytes };
}
