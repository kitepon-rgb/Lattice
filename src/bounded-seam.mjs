import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  exactRecord, isTodoDigest, isTodoIdentifier, isTodoRef, todoSelfDigest,
} from './todo-contracts.mjs';

const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function sortedUniqueRefs(value, { nonempty = false } = {}) {
  return Array.isArray(value) && (!nonempty || value.length > 0) && value.every(isTodoRef)
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

export function validateBoundedSeamCandidate(value) {
  try {
    return exactRecord(value, [
      'schema', 'candidate_id', 'base_sha', 'manifest_digest', 'finding_digest',
      'todo_refs', 'anchor', 'allowed_paths', 'required_paths', 'verification_policy',
      'candidate_digest',
    ]) && value.schema === 'lattice.bounded_seam_candidate.v1'
      && isTodoIdentifier(value.candidate_id) && GIT_OID.test(value.base_sha)
      && isTodoDigest(value.manifest_digest) && isTodoDigest(value.finding_digest)
      && Array.isArray(value.todo_refs) && value.todo_refs.length >= 2
      && value.todo_refs.every((entry) => exactRecord(entry, ['plan_key', 'task_id'])
        && isTodoIdentifier(entry.plan_key) && isTodoIdentifier(entry.task_id))
      && value.todo_refs.every((entry, index) => index === 0
        || `${value.todo_refs[index - 1].plan_key}\0${value.todo_refs[index - 1].task_id}`
          < `${entry.plan_key}\0${entry.task_id}`)
      && exactRecord(value.anchor, ['path', 'symbol', 'start_line', 'end_line'])
      && isTodoRef(value.anchor.path) && isTodoIdentifier(value.anchor.symbol)
      && Number.isSafeInteger(value.anchor.start_line) && value.anchor.start_line >= 1
      && Number.isSafeInteger(value.anchor.end_line) && value.anchor.end_line >= value.anchor.start_line
      && sortedUniqueRefs(value.allowed_paths, { nonempty: true })
      && sortedUniqueRefs(value.required_paths, { nonempty: true })
      && value.required_paths.every((entry) => value.allowed_paths.includes(entry))
      && value.allowed_paths.includes(value.anchor.path)
      && exactRecord(value.verification_policy, [
        'focused_test_ids', 'require_behavior_equivalence', 'require_fresh_sensor',
        'require_overlap_reduction',
      ]) && Array.isArray(value.verification_policy.focused_test_ids)
      && value.verification_policy.focused_test_ids.length > 0
      && value.verification_policy.focused_test_ids.every(isTodoIdentifier)
      && value.verification_policy.focused_test_ids.every((entry, index) => index === 0
        || value.verification_policy.focused_test_ids[index - 1] < entry)
      && value.verification_policy.require_behavior_equivalence === true
      && value.verification_policy.require_fresh_sensor === true
      && value.verification_policy.require_overlap_reduction === true
      && isTodoDigest(value.candidate_digest)
      && value.candidate_digest === todoSelfDigest(value, 'candidate_digest');
  } catch { return false; }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolve(Buffer.concat(stdout));
      else reject(new Error(`${command} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`));
    });
  });
}

async function fingerprint(repoRoot) {
  const [head, status, refs] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], repoRoot),
    run('git', ['status', '--porcelain=v1', '--untracked-files=all'], repoRoot),
    run('git', ['for-each-ref', '--format=%(refname) %(objectname)'], repoRoot),
  ]);
  return Buffer.concat([head, status, refs]).toString('hex');
}

async function changedPaths(worktreePath) {
  const bytes = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], worktreePath);
  const fields = bytes.toString('utf8').split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (status.includes('R') || status.includes('C')) paths.push(fields[++index]);
  }
  return [...new Set(paths)].sort();
}

function outcome(candidate, decision, reason, changed, verification, cleanupOk) {
  const result = { schema: 'lattice.bounded_seam_outcome.v1', candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest, decision, reason, changed_paths: changed,
    verification, cleanup_ok: cleanupOk, outcome_digest: '' };
  result.outcome_digest = todoSelfDigest(result, 'outcome_digest');
  return result;
}

export async function runBoundedSeamCandidate({ repoRoot, candidate, transform, verify }) {
  if (!validateBoundedSeamCandidate(candidate)) throw new TypeError('bounded seam candidate invalid');
  if (typeof repoRoot !== 'string' || typeof transform !== 'function' || typeof verify !== 'function') {
    throw new TypeError('bounded seam runner options invalid');
  }
  const before = await fingerprint(repoRoot);
  const head = (await run('git', ['rev-parse', 'HEAD'], repoRoot)).toString('utf8').trim();
  if (head !== candidate.base_sha) return outcome(candidate, 'rejected', 'stale_base', [], null, true);
  const worktreeRoot = await mkdtemp(path.join(tmpdir(), 'lattice-bounded-seam-'));
  const worktreePath = path.join(worktreeRoot, 'tree');
  let changed = [];
  let result;
  let cleanupOk = false;
  try {
    await run('git', ['worktree', 'add', '--detach', worktreePath, candidate.base_sha], repoRoot);
    try { await transform({ worktreePath, candidate: structuredClone(candidate) }); }
    catch { result = outcome(candidate, 'rejected', 'transform_failed', [], null, false); }
    if (result === undefined) changed = await changedPaths(worktreePath);
    if (result === undefined && (changed.some((entry) => !candidate.allowed_paths.includes(entry))
      || candidate.required_paths.some((entry) => !changed.includes(entry)))) {
      result = outcome(candidate, 'rejected', 'scope_drift', changed, null, false);
    } else if (result === undefined) {
      let verification;
      try { verification = await verify({ worktreePath, candidate: structuredClone(candidate), changed_paths: changed }); }
      catch { verification = null; }
      const valid = exactRecord(verification, [
        'behavior_equivalent', 'focused_tests_passed', 'sensor_fresh', 'overlap_reduced',
        'evidence_digest',
      ]) && verification.behavior_equivalent === true && verification.focused_tests_passed === true
        && verification.sensor_fresh === true && verification.overlap_reduced === true
        && isTodoDigest(verification.evidence_digest);
      result = outcome(candidate, valid ? 'accepted' : 'rejected',
        valid ? 'all_gates_passed' : 'verification_failed', changed, verification, false);
    }
  } finally {
    try {
      await run('git', ['worktree', 'remove', '--force', worktreePath], repoRoot);
      await rm(worktreeRoot, { recursive: true, force: true });
      cleanupOk = true;
    } catch { cleanupOk = false; }
  }
  const after = await fingerprint(repoRoot);
  if (before !== after) throw new TypeError('bounded seam runner modified canonical repository');
  return outcome(candidate, result.decision, result.reason, changed, result.verification, cleanupOk);
}
