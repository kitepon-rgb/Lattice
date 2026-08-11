import assert from 'node:assert/strict';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import { TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA } from '../src/todo-structure-git-adapter.mjs';
import {
  TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA,
} from '../src/todo-structure-source-adapter.mjs';
import {
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  TODO_STRUCTURE_SET_SCHEMA,
  digestTodoStructureTransform,
} from '../src/todo-structure-contracts.mjs';
import {
  TODO_STRUCTURE_OVERLAY_SCHEMA,
  TodoStructureOverlayError,
  compileTodoStructureOverlay,
} from '../src/todo-structure-overlay.mjs';

const DIGEST = (character) => character.repeat(64);
const SHA = (character) => character.repeat(40);

function contract(shapeId = 'compiled-source', overrides = {}) {
  return {
    shape_id: shapeId, schema_ref: null, identity_fields: ['source_id'],
    lifecycle: 'immutable_artifact', cardinality: 'one', compatible_shape_ids: [],
    ...overrides,
  };
}

function anchor(taskId) {
  return {
    anchor_id: 'implementation', effect: 'read', path: `src/${taskId}.mjs`,
    symbol: null, expected_at: 'current',
  };
}

function producer() {
  return {
    outcome: 'sourceを生成する',
    inputs: [{
      port_id: 'seed', source: { kind: 'constant', constant_id: 'seed', value: 'seed' },
      access: 'read', contract: contract('seed'),
    }],
    operations: [{
      operation_id: 'produce', input_port_ids: ['seed'], output_port_ids: ['source-out'],
      summary: 'sourceを生成する',
    }],
    outputs: [{
      port_id: 'source-out', data_id: 'source-data', contract: contract(),
      sinks: [{ kind: 'task', task_id: 'task-b', port_id: 'source-in' }],
    }],
    code_anchors: [anchor('task-a')], failures: ['生成失敗'],
    first_live_e2e: 'sourceを一件生成する', non_goals: ['transport変更'],
  };
}

function consumer() {
  return {
    outcome: 'sourceを公開する',
    inputs: [{
      port_id: 'source-in',
      source: { kind: 'task_output', task_id: 'task-a', port_id: 'source-out' },
      access: 'consume', contract: contract(),
    }],
    operations: [{
      operation_id: 'publish', input_port_ids: ['source-in'], output_port_ids: ['public-out'],
      summary: 'sourceを公開する',
    }],
    outputs: [{
      port_id: 'public-out', data_id: 'public-data', contract: contract(),
      sinks: [{ kind: 'final_product', product_id: 'public-product' }],
    }],
    code_anchors: [anchor('task-b')], failures: ['公開失敗'],
    first_live_e2e: 'sourceを一件公開する', non_goals: ['生成処理変更'],
  };
}

