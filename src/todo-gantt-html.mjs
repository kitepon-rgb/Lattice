import { createHash } from 'node:crypto';

import { serializeJsonForScript } from './todo-markdown-renderer.mjs';
import { renderTodoGanttSvg, TODO_GANTT_STATUS_PRESENTATION } from './todo-gantt-svg.mjs';
import { renderDiagramLegend, renderRightPane } from './todo-gantt-html-independence.mjs';
import { escapeHtmlAttribute, escapeHtmlText, refKey } from './todo-gantt-html-shared.mjs';
import { CSS } from './todo-gantt-html-style.mjs';

export const TODO_GANTT_RENDERER_VERSION = 'lattice.todo_gantt_renderer.v17';
export const TODO_GANTT_PROSE_MAX_BYTES = 8 * 1024 * 1024;
export const TODO_GANTT_HTML_MAX_BYTES = 24 * 1024 * 1024;

function projectDisplayName(readModel, metadata) {
  for (const candidate of [metadata?.project_display_name, metadata?.project_name]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return readModel.project_id;
}

export class TodoGanttRenderError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'TodoGanttRenderError';
    this.code = code;
    this.detail = detail;
  }
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Sections carry one row per ToDo, plus the prose accounting for the narratives
 * behind them.
 *
 * The right pane shows the store, not the Markdown: per the 2026-07-19 ruling
 * the "全工程" list is the plan rendered from the ToDo store, and the original
 * documents are reached through each ToDo's source reference. The narratives are
 * still read, because anchor verification needs them, and their size is still
 * bounded — but they are not rendered into the page.
 */
function normalizeSections(readModel, narratives, anchorOutcomes) {
  const supplied = new Map(narratives.map((entry) => [refKey(entry.ref), entry]));
  const outcomes = new Map(anchorOutcomes.map((entry) => [refKey(entry.ref), entry]));
  const result = [];
  const counted = new Set();
  let proseBytes = 0;
  for (const member of readModel.members) {
    const states = new Map(member.tasks.map((state) => [state.task_id, state]));
    for (const task of member.plan.tasks) {
      const ref = { project_id: member.plan.project_id, plan_key: member.plan.plan_key, task_id: task.task_id };
      const narrative = supplied.get(refKey(ref));
      const markdown = narrative?.markdown ?? '';
      const narrativeRef = narrative?.narrative_ref ?? task.narrative_ref;
      // ToDos that share one narrative document count its bytes once.
      const documentKey = narrativeRef === null
        ? refKey(ref) : JSON.stringify([member.plan.plan_key, narrativeRef, digest(markdown)]);
      if (!counted.has(documentKey)) {
        counted.add(documentKey);
        proseBytes += Buffer.byteLength(markdown, 'utf8');
        if (proseBytes > TODO_GANTT_PROSE_MAX_BYTES) {
          throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt embedded prose limit exceeded', {
            prose_bytes: proseBytes, prose_limit: TODO_GANTT_PROSE_MAX_BYTES,
          });
        }
      }
      const anchorOutcome = outcomes.get(refKey(ref)) ?? {
        ref, narrative_ref: narrativeRef, anchored: false, reason: 'anchor_missing',
        origin_line: task.narrative_anchor?.origin_line ?? null,
      };
      result.push({ ref, task, state: states.get(task.task_id), narrativeRef, anchorOutcome });
    }
  }
  return { sections: result, proseBytes };
}

