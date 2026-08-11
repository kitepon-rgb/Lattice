import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  digestTodoStructureTransform,
  explainTodoStructureSet,
} from '../src/todo-structure-contracts.mjs';
import { TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA } from '../src/todo-structure-git-adapter.mjs';
import { compileTodoStructureOverlay } from '../src/todo-structure-overlay.mjs';
import { TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA } from '../src/todo-structure-source-adapter.mjs';
import {
  migratePeertableLogicalDataflowFixture,
  peertableFixtureContract,
  resealPeertableStructureSet,
} from './helpers/peertable-structure-migration-fixture.mjs';

const fixtureUrl = new URL('./fixtures/todo-structure/peertable-logical-dataflow-v0.json', import.meta.url);
const scenariosUrl = new URL('./fixtures/todo-structure/structure-scenarios-v0.json', import.meta.url);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

test('Peertable由来fixtureは未完了16件を秘密なしで固定する', async () => {
  const fixture = await readJson(fixtureUrl);
  assert.deepEqual(Object.keys(fixture), ['schema', 'captured_at', 'source', 'tasks']);
  assert.equal(fixture.schema, 'peertable.logical_dataflow.fixture.v0');
  assert.equal(fixture.tasks.length, 16);

  const refs = fixture.tasks.map(({ plan_key: planKey, task_id: taskId }) => `${planKey}/${taskId}`);
  assert.equal(new Set(refs).size, refs.length);
  assert.deepEqual([...new Set(fixture.tasks.map(({ status }) => status))].sort(), [
    'blocked', 'in-progress', 'pending',
  ]);
  assert.equal(fixture.tasks.filter(({ status }) => status === 'pending').length, 6);
  assert.equal(fixture.tasks.filter(({ status }) => status === 'in-progress').length, 9);
  assert.equal(fixture.tasks.filter(({ status }) => status === 'blocked').length, 1);

  for (const task of fixture.tasks) {
    assert.deepEqual(Object.keys(task), [
      'plan_key', 'task_id', 'status', 'outcome', 'receives', 'organizes', 'emits', 'failures',
      'first_live_e2e', 'non_goals',
    ]);
    for (const field of ['outcome', 'first_live_e2e']) assert.ok(task[field].length > 0);
    for (const field of ['receives', 'organizes', 'emits', 'failures', 'non_goals']) {
      assert.ok(task[field].length > 0, `${task.task_id}.${field}`);
      assert.ok(task[field].every((entry) => typeof entry === 'string' && entry.length > 0));
    }
  }

  const serialized = JSON.stringify(fixture);
  assert.doesNotMatch(serialized, /\/Users\/|PEERTABLE_POST_TOKEN|X-Peertable-Token|\.token\b/u);
});

test('structureシナリオは正例と5種類の負例を別verdictへ固定する', async () => {
  const fixture = await readJson(scenariosUrl);
  assert.deepEqual(Object.keys(fixture), ['schema', 'scenarios']);
  assert.equal(fixture.schema, 'lattice.todo_structure_scenarios.fixture.v0');
  assert.equal(fixture.scenarios.length, 6);
  assert.equal(new Set(fixture.scenarios.map(({ scenario_id: id }) => id)).size, 6);
  assert.deepEqual(
    fixture.scenarios.map(({ expected_verdict: verdict }) => verdict),
    ['consistent', 'inconsistent', 'inconsistent', 'inconsistent', 'unknown', 'inconsistent'],
  );
  assert.deepEqual(
    fixture.scenarios.slice(1).map(({ expected_finding_code: code }) => code),
    [
      'STRUCTURE_DEPENDENCY_MISSING',
      'STRUCTURE_CONTRACT_MISMATCH',
      'STRUCTURE_OUTPUT_ORPHANED',
      'STRUCTURE_CODE_ANCHOR_AMBIGUOUS',
      'STRUCTURE_FINAL_DRIFT',
    ],
  );
});

