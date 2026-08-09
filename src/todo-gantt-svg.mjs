import stringWidth from 'fast-string-width';

const STATUS_CLASSES = Object.freeze({
  pending: 'status-pending',
  'in-progress': 'status-in-progress',
  blocked: 'status-blocked',
  done: 'status-done',
});

export const TODO_GANTT_STATUS_PRESENTATION = Object.freeze({
  pending: Object.freeze({ mark: '☐', label: '未着手' }),
  'in-progress': Object.freeze({ mark: '▶', label: '作業中' }),
  blocked: Object.freeze({ mark: '⛔', label: 'ブロック中' }),
  done: Object.freeze({ mark: '✅', label: '完了' }),
});

/**
 * 独立性バッジの記号と和名（ADR 0129 Decision 1）。
 *
 * 枠線はstatusとready frontierが使い切っているため、カード内の記号と色で示す。
 * 記録が語らないtaskにはバッジを出さない——「独立と分かっている」と「まだ何も言えない」を
 * 同じ見た目にしない。
 */
export const TODO_GANTT_INDEPENDENCE_PRESENTATION = Object.freeze({
  verified: Object.freeze({ mark: '∥', label: '独立検証済', class: 'independence-verified' }),
  conflict: Object.freeze({ mark: '⛓', label: '要直列', class: 'independence-conflict' }),
  unknown: Object.freeze({ mark: '?', label: '未検査', class: 'independence-unknown' }),
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

const BRIDGE_RADIUS = 5;

function edgePath(edge) {
  const commands = [`M ${edge.route[0][0]} ${edge.route[0][1]}`];
  for (let segmentIndex = 0; segmentIndex < edge.route.length - 1; segmentIndex += 1) {
    const start = edge.route[segmentIndex];
    const end = edge.route[segmentIndex + 1];
    const bridges = (edge.bridges ?? []).filter((bridge) => bridge.segment_index === segmentIndex);
    if (start[1] !== end[1] || bridges.length === 0) {
      commands.push(`L ${end[0]} ${end[1]}`);
      continue;
    }
    const direction = end[0] > start[0] ? 1 : -1;
    for (const bridge of bridges) {
      commands.push(`L ${bridge.x - direction * BRIDGE_RADIUS} ${bridge.y}`);
      commands.push(`A ${BRIDGE_RADIUS} ${BRIDGE_RADIUS} 0 0 ${direction > 0 ? 1 : 0} ${bridge.x + direction * BRIDGE_RADIUS} ${bridge.y}`);
    }
    commands.push(`L ${end[0]} ${end[1]}`);
  }
  return commands.join(' ');
}

function arrowHead(route) {
  const [x, y] = route.at(-1);
  const [previousX, previousY] = route.at(-2);
  const deltaX = x - previousX;
  const deltaY = y - previousY;
  const length = Math.hypot(deltaX, deltaY) || 1;
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const baseX = x - unitX * 6;
  const baseY = y - unitY * 6;
  const perpendicularX = -unitY * 3;
  const perpendicularY = unitX * 3;
  const compact = (value) => Number(value.toFixed(3));
  return `<polygon class="edge-arrow" points="${x},${y} ${compact(baseX + perpendicularX)},${compact(baseY + perpendicularY)} ${compact(baseX - perpendicularX)},${compact(baseY - perpendicularY)}"></polygon>`;
}

function renderJunction(edge) {
  if (edge.junction === null || edge.junction === undefined) return '';
  const [x, y] = edge.junction;
  return `<g class="join-marker" aria-label="join ${escapeSvgAttribute(edge.join_ids.join(', '))}"><circle cx="${x}" cy="${y}" r="4"></circle><title>${escapeSvgText(edge.join_ids.join(', '))}</title></g>`;
}

function renderConnector(connector) {
  return `<g class="join-connector" data-connector-id="${escapeSvgAttribute(connector.id)}"><path class="edge-route" d="${escapeSvgAttribute(edgePath(connector))}"></path></g>`;
}

function renderEdge(edge, laneKeysByNode) {
  if (!edge.visible || edge.route === null) return '';
  const classes = ['dependency-edge'];
  if (edge.visibility.longest_dependency_chain) classes.push('longest-chain-edge');
  if (edge.visibility.selected_incident) classes.push('selected-incident-edge');
  const fromLaneKey = laneKeysByNode.get(nodeKey(edge.from));
  const toLaneKey = laneKeysByNode.get(nodeKey(edge.to));
  return `<g class="${classes.join(' ')}" data-edge-id="${escapeSvgAttribute(edge.id)}" data-from-node-key="${escapeSvgAttribute(nodeKey(edge.from))}" data-to-node-key="${escapeSvgAttribute(nodeKey(edge.to))}" data-from-lane-key="${escapeSvgAttribute(fromLaneKey)}" data-to-lane-key="${escapeSvgAttribute(toLaneKey)}"><path class="edge-route" d="${escapeSvgAttribute(edgePath(edge))}"></path>${arrowHead(edge.route)}</g>`;
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

function wrapLabel(value, maximum = 30, maximumLines = 2) {
  const characters = [...String(value)];
  const lines = [];
  let cursor = 0;
  for (let lineIndex = 0; lineIndex < maximumLines && cursor < characters.length; lineIndex += 1) {
    const remaining = characters.slice(cursor).join('');
    if (stringWidth(remaining) <= maximum) {
      lines.push(remaining);
      cursor = characters.length;
      break;
    }
    if (lineIndex === maximumLines - 1) {
      lines.push(truncateLabel(remaining, maximum));
      cursor = characters.length;
      break;
    }
    let line = '';
    while (cursor < characters.length && stringWidth(`${line}${characters[cursor]}`) <= maximum) {
      line += characters[cursor];
      cursor += 1;
    }
    if (line === '') {
      line = characters[cursor];
      cursor += 1;
    }
    lines.push(line);
  }
  return lines.length === 0 ? [''] : lines;
}

function presentationMaps(presentation) {
  return {
    lanes: new Map((presentation?.lanes ?? []).map((entry) => [laneKey(entry.plan_key, entry.lane), entry])),
    taskNumbers: new Map((presentation?.task_numbers ?? []).map((entry) => [nodeKey(entry), entry])),
  };
}

function renderNode(node, maps) {
  if (!node.visible || node.geometry === null) return '';
  const { x, y, width, height } = node.geometry;
  const classes = ['todo-node', STATUS_CLASSES[node.status] ?? 'status-unknown'];
  if (node.visibility.longest_dependency_chain) classes.push('longest-chain-node');
  if (node.visibility.active) classes.push('active-node');
  if (node.visibility.next_ready) classes.push('next-ready-node');
  if (node.visibility.selected) classes.push('selected-node');
  const independence = TODO_GANTT_INDEPENDENCE_PRESENTATION[node.visibility.independence] ?? null;
  if (independence !== null) classes.push(independence.class);
  const key = nodeKey(node.ref);
  const nodeLaneKey = laneKey(node.ref.plan_key, node.lane);
  const status = TODO_GANTT_STATUS_PRESENTATION[node.status] ?? { mark: '?', label: '状態不明' };
  const lane = maps.lanes.get(nodeLaneKey);
  const laneLabel = lane === undefined ? node.lane : `${node.lane}、${lane.name}`;
  const taskNumber = maps.taskNumbers.get(key);
  const visibleReference = taskNumber === undefined
    ? `ID ${node.ref.task_id}` : `工程 ${taskNumber.display_number}`;
  const spokenReference = taskNumber === undefined
    ? `ID ${node.ref.task_id}` : `工程${taskNumber.display_number}`;
  const readyLabel = node.visibility.next_ready ? '。ready frontierの同時dispatch候補' : '';
  const independenceLabel = independence === null ? '' : `。並列可否は${independence.label}`;
  const identity = `正規ID ${node.ref.plan_key}/${node.ref.task_id}`;
  const ariaLabel = `${spokenReference}。${status.label}。${laneLabel}。${node.title}。${identity}${readyLabel}${independenceLabel}`;
  // カードの右上へ寄せる。node_width／node_heightは変えないので配線規約に影響しない。
  const independenceBadge = independence === null ? ''
    : `<text class="independence-badge" x="${x + width - 10}" y="${y + 20}" text-anchor="end">${escapeSvgText(`${independence.mark} ${independence.label}`)}</text>`;
  const statusBar = node.status === 'in-progress'
    ? `<line class="status-bar" x1="${x + 5}" y1="${y + 6}" x2="${x + 5}" y2="${y + height - 6}"></line>` : '';
  const titleLines = wrapLabel(node.title);
  const titleMarkup = titleLines.map((line, index) => `<tspan x="${x + 10}" dy="${index === 0 ? 0 : 17}" class="node-title-line">${escapeSvgText(line)}</tspan>`).join('');
  const taskNumberAttributes = taskNumber === undefined ? ''
    : ` data-task-number="${escapeSvgAttribute(taskNumber.display_number)}" data-task-number-normalized="${escapeSvgAttribute(taskNumber.normalized_number)}" data-task-number-globally-unique="${taskNumber.globally_unique ? 'true' : 'false'}"`;
  return `<g class="${classes.join(' ')}" data-node-key="${escapeSvgAttribute(key)}" data-lane-key="${escapeSvgAttribute(nodeLaneKey)}" data-project-id="${escapeSvgAttribute(node.ref.project_id)}" data-plan-key="${escapeSvgAttribute(node.ref.plan_key)}" data-task-id="${escapeSvgAttribute(node.ref.task_id)}"${taskNumberAttributes} tabindex="0" role="button" aria-selected="${node.visibility.selected ? 'true' : 'false'}" aria-label="${escapeSvgAttribute(ariaLabel)}"><rect class="node-surface" x="${x}" y="${y}" width="${width}" height="${height}" rx="4"></rect>${statusBar}<text class="status-mark" x="${x + 10}" y="${y + 21}">${escapeSvgText(status.mark)}</text><text class="node-meta" x="${x + 34}" y="${y + 20}">${escapeSvgText(`${status.label} · ${visibleReference}`)}</text>${independenceBadge}<text class="node-title" x="${x + 10}" y="${y + 42}">${titleMarkup}</text><title>${escapeSvgText(`${spokenReference}: ${node.title} — ${status.label} — ${laneLabel} — ${identity}`)}</title></g>`;
}

function summaryLabel(value, maximum = 34) {
  return truncateLabel(value, maximum);
}

function summaryChipWidth(label, minimum = 116) {
  return Math.max(minimum, Math.min(280, 24 + stringWidth(label) * 7));
}

function renderTodoSummary(layout, maps) {
  const markup = [];
  let groupX = 16;
  // The band is a header for the diagram, so it covers what the diagram draws.
  // Keeping a chip for every lane of every finished plan stretched the canvas to
  // several times the width of the graph itself, all of it empty columns.
  // The chips still count every ToDo in the lane, folded ones included.
  const drawnPlans = new Set(layout.nodes.map((node) => node.ref.plan_key));
  const drawnLanes = new Set(layout.nodes.map((node) => laneKey(node.ref.plan_key, node.lane)));
  for (const plan of layout.groups.plans.filter(({ plan_key }) => drawnPlans.has(plan_key))) {
    const lanes = layout.groups.lanes.filter((lane) => lane.plan_key === plan.plan_key
      && drawnLanes.has(laneKey(lane.plan_key, lane.lane)));
    const laneChips = lanes.map((lane) => {
      const metadata = maps.lanes.get(laneKey(lane.plan_key, lane.lane));
      const fullLabel = metadata === undefined
        ? `${lane.lane} ${lane.task_count}`
        : `${lane.lane} · ${metadata.name} ${lane.task_count}`;
      const label = summaryLabel(fullLabel);
      const ariaLabel = metadata === undefined
        ? `${lane.lane} — ${lane.task_count} ToDo`
        : `${lane.lane} — ${metadata.name}、${lane.task_count} ToDo。${metadata.description}`;
      return { lane, metadata, fullLabel, ariaLabel, label, width: summaryChipWidth(label) };
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
      markup.push(`<g class="summary-lane" data-lane-key="${escapeSvgAttribute(key)}" role="button" tabindex="0" aria-pressed="false" aria-label="${escapeSvgAttribute(chip.ariaLabel)}"><rect class="summary-chip lane-chip" x="${laneX}" y="48" width="${chip.width}" height="24" rx="9999"></rect><text x="${laneX + 12}" y="65">${escapeSvgText(chip.label)}</text><title>${escapeSvgText(chip.ariaLabel)}</title></g>`);
      laneX += chip.width + 8;
    }
    markup.push('</g>');
    groupX += groupWidth + 16;
  }
  return { markup: `<g class="todo-summary" aria-label="カテゴリ別ToDo集計表">${markup.join('')}</g>`, height: 96, width: groupX };
}

function renderFlatTodoGanttSvg(layout, options = {}) {
  if (layout === null || typeof layout !== 'object' || layout.schema !== 'lattice.todo_gantt_layout.v2'
    || !Array.isArray(layout.nodes) || !Array.isArray(layout.edges)) {
    throw new TypeError('layout must be lattice.todo_gantt_layout.v2');
  }
  const maps = presentationMaps(options.presentation);
  const summary = renderTodoSummary(layout, maps);
  const contentOffset = summary.height;
  const width = Math.max(240, layout.bounds.width + 40, summary.width + 12);
  const height = Math.max(240, layout.bounds.height + contentOffset + 32);
  const laneKeysByNode = new Map(layout.nodes.map((node) => [
    nodeKey(node.ref), laneKey(node.ref.plan_key, node.lane),
  ]));
  const nodes = layout.nodes.map((node) => {
    if (node.geometry === null) return '';
    return renderNode({ ...node, geometry: { ...node.geometry, y: node.geometry.y + contentOffset } }, maps);
  }).join('');
  // Edge coordinates need the same vertical offset as nodes.
  const shiftedEdgeModels = layout.edges.map((edge) => edge.route === null ? edge : ({
    ...edge,
    route: edge.route.map(([x, y]) => [x, y + contentOffset]),
    bridges: (edge.bridges ?? []).map((bridge) => ({ ...bridge, y: bridge.y + contentOffset })),
    junction: edge.junction === null || edge.junction === undefined
      ? null : [edge.junction[0], edge.junction[1] + contentOffset],
  }));
  const shiftedConnectors = (layout.connectors ?? []).map((connector) => ({
    ...connector,
    route: connector.route.map(([x, y]) => [x, y + contentOffset]),
    bridges: (connector.bridges ?? []).map((bridge) => ({ ...bridge, y: bridge.y + contentOffset })),
    contacts: (connector.contacts ?? []).map(([x, y]) => [x, y + contentOffset]),
  }));
  const shiftedEdges = shiftedEdgeModels.map((edge) => renderEdge(edge, laneKeysByNode)).join('');
  const connectors = shiftedConnectors.map(renderConnector).join('');
  const junctions = shiftedEdgeModels.map(renderJunction).join('');
  const mainJunctions = new Set(shiftedEdgeModels.filter(({ junction }) => junction !== null)
    .map(({ junction }) => junction.join(',')));
  const contactMarkers = shiftedConnectors.flatMap(({ contacts }) => contacts)
    .filter((contact) => !mainJunctions.has(contact.join(',')))
    .map(([x, y]) => `<circle class="join-contact-marker" cx="${x}" cy="${y}" r="3"></circle>`).join('');
  return `<svg class="todo-gantt" data-gantt-svg data-svg-width="${width}" data-svg-height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Todo依存工程図"><desc>縦方向は登録済み依存関係による工程段階。構造上の最長依存鎖は各工程を同じ重みとして数え、実時間・工数・資源律速を表さない。</desc>${summary.markup}<g class="edge-layer">${shiftedEdges}<g class="connector-layer">${connectors}</g><g class="junction-layer">${junctions}${contactMarkers}</g></g><g class="node-layer">${nodes}</g></svg>`;
}

function svgDimensions(markup) {
  const match = markup.match(/data-svg-width="([0-9.]+)" data-svg-height="([0-9.]+)"/u);
  if (match === null) throw new TypeError('nested todo gantt SVG must expose its dimensions');
  return { width: Number(match[1]), height: Number(match[2]) };
}

function resizeSvg(markup, width, height) {
  return markup
    .replace(/data-svg-width="[0-9.]+" data-svg-height="[0-9.]+"/u,
      `data-svg-width="${width}" data-svg-height="${height}"`)
    .replace(/viewBox="0 0 [0-9.]+ [0-9.]+" width="[0-9.]+" height="[0-9.]+"/u,
      `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"`);
}

function childLayoutOf(child) {
  if (child.level.children.length === 0) return child.level.layout;
  return {
    ...child.level.layout,
    hierarchy: {
      schema: 'lattice.todo_gantt_hierarchy.v1',
      children: child.level.children,
    },
  };
}

function renderNestedTodoGanttSvg(layout, options) {
  let markup = renderFlatTodoGanttSvg(layout, options);
  const base = svgDimensions(markup);
  let width = base.width;
  let height = base.height;
  const panels = [];
  const toggles = [];
  const links = [];
  const nodeByKey = new Map(layout.nodes.map((node) => [nodeKey(node.ref), node]));
  let nextPanelY = 96;

  for (const child of layout.hierarchy.children) {
    const key = nodeKey(child.parent_ref);
    const parent = nodeByKey.get(key);
    if (parent?.geometry === null || parent === undefined) continue;
    const childMarkup = renderTodoGanttSvg(childLayoutOf(child), options);
    const childSize = svgDimensions(childMarkup);
    // 開いた内部工程図を基底DAGの上へ重ねない。右側へ専用領域を確保し、親カードから
    // 直交線で結ぶ。これなら後続taskも、同じ箱の兄弟taskも隠れない。
    const panelX = base.width + 16;
    const panelY = Math.max(parent.geometry.y + 96, nextPanelY);
    const panelWidth = childSize.width + 24;
    const panelHeight = childSize.height + 44;
    nextPanelY = panelY + panelHeight + 16;
    width = Math.max(width, panelX + panelWidth + 16);
    height = Math.max(height, panelY + panelHeight + 16);
    const embedded = childMarkup.replace('<svg class="todo-gantt"',
      `<svg x="${panelX + 12}" y="${panelY + 32}" class="todo-gantt nested-task-diagram"`);
    const label = `工程 ${child.parent_ref.plan_key}/${child.parent_ref.task_id} の内部工程`;
    panels.push(`<g class="nested-task-panel" data-nested-panel-for="${escapeSvgAttribute(key)}" hidden aria-label="${escapeSvgAttribute(label)}"><rect class="nested-task-surface" x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="8"></rect><text class="nested-task-label" x="${panelX + 12}" y="${panelY + 22}">${escapeSvgText(label)}</text>${embedded}</g>`);
    const parentX = parent.geometry.x + parent.geometry.width;
    const parentY = parent.geometry.y + 96 + parent.geometry.height / 2;
    const elbowX = panelX - 8;
    links.push(`<path class="nested-task-link" data-nested-link-for="${escapeSvgAttribute(key)}" hidden d="M ${parentX} ${parentY} H ${elbowX} V ${panelY + 18} H ${panelX}"></path>`);
    const toggleX = parent.geometry.x + parent.geometry.width - 24;
    const toggleY = parent.geometry.y + 96 + parent.geometry.height - 18;
    toggles.push(`<g class="nested-task-toggle" data-nested-toggle-for="${escapeSvgAttribute(key)}" tabindex="0" role="button" aria-expanded="false" aria-label="${escapeSvgAttribute(`${label}を開く`)}"><rect x="${toggleX - 8}" y="${toggleY - 13}" width="28" height="22" rx="4"></rect><text x="${toggleX + 6}" y="${toggleY + 3}" text-anchor="middle">＋</text></g>`);
  }

  markup = resizeSvg(markup, width, height);
  return markup.replace('</svg>', `<g class="nested-link-layer">${links.join('')}</g><g class="nested-panel-layer">${panels.join('')}</g><g class="nested-toggle-layer">${toggles.join('')}</g></svg>`);
}

export function renderTodoGanttSvg(layout, options = {}) {
  if (layout?.hierarchy === undefined) return renderFlatTodoGanttSvg(layout, options);
  if (layout.hierarchy?.schema !== 'lattice.todo_gantt_hierarchy.v1'
    || !Array.isArray(layout.hierarchy.children)) {
    throw new TypeError('layout hierarchy must be lattice.todo_gantt_hierarchy.v1');
  }
  return renderNestedTodoGanttSvg(layout, options);
}
