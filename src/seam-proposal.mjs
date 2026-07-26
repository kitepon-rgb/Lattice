import { createHash } from 'node:crypto';

import { digestArtifact } from './artifact-contracts.mjs';
import { portableSensorOutcome } from './sensor-adapter.mjs';
import {
  SEAM_PROPOSAL_SCHEMA,
  deriveSeamProposalId,
  validateSeamProposal,
} from './seam-proposal-contracts.mjs';
import {
  synthesizeWitnessRunRequest,
  validateTodoIndependence,
  validateTodoWitnessSet,
} from './todo-independence-contracts.mjs';
import {
  digestTodoArtifact,
  todoSelfDigest,
  validateTodoPlan,
} from './todo-contracts.mjs';
import {
  selfDigest,
  validateRunRequest,
} from './runtime-contracts.mjs';

const WITNESS_FIELDS = Object.freeze([
  'owns',
  'reads',
  'writes',
  'resources',
  'state_effects',
  'sensor_provenance',
  'affected_tests',
  'unknowns',
]);
const STATE_KIND_MAP = Object.freeze({
  state: 'state',
  schema: 'state',
  invariant: 'state',
  effect: 'effect',
  external_effect: 'effect',
});
const STRUCTURE_OPERATIONS = new Set(['query', 'callers', 'callees', 'impact']);
const HYPOTHESIS_PROVENANCE = 'extraction_hypothesis';

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function fail(reason) {
  throw new TypeError(`seam proposal producer契約違反: ${reason}`);
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

function sha16(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function resourceKey(value) {
  return `${value.kind}\0${value.target}`;
}

function surfaceKey(value) {
  return `${value.kind}\0${value.target}\0${value.path}\0${value.role}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function isSubset(left, right) {
  return [...left].every((value) => right.has(value));
}

function pathPrefixOverlap(left, right) {
  const leftIsPrefix = left.endsWith('/');
  const rightIsPrefix = right.endsWith('/');
  if (left === right) return true;
  if (leftIsPrefix && (right === left.slice(0, -1) || right.startsWith(left))) return true;
  if (rightIsPrefix && (left === right.slice(0, -1) || left.startsWith(right))) return true;
  return false;
}

function withWitness(request, manualWitness) {
  const virtualRequest = structuredClone(request);
  virtualRequest.manual_witness = structuredClone(manualWitness);
  virtualRequest.request_digest = '';
  virtualRequest.request_digest = selfDigest(virtualRequest, 'request_digest');
  if (!validateRunRequest(virtualRequest)) fail('virtual witnessがrun_request.v1を満たさない');
  return virtualRequest;
}

/**
 * Clone the original witness and apply a closed, full-field ownership diff.
 * A task patch containing only `owns` is deliberately rejected.
 */
export function buildVirtualWitness({ request, ownershipDiff } = {}) {
  if (!validateRunRequest(request)) fail('requestがrun_request.v1を満たさない');
  if (!Array.isArray(ownershipDiff)) fail('ownershipDiffがarrayではない');
  const taskIds = new Set(request.todos.map(({ todo_id: todoId }) => todoId));
  const seen = new Set();
  const virtualWitness = structuredClone(request.manual_witness);
  for (const patch of ownershipDiff) {
    if (!exactRecord(patch, ['todo_id', ...WITNESS_FIELDS])
      || !taskIds.has(patch.todo_id)
      || seen.has(patch.todo_id)) {
      fail('ownershipDiff entryがclosed full-field shapeではない');
    }
    seen.add(patch.todo_id);
    virtualWitness[patch.todo_id] = Object.fromEntries(
      WITNESS_FIELDS.map((field) => [field, structuredClone(patch[field])]),
    );
  }
  withWitness(request, virtualWitness);
  return virtualWitness;
}

function normalizeQueries(request) {
  const byId = new Map();
  for (const query of request.sensor_query_set.queries) {
    if (byId.has(query.id)) fail(`query idが重複している: ${query.id}`);
    byId.set(query.id, query);
  }
  return byId;
}

function normalizeEvidence(request, sensorEvidence) {
  if (!exactRecord(sensorEvidence, ['outcomes'])
    || !Array.isArray(sensorEvidence.outcomes)
    || sensorEvidence.outcomes.length !== request.sensor_query_set.queries.length) {
    fail('sensorEvidenceがquery setとexact整合しない');
  }
  const byId = new Map();
  request.sensor_query_set.queries.forEach((query, index) => {
    const outcome = sensorEvidence.outcomes[index];
    if (!exactRecord(outcome, ['query_id', 'operation', 'status', 'raw'])
      || outcome.query_id !== query.id
      || outcome.operation !== query.operation
      || typeof outcome.status !== 'string'
      || outcome.status.length === 0) {
      fail(`sensorEvidence outcomeがquery ${query.id}とexact整合しない`);
    }
    const portable = portableSensorOutcome(outcome.raw);
    byId.set(query.id, {
      ...outcome,
      portable_digest: digestArtifact({
        query_id: outcome.query_id,
        operation: outcome.operation,
        status: outcome.status,
        portable,
      }),
    });
  });
  return byId;
}

function bindingMatchesQuery(binding, query) {
  if (query === undefined) return false;
  const { expect } = binding;
  if (expect.kind === 'affected') {
    return query.operation === 'affected' && query.target === expect.path;
  }
  if (expect.kind === 'symbol') {
    return STRUCTURE_OPERATIONS.has(query.operation) && query.target === expect.name;
  }
  return (STRUCTURE_OPERATIONS.has(query.operation) || query.operation === 'affected')
    && query.target === expect.path;
}

function rawPayload(raw) {
  return plainRecord(raw) && Object.hasOwn(raw, 'data') ? raw.data : raw;
}

function affectedPayload(raw, expectPath) {
  if (plainRecord(raw) && Array.isArray(raw.targets)) {
    const entry = raw.targets.find((candidate) => (
      plainRecord(candidate) && candidate.target === expectPath
    ));
    return plainRecord(entry) && plainRecord(entry.data) ? entry.data : null;
  }
  const payload = rawPayload(raw);
  return plainRecord(payload) ? payload : null;
}

function affectedTarget(raw, expectPath) {
  if (!plainRecord(raw) || !Array.isArray(raw.targets)) return null;
  const entry = raw.targets.find((candidate) => (
    plainRecord(candidate) && candidate.target === expectPath
  ));
  return plainRecord(entry) ? entry : null;
}

function entryNode(entry) {
  if (plainRecord(entry) && plainRecord(entry.node)) return entry.node;
  return plainRecord(entry) ? entry : null;
}

function resolveBindingStatus(binding, outcome) {
  if (outcome.status !== 'ready') return outcome.status;
  const { expect } = binding;
  if (expect.kind === 'affected') {
    if (affectedTarget(outcome.raw, expect.path)?.path_state === 'absent') return 'path_absent';
    const payload = affectedPayload(outcome.raw, expect.path);
    if (payload === null
      || !Array.isArray(payload.changedFiles)
      || payload.changedFiles.length !== 1
      || payload.changedFiles[0] !== expect.path) {
      return 'empty';
    }
    return 'ready';
  }
  const payload = rawPayload(outcome.raw);
  if (!Array.isArray(payload)) return 'invalid_json';
  if (expect.kind === 'symbol') {
    const matches = payload.filter((entry) => {
      const node = entryNode(entry);
      return node !== null && node.name === expect.name && node.filePath === expect.path;
    });
    if (matches.length === 1) return 'ready';
    return matches.length === 0 ? 'symbol_absent' : 'unresolved';
  }
  const matches = payload.filter((entry) => entryNode(entry)?.filePath === expect.path);
  return matches.length >= 1 ? 'ready' : 'empty';
}

function bindingCoversOwn(binding, own) {
  if (own.kind === 'symbol') {
    return binding.expect.kind === 'symbol' && binding.expect.name === own.target;
  }
  return (binding.expect.kind === 'path' || binding.expect.kind === 'affected')
    && binding.expect.path === own.target;
}

function normalizeHypotheses(surfaceHypotheses, manualWitness) {
  if (!Array.isArray(surfaceHypotheses)) fail('surfaceHypothesesがarrayではない');
  const taskIds = new Set(Object.keys(manualWitness));
  const hypotheses = surfaceHypotheses.map((entry) => {
    if (!exactRecord(entry, [
      'kind', 'target', 'path', 'owner_task_id', 'affected_tests', 'provenance',
    ])
      || !['symbol', 'path'].includes(entry.kind)
      || typeof entry.target !== 'string'
      || typeof entry.path !== 'string'
      || !taskIds.has(entry.owner_task_id)
      || !Array.isArray(entry.affected_tests)
      || entry.provenance !== HYPOTHESIS_PROVENANCE) {
      fail('surface hypothesis shapeが不正');
    }
    if (entry.kind === 'path' && entry.target !== entry.path) {
      fail('path hypothesisのtargetとpathが一致しない');
    }
    const witness = manualWitness[entry.owner_task_id];
    if (!witness.owns.some((own) => resourceKey(own) === `${entry.kind}\0${entry.target}`)
      || !witness.writes.includes(entry.path)
      || entry.affected_tests.some((path) => !witness.affected_tests.includes(path))) {
      fail('surface hypothesisが完全なvirtual witnessへ反映されていない');
    }
    return {
      ...structuredClone(entry),
      affected_tests: [...entry.affected_tests].sort(compareText),
    };
  }).sort((left, right) => compareText(
    `${left.owner_task_id}\0${left.kind}\0${left.target}`,
    `${right.owner_task_id}\0${right.kind}\0${right.target}`,
  ));
  const keys = hypotheses.map((entry) => (
    `${entry.owner_task_id}\0${entry.kind}\0${entry.target}`
  ));
  if (new Set(keys).size !== keys.length) fail('surface hypothesisが重複している');
  return hypotheses;
}

function hypothesisForOwn(hypotheses, todoId, own) {
  return hypotheses.find((entry) => (
    entry.owner_task_id === todoId
      && entry.kind === own.kind
      && entry.target === own.target
  ));
}

function hypothesisForBinding(hypotheses, todoId, binding) {
  return hypotheses.find((entry) => (
    entry.owner_task_id === todoId
      && ((binding.expect.kind === 'symbol'
        && entry.kind === 'symbol'
        && entry.target === binding.expect.name
        && entry.path === binding.expect.path)
        || (['path', 'affected'].includes(binding.expect.kind)
          && entry.kind === 'path'
          && entry.path === binding.expect.path))
  ));
}

function manualProvenance(request) {
  return {
    source: 'manual_state_effect',
    evidence_ref: `run-request:${request.request_id}`,
    evidence_digest: request.request_digest,
    status: 'asserted',
  };
}

function candidateProvenance(request) {
  return {
    source: 'manual_candidate_spec',
    evidence_ref: `run-request:${request.request_id}`,
    evidence_digest: request.request_digest,
    status: 'asserted',
  };
}

function derivationResult({
  outcome,
  virtualWitness,
  hypotheses,
  resources = [],
  conflicts = [],
  unknowns = [],
  unresolvedWitnesses = [],
  drift = [],
}) {
  const result = {
    outcome,
    resources,
    conflicts,
    unknowns,
    unresolved_witnesses: unresolvedWitnesses,
    drift,
  };
  return {
    virtual_witness: virtualWitness,
    surface_hypotheses: hypotheses,
    ...result,
    input_digest: digestArtifact({
      virtual_witness: virtualWitness,
      surface_hypotheses: hypotheses,
    }),
    result_digest: digestArtifact(result),
  };
}

/**
 * Pure duplicate of runtime-front-end's resource lowering. Existing surfaces retain real
 * sensor provenance; absent/new surfaces can only be represented by an explicit extraction
 * hypothesis and are never relabelled as observed sensor nodes.
 */
export function deriveVirtualBoundary({
  request,
  sensorEvidence,
  virtualWitness = request?.manual_witness,
  surfaceHypotheses = [],
} = {}) {
  const virtualRequest = withWitness(request, virtualWitness);
  const hypotheses = normalizeHypotheses(surfaceHypotheses, virtualRequest.manual_witness);
  const queryById = normalizeQueries(virtualRequest);
  const outcomeById = normalizeEvidence(virtualRequest, sensorEvidence);
  const todoIds = virtualRequest.todos.map(({ todo_id: todoId }) => todoId);
  const bindingsByTodo = new Map();
  const drift = [];

  for (const todoId of todoIds) {
    const bindings = virtualRequest.manual_witness[todoId].sensor_provenance.queries;
    bindingsByTodo.set(todoId, bindings);
    for (const binding of bindings) {
      if (!bindingMatchesQuery(binding, queryById.get(binding.query_id))) {
        drift.push({
          kind: 'query_drift',
          todo_id: todoId,
          ref: binding.query_id,
        });
      }
    }
  }
  const statusQueries = [...queryById.values()]
    .filter((query) => query.operation === 'status');
  if (statusQueries.length !== 1) {
    drift.push({ kind: 'query_drift', todo_id: todoIds[0], ref: 'status_query_count' });
  }
  if (drift.length > 0) {
    return derivationResult({
      outcome: 'query_drift',
      virtualWitness: virtualRequest.manual_witness,
      hypotheses,
      drift: drift.sort((left, right) => compareText(
        `${left.todo_id}\0${left.kind}\0${left.ref}`,
        `${right.todo_id}\0${right.kind}\0${right.ref}`,
      )),
    });
  }

  const statusOutcome = outcomeById.get(statusQueries[0].id);
  const unresolved = [];
  if (statusOutcome.status !== 'ready') {
    for (const todoId of todoIds) {
      unresolved.push({ todo_id: todoId, kind: `sensor_${statusOutcome.status}`, ref: statusQueries[0].id });
    }
  }

  for (const todoId of todoIds) {
    for (const binding of bindingsByTodo.get(todoId)) {
      const status = resolveBindingStatus(binding, outcomeById.get(binding.query_id));
      const hypothesis = hypothesisForBinding(hypotheses, todoId, binding);
      const hypothesisMayReplaceAbsence = hypothesis !== undefined
        && ['symbol_absent', 'path_absent', 'empty'].includes(status);
      if (status !== 'ready' && !hypothesisMayReplaceAbsence) {
        unresolved.push({ todo_id: todoId, kind: `sensor_${status}`, ref: binding.query_id });
      }
    }
  }

  const affectedDrift = [];
  for (const todoId of todoIds) {
    const witness = virtualRequest.manual_witness[todoId];
    for (const binding of bindingsByTodo.get(todoId)) {
      if (binding.expect.kind !== 'affected') continue;
      const outcome = outcomeById.get(binding.query_id);
      if (resolveBindingStatus(binding, outcome) !== 'ready') continue;
      const payload = affectedPayload(outcome.raw, binding.expect.path);
      const observed = Array.isArray(payload?.affectedTests)
        ? [...payload.affectedTests].sort(compareText)
        : null;
      const declared = [...witness.affected_tests].sort(compareText);
      if (observed === null
        || observed.length !== declared.length
        || observed.some((test, index) => test !== declared[index])) {
        affectedDrift.push({
          kind: 'affected_test_drift',
          todo_id: todoId,
          ref: binding.query_id,
        });
      }
    }
  }
  if (affectedDrift.length > 0) {
    return derivationResult({
      outcome: 'affected_test_drift',
      virtualWitness: virtualRequest.manual_witness,
      hypotheses,
      drift: affectedDrift.sort((left, right) => compareText(
        `${left.todo_id}\0${left.ref}`, `${right.todo_id}\0${right.ref}`,
      )),
    });
  }

  const ownGroups = new Map();
  const coveringByTarget = new Map();
  for (const todoId of todoIds) {
    const witness = virtualRequest.manual_witness[todoId];
    for (const own of witness.owns) {
      const key = `${own.kind} ${own.target}`;
      if (!ownGroups.has(key)) {
        ownGroups.set(key, {
          own,
          todoIds: [],
          hypotheticalTodoIds: new Set(),
        });
      }
      const group = ownGroups.get(key);
      group.todoIds.push(todoId);
      const covering = bindingsByTodo.get(todoId).filter((binding) => bindingCoversOwn(binding, own));
      for (const binding of covering) {
        const seen = coveringByTarget.get(key);
        if (seen === undefined) coveringByTarget.set(key, binding.query_id);
        else if (seen !== binding.query_id) {
          drift.push({ kind: 'query_drift', todo_id: todoId, ref: `${seen} ${binding.query_id}` });
        }
      }
      const hypothesis = hypothesisForOwn(hypotheses, todoId, own);
      if (hypothesis !== undefined) group.hypotheticalTodoIds.add(todoId);
      if (covering.length === 0 && hypothesis === undefined) {
        unresolved.push({ todo_id: todoId, kind: 'sensor_unbound', ref: `${own.kind}:${own.target}` });
      }
    }
  }
  if (drift.length > 0) {
    return derivationResult({
      outcome: 'query_drift',
      virtualWitness: virtualRequest.manual_witness,
      hypotheses,
      drift,
    });
  }

  for (let left = 0; left < todoIds.length; left += 1) {
    for (let right = left + 1; right < todoIds.length; right += 1) {
      const leftWitness = virtualRequest.manual_witness[todoIds[left]];
      const rightWitness = virtualRequest.manual_witness[todoIds[right]];
      const leftOwnPaths = new Set(leftWitness.owns
        .filter((own) => own.kind === 'path').map((own) => own.target));
      const rightOwnPaths = new Set(rightWitness.owns
        .filter((own) => own.kind === 'path').map((own) => own.target));
      for (const leftPath of leftWitness.writes) {
        for (const rightPath of rightWitness.writes) {
          if (!pathPrefixOverlap(leftPath, rightPath)) continue;
          if (leftOwnPaths.has(leftPath) && rightOwnPaths.has(rightPath)
            && leftPath === rightPath) continue;
          unresolved.push({
            todo_id: todoIds[left],
            kind: 'undeclared_write_overlap',
            ref: `${leftPath} ${rightPath}`,
          });
          unresolved.push({
            todo_id: todoIds[right],
            kind: 'undeclared_write_overlap',
            ref: `${leftPath} ${rightPath}`,
          });
        }
      }
    }
  }
  for (const todoId of todoIds) {
    for (const unknown of virtualRequest.manual_witness[todoId].unknowns) {
      unresolved.push({ todo_id: todoId, kind: unknown.kind, ref: unknown.ref });
    }
  }

  const readWriteGroups = new Map();
  for (let left = 0; left < todoIds.length; left += 1) {
    for (let right = 0; right < todoIds.length; right += 1) {
      if (left === right) continue;
      const writer = virtualRequest.manual_witness[todoIds[left]];
      const reader = virtualRequest.manual_witness[todoIds[right]];
      for (const writePath of writer.writes) {
        for (const readPath of reader.reads) {
          if (!pathPrefixOverlap(writePath, readPath)) continue;
          if (!readWriteGroups.has(writePath)) readWriteGroups.set(writePath, new Set());
          readWriteGroups.get(writePath).add(todoIds[left]);
          readWriteGroups.get(writePath).add(todoIds[right]);
        }
      }
    }
  }

  const bareResourceGroups = new Map();
  for (const todoId of todoIds) {
    const witness = virtualRequest.manual_witness[todoId];
    const stateIds = new Set(witness.state_effects.map(({ resource_id: id }) => id));
    for (const resourceId of witness.resources) {
      if (stateIds.has(resourceId)) continue;
      if (!bareResourceGroups.has(resourceId)) bareResourceGroups.set(resourceId, new Set());
      bareResourceGroups.get(resourceId).add(todoId);
    }
  }

  const resources = [];
  for (const [key, group] of [...ownGroups.entries()].sort((left, right) => compareText(left[0], right[0]))) {
    const coveringQueryId = coveringByTarget.get(key);
    const observedTodoIds = new Set();
    let outcome;
    let representative;
    if (coveringQueryId !== undefined) {
      outcome = outcomeById.get(coveringQueryId);
      for (const todoId of group.todoIds) {
        const binding = bindingsByTodo.get(todoId).find((entry) => (
          entry.query_id === coveringQueryId && bindingCoversOwn(entry, group.own)
        ));
        if (representative === undefined) representative = binding;
        if (binding !== undefined
          && statusOutcome.status === 'ready'
          && resolveBindingStatus(binding, outcome) === 'ready') {
          observedTodoIds.add(todoId);
        }
      }
    }
    const allObserved = group.todoIds.every((todoId) => observedTodoIds.has(todoId));
    const allCovered = group.todoIds.every((todoId) => (
      observedTodoIds.has(todoId) || group.hypotheticalTodoIds.has(todoId)
    ));
    const hasHypothetical = group.todoIds.some(
      (todoId) => group.hypotheticalTodoIds.has(todoId),
    );
    if (coveringQueryId === undefined && !allCovered) continue;
    const status = allObserved ? 'observed'
      : allCovered && hasHypothetical ? 'hypothetical' : 'unknown';
    const provenance = status === 'hypothetical'
      ? [{
        source: HYPOTHESIS_PROVENANCE,
        evidence_ref: `virtual-witness:${virtualRequest.request_id}`,
        evidence_digest: digestArtifact(hypotheses),
        status: 'hypothetical',
      }]
      : [
        candidateProvenance(virtualRequest),
        {
          source: 'sensor',
          evidence_ref: coveringQueryId,
          evidence_digest: outcome.portable_digest,
          status: statusOutcome.status !== 'ready'
            ? statusOutcome.status
            : resolveBindingStatus(representative, outcome),
        },
      ];
    resources.push({
      resource_id: `own-${group.own.kind}-${sha16(group.own.target)}`,
      kind: group.own.kind,
      target: group.own.target,
      todo_ids: [...group.todoIds].sort(compareText),
      provenance,
      status,
    });
  }

  const stateGroups = new Map();
  for (const todoId of todoIds) {
    for (const entry of virtualRequest.manual_witness[todoId].state_effects) {
      const kind = STATE_KIND_MAP[entry.kind];
      if (!stateGroups.has(entry.resource_id)) {
        stateGroups.set(entry.resource_id, { kind, todoIds: new Set() });
      }
      const group = stateGroups.get(entry.resource_id);
      if (group.kind !== kind) fail(`resource ${entry.resource_id}のstate/effect kindが矛盾している`);
      group.todoIds.add(todoId);
    }
  }
  for (const [resourceId, todos] of bareResourceGroups) {
    if (stateGroups.has(resourceId)) {
      for (const todoId of todos) stateGroups.get(resourceId).todoIds.add(todoId);
    } else {
      stateGroups.set(resourceId, { kind: 'state', todoIds: todos });
    }
  }
  for (const [resourceId, group] of [...stateGroups.entries()]
    .sort((left, right) => compareText(left[0], right[0]))) {
    resources.push({
      resource_id: resourceId,
      kind: group.kind,
      target: resourceId,
      todo_ids: [...group.todoIds].sort(compareText),
      provenance: [manualProvenance(virtualRequest)],
      status: 'observed',
    });
  }
  for (const [writePath, todos] of [...readWriteGroups.entries()]
    .sort((left, right) => compareText(left[0], right[0]))) {
    resources.push({
      resource_id: `rw-${sha16(writePath)}`,
      kind: 'state',
      target: writePath,
      todo_ids: [...todos].sort(compareText),
      provenance: [manualProvenance(virtualRequest)],
      status: 'observed',
    });
  }

  let dynamicIndex = 0;
  for (const unknown of unresolved) {
    resources.push({
      resource_id: `dyn-${String(dynamicIndex += 1).padStart(3, '0')}-${sha16(`${unknown.kind}:${unknown.ref}`)}`,
      kind: 'dynamic',
      target: `${unknown.kind}:${unknown.ref}`.slice(0, 4_096).trim(),
      todo_ids: [unknown.todo_id],
      provenance: [manualProvenance(virtualRequest)],
      status: 'unknown',
    });
  }
  resources.sort((left, right) => compareText(left.resource_id, right.resource_id));
  if (new Set(resources.map(({ resource_id: id }) => id)).size !== resources.length) {
    fail('導出resource_idが重複している');
  }

  const conflicts = [];
  const unknowns = [];
  for (const resource of resources) {
    if (resource.status === 'unknown') {
      for (const todoId of resource.todo_ids) {
        unknowns.push({
          todo_id: todoId,
          kind: resource.kind === 'dynamic'
            ? 'dynamic' : `sensor_${resource.provenance.find(({ source }) => source === 'sensor').status}`,
          reason: `resource ${resource.resource_id} is ${
            resource.kind === 'dynamic'
              ? 'dynamic'
              : resource.provenance.find(({ source }) => source === 'sensor').status
          }`,
        });
      }
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
  conflicts.sort((left, right) => compareText(
    `${left.todo_ids[0]}\0${left.todo_ids[1]}\0${left.resource_id}`,
    `${right.todo_ids[0]}\0${right.todo_ids[1]}\0${right.resource_id}`,
  ));
  unknowns.sort((left, right) => compareText(
    `${left.todo_id}\0${left.kind}\0${left.reason}`,
    `${right.todo_id}\0${right.kind}\0${right.reason}`,
  ));

  return derivationResult({
    outcome: unknowns.length > 0 ? 'unknown' : 'derived',
    virtualWitness: virtualRequest.manual_witness,
    hypotheses,
    resources,
    conflicts,
    unknowns,
    unresolvedWitnesses: unresolved,
  });
}

export function createVirtualCompileReceipt(options = {}) {
  const derivation = deriveVirtualBoundary(options);
  return {
    derivation,
    verification: {
      virtual_compile_input_digest: derivation.input_digest,
      virtual_compile_result_digest: derivation.result_digest,
      residual_conflicts: derivation.conflicts,
    },
  };
}

/**
 * Re-derive from source inputs. This distinguishes a caller-written SHA-shaped receipt from a
 * reproducible virtual compile.
 */
export function verifyVirtualCompileReceipt({ verification, ...options } = {}) {
  const expected = createVirtualCompileReceipt(options);
  const mismatches = [];
  if (verification?.virtual_compile_input_digest
    !== expected.verification.virtual_compile_input_digest) {
    mismatches.push('virtual_compile_input_digest');
  }
  if (verification?.virtual_compile_result_digest
    !== expected.verification.virtual_compile_result_digest) {
    mismatches.push('virtual_compile_result_digest');
  }
  if (digestArtifact(verification?.residual_conflicts)
    !== digestArtifact(expected.verification.residual_conflicts)) {
    mismatches.push('residual_conflicts');
  }
  return {
    valid: mismatches.length === 0,
    mismatches,
    expected: expected.verification,
    derivation: expected.derivation,
  };
}

/** 宣言されたconcern symbolを、`query` operationの解決receiptから探す。 */
function resolvedSymbolPath(evidence, name) {
  const receipt = evidence.queries.find((query) => (
    query.operation === 'query'
      && query.target === name
      && query.outcome === 'resolved'
      && query.resolved_name === name
      && typeof query.resolved_path === 'string'
      && query.resolved_path.length > 0
  ));
  return receipt === undefined ? null : receipt.resolved_path;
}

function pathContains(resourcePath, symbolPath) {
  return resourcePath.endsWith('/')
    ? symbolPath.startsWith(resourcePath)
    : symbolPath === resourcePath;
}

/**
 * Resolve declared concern anchors against fresh sensor evidence.
 *
 * A declaration only becomes a binding anchor when the sensor resolves the exact name to exactly
 * one path and that path lies inside the declared resource. Fuzzy resolution to a neighbouring
 * symbol, an absent name, or a symbol living outside the contested resource yields a typed
 * unknown instead — a wrong declaration must never widen what the binder believes it knows.
 *
 * Two ToDos claiming the same symbol is a contradiction in the declarations themselves, not a cut
 * to be discovered: the anchor is dropped from both and reported, so neither side can be bound by
 * a claim the other also makes.
 */
export function resolveConcernAnchors({ manualWitness, taskIds, evidence } = {}) {
  if (!plainRecord(manualWitness) || !Array.isArray(taskIds)
    || !plainRecord(evidence) || !Array.isArray(evidence.queries)) {
    fail('concern anchor resolution input shapeが不正');
  }
  const anchorsByTask = new Map();
  const unknowns = [];
  for (const taskId of taskIds) {
    const anchors = [];
    for (const entry of manualWitness[taskId]?.concern_anchors ?? []) {
      const resourcePath = entry.within.kind === 'path'
        ? entry.within.target
        : resolvedSymbolPath(evidence, entry.within.target);
      if (resourcePath === null) {
        unknowns.push({
          kind: 'concern_anchor_resource_unresolved',
          ref: `${taskId}:${entry.within.kind}:${entry.within.target}`,
        });
        continue;
      }
      for (const symbol of entry.symbols) {
        const symbolPath = resolvedSymbolPath(evidence, symbol);
        if (symbolPath === null) {
          unknowns.push({ kind: 'concern_anchor_unresolved', ref: `${taskId}:${symbol}` });
          continue;
        }
        if (!pathContains(resourcePath, symbolPath)) {
          unknowns.push({
            kind: 'concern_anchor_outside_resource',
            ref: `${taskId}:${symbol}:${symbolPath}`,
          });
          continue;
        }
        anchors.push(`concern:${symbolPath}\0${symbol}`);
      }
    }
    anchorsByTask.set(taskId, sortedUnique(anchors));
  }

  // 同じsymbolを2 task以上が担当と主張したら、どちらの束縛根拠にもしない。
  const claimantsByAnchor = new Map();
  for (const [taskId, anchors] of anchorsByTask) {
    for (const anchor of anchors) {
      if (!claimantsByAnchor.has(anchor)) claimantsByAnchor.set(anchor, []);
      claimantsByAnchor.get(anchor).push(taskId);
    }
  }
  const overlapping = new Set();
  for (const [anchor, claimants] of claimantsByAnchor) {
    if (claimants.length < 2) continue;
    overlapping.add(anchor);
    const [path, symbol] = anchor.slice('concern:'.length).split('\0');
    unknowns.push({
      kind: 'concern_anchor_overlap',
      ref: `${[...claimants].sort(compareText).join(',')}:${path}:${symbol}`,
    });
  }
  if (overlapping.size > 0) {
    for (const [taskId, anchors] of anchorsByTask) {
      anchorsByTask.set(taskId, anchors.filter((anchor) => !overlapping.has(anchor)));
    }
  }

  return {
    anchorsByTask,
    unknowns: unknowns.sort((left, right) => compareText(
      `${left.kind}\0${left.ref}`, `${right.kind}\0${right.ref}`,
    )),
  };
}

/** witness set全体から、sensorへ問い合わせるconcern symbol名を集める。 */
export function declaredConcernSymbols(manualWitness) {
  if (!plainRecord(manualWitness)) fail('manual witness shapeが不正');
  const names = [];
  for (const witness of Object.values(manualWitness)) {
    for (const entry of witness?.concern_anchors ?? []) {
      names.push(...entry.symbols);
      if (entry.within.kind === 'symbol') names.push(entry.within.target);
    }
  }
  return sortedUnique(names);
}

function uniqueIntentAnchors(manualWitness, taskIds) {
  const anchorsByTask = new Map();
  const counts = new Map();
  for (const taskId of taskIds) {
    const witness = manualWitness[taskId];
    const anchors = [
      ...witness.owns.map((own) => `owns:${resourceKey(own)}`),
      ...witness.writes.map((path) => `writes:${path}`),
      ...witness.affected_tests.map((path) => `affected_tests:${path}`),
    ];
    anchorsByTask.set(taskId, sortedUnique(anchors));
    for (const anchor of new Set(anchors)) counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
  }
  return new Map([...anchorsByTask].map(([taskId, anchors]) => [
    taskId,
    anchors.filter((anchor) => counts.get(anchor) === 1),
  ]));
}

function graphNode(entry) {
  const node = plainRecord(entry?.node) ? entry.node : entry;
  if (!plainRecord(node)
    || typeof node.name !== 'string'
    || node.name.length === 0
    || typeof node.filePath !== 'string'
    || node.filePath.length === 0
    || node.filePath.startsWith('/')) return null;
  if (node.kind === 'file') {
    return { kind: 'path', target: node.filePath, path: node.filePath };
  }
  return { kind: 'symbol', target: node.name, path: node.filePath };
}

function graphNodeKey(node) {
  return `${node.kind}\0${node.target}\0${node.path}`;
}

function graphEdgeKey(edge) {
  return `${edge.from}\0${edge.to}\0${edge.kind}`;
}

function graphPayload(outcome, operation) {
  if (!plainRecord(outcome) || outcome.outcome !== 'ready') return null;
  if (operation === 'query') return outcome.data;
  if (!plainRecord(outcome.data)) return null;
  if (operation === 'callers') return outcome.data.callers;
  if (operation === 'callees') return outcome.data.callees;
  if (operation === 'impact') return outcome.data.affected;
  return null;
}

function normalizeRawGraph({ conflict, evidence, rawCollected }) {
  if (!plainRecord(rawCollected) || !Array.isArray(rawCollected.outcomes)) {
    return { graph: null, unknown: 'raw_graph_unavailable' };
  }
  const receipts = evidence.queries.filter((query) => (
    query.target === conflict.target && STRUCTURE_OPERATIONS.has(query.operation)
  ));
  if (receipts.length !== STRUCTURE_OPERATIONS.size
    || receipts.some((query) => query.outcome !== 'resolved'
      || query.resolved_name !== conflict.target
      || query.resolved_path === null)) {
    return { graph: null, unknown: 'raw_graph_incomplete' };
  }
  const outcomeById = new Map(rawCollected.outcomes.map((outcome) => [outcome?.id, outcome]));
  const receiptByOperation = new Map(receipts.map((receipt) => [receipt.operation, receipt]));
  const payloadByOperation = new Map();
  for (const operation of STRUCTURE_OPERATIONS) {
    const receipt = receiptByOperation.get(operation);
    const payload = graphPayload(outcomeById.get(receipt.query_id), operation);
    if (!Array.isArray(payload)) {
      return { graph: null, unknown: 'raw_graph_incomplete' };
    }
    payloadByOperation.set(operation, payload);
  }

  const queryReceipt = receiptByOperation.get('query');
  const rootMatches = payloadByOperation.get('query')
    .map(graphNode)
    .filter((node) => node !== null
      && node.kind === 'symbol'
      && node.target === conflict.target
      && node.path === queryReceipt.resolved_path);
  if (rootMatches.length !== 1) {
    return { graph: null, unknown: 'raw_graph_incomplete' };
  }
  const root = rootMatches[0];
  const nodes = new Map([[graphNodeKey(root), root]]);
  const edges = new Map();
  let invalidObservedNode = false;
  const addObserved = (entry) => {
    const node = graphNode(entry);
    if (node === null) invalidObservedNode = true;
    if (node !== null) nodes.set(graphNodeKey(node), node);
    return node;
  };
  for (const entry of payloadByOperation.get('callers')) {
    const node = addObserved(entry);
    if (node === null) continue;
    const edge = { from: graphNodeKey(node), to: graphNodeKey(root), kind: 'caller' };
    edges.set(graphEdgeKey(edge), edge);
  }
  for (const entry of payloadByOperation.get('callees')) {
    const node = addObserved(entry);
    if (node === null) continue;
    const edge = { from: graphNodeKey(root), to: graphNodeKey(node), kind: 'callee' };
    edges.set(graphEdgeKey(edge), edge);
  }
  for (const entry of payloadByOperation.get('impact')) addObserved(entry);
  let closureComplete = plainRecord(rawCollected.graph_closure)
    && rawCollected.graph_closure.complete === true
    && Array.isArray(rawCollected.graph_closure.expansions);
  if (plainRecord(rawCollected.graph_closure)
    && Array.isArray(rawCollected.graph_closure.expansions)) {
    for (const expansion of rawCollected.graph_closure.expansions) {
      const parent = graphNode(expansion?.parent);
      const rawCallees = expansion?.callees_outcome;
      if (expansion?.exact !== true
        || parent === null
        || !plainRecord(rawCallees)
        || rawCallees.outcome !== 'ready'
        || !plainRecord(rawCallees.data)
        || !Array.isArray(rawCallees.data.callees)) {
        closureComplete = false;
        continue;
      }
      nodes.set(graphNodeKey(parent), parent);
      for (const entry of rawCallees.data.callees) {
        const child = addObserved(entry);
        if (child === null) {
          closureComplete = false;
          continue;
        }
        const edge = {
          from: graphNodeKey(parent),
          to: graphNodeKey(child),
          kind: 'callee',
        };
        edges.set(graphEdgeKey(edge), edge);
      }
    }
  }
  if (invalidObservedNode) {
    return { graph: null, unknown: 'raw_graph_incomplete' };
  }
  return {
    graph: {
      root,
      closure_complete: closureComplete,
      nodes: [...nodes.values()].sort((left, right) => compareText(
        graphNodeKey(left), graphNodeKey(right),
      )),
      edges: [...edges.values()].sort((left, right) => compareText(
        graphEdgeKey(left), graphEdgeKey(right),
      )),
    },
    unknown: null,
  };
}

function stronglyConnectedPartitions(graph) {
  const symbolKeys = new Set(graph.nodes
    .filter(({ kind }) => kind === 'symbol').map(graphNodeKey));
  const adjacency = new Map([...symbolKeys].map((key) => [key, []]));
  for (const edge of graph.edges) {
    if (symbolKeys.has(edge.from) && symbolKeys.has(edge.to)) {
      adjacency.get(edge.from).push(edge.to);
    }
  }
  for (const targets of adjacency.values()) targets.sort(compareText);
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const visit = (key) => {
    indexes.set(key, nextIndex);
    lowLinks.set(key, nextIndex);
    nextIndex += 1;
    stack.push(key);
    onStack.add(key);
    for (const target of adjacency.get(key)) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(key, Math.min(lowLinks.get(key), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(key, Math.min(lowLinks.get(key), indexes.get(target)));
      }
    }
    if (lowLinks.get(key) !== indexes.get(key)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === key) break;
    }
    components.push(component.sort(compareText));
  };
  for (const key of [...symbolKeys].sort(compareText)) {
    if (!indexes.has(key)) visit(key);
  }
  return components.sort((left, right) => compareText(left.join('\0'), right.join('\0')));
}

function calleeClosurePartitions(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [graphNodeKey(node), []]));
  for (const edge of graph.edges.filter(({ kind }) => kind === 'callee')) {
    adjacency.get(edge.from)?.push(edge.to);
  }
  for (const targets of adjacency.values()) targets.sort(compareText);
  const direct = adjacency.get(graphNodeKey(graph.root)) ?? [];
  return direct.map((start) => {
    const seen = new Set();
    const queue = [start];
    while (queue.length > 0) {
      const key = queue.shift();
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(...(adjacency.get(key) ?? []));
    }
    return [...seen].sort(compareText);
  });
}

function moduleFrontierPartitions(graph) {
  const byPath = new Map();
  for (const node of graph.nodes) {
    if (!byPath.has(node.path)) byPath.set(node.path, []);
    byPath.get(node.path).push(graphNodeKey(node));
  }
  return [...byPath.entries()].sort((left, right) => compareText(left[0], right[0]))
    .map(([, keys]) => keys.sort(compareText));
}

function testFrontierPartitions(graph) {
  return graph.nodes
    .filter(({ kind, path }) => kind === 'path'
      && (path.startsWith('test/') || /\.test\.[cm]?[jt]sx?$/u.test(path)))
    .map((node) => [graphNodeKey(node)]);
}

function canonicalPartitions(partitions) {
  const unique = new Set();
  for (const partition of partitions) {
    const key = sortedUnique(partition).join('\u0001');
    if (key.length > 0) unique.add(key);
  }
  return [...unique].sort(compareText).map((key) => key.split('\u0001'));
}

function anchorMatchesNode(anchor, node) {
  if (anchor.startsWith('owns:symbol\0')) {
    return node.kind === 'symbol' && node.target === anchor.slice('owns:symbol\0'.length);
  }
  if (anchor.startsWith('owns:path\0')) {
    return node.path === anchor.slice('owns:path\0'.length);
  }
  if (anchor.startsWith('writes:')) return node.path === anchor.slice('writes:'.length);
  if (anchor.startsWith('affected_tests:')) {
    return node.path === anchor.slice('affected_tests:'.length);
  }
  return false;
}

function bindSkeleton({ skeleton, graph, intentAnchors, taskIds }) {
  const nodeByKey = new Map(graph.nodes.map((node) => [graphNodeKey(node), node]));
  const taskBindings = [];
  const unknowns = [];
  for (const taskId of taskIds) {
    const matches = [];
    skeleton.partitions.forEach((partition, index) => {
      const anchors = intentAnchors.get(taskId).filter((anchor) => (
        partition.some((key) => anchorMatchesNode(anchor, nodeByKey.get(key)))
      ));
      if (anchors.length > 0) matches.push({ index, anchors: sortedUnique(anchors) });
    });
    if (matches.length === 0) {
      unknowns.push({
        kind: 'semantic_owner_binding_missing',
        ref: `${skeleton.skeleton_id}:${taskId}`,
      });
      continue;
    }
    if (matches.length > 1) {
      unknowns.push({
        kind: 'semantic_owner_binding_ambiguous',
        ref: `${skeleton.skeleton_id}:${taskId}`,
      });
      continue;
    }
    taskBindings.push({
      task_id: taskId,
      partition_index: matches[0].index,
      anchors: matches[0].anchors,
    });
  }
  if (taskBindings.length === taskIds.length
    && new Set(taskBindings.map(({ partition_index: index }) => index)).size
      !== taskBindings.length) {
    unknowns.push({
      kind: 'semantic_owner_binding_ambiguous',
      ref: `${skeleton.skeleton_id}:shared_partition`,
    });
  }
  return {
    ...skeleton,
    task_bindings: taskBindings,
    binding_unknowns: unknowns,
  };
}

/**
 * Enumerate structural cut skeletons from the in-memory sensor outcomes. Graph edges only shape
 * SCC/closure/frontier partitions; task ownership is bound exclusively by unique witness anchors.
 */
export function enumerateCutSkeletons({
  component,
  request,
  evidence,
  rawCollected,
} = {}) {
  if (!plainRecord(component)
    || !Array.isArray(component.task_ids)
    || !Array.isArray(component.conflicts)
    || !plainRecord(request)
    || !plainRecord(evidence)) {
    fail('cut skeleton enumeration input shapeが不正');
  }
  const taskIds = [...component.task_ids].sort(compareText);
  const intentAnchors = uniqueIntentAnchors(request.manual_witness, taskIds);
  const missingIntent = taskIds.filter((taskId) => intentAnchors.get(taskId).length === 0);
  if (missingIntent.length > 0) {
    return {
      skeletons: [],
      unknowns: missingIntent.map((taskId) => ({
        kind: 'semantic_owner_binding_missing',
        ref: taskId,
      })),
      exploration_complete: false,
    };
  }

  const skeletonByLayout = new Map();
  const unknowns = [];
  for (const conflict of component.conflicts) {
    if (conflict.kind !== 'symbol') {
      unknowns.push({ kind: 'raw_graph_unavailable', ref: conflict.resource_id });
      continue;
    }
    const normalized = normalizeRawGraph({ conflict, evidence, rawCollected });
    if (normalized.graph === null) {
      unknowns.push({ kind: normalized.unknown, ref: conflict.resource_id });
      continue;
    }
    const graph = normalized.graph;
    if (!graph.closure_complete) {
      unknowns.push({ kind: 'raw_graph_incomplete', ref: conflict.resource_id });
    }
    const variants = [
      ...(graph.closure_complete ? [
        ['scc', stronglyConnectedPartitions(graph)],
        ['callee_closure', calleeClosurePartitions(graph)],
      ] : []),
      ['module_frontier', moduleFrontierPartitions(graph)],
      ['task_test_frontier', testFrontierPartitions(graph)],
    ];
    for (const [cutKind, rawPartitions] of variants) {
      const partitions = canonicalPartitions(rawPartitions);
      if (partitions.length < 2) continue;
      const layoutKey = digestArtifact({
        conflict_resource_id: conflict.resource_id,
        partitions,
      });
      const existing = skeletonByLayout.get(layoutKey);
      if (existing !== undefined) {
        existing.cut_kinds = sortedUnique([...existing.cut_kinds, cutKind]);
        continue;
      }
      skeletonByLayout.set(layoutKey, {
        skeleton_id: `cut-${sha16(layoutKey)}`,
        conflict_resource_id: conflict.resource_id,
        cut_kinds: [cutKind],
        root_surface: structuredClone(graph.root),
        partitions,
        raw_graph: {
          nodes: structuredClone(graph.nodes),
          edges: structuredClone(graph.edges),
        },
      });
    }
  }
  const skeletons = [...skeletonByLayout.values()]
    .sort((left, right) => compareText(left.skeleton_id, right.skeleton_id))
    .map((skeleton) => bindSkeleton({
      skeleton,
      graph: skeleton.raw_graph,
      intentAnchors,
      taskIds,
    }));
  for (const skeleton of skeletons) unknowns.push(...skeleton.binding_unknowns);
  if (skeletons.length === 0 && unknowns.length === 0) {
    unknowns.push({ kind: 'raw_graph_incomplete', ref: component.component_id });
  }
  return {
    skeletons,
    unknowns: unknowns.sort((left, right) => compareText(
      `${left.kind}\0${left.ref}`, `${right.kind}\0${right.ref}`,
    )),
    exploration_complete: unknowns.length === 0,
  };
}

function rawGraphSurfaceSet(rawGraph) {
  if (!exactRecord(rawGraph, ['nodes', 'edges'])
    || !Array.isArray(rawGraph.nodes)
    || !Array.isArray(rawGraph.edges)) return null;
  const surfaces = new Set();
  for (const node of rawGraph.nodes) {
    if (!exactRecord(node, ['kind', 'target', 'path'])
      || !['symbol', 'path'].includes(node.kind)
      || typeof node.target !== 'string'
      || typeof node.path !== 'string') return null;
    surfaces.add(`${node.kind}\0${node.target}\0${node.path}`);
  }
  return surfaces;
}

function currentSurfaces(component, evidence) {
  const ownerByConflict = new Map(component.conflicts.map((conflict) => [
    conflict.resource_id,
    sortedUnique(conflict.task_pairs.flat()),
  ]));
  const surfaces = [];
  for (const conflict of component.conflicts) {
    if (!['symbol', 'path'].includes(conflict.kind)) continue;
    let path = conflict.target;
    if (conflict.kind === 'symbol') {
      const receipt = evidence.queries.find((query) => (
        query.target === conflict.target
          && query.outcome === 'resolved'
          && query.resolved_name === conflict.target
          && query.resolved_path !== null
      ));
      if (receipt === undefined) return null;
      path = receipt.resolved_path;
    }
    surfaces.push({
      kind: conflict.kind,
      target: conflict.target,
      path,
      role: conflict.kind === 'symbol' ? 'shared_symbol' : 'shared_path',
      owner_task_ids: ownerByConflict.get(conflict.resource_id),
    });
  }
  return surfaces.sort((left, right) => compareText(surfaceKey(left), surfaceKey(right)));
}

function candidateDominates(left, right) {
  const noWorse = left.minimumWaves <= right.minimumWaves
    && isSubset(left.changedSurfaces, right.changedSurfaces)
    && isSubset(left.blastRadius, right.blastRadius);
  const strict = left.minimumWaves < right.minimumWaves
    || left.changedSurfaces.size < right.changedSurfaces.size
    || left.blastRadius.size < right.blastRadius.size;
  return noWorse && strict;
}

function decisionUnknown(component, unknowns, reasons = []) {
  return {
    component_id: component.component_id,
    task_ids: [...component.task_ids],
    conflicts: structuredClone(component.conflicts),
    verdict: 'unknown_requires_evidence',
    seam_candidate: null,
    reasons: reasons.sort((left, right) => compareText(
      `${left.code}\0${left.detail}`, `${right.code}\0${right.detail}`,
    )),
    unknowns: unknowns.sort((left, right) => compareText(
      `${left.kind}\0${left.ref}`, `${right.kind}\0${right.ref}`,
    )),
  };
}

/**
 * Low-level evaluator for already-materialized skeletons. Task assignment must have been bound
 * before this point; graph edges are never accepted as ownership evidence.
 */
export function evaluateSeamProposalCandidates({
  component,
  request,
  sensorEvidence,
  evidence,
  candidateSpecs,
  explorationComplete = false,
} = {}) {
  if (!plainRecord(component)
    || !Array.isArray(component.task_ids)
    || !Array.isArray(component.conflicts)
    || !Array.isArray(candidateSpecs)
    || !plainRecord(evidence)) {
    fail('decision input shapeが不正');
  }
  const taskIds = [...component.task_ids].sort(compareText);
  if (taskIds.some((taskId, index) => taskId !== component.task_ids[index])) {
    fail('component.task_idsがstrict sortされていない');
  }
  const taskSet = new Set(taskIds);
  const intentAnchors = uniqueIntentAnchors(request.manual_witness, taskIds);
  const missingIntent = taskIds.filter((taskId) => intentAnchors.get(taskId).length === 0);
  if (missingIntent.length > 0) {
    return decisionUnknown(component, missingIntent.map((taskId) => ({
      kind: 'semantic_owner_binding_missing',
      ref: taskId,
    })));
  }
  if (candidateSpecs.length === 0) {
    return decisionUnknown(component, [{
      kind: 'candidate_exploration_incomplete',
      ref: component.component_id,
    }]);
  }
  const current = currentSurfaces(component, evidence);
  if (current === null) {
    return decisionUnknown(component, [{
      kind: 'exact_surface_evidence_missing',
      ref: component.component_id,
    }]);
  }

  const evaluated = [];
  const rejectedUnknowns = [];
  const candidateIds = candidateSpecs.map(({ candidate_id: candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    fail('candidate_idが重複している');
  }
  for (const spec of candidateSpecs) {
    if (!exactRecord(spec, [
      'candidate_id', 'ownership_diff', 'proposed_surfaces',
      'surface_hypotheses', 'raw_graph',
    ])) {
      fail('candidate specがclosed shapeではない');
    }
    const graphSurfaces = rawGraphSurfaceSet(spec.raw_graph);
    if (graphSurfaces === null) {
      rejectedUnknowns.push({ kind: 'raw_graph_unavailable', ref: spec.candidate_id });
      continue;
    }
    if (current.some((surface) => !graphSurfaces.has(
      `${surface.kind}\0${surface.target}\0${surface.path}`,
    ))) {
      rejectedUnknowns.push({ kind: 'raw_graph_incomplete', ref: spec.candidate_id });
      continue;
    }
    if (!Array.isArray(spec.proposed_surfaces)
      || spec.proposed_surfaces.some((surface) => !plainRecord(surface))) {
      fail('candidate proposed_surfacesが不正');
    }
    const hypothesisKeys = new Set(spec.surface_hypotheses.map((entry) => (
      `${entry.kind}\0${entry.target}\0${entry.path}`
    )));
    const graphIncomplete = spec.proposed_surfaces.some((surface) => {
      const key = `${surface.kind}\0${surface.target}\0${surface.path}`;
      return !graphSurfaces.has(key) && !hypothesisKeys.has(key);
    });
    if (graphIncomplete) {
      rejectedUnknowns.push({ kind: 'new_surface_assumption_missing', ref: spec.candidate_id });
      continue;
    }
    const diffIds = spec.ownership_diff.map(({ todo_id: todoId }) => todoId);
    if (diffIds.length !== taskIds.length
      || new Set(diffIds).size !== taskIds.length
      || diffIds.some((taskId) => !taskSet.has(taskId))) {
      fail('candidate ownership_diffがcomponent全taskのfull diffではない');
    }
    const virtualWitness = buildVirtualWitness({
      request,
      ownershipDiff: spec.ownership_diff,
    });
    const proposedOwnershipMismatch = spec.proposed_surfaces.some((surface) => {
      if (!Array.isArray(surface.owner_task_ids)) return true;
      const owners = taskIds.filter((taskId) => virtualWitness[taskId].owns
        .some((own) => resourceKey(own) === `${surface.kind}\0${surface.target}`));
      return owners.length !== surface.owner_task_ids.length
        || owners.some((taskId, index) => taskId !== surface.owner_task_ids[index]);
    });
    if (proposedOwnershipMismatch) {
      rejectedUnknowns.push({
        kind: 'virtual_witness_surface_mismatch',
        ref: spec.candidate_id,
      });
      continue;
    }
    const receipt = createVirtualCompileReceipt({
      request,
      sensorEvidence,
      virtualWitness,
      surfaceHypotheses: spec.surface_hypotheses,
    });
    const derivation = receipt.derivation;
    if (derivation.outcome !== 'derived'
      || derivation.unknowns.length > 0
      || derivation.conflicts.length > 0) {
      const kind = derivation.drift.length > 0
        ? derivation.drift[0].kind
        : derivation.unknowns.length > 0 ? 'virtual_boundary_unknown' : 'residual_conflict';
      rejectedUnknowns.push({ kind, ref: spec.candidate_id });
      evaluated.push({ spec, derivation, feasible: false });
      continue;
    }

    const proposed = structuredClone(spec.proposed_surfaces)
      .sort((left, right) => compareText(surfaceKey(left), surfaceKey(right)));
    const affectedTests = sortedUnique(taskIds.flatMap(
      (taskId) => virtualWitness[taskId].affected_tests,
    ));
    const limits = spec.surface_hypotheses.length > 0
      ? ['hypothetical_new_surfaces', 'structural_only']
      : ['structural_only'];
    const candidate = {
      proposal_id: deriveSeamProposalId({
        conflicts: component.conflicts,
        proposed_surfaces: proposed,
      }),
      current_surfaces: current,
      proposed_surfaces: proposed,
      affected_tests: affectedTests,
      verification: {
        virtual_compile_input_digest: receipt.verification.virtual_compile_input_digest,
        virtual_compile_result_digest: receipt.verification.virtual_compile_result_digest,
        residual_conflicts: [],
      },
      evidence: structuredClone(evidence),
      limits,
      proposal_digest: '',
    };
    candidate.proposal_digest = todoSelfDigest(candidate, 'proposal_digest');
    const changedSurfaces = new Set(proposed.map(surfaceKey));
    const blastRadius = new Set([
      ...proposed.map(({ path }) => `path:${path}`),
      ...affectedTests.map((path) => `test:${path}`),
    ]);
    evaluated.push({
      spec,
      derivation,
      feasible: true,
      candidate,
      minimumWaves: Math.ceil(taskIds.length / request.capacity.executors),
      changedSurfaces,
      blastRadius,
    });
  }

  const feasible = evaluated.filter(({ feasible }) => feasible);
  const nonDominated = feasible.filter((candidate, index) => (
    !feasible.some((other, otherIndex) => (
      index !== otherIndex && candidateDominates(other, candidate)
    ))
  ));
  if (nonDominated.length === 1) {
    return {
      component_id: component.component_id,
      task_ids: taskIds,
      conflicts: structuredClone(component.conflicts),
      verdict: 'seam_candidate',
      seam_candidate: nonDominated[0].candidate,
      reasons: [{
        code: 'unique_structural_dominant_candidate',
        detail: 'One feasible candidate structurally dominates all alternatives.',
      }],
      unknowns: [],
    };
  }
  if (nonDominated.length > 1) {
    return decisionUnknown(component, [{
      kind: 'multiple_incomparable_candidates',
      ref: nonDominated.map(({ spec }) => spec.candidate_id).sort(compareText).join(','),
    }]);
  }

  const serialKinds = new Set(['state', 'effect']);
  const unseverable = component.conflicts.filter(({ kind }) => serialKinds.has(kind));
  const unseverableRemains = unseverable.length > 0
    && evaluated.length === candidateSpecs.length
    && evaluated.every(({ derivation }) => unseverable.some((conflict) => (
      derivation.conflicts.some(({ resource_id: resourceId }) => (
        resourceId === conflict.resource_id || resourceId === conflict.target
      ))
    )));
  if (explorationComplete && unseverableRemains) {
    return {
      component_id: component.component_id,
      task_ids: taskIds,
      conflicts: structuredClone(component.conflicts),
      verdict: 'intentional_serial',
      seam_candidate: null,
      reasons: [{
        code: 'unseverable_state_effect_conflict',
        detail: 'Complete exploration retained a current-contract state/effect conflict.',
      }],
      unknowns: [],
    };
  }
  const unknowns = rejectedUnknowns.length > 0
    ? rejectedUnknowns
    : [{ kind: 'candidate_exploration_incomplete', ref: component.component_id }];
  if (!explorationComplete) {
    unknowns.push({ kind: 'candidate_exploration_incomplete', ref: component.component_id });
  }
  return decisionUnknown(component, unknowns);
}

function extractionPath(rootPath, skeletonId, taskId) {
  const slash = rootPath.lastIndexOf('/');
  const directory = slash === -1 ? '' : rootPath.slice(0, slash + 1);
  const filename = slash === -1 ? rootPath : rootPath.slice(slash + 1);
  const dot = filename.lastIndexOf('.');
  const stem = dot <= 0 ? filename : filename.slice(0, dot);
  const extension = dot <= 0 ? '.mjs' : filename.slice(dot);
  return `${directory}${stem}.seam-${sha16(`${skeletonId}\0${taskId}`)}${extension}`;
}

function skeletonCandidateSpec({ skeleton, component, request, evidence }) {
  const taskIds = [...component.task_ids].sort(compareText);
  if (skeleton.binding_unknowns.length > 0
    || skeleton.task_bindings.length !== taskIds.length) return null;
  const current = currentSurfaces(component, evidence);
  if (current === null) return null;
  const conflictKeys = new Set(component.conflicts.map(({ kind, target }) => (
    `${kind}\0${target}`
  )));
  const currentPaths = sortedUnique(current.map(({ path }) => path));
  const ownershipDiff = [];
  const proposedSurfaces = [];
  const surfaceHypotheses = [];
  for (const taskId of taskIds) {
    const original = request.manual_witness[taskId];
    const path = extractionPath(skeleton.root_surface.path, skeleton.skeleton_id, taskId);
    const replacePath = (value) => (
      currentPaths.some((currentPath) => pathPrefixOverlap(value, currentPath)) ? path : value
    );
    const owns = original.owns.filter((own) => (
      !conflictKeys.has(resourceKey(own))
        && !(own.kind === 'path' && currentPaths.includes(own.target))
    ));
    owns.push({ kind: 'path', target: path });
    const sensorQueries = original.sensor_provenance.queries.filter(({ expect }) => {
      if (expect.kind === 'symbol') {
        return !component.conflicts.some((conflict) => (
          conflict.kind === 'symbol' && conflict.target === expect.name
        ));
      }
      return !currentPaths.includes(expect.path);
    });
    ownershipDiff.push({
      todo_id: taskId,
      owns: owns.sort((left, right) => compareText(resourceKey(left), resourceKey(right))),
      reads: sortedUnique(original.reads.map(replacePath)),
      writes: sortedUnique([...original.writes.map(replacePath), path]),
      resources: structuredClone(original.resources),
      state_effects: structuredClone(original.state_effects),
      sensor_provenance: { queries: structuredClone(sensorQueries) },
      affected_tests: structuredClone(original.affected_tests),
      unknowns: structuredClone(original.unknowns),
    });
    proposedSurfaces.push({
      kind: 'path',
      target: path,
      path,
      role: 'task_owned',
      owner_task_ids: [taskId],
    });
    surfaceHypotheses.push({
      kind: 'path',
      target: path,
      path,
      owner_task_id: taskId,
      affected_tests: structuredClone(original.affected_tests),
      provenance: HYPOTHESIS_PROVENANCE,
    });
  }
  return {
    candidate_id: skeleton.skeleton_id,
    ownership_diff: ownershipDiff,
    proposed_surfaces: proposedSurfaces,
    surface_hypotheses: surfaceHypotheses,
    raw_graph: structuredClone(skeleton.raw_graph),
  };
}

/**
 * Enumerate, bind, materialize, and validate structural cut skeletons. Callers provide collected
 * sensor outcomes, never handwritten candidate specs.
 */
export function compileSeamProposalDecision({
  component,
  request,
  sensorEvidence,
  evidence,
  rawCollected,
} = {}) {
  const enumeration = enumerateCutSkeletons({
    component,
    request,
    evidence,
    rawCollected,
  });
  if (enumeration.unknowns.length > 0) {
    return decisionUnknown(component, enumeration.unknowns);
  }
  const candidateSpecs = enumeration.skeletons.map((skeleton) => (
    skeletonCandidateSpec({ skeleton, component, request, evidence })
  ));
  if (candidateSpecs.some((spec) => spec === null)) {
    return decisionUnknown(component, [{
      kind: 'new_surface_assumption_missing',
      ref: component.component_id,
    }]);
  }
  return evaluateSeamProposalCandidates({
    component,
    request,
    sensorEvidence,
    evidence,
    candidateSpecs,
    explorationComplete: enumeration.exploration_complete,
  });
}

export class SeamProposalCompileError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'SeamProposalCompileError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function compileFail(code, reason, detail) {
  throw new SeamProposalCompileError(code, reason, detail);
}

function conflictComponents(independenceArtifact) {
  const resourceById = new Map(independenceArtifact.conflict_resources.map((resource) => (
    [resource.resource_id, resource]
  )));
  const parent = new Map();
  const find = (taskId) => {
    const current = parent.get(taskId) ?? taskId;
    if (!parent.has(taskId)) parent.set(taskId, taskId);
    if (current === taskId) return taskId;
    const root = find(current);
    parent.set(taskId, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (compareText(leftRoot, rightRoot) < 0) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };

  for (const { task_ids: [left, right] } of independenceArtifact.conflicts) {
    union(left, right);
  }

  const conflictsByRoot = new Map();
  for (const conflict of independenceArtifact.conflicts) {
    const root = find(conflict.task_ids[0]);
    const entries = conflictsByRoot.get(root) ?? [];
    entries.push(conflict);
    conflictsByRoot.set(root, entries);
  }

  const components = [];
  const classifiedPairKeys = new Set();
  const classifiedResourceIds = new Set();
  for (const entries of conflictsByRoot.values()) {
    const taskIds = sortedUnique(entries.flatMap(({ task_ids: taskPair }) => taskPair));
    const pairsByResource = new Map();
    for (const entry of entries) {
      const pairs = pairsByResource.get(entry.resource_id) ?? [];
      pairs.push([...entry.task_ids]);
      pairsByResource.set(entry.resource_id, pairs);
      classifiedPairKeys.add(`${entry.task_ids[0]}\0${entry.task_ids[1]}\0${entry.resource_id}`);
    }
    const conflicts = [...pairsByResource].map(([resourceId, pairs]) => {
      const resource = resourceById.get(resourceId);
      if (resource === undefined) {
        compileFail('SEAM_PROPOSAL_COMPONENT_INVALID', 'conflict_resource_missing', {
          resource_id: resourceId,
        });
      }
      if (classifiedResourceIds.has(resourceId)) {
        compileFail('SEAM_PROPOSAL_COMPONENT_INVALID', 'conflict_resource_classified_twice', {
          resource_id: resourceId,
        });
      }
      classifiedResourceIds.add(resourceId);
      return {
        ...structuredClone(resource),
        task_pairs: pairs.sort((left, right) => compareText(
          `${left[0]}\0${left[1]}`, `${right[0]}\0${right[1]}`,
        )),
      };
    }).sort((left, right) => compareText(left.resource_id, right.resource_id));
    const identity = { task_ids: taskIds, conflicts };
    components.push({
      component_id: `component-${digestTodoArtifact(identity).slice(0, 24)}`,
      ...identity,
    });
  }

  const expectedPairKeys = new Set(independenceArtifact.conflicts.map((entry) => (
    `${entry.task_ids[0]}\0${entry.task_ids[1]}\0${entry.resource_id}`
  )));
  if (classifiedPairKeys.size !== expectedPairKeys.size
    || [...expectedPairKeys].some((key) => !classifiedPairKeys.has(key))
    || classifiedResourceIds.size !== independenceArtifact.conflict_resources.length) {
    compileFail('SEAM_PROPOSAL_COMPONENT_INVALID', 'conflict_component_partition_incomplete', {
      expected_pair_count: expectedPairKeys.size,
      classified_pair_count: classifiedPairKeys.size,
      expected_resource_count: independenceArtifact.conflict_resources.length,
      classified_resource_count: classifiedResourceIds.size,
    });
  }
  return components.sort((left, right) => compareText(left.component_id, right.component_id));
}

/**
 * Build the immutable lattice.seam_proposal.v1 artifact from one complete independence record.
 * Sensor collection stays outside this producer; callers pass the original witness evidence and
 * the seam-specific normalized/raw evidence collected for the same clean HEAD.
 */
export function compileSeamProposalArtifact({
  independenceArtifact,
  witnessSet,
  plan,
  compiledAt,
  sensorEvidence,
  evidence,
  rawCollected,
} = {}) {
  if (!validateTodoIndependence(independenceArtifact)) {
    compileFail('SEAM_PROPOSAL_INDEPENDENCE_INVALID', 'independence_artifact_invalid');
  }
  if (independenceArtifact.outcome !== 'compiled') {
    compileFail('SEAM_PROPOSAL_INDEPENDENCE_UNAVAILABLE', 'independence_outcome_not_compiled', {
      outcome: independenceArtifact.outcome,
    });
  }
  if (!validateTodoWitnessSet(witnessSet)) {
    compileFail('SEAM_PROPOSAL_WITNESS_INVALID', 'witness_set_invalid');
  }
  if (!validateTodoPlan(plan)) {
    compileFail('SEAM_PROPOSAL_PLAN_INVALID', 'plan_invalid');
  }
  if (independenceArtifact.project_id !== plan.project_id
    || independenceArtifact.plan_key !== plan.plan_key
    || independenceArtifact.plan_version !== plan.plan_version
    || independenceArtifact.topology_digest !== plan.topology_digest) {
    compileFail('SEAM_PROPOSAL_BINDING_MISMATCH', 'independence_plan_mismatch');
  }
  if (witnessSet.project_id !== plan.project_id
    || witnessSet.plan_key !== plan.plan_key
    || witnessSet.witness_set_digest !== independenceArtifact.witness_set_digest) {
    compileFail('SEAM_PROPOSAL_BINDING_MISMATCH', 'witness_independence_mismatch');
  }

  const request = synthesizeWitnessRunRequest(witnessSet, {
    baseSha: independenceArtifact.base_sha,
    requestId: `seam-proposal-${independenceArtifact.result_digest.slice(0, 24)}`,
  });
  const decisions = conflictComponents(independenceArtifact).map((component) => (
    compileSeamProposalDecision({
      component,
      request,
      sensorEvidence,
      evidence,
      rawCollected,
    })
  )).sort((left, right) => compareText(left.component_id, right.component_id));
  const artifact = {
    schema: SEAM_PROPOSAL_SCHEMA,
    project_id: plan.project_id,
    plan_key: plan.plan_key,
    source_binding: {
      independence_schema: independenceArtifact.schema,
      independence_result_digest: independenceArtifact.result_digest,
      witness_set_digest: independenceArtifact.witness_set_digest,
      plan_version: independenceArtifact.plan_version,
      topology_digest: independenceArtifact.topology_digest,
      base_sha: independenceArtifact.base_sha,
    },
    compiled_at: compiledAt,
    decisions,
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  if (!validateSeamProposal(artifact)) {
    compileFail('SEAM_PROPOSAL_ARTIFACT_INVALID', 'seam_proposal_artifact_invalid');
  }
  return artifact;
}
