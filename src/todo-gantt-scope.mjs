/**
 * Todo Gantt scope projection.
 *
 * The store carries every completed ToDo forward across plan revisions on
 * purpose — an accepted artifact is the predecessor of the work that follows
 * it. That makes the dependency diagram grow monotonically: once a campaign
 * finishes, its whole tree stays on screen forever and every later revision
 * stacks on top of it. The journal is the source of truth, so nothing is
 * removed from the store; the diagram is a projection, and this module is
 * where that projection narrows.
 *
 * The rule is "fold the dead branches": a completed ToDo that no longer leads
 * to any live work is history, and history collapses into one labelled node
 * per finished branch. Completed ToDos that are still the direct premise of
 * live work stay visible, because they are the context for what is dispatchable
 * right now.
 *
 * This module is pure graph math over the layout's internal node/edge shape.
 * It must run AFTER dependency waves, the longest dependency chain and the
 * ready frontier have been computed on the FULL graph — those numbers describe
 * the real plan, and measuring them on a folded graph would make them lie.
 */

export const TODO_GANTT_SCOPES = Object.freeze(['live', 'all']);

/**
 * Hops of completed predecessors kept in front of live work. 1 = keep the
 * direct premises of live ToDos, fold everything upstream of them.
 */
export const DEFAULT_FOLD_DISTANCE = 1;

/**
 * `task_id` values in the store match /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/, so
 * a leading '~' cannot collide with a real ToDo.
 */
const FOLD_TASK_ID_PREFIX = '~folded';

export class TodoGanttScopeError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'TodoGanttScopeError';
    this.code = code;
    this.detail = detail;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isFoldNodeRef(ref) {
  return typeof ref?.task_id === 'string' && ref.task_id.startsWith(`${FOLD_TASK_ID_PREFIX}:`);
}

/**
 * Forward distance from each node to the nearest live (non-done) node, over the
 * dependency DAG. A live node is at distance 0; a node with no live descendant
 * is at Infinity.
 *
 * Edges always increase the wave (`assignWaves` is a longest-path layering), so
 * visiting nodes in descending wave order guarantees every successor is settled
 * before the node that depends on it.
 */
function distanceToLive(nodes, edges, wave) {
  const outgoing = new Map(nodes.map(({ key }) => [key, []]));
  for (const edge of edges) outgoing.get(edge.from).push(edge.to);
  const distance = new Map();
  const ordered = [...nodes].sort((left, right) => wave.get(right.key) - wave.get(left.key)
    || compareText(right.key, left.key));
  for (const node of ordered) {
    if (node.status !== 'done') {
      distance.set(node.key, 0);
      continue;
    }
    let best = Infinity;
    for (const successor of outgoing.get(node.key)) {
      const settled = distance.get(successor);
      if (settled !== undefined && settled + 1 < best) best = settled + 1;
    }
    distance.set(node.key, best);
  }
  return distance;
}

function foldableKeys(nodes, distance, foldDistance) {
  return new Set(nodes
    .filter((node) => node.status === 'done' && distance.get(node.key) > foldDistance)
    .map(({ key }) => key));
}

/**
 * Group foldable nodes into fold units.
 *
 * `byComponent` groups each weakly connected component of the foldable subgraph
 * into one unit — the compact projection, one node per finished branch.
 * `byComponentAndWave` additionally splits each component per dependency wave.
 * The latter is always acyclic once contracted (every dependency edge strictly
 * increases the wave, so contracted edges do too), which makes it the
 * guaranteed-safe refinement when contraction would otherwise close a cycle.
 */
function groupFoldable(nodes, edges, foldable, wave, splitByWave) {
  const parent = new Map([...foldable].map((key) => [key, key]));
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (compareText(leftRoot, rightRoot) <= 0) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  for (const edge of edges) {
    if (!foldable.has(edge.from) || !foldable.has(edge.to)) continue;
    // A fold unit never spans plans: the diagram groups by plan and a unit that
    // straddled two plans would have no honest lane to sit in.
    if (nodeByKey.get(edge.from).ref.plan_key !== nodeByKey.get(edge.to).ref.plan_key) continue;
    union(edge.from, edge.to);
  }

  const unitByNode = new Map();
  const members = new Map();
  for (const key of [...foldable].sort(compareText)) {
    const unitKey = splitByWave
      ? JSON.stringify([find(key), wave.get(key)])
      : JSON.stringify([find(key), null]);
    unitByNode.set(key, unitKey);
    if (!members.has(unitKey)) members.set(unitKey, []);
    members.get(unitKey).push(key);
  }
  return { unitByNode, members };
}

