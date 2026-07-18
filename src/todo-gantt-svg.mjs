import stringWidth from 'fast-string-width';

const STATUS_CLASSES = Object.freeze({
  pending: 'status-pending',
  'in-progress': 'status-in-progress',
  blocked: 'status-blocked',
  done: 'status-done',
});

const STATUS_PRESENTATION = Object.freeze({
  pending: Object.freeze({ mark: '☐', label: '未着手' }),
  'in-progress': Object.freeze({ mark: '▶', label: '作業中' }),
  blocked: Object.freeze({ mark: '⛔', label: 'ブロック中' }),
  done: Object.freeze({ mark: '✅', label: '完了' }),
});

export function escapeSvgText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeSvgAttribute(value) {
  return escapeSvgText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    .replace(/[\u0000-\u001f\u007f]/gu, '');
}

function nodeKey(ref) {
  return JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
}

function laneKey(planKey, lane) {
  return JSON.stringify([planKey, lane]);
}

function points(route) {
  return route.map(([x, y]) => `${x},${y}`).join(' ');
}

function arrowHead(route) {
  const [x, y] = route.at(-1);
  return `<polygon class="edge-arrow" points="${x},${y} ${x - 3},${y - 6} ${x + 3},${y - 6}"></polygon>`;
}

function renderEdge(edge, laneKeysByNode) {
  if (!edge.visible || edge.route === null) return '';
  const classes = ['dependency-edge'];
  if (edge.visibility.longest_dependency_chain) classes.push('longest-chain-edge');
  if (edge.visibility.selected_incident) classes.push('selected-incident-edge');
  const fromLaneKey = laneKeysByNode.get(nodeKey(edge.from));
  const toLaneKey = laneKeysByNode.get(nodeKey(edge.to));
  const join = edge.join_ids.length === 0 ? '' : (() => {
    const [x, y] = edge.route[Math.floor(edge.route.length / 2)];
    return `<g class="join-marker" aria-label="join ${escapeSvgAttribute(edge.join_ids.join(', '))}"><polygon points="${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}"></polygon><title>${escapeSvgText(edge.join_ids.join(', '))}</title></g>`;
  })();
  return `<g class="${classes.join(' ')}" data-edge-id="${escapeSvgAttribute(edge.id)}" data-from-lane-key="${escapeSvgAttribute(fromLaneKey)}" data-to-lane-key="${escapeSvgAttribute(toLaneKey)}"><polyline points="${points(edge.route)}"></polyline>${arrowHead(edge.route)}${join}</g>`;
}

function truncateLabel(value, maximum = 17) {
  const source = String(value);
  if (stringWidth(source) <= maximum) return source;
  let result = '';
  for (const character of source) {
    if (stringWidth(`${result}${character}…`) > maximum) break;
    result += character;
  }
  return `${result}…`;
}

function visibleNodeLabel(taskId, title, maximum = 14) {
  const id = String(taskId);
  if (stringWidth(id) >= maximum) return { id: truncateLabel(id, maximum), title: '' };
  const titleWidth = maximum - stringWidth(id) - 1;
  return { id, title: titleWidth <= 0 ? '' : truncateLabel(title, titleWidth) };
}

function renderNode(node) {
  if (!node.visible || node.geometry === null) return '';
  const { x, y, width, height } = node.geometry;
  const classes = ['todo-node', STATUS_CLASSES[node.status] ?? 'status-unknown'];
  if (node.visibility.longest_dependency_chain) classes.push('longest-chain-node');
  if (node.visibility.active) classes.push('active-node');
  if (node.visibility.next_ready) classes.push('next-ready-node');
  if (node.visibility.selected) classes.push('selected-node');
  const key = nodeKey(node.ref);
  const nodeLaneKey = laneKey(node.ref.plan_key, node.lane);
  const label = `${node.ref.plan_key}/${node.ref.task_id}: ${node.title}`;
  const presentation = STATUS_PRESENTATION[node.status] ?? { mark: '?', label: '状態不明' };
  const visibleLabel = visibleNodeLabel(node.ref.task_id, node.title);
  const readyLabel = node.visibility.next_ready ? '（着手可）' : '';
  const statusBar = node.status === 'in-progress'
    ? `<line class="status-bar" x1="${x + 5}" y1="${y + 6}" x2="${x + 5}" y2="${y + height - 6}"></line>` : '';
  const visibleTitle = visibleLabel.title === '' ? '' : ` ${escapeSvgText(visibleLabel.title)}`;
  return `<g class="${classes.join(' ')}" data-node-key="${escapeSvgAttribute(key)}" data-lane-key="${escapeSvgAttribute(nodeLaneKey)}" tabindex="0" role="button" aria-selected="${node.visibility.selected ? 'true' : 'false'}" aria-label="${escapeSvgAttribute(`${label}; ${presentation.label}${readyLabel}`)}"><rect class="node-surface" x="${x}" y="${y}" width="${width}" height="${height}" rx="4"></rect>${statusBar}<text class="status-mark" x="${x + 10}" y="${y + 22}">${escapeSvgText(presentation.mark)}</text><text class="node-title" x="${x + 34}" y="${y + 22}"><tspan class="node-id">${escapeSvgText(visibleLabel.id)}</tspan>${visibleTitle}</text><title>${escapeSvgText(`${label} — ${presentation.label}`)}</title></g>`;
}

