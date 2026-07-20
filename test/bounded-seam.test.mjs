import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBoundedSeamCandidate, validateBoundedSeamCandidate } from '../src/bounded-seam.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bounded-seam-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeFile(path.join(root, 'target.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'target.test.mjs'), 'fixture\n');
  execFileSync('git', ['add', 'target.mjs', 'target.test.mjs'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid',
    'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}

function candidate(root) {
  const value = { schema: 'lattice.bounded_seam_candidate.v1', candidate_id: 'seam-1',
    base_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    manifest_digest: 'a'.repeat(64), finding_digest: 'b'.repeat(64),
    todo_refs: [{ plan_key: 'main', task_id: 'T1' }, { plan_key: 'main', task_id: 'T2' }],
    anchor: { path: 'target.mjs', symbol: 'value', start_line: 1, end_line: 1 },
    allowed_paths: ['target.mjs', 'target.test.mjs'], required_paths: ['target.mjs'],
    verification_policy: { focused_test_ids: ['target-test'], require_behavior_equivalence: true,
      require_fresh_sensor: true, require_overlap_reduction: true }, candidate_digest: '' };
  value.candidate_digest = todoSelfDigest(value, 'candidate_digest');
  return value;
}

test('bounded seamは隔離worktreeの許可locusだけをacceptしcanonical repoを不変に保つ', async (context) => {
  const root = await fixture(context);
  const input = candidate(root);
  assert.equal(validateBoundedSeamCandidate(input), true);
  const before = await readFile(path.join(root, 'target.mjs'), 'utf8');
  const accepted = await runBoundedSeamCandidate({ repoRoot: root, candidate: input,
    transform: async ({ worktreePath }) => writeFile(path.join(worktreePath, 'target.mjs'),
      'export const value = 2;\n'),
    verify: async () => ({ behavior_equivalent: true, focused_tests_passed: true,
      sensor_fresh: true, overlap_reduced: true, evidence_digest: 'c'.repeat(64) }) });
  assert.equal(accepted.decision, 'accepted');
  assert.deepEqual(accepted.changed_paths, ['target.mjs']);
  assert.equal(accepted.cleanup_ok, true);
  assert.equal(await readFile(path.join(root, 'target.mjs'), 'utf8'), before);
});

test('bounded seamはlocus外変更をrejected artifactとして残す', async (context) => {
  const root = await fixture(context);
  const rejected = await runBoundedSeamCandidate({ repoRoot: root, candidate: candidate(root),
    transform: async ({ worktreePath }) => writeFile(path.join(worktreePath, 'outside.mjs'), 'drift\n'),
    verify: async () => { throw new Error('scope drift must stop before verify'); } });
  assert.equal(rejected.decision, 'rejected');
  assert.equal(rejected.reason, 'scope_drift');
  assert.deepEqual(rejected.changed_paths, ['outside.mjs']);
  assert.equal(rejected.cleanup_ok, true);
});