function structureSet(overrides = {}) {
  const value = {
    schema: TODO_STRUCTURE_SET_SCHEMA,
    project_id: 'lattice', plan_key: 'structure-plan', plan_version: 'v1',
    topology_digest: DIGEST('a'), profile: 'code-dataflow', baseline_sha: SHA('b'),
    external_contracts: [],
    tasks: [
      { task_id: 'task-a', applicability: 'graph', planned: producer() },
      { task_id: 'task-b', applicability: 'graph', planned: consumer() },
    ],
    structure_set_digest: '', ...overrides,
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

function sourceProjection(set, anchorOverrides = {}) {
  const anchors = set.tasks.filter(({ applicability }) => applicability === 'graph')
    .flatMap((task) => task.planned.code_anchors.map((codeAnchor) => ({
      task_id: task.task_id, anchor_id: codeAnchor.anchor_id,
      effect: codeAnchor.effect, expected_at: codeAnchor.expected_at,
      path: codeAnchor.path, symbol: codeAnchor.symbol,
      verdict: 'consistent', reason: null, existence: 'present', coverage: 'path_only',
      node: null, candidates: [],
      edges: {
        state: 'not_applicable', incoming: [], outgoing: [],
        incoming_omitted: 0, outgoing_omitted: 0,
        incoming_source_limit_reached: false, outgoing_source_limit_reached: false,
      },
      evidence: { status: null, path: null, symbol: null, callers: null, callees: null },
      ...(anchorOverrides[task.task_id] ?? {}),
    })));
  const value = {
    schema: TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA,
    structure_set_digest: set.structure_set_digest,
    sensor_status: { outcome: 'ready', evidence: { query_id: 'status', portable_digest: DIGEST('c') } },
    anchors,
    summary: {
      graph_tasks: anchors.length, excluded_tasks: 0, projected_anchors: anchors.length,
      omitted_anchors: 0, incoming_edges_omitted: 0, outgoing_edges_omitted: 0,
    },
    projection_digest: '',
  };
  value.projection_digest = todoSelfDigest(value, 'projection_digest');
  return value;
}

function gitProvenance(set, changesets = []) {
  const value = {
    schema: TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA,
    structure_set_digest: set.structure_set_digest,
    baseline_sha: set.baseline_sha, head_sha: changesets.at(-1)?.commit_oid ?? set.baseline_sha,
    commit_order: changesets.map(({ commit_oid: oid }) => oid), changesets,
    summary: {
      commits: changesets.length,
      changes: changesets.reduce((sum, entry) => sum + entry.changes.length, 0),
      changed_lines: 0, regular: 0, symlink: 0, submodule: 0, special: 0, binary: 0, renames: 0,
    },
    sensor_diff: {
      status: 'unknown', reason: 'STRUCTURE_SENSOR_DIFF_MISSING',
      projection: null, projection_digest: null,
    },
    provenance_digest: '',
  };
  value.provenance_digest = todoSelfDigest(value, 'provenance_digest');
  return value;
}

function changeset(commitOid, changes = []) {
  const value = {
    schema: 'lattice.todo_structure_changeset.v1', commit_oid: commitOid,
    parent_oids: [SHA('b')], changes, changeset_digest: '',
  };
  value.changeset_digest = todoSelfDigest(value, 'changeset_digest');
  return value;
}

function realization(set, taskId, commitOid) {
  const task = set.tasks.find(({ task_id: id }) => id === taskId);
  const value = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: set.project_id, plan_key: set.plan_key, plan_version: set.plan_version,
    task_id: taskId, sequence: 1, previous_digest: null,
    structure_set_digest: set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(task.planned),
    head_sha: commitOid, commit_oids: [commitOid], realized: structuredClone(task.planned),
    supersedes: null,
    actor: { host: 'MS-A2', session: 'codex-1', agent: 'bell' },
    recorded_at: '2026-08-11T14:00:00.000Z', realization_digest: '',
  };
  value.realization_digest = todoSelfDigest(value, 'realization_digest');
  return value;
}

const ref = (taskId) => ({ project_id: 'lattice', plan_key: 'structure-plan', task_id: taskId });
function topology(withDependency = true) {
  return {
    nodes: [ref('task-a'), ref('task-b')],
    hard_edges: withDependency ? [{ from: ref('task-a'), to: ref('task-b') }] : [],
    joins: [],
  };
}

const states = (a = 'pending', b = 'pending') => [
  { task_id: 'task-a', status: a }, { task_id: 'task-b', status: b },
];

function compile(set, overrides = {}) {
  return compileTodoStructureOverlay({
    structureSet: set,
    topology: topology(),
    taskStates: states(),
    sourceProjection: sourceProjection(set),
    gitProvenance: gitProvenance(set),
    ...overrides,
  });
}

test('planned task・port・anchorを既存ToDo chainへ重ねconsistentにする', () => {
  const set = structureSet();
  const result = compile(set);
  assert.equal(result.schema, TODO_STRUCTURE_OVERLAY_SCHEMA);
  assert.equal(result.verdict, 'consistent');
  assert.deepEqual(result.findings, []);
  assert.equal(result.todo_chain.maximum_dependency_depth, 2);
  assert.ok(result.graph.nodes.some(({ ref: nodeRef }) => nodeRef === 'task:task-a'));
  assert.ok(result.graph.nodes.some(({ ref: nodeRef }) => nodeRef === 'data:task-a/source-out'));
  assert.ok(result.graph.edges.some(({ from, to }) => (
    from === 'data:task-a/source-out' && to === 'task:task-b'
  )));
  assert.equal(JSON.stringify(result).includes('independence'), false);
});

test('bounded source edgeとrealization changesetをoverlay edgeへ接続する', () => {
  const set = structureSet();
  const commitOid = SHA('c');
  const source = sourceProjection(set, {
    'task-a': {
      edges: {
        state: 'complete',
        incoming: [{
          kind: 'function', path: 'src/caller.mjs', name: 'caller', start_line: 1,
          edge_kind: 'calls', value_ref: false, value_write: false,
        }],
        outgoing: [], incoming_omitted: 0, outgoing_omitted: 0,
        incoming_source_limit_reached: false, outgoing_source_limit_reached: false,
      },
    },
  });
  const result = compile(set, {
    taskStates: states('done', 'pending'),
    sourceProjection: source,
    gitProvenance: gitProvenance(set, [changeset(commitOid)]),
    realizations: [realization(set, 'task-a', commitOid)],
  });
  assert.equal(result.verdict, 'consistent');
  assert.ok(result.graph.nodes.some(({ kind }) => kind === 'source_symbol'));
  assert.ok(result.graph.edges.some(({ kind, to }) => (
    kind === 'source_edge' && to === 'code:task-a/implementation'
  )));
  assert.ok(result.graph.edges.some(({ kind, from, to }) => (
    kind === 'realization' && from === `commit:${commitOid}` && to === 'task:task-a'
  )));
});

test('task outputにToDo到達性が無ければ追加すべきsource／target taskを返す', () => {
  const set = structureSet();
  const result = compile(set, { topology: topology(false) });
  const dependency = result.findings.find(({ code }) => code === 'STRUCTURE_DEPENDENCY_MISSING');
  assert.equal(result.verdict, 'inconsistent');
  assert.deepEqual(dependency.task_ids, ['task-a', 'task-b']);
  assert.deepEqual(dependency.evidence.expected, {
    source_task_id: 'task-a', target_task_id: 'task-b',
  });
});

test('shape・identity・lifecycle mismatchを証拠不足unknownと分離する', () => {
  const set = structureSet();
  set.tasks[1].planned.inputs[0].contract = contract('other-shape', {
    identity_fields: ['other_id'], lifecycle: 'mutable_state',
  });
  set.structure_set_digest = todoSelfDigest(set, 'structure_set_digest');
  const result = compile(set, {
    sourceProjection: sourceProjection(set), gitProvenance: gitProvenance(set),
  });
  const mismatch = result.findings.find(({ code }) => code === 'STRUCTURE_CONTRACT_MISMATCH');
  assert.equal(mismatch.severity, 'error');
  assert.deepEqual(mismatch.evidence.observed.mismatched_fields,
    ['shape_id', 'identity_fields', 'lifecycle']);

  const uncertainSource = sourceProjection(set, {
    'task-a': {
      verdict: 'unknown', reason: 'STRUCTURE_CODE_ANCHOR_AMBIGUOUS', existence: 'unknown',
      coverage: 'unknown', candidates: [
        { kind: 'function', path: 'src/task-a.mjs', name: 'compile', qualified_name: null,
          start_line: 1, end_line: 2 },
      ],
    },
  });
  const uncertain = compile(set, {
    sourceProjection: uncertainSource, gitProvenance: gitProvenance(set),
  });
  const anchorFinding = uncertain.findings
    .find(({ code }) => code === 'STRUCTURE_CODE_ANCHOR_AMBIGUOUS');
  assert.equal(anchorFinding.severity, 'unknown');
  assert.equal(anchorFinding.evidence.observed.candidates.length, 1);
});

test('consumerもsinkも無いoutputをorphanとして返す', () => {
  const set = structureSet();
  set.tasks[1].planned.outputs[0].sinks = [];
  set.structure_set_digest = todoSelfDigest(set, 'structure_set_digest');
  const result = compile(set, {
    sourceProjection: sourceProjection(set), gitProvenance: gitProvenance(set),
  });
  const orphan = result.findings.find(({ code }) => code === 'STRUCTURE_OUTPUT_ORPHANED');
  assert.equal(orphan.severity, 'error');
  assert.deepEqual(orphan.data_refs, ['task-b/public-out']);
});

test('in-progressはrealizationを先取りせず、doneのrealization欠損だけをerrorにする', () => {
  const set = structureSet();
  const active = compile(set, { taskStates: states('in-progress', 'pending') });
  assert.equal(active.verdict, 'consistent');
  assert.equal(active.findings.some(({ code }) => code === 'STRUCTURE_COMMIT_UNBOUND'), false);

  const done = compile(set, { taskStates: states('done', 'pending') });
  const missing = done.findings.find(({ code }) => code === 'STRUCTURE_REALIZATION_MISSING');
  assert.equal(done.verdict, 'inconsistent');
  assert.equal(missing.severity, 'error');
});

test('sensor非readyはanchorごとに増殖させず一原因へtask集合を束ねる', () => {
  const set = structureSet();
  const source = sourceProjection(set);
  source.sensor_status.outcome = 'stale';
  source.projection_digest = todoSelfDigest(source, 'projection_digest');
  const result = compile(set, { sourceProjection: source });
  const findings = result.findings.filter(({ code }) => code === 'STRUCTURE_SENSOR_UNREADY');
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].task_ids, ['task-a', 'task-b']);
  assert.equal(result.verdict, 'unknown');
});

