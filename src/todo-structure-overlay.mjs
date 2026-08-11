import { DagCycleError, analyzeDagChains, analyzeDagReachability } from './dag-chain.mjs';
import { digestTodoArtifact, todoSelfDigest } from './todo-contracts.mjs';
import {
  TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA,
  TodoStructureGitError,
  bindTodoStructureRealizationCommits,
} from './todo-structure-git-adapter.mjs';
import {
  TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA,
} from './todo-structure-source-adapter.mjs';
import {
  digestTodoStructureTransform,
  explainTodoStructureRealization,
  explainTodoStructureSet,
} from './todo-structure-contracts.mjs';
import { projectTodoChainV1, projectTodoTopologyDagV1 } from './todo-chain.mjs';

export const TODO_STRUCTURE_OVERLAY_SCHEMA = 'lattice.todo_structure_overlay.v1';
export const TODO_STRUCTURE_FINDING_LIMIT = 1_024;

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonicalCompare = (left, right) => compareText(
  JSON.stringify(left), JSON.stringify(right),
);

export class TodoStructureOverlayError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoStructureOverlayError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail = {}) {
  throw new TodoStructureOverlayError(code, reason, detail);
}

function assertInputs(structureSet, sourceProjection, gitProvenance) {
  const structure = explainTodoStructureSet(structureSet);
  if (!structure.valid) fail('STRUCTURE_OVERLAY_INPUT_INVALID', structure.reason, { path: structure.path });
  if (!isPlain(sourceProjection)
    || sourceProjection.schema !== TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA
    || sourceProjection.structure_set_digest !== structureSet.structure_set_digest
    || sourceProjection.projection_digest !== todoSelfDigest(sourceProjection, 'projection_digest')) {
    fail('STRUCTURE_OVERLAY_SOURCE_INVALID', 'source_projection_invalid');
  }
  if (!isPlain(gitProvenance)
    || gitProvenance.schema !== TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA
    || gitProvenance.structure_set_digest !== structureSet.structure_set_digest
    || gitProvenance.provenance_digest !== todoSelfDigest(gitProvenance, 'provenance_digest')) {
    fail('STRUCTURE_OVERLAY_PROVENANCE_INVALID', 'git_provenance_invalid');
  }
}

function normalizeTaskStates(structureSet, taskStates) {
  if (!Array.isArray(taskStates)) fail('STRUCTURE_OVERLAY_INPUT_INVALID', 'task_states_invalid');
  const expected = new Set(structureSet.tasks.map(({ task_id: id }) => id));
  const states = new Map();
  for (const entry of taskStates) {
    if (!isPlain(entry) || Object.keys(entry).length !== 2
      || typeof entry.task_id !== 'string'
      || !['pending', 'in-progress', 'blocked', 'done'].includes(entry.status)
      || !expected.has(entry.task_id) || states.has(entry.task_id)) {
      fail('STRUCTURE_OVERLAY_INPUT_INVALID', 'task_state_entry_invalid');
    }
    states.set(entry.task_id, entry.status);
  }
  if (states.size !== expected.size) fail('STRUCTURE_OVERLAY_INPUT_INVALID', 'task_state_coverage_invalid');
  return states;
}

function normalizeRealizations(structureSet, realizations) {
  if (!Array.isArray(realizations)) fail('STRUCTURE_OVERLAY_INPUT_INVALID', 'realizations_invalid');
  const grouped = new Map();
  for (const realization of realizations) {
    const taskEntries = grouped.get(realization?.task_id) ?? [];
    taskEntries.push(realization);
    grouped.set(realization?.task_id, taskEntries);
  }
  const latest = new Map();
  for (const [taskId, entries] of grouped) {
    entries.sort((left, right) => left.sequence - right.sequence);
    let previous = null;
    const priorDigests = new Set();
    for (const realization of entries) {
      const explained = explainTodoStructureRealization(realization, {
        structureSet, previous, priorDigests,
      });
      if (!explained.valid) {
        fail('STRUCTURE_OVERLAY_REALIZATION_INVALID', explained.reason, {
          task_id: taskId ?? null, path: explained.path,
        });
      }
      priorDigests.add(realization.realization_digest);
      previous = realization;
    }
    latest.set(taskId, previous);
  }
  return { grouped, latest };
}

