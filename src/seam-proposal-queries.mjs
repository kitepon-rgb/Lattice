import { createHash } from 'node:crypto';

import { digestArtifact } from './artifact-contracts.mjs';
import { SENSOR_QUERY_OPERATIONS } from './runtime-contracts.mjs';
import { collectSensorEvidence, portableSensorOutcome } from './sensor-adapter.mjs';
import { todoSelfDigest } from './todo-contracts.mjs';

const CONFLICT_KINDS = new Set(['symbol', 'path', 'state', 'effect']);
const QUERYABLE_KINDS = new Set(['symbol', 'path']);
const SYMBOL_OPERATIONS = Object.freeze(['query', 'callers', 'callees', 'impact']);
const SENSOR_OPERATIONS = new Set(SENSOR_QUERY_OPERATIONS);
const QUERY_LIMIT = 256;
const GRAPH_NODE_LIMIT = 64;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sortedUnique = (values) => [...new Set(values)].sort(compareText);

export class SeamProposalQueryError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'SeamProposalQueryError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail) {
  throw new SeamProposalQueryError(code, reason, detail);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function boundedText(value, maxBytes = 4_096) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && !CONTROL.test(value)
    && Buffer.byteLength(value) <= maxBytes;
}

function repoRelativePathOrPrefix(value) {
  if (!boundedText(value, 1_024) || value.startsWith('/') || value.includes('\\')
    || /^[A-Za-z]:/u.test(value)) return false;
  const body = value.endsWith('/') ? value.slice(0, -1) : value;
  return body.length > 0 && body.split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function repoRelativePath(value) {
  return repoRelativePathOrPrefix(value) && !value.endsWith('/');
}

function sha16(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function queryId(operation, kind, target) {
  return `seam-${operation}-${sha16(`${kind}\0${target}`)}`;
}

function assertConflictResources(conflictResources) {
  if (!Array.isArray(conflictResources)) {
    fail('SEAM_QUERY_RESOURCES_INVALID', 'conflict_resources_not_array');
  }
  const byId = new Map();
  for (const resource of conflictResources) {
    if (!exactRecord(resource, ['resource_id', 'kind', 'target'])
      || !boundedText(resource.resource_id)
      || !CONFLICT_KINDS.has(resource.kind)
      || !boundedText(resource.target)
      || (resource.kind === 'path' && !repoRelativePathOrPrefix(resource.target))) {
      fail('SEAM_QUERY_RESOURCE_INVALID', 'conflict_resource_invalid', {
        resource_id: resource?.resource_id ?? null,
      });
    }
    if (byId.has(resource.resource_id)) {
      fail('SEAM_QUERY_RESOURCE_DUPLICATE', 'conflict_resource_id_duplicate', {
        resource_id: resource.resource_id,
      });
    }
    byId.set(resource.resource_id, resource);
  }
  return [...byId.values()].sort((left, right) => compareText(
    left.resource_id, right.resource_id,
  ));
}

function assertRuntimeQuerySet(querySet) {
  if (!exactRecord(querySet, ['queries']) || !Array.isArray(querySet.queries)
    || querySet.queries.length > QUERY_LIMIT) {
    fail('SEAM_QUERY_SET_INVALID', 'runtime_sensor_query_set_invalid');
  }
  let previousId = null;
  for (const query of querySet.queries) {
    const keys = query?.operation === 'status'
      ? ['id', 'operation'] : ['id', 'operation', 'target'];
    if (!exactRecord(query, keys)
      || !IDENTIFIER.test(query.id)
      || !SENSOR_OPERATIONS.has(query.operation)
      || (keys.includes('target') && !boundedText(query.target))) {
      fail('SEAM_QUERY_SET_INVALID', 'runtime_sensor_query_invalid', {
        query_id: query?.id ?? null,
      });
    }
    if (previousId !== null && compareText(previousId, query.id) >= 0) {
      fail('SEAM_QUERY_SET_INVALID', 'query_ids_not_strictly_sorted_unique', {
        query_id: query.id,
      });
    }
    previousId = query.id;
  }
  if (querySet.queries.filter(({ operation }) => operation === 'status').length !== 1) {
    fail('SEAM_QUERY_SET_INVALID', 'status_query_not_exactly_one');
  }
}

function assertConcernSymbols(concernSymbols) {
  if (!Array.isArray(concernSymbols) || concernSymbols.length > QUERY_LIMIT) {
    fail('SEAM_QUERY_CONCERN_SYMBOLS_INVALID', 'concern_symbols_not_bounded_array');
  }
  for (const symbol of concernSymbols) {
    if (!boundedText(symbol, 1_024)) {
      fail('SEAM_QUERY_CONCERN_SYMBOL_INVALID', 'concern_symbol_invalid');
    }
  }
  return sortedUnique(concernSymbols);
}

/**
 * Build the schema-less `lattice.run_request.v1.sensor_query_set` vocabulary used by
 * todo-independence. The wrapper records non-code conflicts without putting their targets
 * on the sensor command line.
 *
 * `concernSymbols` are the symbol names declared through witness `concern_anchors`. They only
 * need the `query` operation: the binder asks whether the declared name resolves to exactly one
 * symbol, and where it lives. Graph expansion stays owned by the conflict resources.
 */
export function buildSeamProposalQuerySet({ conflictResources, concernSymbols = [] } = {}) {
  const resources = assertConflictResources(conflictResources);
  const concerns = assertConcernSymbols(concernSymbols);
  const queryById = new Map([[
    'seam-00-status',
    { id: 'seam-00-status', operation: 'status' },
  ]]);
  const queryableKeys = new Set();
  const excludedResources = [];

  for (const resource of resources) {
    if (!QUERYABLE_KINDS.has(resource.kind)) {
      excludedResources.push({
        resource_id: resource.resource_id,
        kind: resource.kind,
        target: resource.target,
        reason: 'non_code_conflict',
      });
      continue;
    }
    const resourceKey = `${resource.kind}\0${resource.target}`;
    if (queryableKeys.has(resourceKey)) continue;
    queryableKeys.add(resourceKey);
    const operations = resource.kind === 'symbol' ? SYMBOL_OPERATIONS : ['affected'];
    for (const operation of operations) {
      const id = queryId(operation, resource.kind, resource.target);
      if (queryById.has(id)) {
        fail('SEAM_QUERY_ID_COLLISION', 'deterministic_query_id_collision', {
          query_id: id,
        });
      }
      queryById.set(id, { id, operation, target: resource.target });
    }
  }

  // 宣言concern symbolの解決query。conflict symbolと同名なら既存queryがそのまま答えになる。
  for (const symbol of concerns) {
    const id = queryId('query', 'symbol', symbol);
    if (queryById.has(id)) continue;
    queryById.set(id, { id, operation: 'query', target: symbol });
  }

  const querySet = {
    queries: [...queryById.values()]
      .sort((left, right) => compareText(left.id, right.id)),
  };
  if (querySet.queries.length > QUERY_LIMIT) {
    fail('SEAM_QUERY_LIMIT_EXCEEDED', 'runtime_sensor_query_limit_exceeded', {
      query_count: querySet.queries.length,
      query_limit: QUERY_LIMIT,
    });
  }
  assertRuntimeQuerySet(querySet);
  return {
    query_set: querySet,
    excluded_resources: excludedResources,
  };
}

function outcomeFailure(outcome, query) {
  if (!plainRecord(outcome)
    || outcome.id !== query.id
    || outcome.operation !== query.operation
    || !boundedText(outcome.outcome)) {
    fail('SEAM_SENSOR_EVIDENCE_INVALID', 'sensor_outcome_query_mismatch', {
      query_id: query.id,
    });
  }
  if (new Set([
    'command_failure', 'invalid_json', 'unsupported', 'unresolved', 'stale',
  ]).has(outcome.outcome)) {
    fail('SEAM_SENSOR_QUERY_FAILED', 'sensor_query_failed', {
      query_id: query.id,
      operation: query.operation,
      outcome: outcome.outcome,
    });
  }
}

function exactSymbolResolution(outcome, target, operation) {
  if (outcome.outcome === 'symbol_absent') return { outcome: 'absent' };
  if (outcome.outcome !== 'ready') {
    fail('SEAM_SENSOR_QUERY_FAILED', 'sensor_symbol_query_not_ready', {
      query_id: outcome.id,
      operation,
      outcome: outcome.outcome,
    });
  }
  const records = operation === 'query' ? outcome.data : outcome.resolution;
  if (!Array.isArray(records)) return { outcome: 'unknown' };
  const exact = records.filter((entry) => {
    const node = entry?.node;
    return plainRecord(node) && (node.name === target || node.qualifiedName === target);
  });
  if (exact.length === 0) return { outcome: 'absent' };
  if (exact.some(({ node }) => !repoRelativePath(node.filePath))) {
    return { outcome: 'unknown' };
  }
  const paths = [...new Set(exact.map(({ node }) => node.filePath))].sort(compareText);
  if (paths.length === 1) {
    return { outcome: 'resolved', resolved_name: target, resolved_path: paths[0] };
  }
  // 同名が複数fileにある。`query`は「その名前はどこに居るか」を問う操作なので、候補を
  // 持ったまま返す——宣言の`within`が指す資源で絞れば一意に決まる場合がある（ADR 0134）。
  // graph操作（callers／callees／impact）は逆に、展開の起点が一意でなければ意味を持たない。
  // 同じ曖昧さでも問いが違うので、そちらはunknownのまま潰す。
  if (operation === 'query') {
    return { outcome: 'ambiguous', resolved_name: target, candidate_paths: paths };
  }
  return { outcome: 'unknown' };
}

function symbolResolutionForEvidence(local, canonical) {
  // 起点が一意でない名前についてのgraph観測は、どのsymbolについての観測か確定しない。
  if (canonical.outcome === 'unknown' || canonical.outcome === 'ambiguous') {
    return { outcome: 'unknown' };
  }
  if (canonical.outcome === 'absent') {
    return local.outcome === 'absent' ? local : { outcome: 'unknown' };
  }
  return local.outcome === 'resolved'
    && local.resolved_name === canonical.resolved_name
    && local.resolved_path === canonical.resolved_path
    ? local
    : { outcome: 'unknown' };
}

function affectedResolution(outcome, target) {
  if (!['ready', 'empty'].includes(outcome.outcome)) {
    fail('SEAM_SENSOR_QUERY_FAILED', 'sensor_affected_query_not_ready', {
      query_id: outcome.id,
      outcome: outcome.outcome,
    });
  }
  if (!Array.isArray(outcome.targets) || outcome.targets.length !== 1) {
    return { outcome: 'unknown' };
  }
  const [entry] = outcome.targets;
  if (!plainRecord(entry) || entry.target !== target) return { outcome: 'unknown' };
  if (entry.path_state === 'absent') return { outcome: 'absent' };
  if (!['ready', 'empty'].includes(entry.outcome)
    || !plainRecord(entry.data)
    || !Array.isArray(entry.data.affectedTests)) {
    return { outcome: 'unknown' };
  }
  return { outcome: 'resolved', resolved_name: null, resolved_path: target };
}

function evidenceQuery({ query, outcome, resolution }) {
  return {
    query_id: query.id,
    operation: query.operation,
    target: query.target ?? '.',
    outcome: resolution.outcome,
    resolved_name: resolution.resolved_name ?? null,
    resolved_path: resolution.resolved_path ?? null,
    candidate_paths: resolution.candidate_paths ?? [],
    result_digest: digestArtifact(portableSensorOutcome(outcome)),
  };
}

/**
 * Normalize already-collected outcomes. Unit tests can inject the `collected` fixture here;
 * production collection remains owned by `collectSensorEvidence`.
 */
export function normalizeSeamProposalEvidence({ querySet, collected } = {}) {
  assertRuntimeQuerySet(querySet);
  if (!plainRecord(collected) || !Array.isArray(collected.outcomes)
    || collected.outcomes.length !== querySet.queries.length) {
    fail('SEAM_SENSOR_EVIDENCE_INVALID', 'sensor_outcome_count_mismatch', {
      expected: querySet.queries.length,
      actual: Array.isArray(collected?.outcomes) ? collected.outcomes.length : null,
    });
  }

  const outcomeById = new Map();
  querySet.queries.forEach((query, index) => {
    const outcome = collected.outcomes[index];
    outcomeFailure(outcome, query);
    outcomeById.set(query.id, outcome);
  });

  const statusQuery = querySet.queries.find(({ operation }) => operation === 'status');
  const statusOutcome = outcomeById.get(statusQuery.id);
  if (statusOutcome.outcome !== 'ready') {
    fail('SEAM_SENSOR_STATUS_NOT_READY', 'sensor_status_not_ready', {
      outcome: statusOutcome.outcome,
    });
  }

  const canonicalByTarget = new Map();
  for (const query of querySet.queries.filter(({ operation }) => operation === 'query')) {
    canonicalByTarget.set(
      query.target,
      exactSymbolResolution(outcomeById.get(query.id), query.target, query.operation),
    );
  }

  const queries = querySet.queries.map((query) => {
    const outcome = outcomeById.get(query.id);
    if (query.operation === 'status') {
      return evidenceQuery({ query, outcome, resolution: { outcome: 'resolved' } });
    }
    if (query.operation === 'affected') {
      return evidenceQuery({
        query,
        outcome,
        resolution: affectedResolution(outcome, query.target),
      });
    }
    const local = exactSymbolResolution(outcome, query.target, query.operation);
    const canonical = canonicalByTarget.get(query.target);
    return evidenceQuery({
      query,
      outcome,
      resolution: query.operation === 'query'
        ? local
        : symbolResolutionForEvidence(local, canonical),
    });
  }).sort((left, right) => compareText(left.query_id, right.query_id));

  const evidence = {
    query_set_digest: digestArtifact(querySet),
    evidence_digest: '',
    queries,
  };
  evidence.evidence_digest = todoSelfDigest(evidence, 'evidence_digest');
  return evidence;
}

function observedGraphNode(entry) {
  const node = entry?.node ?? entry;
  if (!plainRecord(node)
    || !boundedText(node.name)
    || !repoRelativePath(node.filePath)) return null;
  return { name: node.name, filePath: node.filePath };
}

function graphNodeKey(node) {
  return `${node.name}\0${node.filePath}`;
}

async function collectCalleeClosure({
  cwd,
  initialCollected,
  execute,
  inspectAffectedPath,
}) {
  const queueByKey = new Map();
  let complete = true;
  for (const outcome of initialCollected.outcomes) {
    if (outcome.operation !== 'callees' || outcome.outcome !== 'ready'
      || !plainRecord(outcome.data) || !Array.isArray(outcome.data.callees)) continue;
    for (const entry of outcome.data.callees) {
      const node = observedGraphNode(entry);
      if (node === null) complete = false;
      else queueByKey.set(graphNodeKey(node), node);
    }
  }
  const seen = new Set();
  const expansions = [];
  while (queueByKey.size > 0) {
    if (seen.size >= GRAPH_NODE_LIMIT) {
      complete = false;
      break;
    }
    const [key, node] = [...queueByKey.entries()]
      .sort((left, right) => compareText(left[0], right[0]))[0];
    queueByKey.delete(key);
    if (seen.has(key)) continue;
    seen.add(key);
    const token = sha16(key);
    const querySet = {
      queries: [
        { id: `seam-expand-callees-${token}`, operation: 'callees', target: node.name },
        { id: `seam-expand-query-${token}`, operation: 'query', target: node.name },
        { id: `seam-expand-status-${token}`, operation: 'status' },
      ].sort((left, right) => compareText(left.id, right.id)),
    };
    const collected = await collectSensorEvidence({
      cwd,
      querySet,
      ...(execute === undefined ? {} : { execute }),
      ...(inspectAffectedPath === undefined ? {} : { inspectAffectedPath }),
    });
    const queryOutcome = collected.outcomes.find(({ operation }) => operation === 'query');
    const calleeOutcome = collected.outcomes.find(({ operation }) => operation === 'callees');
    const exactPaths = Array.isArray(queryOutcome?.data)
      ? sortedUnique(queryOutcome.data.map(observedGraphNode)
        .filter((entry) => entry !== null && entry.name === node.name)
        .map(({ filePath }) => filePath))
      : [];
    const resolutionPaths = Array.isArray(calleeOutcome?.resolution)
      ? sortedUnique(calleeOutcome.resolution.map(observedGraphNode)
        .filter((entry) => entry !== null && entry.name === node.name)
        .map(({ filePath }) => filePath))
      : [];
    const exact = queryOutcome?.outcome === 'ready'
      && calleeOutcome?.outcome === 'ready'
      && exactPaths.length === 1
      && resolutionPaths.length === 1
      && exactPaths[0] === node.filePath
      && resolutionPaths[0] === node.filePath
      && plainRecord(calleeOutcome.data)
      && Array.isArray(calleeOutcome.data.callees);
    expansions.push({
      parent: node,
      query_outcome: queryOutcome ?? null,
      callees_outcome: calleeOutcome ?? null,
      exact,
    });
    if (!exact) {
      complete = false;
      continue;
    }
    for (const entry of calleeOutcome.data.callees) {
      const child = observedGraphNode(entry);
      if (child === null) {
        complete = false;
        continue;
      }
      const childKey = graphNodeKey(child);
      if (!seen.has(childKey)) queueByKey.set(childKey, child);
    }
  }
  return {
    complete: complete && queueByKey.size === 0,
    node_limit: GRAPH_NODE_LIMIT,
    expansions,
  };
}

/**
 * Collect through the bundled sensor adapter. The normalized evidence remains the only
 * contract-shaped artifact; raw outcomes are returned on a separate, in-memory channel for
 * structural cut enumeration and must not be embedded in lattice.seam_proposal.v2.
 */
export async function collectSeamProposalEvidenceBundle({
  cwd,
  querySet,
  execute = undefined,
  inspectAffectedPath = undefined,
} = {}) {
  const collected = await collectSensorEvidence({
    cwd,
    querySet,
    ...(execute === undefined ? {} : { execute }),
    ...(inspectAffectedPath === undefined ? {} : { inspectAffectedPath }),
  });
  const graphClosure = await collectCalleeClosure({
    cwd,
    initialCollected: collected,
    execute,
    inspectAffectedPath,
  });
  return {
    evidence: normalizeSeamProposalEvidence({ querySet, collected }),
    raw_collected: {
      ...collected,
      graph_closure: graphClosure,
    },
  };
}

/** Backward-compatible normalized-only collection entry point. */
export async function collectSeamProposalEvidence(options = {}) {
  const bundle = await collectSeamProposalEvidenceBundle(options);
  return bundle.evidence;
}