test('registered ToDo cycleは既存chainのtyped判定をstructure findingへ写す', () => {
  const set = structureSet();
  const cyclic = topology();
  cyclic.hard_edges.push({ from: ref('task-b'), to: ref('task-a') });
  const result = compile(set, { topology: cyclic });
  assert.equal(result.verdict, 'inconsistent');
  assert.equal(result.findings[0].code, 'STRUCTURE_GRAPH_CYCLE');
  assert.match(result.overlay_digest, /^[0-9a-f]{64}$/u);
});

test('同一planのtopology-only taskをstructure coverage漏れとして返す', () => {
  const set = structureSet();
  const expanded = topology();
  expanded.nodes.push(ref('task-c'));
  const result = compile(set, { topology: expanded });
  const coverage = result.findings.find(({ code }) => code === 'STRUCTURE_COVERAGE_MISSING');
  assert.deepEqual(coverage.task_ids, ['task-c']);
  assert.deepEqual(coverage.evidence.observed, { topology_only_task_ids: ['task-c'] });
});

test('source／provenance digest改竄を未設定へ丸めず拒否する', () => {
  const set = structureSet();
  const source = sourceProjection(set); source.anchors[0].verdict = 'unknown';
  assert.throws(() => compile(set, { sourceProjection: source }),
    (error) => error instanceof TodoStructureOverlayError
      && error.code === 'STRUCTURE_OVERLAY_SOURCE_INVALID');
  const provenance = gitProvenance(set); provenance.head_sha = SHA('f');
  assert.throws(() => compile(set, { gitProvenance: provenance }),
    (error) => error instanceof TodoStructureOverlayError
      && error.code === 'STRUCTURE_OVERLAY_PROVENANCE_INVALID');
});