function finding({ code, severity, taskIds = [], dataRefs = [], codeRefs = [], commitOids = [],
  observed = null, expected = null, nextAction }) {
  return {
    code,
    severity,
    task_ids: [...new Set(taskIds)].sort(compareText),
    data_refs: [...new Set(dataRefs)].sort(compareText),
    code_refs: [...new Set(codeRefs)].sort(compareText),
    commit_oids: [...new Set(commitOids)].sort(compareText),
    evidence: { observed, expected },
    next_action: nextAction,
  };
}

function mergeFindings(raw) {
  const grouped = new Map();
  for (const entry of raw) {
    const key = digestTodoArtifact({
      code: entry.code, severity: entry.severity, evidence: entry.evidence,
      next_action: entry.next_action,
    });
    const current = grouped.get(key);
    if (current === undefined) {
      grouped.set(key, structuredClone(entry));
      continue;
    }
    for (const [field, values] of [
      ['task_ids', entry.task_ids], ['data_refs', entry.data_refs],
      ['code_refs', entry.code_refs], ['commit_oids', entry.commit_oids],
    ]) current[field] = [...new Set([...current[field], ...values])].sort(compareText);
  }
  const merged = [...grouped.values()].sort((left, right) => compareText(left.code, right.code)
    || canonicalCompare(left.evidence, right.evidence));
  return merged.map((entry) => {
    const value = { ...entry, finding_digest: '' };
    value.finding_digest = todoSelfDigest(value, 'finding_digest');
    return value;
  });
}

function contractsDiffer(producer, consumer) {
  const fields = [];
  const shapeCompatible = producer.shape_id === consumer.shape_id
    || consumer.compatible_shape_ids.includes(producer.shape_id);
  if (!shapeCompatible) fields.push('shape_id');
  if (JSON.stringify(producer.identity_fields) !== JSON.stringify(consumer.identity_fields)) {
    fields.push('identity_fields');
  }
  if (producer.lifecycle !== consumer.lifecycle) fields.push('lifecycle');
  if (producer.cardinality !== consumer.cardinality) fields.push('cardinality');
  return fields;
}

function nextActionForAnchor(code) {
  if (code === 'STRUCTURE_SENSOR_UNREADY') return 'refresh_sensor_index_then_recompile_structure';
  if (code === 'STRUCTURE_CODE_ANCHOR_AMBIGUOUS') return 'replace_symbol_with_an_exact_qualified_anchor';
  if (code === 'STRUCTURE_CODE_ANCHOR_TIME_DEFERRED') return 'compile_the_required_baseline_or_task_overlay';
  return 'correct_the_code_anchor_or_source_then_recompile_structure';
}

function anchorFindings(structureSet, sourceProjection) {
  const findings = [];
  const graphTaskIds = structureSet.tasks
    .filter(({ applicability }) => applicability === 'graph').map(({ task_id: id }) => id);
  if (sourceProjection.sensor_status.outcome !== 'ready') {
    findings.push(finding({
      code: 'STRUCTURE_SENSOR_UNREADY', severity: 'unknown', taskIds: graphTaskIds,
      observed: sourceProjection.sensor_status.outcome, expected: 'ready',
      nextAction: nextActionForAnchor('STRUCTURE_SENSOR_UNREADY'),
    }));
    return findings;
  }
  for (const anchor of sourceProjection.anchors) {
    if (anchor.verdict === 'consistent') continue;
    findings.push(finding({
      code: anchor.reason ?? 'STRUCTURE_INPUT_UNRESOLVED',
      severity: anchor.verdict === 'inconsistent' ? 'error' : 'unknown',
      taskIds: [anchor.task_id], codeRefs: [`${anchor.task_id}/${anchor.anchor_id}`],
      observed: {
        existence: anchor.existence, coverage: anchor.coverage,
        candidates: anchor.candidates ?? [], edge_state: anchor.edges.state,
      },
      expected: { effect: anchor.effect, expected_at: anchor.expected_at },
      nextAction: nextActionForAnchor(anchor.reason),
    }));
  }
  return findings;
}

