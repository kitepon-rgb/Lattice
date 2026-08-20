import assert from 'node:assert/strict';
import test from 'node:test';

import { TodoStoreError } from '../src/todo-store.mjs';
import {
  DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE,
  DISPATCH_SHAPE_SERIALIZATION_THRESHOLD,
  computeTodoDispatchShape,
  computeTodoDispatchShapeForPlan,
  isTodoDispatchShapeSerializationExcessive,
} from '../src/todo-dispatch-shape.mjs';

function chainTaskIds(count) {
  return Array.from({ length: count }, (_, index) => `T${index + 1}`);
}

function chainEdges(taskIds) {
  return taskIds.slice(1).map((taskId, index) => ({ from: taskIds[index], to: taskId }));
}

function ref(taskId, planKey = 'main', projectId = 'project-1') {
  return { project_id: projectId, plan_key: planKey, task_id: taskId };
}

test('完全に一直線のchainはcritical_path_length===task_countでmax_frontier_width===1', () => {
  const taskIds = chainTaskIds(6);
  const shape = computeTodoDispatchShape({ taskIds, edges: chainEdges(taskIds) });
  assert.equal(shape.task_count, 6);
  assert.equal(shape.critical_path_length, 6);
  assert.equal(shape.max_frontier_width, 1);
  assert.equal(shape.serialization_ratio, '1.0000');
  assert.deepEqual(shape.critical_path_task_ids, taskIds);
});

test('依存が無い完全並列taskはcritical_path_length===1でmax_frontier_width===task_count', () => {
  const taskIds = chainTaskIds(6);
  const shape = computeTodoDispatchShape({ taskIds, edges: [] });
  assert.equal(shape.critical_path_length, 1);
  assert.equal(shape.max_frontier_width, 6);
  assert.equal(shape.serialization_ratio, '0.1667');
});

test('parent-child-repair相当（task 26・critical path 20）はratio>0.5で閾値を超える', () => {
  const taskIds = chainTaskIds(26);
  // 先頭20個を一直線で繋ぎ、残り6個は独立（並列可能）にしておく——
  // 実際のplanが「ほぼ一直線だが少し分岐がある」形を模す。
  const edges = chainEdges(taskIds.slice(0, 20));
  const shape = computeTodoDispatchShape({ taskIds, edges });
  assert.equal(shape.task_count, 26);
  assert.equal(shape.critical_path_length, 20);
  assert.equal(shape.max_frontier_width, 7); // 最初のwave（dist=0）= chain先頭T1 + 独立6個
  assert.equal(Number(shape.serialization_ratio) > DISPATCH_SHAPE_SERIALIZATION_THRESHOLD, true);
  assert.equal(isTodoDispatchShapeSerializationExcessive(shape), true);
});

test('diamond型分岐（A→B,A→C,B→D,C→D）はcritical_path_length 3・frontier width 2', () => {
  const shape = computeTodoDispatchShape({
    taskIds: ['A', 'B', 'C', 'D'],
    edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'D' }, { from: 'C', to: 'D' }],
  });
  assert.equal(shape.critical_path_length, 3);
  assert.equal(shape.max_frontier_width, 2);
  assert.deepEqual(shape.critical_path_task_ids, ['A', 'B', 'D']); // Bは辞書順でCより先
});

test('hard_dependenciesとjoin由来で同じ辺が重複しても一度しか数えない', () => {
  const shapeWithDuplicate = computeTodoDispatchShape({
    taskIds: ['A', 'B'],
    edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'B' }],
  });
  assert.equal(shapeWithDuplicate.critical_path_length, 2);
  assert.equal(shapeWithDuplicate.max_frontier_width, 1);
});

test('循環を含む入力はDISPATCH_SHAPE_INVALIDで止まりcritical_path計算を試みない', () => {
  assert.throws(() => computeTodoDispatchShape({
    taskIds: ['A', 'B', 'C'],
    edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
  }), (error) => error instanceof TodoStoreError
    && error.code === 'DISPATCH_SHAPE_INVALID'
    && error.detail.reason === 'dispatch_shape_dependency_cycle');
});

test('自己辺はDISPATCH_SHAPE_INVALIDで拒否する', () => {
  assert.throws(() => computeTodoDispatchShape({
    taskIds: ['A'], edges: [{ from: 'A', to: 'A' }],
  }), (error) => error instanceof TodoStoreError && error.detail.reason === 'dispatch_shape_self_edge');
});

test('task_id集合の外を指す辺は呼び出し側の誤りとしてDISPATCH_SHAPE_INVALIDで止める', () => {
  assert.throws(() => computeTodoDispatchShape({
    taskIds: ['A', 'B'], edges: [{ from: 'A', to: 'Z' }],
  }), (error) => error instanceof TodoStoreError && error.detail.reason === 'dispatch_shape_edge_out_of_scope');
});

test('computeTodoDispatchShapeForPlanはcross-plan／dangling参照を形状から除外する', () => {
  const shape = computeTodoDispatchShapeForPlan({
    projectId: 'project-1',
    planKey: 'main',
    taskIds: ['T1', 'T2'],
    hardDependencies: [
      { from: ref('T1'), to: ref('T2') },
      // 別planへの依存は「このplanの形状」には含めない（既存のstore書込み経路が別途検証する）。
      { from: ref('T2'), to: ref('X1', 'other-plan') },
    ],
    joins: [],
  });
  assert.equal(shape.task_count, 2);
  assert.equal(shape.critical_path_length, 2);
});

test('joinはafterの各taskからbeforeへの辺として形状へ展開される', () => {
  const shape = computeTodoDispatchShapeForPlan({
    projectId: 'project-1',
    planKey: 'main',
    taskIds: ['A', 'B', 'C'],
    hardDependencies: [],
    joins: [{ id: 'join-1', after: [ref('A'), ref('B')], before: ref('C') }],
  });
  assert.equal(shape.critical_path_length, 2);
  assert.equal(shape.max_frontier_width, 2);
});

test('最小task数未満の一直線はexcessiveと分類しない', () => {
  const taskIds = chainTaskIds(DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE - 1);
  const shape = computeTodoDispatchShape({ taskIds, edges: chainEdges(taskIds) });
  assert.equal(shape.serialization_ratio, '1.0000');
  assert.equal(isTodoDispatchShapeSerializationExcessive(shape), false);
});

test('閾値超の一直線shapeはexcessiveと分類する（拒否はしない）', () => {
  const taskIds = chainTaskIds(DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE);
  const shape = computeTodoDispatchShape({ taskIds, edges: chainEdges(taskIds) });
  assert.equal(isTodoDispatchShapeSerializationExcessive(shape), true);
  assert.equal(shape.task_count, DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE);
  assert.equal(shape.critical_path_length, DISPATCH_SHAPE_MIN_TASK_COUNT_FOR_GATE);
  assert.equal(shape.serialization_ratio, '1.0000');
});
