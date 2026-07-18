import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  projectTodoChainV1,
  TodoChainCycleError,
} from '../src/todo-chain.mjs';

const assumptions = {
  unit_duration: true,
  capacity_ignored: true,
  conflict_ignored: true,
};

function ref(task_id, project_id = 'project', plan_key = 'plan') {
  return { project_id, plan_key, task_id };
}

function edge(from, to) {
  return { from, to };
}

function topology(nodes, hard_edges = [], joins = []) {
  return { nodes, hard_edges, joins };
}

test('分岐: node/edge和集合、本数、代表鎖を固定順で投影する', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const result = projectTodoChainV1(topology(
    [C, A, B],
    [edge(A, C), edge(A, B)],
  ));

  assert.deepEqual(result, {
    schema: 'lattice.todo_chain.v1',
    maximum_dependency_depth: 2,
    longest_chain_node_refs: [A, B, C],
    longest_chain_edges: [edge(A, B), edge(A, C)],
    longest_chain_count: { count: 2, overflow: false },
    representative_chains: [[A, B], [A, C]],
    assumptions,
  });
});

test('join: all-of barrierを展開しhard edgeとの重複を一度だけ数える', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const result = projectTodoChainV1({
    ...topology(
      [A, B, C],
      [edge(A, C)],
      [{ id: 'J', after: [B, A, A], before: C }],
    ),
    lane: 'ignored',
    status: 'ignored',
    conflict: 'ignored',
    capacity: 0,
    duration: 999,
  });

  assert.deepEqual(result, {
    schema: 'lattice.todo_chain.v1',
    maximum_dependency_depth: 2,
    longest_chain_node_refs: [A, B, C],
    longest_chain_edges: [edge(A, C), edge(B, C)],
    longest_chain_count: { count: 2, overflow: false },
    representative_chains: [[A, C], [B, C]],
    assumptions,
  });
});

test('複数最長鎖: diamondの4 edgeを和集合へ残す', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const D = ref('D');
  const result = projectTodoChainV1(topology(
    [D, C, B, A],
    [edge(C, D), edge(A, C), edge(B, D), edge(A, B)],
  ));

  assert.deepEqual(result, {
    schema: 'lattice.todo_chain.v1',
    maximum_dependency_depth: 3,
    longest_chain_node_refs: [A, B, C, D],
    longest_chain_edges: [edge(A, B), edge(A, C), edge(B, D), edge(C, D)],
    longest_chain_count: { count: 2, overflow: false },
    representative_chains: [[A, B, D], [A, C, D]],
    assumptions,
  });
});

test('空graph: 深さと本数は0でassumptionsは常在する', () => {
  assert.deepEqual(projectTodoChainV1(topology([])), {
    schema: 'lattice.todo_chain.v1',
    maximum_dependency_depth: 0,
    longest_chain_node_refs: [],
    longest_chain_edges: [],
    longest_chain_count: { count: 0, overflow: false },
    representative_chains: [],
    assumptions,
  });
});

test('merge後cycle: typed errorでfail closedする', () => {
  const first = ref('A', 'P', 'one');
  const second = ref('B', 'Q', 'two');

  assert.throws(
    () => projectTodoChainV1(topology(
      [first, second],
      [edge(first, second), edge(second, first)],
    )),
    (error) => (
      error instanceof TodoChainCycleError
      && error.name === 'TodoChainCycleError'
      && error.code === 'TODO_CHAIN_CYCLE'
      && error.cause?.code === 'DAG_CYCLE'
    ),
  );
});

test('完全二部999層: 飽和countと最大8代表を全鎖列挙せず数秒内に返す', {
  timeout: 10_000,
}, () => {
  const source = ref('0000-S');
  const sink = ref('1000-T');
  const layers = Array.from({ length: 999 }, (_, index) => {
    const prefix = String(index + 1).padStart(4, '0');
    return [ref(`${prefix}-a`), ref(`${prefix}-b`)];
  });
  const nodes = [sink, ...layers.flat().reverse(), source];
  const hardEdges = [edge(source, layers[0][0]), edge(source, layers[0][1])];
  for (let index = 0; index < layers.length - 1; index += 1) {
    for (const from of layers[index]) {
      for (const to of layers[index + 1]) hardEdges.push(edge(from, to));
    }
  }
  hardEdges.push(edge(layers.at(-1)[0], sink), edge(layers.at(-1)[1], sink));

  const startedAt = performance.now();
  const result = projectTodoChainV1(topology(nodes, hardEdges));
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(nodes.length, 2_000);
  assert.equal(hardEdges.length, 3_996);
  assert.equal(result.schema, 'lattice.todo_chain.v1');
  assert.equal(result.maximum_dependency_depth, 1_001);
  assert.deepEqual(result.longest_chain_count, { count: 1_000_000, overflow: true });
  assert.deepEqual(result.longest_chain_node_refs, [source, ...layers.flat(), sink]);
  assert.deepEqual(result.longest_chain_edges, hardEdges);
  assert.equal(result.representative_chains.length, 8);
  const expectedRepresentatives = Array.from({ length: 8 }, (_, choice) => [
    source,
    ...layers.map((layer, layerIndex) => {
      if (layerIndex < 996) return layer[0];
      const bit = 2 ** (998 - layerIndex);
      return layer[(choice & bit) === 0 ? 0 : 1];
    }),
    sink,
  ]);
  assert.deepEqual(
    result.representative_chains,
    expectedRepresentatives,
  );
  assert.deepEqual(result.assumptions, assumptions);
  assert.ok(elapsedMilliseconds < 5_000, `projection took ${elapsedMilliseconds}ms`);
});
