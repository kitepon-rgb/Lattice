import { createHash } from 'node:crypto';

const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const MAX_COLLECTION_ITEMS = 256;
const MAX_STRING_BYTES = 16_384;
const MAX_TEXT_BYTES = 4_096;
const MAX_PATH_BYTES = 1_024;
const MAX_CANONICAL_BYTES = 1_048_576;

const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const RESOURCE_KINDS = new Set([
  'symbol',
  'path',
  'state',
  'effect',
  'semantic',
  'dynamic',
]);
const GRAPH_OPERATIONS = new Set([
  'status',
  'query',
  'callers',
  'callees',
  'impact',
  'affected',
]);
const GRAPH_STATUSES = new Set([
  'ready',
  'absent',
  'symbol_absent',
  'empty',
  'command_failure',
  'invalid_json',
  'stale',
  'unresolved',
  'unsupported',
]);
const GRAPH_STATUS_BY_OPERATION = new Map([
  ['status', new Set([
    'ready',
    'absent',
    'command_failure',
    'invalid_json',
    'stale',
    'unresolved',
    'unsupported',
  ])],
  ['query', new Set(['ready', 'symbol_absent', 'command_failure', 'invalid_json', 'unresolved'])],
  ['callers', new Set(['ready', 'symbol_absent', 'command_failure', 'invalid_json', 'unresolved'])],
  ['callees', new Set(['ready', 'symbol_absent', 'command_failure', 'invalid_json', 'unresolved'])],
  ['impact', new Set(['ready', 'symbol_absent', 'command_failure', 'invalid_json', 'unresolved'])],
  ['affected', new Set(['ready', 'empty', 'unresolved'])],
]);
const VERDICTS = new Set([
  'parallel_ready',
  'seam_candidate',
  'intentional_serial',
  'unknown_requires_evidence',
]);
const EDGE_KINDS = new Set([
  'hard_need',
  'write_conflict',
  'state_conflict',
  'effect_conflict',
  'semantic_conflict',
  'dynamic_unknown',
]);
const INVALIDATION_KINDS = new Set([
  'old_plan',
  'agent_context',
  'partial_patch',
  'interface_assumption',
]);
const TRANSFORM_STATUSES = new Set(['accepted', 'rejected']);
const VERIFICATION_STATUSES = new Set(['passed', 'failed', 'not_run']);
const RECEIPT_OUTCOMES = new Set(['passed', 'failed']);
const CLEANUP_STATUSES = new Set(['passed', 'failed', 'unresolved']);
const SOURCE_STATUSES = new Set(['unchanged', 'changed', 'unresolved']);
const TRANSFORM_REJECTION_KINDS = new Set([
  'scope_violation',
  'behavior_verification_failed',
  'snapshot_mutation',
  'source_invariant_violation',
  'cleanup_failure',
  'execution_failure',
]);

function invalidArtifact(reason) {
  throw new TypeError(`artifact契約違反: ${reason}`);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function requireBoundedString(value, label = 'string') {
  if (byteLength(value) > MAX_STRING_BYTES) {
    invalidArtifact(`${label}が上限を超えている`);
  }
}

function inspectArray(value, state, depth) {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalidArtifact('array prototypeが不正');
  }
  if (value.length > MAX_COLLECTION_ITEMS) {
    invalidArtifact('array item数が上限を超えている');
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    invalidArtifact('arrayにsymbol keyがある');
  }
  const expectedKeys = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ]);
  if (ownKeys.length !== expectedKeys.size || ownKeys.some((key) => !expectedKeys.has(key))) {
    invalidArtifact('arrayがsparseまたはextra propertyを持つ');
  }

  const parts = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalidArtifact('array itemがdata propertyではない');
    }
    parts.push(canonicalPart(descriptor.value, state, depth + 1));
  }
  return `[${parts.join(',')}]`;
}

function inspectObject(value, state, depth) {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    invalidArtifact('plain objectではない');
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAX_COLLECTION_ITEMS) {
    invalidArtifact('object key数が上限を超えている');
  }
  if (ownKeys.some((key) => typeof key !== 'string')) {
    invalidArtifact('objectにsymbol keyがある');
  }

  const entries = [];
  for (const key of ownKeys.sort()) {
    requireBoundedString(key, 'object key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalidArtifact('object propertyがenumerable data propertyではない');
    }
    entries.push(`${JSON.stringify(key)}:${canonicalPart(descriptor.value, state, depth + 1)}`);
  }
  return `{${entries.join(',')}}`;
}