function dominantLane(memberNodes) {
  const counts = new Map();
  for (const node of memberNodes) counts.set(node.lane, (counts.get(node.lane) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([leftLane, leftCount], [rightLane, rightCount]) => rightCount - leftCount
      || compareText(leftLane, rightLane))[0][0];
}

function buildSummaryNodes(nodes, members, longestChainKeys) {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  // Order fold units by their first member so synthetic ids are stable across runs.
  const ordered = [...members.entries()]
    .map(([unitKey, memberKeys]) => ({ unitKey, memberKeys: [...memberKeys].sort(compareText) }))
    .sort((left, right) => compareText(left.memberKeys[0], right.memberKeys[0]));

  const summaryByUnit = new Map();
  ordered.forEach((unit, index) => {
    const memberNodes = unit.memberKeys.map((key) => nodeByKey.get(key));
    const { plan_key: planKey, project_id: projectId } = memberNodes[0].ref;
    const ref = { project_id: projectId, plan_key: planKey, task_id: `${FOLD_TASK_ID_PREFIX}:${index}` };
    const key = JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
    const lanes = [...new Set(memberNodes.map((node) => node.lane))].sort(compareText);
    summaryByUnit.set(unit.unitKey, {
      key,
      ref,
      title: `完了済み ${memberNodes.length}件`,
      lane: dominantLane(memberNodes),
      status: 'done',
      plan_schema: memberNodes[0].plan_schema,
      phase_id: null,
      phase_status: null,
      phase_ready: false,
      fold: {
        task_count: memberNodes.length,
        lanes,
        longest_chain_task_count: memberNodes
          .filter((node) => longestChainKeys.has(node.key)).length,
        task_refs: memberNodes.map((node) => ({ ...node.ref })),
      },
    });
  });
  return summaryByUnit;
}

function contract(nodes, edges, unitByNode, summaryByUnit) {
  const mapKey = (key) => {
    const unitKey = unitByNode.get(key);
    return unitKey === undefined ? key : summaryByUnit.get(unitKey).key;
  };
  const keptNodes = nodes.filter((node) => !unitByNode.has(node.key));
  const summaries = [...summaryByUnit.values()];
  const resultNodes = [...keptNodes, ...summaries]
    .sort((left, right) => compareText(left.key, right.key));

  const contracted = new Map();
  for (const edge of edges) {
    const from = mapKey(edge.from);
    const to = mapKey(edge.to);
    if (from === to) continue; // interior of a fold unit
    const key = JSON.stringify([from, to]);
    let merged = contracted.get(key);
    if (merged === undefined) {
      // A rewired edge is an aggregate. Join identity describes how several
      // premises meet at one ToDo; carrying it onto an aggregate edge would
      // draw a junction marker for a join whose members are no longer on
      // screen, so aggregates keep only the dependency kinds.
      merged = { key, from, to, kinds: new Set(), joinIdentities: new Map(), aggregated: false };
      contracted.set(key, merged);
    }
    for (const kind of edge.kinds) merged.kinds.add(kind);
    if (from === edge.from && to === edge.to) {
      for (const [identityKey, identity] of edge.joinIdentities) {
        merged.joinIdentities.set(identityKey, identity);
      }
    } else {
      merged.aggregated = true;
    }
  }
  for (const edge of contracted.values()) {
    if (edge.aggregated) edge.joinIdentities = new Map();
  }
  const resultEdges = [...contracted.values()].sort((left, right) => compareText(left.key, right.key));
  return { nodes: resultNodes, edges: resultEdges };
}

/** Kahn peel; returns true when the graph is acyclic. */
function isAcyclic(nodes, edges) {
  const indegree = new Map(nodes.map(({ key }) => [key, 0]));
  const outgoing = new Map(nodes.map(({ key }) => [key, []]));
  for (const edge of edges) {
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const ready = nodes.filter(({ key }) => indegree.get(key) === 0).map(({ key }) => key);
  let visited = 0;
  while (ready.length > 0) {
    const current = ready.pop();
    visited += 1;
    for (const next of outgoing.get(current)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  return visited === nodes.length;
}

/**
 * Project the full dependency graph onto the `live` scope.
 *
 * Contracting a weakly connected component can close a cycle: with a fold
 * distance of 1 the shape `f1 -> s -> f2` is reachable, where `s` is a
 * completed ToDo kept as the direct premise of live work and `f1`/`f2` belong
 * to the same fold unit. Contracting that unit would produce
 * `summary -> s -> summary`. So the contraction is verified, and on a cycle the
 * grouping is refined to (component, wave) — provably acyclic, because every
 * dependency edge strictly increases the wave.
 *
 * @returns {{nodes: Array, edges: Array, foldedByKey: Map, folds: Array, refined: boolean}}
 */
export function projectTodoGanttScope({
  nodes, edges, wave, longestChainKeys = new Set(), foldDistance = DEFAULT_FOLD_DISTANCE,
}) {
  const distance = distanceToLive(nodes, edges, wave);
  const foldable = foldableKeys(nodes, distance, foldDistance);
  if (foldable.size === 0) {
    return { nodes, edges, foldedByKey: new Map(), folds: [], refined: false };
  }

  let refined = false;
  let grouping = groupFoldable(nodes, edges, foldable, wave, false);
  let summaryByUnit = buildSummaryNodes(nodes, grouping.members, longestChainKeys);
  let contracted = contract(nodes, edges, grouping.unitByNode, summaryByUnit);
  if (!isAcyclic(contracted.nodes, contracted.edges)) {
    refined = true;
    grouping = groupFoldable(nodes, edges, foldable, wave, true);
    summaryByUnit = buildSummaryNodes(nodes, grouping.members, longestChainKeys);
    contracted = contract(nodes, edges, grouping.unitByNode, summaryByUnit);
    if (!isAcyclic(contracted.nodes, contracted.edges)) {
      throw new TodoGanttScopeError('TODO_SCOPE_CONTRACTION_CYCLIC',
        'todo gantt scope contraction produced a cycle after per-wave refinement',
        { fold_unit_count: grouping.members.size });
    }
  }

  const foldedByKey = new Map();
  for (const [nodeKey, unitKey] of grouping.unitByNode) {
    foldedByKey.set(nodeKey, summaryByUnit.get(unitKey).key);
  }
  const folds = [...summaryByUnit.values()]
    .sort((left, right) => compareText(left.key, right.key))
    .map((summary) => ({ ref: { ...summary.ref }, ...summary.fold }));

  return { nodes: contracted.nodes, edges: contracted.edges, foldedByKey, folds, refined };
}
