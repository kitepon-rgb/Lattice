import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  createRunWorkOrder,
  validateRunWorkOrder,
  validateRunWorkReport,
} from '../src/runtime-work-order-contracts.mjs';

function packet() {
  const value = {
    schema: 'lattice.executor_packet.v1',
    packet_id: 'packet-a',
    todo_id: 'T1',
    task_ref: 'task-a',
    scope: { writes: ['src/a.mjs'] },
    base_sha: 'a'.repeat(40),
    plan_ref: 'plan-a',
    plan_epoch: 1,
    verifier_refs: ['node --test test/a.test.mjs'],
    forbidden_operations: ['push', 'branch', 'merge', 'rebase', 'reset', 'stash'],
    context_content_digest: '',
    packet_digest: '',
  };
  value.context_content_digest = selfDigest({
    todo_id: value.todo_id,
    task_ref: value.task_ref,
    scope: value.scope,
    base_sha: value.base_sha,
    verifier_refs: value.verifier_refs,
    forbidden_operations: value.forbidden_operations,
  }, 'not_present');
  value.packet_digest = selfDigest(value, 'packet_digest');
  return value;
}

test('work orderはexecutor packetの作業面を逐語投影して自己digestへ束縛する', () => {
  const source = packet();
  const worktreePath = path.resolve('/tmp/lattice-work-order-tree');
  const order = createRunWorkOrder({ packet: source, worktreePath });
  assert.equal(validateRunWorkOrder(order), true);
  assert.equal(order.worktree_path, worktreePath);
  assert.deepEqual(order.scope_writes, source.scope.writes);
  assert.deepEqual(order.verifier_refs, source.verifier_refs);
  assert.deepEqual(order.forbidden_operations, source.forbidden_operations);
  assert.equal(order.packet_digest, source.packet_digest);
});

test('work orderは余分なkey・repo外表現・digest差替えをrejectする', () => {
  const order = createRunWorkOrder({ packet: packet(), worktreePath: '/tmp/tree' });
  assert.equal(validateRunWorkOrder({ ...order, extra: true }), false);
  assert.equal(validateRunWorkOrder({ ...order, worktree_path: 'relative/tree' }), false);
  assert.equal(validateRunWorkOrder({ ...order, scope_writes: ['../escape'] }), false);
  assert.equal(validateRunWorkOrder({ ...order, todo_id: 'T2' }), false);
});

test('work reportはbridgeが書く4キーとworking／doneだけを受ける', () => {
  const report = {
    schema: 'lattice.run_work_report.v1',
    packet_digest: 'b'.repeat(64),
    state: 'working',
    worker_pid: process.pid,
  };
  assert.equal(validateRunWorkReport(report), true);
  assert.equal(validateRunWorkReport({ ...report, state: 'done' }), true);
  assert.equal(validateRunWorkReport({ ...report, state: 'failed' }), false);
  assert.equal(validateRunWorkReport({ ...report, report_digest: 'c'.repeat(64) }), false);
});
