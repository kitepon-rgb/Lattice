import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TODO_BINDING_PROJECTION_SCHEMA,
  projectTodoBindings,
} from '../src/todo-status.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// ADR 0124。TODO工程storeとruntime実行を結ぶ唯一の公開読み取り面。
// hostが `compiled_plan_digest` から runtime_plan.v1 → executor_packet.v1 →
// executor_receipt.v1（packet_digest帰属）まで辿れることを、投影の側から保証する。

const BINDING = Object.freeze({
  boundary_manifest_digest: 'a'.repeat(64),
  compiled_plan_digest: 'b'.repeat(64),
  topology_digest: 'c'.repeat(64),
  base_sha: 'd'.repeat(40),
});

const task = (taskId, compileBinding = null) => ({
  task_id: taskId,
  title: taskId,
  lane: 'M0',
  narrative_ref: null,
  narrative_anchor: null,
  compile_binding: compileBinding,
  parent_task_id: null,
  phase_id: 'ph-1',
});

const readModel = (members) => ({
  schema: 'lattice.todo_store_read.v1',
  project_id: 'proj',
  members,
});

const member = (planKey, tasks) => ({
  plan: {
    project_id: 'proj',
    plan_key: planKey,
    plan_version: `rev-${planKey}`,
    tasks,
  },
});

test('binding未設定のTaskは投影されない', () => {
  const result = projectTodoBindings(readModel([member('alpha', [task('t-1'), task('t-2')])]));
  assert.equal(result.schema, TODO_BINDING_PROJECTION_SCHEMA);
  assert.deepEqual(result.bindings, []);
  assert.equal(result.plan_key, null);
});

test('binding付きTaskはTODO正本のidentityつきで投影される', () => {
  const result = projectTodoBindings(readModel([
    member('alpha', [task('t-1'), task('t-2', BINDING)]),
  ]));
  assert.equal(result.bindings.length, 1);
  assert.deepEqual(result.bindings[0], {
    project_id: 'proj',
    plan_key: 'alpha',
    plan_version: 'rev-alpha',
    task_id: 't-2',
    compile_binding: BINDING,
  });
});

test('投影はruntime側へ辿るためのdigestをそのまま渡す', () => {
  const [binding] = projectTodoBindings(readModel([
    member('alpha', [task('t-1', BINDING)]),
  ])).bindings;
  // compiled_plan_digest で runtime_plan.v1 を、base_sha で run request の base を照合する。
  assert.equal(binding.compile_binding.compiled_plan_digest, BINDING.compiled_plan_digest);
  assert.equal(binding.compile_binding.boundary_manifest_digest, BINDING.boundary_manifest_digest);
  assert.equal(binding.compile_binding.base_sha, BINDING.base_sha);
});

test('複数planはplan_key順で安定に並ぶ', () => {
  const result = projectTodoBindings(readModel([
    member('zulu', [task('z-1', BINDING)]),
    member('alpha', [task('a-1', BINDING)]),
  ]));
  assert.deepEqual(result.bindings.map((entry) => entry.plan_key), ['alpha', 'zulu']);
});

test('--plan指定は該当planだけへ絞る', () => {
  const result = projectTodoBindings(readModel([
    member('alpha', [task('a-1', BINDING)]),
    member('zulu', [task('z-1', BINDING)]),
  ]), { requestedPlanKey: 'zulu' });
  assert.equal(result.plan_key, 'zulu');
  assert.deepEqual(result.bindings.map((entry) => entry.task_id), ['z-1']);
});

test('存在しないplanはfail closedにする（空集合へ丸めない）', () => {
  assert.throws(
    () => projectTodoBindings(readModel([member('alpha', [task('a-1')])]), { requestedPlanKey: 'nope' }),
    (error) => error.detail.reason === 'todo_binding_plan_not_found',
  );
});

test('read modelが不正なら空集合でなく失敗する', () => {
  assert.throws(
    () => projectTodoBindings({ schema: 'wrong', project_id: 'proj', members: [] }),
    (error) => error.detail.reason === 'todo_status_read_model_invalid',
  );
});

test('result_digestは自己digest規則を満たす', () => {
  const result = projectTodoBindings(readModel([member('alpha', [task('a-1', BINDING)])]));
  assert.equal(result.result_digest, todoSelfDigest(result, 'result_digest'));
});
