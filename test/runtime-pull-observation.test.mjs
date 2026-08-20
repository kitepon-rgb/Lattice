import assert from 'node:assert/strict';
import test from 'node:test';

import { observationIntakes } from '../src/runtime-pull-intake.mjs';

function intake(taskId, { accepted = false, hold = false } = {}) {
  return {
    task_id: taskId,
    accepted: accepted ? { head_sha: 'a'.repeat(40) } : null,
    intervention: hold
      ? { state: 'hold', reason: 'runtime_conflict' }
      : { state: 'none', reason: null },
  };
}

test('runtime_conflict hold の accept 対象は観測モデルから外さない', () => {
  const state = {
    intakes: [
      intake('t07-knowledge-pack', { hold: true }),
      intake('t01-wgc-frame', { accepted: true }),
      intake('t06-live-observation'),
    ],
  };
  const without = observationIntakes(state).map((entry) => entry.task_id);
  assert.deepEqual(without, ['t06-live-observation']);
  const withHeld = observationIntakes(state, 't07-knowledge-pack').map((entry) => entry.task_id);
  assert.deepEqual(withHeld, ['t07-knowledge-pack', 't06-live-observation']);
});

test('hold 中 task だけが残っても観測集合は空にしない', () => {
  const state = { intakes: [intake('t07-knowledge-pack', { hold: true })] };
  assert.deepEqual(observationIntakes(state).map((entry) => entry.task_id), []);
  assert.deepEqual(
    observationIntakes(state, 't07-knowledge-pack').map((entry) => entry.task_id),
    ['t07-knowledge-pack'],
  );
});
