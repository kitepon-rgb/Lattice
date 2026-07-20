import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { layoutTodoGantt, TodoGanttLayoutError } from '../src/todo-gantt-layout.mjs';
import { projectTodoChainV1 } from '../src/todo-chain.mjs';

const ref = (task_id, plan_key = 'plan', project_id = 'project') => ({ project_id, plan_key, task_id });
const dependency = (from, to) => ({ from, to });

function fixture(plans, hardEdges = [], joins = []) {
  const members = plans.map(({ plan_key, tasks }) => ({
    plan: {
      project_id: 'project', plan_key,
      tasks: tasks.map(({ id, lane, title = id }) => ({ task_id: id, lane, title })),
      hard_dependencies: hardEdges.filter(({ from }) => from.plan_key === plan_key),
      joins: joins.filter(({ owner }) => owner === plan_key).map(({ owner: _owner, ...join }) => join),
    },
    tasks: tasks.map(({ id, status = 'pending' }) => ({ task_id: id, status })),
  }));
  const nodes = plans.flatMap(({ plan_key, tasks }) => tasks.map(({ id }) => ref(id, plan_key)));
  return {
    read: { schema: 'lattice.todo_store_read.v1', project_id: 'project', members },
    topology: { nodes, hard_edges: hardEdges, joins: joins.map(({ owner: _owner, ...join }) => join) },
  };
}

function layoutOf(input) {
  return layoutTodoGantt(input.read, projectTodoChainV1(input.topology));
}

test('small branch/join/multi-lane DAG has a deterministic coordinate snapshot', () => {
  const A = ref('A', 'alpha');
  const B = ref('B', 'alpha');
  const C = ref('C', 'alpha');
  const D = ref('D', 'beta');
  const input = fixture([
    { plan_key: 'alpha', tasks: [{ id: 'A', lane: 'core', status: 'done' }, { id: 'B', lane: 'ui' }, { id: 'C', lane: 'core', status: 'in-progress' }] },
    { plan_key: 'beta', tasks: [{ id: 'D', lane: 'release' }] },
  ], [dependency(A, B), dependency(A, C)], [{ owner: 'beta', id: 'join-1', after: [B, C], before: D }]);

  const result = layoutOf(input);
  assert.deepEqual(result.nodes.map(({ ref: nodeRef, wave, row, visible, geometry }) => ({
    id: `${nodeRef.plan_key}/${nodeRef.task_id}`, wave, row, visible, geometry,
  })), [
    { id: 'alpha/A', wave: 0, row: 0, visible: true, geometry: { x: 16, y: 16, width: 272, height: 68 } },
    { id: 'alpha/B', wave: 1, row: 1, visible: true, geometry: { x: 312, y: 120, width: 272, height: 68 } },
    { id: 'alpha/C', wave: 1, row: 0, visible: true, geometry: { x: 16, y: 120, width: 272, height: 68 } },
    { id: 'beta/D', wave: 2, row: 0, visible: true, geometry: { x: 16, y: 224, width: 272, height: 68 } },
  ]);
  assert.deepEqual(result.edges.map(({ kinds, join_ids, visible, route }) => ({ kinds, join_ids, visible, route })), [
    { kinds: ['hard'], join_ids: [], visible: true, route: [[152, 84], [152, 102], [448, 102], [448, 120]] },
    { kinds: ['hard'], join_ids: [], visible: true, route: [[152, 84], [152, 102], [152, 102], [152, 120]] },
    { kinds: ['join'], join_ids: ['join-1'], visible: true, route: [[448, 188], [448, 206], [152, 206], [152, 224]] },
    { kinds: ['join'], join_ids: ['join-1'], visible: true, route: [[152, 188], [152, 206], [152, 206], [152, 224]] },
  ]);
  assert.deepEqual(result.sweep, { method: 'stable_median', rounds: 4, tie_break: 'previous_position_then_task_ref' });
  assert.equal(JSON.stringify(result).includes('critical'), false);
});

test('stable median sweep reduces crossings versus task-ref naive order', () => {
  const sourceIds = ['A', 'B', 'C'];
  const targetIds = ['X', 'Y', 'Z'];
  const edges = [
    dependency(ref('A'), ref('Z')),
    dependency(ref('B'), ref('Y')),
    dependency(ref('C'), ref('X')),
  ];
  const input = fixture([{ plan_key: 'plan', tasks: [...sourceIds, ...targetIds].map((id) => ({ id, lane: 'same' })) }], edges);
  const result = layoutOf(input);
  const naiveCrossings = 3;
  assert.equal(result.metrics.crossing_count, 0);
  assert.ok(result.metrics.crossing_count < naiveCrossings);
  assert.deepEqual(result.nodes.filter(({ wave }) => wave === 1).sort((a, b) => a.row - b.row).map(({ ref: nodeRef }) => nodeRef.task_id), ['Z', 'Y', 'X']);
});

