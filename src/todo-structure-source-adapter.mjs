import { digestTodoArtifact, todoSelfDigest } from './todo-contracts.mjs';
import { explainTodoStructureSet } from './todo-structure-contracts.mjs';
import { collectSensorEvidence, portableSensorOutcome } from './sensor-adapter.mjs';

export const TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA = 'lattice.todo_structure_source_projection.v1';
export const TODO_STRUCTURE_SOURCE_LIMITS = Object.freeze({
  edgesPerDirection: 128,
  sensorTraversalLimit: 200,
});

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertStructureSet(structureSet) {
  const result = explainTodoStructureSet(structureSet);
  if (!result.valid) {
    throw new TypeError(`structureSetがcontractを満たさない: ${result.reason} ${result.path}`);
  }
}

function queryId(operation, target = '', exactPath = null) {
  if (operation === 'status') return 'structure-status';
  return `structure-${operation}-${digestTodoArtifact({ operation, target, exact_path: exactPath }).slice(0, 64)}`;
}

function queryFor(operation, target = undefined, exactPath = null) {
  return operation === 'status'
    ? { id: queryId(operation), operation }
    : {
      id: queryId(operation, target, exactPath), operation, target,
      ...(['callers', 'callees'].includes(operation) ? { exact_path: exactPath } : {}),
    };
}

function graphAnchors(structureSet, effectiveTransforms = null) {
  return structureSet.tasks
    .filter(({ applicability }) => applicability === 'graph')
    .flatMap(({ task_id: taskId, planned }) => (
      effectiveTransforms?.get(taskId) ?? planned
    ).code_anchors.map((anchor) => ({
      task_id: taskId,
      ...anchor,
    })));
}

/**
 * structure anchorを既存LatticeSensorの公開queryだけへ決定的に変換する。
 * parser、index、node ID、edge抽出はここでは所有しない。
 */
export function buildTodoStructureSensorQuerySet(structureSet, { effectiveTransforms = null } = {}) {
  assertStructureSet(structureSet);
  const anchors = graphAnchors(structureSet, effectiveTransforms);
  const paths = [...new Set(anchors.map(({ path }) => path))].sort(compareText);
  const symbols = [...new Set(anchors
    .map(({ symbol }) => symbol)
    .filter((symbol) => symbol !== null))].sort(compareText);
  const pathsBySymbol = new Map(symbols.map((symbol) => [symbol, [...new Set(anchors
    .filter((anchor) => anchor.symbol === symbol)
    .map(({ path: anchorPath }) => anchorPath))].sort(compareText)]));
  return {
    queries: [
      queryFor('status'),
      ...paths.map((target) => queryFor('affected', target)),
      ...symbols.flatMap((target) => [
        queryFor('query', target),
        ...pathsBySymbol.get(target).flatMap((anchorPath) => [
          queryFor('callers', target, anchorPath),
          queryFor('callees', target, anchorPath),
        ]),
      ]),
    ],
  };
}

/** runtime-front-endと同じportable evidence identityを作る公開入口。 */
export function todoStructurePortableEvidenceDigest(query, outcome) {
  if (!isPlain(query) || !isPlain(outcome)
    || outcome.id !== query.id || outcome.operation !== query.operation
    || typeof outcome.outcome !== 'string') {
    throw new TypeError('queryとsensor outcomeが一致しない');
  }
  return digestTodoArtifact({
    query_id: query.id,
    operation: query.operation,
    status: outcome.outcome,
    portable: portableSensorOutcome(outcome),
  });
}

function indexOutcomes(querySet, collected) {
  if (!isPlain(collected) || !Array.isArray(collected.outcomes)
    || collected.outcomes.length !== querySet.queries.length) {
    throw new TypeError('collected sensor evidenceがquery setと一致しない');
  }
  const outcomes = new Map();
  querySet.queries.forEach((query, index) => {
    const outcome = collected.outcomes[index];
    if (!isPlain(outcome) || outcome.id !== query.id || outcome.operation !== query.operation
      || typeof outcome.outcome !== 'string' || outcomes.has(query.id)) {
      throw new TypeError(`collected sensor outcomeがqueryと一致しない: ${query.id}`);
    }
    outcomes.set(query.id, outcome);
  });
  return outcomes;
}

function evidenceRef(query, outcome) {
  return {
    query_id: query.id,
    portable_digest: todoStructurePortableEvidenceDigest(query, outcome),
  };
}