const CONTROLLER = `
(()=>{
  const root=document.querySelector('[data-gantt-root]');if(!root)return;
  const shell=root.querySelector('.shell');
  const divider=root.querySelector('[data-pane-divider]');
  const overviewPanel=root.querySelector('[data-right-panel="overview"]');
  const detailsPanel=root.querySelector('[data-right-panel="details"]');
  const taskIndexPanel=root.querySelector('[data-right-panel="task-index"]');
  const selectedReturnButton=root.querySelector('[data-show-selected]');
  const detailPanels=[...root.querySelectorAll('[data-detail-key]')];
  const nodes=[...root.querySelectorAll('[data-node-key]')];
  const edges=[...root.querySelectorAll('[data-edge-id]')];
  const laneChips=[...root.querySelectorAll('.summary-lane[data-lane-key]')];
  const diagrams=[...root.querySelectorAll('[data-diagram]')];
  const expandToggle=root.querySelector('[data-toggle-expanded]');
  const toggleLabel=root.querySelector('[data-toggle-label]');
  const scroller=root.querySelector('[data-diagram-scroll]');
  const zoomOutput=root.querySelector('[data-zoom-output]');
  let svg=root.querySelector('[data-diagram]:not([hidden]) [data-gantt-svg]')??root.querySelector('[data-gantt-svg]');
  let baseWidth=Number(svg?.dataset.svgWidth??0);
  let baseHeight=Number(svg?.dataset.svgHeight??0);
  let zoom=1;let activeLaneKey=null;let selectedKey=null;let resizePointerId=null;let expanded=false;
  const stacked=()=>window.matchMedia('(max-width:900px)').matches;
  const setSplit=(clientX)=>{if(!shell||stacked())return;const bounds=shell.getBoundingClientRect();if(bounds.width<=0)return;const percent=Math.max(30,Math.min(75,(clientX-bounds.left)/bounds.width*100));shell.style.setProperty('--split',percent+'%');};
  const finishResize=(event)=>{if(event.pointerId!==resizePointerId)return;if(divider?.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);resizePointerId=null;};
  const setZoom=(value,minimum=.2)=>{if(!svg||!Number.isFinite(value)||value<=0)return;zoom=Math.max(minimum,Math.min(2,value));svg.setAttribute('width',String(Math.max(1,Math.round(baseWidth*zoom))));svg.setAttribute('height',String(Math.max(1,Math.round(baseHeight*zoom))));if(zoomOutput){const percent=zoom>=.1?String(Math.round(zoom*100)):String(Number((zoom*100).toFixed(1)));zoomOutput.textContent=percent+'%';}};
  const applyLane=(key)=>{activeLaneKey=key;for(const chip of laneChips)chip.setAttribute('aria-pressed',String(chip.dataset.laneKey===key));for(const node of nodes)node.classList.toggle('lane-dimmed',key!==null&&node.dataset.laneKey!==key);for(const edge of edges)edge.classList.toggle('lane-dimmed',key!==null&&edge.dataset.fromLaneKey!==key&&edge.dataset.toLaneKey!==key);};
  const toggleLane=(key)=>applyLane(activeLaneKey===key?null:key);
  // Both diagrams ship in the page; the badge picks which one is on screen.
  const setExpanded=(next)=>{if(diagrams.length<2)return;expanded=next;for(const diagram of diagrams)diagram.hidden=(diagram.dataset.diagram==='expanded')!==expanded;svg=diagrams.find(diagram=>!diagram.hidden)?.querySelector('[data-gantt-svg]')??svg;baseWidth=Number(svg?.dataset.svgWidth??0);baseHeight=Number(svg?.dataset.svgHeight??0);if(expandToggle){expandToggle.setAttribute('aria-expanded',String(expanded));}if(toggleLabel){toggleLabel.textContent=expanded?toggleLabel.dataset.expandedLabel:toggleLabel.dataset.collapsedLabel;}setZoom(zoom);applyLane(activeLaneKey);syncSelection();scroller?.scrollTo(0,0);};
  const showPanel=(name)=>{if(overviewPanel)overviewPanel.hidden=name!=='overview';if(detailsPanel)detailsPanel.hidden=name!=='details';if(taskIndexPanel)taskIndexPanel.hidden=name!=='task-index';if(selectedReturnButton)selectedReturnButton.hidden=name!=='task-index'||selectedKey===null;root.dataset.viewState=name;};
  const syncSelection=()=>{for(const detail of detailPanels)detail.hidden=detail.dataset.detailKey!==selectedKey;for(const node of nodes){const selected=node.dataset.nodeKey===selectedKey;node.setAttribute('aria-selected',String(selected));node.classList.toggle('selected-node',selected);}for(const edge of edges){const selected=selectedKey!==null;edge.classList.toggle('selected-incident-edge',selected&&(edge.dataset.fromNodeKey===selectedKey||edge.dataset.toNodeKey===selectedKey));}};
  const showOverview=()=>{selectedKey=null;syncSelection();showPanel('overview');};
  const showTaskIndex=()=>showPanel('task-index');
  const showSelected=()=>{if(selectedKey===null){showOverview();return;}const target=detailPanels.find(detail=>detail.dataset.detailKey===selectedKey);showPanel('details');target?.scrollIntoView({block:'start'});};
  const select=(key)=>{const target=detailPanels.find(detail=>detail.dataset.detailKey===key);if(!target)return;selectedKey=key;syncSelection();showPanel('details');target.scrollIntoView({block:'start'});};
  root.addEventListener('click',event=>{
    const overviewButton=event.target.closest('[data-show-overview]');if(overviewButton&&root.contains(overviewButton)){showOverview();return;}
    const selectedButton=event.target.closest('[data-show-selected]');if(selectedButton&&root.contains(selectedButton)){showSelected();return;}
    const taskIndexButton=event.target.closest('[data-show-task-index]');if(taskIndexButton&&root.contains(taskIndexButton)){showTaskIndex();return;}
    const expandButton=event.target.closest('[data-toggle-expanded]');if(expandButton&&root.contains(expandButton)){setExpanded(!expanded);return;}
    const selectButton=event.target.closest('[data-select-node-key]');if(selectButton&&root.contains(selectButton)){select(selectButton.dataset.selectNodeKey);return;}
    const zoomButton=event.target.closest('[data-zoom-action]');if(zoomButton&&root.contains(zoomButton)){const action=zoomButton.dataset.zoomAction;if(action==='in')setZoom(zoom<1&&zoom*1.25>=1?1:zoom*1.25,.001);else if(action==='out')setZoom(zoom>1&&zoom/1.25<=1?1:zoom/1.25,.001);else if(action==='reset')setZoom(1);else if(action==='fit'&&scroller){setZoom(Math.min(1,(scroller.clientWidth-16)/baseWidth),.001);scroller.scrollTo(0,0);}return;}
    const laneChip=event.target.closest('.summary-lane[data-lane-key]');if(laneChip&&root.contains(laneChip)){toggleLane(laneChip.dataset.laneKey);return;}
    const node=event.target.closest('[data-node-key]');if(node&&root.contains(node))select(node.dataset.nodeKey);
  });
  root.addEventListener('dblclick',event=>{const paneDivider=event.target.closest('[data-pane-divider]');if(paneDivider&&root.contains(paneDivider)&&shell&&!stacked())shell.style.setProperty('--split','58%');});
  root.addEventListener('pointerdown',event=>{const paneDivider=event.target.closest('[data-pane-divider]');if(!paneDivider||!root.contains(paneDivider)||stacked())return;resizePointerId=event.pointerId;paneDivider.setPointerCapture(event.pointerId);setSplit(event.clientX);event.preventDefault();});
  root.addEventListener('pointermove',event=>{if(event.pointerId===resizePointerId)setSplit(event.clientX);});
  root.addEventListener('pointerup',finishResize);root.addEventListener('pointercancel',finishResize);
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();showOverview();applyLane(null);return;}const laneChip=event.target.closest('.summary-lane[data-lane-key]');if(laneChip&&(event.key==='Enter'||event.key===' ')){event.preventDefault();toggleLane(laneChip.dataset.laneKey);return;}const node=event.target.closest('[data-node-key]');if(node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();select(node.dataset.nodeKey);}});
  showPanel('overview');
})();
`;

