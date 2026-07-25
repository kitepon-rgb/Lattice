import { TODO_GANTT_SCOPES, projectTodoGanttScope } from './todo-gantt-scope.mjs';

const TASK_LIMIT = 2_000;
const EDGE_LIMIT = 8_000;
const SWEEP_ROUNDS = 4;

const GEOMETRY = Object.freeze({
  left: 16,
  top: 16,
  wave_gap: 104,
  lane_gap: 296,
  node_width: 272,
  node_height: 68,
  route_inset: 8,
  route_spacing: 12,
});

function segmentKind(left, right) {
  if (left[1] === right[1] && left[0] !== right[0]) return 'horizontal';
  if (left[0] === right[0] && left[1] !== right[1]) return 'vertical';
  return 'point';
}

function strictlyBetween(value, left, right) {
  return value > Math.min(left, right) && value < Math.max(left, right);
}

function addCrossingBridges(projectedEdges, logicalContacts = new Set()) {
  const horizontalByY = new Map();
  const verticals = [];
  for (const edge of projectedEdges) {
    for (let segment = 0; segment < edge.route.length - 1; segment += 1) {
      const start = edge.route[segment];
      const end = edge.route[segment + 1];
      const kind = segmentKind(start, end);
      if (kind === 'horizontal') {
        if (!horizontalByY.has(start[1])) horizontalByY.set(start[1], []);
        horizontalByY.get(start[1]).push({ edge, segment, start, end });
      } else if (kind === 'vertical') verticals.push({ edge, start, end });
    }
  }
  const yValues = [...horizontalByY.keys()].sort((left, right) => left - right);
  const firstGreater = (value) => {
    let low = 0; let high = yValues.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (yValues[middle] <= value) low = middle + 1; else high = middle;
    }
    return low;
  };
  const firstAtLeast = (value) => {
    let low = 0; let high = yValues.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (yValues[middle] < value) low = middle + 1; else high = middle;
    }
    return low;
  };
  for (const vertical of verticals) {
    const minimumY = Math.min(vertical.start[1], vertical.end[1]);
    const maximumY = Math.max(vertical.start[1], vertical.end[1]);
    for (let yIndex = firstGreater(minimumY); yIndex < firstAtLeast(maximumY); yIndex += 1) {
      const y = yValues[yIndex];
      for (const horizontal of horizontalByY.get(y)) {
        if (horizontal.edge === vertical.edge
          || !strictlyBetween(vertical.start[0], horizontal.start[0], horizontal.end[0])) continue;
        if (logicalContacts.has(`${vertical.start[0]},${y}`)) continue;
        horizontal.edge.bridges.push({
          segment_index: horizontal.segment, x: vertical.start[0], y,
        });
      }
    }
  }
  for (const edge of projectedEdges) {
    edge.bridges.sort((left, right) => left.segment_index - right.segment_index
      || (edge.route[left.segment_index][0] <= edge.route[left.segment_index + 1][0]
        ? left.x - right.x : right.x - left.x));
  }
}

export class TodoGanttLayoutError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'TodoGanttLayoutError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new TodoGanttLayoutError(code, message, detail);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function refOf(value, context) {
  if (!plain(value) || typeof value.project_id !== 'string'
    || typeof value.plan_key !== 'string' || typeof value.task_id !== 'string') {
    fail('TODO_LAYOUT_INVALID_INPUT', `${context} must be a task ref`);
  }
  return { project_id: value.project_id, plan_key: value.plan_key, task_id: value.task_id };
}

function refKey(ref) {
  return JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
}

function compareRefs(left, right) {
  return compareText(left.project_id, right.project_id)
    || compareText(left.plan_key, right.plan_key)
    || compareText(left.task_id, right.task_id);
}

function groupKey(planKey, lane) {
  return JSON.stringify([planKey, lane]);
}

