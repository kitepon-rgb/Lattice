import { createHash } from 'node:crypto';

import {
  renderTodoMarkdownDocument,
  serializeJsonForScript,
} from './todo-markdown-renderer.mjs';
import { renderTodoGanttSvg, TODO_GANTT_STATUS_PRESENTATION } from './todo-gantt-svg.mjs';

export const TODO_GANTT_RENDERER_VERSION = 'lattice.todo_gantt_renderer.v13';
export const TODO_GANTT_PROSE_MAX_BYTES = 8 * 1024 * 1024;
export const TODO_GANTT_HTML_MAX_BYTES = 24 * 1024 * 1024;

const DOCUMENT_STATUS = TODO_GANTT_STATUS_PRESENTATION;

function statusMarkup(status, suffix = '') {
  const value = DOCUMENT_STATUS[status] ?? { mark: '?', label: '状態不明' };
  return `<span class="status-symbol status-${escapeHtmlAttribute(status)}" role="img" aria-label="${escapeHtmlAttribute(value.label)}">${escapeHtmlText(value.mark)}</span>${suffix}`;
}

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

/** Keys of the ToDos the diagram does not draw, empty when nothing was folded. */
function foldIndex(layout) {
  return new Set((layout?.folded ?? []).map((ref) => refKey(ref)));
}

function renderTaskIndexEntry(section, lookup) {
  const key = refKey(section.ref);
  const status = DOCUMENT_STATUS[section.state.status] ?? { mark: '?', label: '状態不明' };
  const blockedReason = section.state.status === 'blocked'
    ? `<span class="task-index-blocked-reason">— ${escapeHtmlText(section.state.blocked_reason ?? '理由未記録')}</span>` : '';
  // A ToDo the diagram does not draw keeps its row here — the index is the
  // complete list — and it selects its own detail, which exists either way.
  const selectKey = key;
  return `<li><button type="button" data-select-node-key="${escapeHtmlAttribute(selectKey)}"><span class="task-index-status status-${escapeHtmlAttribute(section.state.status)}" role="img" aria-label="${escapeHtmlAttribute(status.label)}">${escapeHtmlText(status.mark)}</span><span class="task-index-reference">${escapeHtmlText(taskReference(section, lookup))}</span><strong>${escapeHtmlText(section.task.title)}</strong>${blockedReason}</button></li>`;
}

function renderTaskIndex(sections, lookup, folds = new Set()) {
  const plans = [];
  for (const section of sections) {
    let plan = plans.at(-1);
    if (plan === undefined || plan.planKey !== section.ref.plan_key) {
      plan = { planKey: section.ref.plan_key, tasks: [] };
      plans.push(plan);
    }
    plan.tasks.push(section);
  }
  return plans.map((plan) => {
    const drawn = plan.tasks.filter((section) => !folds.has(refKey(section.ref)));
    const folded = plan.tasks.filter((section) => folds.has(refKey(section.ref)));
    const drawnList = drawn.length === 0 ? ''
      : `<ol class="task-index-list">${drawn.map((section) => renderTaskIndexEntry(section, lookup)).join('')}</ol>`;
    const foldedList = folded.length === 0 ? ''
      : `<details class="task-index-folded"><summary>完走済みとして畳んだ工程 ${folded.length}件</summary><ol class="task-index-list">${folded.map((section) => renderTaskIndexEntry(section, lookup)).join('')}</ol></details>`;
    return `<section class="task-index-plan"><h2><code>${escapeHtmlText(plan.planKey)}</code></h2>${drawnList}${foldedList}</section>`;
  }).join('');
}

function presentationLookup(presentation) {
  return {
    lanes: new Map((presentation?.lanes ?? []).map((lane) => [JSON.stringify([lane.plan_key, lane.lane]), lane])),
    taskNumbers: new Map((presentation?.task_numbers ?? []).map((entry) => [refKey(entry), entry])),
  };
}

function taskReference(section, lookup) {
  const number = lookup.taskNumbers.get(refKey(section.ref));
  return number === undefined ? `ID ${section.task.task_id}` : `工程 ${number.display_number}`;
}

