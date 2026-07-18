export class DagChainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DagChainError';
    this.code = code;
  }
}

export class DagCycleError extends DagChainError {
  constructor(message = 'directed graph contains a cycle') {
    super('DAG_CYCLE', message);
    this.name = 'DagCycleError';
  }
}

function defaultCompare(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function assertOptions(countCap, representativeLimit) {
  if (!Number.isSafeInteger(countCap) || countCap < 0 || countCap >= Number.MAX_SAFE_INTEGER) {
    throw new DagChainError(
      'DAG_INVALID_COUNT_CAP',
      'countCap must be a non-negative safe integer below Number.MAX_SAFE_INTEGER',
    );
  }
  if (!Number.isSafeInteger(representativeLimit) || representativeLimit < 0) {
    throw new DagChainError(
      'DAG_INVALID_REPRESENTATIVE_LIMIT',
      'representativeLimit must be a non-negative safe integer',
    );
  }
}

function normalizeGraph(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new DagChainError('DAG_INVALID_GRAPH', 'nodes and edges must be arrays');
  }

  const nodeSet = new Set();
  for (const node of nodes) {
    if (nodeSet.has(node)) {
      throw new DagChainError('DAG_DUPLICATE_NODE', 'nodes must be unique');
    }
    nodeSet.add(node);
  }

  const successors = new Map(nodes.map((node) => [node, []]));
  const predecessors = new Map(nodes.map((node) => [node, []]));
  const normalizedEdges = [];
  const seenBySource = new Map();

  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new DagChainError('DAG_INVALID_EDGE', 'each edge must be a [from, to] pair');
    }
    const [from, to] = edge;
    if (!nodeSet.has(from) || !nodeSet.has(to)) {
      throw new DagChainError('DAG_DANGLING_EDGE', 'edge endpoint is absent from nodes');
    }
    let targets = seenBySource.get(from);
    if (targets === undefined) {
      targets = new Set();
      seenBySource.set(from, targets);
    }
    if (targets.has(to)) continue;
    targets.add(to);
    successors.get(from).push(to);
    predecessors.get(to).push(from);
    normalizedEdges.push([from, to]);
  }

  return { successors, predecessors, edges: normalizedEdges };
}

function topologicalOrder(nodes, successors, predecessors) {
  const indegree = new Map(nodes.map((node) => [node, predecessors.get(node).length]));
  const ready = [];
  for (const node of nodes) {
    if (indegree.get(node) === 0) ready.push(node);
  }

  const order = [];
  let cursor = 0;
  while (cursor < ready.length) {
    const node = ready[cursor];
    cursor += 1;
    order.push(node);
    for (const successor of successors.get(node)) {
      const remaining = indegree.get(successor) - 1;
      indegree.set(successor, remaining);
      if (remaining === 0) ready.push(successor);
    }
  }

  if (order.length !== nodes.length) throw new DagCycleError();
  return order;
}

function saturatedAdd(left, right, saturationPoint) {
  if (left >= saturationPoint || right >= saturationPoint) return saturationPoint;
  if (left > saturationPoint - right) return saturationPoint;
  return left + right;
}

function enumerateRepresentatives({
  orderedNodes,
  successors,
  down,
  up,
  maximumDepth,
  representativeLimit,
}) {
  if (maximumDepth === 0 || representativeLimit === 0) return [];

  const eligibleSuccessors = new Map();
  for (const node of orderedNodes) {
    eligibleSuccessors.set(
      node,
      successors.get(node).filter((successor) => (
        down.get(node) + up.get(successor) === maximumDepth
        && up.get(successor) === up.get(node) - 1
      )),
    );
  }

  const starts = orderedNodes.filter((node) => down.get(node) === 1 && up.get(node) === maximumDepth);
  const representatives = [];

  for (const start of starts) {
    const path = [start];
    const frames = [{ node: start, successorIndex: 0 }];

    while (frames.length > 0 && representatives.length < representativeLimit) {
      const frame = frames[frames.length - 1];
      if (up.get(frame.node) === 1) {
        representatives.push([...path]);
        frames.pop();
        path.pop();
        continue;
      }

      const choices = eligibleSuccessors.get(frame.node);
      if (frame.successorIndex >= choices.length) {
        frames.pop();
        path.pop();
        continue;
      }

      const successor = choices[frame.successorIndex];
      frame.successorIndex += 1;
      path.push(successor);
      frames.push({ node: successor, successorIndex: 0 });
    }

    if (representatives.length >= representativeLimit) break;
  }

  return representatives;
}

export function analyzeDagChains(
  nodes,
  edges,
  {
    countCap = 1_000_000,
    representativeLimit = 8,
    compare = defaultCompare,
  } = {},
) {
  assertOptions(countCap, representativeLimit);
  if (typeof compare !== 'function') {
    throw new DagChainError('DAG_INVALID_COMPARATOR', 'compare must be a function');
  }

  const graph = normalizeGraph(nodes, edges);
  const order = topologicalOrder(nodes, graph.successors, graph.predecessors);
  const saturationPoint = countCap + 1;
  const down = new Map();
  const waysDown = new Map();

  for (const node of order) {
    let depth = 1;
    let ways = 1;
    for (const predecessor of graph.predecessors.get(node)) {
      const candidateDepth = down.get(predecessor) + 1;
      if (candidateDepth > depth) {
        depth = candidateDepth;
        ways = waysDown.get(predecessor);
      } else if (candidateDepth === depth) {
        ways = saturatedAdd(ways, waysDown.get(predecessor), saturationPoint);
      }
    }
    down.set(node, depth);
    waysDown.set(node, ways);
  }

  const up = new Map();
  const waysUp = new Map();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const node = order[index];
    let depth = 1;
    let ways = 1;
    for (const successor of graph.successors.get(node)) {
      const candidateDepth = up.get(successor) + 1;
      if (candidateDepth > depth) {
        depth = candidateDepth;
        ways = waysUp.get(successor);
      } else if (candidateDepth === depth) {
        ways = saturatedAdd(ways, waysUp.get(successor), saturationPoint);
      }
    }
    up.set(node, depth);
    waysUp.set(node, ways);
  }

  let maximumDepth = 0;
  for (const node of nodes) maximumDepth = Math.max(maximumDepth, down.get(node) ?? 0);

  let saturatedCount = 0;
  for (const node of nodes) {
    if (down.get(node) === 1 && up.get(node) === maximumDepth) {
      saturatedCount = saturatedAdd(saturatedCount, waysUp.get(node), saturationPoint);
    }
  }

  const orderedNodes = [...nodes].sort(compare);
  for (const values of graph.successors.values()) values.sort(compare);
  const longestChainNodes = orderedNodes.filter((node) => (
    down.get(node) + up.get(node) - 1 === maximumDepth
  ));
  const longestChainEdges = graph.edges
    .filter(([from, to]) => down.get(from) + up.get(to) === maximumDepth)
    .sort((left, right) => compare(left[0], right[0]) || compare(left[1], right[1]));

  return {
    maximumDepth,
    longestChainNodes,
    longestChainEdges,
    longestChainCount: {
      count: Math.min(saturatedCount, countCap),
      overflow: saturatedCount > countCap,
    },
    representativeChains: enumerateRepresentatives({
      orderedNodes,
      successors: graph.successors,
      down,
      up,
      maximumDepth,
      representativeLimit,
    }),
    topologicalOrder: order,
  };
}
