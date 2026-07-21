import assert from 'node:assert/strict';
import test from 'node:test';

import { projectRuntimeStatusOverlays } from '../src/runtime-projection.mjs';

const todo = (ref) => ({ kind: 'todo', ref });
const plan = (ref) => ({ kind: 'runtime_plan', ref });

function event(sequence, kind, subject, payload = {}) {
  return { sequence, kind, subject, payload };
}

test('hold決定をheldとcarry-overへ相互排他的に投影する', () => {
  const events = [
    event(0, 'intake_frozen', plan('plan-e1'), { frozen_prefix_digest: 'a'.repeat(64) }),
    event(1, 'carry_over_witnessed', todo('T3'), { witness_digest: 'b'.repeat(64) }),
    event(2, 'hold_decided', plan('plan-e1'), {
      hold_set: ['T2', 'T1'], continue_set: ['T3'],
    }),
  ];

  assert.deepEqual(projectRuntimeStatusOverlays({ events }), {
    held: ['T1', 'T2'],
    carry_over: ['T3'],
    redispatch: [],
    intake_frozen: true,
  });
});

test('epoch移行後はcontext dispositionをcarry-overとredispatchへ投影する', () => {
  const events = [
    event(0, 'intake_frozen', plan('plan-e1'), { frozen_prefix_digest: 'a'.repeat(64) }),
    event(1, 'hold_decided', plan('plan-e1'), {
      hold_set: ['T1', 'T2'], continue_set: ['T3'],
    }),
    event(2, 'plan_recompiled', plan('plan-e2')),
    event(3, 'context_invalidated', todo('T1'), { reauthorized_via: 'redispatch' }),
    event(4, 'context_invalidated', todo('T2'), { reauthorized_via: 'redispatch' }),
    event(5, 'context_invalidated', todo('T3'), { reauthorized_via: 'epoch_rebind' }),
    event(6, 'epoch_rebound', todo('T3')),
    event(7, 'intake_resumed', plan('plan-e2')),
  ];

  assert.deepEqual(projectRuntimeStatusOverlays({ events }), {
    held: [],
    carry_over: ['T3'],
    redispatch: ['T1', 'T2'],
    intake_frozen: false,
  });
});

test('accepted taskの一時overlayだけを除き後続epochの再分類を反映する', () => {
  const events = [
    event(0, 'intake_frozen', plan('plan-e1')),
    event(1, 'hold_decided', plan('plan-e1'), { hold_set: ['T1'], continue_set: ['T2'] }),
    event(2, 'context_invalidated', todo('T1'), { reauthorized_via: 'redispatch' }),
    event(3, 'context_invalidated', todo('T2'), { reauthorized_via: 'epoch_rebind' }),
    event(4, 'receipt_accepted', todo('T1')),
    event(5, 'intake_resumed', plan('plan-e2')),
    event(6, 'intake_frozen', plan('plan-e2')),
    event(7, 'hold_decided', plan('plan-e2'), { hold_set: ['T2'], continue_set: [] }),
  ];

  assert.deepEqual(projectRuntimeStatusOverlays({ events }), {
    held: ['T2'],
    carry_over: [],
    redispatch: [],
    intake_frozen: true,
  });
});
