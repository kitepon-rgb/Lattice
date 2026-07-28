import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NON_CONVERGENT_EPOCH_THRESHOLD,
  countConflictRecurrence,
  detectNonConvergentConflicts,
} from '../src/runtime-hold-recompile.mjs';

// 請求項10は対象作業群だけを停止して再計画すると述べるが、その再計画が収束する保証は述べていない。
// 原因が続く限り「hold→再計画→再開→また同じ競合」が繰り返せる。安全性ではなく進行性の問題で、
// 誤って並列化することはないが、進まないまま同じ処置を試み続ける。

const conflictEvent = (planEpoch, path, todoIds, kind = 'observed_write_conflict') => ({
  kind: 'conflict_found', plan_epoch: planEpoch, payload: { kind, path, todo_ids: todoIds },
});

test('同一epoch内の複数回観測を繰り返しと数えない', () => {
  const events = [
    conflictEvent(1, 'src/a.mjs', ['T1', 'T2']),
    conflictEvent(1, 'src/a.mjs', ['T1', 'T2']),
    conflictEvent(1, 'src/a.mjs', ['T1', 'T2']),
  ];
  // 再計画を1回も挟んでいない。繰り返しとは、挟んだ上で再び現れたことである。
  assert.deepEqual(detectNonConvergentConflicts({ events }), []);
  assert.equal([...countConflictRecurrence(events).values()][0].size, 1);
});

test('task対の順序が違っても同じ競合として数える', () => {
  const events = [
    conflictEvent(1, 'src/a.mjs', ['T1', 'T2']),
    conflictEvent(2, 'src/a.mjs', ['T2', 'T1']),
    conflictEvent(3, 'src/a.mjs', ['T1', 'T2']),
  ];
  const found = detectNonConvergentConflicts({ events });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].todo_ids, ['T1', 'T2']);
  assert.deepEqual(found[0].epochs, [1, 2, 3]);
});

test('別の資源・別のtask対・別の種別は別の競合として数える', () => {
  const events = [
    conflictEvent(1, 'src/a.mjs', ['T1', 'T2']),
    conflictEvent(2, 'src/b.mjs', ['T1', 'T2']),
    conflictEvent(3, 'src/a.mjs', ['T1', 'T3']),
    conflictEvent(4, 'src/a.mjs', ['T1', 'T2'], 'undeclared_write'),
  ];
  assert.deepEqual(detectNonConvergentConflicts({ events }), []);
});

test('閾値に達するまでは非収束と言わない', () => {
  const events = [
    conflictEvent(1, 'src/a.mjs', ['T1', 'T2']),
    conflictEvent(2, 'src/a.mjs', ['T1', 'T2']),
  ];
  assert.equal(NON_CONVERGENT_EPOCH_THRESHOLD, 3);
  // 2回目は再計画が効かなかった可能性（順序の綾を含む）で、まだ繰り返しと断じない。
  assert.deepEqual(detectNonConvergentConflicts({ events }), []);
  assert.equal(detectNonConvergentConflicts({ events, threshold: 2 }).length, 1);
});

test('閾値は2未満にできない', () => {
  assert.throws(() => detectNonConvergentConflicts({ events: [], threshold: 1 }),
    /thresholdが2以上の整数でない/u);
});

test('形の壊れたfindingを黙って数えない', () => {
  const events = [
    { kind: 'conflict_found', plan_epoch: 1, payload: { kind: 'observed_write_conflict' } },
    { kind: 'conflict_found', plan_epoch: 2, payload: {} },
    { kind: 'checkpoint_observed', plan_epoch: 3, payload: { kind: 'observed_write_conflict', todo_ids: ['T1'] } },
  ];
  assert.deepEqual(detectNonConvergentConflicts({ events }), []);
});
