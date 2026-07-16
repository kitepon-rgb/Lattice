import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { compileBoundaryObservationV2 } from './boundary-observation-compiler-v2.mjs';
import { verifySchedulabilityPlanV2 } from './schedulability-verifier-v2.mjs';

const OBSERVATION_SCHEMA = 'lattice.boundary_observation_set.v2';
const BUNDLE_SCHEMA = 'lattice.normalized_boundary_bundle.v2';
const GRAPH_SCHEMA = 'lattice.normalized_boundary_graph.v2';
const VERDICT_SCHEMA = 'lattice.boundary_verdict.v2';
const MAX_TODOS = 256;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const DIGEST = /^[0-9a-f]{64}$/;

function contractError(reason) {
  throw new TypeError(`artifact contracts v2契約違反: ${reason}`);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requireArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    contractError(`${label}がarrayではない`);
  }
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function boundedText(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, 'utf8') <= 4_096;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function conflictOrder(left, right) {
  return compareText(left.todo_ids[0], right.todo_ids[0])
    || compareText(left.todo_ids[1], right.todo_ids[1])
    || compareText(left.resource_id, right.resource_id);
}

function precedenceOrder(left, right) {
  return compareText(left.from_todo_id, right.from_todo_id)
    || compareText(left.to_todo_id, right.to_todo_id)
    || compareText(left.reason, right.reason);
}

function unknownOrder(left, right) {
  return compareText(left.todo_id, right.todo_id)
    || compareText(left.kind, right.kind)
    || compareText(left.reason, right.reason);
}

