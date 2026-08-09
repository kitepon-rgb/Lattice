import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selfDigest } from '../src/runtime-contracts.mjs';
import { buildNextRunEvent } from '../src/runtime-engine.mjs';
import { invokeSensorCli } from '../src/sensor-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const RUN_ID = 'landing-cli-fixture';
const RUN_REF = path.join('.lattice', 'runs', RUN_ID);

let temporaryRoot;
let repoRoot;
let resultWorktree;
let receiptHeadSha;
let eventsPath;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
}

async function snapshotRegularFiles(root, relative = '') {
  const snapshot = {};
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await snapshotRegularFiles(root, next));
    else if (entry.isFile()) snapshot[next] = (await readFile(path.join(root, next))).toString('base64');
  }
  return snapshot;
}

function witness() {
  return {
    owns: [{ kind: 'symbol', target: 'alpha' }, { kind: 'path', target: 'src/alpha.mjs' }],
    reads: [],
    writes: ['src/alpha.mjs'],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [
        { query_id: 'q-alpha', expect: { kind: 'symbol', name: 'alpha', path: 'src/alpha.mjs' } },
        { query_id: 'q-alpha-aff', expect: { kind: 'affected', path: 'src/alpha.mjs' } },
      ],
    },
    affected_tests: ['test/alpha.test.mjs'],
    unknowns: [],
  };
}

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-run-landing-'));
  repoRoot = path.join(temporaryRoot, 'repo');
  resultWorktree = path.join(temporaryRoot, 'result-worktree');
  const remoteRoot = path.join(temporaryRoot, 'remote.git');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/runs/\n');
  await writeFile(path.join(repoRoot, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  await writeFile(path.join(repoRoot, 'test', 'alpha.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { alpha } from '../src/alpha.mjs';\n\ntest('alpha', () => assert.equal(alpha, 1));\n");
  run('git', ['init', '--bare', '--quiet', remoteRoot], temporaryRoot);
  run('git', ['init', '--quiet', '--initial-branch=main'], repoRoot);
  run('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'add', '.'], repoRoot);
  run('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test',
    'commit', '--quiet', '-m', 'base'], repoRoot);
  const baseSha = run('git', ['rev-parse', 'HEAD'], repoRoot);
  run('git', ['remote', 'add', 'origin', remoteRoot], repoRoot);
  run('git', ['push', '--quiet', '-u', 'origin', 'main'], repoRoot);
  run('git', ['remote', 'set-head', 'origin', 'main'], repoRoot);
  invokeSensorCli(run, ['init', '.'], repoRoot);

  const request = {
    schema: 'lattice.run_request.v1',
    request_id: RUN_ID,
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 1 },
    todos: [{ todo_id: 'T1' }],
    manual_witness: { T1: witness() },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-alpha', operation: 'query', target: 'alpha' },
        { id: 'q-alpha-aff', operation: 'affected', target: 'src/alpha.mjs' },
      ],
    },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(temporaryRoot, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  const started = runCli(['run', 'start', '--request', requestPath, '--executor', 'scripted']);
  assert.equal(started.status, 0, started.stderr);

  run('git', ['worktree', 'add', '--quiet', '-b', 'receipt-result', resultWorktree, baseSha], repoRoot);
  await writeFile(path.join(resultWorktree, 'src', 'alpha.mjs'), 'export const alpha = 2;\n');
  run('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test',
    'add', 'src/alpha.mjs'], resultWorktree);
  run('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test',
    'commit', '--quiet', '-m', 'result'], resultWorktree);
  receiptHeadSha = run('git', ['rev-parse', 'HEAD'], resultWorktree);

  const runDir = path.join(repoRoot, RUN_REF);
  eventsPath = path.join(runDir, 'events.json');
  const compile = JSON.parse(await readFile(path.join(runDir, 'plan-compile-result.json'), 'utf8'));
  const events = JSON.parse(await readFile(eventsPath, 'utf8'));
  const checkpointDigest = 'c'.repeat(64);
  const append = (kind, subject, payload) => events.push(buildNextRunEvent({
    events,
    runId: RUN_ID,
    kind,
    planEpoch: 1,
    subject,
    payload,
    recordedAt: '2026-08-09T00:00:00.000Z',
  }));
  append('executor_dispatched', { kind: 'todo', ref: 'T1' }, {
    executor_handle: 'landing-executor-1',
    worktree_id: 'landing-worktree-1',
    packet_digest: 'a'.repeat(64),
    context_content_digest: 'b'.repeat(64),
  });
  append('checkpoint_observed', { kind: 'todo', ref: 'T1' }, {
    checkpoint_digest: checkpointDigest,
    observed_by: 'supervisor_terminal',
    diff: {
      schema: 'lattice.checkpoint_diff.v2',
      base_sha: baseSha,
      head_sha: receiptHeadSha,
      entries: [{ path: 'src/alpha.mjs', change: 'modified', content_digest: 'd'.repeat(64) }],
    },
  });
  const receipt = {
    schema: 'lattice.executor_receipt.v1',
    receipt_id: 'landing-receipt-1',
    executor_handle: 'landing-executor-1',
    worktree_id: 'landing-worktree-1',
    base_sha: baseSha,
    plan_epoch: 1,
    packet_digest: 'a'.repeat(64),
    todo_id: 'T1',
    checkpoint_digest: checkpointDigest,
    observed_diff: [{ path: 'src/alpha.mjs', change: 'modified' }],
  };
  receipt.receipt_digest = selfDigest(receipt, 'receipt_digest');
  append('receipt_recorded', { kind: 'todo', ref: 'T1' }, receipt);
  append('executor_terminal', { kind: 'todo', ref: 'T1' }, {
    executor_handle: 'landing-executor-1', terminal_state: 'reported',
  });
  append('receipt_accepted', { kind: 'todo', ref: 'T1' }, {
    receipt_id: receipt.receipt_id, checkpoint_digest: checkpointDigest,
  });
  append('run_closed', { kind: 'runtime_plan', ref: compile.plan.plan_ref }, { accepted: ['T1'] });
  await writeFile(eventsPath, `${JSON.stringify(events, null, 1)}\n`);
});

