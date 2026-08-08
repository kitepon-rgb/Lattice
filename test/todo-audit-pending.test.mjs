import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_PENDING_PHASE_STATUSES, auditPendingNextCommands, isAuditPendingPhaseStatus,
} from '../src/todo-audit-pending.mjs';

test('監査待ちはgate_ready・reviewing・rejectedの3状態だけ', () => {
  assert.deepEqual([...AUDIT_PENDING_PHASE_STATUSES].sort(),
    ['gate_ready', 'rejected', 'reviewing']);
});

test('判断が着いた終端状態と未到達の状態は監査待ちではない', () => {
  for (const status of ['gate_ready', 'reviewing', 'rejected']) {
    assert.equal(isAuditPendingPhaseStatus(status), true, status);
  }
  // ADR 0148裁定4: closed_unauditedはacceptedと同じく判断の着いた終端状態。
  for (const status of ['accepted', 'closed_unaudited', 'active', 'locked']) {
    assert.equal(isAuditPendingPhaseStatus(status), false, status);
  }
});

test('状態を持たない入力は監査待ちに数えない', () => {
  assert.equal(isAuditPendingPhaseStatus(null), false);
  assert.equal(isAuditPendingPhaseStatus(undefined), false);
});

test('次コマンドはstoreの遷移guardが受理するものだけを案内する', () => {
  assert.deepEqual(auditPendingNextCommands('p', 'terminal-audit', 'gate_ready'), [
    'lattice todo phase review --plan p --phase terminal-audit --reason <text>',
    'lattice todo phase close-unaudited --plan p --phase terminal-audit --reason <text>',
  ]);
  assert.deepEqual(auditPendingNextCommands('p', 'terminal-audit', 'reviewing'), [
    'lattice todo phase accept --plan p --phase terminal-audit --input <file>',
    'lattice todo phase reject --plan p --phase terminal-audit --input <file>',
  ]);
  assert.deepEqual(auditPendingNextCommands('p', 'terminal-audit', 'rejected'), [
    'lattice todo phase reopen --plan p --phase terminal-audit --reason <text>',
  ]);
});

test('監査待ちでない状態は空配列へ丸めず投げる', () => {
  assert.throws(() => auditPendingNextCommands('p', 'terminal-audit', 'accepted'),
    (error) => error.code === 'AUDIT_PENDING_STATUS_INVALID');
});