function summaryLabel(value, maximum = 25) {
  return truncateLabel(value, maximum);
}

function summaryChipWidth(label, minimum = 116) {
  return Math.max(minimum, Math.min(216, 24 + stringWidth(label) * 7));
}

function renderTodoSummary(layout) {
  const markup = [];
  let groupX = 16;
  for (const plan of layout.groups.plans) {
    const lanes = layout.groups.lanes.filter((lane) => lane.plan_key === plan.plan_key);
    const laneChips = lanes.map((lane) => {
      const fullLabel = `${lane.lane} ${lane.task_count}`;
      const label = summaryLabel(fullLabel);
      return { lane, fullLabel, label, width: summaryChipWidth(label) };
    });
    const childrenWidth = laneChips.reduce((total, chip) => total + chip.width, 0)
      + Math.max(0, laneChips.length - 1) * 8;
    const planLabel = summaryLabel(`${plan.plan_key} · ${plan.task_count} ToDo`);
    const contentWidth = Math.max(summaryChipWidth(planLabel, 152), childrenWidth);
    const groupWidth = contentWidth + 16;
    markup.push(`<g class="summary-plan-group" aria-label="${escapeSvgAttribute(`${plan.plan_key} — ${plan.task_count} ToDo、${laneChips.length} lanes`)}"><rect class="summary-container" x="${groupX}" y="8" width="${groupWidth}" height="72" rx="8"></rect><g class="summary-plan" aria-label="${escapeSvgAttribute(`${plan.plan_key} — ${plan.task_count} ToDo`)}"><rect class="summary-chip plan-chip" x="${groupX + 8}" y="16" width="${summaryChipWidth(planLabel, 152)}" height="24" rx="9999"></rect><text x="${groupX + 20}" y="33">${escapeSvgText(planLabel)}</text><title>${escapeSvgText(`${plan.plan_key}: ${plan.task_count} ToDo`)}</title></g>`);
    let laneX = groupX + 8;
    for (const chip of laneChips) {
      const key = laneKey(chip.lane.plan_key, chip.lane.lane);
      markup.push(`<g class="summary-lane" data-lane-key="${escapeSvgAttribute(key)}" role="button" tabindex="0" aria-pressed="false" aria-label="${escapeSvgAttribute(`${chip.lane.lane} — ${chip.lane.task_count} ToDo`)}"><rect class="summary-chip lane-chip" x="${laneX}" y="48" width="${chip.width}" height="24" rx="9999"></rect><text x="${laneX + 12}" y="65">${escapeSvgText(chip.label)}</text><title>${escapeSvgText(`${chip.fullLabel} ToDo`)}</title></g>`);
      laneX += chip.width + 8;
    }
    markup.push('</g>');
    groupX += groupWidth + 16;
  }
  return { markup: `<g class="todo-summary" aria-label="カテゴリ別ToDo集計表">${markup.join('')}</g>`, height: 96, width: groupX };
}

export function renderTodoGanttSvg(layout, options = {}) {
  if (layout === null || typeof layout !== 'object' || layout.schema !== 'lattice.todo_gantt_layout.v1'
    || !Array.isArray(layout.nodes) || !Array.isArray(layout.edges)) {
    throw new TypeError('layout must be lattice.todo_gantt_layout.v1');
  }
  const summary = renderTodoSummary(layout);
  const contentOffset = summary.height;
  const width = Math.max(240, layout.bounds.width + 40, summary.width + 12);
  const height = Math.max(240, layout.bounds.height + contentOffset + 32);
  const laneKeysByNode = new Map(layout.nodes.map((node) => [
    nodeKey(node.ref), laneKey(node.ref.plan_key, node.lane),
  ]));
  const nodes = layout.nodes.map((node) => {
    if (node.geometry === null) return '';
    return renderNode({ ...node, geometry: { ...node.geometry, y: node.geometry.y + contentOffset } });
  }).join('');
  // Edge coordinates need the same vertical offset as nodes.
  const shiftedEdges = layout.edges.map((edge) => renderEdge(edge.route === null ? edge : {
    ...edge, route: edge.route.map(([x, y]) => [x, y + contentOffset]),
  }, laneKeysByNode)).join('');
  return `<svg class="todo-gantt" data-gantt-svg data-svg-width="${width}" data-svg-height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Todo dependency gantt"><desc>最長依存鎖はunit-weightの構造深さであり実時間・資源律速ではない。</desc>${summary.markup}<g class="edge-layer">${shiftedEdges}</g><g class="node-layer">${nodes}</g></svg>`;
}