function canonicalPart(value, state, depth) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) {
    invalidArtifact('node数が上限を超えている');
  }
  if (depth > MAX_DEPTH) {
    invalidArtifact('nestingが上限を超えている');
  }

  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    requireBoundedString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      invalidArtifact('numberがfiniteでないかnegative zero');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    invalidArtifact('JSON valueではない');
  }
  if (state.seen.has(value)) {
    invalidArtifact('循環参照がある');
  }

  state.seen.add(value);
  try {
    return Array.isArray(value)
      ? inspectArray(value, state, depth)
      : inspectObject(value, state, depth);
  } finally {
    state.seen.delete(value);
  }
}

/**
 * JSON互換payloadをobject keyの辞書順でUTF-8 canonical JSONへ変換する。
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalizeArtifact(value) {
  const canonical = canonicalPart(value, { nodes: 0, seen: new Set() }, 0);
  if (byteLength(canonical) > MAX_CANONICAL_BYTES) {
    invalidArtifact('canonical byte列が上限を超えている');
  }
  return canonical;
}

/**
 * canonical payload byte列のSHA-256をlowercase hexで返す。
 * @param {unknown} value
 * @returns {string}
 */
export function digestArtifact(value) {
  return createHash('sha256')
    .update(Buffer.from(canonicalizeArtifact(value), 'utf8'))
    .digest('hex');
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function boundedText(value, maxBytes = MAX_TEXT_BYTES) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && !CONTROL_CHARACTER.test(value)
    && byteLength(value) <= maxBytes;
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function digest(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function repoPath(value, { allowDot = false } = {}) {
  if (allowDot && value === '.') return true;
  if (!boundedText(value, MAX_PATH_BYTES)
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const segments = value.split('/');
  return segments.length > 0
    && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function boundedArray(value, validator, { min = 0, max = MAX_COLLECTION_ITEMS } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= max
    && value.every((entry) => validator(entry));
}

function uniqueStrings(value, validator = boundedText, options = {}) {
  return boundedArray(value, validator, options) && new Set(value).size === value.length;
}

function disjoint(...arrays) {
  const seen = new Set();
  for (const array of arrays) {
    for (const value of array) {
      if (seen.has(value)) return false;
      seen.add(value);
    }
  }
  return true;
}

function resource(value, allowedKinds = RESOURCE_KINDS) {
  return exactRecord(value, ['kind', 'target'])
    && allowedKinds.has(value.kind)
    && (value.kind === 'path' ? repoPath(value.target) : boundedText(value.target, 512));
}

function resources(value, { min = 0, allowedKinds = RESOURCE_KINDS } = {}) {
  return boundedArray(value, (entry) => resource(entry, allowedKinds), { min })
    && new Set(value.map((entry) => `${entry.kind}\u0000${entry.target}`)).size === value.length;
}

function resourceKey(value) {
  return `${value.kind}\u0000${value.target}`;
}

function validateSafely(value, validator) {
  try {
    canonicalizeArtifact(value);
    return validator(value) === true;
  } catch {
    return false;
  }
}

function planTodo(value) {
  return exactRecord(value, ['id', 'outcome', 'concern', 'anchor'])
    && identifier(value.id)
    && boundedText(value.outcome)
    && identifier(value.concern)
    && exactRecord(value.anchor, ['symbol', 'path'])
    && boundedText(value.anchor.symbol, 512)
    && repoPath(value.anchor.path);
}

/** @param {unknown} value @returns {boolean} */
export function validatePlanInput(value) {
  return validateSafely(value, (input) => {
    if (!exactRecord(input, [
      'schema',
      'project',
      'plan_version',
      'capacity',
      'todos',
      'manual_evidence_ref',
      'query_set_ref',
    ]) || input.schema !== 'lattice.plan_input.v1') {
      return false;
    }
    if (!exactRecord(input.project, ['root', 'fixture_entry'])
      || !repoPath(input.project.root, { allowDot: true })
      || !repoPath(input.project.fixture_entry)) {
      return false;
    }
    if (!identifier(input.plan_version)
      || !exactRecord(input.capacity, ['writers'])
      || !positiveInteger(input.capacity.writers)
      || input.capacity.writers > 64
      || !boundedArray(input.todos, planTodo, { min: 1 })) {
      return false;
    }
    const todoIds = input.todos.map((todo) => todo.id);
    return new Set(todoIds).size === todoIds.length
      && repoPath(input.manual_evidence_ref)
      && repoPath(input.query_set_ref);
  });
}

function graphEvidence(value) {
  return exactRecord(value, ['id', 'operation', 'status', 'result_digest'])
    && identifier(value.id)
    && GRAPH_OPERATIONS.has(value.operation)
    && GRAPH_STATUSES.has(value.status)
    && GRAPH_STATUS_BY_OPERATION.get(value.operation).has(value.status)
    && digest(value.result_digest);
}

function manualEvidence(value) {
  return exactRecord(value, ['id', 'todo_id', 'result_digest'])
    && identifier(value.id)
    && identifier(value.todo_id)
    && digest(value.result_digest);
}

function manifestTodo(value) {
  const ownedKinds = new Set(['symbol', 'path']);
  return exactRecord(value, [
    'id',
    'owns',
    'reads',
    'writes',
    'hard_needs',
    'conflict_ids',
    'unknowns',
    'tests',
    'evidence_refs',
  ])
    && identifier(value.id)
    && resources(value.owns, { min: 1, allowedKinds: ownedKinds })
    && resources(value.reads)
    && resources(value.writes, { min: 1 })
    && uniqueStrings(value.hard_needs, identifier)
    && uniqueStrings(value.conflict_ids, identifier)
    && uniqueStrings(value.unknowns)
    && uniqueStrings(value.tests, (entry) => repoPath(entry), { min: 1 })
    && uniqueStrings(value.evidence_refs, identifier, { min: 1 });
}

function manifestConflict(value) {
  return exactRecord(value, ['id', 'kind', 'todo_ids', 'resource', 'evidence_refs'])
    && identifier(value.id)
    && new Set([
      'write_boundary',
      'state',
      'effect',
      'semantic',
      'dynamic_unknown',
    ]).has(value.kind)
    && uniqueStrings(value.todo_ids, identifier, { min: 2, max: 2 })
    && resource(value.resource)
    && uniqueStrings(value.evidence_refs, identifier, { min: 1 });
}

/** @param {unknown} value @returns {boolean} */
export function validateBoundaryManifest(value) {
  return validateSafely(value, (manifest) => {
    if (!exactRecord(manifest, [
      'schema',
      'plan_input_digest',
      'source',
      'graph_evidence',
      'manual_evidence',
      'todos',
      'conflicts',
      'unknowns',
    ]) || manifest.schema !== 'lattice.boundary_manifest.v1'
      || !digest(manifest.plan_input_digest)) {
      return false;
    }
    if (!exactRecord(manifest.source, [
      'code_snapshot_digest',
      'query_set_digest',
      'manual_evidence_digest',
      'codegraph_version',
    ])
      || !digest(manifest.source.code_snapshot_digest)
      || !digest(manifest.source.query_set_digest)
      || !digest(manifest.source.manual_evidence_digest)
      || !boundedText(manifest.source.codegraph_version, 128)) {
      return false;
    }
    if (!boundedArray(manifest.graph_evidence, graphEvidence, { min: 1 })
      || !boundedArray(manifest.manual_evidence, manualEvidence, { min: 1 })
      || !boundedArray(manifest.todos, manifestTodo, { min: 1 })
      || !boundedArray(manifest.conflicts, manifestConflict)
      || !uniqueStrings(manifest.unknowns)) {
      return false;
    }

    const graphEvidenceIds = new Set(manifest.graph_evidence.map((entry) => entry.id));
    const manualEvidenceIds = new Set(manifest.manual_evidence.map((entry) => entry.id));
    const evidenceIds = new Set([...graphEvidenceIds, ...manualEvidenceIds]);
    const todoIds = new Set(manifest.todos.map((todo) => todo.id));
    const conflictIds = new Set(manifest.conflicts.map((conflict) => conflict.id));
    const manualTodoIds = new Set(manifest.manual_evidence.map((entry) => entry.todo_id));
    if (graphEvidenceIds.size !== manifest.graph_evidence.length
      || manualEvidenceIds.size !== manifest.manual_evidence.length
      || evidenceIds.size !== graphEvidenceIds.size + manualEvidenceIds.size
      || todoIds.size !== manifest.todos.length
      || conflictIds.size !== manifest.conflicts.length
      || manualTodoIds.size !== manifest.manual_evidence.length
      || manualTodoIds.size !== todoIds.size
      || manifest.manual_evidence.some((entry) => !todoIds.has(entry.todo_id))) {
      return false;
    }
    const manualByTodo = new Map(manifest.manual_evidence
      .map((entry) => [entry.todo_id, entry.id]));
    for (const todo of manifest.todos) {
      if (todo.hard_needs.some((id) => id === todo.id || !todoIds.has(id))
        || todo.conflict_ids.some((id) => !conflictIds.has(id))
        || todo.evidence_refs.some((id) => !evidenceIds.has(id))
        || !todo.evidence_refs.includes(manualByTodo.get(todo.id))) {
        return false;
      }
    }
    for (const conflict of manifest.conflicts) {
      const conflictResource = resourceKey(conflict.resource);
      const requiresManualEvidence = conflict.kind === 'state'
        || conflict.kind === 'effect'
        || conflict.kind === 'dynamic_unknown';
      if (conflict.todo_ids.some((id) => !todoIds.has(id))
        || conflict.evidence_refs.some((id) => !evidenceIds.has(id))
        || (conflict.kind === 'write_boundary'
          && !conflict.evidence_refs.some((id) => graphEvidenceIds.has(id)))
        || (requiresManualEvidence && conflict.todo_ids
          .some((id) => !conflict.evidence_refs.includes(manualByTodo.get(id))))
        || conflict.todo_ids.some((id) => {
          const todo = manifest.todos.find((entry) => entry.id === id);
          const relevantResources = conflict.kind === 'write_boundary'
            ? todo.writes
            : [...todo.owns, ...todo.reads, ...todo.writes];
          return !todo.conflict_ids.includes(conflict.id)
            || !relevantResources.some((entry) => resourceKey(entry) === conflictResource);
        })) {
        return false;
      }
    }
    return true;
  });
}

function seamCandidate(value, todoIds) {
  const ownedKinds = new Set(['symbol', 'path']);
  if (!exactRecord(value, ['id', 'proposed_owns', 'preconditions'])
    || !identifier(value.id)
    || !boundedArray(value.proposed_owns, (entry) => exactRecord(entry, ['todo_id', 'resources'])
      && identifier(entry.todo_id)
      && resources(entry.resources, { min: 1, allowedKinds: ownedKinds }), { min: 1 })
    || !uniqueStrings(value.preconditions, boundedText, { min: 1 })) {
    return false;
  }
  const proposedIds = value.proposed_owns.map((entry) => entry.todo_id);
  const proposedResources = value.proposed_owns
    .flatMap((entry) => entry.resources.map(resourceKey));
  return new Set(proposedIds).size === proposedIds.length
    && proposedIds.length === todoIds.length
    && proposedIds.every((id) => todoIds.includes(id))
    && new Set(proposedResources).size === proposedResources.length;
}

function verdict(value) {
  if (!exactRecord(value, [
    'id',
    'todo_ids',
    'verdict',
    'conflict_ids',
    'seam_candidate',
    'reasons',
    'unknowns',
  ])
    || !identifier(value.id)
    || !uniqueStrings(value.todo_ids, identifier, { min: 2, max: 2 })
    || !VERDICTS.has(value.verdict)
    || !uniqueStrings(value.conflict_ids, identifier)
    || !uniqueStrings(value.reasons, boundedText, { min: 1 })
    || !uniqueStrings(value.unknowns)) {
    return false;
  }
  if (value.verdict === 'seam_candidate') {
    return value.conflict_ids.length > 0 && seamCandidate(value.seam_candidate, value.todo_ids);
  }
  if (value.seam_candidate !== null) return false;
  if (value.verdict === 'parallel_ready') {
    return value.conflict_ids.length === 0 && value.unknowns.length === 0;
  }
  return value.verdict !== 'unknown_requires_evidence' || value.unknowns.length > 0;
}

/** @param {unknown} value @returns {boolean} */
export function validateBoundaryVerdict(value) {
  return validateSafely(value, (artifact) => exactRecord(artifact, [
    'schema',
    'boundary_manifest_digest',
    'verdicts',
  ])
    && artifact.schema === 'lattice.boundary_verdict.v1'
    && digest(artifact.boundary_manifest_digest)
    && boundedArray(artifact.verdicts, verdict, { min: 1 })
    && new Set(artifact.verdicts.map((entry) => entry.id)).size === artifact.verdicts.length);
}

function planNode(value) {
  const ownedKinds = new Set(['symbol', 'path']);
  return exactRecord(value, ['id', 'outcome', 'owned_boundaries'])
    && identifier(value.id)
    && boundedText(value.outcome)
    && resources(value.owned_boundaries, { min: 1, allowedKinds: ownedKinds });
}

function planEdge(value) {
  return exactRecord(value, ['id', 'from', 'to', 'kind', 'evidence_refs'])
    && identifier(value.id)
    && identifier(value.from)
    && identifier(value.to)
    && value.from !== value.to
    && EDGE_KINDS.has(value.kind)
    && uniqueStrings(value.evidence_refs, identifier, { min: 1 });
}

function planJoin(value) {
  return exactRecord(value, ['id', 'after', 'before'])
    && identifier(value.id)
    && uniqueStrings(value.after, identifier, { min: 1 })
    && identifier(value.before)
    && !value.after.includes(value.before);
}

/** @param {unknown} value @returns {boolean} */
export function validatePlanGraph(value) {
  return validateSafely(value, (graph) => {
    if (!exactRecord(graph, [
      'schema',
      'plan_version',
      'source_manifest_digest',
      'capacity',
      'nodes',
      'edges',
      'joins',
      'waves',
      'minimum_feasible_waves',
    ])
      || graph.schema !== 'lattice.plan_graph.v1'
      || !identifier(graph.plan_version)
      || !digest(graph.source_manifest_digest)
      || !exactRecord(graph.capacity, ['writers'])
      || !positiveInteger(graph.capacity.writers)
      || graph.capacity.writers > 64
      || !boundedArray(graph.nodes, planNode, { min: 1 })
      || !boundedArray(graph.edges, planEdge)
      || !boundedArray(graph.joins, planJoin)
      || !boundedArray(graph.waves, (wave) => exactRecord(wave, ['index', 'todo_ids'])
        && nonNegativeInteger(wave.index)
        && uniqueStrings(wave.todo_ids, identifier, { min: 1 }))
      || !positiveInteger(graph.minimum_feasible_waves)) {
      return false;
    }

    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    if (nodeIds.size !== graph.nodes.length
      || new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length
      || new Set(graph.joins.map((join) => join.id)).size !== graph.joins.length
      || graph.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      || graph.joins.some((join) => !nodeIds.has(join.before)
        || join.after.some((id) => !nodeIds.has(id)))) {
      return false;
    }

    const scheduled = [];
    const waveByTodo = new Map();
    for (let index = 0; index < graph.waves.length; index += 1) {
      const wave = graph.waves[index];
      if (wave.index !== index
        || wave.todo_ids.length > graph.capacity.writers
        || wave.todo_ids.some((id) => !nodeIds.has(id))) {
        return false;
      }
      scheduled.push(...wave.todo_ids);
      for (const id of wave.todo_ids) waveByTodo.set(id, index);
    }
    if (graph.minimum_feasible_waves !== graph.waves.length
      || scheduled.length !== graph.nodes.length
      || new Set(scheduled).size !== scheduled.length
      || graph.edges.some((edge) => waveByTodo.get(edge.from) >= waveByTodo.get(edge.to))
      || graph.joins.some((join) => join.after
        .some((id) => waveByTodo.get(id) >= waveByTodo.get(join.before)))) {
      return false;
    }

    const ownedByTodo = new Map(graph.nodes.map((node) => [
      node.id,
      new Set(node.owned_boundaries.map(resourceKey)),
    ]));
    for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
        const left = graph.nodes[leftIndex].id;
        const right = graph.nodes[rightIndex].id;
        const overlaps = [...ownedByTodo.get(left)].some((key) => ownedByTodo.get(right).has(key));
        const hasConflictEdge = graph.edges.some((edge) => edge.kind === 'write_conflict'
          && ((edge.from === left && edge.to === right)
            || (edge.from === right && edge.to === left)));
        if (overlaps !== hasConflictEdge) return false;
      }
    }
    return true;
  });
}

function planDescriptor(value) {
  return exactRecord(value, ['version', 'digest'])
    && identifier(value.version)
    && digest(value.digest);
}

function sortedPaths(value, { min = 0 } = {}) {
  return uniqueStrings(value, (entry) => repoPath(entry), { min })
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function transformSource(value) {
  return exactRecord(value, [
    'base_sha',
    'boundary_manifest_digest',
    'boundary_verdict_digest',
    'control_plan_digest',
    'query_set_digest',
    'code_snapshot_digest',
  ])
    && typeof value.base_sha === 'string'
    && SHA1.test(value.base_sha)
    && digest(value.boundary_manifest_digest)
    && digest(value.boundary_verdict_digest)
    && digest(value.control_plan_digest)
    && digest(value.query_set_digest)
    && digest(value.code_snapshot_digest);
}

function verificationReceipt(value) {
  return exactRecord(value, [
    'id',
    'command',
    'args',
    'outcome',
    'exit_code',
    'stdout_digest',
    'stderr_digest',
  ])
    && identifier(value.id)
    && boundedText(value.command, 512)
    && boundedArray(value.args, (entry) => boundedText(entry, 1_024))
    && RECEIPT_OUTCOMES.has(value.outcome)
    && nonNegativeInteger(value.exit_code)
    && digest(value.stdout_digest)
    && digest(value.stderr_digest);
}

function transformVerification(value) {
  if (!exactRecord(value, ['status', 'digest', 'receipts'])
    || !VERIFICATION_STATUSES.has(value.status)
    || !digest(value.digest)
    || !boundedArray(value.receipts, verificationReceipt)
    || new Set(value.receipts.map(({ id }) => id)).size !== value.receipts.length
    || value.digest !== digestArtifact({ status: value.status, receipts: value.receipts })) {
    return false;
  }
  if (value.status === 'passed') {
    return value.receipts.length > 0
      && value.receipts.every((receipt) => receipt.outcome === 'passed' && receipt.exit_code === 0);
  }
  if (value.status === 'not_run') return value.receipts.length === 0;
  return value.receipts.length > 0;
}

function outputFile(value) {
  return exactRecord(value, ['path', 'content_digest'])
    && repoPath(value.path)
    && digest(value.content_digest);
}

function transformOutput(value, changedPaths) {
  if (!exactRecord(value, ['snapshot_digest', 'files'])
    || !boundedArray(value.files, outputFile)
    || new Set(value.files.map(({ path }) => path)).size !== value.files.length
    || value.files.some((entry, index) => index > 0 && value.files[index - 1].path >= entry.path)) {
    return false;
  }
  if (value.files.length === 0) return value.snapshot_digest === null;
  return digest(value.snapshot_digest)
    && value.snapshot_digest === digestArtifact({ files: value.files })
    && value.files.length === changedPaths.length
    && value.files.every((entry, index) => entry.path === changedPaths[index]);
}

function transformRejection(value) {
  return exactRecord(value, ['kind', 'reasons', 'evidence_digest'])
    && TRANSFORM_REJECTION_KINDS.has(value.kind)
    && uniqueStrings(value.reasons, boundedText, { min: 1 })
    && digest(value.evidence_digest)
    && value.evidence_digest === digestArtifact({ kind: value.kind, reasons: value.reasons });
}

/** @param {unknown} value @returns {boolean} */
export function validateTransformArtifact(value) {
  return validateSafely(value, (artifact) => {
    if (!exactRecord(artifact, [
      'schema',
      'candidate_id',
      'status',
      'source',
      'scope',
      'patch',
      'verification',
      'output',
      'cleanup',
      'rejection',
      'unknowns',
    ])
      || artifact.schema !== 'lattice.transform_artifact.v1'
      || !identifier(artifact.candidate_id)
      || !TRANSFORM_STATUSES.has(artifact.status)
      || !transformSource(artifact.source)
      || !exactRecord(artifact.scope, ['allowed_paths', 'changed_paths'])
      || !sortedPaths(artifact.scope.allowed_paths, { min: 1 })
      || !sortedPaths(artifact.scope.changed_paths)
      || artifact.scope.changed_paths.some((entry) => !artifact.scope.allowed_paths.includes(entry))
      || !exactRecord(artifact.patch, ['digest', 'bytes'])
      || !((artifact.patch.digest === null && artifact.patch.bytes === 0)
        || (digest(artifact.patch.digest) && positiveInteger(artifact.patch.bytes)))
      || !transformVerification(artifact.verification)
      || !transformOutput(artifact.output, artifact.scope.changed_paths)
      || !exactRecord(artifact.cleanup, ['status', 'source_status'])
      || !CLEANUP_STATUSES.has(artifact.cleanup.status)
      || !SOURCE_STATUSES.has(artifact.cleanup.source_status)
      || !uniqueStrings(artifact.unknowns)) {
      return false;
    }

    if (artifact.status === 'accepted') {
      return artifact.rejection === null
        && artifact.scope.changed_paths.length > 0
        && digest(artifact.patch.digest)
        && positiveInteger(artifact.patch.bytes)
        && artifact.verification.status === 'passed'
        && artifact.output.files.length === artifact.scope.changed_paths.length
        && artifact.cleanup.status === 'passed'
        && artifact.cleanup.source_status === 'unchanged';
    }
    return transformRejection(artifact.rejection)
      && artifact.verification.status !== 'passed';
  });
}

function changeSet(value, keys) {
  return exactRecord(value, keys)
    && keys.every((key) => uniqueStrings(value[key], identifier));
}

function invalidatedContext(value) {
  return exactRecord(value, ['kind', 'ref', 'reason'])
    && INVALIDATION_KINDS.has(value.kind)
    && boundedText(value.ref, 512)
    && boundedText(value.reason);
}

function metricSet(value) {
  const keys = [
    'write_conflicts_before',
    'write_conflicts_after',
    'hard_precedence_before',
    'hard_precedence_after',
    'minimum_feasible_waves_before',
    'minimum_feasible_waves_after',
  ];
  return exactRecord(value, keys)
    && keys.every((key) => nonNegativeInteger(value[key]))
    && value.minimum_feasible_waves_before >= 1
    && value.minimum_feasible_waves_after >= 1;
}

/** @param {unknown} value @returns {boolean} */
export function validatePlanDiff(value) {
  return validateSafely(value, (diff) => {
    if (!exactRecord(diff, [
      'schema',
      'old_plan',
      'new_plan',
      'transform',
      'query_set_digest',
      'snapshots',
      'nodes',
      'edges',
      'invalidated_contexts',
      'metrics',
    ])
      || diff.schema !== 'lattice.plan_diff.v1'
      || !planDescriptor(diff.old_plan)
      || !planDescriptor(diff.new_plan)
      || diff.old_plan.version === diff.new_plan.version
      || diff.old_plan.digest === diff.new_plan.digest
      || !exactRecord(diff.transform, [
        'status',
        'artifact_digest',
        'patch_digest',
        'verification_digest',
        'changed_paths',
      ])
      || diff.transform.status !== 'accepted'
      || !digest(diff.transform.artifact_digest)
      || !digest(diff.transform.patch_digest)
      || !digest(diff.transform.verification_digest)
      || !uniqueStrings(diff.transform.changed_paths, (entry) => repoPath(entry), { min: 1 })
      || !digest(diff.query_set_digest)
      || !exactRecord(diff.snapshots, ['before_digest', 'after_digest'])
      || !digest(diff.snapshots.before_digest)
      || !digest(diff.snapshots.after_digest)
      || diff.snapshots.before_digest === diff.snapshots.after_digest
      || !changeSet(diff.nodes, ['added', 'removed', 'changed'])
      || !changeSet(diff.edges, ['added', 'removed'])
      || !disjoint(diff.nodes.added, diff.nodes.removed, diff.nodes.changed)
      || !disjoint(diff.edges.added, diff.edges.removed)
      || !boundedArray(diff.invalidated_contexts, invalidatedContext, { min: 1 })
      || new Set(diff.invalidated_contexts
        .map((entry) => `${entry.kind}\u0000${entry.ref}`)).size !== diff.invalidated_contexts.length
      || !diff.invalidated_contexts.some((entry) => entry.kind === 'old_plan'
        && entry.ref === diff.old_plan.version)
      || !metricSet(diff.metrics)) {
      return false;
    }
    return diff.nodes.added.length + diff.nodes.removed.length + diff.nodes.changed.length
      + diff.edges.added.length + diff.edges.removed.length > 0;
  });
}
