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
 * The rule is "drop the dead branches": a completed ToDo that no longer leads
 * to any live work is history, and history leaves the diagram entirely.
 * Completed ToDos that are still the direct premise of live work stay visible,
 * because they are the context for what is dispatchable right now.
 *
 * Summarising history into placeholder nodes was tried and is worse than
 * drawing nothing: a summary box still occupies a column, so the diagram stays
 * as wide as the finished plans ever made it while saying nothing a reader
 * acts on. The count belongs in the legend and the ToDos themselves belong in
 * the task index; neither needs floor space in the graph.
 *
 * This module is pure graph math over the layout's internal node/edge shape.
 * It must run AFTER dependency waves, the longest dependency chain and the
 * ready frontier have been computed on the FULL graph — those numbers describe
 * the real plan, and measuring them on a narrowed graph would make them lie.
 */

export const TODO_GANTT_SCOPES = Object.freeze(['live', 'all']);

/**
 * Hops of completed predecessors kept in front of live work. 1 = keep the
 * direct premises of live ToDos, drop everything upstream of them.
 */
export const DEFAULT_FOLD_DISTANCE = 1;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

/**
 * Project the full dependency graph onto the `live` scope.
 *
 * Removing nodes from a DAG cannot create a cycle, so the narrowed graph needs
 * no verification: what is left is a subgraph of what was already acyclic.
 *
 * @returns {{nodes: Array, edges: Array, foldedKeys: Set<string>}}
 */
export function projectTodoGanttScope({
  nodes, edges, wave, foldDistance = DEFAULT_FOLD_DISTANCE,
}) {
  const distance = distanceToLive(nodes, edges, wave);
  const foldedKeys = new Set(nodes
    .filter((node) => node.status === 'done' && distance.get(node.key) > foldDistance)
    .map(({ key }) => key));
  if (foldedKeys.size === 0) return { nodes, edges, foldedKeys };
  return {
    nodes: nodes.filter((node) => !foldedKeys.has(node.key)),
    // An edge with a dropped endpoint goes with it. The kept node keeps its
    // real premises in the right pane, which reads the full graph.
    edges: edges.filter((edge) => !foldedKeys.has(edge.from) && !foldedKeys.has(edge.to)),
    foldedKeys,
  };
}