test.after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('run landingとrun closeは未着地をexit 0のread-only投影で返す', async () => {
  const runDir = path.dirname(eventsPath);
  const before = await snapshotRegularFiles(runDir);
  const landing = runCli(['run', 'landing', '--run', RUN_REF]);
  assert.equal(landing.status, 0, landing.stderr);
  const report = JSON.parse(landing.stdout);
  assert.equal(report.schema, 'lattice.run_landing_report.v1');
  assert.equal(report.landed, false);
  assert.equal(report.repository.default_branch_state, 'resolved');
  assert.equal(report.repository.default_branch_ref, 'refs/remotes/origin/main');
  assert.equal(report.repository.push_state, 'tracked');
  assert.equal(report.repository.unpushed_commits, 0);
  assert.deepEqual(report.accepted_receipts.map((entry) => ({
    todo_id: entry.todo_id,
    head_sha: entry.head_sha,
    landing_state: entry.landing_state,
    landed: entry.landed,
  })), [{ todo_id: 'T1', head_sha: receiptHeadSha, landing_state: 'not_landed', landed: false }]);

  const closed = runCli(['run', 'close', '--run', RUN_REF]);
  assert.equal(closed.status, 0, closed.stderr);
  const closeOutput = JSON.parse(closed.stdout);
  assert.equal(closeOutput.already_closed, true);
  assert.deepEqual(closeOutput.landing, report);
  assert.deepEqual(await snapshotRegularFiles(runDir), before);
});

test('既定branchへ未pushのreceipt HEADは未着地かつ未push本数1になる', async () => {
  run('git', ['merge', '--quiet', '--ff-only', 'receipt-result'], repoRoot);
  const before = await readFile(eventsPath, 'utf8');
  const result = runCli(['run', 'landing', '--run', RUN_REF]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.landed, false);
  assert.equal(report.accepted_receipts[0].landing_state, 'not_landed');
  assert.equal(report.repository.unpushed_commits, 1);
  assert.equal(await readFile(eventsPath, 'utf8'), before);
});

test('既定branchへpush済みなら着地済みを返す', () => {
  run('git', ['push', '--quiet', 'origin', 'main'], repoRoot);
  const result = runCli(['run', 'landing', '--run', RUN_REF]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.landed, true);
  assert.equal(report.accepted_receipts[0].landing_state, 'landed');
  assert.equal(report.repository.unpushed_commits, 0);
});

test('upstream無しはno_upstream状態値へ出しexit 0を維持する', () => {
  run('git', ['branch', '--unset-upstream'], repoRoot);
  const result = runCli(['run', 'landing', '--run', RUN_REF]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.landed, true);
  assert.equal(report.repository.push_state, 'no_upstream');
  assert.equal(report.repository.push_ref, null);
  assert.equal(report.repository.unpushed_commits, null);
});
