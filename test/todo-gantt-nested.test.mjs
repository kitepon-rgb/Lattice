import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt, TodoGanttLayoutError } from '../src/todo-gantt-layout.mjs';
import { renderTodoGanttHtml } from '../src/todo-gantt-html.mjs';
import { renderTodoGanttSvg } from '../src/todo-gantt-svg.mjs';

const ref = (taskId) => ({ project_id: 'p', plan_key: 'plan', task_id: taskId });
const edge = (from, to) => ({ from: ref(from), to: ref(to) });

function fixture(tasks, hardDependencies = []) {
  const normalized = tasks.map((task) => ({
    title: task.task_id,
    lane: 'core',
    parent_task_id: null,
    ...task,
  }));
  const read = {
    schema: 'lattice.todo_store_read.v1',
    project_id: 'p',
    members: [{
      plan: {
        schema: 'lattice.todo_plan.v6',
        project_id: 'p',
        plan_key: 'plan',
        tasks: normalized,
        hard_dependencies: hardDependencies,
        joins: [],
      },
      tasks: normalized.map(({ task_id: taskId }, index) => ({
        task_id: taskId,
        status: index === 0 ? 'done' : 'pending',
        started_at: null,
        done_at: null,
        blocked_reason: null,
        evidence: null,
        evidence_unverified: false,
      })),
    }],
  };
  const chain = projectTodoChainV1({
    nodes: normalized.map(({ task_id: taskId }) => ref(taskId)),
    hard_edges: hardDependencies,
    joins: [],
  });
  return { read, chain };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('parent_task_id projects descendant dependencies into recursive child DAGs', () => {
  const input = fixture([
    { task_id: 'P' },
    { task_id: 'C1', parent_task_id: 'P' },
    { task_id: 'G', parent_task_id: 'C1' },
    { task_id: 'C2', parent_task_id: 'P' },
    { task_id: 'Q' },
  ], [edge('G', 'C2'), edge('C2', 'Q')]);

  const layout = layoutTodoGantt(input.read, input.chain, { scope: 'all' });
  assert.deepEqual(layout.nodes.map(({ ref: nodeRef }) => nodeRef.task_id), ['P', 'Q']);
  assert.equal(layout.hierarchy.schema, 'lattice.todo_gantt_hierarchy.v1');
  assert.equal(layout.hierarchy.maximum_depth, 3);
  assert.equal(layout.hierarchy.task_count, 5);
  assert.equal(layout.metrics.task_count, 5);
  const semantic = new Map([...layout.nodes, ...layout.hierarchy_nodes]
    .map((node) => [node.ref.task_id, node.visibility.next_ready]));
  assert.deepEqual(Object.fromEntries(semantic), {
    P: false, Q: false, C1: true, C2: false, G: true,
  });
  assert.deepEqual(layout.full_edges.map(({ from, to }) => [from.task_id, to.task_id]), [
    ['C2', 'Q'], ['G', 'C2'],
  ]);

  const parent = layout.hierarchy.children.find(({ parent_ref: parentRef }) => parentRef.task_id === 'P');
  assert.deepEqual(parent.level.layout.nodes.map(({ ref: nodeRef }) => nodeRef.task_id), ['C1', 'C2']);
  assert.deepEqual(parent.level.layout.edges.map(({ from, to }) => [from.task_id, to.task_id]), [
    ['C1', 'C2'],
  ]);
  const child = parent.level.children.find(({ parent_ref: parentRef }) => parentRef.task_id === 'C1');
  assert.deepEqual(child.level.layout.nodes.map(({ ref: nodeRef }) => nodeRef.task_id), ['G']);
});

test('missing and cyclic parent_task_id fail closed', () => {
  const missing = fixture([{ task_id: 'P', parent_task_id: 'absent' }]);
  assert.throws(() => layoutTodoGantt(missing.read, missing.chain), (error) =>
    error instanceof TodoGanttLayoutError && error.code === 'TODO_LAYOUT_INVALID_HIERARCHY');

  const cyclic = fixture([
    { task_id: 'A', parent_task_id: 'B' },
    { task_id: 'B', parent_task_id: 'A' },
  ]);
  assert.throws(() => layoutTodoGantt(cyclic.read, cyclic.chain), (error) =>
    error instanceof TodoGanttLayoutError && error.code === 'TODO_LAYOUT_INVALID_HIERARCHY');
});

test('phase accept dependencies follow a descendant to its enclosing parent box', () => {
  const input = fixture([
    { task_id: 'P' },
    { task_id: 'C', parent_task_id: 'P' },
  ]);
  const member = input.read.members[0];
  member.plan.schema = 'lattice.todo_plan.v7';
  member.plan.phase_accept_dependencies = [{
    from: { project_id: 'p', plan_key: 'plan', phase_id: 'review' },
    to: ref('C'),
  }];
  member.phases = [{ phase_id: 'review', status: 'reviewing' }];

  const layout = layoutTodoGantt(input.read, input.chain, { scope: 'all' });
  assert.equal(layout.nodes.find(({ ref: nodeRef }) => nodeRef.task_id === 'P')
    .visibility.next_ready, false);
  const parent = layout.hierarchy.children[0];
  assert.equal(parent.level.layout.nodes[0].visibility.next_ready, false);
});

test('live scope retains a folded parent as the container of a visible child DAG', () => {
  const input = fixture([
    { task_id: 'P' },
    { task_id: 'C', parent_task_id: 'P' },
  ]);
  const layout = layoutTodoGantt(input.read, input.chain);
  assert.deepEqual(layout.nodes.map(({ ref: nodeRef }) => nodeRef.task_id), ['P']);
  assert.deepEqual(layout.hierarchy_nodes.map(({ ref: nodeRef }) => nodeRef.task_id), ['C']);
  assert.match(renderTodoGanttSvg(layout), /data-nested-toggle-for=/u);
});

test('live scope does not render an empty panel for a visible parent with only folded children', () => {
  const input = fixture([
    { task_id: 'P' },
    { task_id: 'C', parent_task_id: 'P' },
  ]);
  input.read.members[0].tasks[0].status = 'in-progress';
  input.read.members[0].tasks[1].status = 'done';
  const layout = layoutTodoGantt(input.read, input.chain);
  const svg = renderTodoGanttSvg(layout);
  assert.deepEqual(layout.nodes.map(({ ref: nodeRef }) => nodeRef.task_id), ['P']);
  assert.deepEqual(layout.hierarchy_nodes, []);
  assert.doesNotMatch(svg, /data-nested-toggle-for=/u);
  assert.doesNotMatch(svg, /data-nested-panel-for=/u);
});

test('parentless layout and SVG remain byte-identical to the pre-hierarchy renderer', () => {
  const input = fixture([
    { task_id: 'A', title: 'Alpha' },
    { task_id: 'B', title: 'Beta' },
  ], [edge('A', 'B')]);
  const layout = layoutTodoGantt(input.read, input.chain);
  assert.equal(layout.hierarchy, undefined);
  assert.equal(digest(JSON.stringify(layout)), '1441709bdec782246de2bdc9ddaca92d7c459578f6d9567bb0f1b7df1e3c6dc3');
  const svg = renderTodoGanttSvg(layout);
  assert.match(svg, /工程 A<\/text>/u);
  assert.equal(digest(svg), 'e4dbf2e3865a7e3af7bb5aaa33adcf3825109333cd3c2174b64863b3156f4859');
});

test('hierarchical SVG and HTML expose recursive panels without network dependencies', () => {
  const input = fixture([
    { task_id: 'P' },
    { task_id: 'C', parent_task_id: 'P' },
    { task_id: 'G', parent_task_id: 'C' },
  ]);
  const layout = layoutTodoGantt(input.read, input.chain, { scope: 'all' });
  const svg = renderTodoGanttSvg(layout);
  assert.match(svg, /data-nested-toggle-for=/u);
  assert.match(svg, /data-nested-panel-for=/u);
  assert.equal((svg.match(/class="nested-task-panel"/gu) ?? []).length, 2);
  const firstPanelX = Number(svg.match(/class="nested-task-surface" x="([0-9.]+)"/u)?.[1]);
  assert.ok(firstPanelX > layout.bounds.width, 'expanded child DAG must not cover the base DAG');

  const html = renderTodoGanttHtml({ readModel: input.read, layout }).html;
  assert.match(html, /data-nested-toggle-for=/u);
  assert.match(html, /nested-task-panel/u);
  assert.match(html, /<strong>同時dispatch推奨:<\/strong> 2工程/u);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
});