function renderRelationList(relations, sectionByKey, lookup, emptyText, folds = new Set()) {
  if (relations.length === 0) return `<p class="relation-empty">${escapeHtmlText(emptyText)}</p>`;
  return `<ul class="relation-list">${relations.map((relation) => {
    const targetKey = refKey(relation.ref);
    const target = sectionByKey.get(targetKey);
    if (target === undefined) return '';
    const join = relation.joinIds.length === 0 ? ''
      : `<span class="relation-kind">合流条件: ${escapeHtmlText(relation.joinIds.join(', '))}</span>`;
    // Say which ones the diagram does not draw, so the reader stops looking.
    const reference = folds.has(targetKey)
      ? `${taskReference(target, lookup)}（図では非表示）` : taskReference(target, lookup);
    return `<li><button type="button" data-select-node-key="${escapeHtmlAttribute(targetKey)}"><strong>${escapeHtmlText(reference)}</strong><span>${escapeHtmlText(target.task.title)}</span></button>${join}</li>`;
  }).join('')}</ul>`;
}

/** Phase states that are over: nothing is dispatched or judged under them again. */
const SETTLED_PHASE_STATUS = Object.freeze(['accepted', 'rejected']);

function renderPhaseProgress(readModel) {
  const rows = [];
  const settledRows = [];
  for (const member of readModel.members) {
    if (!['lattice.todo_plan.v4', 'lattice.todo_plan.v5'].includes(member.plan.schema)) continue;
    const phases = new Map(member.snapshot.phases.map((phase) => [phase.phase_id, phase]));
    for (const phase of member.plan.phases) {
      const tasks = member.plan.tasks.filter((task) => task.phase_id === phase.phase_id);
      const states = new Map(member.tasks.map((task) => [task.task_id, task.status]));
      const done = tasks.filter((task) => states.get(task.task_id) === 'done').length;
      const state = phases.get(phase.phase_id);
      const row = `<li class="phase-progress status-${escapeHtmlAttribute(state.status)}"><header><strong>${escapeHtmlText(phase.title ?? phase.phase_id)}</strong><span>${escapeHtmlText(state.status)}</span></header><p><code>${escapeHtmlText(`${member.plan.plan_key}/${phase.phase_id}`)}</code> — policy <code>${escapeHtmlText(phase.gate_policy)}</code> — ToDo ${done}/${tasks.length}</p><progress max="${tasks.length}" value="${done}">${done}/${tasks.length}</progress></li>`;
      // A settled Phase is history. It stays reachable, but it does not push the
      // live ones off the first screen.
      (SETTLED_PHASE_STATUS.includes(state.status) ? settledRows : rows).push(row);
    }
  }
  const decoupled = readModel.members.some(({ plan }) => plan.schema === 'lattice.todo_plan.v5');
  const guidance = decoupled
    ? 'ToDo完了とPhase受理は別です。Phaseは重監査の順序を表し、通常ToDoの開始順はToDo依存だけで決まります。'
    : 'ToDo完了とPhase受理は別です。<code>gate_ready</code>では後続Phaseはまだ解放されません。';
  if (rows.length === 0 && settledRows.length === 0) return '';
  const liveList = rows.length === 0
    ? '<p class="readiness-note">進行中のPhaseはありません。</p>'
    : `<ol>${rows.join('')}</ol>`;
  const settledList = settledRows.length === 0 ? ''
    : `<details class="phase-settled"><summary>決着済みPhase ${settledRows.length}件</summary><ol>${settledRows.join('')}</ol></details>`;
  return `<section class="phase-overview"><h2>Phase進捗</h2><p>${guidance}</p>${liveList}${settledList}</section>`;
}