function normalizeInput(readModel, chainProjection) {
  if (!plain(readModel) || readModel.schema !== 'lattice.todo_store_read.v1'
    || !Array.isArray(readModel.members)) {
    fail('TODO_LAYOUT_INVALID_INPUT', 'read model must be lattice.todo_store_read.v1');
  }
  if (!plain(chainProjection) || chainProjection.schema !== 'lattice.todo_chain.v1'
    || !Array.isArray(chainProjection.longest_chain_node_refs)
    || !Array.isArray(chainProjection.longest_chain_edges)) {
    fail('TODO_LAYOUT_INVALID_INPUT', 'chain projection must be lattice.todo_chain.v1');
  }

  const nodesByKey = new Map();
  const members = [...readModel.members].sort((left, right) => {
    const leftPlan = left?.plan;
    const rightPlan = right?.plan;
    return compareText(leftPlan?.project_id ?? '', rightPlan?.project_id ?? '')
      || compareText(leftPlan?.plan_key ?? '', rightPlan?.plan_key ?? '');
  });
  for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
    const member = members[memberIndex];
    if (!plain(member) || !plain(member.plan) || !Array.isArray(member.plan.tasks)
      || !Array.isArray(member.tasks) || !Array.isArray(member.plan.hard_dependencies)
      || !Array.isArray(member.plan.joins)) {
      fail('TODO_LAYOUT_INVALID_INPUT', `members[${memberIndex}] has an invalid read-model shape`);
    }
    const { plan } = member;
    const statusByTask = new Map(member.tasks.map((task) => [task.task_id, task]));
    const statusByPhase = new Map((member.snapshot?.phases ?? [])
      .map((phase) => [phase.phase_id, phase.status]));
    for (const task of plan.tasks) {
      if (!plain(task) || typeof task.task_id !== 'string' || typeof task.lane !== 'string') {
        fail('TODO_LAYOUT_INVALID_INPUT', 'plan task has an invalid shape');
      }
      const state = statusByTask.get(task.task_id);
      if (!plain(state) || !['pending', 'in-progress', 'blocked', 'done'].includes(state.status)) {
        fail('TODO_LAYOUT_INVALID_INPUT', `missing task state for ${task.task_id}`);
      }
      const ref = { project_id: plan.project_id, plan_key: plan.plan_key, task_id: task.task_id };
      const key = refKey(ref);
      if (nodesByKey.has(key)) fail('TODO_LAYOUT_INVALID_INPUT', `duplicate task: ${key}`);
      nodesByKey.set(key, {
        key,
        ref,
        title: typeof task.title === 'string' ? task.title : task.task_id,
        lane: task.lane,
        status: state.status,
        plan_schema: plan.schema ?? null,
        phase_id: task.phase_id ?? null,
        phase_status: task.phase_id === undefined ? null : statusByPhase.get(task.phase_id) ?? null,
        phase_ready: plan.schema !== 'lattice.todo_plan.v4'
          || statusByPhase.get(task.phase_id) === 'active',
      });
    }
  }
  if (nodesByKey.size > TASK_LIMIT) {
    fail('TODO_SCALE_EXCEEDED', 'todo gantt task limit exceeded', {
      task_count: nodesByKey.size, task_limit: TASK_LIMIT, edge_count: null, edge_limit: EDGE_LIMIT,
    });
  }

  const edgeMap = new Map();
  const addEdge = (fromValue, toValue, kind, joinIdentity = null) => {
    const fromRef = refOf(fromValue, 'edge.from');
    const toRef = refOf(toValue, 'edge.to');
    const from = refKey(fromRef);
    const to = refKey(toRef);
    if (!nodesByKey.has(from) || !nodesByKey.has(to) || from === to) {
      fail('TODO_LAYOUT_INVALID_INPUT', 'edge must connect two distinct read-model tasks');
    }
    const key = JSON.stringify([from, to]);
    let edge = edgeMap.get(key);
    if (edge === undefined) {
      edge = { key, from, to, kinds: new Set(), joinIdentities: new Map() };
      edgeMap.set(key, edge);
    }
    edge.kinds.add(kind);
    if (joinIdentity !== null) {
      const identityKey = JSON.stringify([
        joinIdentity.project_id, joinIdentity.plan_key, joinIdentity.join_id,
      ]);
      edge.joinIdentities.set(identityKey, joinIdentity);
    }
  };
  for (const member of members) {
    for (const edge of member.plan.hard_dependencies) addEdge(edge.from, edge.to, 'hard');
    for (const join of member.plan.joins) {
      if (!plain(join) || !Array.isArray(join.after) || typeof join.id !== 'string') {
        fail('TODO_LAYOUT_INVALID_INPUT', 'join has an invalid shape');
      }
      const identity = { project_id: member.plan.project_id, plan_key: member.plan.plan_key,
        join_id: join.id };
      for (const after of join.after) addEdge(after, join.before, 'join', identity);
    }
  }
  if (edgeMap.size > EDGE_LIMIT) {
    fail('TODO_SCALE_EXCEEDED', 'todo gantt edge limit exceeded', {
      task_count: nodesByKey.size, task_limit: TASK_LIMIT,
      edge_count: edgeMap.size, edge_limit: EDGE_LIMIT,
    });
  }

  const nodes = [...nodesByKey.values()].sort((left, right) => compareRefs(left.ref, right.ref));
  const edges = [...edgeMap.values()].sort((left, right) => compareText(left.key, right.key));
  return { nodes, nodesByKey, edges };
}