function sourceRefKey(taskId, source) {
  if (source.kind === 'task_output') return `data:${source.task_id}/${source.port_id}`;
  if (source.kind === 'code') return `code:${taskId}/${source.anchor_id}`;
  if (source.kind === 'external') return `external:${source.contract_id}`;
  return `constant:${taskId}/${source.constant_id}`;
}

function sinkRefKey(taskId, sink) {
  if (sink.kind === 'task') return `task:${sink.task_id}`;
  if (sink.kind === 'code') return `code:${taskId}/${sink.anchor_id}`;
  if (sink.kind === 'external') return `external:${sink.contract_id}`;
  return `final:${sink.product_id}`;
}

function sourceNeighborRef(edge) {
  return `source:${digestTodoArtifact(edge).slice(0, 32)}`;
}

function buildOverlayGraph(structureSet, states, latestRealizations, sourceProjection, gitProvenance) {
  const nodes = [];
  const edges = [];
  const effective = new Map();
  for (const task of structureSet.tasks) {
    if (task.applicability !== 'graph') continue;
    const realization = latestRealizations.get(task.task_id) ?? null;
    const transform = realization?.realized ?? task.planned;
    effective.set(task.task_id, transform);
    nodes.push({
      kind: 'task_transform', ref: `task:${task.task_id}`, task_id: task.task_id,
      state: states.get(task.task_id), form: realization === null ? 'planned' : 'realized',
      transform_digest: digestTodoStructureTransform(transform),
    });
    for (const anchor of transform.code_anchors) {
      const observed = sourceProjection.anchors.find((entry) => entry.task_id === task.task_id
        && entry.anchor_id === anchor.anchor_id) ?? null;
      nodes.push({
        kind: 'code', ref: `code:${task.task_id}/${anchor.anchor_id}`,
        task_id: task.task_id, anchor_id: anchor.anchor_id,
        natural_ref: observed?.node ?? null, observation: observed?.verdict ?? 'unknown',
      });
      if (observed !== null) {
        for (const incoming of observed.edges.incoming) {
          const neighbor = sourceNeighborRef(incoming);
          nodes.push({ kind: 'source_symbol', ref: neighbor, natural_ref: structuredClone(incoming) });
          edges.push({
            kind: 'source_edge', from: neighbor, to: `code:${task.task_id}/${anchor.anchor_id}`,
            edge_kind: incoming.edge_kind,
          });
        }
        for (const outgoing of observed.edges.outgoing) {
          const neighbor = sourceNeighborRef(outgoing);
          nodes.push({ kind: 'source_symbol', ref: neighbor, natural_ref: structuredClone(outgoing) });
          edges.push({
            kind: 'source_edge', from: `code:${task.task_id}/${anchor.anchor_id}`, to: neighbor,
            edge_kind: outgoing.edge_kind,
          });
        }
      }
    }
    for (const input of transform.inputs) {
      edges.push({
        kind: 'input', from: sourceRefKey(task.task_id, input.source),
        to: `task:${task.task_id}`, port_id: input.port_id,
      });
      if (input.source.kind === 'constant') {
        nodes.push({ kind: 'constant', ref: sourceRefKey(task.task_id, input.source) });
      }
    }
    for (const output of transform.outputs) {
      const dataRef = `data:${task.task_id}/${output.port_id}`;
      nodes.push({
        kind: 'data', ref: dataRef, task_id: task.task_id, port_id: output.port_id,
        data_id: output.data_id, contract: structuredClone(output.contract),
      });
      edges.push({ kind: 'output', from: `task:${task.task_id}`, to: dataRef, port_id: output.port_id });
      for (const sink of output.sinks) {
        const sinkRef = sinkRefKey(task.task_id, sink);
        edges.push({
          kind: 'sink', from: dataRef, to: sinkRef, port_id: output.port_id,
          target_port_id: sink.kind === 'task' ? sink.port_id : null,
        });
        if (sink.kind === 'final_product') nodes.push({ kind: 'final_product', ref: sinkRef });
      }
    }
  }
  for (const external of structureSet.external_contracts) {
    nodes.push({
      kind: 'external', ref: `external:${external.contract_id}`,
      contract_id: external.contract_id, contract: structuredClone(external.contract),
    });
  }
  for (const changeset of gitProvenance.changesets) {
    nodes.push({
      kind: 'changeset', ref: `commit:${changeset.commit_oid}`,
      commit_oid: changeset.commit_oid, changeset_digest: changeset.changeset_digest,
    });
  }
  for (const [taskId, realization] of latestRealizations) {
    for (const commitOid of realization.commit_oids) {
      edges.push({
        kind: 'realization', from: `commit:${commitOid}`, to: `task:${taskId}`,
        realization_digest: realization.realization_digest,
      });
    }
  }
  const uniqueNodes = [...new Map(nodes.map((node) => [`${node.kind}\0${node.ref}`, node])).values()];
  uniqueNodes.sort((left, right) => compareText(left.ref, right.ref) || compareText(left.kind, right.kind));
  edges.sort((left, right) => compareText(left.from, right.from)
    || compareText(left.to, right.to) || compareText(left.kind, right.kind));
  return { nodes: uniqueNodes, edges, effective };
}

