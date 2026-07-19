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
});

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
      });
    }
  }
  if (nodesByKey.size > TASK_LIMIT) {
    fail('TODO_SCALE_EXCEEDED', 'todo gantt task limit exceeded', {
      task_count: nodesByKey.size, task_limit: TASK_LIMIT, edge_count: null, edge_limit: EDGE_LIMIT,
    });
  }

  const edgeMap = new Map();
  const addEdge = (fromValue, toValue, kind, joinId = null) => {
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
      edge = { key, from, to, kinds: new Set(), joinIds: new Set() };
      edgeMap.set(key, edge);
    }
    edge.kinds.add(kind);
    if (joinId !== null) edge.joinIds.add(joinId);
  };
  for (const member of members) {
    for (const edge of member.plan.hard_dependencies) addEdge(edge.from, edge.to, 'hard');
    for (const join of member.plan.joins) {
      if (!plain(join) || !Array.isArray(join.after) || typeof join.id !== 'string') {
        fail('TODO_LAYOUT_INVALID_INPUT', 'join has an invalid shape');
      }
      for (const after of join.after) addEdge(after, join.before, 'join', join.id);
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

export function layoutTodoGantt(readModel, chainProjection) {
  const { nodes, nodesByKey, edges } = normalizeInput(readModel, chainProjection);
  const { incoming, outgoing, wave } = assignWaves(nodes, nodesByKey, edges);
  const layers = orderLayers(nodes, wave, incoming, outgoing);
  const transversePosition = new Map();
  for (const layer of layers) {
    for (let index = 0; index < layer.length; index += 1) transversePosition.set(layer[index], index);
  }

  const longestNodeKeys = new Set(chainProjection.longest_chain_node_refs.map((ref, index) => {
    const key = refKey(refOf(ref, `longest_chain_node_refs[${index}]`));
    if (!nodesByKey.has(key)) fail('TODO_LAYOUT_INVALID_INPUT', 'chain projection references an absent task');
    return key;
  }));
  const longestEdgeKeys = new Set(chainProjection.longest_chain_edges.map((edge, index) => {
    if (!plain(edge)) fail('TODO_LAYOUT_INVALID_INPUT', `longest_chain_edges[${index}] is invalid`);
    const from = refKey(refOf(edge.from, `longest_chain_edges[${index}].from`));
    const to = refKey(refOf(edge.to, `longest_chain_edges[${index}].to`));
    const key = JSON.stringify([from, to]);
    if (!edges.some((candidate) => candidate.key === key)) {
      fail('TODO_LAYOUT_INVALID_INPUT', 'chain projection edge is absent from the read model');
    }
    return key;
  }));
  const readyKeys = new Set(nodes.filter((node) => node.status === 'pending'
    && incoming.get(node.key).every((predecessor) => nodesByKey.get(predecessor).status === 'done'))
    .map(({ key }) => key));
  const visibleKeys = new Set(nodes.map(({ key }) => key));

  const coordinates = new Map();
  const projectedNodes = nodes.map((node) => {
    const visible = visibleKeys.has(node.key);
    const geometry = visible ? {
      x: GEOMETRY.left + transversePosition.get(node.key) * GEOMETRY.lane_gap,
      y: GEOMETRY.top + wave.get(node.key) * GEOMETRY.wave_gap,
      width: GEOMETRY.node_width,
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

  const projectedEdges = edges.map((edge, index) => {
    const onLongestChain = longestEdgeKeys.has(edge.key);
    const from = coordinates.get(edge.from);
    const to = coordinates.get(edge.to);
    const startX = from.x + Math.floor(from.width / 2);
    const startY = from.y + from.height;
    const endX = to.x + Math.floor(to.width / 2);
    const endY = to.y;
    const channelY = startY + Math.max(16, Math.floor((endY - startY) / 2));
    const route = [[startX, startY], [startX, channelY], [endX, channelY], [endX, endY]];
    return {
      id: `edge-${index}`, from: { ...nodesByKey.get(edge.from).ref }, to: { ...nodesByKey.get(edge.to).ref },
      kinds: [...edge.kinds].sort(compareText), join_ids: [...edge.joinIds].sort(compareText),
      visible: true, visibility: { longest_dependency_chain: onLongestChain, selected_incident: false }, route,
    };
  });

  const planMap = new Map();
  const laneMap = new Map();
  for (const node of nodes) {
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
      width: nodes.length === 0 ? 0 : GEOMETRY.left * 2
        + (Math.max(...layers.map((layer) => layer.length)) - 1) * GEOMETRY.lane_gap
        + GEOMETRY.node_width,
      height: nodes.length === 0 ? 0 : GEOMETRY.top * 2
        + (layers.length - 1) * GEOMETRY.wave_gap + GEOMETRY.node_height,
      wave_count: layers.length,
    },
    nodes: projectedNodes,
    edges: projectedEdges,
    groups: {
      plans: [...planMap.entries()].map(([plan_key, task_count]) => ({ plan_key, task_count })),
      lanes: [...laneMap.values()],
    },
    metrics: {
      crossing_count: crossingCount(edges, wave, transversePosition),
      visible_node_count: visibleKeys.size,
      visible_edge_count: projectedEdges.filter(({ visible }) => visible).length,
      task_count: nodes.length,
      edge_count: edges.length,
    },
  };
}
