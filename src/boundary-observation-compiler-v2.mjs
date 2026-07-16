import { createHash } from 'node:crypto';

const OBSERVATION_SCHEMA = 'lattice.boundary_observation_set.v2';
const BUNDLE_SCHEMA = 'lattice.normalized_boundary_bundle.v2';
const GRAPH_SCHEMA = 'lattice.normalized_boundary_graph.v2';
const MAX_TODOS = 256;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RESOURCE_KINDS = new Set(['symbol', 'path', 'state', 'effect', 'dynamic']);
const PROVENANCE_SOURCES = new Set([
  'codegraph',
  'manual_candidate_spec',
  'manual_state_effect',
]);
const CODEGRAPH_STATUSES = new Set([
  'ready',
  'symbol_absent',
  'empty',
  'unresolved',
  'command_failure',
  'invalid_json',
  'stale',
  'unsupported',
]);

function fail(reason) {
  throw new TypeError(`boundary observation compiler v2契約違反: ${reason}`);
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
    fail(`${label}がarrayではない`);
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

function normalizeSource(value) {
  if (!exactRecord(value, [
    'snapshot_digest',
    'candidate_witness_digest',
    'query_set_digest',
    'manual_evidence_digest',
  ]) || !Object.values(value).every((entry) => typeof entry === 'string' && DIGEST.test(entry))) {
    fail('source digest shapeが不正');
  }
  return {
    snapshot_digest: value.snapshot_digest,
    candidate_witness_digest: value.candidate_witness_digest,
    query_set_digest: value.query_set_digest,
    manual_evidence_digest: value.manual_evidence_digest,
  };
}

function normalizeProvenance(value, label) {
  requireArray(value, `${label}.provenance`);
  if (value.length < 1 || value.length > PROVENANCE_SOURCES.size) {
    fail(`${label}.provenance件数が不正`);
  }
  const sources = new Set();
  const normalized = value.map((entry) => {
    if (!exactRecord(entry, ['source', 'evidence_ref', 'evidence_digest', 'status'])
      || !PROVENANCE_SOURCES.has(entry.source)
      || !boundedText(entry.evidence_ref)
      || typeof entry.evidence_digest !== 'string'
      || !DIGEST.test(entry.evidence_digest)) {
      fail(`${label}.provenance shapeが不正`);
    }
    if (entry.source === 'codegraph') {
      if (!CODEGRAPH_STATUSES.has(entry.status)) fail(`${label}.Codegraph statusが不正`);
    } else if (entry.status !== 'asserted') {
      fail(`${label}.manual provenance statusがassertedではない`);
    }
    if (sources.has(entry.source)) fail(`${label}.provenance sourceが重複している`);
    sources.add(entry.source);
    return {
      source: entry.source,
      evidence_ref: entry.evidence_ref,
      evidence_digest: entry.evidence_digest,
      status: entry.status,
    };
  });
  normalized.sort((left, right) => (
    compareText(left.source, right.source)
    || compareText(left.status, right.status)
    || compareText(left.evidence_ref, right.evidence_ref)
    || compareText(left.evidence_digest, right.evidence_digest)
  ));
  return { normalized, sources };
}

function requireExactSources(sources, expected, label) {
  if (sources.size !== expected.length || expected.some((source) => !sources.has(source))) {
    fail(`${label}.provenance source集合が不正`);
  }
}

function normalizeResource(value, todoSet) {
  if (!exactRecord(value, [
    'resource_id',
    'kind',
    'target',
    'todo_ids',
    'provenance',
  ]) || !identifier(value.resource_id)
    || !RESOURCE_KINDS.has(value.kind)
    || !boundedText(value.target)) {
    fail('resource shapeが不正');
  }
  requireArray(value.todo_ids, `resource ${value.resource_id}.todo_ids`);
  if (value.todo_ids.length < 1
    || value.todo_ids.length > todoSet.size
    || value.todo_ids.some((todoId) => !todoSet.has(todoId))
    || new Set(value.todo_ids).size !== value.todo_ids.length) {
    fail(`resource ${value.resource_id}.todo_idsが不正`);
  }
  const todoIds = [...value.todo_ids].sort(compareText);
  const { normalized: provenance, sources } = normalizeProvenance(
    value.provenance,
    `resource ${value.resource_id}`,
  );

  let status;
  if (value.kind === 'symbol' || value.kind === 'path') {
    requireExactSources(sources, ['codegraph', 'manual_candidate_spec'], `resource ${value.resource_id}`);
    status = provenance.find((entry) => entry.source === 'codegraph').status === 'ready'
      ? 'observed'
      : 'unknown';
  } else {
    requireExactSources(sources, ['manual_state_effect'], `resource ${value.resource_id}`);
    status = value.kind === 'dynamic' ? 'unknown' : 'observed';
  }

  return {
    resource_id: value.resource_id,
    kind: value.kind,
    target: value.target,
    todo_ids: todoIds,
    provenance,
    status,
  };
}

function normalizePrecedence(value, todoSet) {
  if (!exactRecord(value, [
    'from_todo_id',
    'to_todo_id',
    'reason',
    'provenance',
  ]) || !todoSet.has(value.from_todo_id)
    || !todoSet.has(value.to_todo_id)
    || value.from_todo_id === value.to_todo_id
    || !boundedText(value.reason)) {
    fail('precedence shapeが不正');
  }
  const { normalized: provenance, sources } = normalizeProvenance(value.provenance, 'precedence');
  requireExactSources(sources, ['manual_candidate_spec'], 'precedence');
  return {
    from_todo_id: value.from_todo_id,
    to_todo_id: value.to_todo_id,
    reason: value.reason,
    provenance,
  };
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
  if (visited !== todos.length) fail('precedencesにcycleがある');
}

function unknownForResource(resource) {
  const codegraph = resource.provenance.find((entry) => entry.source === 'codegraph');
  const kind = resource.kind === 'dynamic' ? 'dynamic' : `codegraph_${codegraph.status}`;
  const status = resource.kind === 'dynamic' ? 'dynamic' : codegraph.status;
  return resource.todo_ids.map((todoId) => ({
    todo_id: todoId,
    kind,
    reason: `resource ${resource.resource_id} is ${status}`,
  }));
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

/**
 * Codegraphの構造観測とmanual witnessをprovenance付きbundleへ正規化する。
 * @param {unknown} observationSet
 * @returns {object}
 */
export function compileBoundaryObservationV2(observationSet) {
  if (!exactRecord(observationSet, [
    'schema_version',
    'source',
    'capacity',
    'todos',
    'resources',
    'precedences',
  ]) || observationSet.schema_version !== OBSERVATION_SCHEMA) {
    fail('observation set shapeまたはschema_versionが不正');
  }
  const source = normalizeSource(observationSet.source);
  requireArray(observationSet.todos, 'todos');
  if (observationSet.todos.length < 1
    || observationSet.todos.length > MAX_TODOS
    || !observationSet.todos.every(identifier)
    || new Set(observationSet.todos).size !== observationSet.todos.length) {
    fail('todosがbounded unique identifier arrayではない');
  }
  const todos = [...observationSet.todos].sort(compareText);
  const todoSet = new Set(todos);
  if (!Number.isSafeInteger(observationSet.capacity)
    || observationSet.capacity < 1
    || observationSet.capacity > MAX_TODOS) {
    fail('capacityがbounded positive integerではない');
  }

  requireArray(observationSet.resources, 'resources');
  const resources = observationSet.resources.map((resource) => normalizeResource(resource, todoSet));
  if (new Set(resources.map((resource) => resource.resource_id)).size !== resources.length) {
    fail('resource_idが重複している');
  }
  resources.sort((left, right) => compareText(left.resource_id, right.resource_id));

  requireArray(observationSet.precedences, 'precedences');
  const precedences = observationSet.precedences.map((entry) => normalizePrecedence(entry, todoSet));
  const precedenceKeys = precedences.map((entry) => (
    `${entry.from_todo_id}\u0000${entry.to_todo_id}\u0000${entry.reason}`
  ));
  if (new Set(precedenceKeys).size !== precedenceKeys.length) fail('precedenceが重複している');
  precedences.sort(precedenceOrder);
  assertAcyclic(todos, precedences);

  const conflicts = [];
  const unknowns = [];
  for (const resource of resources) {
    if (resource.status === 'unknown') {
      unknowns.push(...unknownForResource(resource));
      continue;
    }
    for (let left = 0; left < resource.todo_ids.length; left += 1) {
      for (let right = left + 1; right < resource.todo_ids.length; right += 1) {
        conflicts.push({
          todo_ids: [resource.todo_ids[left], resource.todo_ids[right]],
          resource_id: resource.resource_id,
        });
      }
    }
  }
  conflicts.sort(conflictOrder);
  unknowns.sort(unknownOrder);

  const graph = {
    schema_version: GRAPH_SCHEMA,
    todos,
    conflicts,
    precedences: precedences.map((entry) => ({
      from_todo_id: entry.from_todo_id,
      to_todo_id: entry.to_todo_id,
      reason: entry.reason,
    })),
    unknowns,
    capacity: observationSet.capacity,
  };
  return {
    schema_version: BUNDLE_SCHEMA,
    source,
    resources,
    precedences,
    graph,
    graph_digest: sha256(JSON.stringify(graph)),
  };
}