function pathObservation(query, outcome, target) {
  const result = Array.isArray(outcome.targets) && outcome.targets.length === 1
    ? outcome.targets[0]
    : null;
  if (!isPlain(result) || result.target !== target) {
    return { existence: 'unknown', reason: 'STRUCTURE_SENSOR_PATH_UNRESOLVED' };
  }
  if (result.path_state === 'absent') {
    return { existence: 'absent', reason: null };
  }
  if (['ready', 'empty'].includes(result.outcome) && !Object.hasOwn(result, 'path_state')) {
    return { existence: 'present', reason: null };
  }
  return { existence: 'unknown', reason: 'STRUCTURE_SENSOR_PATH_UNRESOLVED' };
}

function naturalNode(candidate) {
  const node = candidate?.node;
  if (!isPlain(node) || typeof node.name !== 'string' || node.name.length === 0
    || typeof node.kind !== 'string' || node.kind.length === 0
    || typeof node.filePath !== 'string' || node.filePath.length === 0) return null;
  return {
    kind: node.kind,
    path: node.filePath,
    name: node.name,
    qualified_name: typeof node.qualifiedName === 'string' ? node.qualifiedName : null,
    start_line: Number.isSafeInteger(node.startLine) ? node.startLine : null,
    end_line: Number.isSafeInteger(node.endLine) ? node.endLine : null,
  };
}

function sameNode(left, right) {
  return left !== null && right !== null
    && left.kind === right.kind && left.path === right.path && left.name === right.name
    && left.qualified_name === right.qualified_name
    && left.start_line === right.start_line && left.end_line === right.end_line;
}

function symbolObservation(outcome, anchor) {
  if (outcome.outcome === 'symbol_absent') {
    return { existence: 'absent', node: null, candidates: [], reason: null };
  }
  if (outcome.outcome !== 'ready' || !Array.isArray(outcome.data)) {
    return { existence: 'unknown', node: null, candidates: [], reason: 'STRUCTURE_SENSOR_SYMBOL_UNRESOLVED' };
  }
  if (outcome.data.length > 1) {
    const candidates = outcome.data.map(naturalNode);
    if (candidates.some((candidate) => candidate === null)) {
      return { existence: 'unknown', node: null, candidates: [], reason: 'STRUCTURE_SENSOR_SYMBOL_MALFORMED' };
    }
    return { existence: 'unknown', node: null, candidates, reason: 'STRUCTURE_CODE_ANCHOR_AMBIGUOUS' };
  }
  if (outcome.data.length === 0) {
    return { existence: 'absent', node: null, candidates: [], reason: null };
  }
  const node = naturalNode(outcome.data[0]);
  if (node === null) {
    return { existence: 'unknown', node: null, candidates: [], reason: 'STRUCTURE_SENSOR_SYMBOL_MALFORMED' };
  }
  if (node.path !== anchor.path) {
    return { existence: 'absent', node: null, candidates: [], reason: null };
  }
  return { existence: 'present', node, candidates: [node], reason: null };
}

function naturalEdge(entry) {
  if (!isPlain(entry) || typeof entry.name !== 'string' || entry.name.length === 0
    || typeof entry.kind !== 'string' || entry.kind.length === 0
    || typeof entry.filePath !== 'string' || entry.filePath.length === 0
    || typeof entry.edgeKind !== 'string' || entry.edgeKind.length === 0
    || typeof entry.valueRef !== 'boolean' || typeof entry.valueWrite !== 'boolean') return null;
  return {
    kind: entry.kind,
    path: entry.filePath,
    name: entry.name,
    start_line: Number.isSafeInteger(entry.startLine) ? entry.startLine : null,
    edge_kind: entry.edgeKind,
    value_ref: entry.valueRef,
    value_write: entry.valueWrite,
  };
}