function connectionFindings(structureSet, effective, topologyDag) {
  const findings = [];
  const externalById = new Map(structureSet.external_contracts
    .map((external) => [external.contract_id, external]));
  const topologyByTask = new Map(topologyDag.nodes
    .filter(({ ref }) => ref.project_id === structureSet.project_id
      && ref.plan_key === structureSet.plan_key)
    .map(({ key, ref }) => [ref.task_id, key]));
  for (const task of structureSet.tasks) {
    if (!topologyByTask.has(task.task_id)) {
      findings.push(finding({
        code: 'STRUCTURE_COVERAGE_MISSING', severity: 'error', taskIds: [task.task_id],
        observed: null, expected: { topology_task: task.task_id },
        nextAction: 'repair_the_registered_todo_topology',
      }));
    }
  }
  const structureTaskIds = new Set(structureSet.tasks.map(({ task_id: id }) => id));
  const extraTopologyTasks = topologyDag.nodes
    .filter(({ ref }) => ref.project_id === structureSet.project_id
      && ref.plan_key === structureSet.plan_key && !structureTaskIds.has(ref.task_id))
    .map(({ ref }) => ref.task_id).sort(compareText);
  if (extraTopologyTasks.length > 0) findings.push(finding({
    code: 'STRUCTURE_COVERAGE_MISSING', severity: 'error', taskIds: extraTopologyTasks,
    observed: { topology_only_task_ids: extraTopologyTasks }, expected: 'graph or excluded structure entry',
    nextAction: 'add_structure_entries_for_every_registered_todo',
  }));

  const relations = [];
  const dataEdges = [];
  for (const [consumerId, transform] of effective) {
    for (const input of transform.inputs) {
      if (input.source.kind === 'external') {
        const external = externalById.get(input.source.contract_id);
        const fields = contractsDiffer(external.contract, input.contract);
        if (fields.length > 0) findings.push(finding({
          code: 'STRUCTURE_CONTRACT_MISMATCH', severity: 'error', taskIds: [consumerId],
          dataRefs: [`external/${external.contract_id}`, `${consumerId}/${input.port_id}`],
          observed: { producer: external.contract, mismatched_fields: fields },
          expected: { consumer: input.contract },
          nextAction: 'align_the_external_and_consumer_data_contracts',
        }));
      }
      if (input.source.kind !== 'task_output') continue;
      const producerId = input.source.task_id;
      const producer = effective.get(producerId);
      const output = producer?.outputs.find(({ port_id: id }) => id === input.source.port_id) ?? null;
      if (output === null) {
        findings.push(finding({
          code: 'STRUCTURE_INPUT_UNRESOLVED', severity: 'error',
          taskIds: [producerId, consumerId],
          dataRefs: [`${producerId}/${input.source.port_id}`, `${consumerId}/${input.port_id}`],
          observed: null, expected: input.source,
          nextAction: 'correct_the_task_output_reference',
        }));
        continue;
      }
      dataEdges.push([producerId, consumerId]);
      const fields = contractsDiffer(output.contract, input.contract);
      if (fields.length > 0) {
        findings.push(finding({
          code: 'STRUCTURE_CONTRACT_MISMATCH', severity: 'error',
          taskIds: [producerId, consumerId],
          dataRefs: [`${producerId}/${output.port_id}`, `${consumerId}/${input.port_id}`],
          observed: { producer: output.contract, mismatched_fields: fields },
          expected: { consumer: input.contract },
          nextAction: 'align_the_producer_and_consumer_data_contracts',
        }));
      }
      const from = topologyByTask.get(producerId);
      const to = topologyByTask.get(consumerId);
      if (from !== undefined && to !== undefined) relations.push({ from, to, producerId, consumerId });
    }
  }
  if (relations.length > 0) {
    const reachable = analyzeDagReachability(
      topologyDag.nodes.map(({ key }) => key),
      topologyDag.edges.map(({ from, to }) => [from, to]),
      relations.map(({ from, to }) => [from, to]),
    );
    relations.forEach((relation, index) => {
      if (reachable[index]) return;
      findings.push(finding({
        code: 'STRUCTURE_DEPENDENCY_MISSING', severity: 'error',
        taskIds: [relation.producerId, relation.consumerId],
        observed: { reachable: false },
        expected: { source_task_id: relation.producerId, target_task_id: relation.consumerId },
        nextAction: 'add_a_todo_dependency_from_source_task_to_target_task',
      }));
    });
  }
  try {
    analyzeDagChains([...effective.keys()], dataEdges, { representativeLimit: 0 });
  } catch (error) {
    if (!(error instanceof DagCycleError)) throw error;
    findings.push(finding({
      code: 'STRUCTURE_GRAPH_CYCLE', severity: 'error', taskIds: [...effective.keys()],
      observed: { data_edges: dataEdges }, expected: 'acyclic task dataflow',
      nextAction: 'remove_the_cyclic_task_output_connection',
    }));
  }

  const consumed = new Set();
  for (const transform of effective.values()) {
    for (const input of transform.inputs) {
      if (input.source.kind === 'task_output') {
        consumed.add(`${input.source.task_id}/${input.source.port_id}`);
      }
    }
  }
  for (const [taskId, transform] of effective) {
    for (const output of transform.outputs) {
      const dataRef = `${taskId}/${output.port_id}`;
      if (output.sinks.length === 0 && !consumed.has(dataRef)) {
        findings.push(finding({
          code: 'STRUCTURE_OUTPUT_ORPHANED', severity: 'error', taskIds: [taskId],
          dataRefs: [dataRef], observed: { sinks: [], consumers: [] },
          expected: 'at least one consumer or explicit sink',
          nextAction: 'connect_the_output_or_declare_its_explicit_sink',
        }));
      }
      for (const sink of output.sinks.filter(({ kind }) => kind === 'task')) {
        const consumer = effective.get(sink.task_id);
        const input = consumer?.inputs.find(({ port_id: id }) => id === sink.port_id) ?? null;
        if (input?.source.kind === 'task_output'
          && input.source.task_id === taskId && input.source.port_id === output.port_id) continue;
        findings.push(finding({
          code: 'STRUCTURE_INPUT_UNRESOLVED', severity: 'error',
          taskIds: [taskId, sink.task_id], dataRefs: [dataRef, `${sink.task_id}/${sink.port_id}`],
          observed: input?.source ?? null,
          expected: { kind: 'task_output', task_id: taskId, port_id: output.port_id },
          nextAction: 'make_the_output_sink_and_consumer_source_reciprocal',
        }));
      }
      for (const sink of output.sinks.filter(({ kind }) => kind === 'external')) {
        const external = externalById.get(sink.contract_id);
        const fields = contractsDiffer(output.contract, external.contract);
        if (fields.length > 0) findings.push(finding({
          code: 'STRUCTURE_CONTRACT_MISMATCH', severity: 'error', taskIds: [taskId],
          dataRefs: [dataRef, `external/${external.contract_id}`],
          observed: { producer: output.contract, mismatched_fields: fields },
          expected: { consumer: external.contract },
          nextAction: 'align_the_output_and_external_data_contracts',
        }));
      }
    }
  }
  return findings;
}

