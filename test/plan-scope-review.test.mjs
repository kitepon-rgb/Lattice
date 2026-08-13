import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatePlanScopeReview } from '../src/plan-scope-review.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

const BIN = fileURLToPath(new URL('../bin/lattice.mjs', import.meta.url));

function planInput(taskIds = ['T1', 'T2']) {
  const value = {
    schema: 'lattice.plan_create_input.v4',
    tasks: taskIds.map((taskId) => ({ task_id: taskId })),
    input_digest: '',
  };
  value.input_digest = todoSelfDigest(value, 'input_digest');
  return value;
}

function reviewFor(plan, {
  assessments = [
    { task_id: 'T1', work_spec_ids: ['W1'], judgment: 'required', reason: 'W1を実現する。' },
    { task_id: 'T2', work_spec_ids: ['W2'], judgment: 'required', reason: 'W2を実現する。' },
  ],
  verdict = 'scope_preserved',
} = {}) {
  const value = {
    schema: 'lattice.plan_scope_review.v1',
    authoring_digest: plan.input_digest ?? plan.extraction_digest,
    work_specs: [
      { work_spec_id: 'W1', requirement: '機能Aを変更する。', acceptance: '機能Aが期待どおり動く。' },
      { work_spec_id: 'W2', requirement: '機能Bを変更する。', acceptance: '機能Bが期待どおり動く。' },
    ],
    task_assessments: assessments,
    verdict,
    review_digest: '',
  };
  value.review_digest = todoSelfDigest(value, 'review_digest');
  return value;
}

test('全工程が元の作業仕様へ対応すればscope preservedとして受理する', () => {
  const plan = planInput();
  const result = evaluatePlanScopeReview(plan, reviewFor(plan));

  assert.equal(result.accepted, true);
  assert.equal(result.verdict, 'scope_preserved');
  assert.deepEqual(result.out_of_scope_task_ids, []);
  assert.deepEqual(result.uncovered_work_spec_ids, []);
});

test('余計な工程を明示したreviewはscope mismatchとして返す', () => {
  const plan = planInput();
  const review = reviewFor(plan, {
    assessments: [
      { task_id: 'T1', work_spec_ids: ['W1', 'W2'], judgment: 'required', reason: 'W1とW2を実現する。' },
      { task_id: 'T2', work_spec_ids: [], judgment: 'out_of_scope', reason: '要求に無い安全装置である。' },
    ],
    verdict: 'scope_mismatch',
  });
  const result = evaluatePlanScopeReview(plan, review);

  assert.equal(result.accepted, false);
  assert.deepEqual(result.out_of_scope_task_ids, ['T2']);
  assert.deepEqual(result.uncovered_work_spec_ids, []);
});

test('どの工程にも実現されない作業仕様をscope mismatchとして返す', () => {
  const plan = planInput();
  const review = reviewFor(plan, {
    assessments: [
      { task_id: 'T1', work_spec_ids: ['W1'], judgment: 'required', reason: 'W1を実現する。' },
      { task_id: 'T2', work_spec_ids: ['W1'], judgment: 'required', reason: 'W1を分割実装する。' },
    ],
    verdict: 'scope_mismatch',
  });
  const result = evaluatePlanScopeReview(plan, review);

  assert.equal(result.accepted, false);
  assert.deepEqual(result.out_of_scope_task_ids, []);
  assert.deepEqual(result.uncovered_work_spec_ids, ['W2']);
});

test('工程を一つでも評価していないreviewは拒否する', () => {
  const plan = planInput();
  const review = reviewFor(plan, {
    assessments: [
      { task_id: 'T1', work_spec_ids: ['W1', 'W2'], judgment: 'required', reason: '両仕様を実現する。' },
    ],
  });

  assert.throws(() => evaluatePlanScopeReview(plan, review), (error) => {
    assert.equal(error.code, 'PLAN_SCOPE_REVIEW_INVALID');
    assert.equal(error.message, 'task_assessments_incomplete');
    return true;
  });
});

test('完成後に工程表が変わったreviewはdigest不一致で拒否する', () => {
  const plan = planInput();
  const review = reviewFor(plan);
  const changed = planInput(['T1', 'T2', 'T3']);

  assert.throws(() => evaluatePlanScopeReview(changed, review), (error) => {
    assert.equal(error.code, 'PLAN_SCOPE_REVIEW_INVALID');
    assert.equal(error.message, 'review_authoring_digest_mismatch');
    return true;
  });
});

test('CLIは完成済み工程表とreviewを照合し、scope preservedならexit 0を返す', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-plan-scope-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const plan = planInput();
  const review = reviewFor(plan);
  await writeFile(path.join(root, 'plan.json'), `${JSON.stringify(plan)}\n`);
  await writeFile(path.join(root, 'review.json'), `${JSON.stringify(review)}\n`);

  const run = spawnSync(process.execPath, [
    BIN, 'plan', 'scope-review', '--plan-input', 'plan.json', '--review', 'review.json', '--json',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.schema, 'lattice.plan_scope_review_result.v1');
  assert.equal(result.accepted, true);
});