export function renderTodoGanttHtml({
  readModel, layout, narratives = [], anchorOutcomes = [], presentation = null, metadata = {},
  expandedLayout = null,
}) {
  if (readModel?.schema !== 'lattice.todo_store_read.v1' || !Array.isArray(readModel.members)) {
    throw new TypeError('readModel must be lattice.todo_store_read.v1');
  }
  if (!Array.isArray(narratives)) throw new TypeError('narratives must be an array');
  if (!Array.isArray(anchorOutcomes)) throw new TypeError('anchorOutcomes must be an array');
  if (presentation !== null
    && (presentation?.schema !== 'lattice.todo_gantt_presentation_model.v1'
      || presentation.project_id !== readModel.project_id)) {
    throw new TypeError('presentation must be lattice.todo_gantt_presentation_model.v1');
  }
  const normalized = normalizeSections(readModel, narratives, anchorOutcomes);
  const displayName = projectDisplayName(readModel, metadata);
  const svg = renderTodoGanttSvg(layout, { presentation });
  // The expanded diagram travels with the page so the badge can bring the
  // history back without a round trip. A file:// artifact has nowhere to ask.
  const expandedSvg = expandedLayout === null ? '' : renderTodoGanttSvg(expandedLayout, { presentation });
  const diagrams = expandedSvg === ''
    ? `<div data-diagram="live">${svg}</div>`
    : `<div data-diagram="live">${svg}</div><div data-diagram="expanded" hidden>${expandedSvg}</div>`;
  const rightPane = renderRightPane(normalized.sections, layout, presentation, readModel);
  const staticData = serializeJsonForScript({
    renderer_version: TODO_GANTT_RENDERER_VERSION,
    metadata,
    presentation,
  });
  const html = `<!doctype html><html lang="ja"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lattice — ${escapeHtmlText(displayName)} 依存工程図</title><style>${CSS}</style></head><body data-gantt-root data-view-state="overview"><main class="shell"><section class="gantt-pane" aria-label="${escapeHtmlAttribute(displayName)} 依存工程図"><div class="diagram-toolbar" role="group" aria-label="図のズーム"><strong class="project-heading">${escapeHtmlText(displayName)} 依存工程図</strong><button type="button" data-zoom-action="out" aria-label="縮小">−</button><button type="button" data-zoom-action="reset">等倍</button><button type="button" data-zoom-action="in" aria-label="拡大">＋</button><button type="button" data-zoom-action="fit">全体表示</button><output class="zoom-readout" data-zoom-output aria-live="polite">100%</output><span class="diagram-note">縦=依存段階（時間ではない）</span></div>${renderDiagramLegend(presentation, layout, expandedSvg !== '')}<div class="diagram-scroll" data-diagram-scroll tabindex="0" aria-label="縦方向を主にスクロール可能な依存工程図">${diagrams}</div></section><div class="pane-divider" data-pane-divider aria-hidden="true"></div><aside class="narrative-pane" aria-label="選択工程の詳細と全工程一覧">${rightPane}</aside></main><script type="application/json" id="todo-gantt-data">${staticData}</script><script>${CONTROLLER}</script></body></html>`;
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > TODO_GANTT_HTML_MAX_BYTES) {
    throw new TodoGanttRenderError('TODO_SCALE_EXCEEDED', 'todo gantt HTML limit exceeded', {
      html_bytes: htmlBytes, html_limit: TODO_GANTT_HTML_MAX_BYTES,
    });
  }
  return { html, html_digest: digest(html), prose_bytes: normalized.proseBytes, html_bytes: htmlBytes };
}