function realizationFindings(structureSet, states, realizations, gitProvenance, effective) {
  const findings = [];
  const changesets = new Map(gitProvenance.changesets.map((entry) => [entry.commit_oid, entry]));
  for (const task of structureSet.tasks) {
    if (task.applicability !== 'graph') continue;
    const state = states.get(task.task_id);
    const realization = realizations.latest.get(task.task_id) ?? null;
    if (realization === null) {
      if (state === 'done') {
        findings.push(finding({
          code: 'STRUCTURE_REALIZATION_MISSING', severity: 'error', taskIds: [task.task_id],
          observed: null, expected: 'fresh task realization',
          nextAction: 'record_the_task_realization_before_done',
        }));
      }
      continue;
    }
    let bound;
    try {
      bound = bindTodoStructureRealizationCommits({
        provenance: gitProvenance, realizations: [realization],
      })[0];
    } catch (error) {
      if (!(error instanceof TodoStructureGitError)
        || error.code !== 'STRUCTURE_REALIZATION_COMMIT_UNREACHABLE') throw error;
      findings.push(finding({
        code: 'STRUCTURE_COMMIT_UNBOUND', severity: 'error', taskIds: [task.task_id],
        commitOids: realization.commit_oids,
        observed: { baseline_range: gitProvenance.commit_order },
        expected: { commit_oids: realization.commit_oids },
        nextAction: 'replace_or_fetch_the_realization_commit_then_recompile',
      }));
      continue;
    }
    const changedPaths = new Set(bound.commits.flatMap(({ commit_oid: oid }) => (
      changesets.get(oid)?.changes.map(({ path }) => path) ?? []
    )));
    const unboundAnchors = effective.get(task.task_id).code_anchors
      .filter(({ effect }) => effect !== 'read')
      .filter(({ path }) => !changedPaths.has(path));
    if (unboundAnchors.length > 0) {
      findings.push(finding({
        code: 'STRUCTURE_COMMIT_UNBOUND', severity: 'unknown', taskIds: [task.task_id],
        codeRefs: unboundAnchors.map(({ anchor_id: id }) => `${task.task_id}/${id}`),
        commitOids: realization.commit_oids,
        observed: { changed_paths: [...changedPaths].sort(compareText) },
        expected: { anchor_paths: unboundAnchors.map(({ path }) => path).sort(compareText) },
        nextAction: 'correct_the_realization_commits_or_realized_code_anchors',
      }));
    }
  }
  return findings;
}

