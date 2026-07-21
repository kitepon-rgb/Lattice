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
  const key = nodeKey(node.ref);
  const nodeLaneKey = laneKey(node.ref.plan_key, node.lane);
  const status = TODO_GANTT_STATUS_PRESENTATION[node.status] ?? { mark: '?', label: '状態不明' };
  const lane = maps.lanes.get(nodeLaneKey);
  const laneLabel = lane === undefined ? node.lane : `${node.lane}、${lane.name}`;
  const taskNumber = maps.taskNumbers.get(key);
  const visibleReference = taskNumber === undefined ? `ID ${node.ref.task_id}` : `工程 ${taskNumber.display_number}`;
  const spokenReference = taskNumber === undefined ? `ID ${node.ref.task_id}` : `工程${taskNumber.display_number}`;
  const readyLabel = node.visibility.next_ready ? '。ready frontierの同時dispatch候補' : '';
  const ariaLabel = `${spokenReference}。${status.label}。${laneLabel}。${node.title}。正規ID ${node.ref.plan_key}/${node.ref.task_id}${readyLabel}`;
  const statusBar = node.status === 'in-progress'
    ? `<line class="status-bar" x1="${x + 5}" y1="${y + 6}" x2="${x + 5}" y2="${y + height - 6}"></line>` : '';
  const titleLines = wrapLabel(node.title);
  const titleMarkup = titleLines.map((line, index) => `<tspan x="${x + 10}" dy="${index === 0 ? 0 : 17}" class="node-title-line">${escapeSvgText(line)}</tspan>`).join('');
  const taskNumberAttributes = taskNumber === undefined ? ''
    : ` data-task-number="${escapeSvgAttribute(taskNumber.display_number)}" data-task-number-normalized="${escapeSvgAttribute(taskNumber.normalized_number)}" data-task-number-globally-unique="${taskNumber.globally_unique ? 'true' : 'false'}"`;
  return `<g class="${classes.join(' ')}" data-node-key="${escapeSvgAttribute(key)}" data-lane-key="${escapeSvgAttribute(nodeLaneKey)}" data-project-id="${escapeSvgAttribute(node.ref.project_id)}" data-plan-key="${escapeSvgAttribute(node.ref.plan_key)}" data-task-id="${escapeSvgAttribute(node.ref.task_id)}"${taskNumberAttributes} tabindex="0" role="button" aria-selected="${node.visibility.selected ? 'true' : 'false'}" aria-label="${escapeSvgAttribute(ariaLabel)}"><rect class="node-surface" x="${x}" y="${y}" width="${width}" height="${height}" rx="4"></rect>${statusBar}<text class="status-mark" x="${x + 10}" y="${y + 21}">${escapeSvgText(status.mark)}</text><text class="node-meta" x="${x + 34}" y="${y + 20}">${escapeSvgText(`${status.label} · ${visibleReference}`)}</text><text class="node-title" x="${x + 10}" y="${y + 42}">${titleMarkup}</text><title>${escapeSvgText(`${spokenReference}: ${node.title} — ${status.label} — ${laneLabel} — 正規ID ${node.ref.plan_key}/${node.ref.task_id}`)}</title></g>`;
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
  for (const plan of layout.groups.plans) {
    const lanes = layout.groups.lanes.filter((lane) => lane.plan_key === plan.plan_key);
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

export function renderTodoGanttSvg(layout, options = {}) {
  if (layout === null || typeof layout !== 'object' || layout.schema !== 'lattice.todo_gantt_layout.v1'
    || !Array.isArray(layout.nodes) || !Array.isArray(layout.edges)) {
    throw new TypeError('layout must be lattice.todo_gantt_layout.v1');
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
