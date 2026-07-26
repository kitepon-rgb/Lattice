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
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

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

/**
 * Build the schema-less `lattice.run_request.v1.sensor_query_set` vocabulary used by
 * todo-independence. The wrapper records non-code conflicts without putting their targets
 * on the sensor command line.
 */
export function buildSeamProposalQuerySet({ conflictResources } = {}) {
  const resources = assertConflictResources(conflictResources);
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
  if (paths.length !== 1) return { outcome: 'unknown' };
  return { outcome: 'resolved', resolved_name: target, resolved_path: paths[0] };
}

function symbolResolutionForEvidence(local, canonical) {
  if (canonical.outcome === 'unknown') return { outcome: 'unknown' };
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

/** Collect through the bundled sensor adapter and normalize into seam proposal evidence. */
export async function collectSeamProposalEvidence({
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
  return normalizeSeamProposalEvidence({ querySet, collected });
}
