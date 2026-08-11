import { escapeHtmlAttribute, escapeHtmlText } from './todo-gantt-html-shared.mjs';
import { TODO_STRUCTURE_PRESENTATION_SCHEMA } from './todo-structure-presentation.mjs';

const KIND_LABEL = Object.freeze({
  task_transform: '工程変換', data: 'データ', code: 'コード', source_symbol: '既存コード',
  external: '外部契約', changeset: 'commit', constant: '定数', final_product: '最終成果',
});
const EDGE_LABEL = Object.freeze({
  input: '入力', output: '出力', sink: '受渡し', source_edge: '既存コード関係',
  realization: '実装commit',
});

function valid(presentation) {
  return presentation?.schema === TODO_STRUCTURE_PRESENTATION_SCHEMA
    && Array.isArray(presentation.plans);
}

export function hasTodoStructurePresentation(presentation) {
  return valid(presentation) && presentation.plans.length > 0;
}

function nodeId(planIndex, nodeIndex) {
  return `structure-node-${planIndex}-${nodeIndex}`;
}

function edgeId(planIndex, edgeIndex) {
  return `structure-edge-${planIndex}-${edgeIndex}`;
}

function focusRefs(finding) {
  return [...new Set([
    ...(finding.task_ids ?? []).map((taskId) => `task:${taskId}`),
    ...(finding.data_refs ?? []).map((ref) => ref.startsWith('external/')
      ? `external:${ref.slice('external/'.length)}` : `data:${ref}`),
    ...(finding.code_refs ?? []).map((ref) => `code:${ref}`),
    ...(finding.commit_oids ?? []).map((oid) => `commit:${oid}`),
  ])];
}

function renderTaskDetail(plan, node) {
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === node.task_id);
  if (task === undefined) return '';
  const changed = task.changed_fields.length === 0
    ? 'plannedからの変更なし' : `変更: ${task.changed_fields.join(', ')}`;
  const anchors = task.code_anchors.length === 0 ? ''
    : `<details><summary>code anchor ${task.code_anchors.length}件</summary><ul>${task.code_anchors.map((anchor) => `<li><code>${escapeHtmlText(anchor.effect)}</code> <code>${escapeHtmlText(anchor.path)}</code>${anchor.symbol === null ? '' : ` · ${escapeHtmlText(anchor.symbol)}`}</li>`).join('')}</ul></details>`;
  return `<p><strong>${escapeHtmlText(task.form)}</strong> · ${escapeHtmlText(changed)}</p><p>planned: ${escapeHtmlText(task.planned_outcome)}</p>${task.form === 'realized' ? `<p>effective: ${escapeHtmlText(task.effective_outcome)}</p>` : ''}${anchors}`;
}

function renderCommitDetail(plan, node) {
  if (node.kind !== 'changeset') return '';
  const oid = node.ref.slice('commit:'.length);
  const commit = plan.provenance?.commits.find(({ commit_oid: commitOid }) => commitOid === oid);
  if (commit === undefined) return '';
  return `<details><summary>変更path ${commit.changes.length}件</summary><ul>${commit.changes.map((change) => `<li><code>${escapeHtmlText(change.change)}</code> ${escapeHtmlText(change.path)}</li>`).join('')}</ul></details>`;
}

function renderNaturalRef(node) {
  if (node.kind !== 'source_symbol' || node.natural_ref === null) return '';
  const natural = node.natural_ref;
  const label = [natural.path, natural.name].filter((value) => typeof value === 'string').join(' · ');
  return label === '' ? '' : `<p>${escapeHtmlText(label)}</p>`;
}

function renderNodes(plan, planIndex) {
  const ids = new Map();
  const nodes = plan.graph.nodes.map((node, index) => {
    const id = nodeId(planIndex, index);
    ids.set(node.ref, id);
    const form = node.kind === 'task_transform' ? ` · ${node.form}` : '';
    return `<article class="structure-node kind-${escapeHtmlAttribute(node.kind)}" id="${id}" data-structure-node-ref="${escapeHtmlAttribute(node.ref)}"><header><span>${escapeHtmlText(KIND_LABEL[node.kind] ?? node.kind)}</span><code>${escapeHtmlText(node.ref)}</code></header>${node.kind === 'task_transform' ? renderTaskDetail(plan, node) : ''}${renderCommitDetail(plan, node)}${renderNaturalRef(node)}${form === '' ? '' : `<p class="structure-form">${escapeHtmlText(form.slice(3))}</p>`}</article>`;
  }).join('');
  return { ids, markup: nodes };
}

function targetButton(ref, ids) {
  const id = ids.get(ref);
  return id === undefined
    ? `<code>${escapeHtmlText(ref)}</code>`
    : `<button type="button" data-structure-target-id="${escapeHtmlAttribute(id)}"><code>${escapeHtmlText(ref)}</code></button>`;
}