function renderRightPane(sections, layout, presentation, readModel) {
  const lookup = presentationLookup(presentation);
  const sectionByKey = new Map(sections.map((section) => [refKey(section.ref), section]));
  const nodeByKey = new Map(layout.nodes.map((node) => [refKey(node.ref), node]));
  const folds = foldIndex(layout);
  const incoming = new Map(sections.map((section) => [refKey(section.ref), []]));
  const outgoing = new Map(sections.map((section) => [refKey(section.ref), []]));
  const addRelation = (relations, ownerKey, ref, joinIds) => {
    const entries = relations.get(ownerKey);
    if (entries === undefined) return;
    let entry = entries.find((candidate) => refKey(candidate.ref) === refKey(ref));
    if (entry === undefined) {
      entry = { ref, joinIds: [] };
      entries.push(entry);
    }
    entry.joinIds = [...new Set([...entry.joinIds, ...joinIds])].sort();
  };
  // Premises and successors come from the FULL graph. `layout.edges` is the
  // drawn graph, where a fold unit's interior dependencies have been contracted
  // away — reading those here would tell a folded ToDo it has no premises.
  for (const edge of layout.full_edges ?? layout.edges) {
    addRelation(incoming, refKey(edge.to), edge.from, edge.join_ids);
    addRelation(outgoing, refKey(edge.from), edge.to, edge.join_ids);
  }
  const counts = { pending: 0, 'in-progress': 0, blocked: 0, done: 0 };
  for (const section of sections) counts[section.state.status] += 1;
  const active = sections.filter((section) => section.state.status === 'in-progress');
  const ready = layout.nodes.filter((node) => node.visibility.next_ready);
  const dispatchSummary = ready.length > 1
    ? `<p class="readiness-note"><strong>同時dispatch推奨:</strong> ${ready.length}工程。ready frontier全件が既定です。一部だけを直列着手する場合は理由が必要です。</p>`
    : ready.length === 1
      ? '<p class="readiness-note"><strong>着手候補:</strong> 1工程です。</p>'
      : '<p class="readiness-note">現在のready frontierは空です。</p>';
  const activeLinks = active.length === 0 ? '<p>作業中の工程はありません。</p>'
    : `<ul class="active-list">${active.map((section) => `<li><button type="button" data-select-node-key="${escapeHtmlAttribute(refKey(section.ref))}">${escapeHtmlText(taskReference(section, lookup))} — ${escapeHtmlText(section.task.title)}</button></li>`).join('')}</ul>`;
  const overview = `<section class="right-overview" data-right-panel="overview"><h1>工程を選択してください</h1><p>左の依存工程図から工程を選ぶと、題名・状態・前提・後続を表示します。</p><div class="status-summary"><span>☐ 未着手 ${counts.pending}</span><span>▶ 作業中 ${counts['in-progress']}</span><span>✅ 完了 ${counts.done}</span><span>⛔ ブロック中 ${counts.blocked}</span></div>${dispatchSummary}${renderPhaseProgress(readModel)}<h2>作業中</h2>${activeLinks}</section>`;
  const details = sections.map((section) => {
    const key = refKey(section.ref);
    const node = nodeByKey.get(key);
    const status = DOCUMENT_STATUS[section.state.status] ?? { mark: '?', label: '状態不明' };
    const lane = lookup.lanes.get(JSON.stringify([section.ref.plan_key, section.task.lane]));
    const category = lane === undefined ? section.task.lane : `${section.task.lane} — ${lane.name}`;
    const categoryDescription = lane === undefined ? '' : `<p class="category-description">${escapeHtmlText(lane.description)}</p>`;
    const blockedReason = section.state.status === 'blocked'
      ? `<p><strong>ブロック理由:</strong> ${escapeHtmlText(section.state.blocked_reason ?? '理由未記録')}</p>` : '';
    const sourceLine = section.anchorOutcome.origin_line === null ? '' : `:${section.anchorOutcome.origin_line}`;
    const sourceRef = section.narrativeRef ?? '参照なし';
    const anchorText = section.anchorOutcome.anchored
      ? `元plan: ${sourceRef}${sourceLine} — 行対応を確認済み`
      : `元plan: ${sourceRef}${sourceLine} — 行対応を確認できないため、本文位置との対応は表示していません`;
    const readiness = node?.visibility.next_ready
      ? `<p class="readiness-note">ready frontierの一員です。${ready.length > 1 ? '他のready工程と同時dispatchするのが既定です。subsetだけを選ぶ場合は理由を記録してください。' : '現在の唯一の着手候補です。'}</p>`
      : incoming.get(key).length === 0 ? '<p class="readiness-note">登録済みの前提工程はありません。図だけではdispatch可否を判定しません。</p>' : '';
    // Say it plainly when the reader will not find this ToDo on the diagram.
    const foldedNote = !folds.has(key) ? ''
      : '<p class="fold-note">完走済みのため図には描いていません。図に出すには <code>lattice todo gantt --scope all</code> を実行してください。</p>';
    return `<article class="task-detail" data-detail-key="${escapeHtmlAttribute(key)}" hidden><header><span class="detail-status status-${escapeHtmlAttribute(section.state.status)}">${escapeHtmlText(status.mark)} ${escapeHtmlText(status.label)}</span><span class="detail-reference">${escapeHtmlText(taskReference(section, lookup))}</span></header><h1>${escapeHtmlText(section.task.title)}</h1><p class="detail-category"><strong>カテゴリ:</strong> ${escapeHtmlText(category)}</p>${categoryDescription}<p><strong>正規ID:</strong> <code>${escapeHtmlText(`${section.ref.plan_key}/${section.task.task_id}`)}</code></p>${blockedReason}${readiness}${foldedNote}<section><h2>前提工程</h2>${renderRelationList(incoming.get(key), sectionByKey, lookup, '登録済みの前提工程はありません。', folds)}</section><section><h2>後続工程</h2>${renderRelationList(outgoing.get(key), sectionByKey, lookup, '登録済みの後続工程はありません。', folds)}</section><p class="anchor-status">${escapeHtmlText(anchorText)}</p><details class="task-diagnostics"><summary>開発者向け診断</summary><dl><dt>canonical ref</dt><dd><code>${escapeHtmlText(`${section.ref.project_id}/${section.ref.plan_key}/${section.task.task_id}`)}</code></dd><dt>anchor</dt><dd>${escapeHtmlText(section.anchorOutcome.anchored ? 'verified' : section.anchorOutcome.reason)}</dd></dl></details></article>`;
  }).join('');
  const taskIndex = renderTaskIndex(sections, lookup, folds);
  return `<div class="right-toolbar"><button type="button" data-show-overview>概要</button><button type="button" data-show-selected hidden>選択工程へ戻る</button><button type="button" data-show-task-index>元Markdown全文</button></div><div class="right-content">${overview}<div data-right-panel="details" hidden>${details}</div><section class="task-index" data-right-panel="task-index" hidden><h1>全工程</h1><p>Latticeに登録された全工程を、現在の状態とともに登録順で表示しています。</p>${taskIndex}</section></div>`;
}