function edgeObservation(outcome, expectedNode, direction, expectedPath) {
  const key = direction === 'incoming' ? 'callers' : 'callees';
  if (outcome.outcome !== 'ready' || !Array.isArray(outcome.resolution)
    || outcome.resolution.length !== 1 || !sameNode(naturalNode(outcome.resolution[0]), expectedNode)
    || !isPlain(outcome.data) || outcome.data.exactPath !== expectedPath
    || outcome.data.exactResolution !== 'ready' || !Array.isArray(outcome.data[key])) {
    return {
      state: 'unknown', edges: [], omitted_count: 0, source_limit_reached: false,
      reason: 'STRUCTURE_SENSOR_EDGE_UNRESOLVED',
    };
  }
  const edges = outcome.data[key].map(naturalEdge);
  if (edges.some((entry) => entry === null)) {
    return {
      state: 'unknown', edges: [], omitted_count: 0, source_limit_reached: false,
      reason: 'STRUCTURE_SENSOR_EDGE_MALFORMED',
    };
  }
  edges.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  const projected = edges.slice(0, TODO_STRUCTURE_SOURCE_LIMITS.edgesPerDirection);
  return {
    state: 'complete',
    edges: projected,
    omitted_count: edges.length - projected.length,
    source_limit_reached: edges.length >= TODO_STRUCTURE_SOURCE_LIMITS.sensorTraversalLimit,
    reason: null,
  };
}

function effectVerdict(anchor, existence) {
  if (anchor.expected_at !== 'current') {
    return { verdict: 'unknown', reason: 'STRUCTURE_CODE_ANCHOR_TIME_DEFERRED' };
  }
  if (existence === 'unknown') {
    return { verdict: 'unknown', reason: 'STRUCTURE_CODE_ANCHOR_UNRESOLVED' };
  }
  if (anchor.effect === 'create') {
    return existence === 'absent'
      ? { verdict: 'consistent', reason: null }
      : { verdict: 'inconsistent', reason: 'STRUCTURE_CREATE_ALREADY_EXISTS' };
  }
  return existence === 'present'
    ? { verdict: 'consistent', reason: null }
    : { verdict: 'inconsistent', reason: 'STRUCTURE_CODE_ANCHOR_ABSENT' };
}

function unknownAnchor(anchor, evidence, reason) {
  return {
    task_id: anchor.task_id,
    anchor_id: anchor.anchor_id,
    effect: anchor.effect,
    expected_at: anchor.expected_at,
    path: anchor.path,
    symbol: anchor.symbol,
    verdict: 'unknown',
    reason,
    existence: 'unknown',
    coverage: 'unknown',
    node: null,
    candidates: [],
    edges: {
      state: anchor.symbol === null ? 'not_applicable' : 'unknown',
      incoming: [], outgoing: [], incoming_omitted: 0, outgoing_omitted: 0,
      incoming_source_limit_reached: false, outgoing_source_limit_reached: false,
    },
    evidence,
  };
}

function projectAnchor({ anchor, querySet, outcomes, statusReady }) {
  const pathQuery = queryFor('affected', anchor.path);
  const pathOutcome = outcomes.get(pathQuery.id);
  const evidence = {
    status: evidenceRef(querySet.queries[0], outcomes.get(querySet.queries[0].id)),
    path: evidenceRef(pathQuery, pathOutcome),
    symbol: null,
    callers: null,
    callees: null,
  };
  if (!statusReady) return unknownAnchor(anchor, evidence, 'STRUCTURE_SENSOR_NOT_READY');

  const pathResult = pathObservation(pathQuery, pathOutcome, anchor.path);
  if (anchor.symbol === null) {
    const decision = effectVerdict(anchor, pathResult.existence);
    return {
      ...unknownAnchor(anchor, evidence, decision.reason),
      verdict: decision.verdict,
      reason: pathResult.reason ?? decision.reason,
      existence: pathResult.existence,
      coverage: pathResult.existence === 'unknown'
        ? 'unknown'
        : pathResult.existence === 'absent'
          ? anchor.effect === 'create' && decision.verdict === 'consistent'
            ? 'expected_absence' : 'observed_absence'
          : 'path_only',
    };
  }

  const symbolQuery = queryFor('query', anchor.symbol);
  const callersQuery = queryFor('callers', anchor.symbol, anchor.path);
  const calleesQuery = queryFor('callees', anchor.symbol, anchor.path);
  const symbolOutcome = outcomes.get(symbolQuery.id);
  const callersOutcome = outcomes.get(callersQuery.id);
  const calleesOutcome = outcomes.get(calleesQuery.id);
  evidence.symbol = evidenceRef(symbolQuery, symbolOutcome);
  evidence.callers = evidenceRef(callersQuery, callersOutcome);
  evidence.callees = evidenceRef(calleesQuery, calleesOutcome);
  const symbolResult = symbolObservation(symbolOutcome, anchor);
  if (pathResult.existence === 'absent' && symbolResult.existence === 'present') {
    return unknownAnchor(anchor, evidence, 'STRUCTURE_SENSOR_EVIDENCE_CONFLICT');
  }
  if (symbolResult.reason !== null) return {
    ...unknownAnchor(anchor, evidence, symbolResult.reason),
    candidates: symbolResult.candidates,
  };

  const decision = effectVerdict(anchor, symbolResult.existence);
  if (symbolResult.existence !== 'present') {
    return {
      ...unknownAnchor(anchor, evidence, decision.reason),
      verdict: decision.verdict,
      reason: decision.reason,
      existence: symbolResult.existence,
      coverage: symbolResult.existence === 'absent'
        ? anchor.effect === 'create' && decision.verdict === 'consistent'
          ? 'expected_absence' : 'observed_absence'
        : 'unknown',
    };
  }
  const incoming = edgeObservation(callersOutcome, symbolResult.node, 'incoming', anchor.path);
  const outgoing = edgeObservation(calleesOutcome, symbolResult.node, 'outgoing', anchor.path);
  const edgeUnknown = incoming.state === 'unknown' || outgoing.state === 'unknown';
  return {
    task_id: anchor.task_id,
    anchor_id: anchor.anchor_id,
    effect: anchor.effect,
    expected_at: anchor.expected_at,
    path: anchor.path,
    symbol: anchor.symbol,
    verdict: edgeUnknown && decision.verdict === 'consistent' ? 'unknown' : decision.verdict,
    reason: edgeUnknown && decision.verdict === 'consistent'
      ? incoming.reason ?? outgoing.reason : decision.reason,
    existence: 'present',
    coverage: 'exact_symbol',
    node: symbolResult.node,
    candidates: symbolResult.candidates,
    edges: {
      state: edgeUnknown ? 'unknown' : 'complete',
      incoming: incoming.edges,
      outgoing: outgoing.edges,
      incoming_omitted: incoming.omitted_count,
      outgoing_omitted: outgoing.omitted_count,
      incoming_source_limit_reached: incoming.source_limit_reached,
      outgoing_source_limit_reached: outgoing.source_limit_reached,
    },
    evidence,
  };
}

