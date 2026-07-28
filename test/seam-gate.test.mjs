import assert from 'node:assert/strict';
import test from 'node:test';

import { SEAM_GATE_PRECONDITIONS, explainSeamGate } from '../src/seam-gate.mjs';

// 確実の門（sc-012）。機械変換の前提を正典一覧として持ち、拒否理由を
// 「宣言を直せば機械で通る」「AIが変換すべき」へ分類する。可否は決めない。

test('理由が無ければ門は開いており、手渡しは発生しない', () => {
  const gate = explainSeamGate([]);
  assert.equal(gate.certain, true);
  assert.equal(gate.handoff, 'none');
  assert.deepEqual(gate.failed, []);
});

test('宣言起因の欠けだけなら、直して再提出すれば機械で通ると分類する', () => {
  const gate = explainSeamGate(['owned_symbols_missing:T2', 'duplicate_task_id']);
  assert.equal(gate.certain, false);
  assert.equal(gate.handoff, 'fix_declaration');
  assert.deepEqual(gate.failed.map(({ id }) => id),
    ['inputs_well_formed', 'ownership_declared_and_exclusive']);
});

test('機械の変換能力の外の欠けが1つでもあればAIへ渡す', () => {
  const gate = explainSeamGate([
    'owned_symbols_missing:T2',
    'behavior_equivalent:severed_reference:src/page-left.mjs:db',
  ]);
  assert.equal(gate.handoff, 'hand_to_ai');
  const severed = gate.failed.find(({ id }) => id === 'behavior_preserved');
  assert.deepEqual(severed.reasons,
    ['behavior_equivalent:severed_reference:src/page-left.mjs:db']);
});

test('未知の理由は確実側へ丸めず、安全側の手渡しとして返す', () => {
  const gate = explainSeamGate(['some_future_reason:whatever']);
  assert.equal(gate.certain, false);
  assert.equal(gate.handoff, 'hand_to_ai');
  assert.deepEqual(gate.unrecognized, ['some_future_reason:whatever']);
});

test('正典一覧は実際の拒否語彙を覆っている（対応の突き合わせ）', () => {
  // 変換の各段が実際に返す理由の代表。語彙が増えたらこのtestと正典の両方を更新する。
  const emitted = [
    'invalid_source_path', 'invalid_shared_path', 'invalid_owned_path:T1',
    'invalid_candidate_id', 'task_refs_below_minimum', 'duplicate_task_id',
    'surface_path_collision', 'empty_source', 'surfaces_incomplete',
    'owned_symbols_missing:T1', 'owned_symbol_claimed_twice',
    'callee_data_missing:renderLeft', 'closure_rounds_exhausted',
    'shared_depends_on_owned:helper->renderLeft',
    'symbol_extent_missing:CSS', 'symbol_extent_overlap:a:b',
    'symbol_inside_import_block', 'symbol_lookup_truncated:GIT_SHA1',
    'behavior_equivalent:unknown', 'behavior_equivalent:severed_observation_missing',
    'focused_tests_passed', 'sensor_fresh', 'verifier:boom', 'witness:reason',
    'overlap_reduced:target_conflict_remains', 'parallelism_improved:no_gain:2->2',
  ];
  const gate = explainSeamGate(emitted);
  assert.deepEqual(gate.unrecognized, []);
  // 一覧側にも、どの理由にも対応しない飾りの条件が無いこと。
  const matched = new Set(gate.failed.map(({ id }) => id));
  for (const condition of SEAM_GATE_PRECONDITIONS) {
    assert.equal(matched.has(condition.id), true, `unused condition: ${condition.id}`);
  }
});