function sourceProjection(set) {
  const value = {
    schema: TODO_STRUCTURE_SOURCE_PROJECTION_SCHEMA,
    structure_set_digest: set.structure_set_digest,
    sensor_status: { outcome: 'ready', evidence: { query_id: 'status', portable_digest: 'c'.repeat(64) } },
    anchors: [], summary: {
      graph_tasks: set.tasks.length, excluded_tasks: 0, projected_anchors: 0,
      omitted_anchors: 0, incoming_edges_omitted: 0, outgoing_edges_omitted: 0,
    },
    projection_digest: '',
  };
  value.projection_digest = todoSelfDigest(value, 'projection_digest');
  return value;
}

function gitProvenance(set, commitOid = null) {
  const changesets = commitOid === null ? [] : [{
    schema: 'lattice.todo_structure_changeset.v1', commit_oid: commitOid,
    parent_oids: ['b'.repeat(40)], changes: [], changeset_digest: '',
  }];
  if (changesets.length > 0) {
    changesets[0].changeset_digest = todoSelfDigest(changesets[0], 'changeset_digest');
  }
  const value = {
    schema: TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA,
    structure_set_digest: set.structure_set_digest, baseline_sha: set.baseline_sha,
    head_sha: commitOid ?? set.baseline_sha,
    commit_order: commitOid === null ? [] : [commitOid], changesets,
    summary: {
      commits: changesets.length, changes: 0, changed_lines: 0, regular: 0,
      symlink: 0, submodule: 0, special: 0, binary: 0, renames: 0,
    },
    sensor_diff: { status: 'unknown', reason: 'STRUCTURE_SENSOR_DIFF_MISSING', projection: null,
      projection_digest: null },
    provenance_digest: '',
  };
  value.provenance_digest = todoSelfDigest(value, 'provenance_digest');
  return value;
}

function topology(set, dependencies = []) {
  const ref = (taskId) => ({
    project_id: set.project_id, plan_key: set.plan_key, task_id: taskId,
  });
  return {
    nodes: set.tasks.map(({ task_id: id }) => ref(id)),
    hard_edges: dependencies.map(([from, to]) => ({ from: ref(from), to: ref(to) })),
    joins: [],
  };
}

const states = (set, doneTaskId = null) => set.tasks.map(({ task_id: taskId }) => ({
  task_id: taskId, status: taskId === doneTaskId ? 'done' : 'pending',
}));

function compile(set, { dependencies = [], realizations = [], doneTaskId = null,
  commitOid = null } = {}) {
  return compileTodoStructureOverlay({
    structureSet: set, topology: topology(set, dependencies),
    taskStates: states(set, doneTaskId), sourceProjection: sourceProjection(set),
    gitProvenance: gitProvenance(set, commitOid), realizations,
  });
}

test('Peertable 16件をv1へ損失なく移し自由文code anchorをunknownとして列挙する', async () => {
  const fixture = await readJson(fixtureUrl);
  const migrated = migratePeertableLogicalDataflowFixture(fixture);
  assert.equal(migrated.structure_sets.length, 9);
  assert.equal(migrated.structure_sets.flatMap(({ tasks }) => tasks).length, 16);
  assert.equal(migrated.unresolved_code_anchors.length, 16);
  assert.deepEqual(migrated.unresolved_code_anchors.map(({ plan_key: planKey, task_id: taskId }) =>
    `${planKey}/${taskId}`), fixture.tasks.map(({ plan_key: planKey, task_id: taskId }) =>
    `${planKey}/${taskId}`));
  assert.equal(migrated.unresolved_code_anchors.every(({ reason }) =>
    reason === 'logical_dataflow_v0_has_no_code_path_or_symbol'), true);
  for (const set of migrated.structure_sets) {
    assert.deepEqual(explainTodoStructureSet(set), { valid: true });
  }
  const migratedTasks = migrated.structure_sets.flatMap(({ plan_key: planKey, tasks }) =>
    tasks.map((task) => [`${planKey}/${task.task_id}`, task.planned]));
  const plannedByRef = new Map(migratedTasks);
  for (const task of fixture.tasks) {
    const planned = plannedByRef.get(`${task.plan_key}/${task.task_id}`);
    assert.equal(planned.outcome, task.outcome);
    assert.deepEqual(planned.inputs.map(({ source }) => source.value), task.receives);
    assert.deepEqual(planned.operations.map(({ summary }) => summary), task.organizes);
    assert.equal(planned.outputs.length, task.emits.length);
    assert.deepEqual(planned.failures, [...task.failures].sort());
    assert.equal(planned.first_live_e2e, task.first_live_e2e);
    assert.deepEqual(planned.non_goals, [...task.non_goals].sort());
    assert.deepEqual(planned.code_anchors, []);
  }
});