function assertAcyclic(todos, precedences) {
  const indegree = new Map(todos.map((todoId) => [todoId, 0]));
  const outgoing = new Map(todos.map((todoId) => [todoId, new Set()]));
  for (const precedence of precedences) {
    const next = outgoing.get(precedence.from_todo_id);
    if (!next.has(precedence.to_todo_id)) {
      next.add(precedence.to_todo_id);
      indegree.set(precedence.to_todo_id, indegree.get(precedence.to_todo_id) + 1);
    }
  }
  const ready = todos.filter((todoId) => indegree.get(todoId) === 0);
  let visited = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const todoId = ready[cursor];
    visited += 1;
    for (const next of outgoing.get(todoId)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (visited !== todos.length) contractError('precedencesにcycleがある');
}

function normalizeGraph(value) {
  if (!exactRecord(value, [
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
  if (value.todos.length < 1
    || value.todos.length > MAX_TODOS
    || !value.todos.every(identifier)
    || new Set(value.todos).size !== value.todos.length) {
    contractError('todosがbounded unique identifier arrayではない');
  }
  const todos = [...value.todos].sort(compareText);
  const todoSet = new Set(todos);
  if (!Number.isSafeInteger(value.capacity)
    || value.capacity < 1
    || value.capacity > MAX_TODOS) {
    contractError('capacityがbounded positive integerではない');
  }

  requireArray(value.conflicts, 'conflicts');
  const conflictKeys = new Set();
  const conflicts = value.conflicts.map((entry) => {
    if (!exactRecord(entry, ['todo_ids', 'resource_id'])) {
      contractError('conflict shapeが不正');
    }
    requireArray(entry.todo_ids, 'conflict.todo_ids');
    if (entry.todo_ids.length !== 2
      || entry.todo_ids.some((todoId) => !todoSet.has(todoId))
      || entry.todo_ids[0] === entry.todo_ids[1]
      || !identifier(entry.resource_id)) {
      contractError('conflict relationが不正');
    }
    const todoIds = [...entry.todo_ids].sort(compareText);
    const key = `${todoIds[0]}\u0000${todoIds[1]}\u0000${entry.resource_id}`;
    if (conflictKeys.has(key)) contractError('conflictが重複している');
    conflictKeys.add(key);
    return { todo_ids: todoIds, resource_id: entry.resource_id };
  }).sort(conflictOrder);

  requireArray(value.precedences, 'precedences');
  const precedenceKeys = new Set();
  const precedences = value.precedences.map((entry) => {
    if (!exactRecord(entry, ['from_todo_id', 'to_todo_id', 'reason'])
      || !todoSet.has(entry.from_todo_id)
      || !todoSet.has(entry.to_todo_id)
      || entry.from_todo_id === entry.to_todo_id
      || !boundedText(entry.reason)) {
      contractError('precedence relationが不正');
    }
    const key = `${entry.from_todo_id}\u0000${entry.to_todo_id}\u0000${entry.reason}`;
    if (precedenceKeys.has(key)) contractError('precedenceが重複している');
    precedenceKeys.add(key);
    return {
      from_todo_id: entry.from_todo_id,
      to_todo_id: entry.to_todo_id,
      reason: entry.reason,
    };
  }).sort(precedenceOrder);
  assertAcyclic(todos, precedences);

  requireArray(value.unknowns, 'unknowns');
  const unknownKeys = new Set();
  const unknowns = value.unknowns.map((entry) => {
    if (!exactRecord(entry, ['todo_id', 'kind', 'reason'])
      || !todoSet.has(entry.todo_id)
      || !identifier(entry.kind)
      || !boundedText(entry.reason)) {
      contractError('unknown relationが不正');
    }
    const key = `${entry.todo_id}\u0000${entry.kind}\u0000${entry.reason}`;
    if (unknownKeys.has(key)) contractError('unknownが重複している');
    unknownKeys.add(key);
    return { todo_id: entry.todo_id, kind: entry.kind, reason: entry.reason };
  }).sort(unknownOrder);

  return {
    schema_version: GRAPH_SCHEMA,
    todos,
    conflicts,
    precedences,
    unknowns,
    capacity: value.capacity,
  };
}

function canonicalGraph(value) {
  const normalized = normalizeGraph(value);
  if (!isDeepStrictEqual(value, normalized)) contractError('normalized graphがcanonicalではない');
  return normalized;
}

function graphDigest(graph) {
  return sha256(JSON.stringify(graph));
}

function pairwiseVerdicts(graph) {
  return [
    ...graph.conflicts.map((conflict) => ({
      type: 'conflict',
      todo_ids: [...conflict.todo_ids],
      resource_id: conflict.resource_id,
    })),
    ...graph.precedences.map((precedence) => ({
      type: 'precedence',
      from_todo_id: precedence.from_todo_id,
      to_todo_id: precedence.to_todo_id,
      reason: precedence.reason,
    })),
  ];
}

function observationResource(resource) {
  if (!exactRecord(resource, [
    'resource_id',
    'kind',
    'target',
    'todo_ids',
    'provenance',
    'status',
  ]) || (resource.status !== 'observed' && resource.status !== 'unknown')) {
    contractError('normalized resource shapeが不正');
  }
  return {
    resource_id: resource.resource_id,
    kind: resource.kind,
    target: resource.target,
    todo_ids: resource.todo_ids,
    provenance: resource.provenance,
  };
}

function validateSafely(callback) {
  try {
    return callback() === true;
  } catch {
    return false;
  }
}

/** @param {unknown} graph @returns {boolean} */
export function validateNormalizedBoundaryGraphV2(graph) {
  return validateSafely(() => {
    canonicalGraph(graph);
    return true;
  });
}

/** @param {unknown} bundle @returns {boolean} */
export function validateNormalizedBoundaryBundleV2(bundle) {
  return validateSafely(() => {
    if (!exactRecord(bundle, [
      'schema_version',
      'source',
      'resources',
      'precedences',
      'graph',
      'graph_digest',
    ]) || bundle.schema_version !== BUNDLE_SCHEMA
      || typeof bundle.graph_digest !== 'string'
      || !DIGEST.test(bundle.graph_digest)) {
      return false;
    }
    const graph = canonicalGraph(bundle.graph);
    requireArray(bundle.resources, 'resources');
    requireArray(bundle.precedences, 'precedences');
    const observationSet = {
      schema_version: OBSERVATION_SCHEMA,
      source: bundle.source,
      capacity: graph.capacity,
      todos: graph.todos,
      resources: bundle.resources.map(observationResource),
      precedences: bundle.precedences,
    };
    const recompiled = compileBoundaryObservationV2(observationSet);
    return isDeepStrictEqual(bundle, recompiled);
  });
}

/**
 * @param {unknown} verdict
 * @param {unknown} graph
 * @returns {boolean}
 */
export function validateBoundaryVerdictV2(verdict, graph) {
  return validateSafely(() => {
    const normalizedGraph = canonicalGraph(graph);
    if (!exactRecord(verdict, [
      'schema_version',
      'normalized_graph_digest',
      'verdicts',
    ]) || verdict.schema_version !== VERDICT_SCHEMA
      || typeof verdict.normalized_graph_digest !== 'string'
      || !DIGEST.test(verdict.normalized_graph_digest)
      || verdict.normalized_graph_digest !== graphDigest(normalizedGraph)) {
      return false;
    }
    requireArray(verdict.verdicts, 'verdicts');
    return isDeepStrictEqual(verdict.verdicts, pairwiseVerdicts(normalizedGraph));
  });
}

/**
 * @param {unknown} plan
 * @param {unknown} graph
 * @param {unknown} options
 * @returns {boolean}
 */
export function validatePlanGraphV2(plan, graph, options = {}) {
  return validateSafely(() => {
    const normalizedGraph = canonicalGraph(graph);
    const result = verifySchedulabilityPlanV2(normalizedGraph, plan, options);
    return result.outcome === 'verified'
      && plainRecord(plan)
      && result.minimum_feasible_waves === plan.minimum_feasible_waves;
  });
}
