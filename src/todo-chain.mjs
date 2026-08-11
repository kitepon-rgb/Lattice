import { analyzeDagChains, DagCycleError } from './dag-chain.mjs';

const ASSUMPTIONS = Object.freeze({
  unit_duration: true,
  capacity_ignored: true,
  conflict_ignored: true,
});

export class TodoChainProjectionError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'TodoChainProjectionError';
    this.code = code;
  }
}

export class TodoChainCycleError extends TodoChainProjectionError {
  constructor(options) {
    super('TODO_CHAIN_CYCLE', 'merged todo topology contains a cycle', options);
    this.name = 'TodoChainCycleError';
  }
}

function fail(code, message) {
  throw new TodoChainProjectionError(code, message);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeNodeRef(value, context) {
  if (!isPlainObject(value)) fail('TODO_CHAIN_INVALID_TOPOLOGY', `${context} must be a node ref`);
  const { project_id: projectId, plan_key: planKey, task_id: taskId } = value;
  if (typeof projectId !== 'string' || typeof planKey !== 'string' || typeof taskId !== 'string') {
    fail('TODO_CHAIN_INVALID_TOPOLOGY', `${context} node ref fields must be strings`);
  }
  return { project_id: projectId, plan_key: planKey, task_id: taskId };
}

function nodeKey(ref) {
  return JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
}

function compareRefs(left, right) {
  for (const field of ['project_id', 'plan_key', 'task_id']) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
}

function requireArray(value, context) {
  if (!Array.isArray(value)) fail('TODO_CHAIN_INVALID_TOPOLOGY', `${context} must be an array`);
  return value;
}

function normalizeOptions(options) {
  if (options === undefined) options = {};
  if (!isPlainObject(options)) {
    fail('TODO_CHAIN_INVALID_OPTIONS', 'options must be an object');
  }
  const allowedKeys = new Set(['countCap', 'representativeLimit']);
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      fail('TODO_CHAIN_INVALID_OPTIONS', `unknown option: ${String(key)}`);
    }
  }

  const countCap = Object.hasOwn(options, 'countCap') ? options.countCap : 1_000_000;
  const representativeLimit = Object.hasOwn(options, 'representativeLimit')
    ? options.representativeLimit
    : 8;
  if (!Number.isSafeInteger(countCap) || countCap < 1 || countCap >= Number.MAX_SAFE_INTEGER) {
    fail(
      'TODO_CHAIN_INVALID_OPTIONS',
      'countCap must be a safe integer from 1 through Number.MAX_SAFE_INTEGER - 1',
    );
  }
  if (
    !Number.isSafeInteger(representativeLimit)
    || representativeLimit < 0
    || representativeLimit > 8
  ) {
    fail('TODO_CHAIN_INVALID_OPTIONS', 'representativeLimit must be a safe integer from 0 through 8');
  }
  return { countCap, representativeLimit };
}

function normalizeTodoTopology(mergedTodoTopology) {
  if (!isPlainObject(mergedTodoTopology)) {
    fail('TODO_CHAIN_INVALID_TOPOLOGY', 'mergedTodoTopology must be an object');
  }

  const nodes = requireArray(mergedTodoTopology.nodes, 'nodes');
  const hardEdges = requireArray(mergedTodoTopology.hard_edges, 'hard_edges');
  const joins = requireArray(mergedTodoTopology.joins, 'joins');
  const refsByKey = new Map();

  for (let index = 0; index < nodes.length; index += 1) {
    const ref = normalizeNodeRef(nodes[index], `nodes[${index}]`);
    const key = nodeKey(ref);
    if (refsByKey.has(key)) fail('TODO_CHAIN_DUPLICATE_NODE', `duplicate node ref at nodes[${index}]`);
    refsByKey.set(key, ref);
  }

  const edgeKeys = new Set();
  const edges = [];
  const addEdge = (fromValue, toValue, context) => {
    const fromRef = normalizeNodeRef(fromValue, `${context}.from`);
    const toRef = normalizeNodeRef(toValue, `${context}.to`);
    const from = nodeKey(fromRef);
    const to = nodeKey(toRef);
    if (!refsByKey.has(from) || !refsByKey.has(to)) {
      fail('TODO_CHAIN_DANGLING_EDGE', `${context} references a node absent from nodes`);
    }
    const edgeKey = JSON.stringify([from, to]);
    if (edgeKeys.has(edgeKey)) return;
    edgeKeys.add(edgeKey);
    edges.push([from, to]);
  };

  for (let index = 0; index < hardEdges.length; index += 1) {
    const edge = hardEdges[index];
    if (!isPlainObject(edge)) fail('TODO_CHAIN_INVALID_TOPOLOGY', `hard_edges[${index}] must be an object`);
    addEdge(edge.from, edge.to, `hard_edges[${index}]`);
  }

  for (let joinIndex = 0; joinIndex < joins.length; joinIndex += 1) {
    const join = joins[joinIndex];
    if (!isPlainObject(join)) fail('TODO_CHAIN_INVALID_TOPOLOGY', `joins[${joinIndex}] must be an object`);
    const after = requireArray(join.after, `joins[${joinIndex}].after`);
    for (let afterIndex = 0; afterIndex < after.length; afterIndex += 1) {
      addEdge(
        after[afterIndex],
        join.before,
        `joins[${joinIndex}].after[${afterIndex}]`,
      );
    }
  }
  return { refsByKey, edges };
}

/** structure等の消費側が同じToDo node／edge正本を使うためのlossless投影。 */
export function projectTodoTopologyDagV1(mergedTodoTopology) {
  const { refsByKey, edges } = normalizeTodoTopology(mergedTodoTopology);
  return {
    nodes: [...refsByKey].map(([key, ref]) => ({ key, ref: { ...ref } })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

export function projectTodoChainV1(
  mergedTodoTopology,
  options,
) {
  const { countCap, representativeLimit } = normalizeOptions(options);
  const { refsByKey, edges } = normalizeTodoTopology(mergedTodoTopology);

  let analysis;
  try {
    analysis = analyzeDagChains([...refsByKey.keys()], edges, {
      countCap,
      representativeLimit,
      compare: (left, right) => compareRefs(refsByKey.get(left), refsByKey.get(right)),
    });
  } catch (error) {
    if (error instanceof DagCycleError) throw new TodoChainCycleError({ cause: error });
    throw error;
  }

  const toRef = (key) => ({ ...refsByKey.get(key) });
  return {
    schema: 'lattice.todo_chain.v1',
    maximum_dependency_depth: analysis.maximumDepth,
    longest_chain_node_refs: analysis.longestChainNodes.map(toRef),
    longest_chain_edges: analysis.longestChainEdges.map(([from, to]) => ({
      from: toRef(from),
      to: toRef(to),
    })),
    longest_chain_count: analysis.longestChainCount,
    limits: {
      count_cap: countCap,
      representative_limit: representativeLimit,
    },
    representative_chains: analysis.representativeChains.map((chain) => chain.map(toRef)),
    assumptions: { ...ASSUMPTIONS },
  };
}
