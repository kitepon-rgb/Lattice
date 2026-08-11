import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { analyzeDagChains, analyzeDagReachability } from '../src/dag-chain.mjs';
import {
  projectTodoChainV1,
  projectTodoTopologyDagV1,
  TodoChainCycleError,
} from '../src/todo-chain.mjs';

const assumptions = {
  unit_duration: true,
  capacity_ignored: true,
  conflict_ignored: true,
};

const defaultLimits = {
  count_cap: 1_000_000,
  representative_limit: 8,
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
    limits: defaultLimits,
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
    limits: defaultLimits,
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
    limits: defaultLimits,
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
    limits: defaultLimits,
    representative_chains: [],
    assumptions,
  });
});

test('要求pairの推移到達性を既存DAG normalizeとcycle判定の上で返す', () => {
  assert.deepEqual(analyzeDagReachability(
    ['A', 'B', 'C', 'D'], [['A', 'B'], ['B', 'C']],
    [['A', 'C'], ['A', 'D'], ['B', 'C']],
  ), [true, false, true]);
  assert.throws(
    () => analyzeDagReachability(['A', 'B'], [['A', 'B'], ['B', 'A']], [['A', 'B']]),
    (error) => error.code === 'DAG_CYCLE',
  );
});

test('structure消費側へhard edgeとjoinを同じ正本からlossless投影する', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const projected = projectTodoTopologyDagV1(topology(
    [A, B, C], [edge(A, B)], [{ id: 'join', after: [B], before: C }],
  ));
  const key = (taskId) => JSON.stringify(['project', 'plan', taskId]);
  assert.deepEqual(projected, {
    nodes: [
      { key: key('A'), ref: A }, { key: key('B'), ref: B }, { key: key('C'), ref: C },
    ],
    edges: [{ from: key('A'), to: key('B') }, { from: key('B'), to: key('C') }],
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
  assert.deepEqual(result.limits, defaultLimits);
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

test('確定wire: top-levelとnested objectがexact key順を持つ', () => {
  const A = ref('A');
  const B = ref('B');
  const result = projectTodoChainV1(topology([A, B], [edge(A, B)]), {
    countCap: 7,
    representativeLimit: 1,
  });

  assert.deepEqual(Object.keys(result), [
    'schema',
    'maximum_dependency_depth',
    'longest_chain_node_refs',
    'longest_chain_edges',
    'longest_chain_count',
    'limits',
    'representative_chains',
    'assumptions',
  ]);
  assert.deepEqual(Object.keys(result.longest_chain_node_refs[0]), [
    'project_id', 'plan_key', 'task_id',
  ]);
  assert.deepEqual(Object.keys(result.longest_chain_edges[0]), ['from', 'to']);
  assert.deepEqual(Object.keys(result.longest_chain_count), ['count', 'overflow']);
  assert.deepEqual(Object.keys(result.limits), ['count_cap', 'representative_limit']);
  assert.deepEqual(Object.keys(result.assumptions), [
    'unit_duration', 'capacity_ignored', 'conflict_ignored',
  ]);
  assert.deepEqual(result.limits, { count_cap: 7, representative_limit: 1 });
});

test('options: unknown key、範囲外、非整数、非objectをfail closedする', () => {
  const graph = topology([]);
  const symbolOption = { [Symbol('unknown')]: true };
  const invalidOptions = [
    { unknown: true },
    symbolOption,
    { countCap: 0 },
    { countCap: Number.MAX_SAFE_INTEGER },
    { countCap: 1.5 },
    { countCap: null },
    { representativeLimit: -1 },
    { representativeLimit: 9 },
    { representativeLimit: 1.5 },
    { representativeLimit: null },
    null,
    [],
  ];

  for (const options of invalidOptions) {
    assert.throws(
      () => projectTodoChainV1(graph, options),
      (error) => error?.code === 'TODO_CHAIN_INVALID_OPTIONS',
    );
  }
  assert.deepEqual(
    projectTodoChainV1(topology([ref('A')]), {
      countCap: 1,
      representativeLimit: 0,
    }).representative_chains,
    [],
  );
  assert.deepEqual(
    projectTodoChainV1(graph, {
      countCap: Number.MAX_SAFE_INTEGER - 1,
      representativeLimit: 8,
    }).limits,
    {
      count_cap: Number.MAX_SAFE_INTEGER - 1,
      representative_limit: 8,
    },
  );
  assert.deepEqual(
    projectTodoChainV1(graph, { countCap: 1, representativeLimit: 0 }).limits,
    { count_cap: 1, representative_limit: 0 },
  );
});

test('shortcut付きDAG: 最長鎖を短絡するedgeを和集合から除外する', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const result = projectTodoChainV1(topology(
    [C, B, A],
    [edge(A, C), edge(B, C), edge(A, B)],
  ));

  assert.equal(result.maximum_dependency_depth, 3);
  assert.deepEqual(result.longest_chain_node_refs, [A, B, C]);
  assert.deepEqual(result.longest_chain_edges, [edge(A, B), edge(B, C)]);
  assert.deepEqual(result.longest_chain_count, { count: 1, overflow: false });
  assert.deepEqual(result.representative_chains, [[A, B, C]]);
});

test('飽和境界: 真の本数がcapちょうどなら非overflow、cap+1ならoverflow', () => {
  const A = ref('A');
  const leaves = [ref('B'), ref('C'), ref('D')];
  const graph = topology([A, ...leaves], leaves.map((leaf) => edge(A, leaf)));

  const exact = projectTodoChainV1(graph, { countCap: 3 });
  assert.deepEqual(exact.longest_chain_count, { count: 3, overflow: false });
  assert.deepEqual(exact.limits, { count_cap: 3, representative_limit: 8 });

  const overflow = projectTodoChainV1(graph, { countCap: 2 });
  assert.deepEqual(overflow.longest_chain_count, { count: 2, overflow: true });
  assert.deepEqual(overflow.limits, { count_cap: 2, representative_limit: 8 });
});

test('9本以上の分岐: tuple順の先頭8本だけをDFS発見順で返す', () => {
  const source = ref('S');
  const leaves = Array.from({ length: 10 }, (_, index) => ref(`T${String(index).padStart(2, '0')}`));
  const result = projectTodoChainV1(
    topology([source, ...leaves].reverse(), leaves.map((leaf) => edge(source, leaf)).reverse()),
  );

  assert.deepEqual(result.longest_chain_count, { count: 10, overflow: false });
  assert.deepEqual(
    result.representative_chains,
    leaves.slice(0, 8).map((leaf) => [source, leaf]),
  );
});

test('UTF-16 code unit順を使いlocaleやUnicode normalizationを介在させない', () => {
  const source = ref('S');
  const emoji = ref('\u{1F600}');
  const privateUse = ref('\uE000');
  const composed = ref('\u00E9');
  const decomposed = ref('e\u0301');
  const result = projectTodoChainV1(topology(
    [privateUse, composed, source, decomposed, emoji],
    [privateUse, composed, decomposed, emoji].map((leaf) => edge(source, leaf)),
  ));

  assert.deepEqual(result.longest_chain_node_refs, [source, decomposed, composed, emoji, privateUse]);
  assert.deepEqual(result.representative_chains, [
    [source, decomposed],
    [source, composed],
    [source, emoji],
    [source, privateUse],
  ]);
});

test('node/edge/join入力permutation間でcanonical bytesが一致する', () => {
  const A = ref('A');
  const B = ref('B');
  const C = ref('C');
  const D = ref('D');
  const first = topology(
    [A, B, C, D],
    [edge(A, B), edge(A, C)],
    [
      { id: 'J1', after: [B, C], before: D },
      { id: 'J2', after: [A], before: C },
    ],
  );
  const second = topology(
    [D, C, B, A],
    [edge(A, C), edge(A, B)],
    [
      { id: 'J2', after: [A], before: C },
      { id: 'J1', after: [C, B], before: D },
    ],
  );

  const firstBytes = Buffer.from(JSON.stringify(projectTodoChainV1(first)));
  const secondBytes = Buffer.from(JSON.stringify(projectTodoChainV1(second)));
  assert.deepEqual(firstBytes, secondBytes);
});

test('汎用DAG層を1,024種の全列挙結果と照合する', () => {
  for (let mask = 0; mask < 1_024; mask += 1) {
    const nodes = [0, 1, 2, 3, 4];
    const possibleEdges = [];
    for (let from = 0; from < nodes.length; from += 1) {
      for (let to = from + 1; to < nodes.length; to += 1) possibleEdges.push([from, to]);
    }
    const edges = possibleEdges.filter((unused, index) => (mask & (1 << index)) !== 0);
    const successors = new Map(nodes.map((node) => [node, []]));
    const indegree = new Map(nodes.map((node) => [node, 0]));
    for (const [from, to] of edges) {
      successors.get(from).push(to);
      indegree.set(to, indegree.get(to) + 1);
    }

    const paths = [];
    const enumerate = (node, path) => {
      if (successors.get(node).length === 0) paths.push([...path, node]);
      else for (const successor of successors.get(node)) enumerate(successor, [...path, node]);
    };
    for (const node of nodes) {
      if (indegree.get(node) === 0) enumerate(node, []);
    }

    const maximumDepth = Math.max(...paths.map((path) => path.length));
    const longest = paths.filter((path) => path.length === maximumDepth);
    const expectedNodes = [...new Set(longest.flat())].sort((left, right) => left - right);
    const expectedEdges = edges.filter(([from, to]) => longest.some((path) => (
      path.some((node, index) => node === from && path[index + 1] === to)
    )));
    const actual = analyzeDagChains(nodes, edges, {
      compare: (left, right) => left - right,
      representativeLimit: 8,
    });

    assert.equal(actual.maximumDepth, maximumDepth, `depth mask=${mask}`);
    assert.deepEqual(actual.longestChainNodes, expectedNodes, `nodes mask=${mask}`);
    assert.deepEqual(actual.longestChainEdges, expectedEdges, `edges mask=${mask}`);
    assert.deepEqual(actual.longestChainCount, {
      count: longest.length,
      overflow: false,
    }, `count mask=${mask}`);
    assert.deepEqual(actual.representativeChains, longest.slice(0, 8), `chains mask=${mask}`);
  }
});
