import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';
import { projectTodoGanttScope } from '../src/todo-gantt-scope.mjs';
import { projectTodoChainV1 } from '../src/todo-chain.mjs';

const ref = (task_id, plan_key = 'plan', project_id = 'project') => ({ project_id, plan_key, task_id });
const dependency = (from, to) => ({ from, to });

function fixture(tasks, hardEdges = []) {
  return plansFixture([{ planKey: 'plan', tasks }], hardEdges);
}

function plansFixture(plans, hardEdges = []) {
  const members = plans.map(({ planKey, tasks }) => ({
    plan: {
      project_id: 'project', plan_key: planKey,
      tasks: tasks.map(({ id, lane = 'main', title = id }) => ({ task_id: id, lane, title })),
      hard_dependencies: hardEdges.filter(({ from, to }) => from.plan_key === planKey
        || to.plan_key === planKey),
      joins: [],
    },
    tasks: tasks.map(({ id, status = 'pending' }) => ({ task_id: id, status })),
  }));
  const nodes = plans.flatMap(({ planKey, tasks }) => tasks.map(({ id }) => ref(id, planKey)));
  return {
    read: { schema: 'lattice.todo_store_read.v1', project_id: 'project', members },
    topology: { nodes, hard_edges: hardEdges, joins: [] },
  };
}

const layoutOf = (input, options) => layoutTodoGantt(input.read, projectTodoChainV1(input.topology), options);

/** Kahn peel over the projected layout edges. */
function assertAcyclic(layout) {
  const key = (value) => `${value.project_id}\0${value.plan_key}\0${value.task_id}`;
  const indegree = new Map(layout.nodes.map((node) => [key(node.ref), 0]));
  const outgoing = new Map(layout.nodes.map((node) => [key(node.ref), []]));
  const seen = new Set();
  for (const edge of layout.edges) {
    if (seen.has(edge.semantic_edge_id)) continue;
    seen.add(edge.semantic_edge_id);
    outgoing.get(key(edge.from)).push(key(edge.to));
    indegree.set(key(edge.to), indegree.get(key(edge.to)) + 1);
  }
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([node]) => node);
  let visited = 0;
  while (ready.length > 0) {
    const current = ready.pop();
    visited += 1;
    for (const next of outgoing.get(current)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  assert.equal(visited, layout.nodes.length, 'projected layout must stay acyclic');
}

test('全taskがdoneなら図から工程が消える', () => {
  const A = ref('A');
  const B = ref('B');
  const input = fixture([
    { id: 'A', status: 'done' }, { id: 'B', status: 'done' },
  ], [dependency(A, B)]);
  const live = layoutOf(input, { scope: 'live' });
  assert.equal(live.scope.folded_task_count, 2);
  assert.equal(live.nodes.length, 0, 'まとめnodeという代わりの箱も置かない');
  assert.equal(live.edges.length, 0);
  assert.equal(live.metrics.task_count, 2, '総数はフルグラフ基準で保つ');
  assert.deepEqual(live.folded.map(({ task_id }) => task_id), ['A', 'B']);
});

test('完走したplanは図に一切場所を取らない', () => {
  const input = plansFixture([
    { planKey: 'left', tasks: [{ id: 'L1', status: 'done' }, { id: 'L2', status: 'done' }] },
    { planKey: 'right', tasks: [{ id: 'R1', status: 'done' }, { id: 'R2', status: 'pending' }] },
  ], [dependency(ref('L1', 'left'), ref('L2', 'left'))]);
  const live = layoutOf(input, { scope: 'live' });
  // 完走したleft planは、まとめnode1個ぶんの列すら占めない。
  assert.deepEqual(live.nodes.map((node) => node.ref.task_id), ['R2']);
  assert.equal(live.scope.folded_task_count, 3);
  assert.deepEqual(live.folded.map(({ plan_key, task_id }) => `${plan_key}/${task_id}`),
    ['left/L1', 'left/L2', 'right/R1']);
});

test('生きた作業とその直接前提は残り、その先の死んだ枝だけが消える', () => {
  const f1 = ref('f1');
  const f2 = ref('f2');
  const s = ref('s');
  const live = ref('live');
  const input = fixture([
    { id: 'f1', status: 'done' }, { id: 'f2', status: 'done' },
    { id: 's', status: 'done' }, { id: 'live', status: 'pending' },
  ], [dependency(f1, f2), dependency(f1, s), dependency(s, f2), dependency(s, live)]);

  const projected = layoutOf(input, { scope: 'live' });
  assertAcyclic(projected);
  const drawn = projected.nodes.map((node) => node.ref.task_id).sort();
  assert.deepEqual(drawn, ['live', 's'], 'live作業とその直接前提だけが残る');
  assert.deepEqual(projected.folded.map(({ task_id }) => task_id), ['f1', 'f2']);
  // f1 -> s のedgeは、片端が消えたので図からも消える。
  assert.deepEqual(projected.edges.map((edge) => `${edge.from.task_id}->${edge.to.task_id}`),
    ['s->live']);
});

test('projectTodoGanttScopeはfoldableが無ければ入力をそのまま返す', () => {
  const nodes = [
    { key: 'a', ref: ref('A'), title: 'A', lane: 'main', status: 'pending' },
    { key: 'b', ref: ref('B'), title: 'B', lane: 'main', status: 'in-progress' },
  ];
  const edges = [{ key: 'a->b', from: 'a', to: 'b', kinds: new Set(['hard']), joinIdentities: new Map() }];
  const wave = new Map([['a', 0], ['b', 1]]);
  const result = projectTodoGanttScope({ nodes, edges, wave });
  assert.equal(result.nodes, nodes);
  assert.equal(result.edges, edges);
  assert.equal(result.foldedKeys.size, 0);
});

test('同じ入力からは同じ図が出る', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const input = fixture([
    { id: 'A', lane: 'alpha', status: 'done' },
    { id: 'B', lane: 'alpha', status: 'done' },
    { id: 'C', lane: 'beta', status: 'pending' },
  ], [dependency(A, B), dependency(B, C)]);
  const first = layoutOf(input, { scope: 'live' });
  const second = layoutOf(input, { scope: 'live' });
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.deepEqual(first.nodes.map((node) => node.ref.task_id), ['B', 'C']);
  assert.deepEqual(first.folded.map(({ task_id }) => task_id), ['A']);
});