/** 収集済みsensor outcomeから、anchor到達範囲だけのbounded projectionを作る。 */
export function projectTodoStructureSourceEvidence({
  structureSet, collected, effectiveTransforms = null,
} = {}) {
  assertStructureSet(structureSet);
  const querySet = buildTodoStructureSensorQuerySet(structureSet, { effectiveTransforms });
  const outcomes = indexOutcomes(querySet, collected);
  const statusQuery = querySet.queries[0];
  const statusOutcome = outcomes.get(statusQuery.id);
  const anchors = graphAnchors(structureSet, effectiveTransforms).map((anchor) => projectAnchor({
    anchor, querySet, outcomes, statusReady: statusOutcome.outcome === 'ready',
  }));
  const projection = {
    schema: TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA,
    structure_set_digest: structureSet.structure_set_digest,
    sensor_status: {
      outcome: statusOutcome.outcome,
      evidence: evidenceRef(statusQuery, statusOutcome),
    },
    anchors,
    summary: {
      graph_tasks: structureSet.tasks.filter(({ applicability }) => applicability === 'graph').length,
      excluded_tasks: structureSet.tasks.filter(({ applicability }) => applicability === 'excluded').length,
      projected_anchors: anchors.length,
      omitted_anchors: 0,
      incoming_edges_omitted: anchors.reduce((sum, anchor) => sum + anchor.edges.incoming_omitted, 0),
      outgoing_edges_omitted: anchors.reduce((sum, anchor) => sum + anchor.edges.outgoing_omitted, 0),
    },
    projection_digest: '',
  };
  projection.projection_digest = todoSelfDigest(projection, 'projection_digest');
  return projection;
}

/** 実sensor収集とpure projectionを同じ既存adapter経由で行う。 */
export async function collectTodoStructureSourceEvidence({
  cwd, structureSet, effectiveTransforms = null,
  execute = undefined, inspectAffectedPath = undefined,
} = {}) {
  const querySet = buildTodoStructureSensorQuerySet(structureSet, { effectiveTransforms });
  const collected = await collectSensorEvidence({
    cwd,
    querySet,
    ...(execute === undefined ? {} : { execute }),
    ...(inspectAffectedPath === undefined ? {} : { inspectAffectedPath }),
  });
  return {
    query_set: querySet,
    projection: projectTodoStructureSourceEvidence({ structureSet, collected, effectiveTransforms }),
  };
}