/** 四層の既存artifactを結合し、structure固有findingだけを導出するpure compiler。 */
export function compileTodoStructureOverlay({
  structureSet, topology, taskStates, sourceProjection, gitProvenance, realizations = [],
} = {}) {
  assertInputs(structureSet, sourceProjection, gitProvenance);
  const states = normalizeTaskStates(structureSet, taskStates);
  const normalizedRealizations = normalizeRealizations(structureSet, realizations);
  let todoChain;
  let topologyDag;
  try {
    todoChain = projectTodoChainV1(topology);
    topologyDag = projectTodoTopologyDagV1(topology);
  } catch (error) {
    if (error?.code !== 'TODO_CHAIN_CYCLE') throw error;
    const cycleFinding = mergeFindings([finding({
      code: 'STRUCTURE_GRAPH_CYCLE', severity: 'error',
      taskIds: structureSet.tasks.map(({ task_id: id }) => id),
      observed: 'cyclic registered todo topology', expected: 'acyclic registered todo topology',
      nextAction: 'repair_the_registered_todo_topology_cycle',
    })]);
    const result = {
      schema: TODO_STRUCTURE_OVERLAY_SCHEMA,
      structure_set_digest: structureSet.structure_set_digest,
      source_projection_digest: sourceProjection.projection_digest,
      git_provenance_digest: gitProvenance.provenance_digest,
      todo_chain: null, graph: { nodes: [], edges: [] },
      verdict: 'inconsistent', findings: cycleFinding,
      finding_summary: { total: 1, returned: 1, omitted: 0, errors: 1, unknowns: 0, notices: 0 },
      overlay_digest: '',
    };
    result.overlay_digest = todoSelfDigest(result, 'overlay_digest');
    return result;
  }
  const graph = buildOverlayGraph(
    structureSet, states, normalizedRealizations.latest, sourceProjection, gitProvenance,
  );
  const sourceAnchorKeys = new Set(sourceProjection.anchors
    .map(({ task_id: taskId, anchor_id: anchorId }) => `${taskId}\0${anchorId}`));
  const missingEffectiveAnchors = [...graph.effective].flatMap(([taskId, transform]) => (
    transform.code_anchors
      .filter(({ anchor_id: anchorId }) => !sourceAnchorKeys.has(`${taskId}\0${anchorId}`))
      .map(({ anchor_id: anchorId }) => finding({
        code: 'STRUCTURE_INPUT_UNRESOLVED', severity: 'unknown', taskIds: [taskId],
        codeRefs: [`${taskId}/${anchorId}`], observed: null,
        expected: 'source observation for the effective code anchor',
        nextAction: 'recompile_source_evidence_for_the_effective_realization',
      }))
  ));
  const rawFindings = [
    ...anchorFindings(structureSet, sourceProjection),
    ...missingEffectiveAnchors,
    ...connectionFindings(structureSet, graph.effective, topologyDag),
    ...realizationFindings(
      structureSet, states, normalizedRealizations, gitProvenance, graph.effective,
    ),
  ];
  const allFindings = mergeFindings(rawFindings);
  const errors = allFindings.filter(({ severity }) => severity === 'error').length;
  const unknowns = allFindings.filter(({ severity }) => severity === 'unknown').length;
  const notices = allFindings.filter(({ severity }) => severity === 'notice').length;
  const overlay = {
    schema: TODO_STRUCTURE_OVERLAY_SCHEMA,
    structure_set_digest: structureSet.structure_set_digest,
    source_projection_digest: sourceProjection.projection_digest,
    git_provenance_digest: gitProvenance.provenance_digest,
    todo_chain: {
      schema: todoChain.schema,
      maximum_dependency_depth: todoChain.maximum_dependency_depth,
      longest_chain_count: todoChain.longest_chain_count,
      chain_digest: digestTodoArtifact(todoChain),
    },
    graph: { nodes: graph.nodes, edges: graph.edges },
    verdict: errors > 0 ? 'inconsistent' : unknowns > 0 ? 'unknown' : 'consistent',
    findings: allFindings.slice(0, TODO_STRUCTURE_FINDING_LIMIT),
    finding_summary: {
      total: allFindings.length,
      returned: Math.min(allFindings.length, TODO_STRUCTURE_FINDING_LIMIT),
      omitted: Math.max(0, allFindings.length - TODO_STRUCTURE_FINDING_LIMIT),
      errors, unknowns, notices,
    },
    overlay_digest: '',
  };
  overlay.overlay_digest = todoSelfDigest(overlay, 'overlay_digest');
  return overlay;
}