test('Peertable由来の意図的な依存欠落・shape不一致を指し、修正後はrealized finalがconsistentになる', async () => {
  const fixture = await readJson(fixtureUrl);
  const migrated = migratePeertableLogicalDataflowFixture(fixture);
  let set = structuredClone(migrated.structure_sets.find(({ plan_key: planKey }) =>
    planKey === 'peertable-task-announcements-20260811'));
  const a2 = set.tasks.find(({ task_id: taskId }) => taskId === 'a2');
  const a3 = set.tasks.find(({ task_id: taskId }) => taskId === 'a3');
  a2.planned.outputs[0].contract = peertableFixtureContract('task-started-v1');
  a2.planned.outputs[0].sinks = [{ kind: 'task', task_id: 'a3', port_id: 'announcement-in' }];
  a3.planned.inputs.push({
    port_id: 'announcement-in',
    source: { kind: 'task_output', task_id: 'a2', port_id: a2.planned.outputs[0].port_id },
    access: 'consume', contract: peertableFixtureContract('task-completed-v1'),
  });
  a3.planned.inputs.sort((left, right) => left.port_id.localeCompare(right.port_id));
  set = resealPeertableStructureSet(set);
  const broken = compile(set);
  assert.equal(broken.verdict, 'inconsistent');
  const findings = new Map(broken.findings.map((finding) => [finding.code, finding]));
  assert.deepEqual(findings.get('STRUCTURE_DEPENDENCY_MISSING').task_ids, ['a2', 'a3']);
  assert.deepEqual(findings.get('STRUCTURE_CONTRACT_MISMATCH').data_refs,
    [`a2/${a2.planned.outputs[0].port_id}`, 'a3/announcement-in']);

  set.tasks.find(({ task_id: taskId }) => taskId === 'a3').planned.inputs
    .find(({ port_id: portId }) => portId === 'announcement-in').contract
    = peertableFixtureContract('task-started-v1');
  set = resealPeertableStructureSet(set);
  const planned = compile(set, { dependencies: [['a2', 'a3']] });
  assert.equal(planned.verdict, 'consistent', JSON.stringify(planned.findings));

  const commitOid = 'd'.repeat(40);
  const plannedA2 = set.tasks.find(({ task_id: taskId }) => taskId === 'a2').planned;
  const realizedTransform = structuredClone(plannedA2);
  realizedTransform.outcome = '工程着手eventを一度だけ全席へ配送した';
  const realization = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: set.project_id, plan_key: set.plan_key, plan_version: set.plan_version,
    task_id: 'a2', sequence: 1, previous_digest: null,
    structure_set_digest: set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(plannedA2), head_sha: commitOid,
    commit_oids: [commitOid], realized: realizedTransform, supersedes: null,
    actor: { host: 'fixture', session: 'fixture', agent: 'fixture' },
    recorded_at: '2026-08-11T14:00:00.000Z', realization_digest: '',
  };
  realization.realization_digest = todoSelfDigest(realization, 'realization_digest');
  const final = compile(set, {
    dependencies: [['a2', 'a3']], realizations: [realization],
    doneTaskId: 'a2', commitOid,
  });
  assert.equal(final.verdict, 'consistent');
  assert.equal(final.graph.nodes.find(({ ref }) => ref === 'task:a2').form, 'realized');
  assert.equal(final.graph.edges.some(({ kind, from, to }) => kind === 'sink'
    && from.startsWith('data:a2/') && to === 'task:a3'), true);
});
