import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TODO_GANTT_INDEPENDENCE_PRESENTATION,
  renderTodoGanttSvg,
} from '../src/todo-gantt-svg.mjs';
import { TodoGanttLayoutError, layoutTodoGantt } from '../src/todo-gantt-layout.mjs';

// ADR 0129。独立性はカード内のバッジと色で示し、寸法と配線には触れない。
// 記録が語らないtaskへはバッジを出さない（未検査と検証済みを同じ顔にしない）。

const PROJECT = 'project-1';
const PLAN = 'main';

const ref = (taskId) => ({ project_id: PROJECT, plan_key: PLAN, task_id: taskId });

const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null,
  narrative_anchor: null, compile_binding: null, parent_task_id: null,
});

function readModel(taskIds) {
  return {
    schema: 'lattice.todo_store_read.v1',
    project_id: PROJECT,
    members: [{
      descriptor: { plan_key: PLAN },
      plan: {
        schema: 'lattice.todo_plan.v3',
        project_id: PROJECT,
        plan_key: PLAN,
        plan_version: 'v1',
        tasks: taskIds.map(task),
        hard_dependencies: [],
        joins: [],
      },
      tasks: taskIds.map((taskId) => ({ task_id: taskId, status: 'pending' })),
      snapshot: { phases: [] },
      journal: { events: [] },
    }],
  };
}

const chain = { schema: 'lattice.todo_chain.v1', longest_chain_node_refs: [], longest_chain_edges: [] };

const projectionFor = (frontier) => [{
  project_id: PROJECT, plan_key: PLAN, coverage: 'verified', frontier,
}];

function layoutWith(taskIds, frontier) {
  return layoutTodoGantt(readModel(taskIds), chain, {
    scope: 'all', independence: projectionFor(frontier),
  });
}

test('独立性はnode projectionへ状態として載る', () => {
  const layout = layoutWith(['A', 'B', 'C', 'D'], {
    parallel_groups: [{ task_ids: ['A', 'B'] }],
    serialize_pairs: [{
      task_ids: ['C', 'D'], type: 'conflict', detail: 'own-path-1',
      kind: 'path', severability: 'code_seam',
    }],
    conflicts_with_active: [],
    unknown: [],
  });

  const stateOf = (taskId) => layout.nodes
    .find((node) => node.ref.task_id === taskId).visibility.independence;
  assert.equal(stateOf('A'), 'verified');
  assert.equal(stateOf('B'), 'verified');
  assert.equal(stateOf('C'), 'conflict');
  assert.equal(stateOf('D'), 'conflict');
  assert.equal(layout.schema, 'lattice.todo_gantt_layout.v2');
});

test('記録が語らないtaskはnullのまま残る', () => {
  const layout = layoutWith(['A', 'B'], {
    parallel_groups: [{ task_ids: ['A'] }],
    serialize_pairs: [],
    conflicts_with_active: [],
    unknown: [],
  });
  assert.equal(layout.nodes.find((node) => node.ref.task_id === 'B').visibility.independence, null);
});

test('独立性の記録が無いplanはnull summaryのまま描ける', () => {
  const layout = layoutTodoGantt(readModel(['A']), chain, { scope: 'all' });
  assert.equal(layout.independence, null);
  assert.equal(layout.nodes[0].visibility.independence, null);
});

test('図に無いtaskを指す投影はtyped errorで露見させる', () => {
  assert.throws(() => layoutWith(['A'], {
    parallel_groups: [{ task_ids: ['A', 'ghost'] }],
    serialize_pairs: [],
    conflicts_with_active: [],
    unknown: [],
  }), (error) => error instanceof TodoGanttLayoutError
    && error.code === 'TODO_LAYOUT_INDEPENDENCE_DRIFT'
    && error.detail.task_id === 'ghost');
});

test('進行中との競合もconflictとしてカードへ出る', () => {
  const layout = layoutWith(['A', 'B'], {
    parallel_groups: [],
    serialize_pairs: [],
    conflicts_with_active: [{
      ready_task_id: 'A', active_task_id: 'B', type: 'conflict',
      detail: 'own-path-1', kind: 'path', severability: 'code_seam',
    }],
    unknown: [{ task_id: 'B', unknowns: [{ kind: 'witness_missing', ref: 'x' }] }],
  });
  assert.equal(layout.nodes.find((node) => node.ref.task_id === 'A').visibility.independence,
    'conflict');
  assert.equal(layout.nodes.find((node) => node.ref.task_id === 'B').visibility.independence,
    'unknown');
});

test('SVGはバッジ記号とクラスを描き、カード寸法を変えない', () => {
  const plain = layoutTodoGantt(readModel(['A', 'B']), chain, { scope: 'all' });
  const marked = layoutWith(['A', 'B'], {
    parallel_groups: [{ task_ids: ['A'] }],
    serialize_pairs: [],
    conflicts_with_active: [],
    unknown: [{ task_id: 'B', unknowns: [{ kind: 'witness_missing', ref: 'x' }] }],
  });

  // 寸法が同じであることがADR 0068の配線規約へ影響しない根拠になる。
  assert.deepEqual(marked.nodes.map(({ geometry }) => geometry),
    plain.nodes.map(({ geometry }) => geometry));
  assert.deepEqual(marked.bounds, plain.bounds);

  const svg = renderTodoGanttSvg(marked, { lanes: new Map(), taskNumbers: new Map() });
  assert.match(svg, /class="independence-badge"/u);
  assert.ok(svg.includes(TODO_GANTT_INDEPENDENCE_PRESENTATION.verified.label));
  assert.ok(svg.includes(TODO_GANTT_INDEPENDENCE_PRESENTATION.unknown.label));
  assert.match(svg, /independence-verified/u);
  assert.match(svg, /independence-unknown/u);
  // 記録の無い図にはバッジを出さない。
  const plainSvg = renderTodoGanttSvg(plain, { lanes: new Map(), taskNumbers: new Map() });
  assert.equal(plainSvg.includes('independence-badge'), false);
});
