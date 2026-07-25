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
 * to any live work is history, and history collapses into as few labelled nodes
 * as the graph allows — one per plan when nothing forbids it. Completed ToDos
 * that are still the direct premise of live work stay visible, because they are
 * the context for what is dispatchable right now.
 *
 * Grouping by connectivity was tried first and does not compress real plans: a
 * store whose finished ToDos rarely declare dependencies on each other yields
 * one fold unit per ToDo, which draws the same number of boxes as no folding at
 * all while hiding every title. History is grouped by the plan it belongs to,
 * not by whether its members happen to be wired together.
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
 * Grouping strategies, coarsest first. The projection takes the first one whose
 * contraction stays acyclic.
 *
 * - `plan`: one fold unit per plan. All history of a finished plan becomes one
 *   node. This is the target shape and it is what a reader wants to see.
 * - `plan_stage`: additionally split per kept-node depth. A cycle can only close
 *   through a node kept on screen, and that axis is exactly what `keptDepth`
 *   measures, so this is the smallest refinement that removes the usual cause.
 * - `plan_wave`: additionally split per dependency wave. Provably acyclic —
 *   every dependency edge strictly increases the wave, so a contracted edge
 *   between two units always increases it too and no cycle can exist.
 */
const GROUPING_LADDER = Object.freeze(['plan', 'plan_stage', 'plan_wave']);

/**
 * Number of kept (non-foldable) nodes lying before each node on the longest
 * path. Crossing a kept node strictly increases it; edges between two foldable
 * nodes leave it unchanged.
 *
 * Edges always increase the wave (`assignWaves` is a longest-path layering), so
 * visiting nodes in ascending wave order settles every predecessor first.
 */
function keptDepth(nodes, edges, foldable, wave) {
  const incoming = new Map(nodes.map(({ key }) => [key, []]));
  for (const edge of edges) incoming.get(edge.to).push(edge.from);
  const depth = new Map();
  const ordered = [...nodes].sort((left, right) => wave.get(left.key) - wave.get(right.key)
    || compareText(left.key, right.key));
  for (const node of ordered) {
    let best = 0;
    for (const predecessor of incoming.get(node.key)) {
      const settled = depth.get(predecessor);
      if (settled === undefined) continue;
      const candidate = settled + (foldable.has(predecessor) ? 0 : 1);
      if (candidate > best) best = candidate;
    }
    depth.set(node.key, best);
  }
  return depth;
}

/** Group foldable nodes into fold units under one of `GROUPING_LADDER`. */
function groupFoldable(nodes, foldable, strategy, axes) {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  // A fold unit never spans plans: the diagram groups by plan and a unit that
  // straddled two plans would have no honest lane to sit in.
  const axisOf = (key) => (strategy === 'plan' ? null
    : strategy === 'plan_stage' ? axes.stage.get(key)
      : axes.wave.get(key));
  const unitByNode = new Map();
  const members = new Map();
  for (const key of [...foldable].sort(compareText)) {
    const unitKey = JSON.stringify([nodeByKey.get(key).ref.plan_key, axisOf(key)]);
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
 * Contraction can close a cycle: with a fold distance of 1 the shape
 * `f1 -> s -> f2` is reachable, where `s` is a completed ToDo kept as the direct
 * premise of live work and `f1`/`f2` land in the same fold unit. Contracting
 * that unit would produce `summary -> s -> summary`. So each candidate grouping
 * is verified and the coarsest acyclic one wins. The last rung is provably
 * acyclic, so the throw below is a backstop, never a routine outcome.
 *
 * @returns {{nodes: Array, edges: Array, foldedByKey: Map, folds: Array, grouping: string}}
 */
export function projectTodoGanttScope({
  nodes, edges, wave, longestChainKeys = new Set(), foldDistance = DEFAULT_FOLD_DISTANCE,
}) {
  const distance = distanceToLive(nodes, edges, wave);
  const foldable = foldableKeys(nodes, distance, foldDistance);
  if (foldable.size === 0) {
    return { nodes, edges, foldedByKey: new Map(), folds: [], grouping: null };
  }

  const axes = { wave, stage: keptDepth(nodes, edges, foldable, wave) };
  let selected = null;
  for (const strategy of GROUPING_LADDER) {
    const grouping = groupFoldable(nodes, foldable, strategy, axes);
    const summaryByUnit = buildSummaryNodes(nodes, grouping.members, longestChainKeys);
    const contracted = contract(nodes, edges, grouping.unitByNode, summaryByUnit);
    if (!isAcyclic(contracted.nodes, contracted.edges)) continue;
    selected = { strategy, grouping, summaryByUnit, contracted };
    break;
  }
  if (selected === null) {
    throw new TodoGanttScopeError('TODO_SCOPE_CONTRACTION_CYCLIC',
      'todo gantt scope contraction produced a cycle under every grouping',
      { attempted_groupings: [...GROUPING_LADDER] });
  }
  const { grouping, summaryByUnit, contracted } = selected;

  const foldedByKey = new Map();
  for (const [nodeKey, unitKey] of grouping.unitByNode) {
    foldedByKey.set(nodeKey, summaryByUnit.get(unitKey).key);
  }
  const folds = [...summaryByUnit.values()]
    .sort((left, right) => compareText(left.key, right.key))
    .map((summary) => ({ ref: { ...summary.ref }, ...summary.fold }));

  return {
    nodes: contracted.nodes, edges: contracted.edges, foldedByKey, folds, grouping: selected.strategy,
  };
}