function renderFindings(plan, ids, edgeIds) {
  if (plan.unreadable_reason !== null) {
    return `<section class="structure-findings"><h3>読取不能</h3><p class="structure-severity-error">${escapeHtmlText(plan.unreadable_reason)}</p></section>`;
  }
  if (plan.findings.length === 0) {
    return '<section class="structure-findings"><h3>指摘</h3><p>保存artifactに指摘はありません。</p></section>';
  }
  return `<section class="structure-findings"><h3>指摘 ${plan.findings.length}件</h3><ol>${plan.findings.map((finding) => {
    const refs = focusRefs(finding);
    const relation = refs.length === 0 ? ''
      : `<div class="structure-finding-targets">${refs.map((ref) => targetButton(ref, ids)).join('<span aria-hidden="true">→</span>')}</div>`;
    const implicatedEdges = plan.graph.edges.flatMap((edge, index) => {
      if (!refs.includes(edge.from) || !refs.includes(edge.to)) return [];
      const id = edgeIds.get(index);
      return [`<button type="button" data-structure-target-id="${escapeHtmlAttribute(id)}">edge: ${escapeHtmlText(EDGE_LABEL[edge.kind] ?? edge.kind)} <code>${escapeHtmlText(edge.from)}</code> → <code>${escapeHtmlText(edge.to)}</code></button>`];
    });
    const edgeTargets = implicatedEdges.length === 0 ? ''
      : `<div class="structure-finding-edge-targets">${implicatedEdges.join('')}</div>`;
    return `<li class="structure-finding severity-${escapeHtmlAttribute(finding.severity)}"><header><strong>${escapeHtmlText(finding.code)}</strong><span>${escapeHtmlText(finding.severity)}</span></header>${relation}${edgeTargets}<p>次: <code>${escapeHtmlText(finding.next_action)}</code></p></li>`;
  }).join('')}</ol></section>`;
}

function renderEdges(plan, ids, edgeIds) {
  if (plan.graph.edges.length === 0) return '<p>保存artifactにedgeはありません。</p>';
  return `<ol class="structure-edge-list">${plan.graph.edges.map((edge, index) => `<li id="${edgeIds.get(index)}" data-structure-edge-from="${escapeHtmlAttribute(edge.from)}" data-structure-edge-to="${escapeHtmlAttribute(edge.to)}"><span>${escapeHtmlText(EDGE_LABEL[edge.kind] ?? edge.kind)}</span>${targetButton(edge.from, ids)}<span aria-hidden="true">→</span>${targetButton(edge.to, ids)}</li>`).join('')}</ol>`;
}

function renderPlan(plan, planIndex) {
  const { ids, markup: nodes } = renderNodes(plan, planIndex);
  const edgeIds = new Map(plan.graph.edges.map((_, index) => [index, edgeId(planIndex, index)]));
  const verdict = plan.verdict ?? plan.compiled_verdict ?? plan.coverage;
  const finalization = plan.finalization === null ? ''
    : `<span>finalization: ${escapeHtmlText(plan.finalization.status)}</span>`;
  const actions = plan.next_actions.length === 0 ? ''
    : `<details class="structure-actions"><summary>次の操作</summary><ul>${plan.next_actions.map((action) => `<li><code>${escapeHtmlText(action)}</code></li>`).join('')}</ul></details>`;
  return `<details class="structure-plan" open><summary><code>${escapeHtmlText(plan.plan_key)}</code><span class="structure-verdict verdict-${escapeHtmlAttribute(verdict ?? 'unknown')}">${escapeHtmlText(verdict ?? 'unknown')}</span><span>${escapeHtmlText(plan.freshness)}</span>${finalization}</summary>${renderFindings(plan, ids, edgeIds)}<section class="structure-graph" aria-label="${escapeHtmlAttribute(`${plan.plan_key} 構造グラフ`)}"><h3>node</h3><div class="structure-node-grid">${nodes}</div><h3>edge</h3>${renderEdges(plan, ids, edgeIds)}</section>${actions}</details>`;
}

export function renderTodoStructurePanel(presentation) {
  if (!hasTodoStructurePresentation(presentation)) return '';
  return `<section class="structure-inspection" data-right-panel="structure" hidden><h1>構造検査</h1><p>工程依存図とは別の面です。task、data、code、external、commit provenanceを最終的な受渡しとして表示します。</p>${presentation.plans.map(renderPlan).join('')}</section>`;
}

/** script無効時にもfinding一覧だけは隠さず読めるfallback。 */
export function renderTodoStructureNoscript(presentation) {
  if (!hasTodoStructurePresentation(presentation)) return '';
  const plans = presentation.plans.map((plan) => `<section><h2>${escapeHtmlText(plan.plan_key)} — ${escapeHtmlText(plan.verdict ?? plan.compiled_verdict ?? plan.coverage)}</h2>${plan.unreadable_reason === null
    ? plan.findings.length === 0 ? '<p>指摘はありません。</p>'
      : `<ol>${plan.findings.map((finding) => `<li><strong>${escapeHtmlText(finding.code)}</strong> (${escapeHtmlText(finding.severity)}) — <code>${escapeHtmlText(finding.next_action)}</code></li>`).join('')}</ol>`
    : `<p>${escapeHtmlText(plan.unreadable_reason)}</p>`}</section>`).join('');
  return `<noscript><section class="structure-noscript"><h1>構造検査の指摘</h1>${plans}</section></noscript>`;
}