test('layout has no folding projection and always exposes every task and dependency', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const D = ref('D');
  const E = ref('E');
  const input = fixture([{ plan_key: 'plan', tasks: [
    { id: 'A', lane: 'one', status: 'done' },
    { id: 'B', lane: 'one', status: 'pending' },
    { id: 'C', lane: 'two', status: 'pending' },
    { id: 'D', lane: 'two', status: 'in-progress' },
    { id: 'E', lane: 'two', status: 'blocked' },
  ] }], [dependency(A, B), dependency(A, C), dependency(B, E), dependency(D, E)]);

  const folded = layoutOf(input);
  const visibility = Object.fromEntries(folded.nodes.map((node) => [node.ref.task_id, node.visible]));
  assert.deepEqual(visibility, { A: true, B: true, C: true, D: true, E: true });
  // An isolated task is still drawn: the generated surface has no folded task/edge projection.
  input.read.members[0].plan.tasks.push({ task_id: 'F', lane: 'two', title: 'F' });
  input.read.members[0].tasks.push({ task_id: 'F', status: 'blocked' });
  input.topology.nodes.push(ref('F'));
  const withHidden = layoutOf(input);
  assert.equal(withHidden.nodes.find((node) => node.ref.task_id === 'F').visible, true);
  assert.equal(withHidden.metrics.visible_node_count, withHidden.metrics.task_count);
  assert.equal(withHidden.metrics.visible_edge_count, withHidden.metrics.edge_count);
  assert.deepEqual(withHidden.groups.plans, [{ plan_key: 'plan', task_count: 6 }]);
  assert.deepEqual(withHidden.groups.lanes, [
    { plan_key: 'plan', lane: 'one', task_count: 2 },
    { plan_key: 'plan', lane: 'two', task_count: 4 },
  ]);
  assert.doesNotMatch(JSON.stringify(withHidden), /fold|hidden|bundle/u);
});

test('input member/task/edge/join permutations produce byte-identical output', () => {
  const A = ref('A', 'a');
  const B = ref('B', 'a');
  const C = ref('C', 'b');
  const edges = [dependency(A, B), dependency(B, C)];
  const joins = [{ owner: 'b', id: 'j', after: [A], before: C }];
  const first = fixture([
    { plan_key: 'a', tasks: [{ id: 'A', lane: 'x', status: 'done' }, { id: 'B', lane: 'y' }] },
    { plan_key: 'b', tasks: [{ id: 'C', lane: 'z' }] },
  ], edges, joins);
  const second = structuredClone(first);
  second.read.members.reverse();
  for (const member of second.read.members) {
    member.plan.tasks.reverse(); member.tasks.reverse(); member.plan.hard_dependencies.reverse();
    for (const join of member.plan.joins) join.after.reverse();
  }
  second.topology.nodes.reverse(); second.topology.hard_edges.reverse(); second.topology.joins.reverse();
  assert.equal(JSON.stringify(layoutOf(first)), JSON.stringify(layoutOf(second)));
});

test('2,000 tasks / 8,000 unique edges layout completes within the suite contention budget', { timeout: 15_000 }, () => {
  const tasks = Array.from({ length: 2_000 }, (_, index) => ({
    id: String(index).padStart(4, '0'), lane: `lane-${index % 8}`, status: index < 4 ? 'done' : 'pending',
  }));
  const edges = [];
  const seen = new Set();
  for (let distance = 1; edges.length < 8_000; distance += 1) {
    for (let from = 0; from + distance < tasks.length && edges.length < 8_000; from += 1) {
      const key = `${from}:${from + distance}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(dependency(ref(tasks[from].id), ref(tasks[from + distance].id)));
    }
  }
  const input = fixture([{ plan_key: 'plan', tasks }], edges);
  const started = performance.now();
  const result = layoutOf(input);
  const elapsed = performance.now() - started;
  assert.equal(result.metrics.task_count, 2_000);
  assert.equal(result.metrics.edge_count, 8_000);
  assert.ok(elapsed < 10_000, `layout took ${elapsed.toFixed(1)}ms`);
});

test('scale overflow fails closed with typed detail', () => {
  const tasks = Array.from({ length: 2_001 }, (_, index) => ({ id: `T${index}`, lane: 'lane' }));
  const input = fixture([{ plan_key: 'plan', tasks }]);
  assert.throws(() => layoutOf(input), (error) => error instanceof TodoGanttLayoutError
    && error.code === 'TODO_SCALE_EXCEEDED' && error.detail.task_count === 2_001);
});
