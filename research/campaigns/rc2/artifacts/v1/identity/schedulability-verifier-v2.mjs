const GRAPH_SCHEMA = 'lattice.normalized_boundary_graph.v2';
const PLAN_SCHEMA = 'lattice.plan_graph.v2';
const MAX_TODOS = 8;
const MAX_INPUT_TODOS = 256;
const DEFAULT_MAX_SEARCH_STATES = 2_000_000;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;

function contractError(reason) {
  throw new TypeError(`schedulability verifier v2契約違反: ${reason}`);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const found = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return found.length === wanted.length
    && found.every((key, index) => key === wanted[index]);
}

function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function validReason(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, 'utf8') <= 4_096;
}

function textOrder(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    contractError(`${label}がarrayではない`);
  }
}

function verifierOptions(options) {
  if (!hasOnlyKeys(options, []) && !hasOnlyKeys(options, ['maxSearchStates'])) {
    contractError('options shapeが不正');
  }
  const limit = options.maxSearchStates ?? DEFAULT_MAX_SEARCH_STATES;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    contractError('maxSearchStatesがnon-negative safe integerではない');
  }
  return { limit };
}

function requireDag(todoIds, precedences) {
  const incoming = new Map(todoIds.map((todoId) => [todoId, 0]));
  const nextByTodo = new Map(todoIds.map((todoId) => [todoId, new Set()]));
  for (const edge of precedences) {
    const next = nextByTodo.get(edge.from);
    if (!next.has(edge.to)) {
      next.add(edge.to);
      incoming.set(edge.to, incoming.get(edge.to) + 1);
    }
  }
  const queue = todoIds.filter((todoId) => incoming.get(todoId) === 0);
  let removed = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const todoId = queue[cursor];
    removed += 1;
    for (const next of nextByTodo.get(todoId)) {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  if (removed !== todoIds.length) contractError('precedencesにcycleがある');
}

function verifierGraph(value) {
  if (!hasOnlyKeys(value, [
    'schema_version',
    'todos',
    'conflicts',
    'precedences',
    'unknowns',
    'capacity',
  ]) || value.schema_version !== GRAPH_SCHEMA) {
    contractError('normalized graph shapeまたはschema_versionが不正');
  }

  requireArray(value.todos, 'todos');
  if (value.todos.length < 1 || value.todos.length > MAX_INPUT_TODOS
    || !value.todos.every(validIdentifier)
    || new Set(value.todos).size !== value.todos.length) {
    contractError('todosがbounded unique identifier arrayではない');
  }
  const todoIds = [...value.todos].sort(textOrder);
  const knownTodos = new Set(todoIds);
  if (!Number.isSafeInteger(value.capacity)
    || value.capacity < 1
    || value.capacity > MAX_INPUT_TODOS) {
    contractError('capacityがbounded positive integerではない');
  }

  requireArray(value.conflicts, 'conflicts');
  const seenConflicts = new Set();
  const conflicts = value.conflicts.map((item) => {
    if (!hasOnlyKeys(item, ['todo_ids', 'resource_id'])) {
      contractError('conflict shapeが不正');
    }
    requireArray(item.todo_ids, 'conflict.todo_ids');
    if (item.todo_ids.length !== 2
      || !item.todo_ids.every((todoId) => knownTodos.has(todoId))
      || item.todo_ids[0] === item.todo_ids[1]
      || !validIdentifier(item.resource_id)) {
      contractError('conflict relationが不正');
    }
    const pair = [...item.todo_ids].sort(textOrder);
    const key = `${pair[0]}\u0000${pair[1]}\u0000${item.resource_id}`;
    if (seenConflicts.has(key)) contractError('duplicate conflictがある');
    seenConflicts.add(key);
    return { left: pair[0], right: pair[1] };
  });

  requireArray(value.precedences, 'precedences');
  const seenPrecedences = new Set();
  const precedences = value.precedences.map((item) => {
    if (!hasOnlyKeys(item, ['from_todo_id', 'to_todo_id', 'reason'])
      || !knownTodos.has(item.from_todo_id)
      || !knownTodos.has(item.to_todo_id)
      || item.from_todo_id === item.to_todo_id
      || !validReason(item.reason)) {
      contractError('precedence relationが不正');
    }
    const key = `${item.from_todo_id}\u0000${item.to_todo_id}\u0000${item.reason}`;
    if (seenPrecedences.has(key)) contractError('duplicate precedenceがある');
    seenPrecedences.add(key);
    return { from: item.from_todo_id, to: item.to_todo_id };
  });
  requireDag(todoIds, precedences);

  requireArray(value.unknowns, 'unknowns');
  const seenUnknowns = new Set();
  const unknowns = value.unknowns.map((item) => {
    if (!hasOnlyKeys(item, ['todo_id', 'kind', 'reason'])
      || !knownTodos.has(item.todo_id)
      || !validIdentifier(item.kind)
      || !validReason(item.reason)) {
      contractError('unknown relationが不正');
    }
    const key = `${item.todo_id}\u0000${item.kind}\u0000${item.reason}`;
    if (seenUnknowns.has(key)) contractError('duplicate unknownがある');
    seenUnknowns.add(key);
    return { todoId: item.todo_id };
  });

  return { todoIds, knownTodos, conflicts, precedences, unknowns, capacity: value.capacity };
}

function rejected(code, extra = {}) {
  return { outcome: 'rejected', code, ...extra };
}

function inspectPlan(value, graph) {
  if (!hasOnlyKeys(value, ['schema_version', 'waves', 'minimum_feasible_waves'])
    || value.schema_version !== PLAN_SCHEMA
    || !Number.isSafeInteger(value.minimum_feasible_waves)
    || value.minimum_feasible_waves < 1) {
    return { result: rejected('PLAN_SCHEMA_INVALID') };
  }
  if (!Array.isArray(value.waves)
    || Object.getPrototypeOf(value.waves) !== Array.prototype
    || value.waves.length < 1
    || value.waves.length > graph.todoIds.length) {
    return { result: rejected('PLAN_SCHEMA_INVALID') };
  }
  if (value.minimum_feasible_waves !== value.waves.length) {
    return { result: rejected('MINIMUM_CLAIM_MISMATCH') };
  }

  const waveByTodo = new Map();
  for (let waveIndex = 0; waveIndex < value.waves.length; waveIndex += 1) {
    const wave = value.waves[waveIndex];
    if (!hasOnlyKeys(wave, ['todo_ids'])
      || !Array.isArray(wave.todo_ids)
      || Object.getPrototypeOf(wave.todo_ids) !== Array.prototype
      || wave.todo_ids.length < 1
      || !wave.todo_ids.every(validIdentifier)) {
      return { result: rejected('PLAN_SCHEMA_INVALID') };
    }
    if (wave.todo_ids.length > graph.capacity) {
      return { result: rejected('CAPACITY_EXCEEDED') };
    }
    for (const todoId of wave.todo_ids) {
      if (!graph.knownTodos.has(todoId)) return { result: rejected('TODO_UNKNOWN') };
      if (waveByTodo.has(todoId)) return { result: rejected('TODO_DUPLICATED') };
      waveByTodo.set(todoId, waveIndex);
    }
  }
  if (waveByTodo.size !== graph.todoIds.length) {
    return { result: rejected('TODO_MISSING') };
  }
  for (const conflict of graph.conflicts) {
    if (waveByTodo.get(conflict.left) === waveByTodo.get(conflict.right)) {
      return { result: rejected('CONFLICT_COLOCATED') };
    }
  }
  for (const precedence of graph.precedences) {
    if (waveByTodo.get(precedence.from) >= waveByTodo.get(precedence.to)) {
      return { result: rejected('PRECEDENCE_VIOLATION') };
    }
  }
  return { waveCount: value.waves.length };
}

function assignmentSatisfies(graph, assignment, positionByTodo) {
  const occupancy = new Map();
  for (const waveIndex of assignment) {
    const count = (occupancy.get(waveIndex) ?? 0) + 1;
    if (count > graph.capacity) return false;
    occupancy.set(waveIndex, count);
  }
  for (const edge of graph.conflicts) {
    if (assignment[positionByTodo.get(edge.left)]
      === assignment[positionByTodo.get(edge.right)]) {
      return false;
    }
  }
  for (const edge of graph.precedences) {
    if (assignment[positionByTodo.get(edge.from)]
      >= assignment[positionByTodo.get(edge.to)]) {
      return false;
    }
  }
  return true;
}

function shorterSchedule(graph, upperExclusive, budget) {
  const assignment = new Array(graph.todoIds.length).fill(0);
  const positionByTodo = new Map(graph.todoIds.map((todoId, index) => [todoId, index]));

  for (let waveCount = 1; waveCount < upperExclusive; waveCount += 1) {
    const occupancy = new Array(waveCount).fill(0);
    let answer = false;
    let ranOut = false;

    const enumerate = (todoIndex, occupiedWaves) => {
      if (answer || ranOut) return;
      if (todoIndex === graph.todoIds.length) {
        if (occupiedWaves !== waveCount) return;
        if (budget.examined >= budget.limit) {
          ranOut = true;
          return;
        }
        budget.examined += 1;
        answer = assignmentSatisfies(graph, assignment, positionByTodo);
        return;
      }

      const unassignedAfter = graph.todoIds.length - todoIndex - 1;
      for (let candidateWave = 0; candidateWave < waveCount; candidateWave += 1) {
        const opensWave = occupancy[candidateWave] === 0;
        const nextOccupied = occupiedWaves + (opensWave ? 1 : 0);
        if (waveCount - nextOccupied > unassignedAfter) continue;
        assignment[todoIndex] = candidateWave;
        occupancy[candidateWave] += 1;
        enumerate(todoIndex + 1, nextOccupied);
        occupancy[candidateWave] -= 1;
        if (answer || ranOut) return;
      }
    };

    enumerate(0, 0);
    if (ranOut) return { state: 'exhausted' };
    if (answer) return { state: 'found', waveCount };
  }
  return { state: 'none' };
}

/**
 * Producerを呼ばず、保存graphからplanのfeasibilityとminimumを再計算する。
 * @param {unknown} normalizedGraph
 * @param {unknown} plan
 * @param {unknown} options
 * @returns {object}
 */
export function verifySchedulabilityPlanV2(normalizedGraph, plan, options = {}) {
  const graph = verifierGraph(normalizedGraph);
  const { limit } = verifierOptions(options);

  if (graph.todoIds.length > MAX_TODOS) {
    return { outcome: 'unsupported', code: 'NODE_LIMIT_EXCEEDED' };
  }
  if (graph.unknowns.length > 0) {
    return { outcome: 'unknown', code: 'BOUNDARY_UNKNOWN' };
  }

  const inspected = inspectPlan(plan, graph);
  if (inspected.result !== undefined) return inspected.result;

  const shorter = shorterSchedule(graph, inspected.waveCount, { limit, examined: 0 });
  if (shorter.state === 'exhausted') {
    return { outcome: 'unsupported', code: 'SEARCH_BUDGET_EXHAUSTED' };
  }
  if (shorter.state === 'found') {
    return rejected('NON_MINIMUM_SCHEDULE', {
      minimum_feasible_waves: shorter.waveCount,
    });
  }
  return {
    outcome: 'verified',
    minimum_feasible_waves: inspected.waveCount,
  };
}
