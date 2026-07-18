const STATUS_CLASSES = Object.freeze({
  pending: 'status-pending',
  'in-progress': 'status-in-progress',
  blocked: 'status-blocked',
  done: 'status-done',
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

function points(route) {
  return route.map(([x, y]) => `${x},${y}`).join(' ');
}

function arrowHead(route) {
  const [x, y] = route.at(-1);
  return `<polygon class="edge-arrow" points="${x},${y} ${x - 9},${y - 5} ${x - 9},${y + 5}"></polygon>`;
}

function renderEdge(edge) {
  if (!edge.visible || edge.route === null) return '';
  const classes = ['dependency-edge'];
  if (edge.visibility.longest_dependency_chain) classes.push('longest-chain-edge');
  if (edge.visibility.selected_incident) classes.push('selected-incident-edge');
  const join = edge.join_ids.length === 0 ? '' : (() => {
    const [x, y] = edge.route[Math.floor(edge.route.length / 2)];
    return `<g class="join-marker" aria-label="join ${escapeSvgAttribute(edge.join_ids.join(', '))}"><polygon points="${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}"></polygon><title>${escapeSvgText(edge.join_ids.join(', '))}</title></g>`;
  })();
  return `<g class="${classes.join(' ')}" data-edge-id="${escapeSvgAttribute(edge.id)}"><polyline points="${points(edge.route)}"></polyline>${arrowHead(edge.route)}${join}</g>`;
}

function shortTimestamp(value) {
  return typeof value === 'string' && value.length >= 16 ? `${value.slice(5, 10)} ${value.slice(11, 16)}Z` : '—';
}

function renderNode(node, taskState) {
  if (!node.visible || node.geometry === null) return '';
  const { x, y, width, height } = node.geometry;
  const classes = ['todo-node', STATUS_CLASSES[node.status] ?? 'status-unknown'];
  if (node.visibility.longest_dependency_chain) classes.push('longest-chain-node');
  if (node.visibility.active) classes.push('active-node');
  if (node.visibility.next_ready) classes.push('next-ready-node');
  if (node.visibility.selected) classes.push('selected-node');
  const key = nodeKey(node.ref);
  const label = `${node.ref.plan_key}/${node.ref.task_id}: ${node.title}`;
  const started = shortTimestamp(taskState?.started_at);
  const done = shortTimestamp(taskState?.done_at);
  return `<g class="${classes.join(' ')}" data-node-key="${escapeSvgAttribute(key)}" tabindex="0" role="button" aria-selected="${node.visibility.selected ? 'true' : 'false'}" aria-label="${escapeSvgAttribute(`${label}; status ${node.status}; started ${taskState?.started_at ?? 'none'}; done ${taskState?.done_at ?? 'none'}`)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6"></rect><text x="${x + 8}" y="${y + 14}">${escapeSvgText(node.title)}</text><text class="node-time" x="${x + 8}" y="${y + 29}">${escapeSvgText(`S:${started} D:${done}`)}</text><title>${escapeSvgText(`${label} — ${node.status}; started ${taskState?.started_at ?? '—'}; done ${taskState?.done_at ?? '—'}`)}</title></g>`;
}

function renderGroupBadges(layout) {
  const badges = [];
  let y = 22;
  for (const plan of layout.groups.plans) {
    badges.push(`<g class="group-badge plan-badge" data-fold-state="${plan.expanded ? 'expanded' : 'folded'}"><rect x="8" y="${y - 14}" width="220" height="20" rx="10"></rect><text x="18" y="${y}">${escapeSvgText(`${plan.plan_key}: ${plan.visible_task_count}/${plan.task_count} tasks${plan.hidden_task_count > 0 ? ` (+${plan.hidden_task_count} folded)` : ''}`)}</text></g>`);
    y += 24;
  }
  for (const lane of layout.groups.lanes) {
    badges.push(`<g class="group-badge lane-badge" data-fold-state="${lane.expanded ? 'expanded' : 'folded'}"><rect x="236" y="${y - 14}" width="280" height="20" rx="10"></rect><text x="246" y="${y}">${escapeSvgText(`${lane.plan_key}/${lane.lane}: ${lane.visible_task_count}/${lane.task_count}; ${lane.hidden_incident_edge_count} hidden edges`)}</text></g>`);
    y += 24;
  }
  for (const bundle of layout.bundles) {
    badges.push(`<text class="bundle-badge" x="524" y="${y}">${escapeSvgText(`${bundle.from_group.plan_key}/${bundle.from_group.lane} → ${bundle.to_group.plan_key}/${bundle.to_group.lane}: ${bundle.hidden_edge_count} folded edges`)}</text>`);
    y += 20;
  }
  return { markup: badges.join(''), height: y + 8 };
}

export function renderTodoGanttSvg(layout, options = {}) {
  if (layout === null || typeof layout !== 'object' || layout.schema !== 'lattice.todo_gantt_layout.v1'
    || !Array.isArray(layout.nodes) || !Array.isArray(layout.edges)) {
    throw new TypeError('layout must be lattice.todo_gantt_layout.v1');
  }
  const badges = renderGroupBadges(layout);
  const contentOffset = Math.max(40, badges.height);
  const width = Math.max(760, layout.bounds.width + 40);
  const height = Math.max(240, layout.bounds.height + contentOffset + 32);
  const taskStates = options.taskStates instanceof Map ? options.taskStates : new Map();
  const nodes = layout.nodes.map((node) => {
    if (node.geometry === null) return '';
    return renderNode(
      { ...node, geometry: { ...node.geometry, y: node.geometry.y + contentOffset } },
      taskStates.get(nodeKey(node.ref)),
    );
  }).join('');
  // Edge coordinates need the same vertical offset as nodes.
  const shiftedEdges = layout.edges.map((edge) => renderEdge(edge.route === null ? edge : {
    ...edge, route: edge.route.map(([x, y]) => [x, y + contentOffset]),
  })).join('');
  return `<svg class="todo-gantt" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Todo dependency gantt"><desc>最長依存鎖はunit-weightの構造深さであり実時間・資源律速ではない。</desc>${badges.markup}<g class="edge-layer">${shiftedEdges}</g><g class="node-layer">${nodes}</g></svg>`;
}