function readyTaskKeys(readModel, nodes, nodesByKey, incoming) {
  const phaseStatuses = new Map();
  const phaseAcceptIncoming = new Map(nodes.map(({ key }) => [key, new Set()]));
  for (const member of readModel.members) {
    for (const phase of member.snapshot?.phases ?? []) {
      phaseStatuses.set(JSON.stringify([
        member.plan.project_id, member.plan.plan_key, phase.phase_id,
      ]), phase.status);
    }
    if (member.plan.schema === 'lattice.todo_plan.v5') {
      for (const edge of member.plan.phase_accept_dependencies ?? []) {
        const target = refKey(refOf(edge.to, 'phase_accept_dependencies.to'));
        if (!nodesByKey.has(target)) {
          fail('TODO_LAYOUT_INVALID_INPUT', 'phase accept dependency targets an absent task');
        }
        phaseAcceptIncoming.get(target).add(JSON.stringify([
          edge.from.project_id, edge.from.plan_key, edge.from.phase_id,
        ]));
      }
    }
  }
  return new Set(nodes.filter((node) => node.status === 'pending' && node.phase_ready
    && incoming.get(node.key).every((predecessorKey) => {
      const predecessor = nodesByKey.get(predecessorKey);
      return predecessor.status === 'done'
        && (predecessor.plan_schema !== 'lattice.todo_plan.v4'
          || predecessor.phase_id === null
          || (predecessor.ref.plan_key === node.ref.plan_key
            && predecessor.phase_id === node.phase_id)
          || predecessor.phase_status === 'accepted');
    }) && [...phaseAcceptIncoming.get(node.key)]
      .every((phaseKey) => phaseStatuses.get(phaseKey) === 'accepted'))
    .map(({ key }) => key));
}

function assignWaves(nodes, nodesByKey, edges) {
  const incoming = new Map(nodes.map(({ key }) => [key, []]));
  const outgoing = new Map(nodes.map(({ key }) => [key, []]));
  const indegree = new Map(nodes.map(({ key }) => [key, 0]));
  for (const edge of edges) {
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  for (const values of incoming.values()) values.sort(compareText);
  for (const values of outgoing.values()) values.sort(compareText);
  let ready = nodes.filter(({ key }) => indegree.get(key) === 0).map(({ key }) => key);
  ready.sort((left, right) => compareRefs(nodesByKey.get(left).ref, nodesByKey.get(right).ref));
  const wave = new Map(nodes.map(({ key }) => [key, 0]));
  let visited = 0;
  while (ready.length > 0) {
    const current = ready.shift();
    visited += 1;
    for (const next of outgoing.get(current)) {
      wave.set(next, Math.max(wave.get(next), wave.get(current) + 1));
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
        ready.sort((left, right) => compareRefs(nodesByKey.get(left).ref, nodesByKey.get(right).ref));
      }
    }
  }
  if (visited !== nodes.length) fail('TODO_LAYOUT_CYCLE', 'todo layout input contains a cycle');
  return { incoming, outgoing, wave };
}