function renderDiagramLegend(presentation, layout = null, expandable = false) {
  const categories = (presentation?.lanes ?? []).map((lane) => `<div class="category-entry"><dt><code>${escapeHtmlText(lane.lane)}</code> — ${escapeHtmlText(lane.name)}</dt><dd>${escapeHtmlText(lane.description)}</dd></div>`).join('');
  const categoryDetails = categories === '' ? '' : `<details class="category-legend"><summary>カテゴリ説明</summary><dl>${categories}</dl></details>`;
  const foldedCount = layout?.scope?.folded_task_count ?? 0;
  // The badge says what is missing from the diagram, so it is also the control
  // that brings it back — a reader who notices the count is exactly the reader
  // who wants to see it.
  const foldChip = foldedCount === 0 ? ''
    : expandable
      ? `<button type="button" class="fold-chip" data-toggle-expanded aria-expanded="false"><span data-toggle-label data-collapsed-label="完走済み ${foldedCount}件を非表示（押すと表示）" data-expanded-label="完走済み ${foldedCount}件を表示中（押すと非表示）">完走済み ${foldedCount}件を非表示（押すと表示）</span></button>`
      : `<span class="fold-chip">完走済み ${foldedCount}件を非表示</span>`;
  const foldNote = foldedCount === 0 ? ''
    : expandable
      ? '<p class="fold-note">後続に作業中・未着手が残っていない完了工程は図から外しています。生きた工程とその直接の前提工程は必ず描きます。上のバッジを押すと外した工程も含めて描きます。総数・進捗・最長依存鎖は外す前の全工程で数えています。</p>'
      : '<p class="fold-note">後続に作業中・未着手が残っていない完了工程は図から外しています。生きた工程とその直接の前提工程は必ず描きます。外した工程は右の「全工程」から辿れ、図に出すには <code>lattice todo gantt --scope all</code> を実行してください。総数・進捗・最長依存鎖は外す前の全工程で数えています。</p>';
  return `<div class="diagram-legend" aria-label="工程図の凡例"><span>${statusMarkup('pending', ' 未着手')}</span><span>${statusMarkup('in-progress', ' 作業中')}</span><span>${statusMarkup('done', ' 完了')}</span><span>${statusMarkup('blocked', ' ブロック中')}</span><span>破線枠: ready frontier（同時dispatch推奨）</span><span>太線: 構造上の最長依存鎖</span><span>半円: 非接触の線交差</span><span>黒丸: 論理上の合流</span>${foldChip}${categoryDetails}${foldNote}<p>縦方向は時間ではなく、登録済み依存関係による工程段階です。ready frontierは全件同時dispatchが既定です。未登録の資源・host制約によりsubsetだけを選ぶ場合は理由を記録します。構造上の最長依存鎖は各工程を同じ重みとして数え、実時間・工数・納期を表しません。</p></div>`;
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
.gantt-pane{display:grid;grid-template-rows:auto auto minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;background:var(--surface-1)}
.pane-divider{width:8px;cursor:col-resize;background:rgba(217,216,212,.5);touch-action:none}
.diagram-toolbar{z-index:3;display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary)}
.diagram-toolbar button{min-height:32px;padding:0 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface-2);color:var(--text-primary);font:500 12px/1.6 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
.diagram-toolbar button:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}
.zoom-readout{min-width:48px;text-align:center;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
.diagram-note{margin-left:auto;color:var(--text-secondary);font-size:12px;font-weight:500}
.project-heading{margin-right:8px;color:var(--text-primary);font-size:13px;font-weight:650;white-space:nowrap}.status-symbol.status-in-progress{color:var(--accent)}.status-symbol.status-done{color:var(--good)}.status-symbol.status-blocked{color:var(--critical)}
.diagram-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--surface-1);color:var(--text-secondary);font-size:12px;font-weight:500}
.diagram-legend>span{white-space:nowrap}.diagram-legend>p{flex:1 0 100%;margin:0;font-weight:400}
.category-legend{margin-left:auto}.category-legend summary{cursor:pointer;color:var(--text-primary)}
.category-legend dl{position:absolute;z-index:4;right:16px;max-width:38rem;margin:8px 0 0;padding:12px 16px;border:1px solid var(--border);background:var(--surface-1);box-shadow:0 4px 16px rgba(11,11,11,.12)}
.category-entry+ .category-entry{margin-top:8px}.category-entry dt{color:var(--text-primary)}.category-entry dd{margin:0;color:var(--text-secondary);font-weight:400}
.diagram-scroll{min-width:0;min-height:0;max-width:calc(100% - 16px);margin:8px;overflow:auto;overscroll-behavior:contain;border:1px solid rgba(217,216,212,.5)}
.todo-gantt{display:block;max-width:none}
.narrative-pane{min-width:0;overflow:auto;background:var(--surface-1)}
[hidden]{display:none!important}
.right-toolbar{position:sticky;z-index:3;top:0;display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--surface-1)}
.right-toolbar button,.relation-list button,.active-list button,.task-index-list button{padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface-2);color:var(--text-primary);font:500 12px/1.6 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;text-align:left;cursor:pointer}
.right-toolbar button:focus-visible,.relation-list button:focus-visible,.active-list button:focus-visible,.task-index-list button:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}
.right-content{max-width:72ch;margin:0 auto;padding:16px 24px 48px}
.right-overview h1,.task-detail h1{margin:0 0 16px;font-size:19px;font-weight:650;line-height:1.45}
.right-overview h2,.task-detail h2{margin:24px 0 8px;font-size:16px;font-weight:600}
.status-summary{display:flex;flex-wrap:wrap;gap:8px 16px;margin:16px 0;padding:12px;background:var(--surface-2)}
.phase-overview>p{color:var(--text-secondary)}.phase-overview>ol{display:grid;gap:8px;margin:0;padding:0;list-style:none}.phase-progress{padding:10px 12px;border:1px solid var(--border);border-left-width:4px;background:var(--surface-2)}.phase-progress>header{display:flex;justify-content:space-between;gap:12px}.phase-progress>p{margin:4px 0;color:var(--text-secondary);font-size:12px}.phase-progress progress{display:block;width:100%}.phase-progress.status-accepted{border-left-color:var(--good)}.phase-progress.status-reviewing,.phase-progress.status-gate_ready{border-left-color:var(--accent)}.phase-progress.status-rejected{border-left-color:var(--critical)}
.active-list,.relation-list{margin:0;padding:0;list-style:none}.active-list li+li,.relation-list li+li{margin-top:8px}
.active-list button{width:100%}.anchor-status,.readiness-note,.category-description,.relation-empty{color:var(--text-secondary)}
.task-detail>header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}.detail-status,.detail-reference{font-size:12px;font-weight:600}.detail-reference{color:var(--text-secondary)}
.relation-list button{display:flex;width:100%;flex-direction:column}.relation-list button span{font-weight:400}.relation-kind{display:block;margin-top:4px;color:var(--text-secondary);font-size:12px}
.task-diagnostics{margin:16px 0;color:var(--text-secondary);font-size:12px}.task-diagnostics summary{cursor:pointer;color:var(--text-primary);font-weight:600}.task-diagnostics dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}.task-diagnostics dd{margin:0;overflow-wrap:anywhere}
.task-index>h1{margin:0 0 8px;font-size:19px;font-weight:650;line-height:1.45}.task-index>p{margin:0 0 24px;color:var(--text-secondary)}
.task-index-plan+.task-index-plan{margin-top:32px}.task-index-plan h2{margin:0 0 12px;font-size:16px;font-weight:600}.task-index-plan h2 code{font-size:inherit}
.task-index-list{margin:0;padding:0;list-style:none}.task-index-list li+li{margin-top:8px}.task-index-list button{display:grid;width:100%;grid-template-columns:1.5rem auto minmax(0,1fr);gap:4px 8px;align-items:baseline}
.task-index-status{grid-row:1 / span 2;color:var(--text-secondary);font-size:13.5px;text-align:center}.task-index-status.status-in-progress{color:var(--accent)}.task-index-status.status-done{color:var(--good)}.task-index-status.status-blocked{color:var(--critical)}
.task-index-reference{color:var(--text-secondary);font-size:12px;white-space:nowrap}.task-index-list strong{font-size:13.5px;font-weight:600;overflow-wrap:anywhere}.task-index-blocked-reason{grid-column:2 / -1;color:var(--text-secondary);font-size:12px;overflow-wrap:anywhere}
.todo-gantt text{font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;pointer-events:none}
.todo-node .node-surface{fill:var(--surface-2);stroke:var(--border);stroke-width:1}
.todo-node .node-meta{fill:var(--text-secondary);font-size:12px;font-weight:500}
.todo-node .node-title{fill:var(--text-primary);font-size:13.5px;font-weight:400}
.todo-node .node-title-line{font-size:13.5px;font-weight:400}
.todo-node .status-mark{fill:var(--text-secondary);font-size:13.5px;font-weight:400}
.fold-chip{padding:2px 8px;border:1px solid var(--border);border-radius:9999px;background:var(--surface-2);color:var(--text-primary);font:650 13.5px/1.6 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
button.fold-chip{cursor:pointer}button.fold-chip:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}
button.fold-chip[aria-expanded="true"]{border-color:var(--text-primary)}
[data-diagram][hidden]{display:none}
.fold-note{flex:1 0 100%;margin:4px 0 0;color:var(--text-secondary);font-weight:400}
.task-index-folded{margin-top:8px}
.task-index-folded>summary,.phase-settled>summary{cursor:pointer;padding:6px 0;color:var(--text-secondary);font-weight:600}
.phase-settled>summary:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}
.status-in-progress .node-surface{fill:var(--surface-1);stroke:var(--accent);stroke-width:2}
.status-in-progress .status-mark{fill:var(--accent)}
.status-in-progress .status-bar{stroke:var(--accent);stroke-width:2;stroke-linecap:round}
.status-done .node-surface{fill:var(--surface-2);stroke:var(--border);stroke-width:1}
.status-done .status-mark{fill:var(--good)}
.status-blocked .node-surface{fill:var(--surface-1);stroke:var(--critical);stroke-width:2}
.status-blocked .status-mark{fill:var(--critical)}
.next-ready-node .node-surface{stroke:var(--accent);stroke-width:2;stroke-dasharray:4 3}
.todo-node:focus .node-surface,.selected-node .node-surface{stroke:var(--text-primary);stroke-width:2.5}
.dependency-edge .edge-route{fill:none;stroke:var(--text-secondary);stroke-width:1.5;stroke-linejoin:round;opacity:.4}
.dependency-edge .edge-arrow{fill:var(--text-secondary);opacity:.7}
.longest-chain-edge .edge-route,.selected-incident-edge .edge-route{stroke:var(--text-primary);stroke-width:2.5;opacity:1}
.longest-chain-edge .edge-arrow,.selected-incident-edge .edge-arrow{fill:var(--text-primary);opacity:1}
.join-marker circle{fill:var(--text-primary);stroke:none}
.join-contact-marker{fill:var(--text-primary);stroke:none}.join-connector .edge-route{fill:none;stroke:var(--text-secondary);stroke-width:1.5;opacity:.7}
.summary-container{fill:var(--surface-1);stroke:var(--border);stroke-width:1;stroke-opacity:.5}
.summary-chip{fill:var(--surface-2);stroke:none}
.summary-plan text{fill:var(--text-primary);font-size:12px;font-weight:500}
.summary-lane text{fill:var(--text-secondary);font-size:12px;font-weight:500}
.summary-lane{cursor:pointer}
.lane-dimmed{opacity:.35}
@media(max-width:900px){body{display:block;height:auto}.shell{display:block}.pane-divider{display:none}.gantt-pane,.narrative-pane{height:70vh}.gantt-pane{border-bottom:1px solid var(--border)}}
`;

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
