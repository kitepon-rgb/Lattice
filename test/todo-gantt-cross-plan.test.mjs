import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';

const ref = (planKey, taskId) => ({ project_id: 'project', plan_key: planKey, task_id: taskId });
const task = (taskId, parentTaskId = null) => ({
  task_id: taskId, title: taskId, lane: 'main',
  ...(parentTaskId === null ? {} : { parent_task_id: parentTaskId }),
});

function member(planKey, tasks, states, events = []) {
  return {
    plan: {
      schema: 'lattice.todo_plan.v3', project_id: 'project', plan_key: planKey,
      tasks, hard_dependencies: [], joins: [],
    },
    tasks: tasks.map(({ task_id: taskId }) => ({
      task_id: taskId, status: states[taskId], blocked_reason: null,
    })),
    plan_scoped: { events },
  };
}

function dependencyEvent(from, to) {
  return {
    kind: 'cross_plan_dependency', actor: { host: 'h', session: 's', agent: 'a' },
    recorded_at: '2026-08-09T00:00:00.000Z', event_digest: 'a'.repeat(64),
    payload: { from, to, reason: 'consumer input', },
  };
}

function readModel({ nested = false, producerStatus = 'in-progress' } = {}) {
  const producerTasks = nested ? [task('PARENT'), task('P', 'PARENT')] : [task('P')];
  const consumerTasks = nested ? [task('CONTAINER'), task('C', 'CONTAINER')] : [task('C')];
  const from = ref('producer', 'P');
  const to = ref('consumer', 'C');
  return {
    schema: 'lattice.todo_store_read.v1', project_id: 'project',
    members: [
      member('producer', producerTasks,
        Object.fromEntries(producerTasks.map(({ task_id: id }) => [id, id === 'P' ? producerStatus : 'pending']))),
      member('consumer', consumerTasks,
        Object.fromEntries(consumerTasks.map(({ task_id: id }) => [id, 'pending'])),
        [dependencyEvent(from, to)]),
    ],
  };
}

function chainOf(read) {
  const dependencies = read.members.flatMap(({ plan_scoped: scoped }) => scoped.events
    .filter(({ kind }) => kind === 'cross_plan_dependency')
    .map(({ payload: { from, to } }) => ({ from, to })));
  return projectTodoChainV1({
    nodes: read.members.flatMap(({ plan }) => plan.tasks
      .map(({ task_id: taskId }) => ref(plan.plan_key, taskId))),
    hard_edges: dependencies,
    joins: [],
  });
}

test('plan跨ぎedgeはexact identityで描かれ、入力待ちconsumerをreadyにしない', () => {
  const read = readModel();
  const layout = layoutTodoGantt(read, { scope: 'all' });
  assert.deepEqual(layout.edges.map(({ from, to, kinds }) => ({ from, to, kinds })), [{
    from: ref('producer', 'P'), to: ref('consumer', 'C'), kinds: ['cross_plan'],
  }]);
  assert.equal(layout.nodes.find(({ ref: node }) => node.plan_key === 'producer').wave, 0);
  const consumer = layout.nodes.find(({ ref: node }) => node.plan_key === 'consumer');
  assert.equal(consumer.wave, 1);
  assert.equal(consumer.visibility.next_ready, false);
  assert.equal(layout.metrics.edge_count, 1);
});

test('producer完了後は同じedgeを保ったままconsumerがreadyになる', () => {
  const read = readModel({ producerStatus: 'done' });
  const layout = layoutTodoGantt(read, { scope: 'live' });
  assert.equal(layout.edges.length, 1);
  assert.equal(layout.nodes.find(({ ref: node }) => node.plan_key === 'consumer')
    .visibility.next_ready, true);
});

test('nested lineageでは子task間edgeをroot container間へexactに射影する', () => {
  const read = readModel({ nested: true });
  const layout = layoutTodoGantt(read, { scope: 'all' });
  assert.deepEqual(layout.edges.map(({ from, to, kinds }) => ({ from, to, kinds })), [{
    from: ref('producer', 'PARENT'), to: ref('consumer', 'CONTAINER'), kinds: ['cross_plan'],
  }]);
  assert.equal(layout.hierarchy.maximum_depth, 2);
});