function median(values) {
  if (values.length === 0) return null;
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function orderLayers(nodes, wave, incoming, outgoing) {
  const maximumWave = nodes.reduce((maximum, node) => Math.max(maximum, wave.get(node.key)), 0);
  const layers = Array.from({ length: maximumWave + 1 }, () => []);
  for (const node of nodes) layers[wave.get(node.key)].push(node.key);
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const baseCompare = (leftKey, rightKey) => {
    const left = nodeByKey.get(leftKey);
    const right = nodeByKey.get(rightKey);
    return compareText(left.lane, right.lane)
      || compareText(left.ref.plan_key, right.ref.plan_key)
      || compareRefs(left.ref, right.ref);
  };
  for (const layer of layers) layer.sort(baseCompare);

  const reorder = (layerIndex, neighborMap) => {
    const layer = layers[layerIndex];
    const previousPosition = new Map(layer.map((key, index) => [key, index]));
    const allPositions = new Map();
    for (const otherLayer of layers) {
      for (let index = 0; index < otherLayer.length; index += 1) allPositions.set(otherLayer[index], index);
    }
    const score = new Map(layer.map((key) => [key, median(
      neighborMap.get(key).filter((neighbor) => allPositions.has(neighbor)).map((neighbor) => allPositions.get(neighbor)),
    )]));
    layer.sort((leftKey, rightKey) => {
      const left = nodeByKey.get(leftKey);
      const right = nodeByKey.get(rightKey);
      const groupOrder = compareText(left.lane, right.lane)
        || compareText(left.ref.plan_key, right.ref.plan_key);
      if (groupOrder !== 0) return groupOrder;
      const leftScore = score.get(leftKey);
      const rightScore = score.get(rightKey);
      if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return leftScore - rightScore;
      if (leftScore === null && rightScore !== null) return 1;
      if (leftScore !== null && rightScore === null) return -1;
      return previousPosition.get(leftKey) - previousPosition.get(rightKey) || baseCompare(leftKey, rightKey);
    });
  };

  for (let round = 0; round < SWEEP_ROUNDS; round += 1) {
    for (let layer = 1; layer < layers.length; layer += 1) reorder(layer, incoming);
    for (let layer = layers.length - 2; layer >= 0; layer -= 1) reorder(layer, outgoing);
  }
  return layers;
}

function crossingCount(edges, wave, transversePosition) {
  const groups = new Map();
  for (const edge of edges) {
    const pair = `${wave.get(edge.from)}\0${wave.get(edge.to)}`;
    if (!groups.has(pair)) groups.set(pair, []);
    groups.get(pair).push([transversePosition.get(edge.from), transversePosition.get(edge.to)]);
  }
  let total = 0;
  for (const group of groups.values()) {
    group.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const targets = [...new Set(group.map((entry) => entry[1]))].sort((left, right) => left - right);
    const rank = new Map(targets.map((value, index) => [value, index + 1]));
    const tree = new Uint32Array(targets.length + 1);
    let seen = 0;
    for (const [, target] of group) {
      let prefix = 0;
      for (let index = rank.get(target); index > 0; index -= index & -index) prefix += tree[index];
      total += seen - prefix;
      for (let index = rank.get(target); index < tree.length; index += index & -index) tree[index] += 1;
      seen += 1;
    }
  }
  return total;
}

export function layoutTodoGantt(readModel, chainProjection, options = {}) {
  const scope = options.scope ?? 'live';
  if (!TODO_GANTT_SCOPES.includes(scope)) {
    fail('TODO_LAYOUT_INVALID_INPUT', `scope must be one of ${TODO_GANTT_SCOPES.join(', ')}`);
  }

  // Every structural number below is measured on the FULL graph: the dependency
  // waves, the longest dependency chain and the ready frontier describe the real
  // plan. Folding first and measuring second would make all three lie.
  const full = normalizeInput(readModel, chainProjection);
  const fullWaves = assignWaves(full.nodes, full.nodesByKey, full.edges);

  const longestNodeKeys = new Set(chainProjection.longest_chain_node_refs.map((ref, index) => {
    const key = refKey(refOf(ref, `longest_chain_node_refs[${index}]`));
    if (!full.nodesByKey.has(key)) fail('TODO_LAYOUT_INVALID_INPUT', 'chain projection references an absent task');
    return key;
  }));
  const longestEdgeKeys = new Set(chainProjection.longest_chain_edges.map((edge, index) => {
    if (!plain(edge)) fail('TODO_LAYOUT_INVALID_INPUT', `longest_chain_edges[${index}] is invalid`);
    const from = refKey(refOf(edge.from, `longest_chain_edges[${index}].from`));
    const to = refKey(refOf(edge.to, `longest_chain_edges[${index}].to`));
    const key = JSON.stringify([from, to]);
    if (!full.edges.some((candidate) => candidate.key === key)) {
      fail('TODO_LAYOUT_INVALID_INPUT', 'chain projection edge is absent from the read model');
    }
    return key;
  }));
  const readyKeys = readyTaskKeys(readModel, full.nodes, full.nodesByKey, fullWaves.incoming);

  // Only the geometry stage below sees the narrowed graph.
  const projected = scope === 'all'
    ? { nodes: full.nodes, edges: full.edges, foldedKeys: new Set() }
    : projectTodoGanttScope({ nodes: full.nodes, edges: full.edges, wave: fullWaves.wave });
  const nodes = projected.nodes;
  const edges = projected.edges;
  const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
  const { incoming, outgoing, wave } = assignWaves(nodes, nodesByKey, edges);
  const layers = orderLayers(nodes, wave, incoming, outgoing);
  const transversePosition = new Map();
  for (const layer of layers) {
    for (let index = 0; index < layer.length; index += 1) transversePosition.set(layer[index], index);
  }
  const visibleKeys = new Set(nodes.map(({ key }) => key));
  const displayBranches = edges.flatMap((edge, semanticIndex) => {
    const identities = [...edge.joinIdentities.entries()]
      .sort(([left], [right]) => compareText(left, right)).map(([, identity]) => identity);
    const variants = identities.length === 0 ? [null] : identities;
    return variants.map((joinIdentity, branchIndex) => ({
      key: JSON.stringify([edge.key, joinIdentity]), edge, semanticIndex, branchIndex, joinIdentity,
    }));
  });

  const gapGroups = new Map();
  const portGroups = new Map();
  const portGroupKey = (gap, row) => `${gap}\0${row}`;
  const portEntryKey = (edgeKey, direction) => `${edgeKey}\0${direction}`;
  const addPort = (gap, row, entry) => {
    const key = portGroupKey(gap, row);
    if (!portGroups.has(key)) portGroups.set(key, []);
    portGroups.get(key).push(entry);
  };
  displayBranches.forEach((branch) => {
    const { edge } = branch;
    for (const gap of new Set([wave.get(edge.from), wave.get(edge.to) - 1])) {
      if (!gapGroups.has(gap)) gapGroups.set(gap, []);
      gapGroups.get(gap).push(branch.key);
    }
    addPort(wave.get(edge.from), transversePosition.get(edge.from), portEntryKey(branch.key, 'departure'));
    addPort(wave.get(edge.to) - 1, transversePosition.get(edge.to), portEntryKey(branch.key, 'arrival'));
  });
  for (const keys of gapGroups.values()) keys.sort(compareText);
  for (const entries of portGroups.values()) entries.sort(compareText);
  const maximumPortTraffic = Math.max(0, ...[...portGroups.values()].map(({ length }) => length));
  const connectorGroupKeysByGap = new Map();
  for (const branch of displayBranches) {
    if (branch.joinIdentity === null) continue;
    const targetGap = wave.get(branch.edge.to) - 1;
    if (!connectorGroupKeysByGap.has(targetGap)) connectorGroupKeysByGap.set(targetGap, new Set());
    connectorGroupKeysByGap.get(targetGap).add(JSON.stringify([branch.edge.to, branch.joinIdentity]));
  }
  const allGapIndexes = new Set([...gapGroups.keys(), ...connectorGroupKeysByGap.keys()]);
  const maximumGapOccupancy = Math.max(0, ...[...allGapIndexes].map((gap) =>
    (gapGroups.get(gap)?.length ?? 0) + (connectorGroupKeysByGap.get(gap)?.size ?? 0)));
  const nodeWidth = Math.max(GEOMETRY.node_width,
    GEOMETRY.route_inset * 2 + (maximumPortTraffic + 1) * GEOMETRY.route_spacing);
  const laneGap = nodeWidth + 24;
  const waveGap = GEOMETRY.node_height + Math.max(36,
    (maximumGapOccupancy + 1) * GEOMETRY.route_spacing);

  const coordinates = new Map();
  const projectedNodes = nodes.map((node) => {
    const visible = visibleKeys.has(node.key);
    const geometry = visible ? {
      x: GEOMETRY.left + transversePosition.get(node.key) * laneGap,
      y: GEOMETRY.top + wave.get(node.key) * waveGap,
      width: nodeWidth,
      height: GEOMETRY.node_height,
    } : null;
    if (geometry !== null) coordinates.set(node.key, geometry);
    return {
      ref: { ...node.ref }, title: node.title, lane: node.lane, status: node.status,
      wave: wave.get(node.key), row: transversePosition.get(node.key), visible,
      visibility: {
        longest_dependency_chain: longestNodeKeys.has(node.key),
        active: node.status === 'in-progress', next_ready: readyKeys.has(node.key),
        selected: false,
      },
      geometry,
    };
  });

  const gapPosition = (edgeKey, waveIndex) => {
    const keys = gapGroups.get(waveIndex);
    const index = keys.indexOf(edgeKey);
    return GEOMETRY.top + waveIndex * waveGap + GEOMETRY.node_height
      + GEOMETRY.route_spacing * (index + 1);
  };
  const maximumLayerWidth = Math.max(...layers.map((layer) => layer.length));
  const routeRight = GEOMETRY.left + (maximumLayerWidth - 1) * laneGap + nodeWidth + 12;
  const branchCounts = new Map();
  for (const branch of displayBranches) {
    branchCounts.set(branch.semanticIndex, (branchCounts.get(branch.semanticIndex) ?? 0) + 1);
  }
  const portPosition = (edgeKey, direction, gap, row, nodeX) => {
    const entries = portGroups.get(portGroupKey(gap, row));
    return nodeX + GEOMETRY.route_inset
      + GEOMETRY.route_spacing * (entries.indexOf(portEntryKey(edgeKey, direction)) + 1);
  };

  const projectedEdges = displayBranches.map((branch, index) => {
    const { edge } = branch;
    const onLongestChain = longestEdgeKeys.has(edge.key);
    const from = coordinates.get(edge.from);
    const to = coordinates.get(edge.to);
    const departureGap = wave.get(edge.from);
    const arrivalGap = wave.get(edge.to) - 1;
    const startX = portPosition(branch.key, 'departure', departureGap,
      transversePosition.get(edge.from), from.x);
    const startY = from.y + from.height;
    const endX = portPosition(branch.key, 'arrival', arrivalGap,
      transversePosition.get(edge.to), to.x);
    const endY = to.y;
    const departureY = gapPosition(branch.key, departureGap);
    const arrivalY = gapPosition(branch.key, arrivalGap);
    const corridorX = routeRight + GEOMETRY.route_spacing * (index + 1);
    const route = [[startX, startY], [startX, departureY]];
    if (arrivalY === departureY) route.push([endX, arrivalY]);
    else route.push([corridorX, departureY], [corridorX, arrivalY], [endX, arrivalY]);
    route.push([endX, endY]);
    return {
      id: branchCounts.get(branch.semanticIndex) === 1
        ? `edge-${branch.semanticIndex}` : `edge-${branch.semanticIndex}-join-${branch.branchIndex}`,
      semantic_edge_id: `edge-${branch.semanticIndex}`,
      from: { ...nodesByKey.get(edge.from).ref }, to: { ...nodesByKey.get(edge.to).ref },
      kinds: [...edge.kinds].sort(compareText),
      join_ids: branch.joinIdentity === null ? [] : [branch.joinIdentity.join_id],
      join_owners: branch.joinIdentity === null ? [] : [{ ...branch.joinIdentity }],
      visible: true, visibility: { longest_dependency_chain: onLongestChain, selected_incident: false },
      route, bridges: [], junction: null,
    };
  });
  const joinGroups = new Map();
  for (const edge of projectedEdges) {
    if (edge.join_ids.length === 0) continue;
    const key = JSON.stringify([edge.to, edge.join_owners[0]]);
    if (!joinGroups.has(key)) joinGroups.set(key, []);
    joinGroups.get(key).push(edge);
  }
  const junctionConnectors = [];
  const logicalContacts = new Set();
  const connectorGapRanks = new Map();
  for (const [, group] of [...joinGroups.entries()].sort(([left], [right]) => compareText(left, right))) {
    group.sort((left, right) => compareText(left.id, right.id));
    const target = coordinates.get(refKey(group[0].to));
    const targetGap = wave.get(refKey(group[0].to)) - 1;
    const groupRank = connectorGapRanks.get(targetGap) ?? 0;
    connectorGapRanks.set(targetGap, groupRank + 1);
    const primaryTargetPortX = group[0].route.at(-1)[0];
    const junction = [primaryTargetPortX,
      GEOMETRY.top + targetGap * waveGap + GEOMETRY.node_height
        + GEOMETRY.route_spacing * ((gapGroups.get(targetGap)?.length ?? 0) + groupRank + 1)];
    const contacts = [];
    for (const [index, edge] of group.entries()) {
      edge.route.pop();
      const contact = [edge.route.at(-1)[0], junction[1]];
      if (edge.route.at(-1)[1] !== contact[1]) edge.route.push(contact);
      contacts.push(contact);
      logicalContacts.add(`${contact[0]},${contact[1]}`);
      if (index === 0) {
        edge.route.push([junction[0], target.y]);
        edge.junction = junction;
      }
    }
    const contactXs = contacts.map(([x]) => x);
    if (Math.min(...contactXs) !== Math.max(...contactXs)) {
      junctionConnectors.push({
        id: `join-connector-${junctionConnectors.length}`,
        join_ids: [...group[0].join_ids], join_owners: group[0].join_owners.map((owner) => ({ ...owner })),
        route: [[Math.min(...contactXs), junction[1]], [Math.max(...contactXs), junction[1]]],
        bridges: [], contacts,
      });
    }
  }
  addCrossingBridges([...projectedEdges, ...junctionConnectors], logicalContacts);
  let routeMaximumX = nodes.length === 0 ? 0
    : GEOMETRY.left + (maximumLayerWidth - 1) * laneGap + nodeWidth;
  for (const edge of projectedEdges) {
    for (const [x] of edge.route) routeMaximumX = Math.max(routeMaximumX, x);
  }
  for (const connector of junctionConnectors) {
    for (const [x] of connector.route) routeMaximumX = Math.max(routeMaximumX, x);
  }

  // Counts stay honest: the summary chips report every ToDo in the plan, not
  // only the ones the narrowed diagram happens to draw.
  const planMap = new Map();
  const laneMap = new Map();
  for (const node of full.nodes) {
    if (!planMap.has(node.ref.plan_key)) planMap.set(node.ref.plan_key, 0);
    planMap.set(node.ref.plan_key, planMap.get(node.ref.plan_key) + 1);
    const key = groupKey(node.ref.plan_key, node.lane);
    if (!laneMap.has(key)) laneMap.set(key, { plan_key: node.ref.plan_key, lane: node.lane, task_count: 0 });
    laneMap.get(key).task_count += 1;
  }
  return {
    schema: 'lattice.todo_gantt_layout.v1',
    assumptions: { logical_time: 'dependency_wave', duration_estimation: false, lane_is_presentation_only: true },
    sweep: { method: 'stable_median', rounds: SWEEP_ROUNDS, tie_break: 'previous_position_then_task_ref' },
    bounds: {
      width: nodes.length === 0 ? 0 : routeMaximumX + GEOMETRY.left,
      height: nodes.length === 0 ? 0 : GEOMETRY.top * 2
        + (layers.length - 1) * waveGap + GEOMETRY.node_height,
      wave_count: layers.length,
    },
    nodes: projectedNodes,
    edges: projectedEdges,
    // Every dependency in the plan, before folding contracted any of them away.
    // The diagram draws `edges`; anything that describes a ToDo in words — the
    // premises and successors in the right pane — reads this instead, so a
    // folded ToDo keeps telling the truth about what it depended on.
    full_edges: full.edges.map((edge) => ({
      from: { ...full.nodesByKey.get(edge.from).ref },
      to: { ...full.nodesByKey.get(edge.to).ref },
      kinds: [...edge.kinds].sort(compareText),
      join_ids: [...edge.joinIdentities.values()].map(({ join_id }) => join_id).sort(compareText),
    })),
    connectors: junctionConnectors,
    groups: {
      plans: [...planMap.entries()].map(([plan_key, task_count]) => ({ plan_key, task_count })),
      lanes: [...laneMap.values()],
    },
    scope: {
      requested: scope,
      folded_task_count: projected.foldedKeys.size,
    },
    // The ToDos the diagram no longer draws. They stay in the task index and in
    // every count, so the reader can still reach them by name.
    folded: [...projected.foldedKeys]
      .map((taskKey) => JSON.parse(taskKey))
      .map(([project_id, plan_key, task_id]) => ({ project_id, plan_key, task_id }))
      .sort(compareRefs),
    metrics: {
      crossing_count: crossingCount(edges, wave, transversePosition),
      visible_node_count: visibleKeys.size,
      visible_edge_count: projectedEdges.filter(({ visible }) => visible).length,
      task_count: full.nodes.length,
      edge_count: full.edges.length,
    },
  };
}
