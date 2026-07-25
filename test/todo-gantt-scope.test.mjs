import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';
import { projectTodoGanttScope } from '../src/todo-gantt-scope.mjs';
import { projectTodoChainV1 } from '../src/todo-chain.mjs';

const ref = (task_id, plan_key = 'plan', project_id = 'project') => ({ project_id, plan_key, task_id });
const dependency = (from, to) => ({ from, to });

function fixture(tasks, hardEdges = []) {
  const members = [{
    plan: {
      project_id: 'project', plan_key: 'plan',
      tasks: tasks.map(({ id, lane = 'main', title = id }) => ({ task_id: id, lane, title })),
      hard_dependencies: hardEdges, joins: [],
    },
    tasks: tasks.map(({ id, status = 'pending' }) => ({ task_id: id, status })),
  }];
  return {
    read: { schema: 'lattice.todo_store_read.v1', project_id: 'project', members },
    topology: { nodes: tasks.map(({ id }) => ref(id)), hard_edges: hardEdges, joins: [] },
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

test('全taskがdoneなら図は畳み込みnodeだけになる', () => {
  const A = ref('A');
  const B = ref('B');
  const input = fixture([
    { id: 'A', status: 'done' }, { id: 'B', status: 'done' },
  ], [dependency(A, B)]);
  const live = layoutOf(input, { scope: 'live' });
  assert.equal(live.scope.folded_task_count, 2);
  assert.equal(live.nodes.length, 1);
  assert.equal(live.nodes[0].fold.task_count, 2);
  assert.equal(live.nodes[0].status, 'done');
  assert.equal(live.metrics.task_count, 2, '総数はフルグラフ基準で保つ');
});

test('縮約で閉路になる f1->s->f2 形はper-wave分割で解消する', () => {
  const f1 = ref('f1');
  const f2 = ref('f2');
  const s = ref('s');
  const live = ref('live');
  // f1(done) -> f2(done) は同じ畳み込み成分。f1 -> s -> f2 が成分をまたいで戻るため、
  // 成分をそのまま1nodeへ縮約すると summary -> s -> summary の閉路になる。
  const input = fixture([
    { id: 'f1', status: 'done' }, { id: 'f2', status: 'done' },
    { id: 's', status: 'done' }, { id: 'live', status: 'pending' },
  ], [dependency(f1, f2), dependency(f1, s), dependency(s, f2), dependency(s, live)]);

  const projected = layoutOf(input, { scope: 'live' });
  assert.equal(projected.scope.per_wave_refinement, true, 'refinement must have fired');
  assertAcyclic(projected);

  const drawn = new Set(projected.nodes.map((node) => node.ref.task_id));
  assert.equal(drawn.has('live'), true);
  assert.equal(drawn.has('s'), true, 'live作業の直接前提は残る');
  assert.equal(projected.folded.map(({ task }) => task.task_id).sort().join(','), 'f1,f2');
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
  assert.equal(result.folds.length, 0);
  assert.equal(result.refined, false);
});

test('畳み込みnodeのlaneとrefは決定的である', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const input = fixture([
    { id: 'A', lane: 'alpha', status: 'done' },
    { id: 'B', lane: 'alpha', status: 'done' },
    { id: 'C', lane: 'beta', status: 'done' },
  ], [dependency(A, B)]);
  const first = layoutOf(input, { scope: 'live' });
  const second = layoutOf(input, { scope: 'live' });
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  // A,Bは連結成分、Cは独立成分。lane優勢はalpha。
  const lanes = first.nodes.map((node) => node.lane).sort();
  assert.deepEqual(lanes, ['alpha', 'beta']);
  assert.deepEqual(first.scope.folds.map(({ task_count }) => task_count).sort(), [1, 2]);
});
