import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  createDirectOsProcessObserver,
  createEmptyRunningObservationReceipt,
} from '../src/runtime-direct-os-observer.mjs';

const D = (value) => value.repeat(64);

function identity(pid, startedIdentity) {
  const value = { schema: 'lattice.process_start_identity.v1', platform: process.platform, pid, started_identity: startedIdentity, identity_digest: '' };
  value.identity_digest = selfDigest(value, 'identity_digest');
  return value;
}

function psLine(pid, ppid, pgid, state, startedIdentity) {
  return `${pid} ${ppid} ${pgid} ${state} ${startedIdentity}`;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-direct-os-'));
  const worktree = await realpath(root);
  const startedRoot = 'Tue Jul 21 10:00:00 2026';
  const startedChild = 'Tue Jul 21 10:00:01 2026';
  const resolved = {
    process_pid: 101,
    process_start_identity: identity(101, startedRoot),
    process_group_id: 101,
    process_children: [{ pid: 102, process_group_id: 101, process_start_identity: identity(102, startedChild) }],
    worktree_path: worktree,
    worktree_realpath: worktree,
    base_sha: 'a'.repeat(40),
  };
  const lines = [
    psLine(101, 1, 101, 'T', startedRoot),
    psLine(102, 101, 101, 'T', startedChild),
    psLine(999, 1, 999, 'S', 'Tue Jul 21 09:00:00 2026'),
  ].join('\n');
  const observer = (overrides = {}) => createDirectOsProcessObserver({
    resolveObservationBinding: async () => structuredClone(overrides.resolved ?? resolved),
    psSnapshot: async () => overrides.lines ?? lines,
    captureCheckpoint: overrides.captureCheckpoint ?? (async () => ({ checkpoint_digest: D('c'), diff: { schema: 'test.diff.v1' } })),
  });
  return { root, worktree, resolved, lines, observer };
}

test('root・全child・PGID・realpath・checkpointを独立再観測する', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const result = await f.observer()({ kind: 'quiescence', binding: { worktree_id: 'wt-a' }, ack: { worktree_id: 'wt-a' } });
  assert.equal(result.quiesced, true);
  assert.equal(result.observation.schema, 'lattice.direct_process_observation.v2');
  assert.deepEqual(result.observation.children.map((entry) => entry.pid), [102]);
  assert.equal(result.worktree_fingerprint.worktree_realpath, f.worktree);
  assert.equal(result.final_checkpoint_digest, D('c'));
  assert.equal(result.write_enabled, false);
});

test('ps失敗・空結果・parse不能はfail closed', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const psSnapshot of [async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); }, async () => '', async () => 'broken']) {
    const observe = createDirectOsProcessObserver({
      resolveObservationBinding: async () => structuredClone(f.resolved),
      psSnapshot,
      captureCheckpoint: async () => ({ checkpoint_digest: D('c') }),
    });
    await assert.rejects(observe({ kind: 'quiescence', binding: {}, ack: {} }), (error) => error.code === 'HOLD_ACKS_INCOMPLETE');
  }
});

test('missing child・未記録child・group mismatch・PID reuseを拒否する', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const cases = [
    psLine(101, 1, 101, 'T', 'Tue Jul 21 10:00:00 2026'),
    `${f.lines}\n${psLine(103, 102, 101, 'T', 'Tue Jul 21 10:00:02 2026')}`,
    f.lines.replace('102 101 101 T', '102 101 202 T'),
    f.lines.replace('Tue Jul 21 10:00:01 2026', 'Tue Jul 21 10:00:09 2026'),
  ];
  for (const lines of cases) {
    await assert.rejects(f.observer({ lines })({ kind: 'quiescence', binding: {}, ack: {} }), (error) => error.code === 'HOLD_ACKS_INCOMPLETE');
  }
});

test('running状態のroot又はchildをquiesced扱いしない', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const lines of [f.lines.replace('101 1 101 T', '101 1 101 S'), f.lines.replace('102 101 101 T', '102 101 101 S')]) {
    await assert.rejects(f.observer({ lines })({ kind: 'quiescence', binding: {}, ack: {} }), (error) => error.code === 'HOLD_ACKS_INCOMPLETE');
  }
});

test('worktree symlink swapをcheckpoint前後とも拒否する', async (t) => {
  const f = await fixture();
  const link = `${f.root}-link`;
  t.after(async () => { await rm(link, { force: true }); await rm(f.root, { recursive: true, force: true }); });
  await symlink(f.root, link);
  const before = structuredClone(f.resolved);
  before.worktree_path = link;
  await assert.rejects(f.observer({ resolved: before })({ kind: 'quiescence', binding: {}, ack: {} }), (error) => error.code === 'HOLD_ACKS_INCOMPLETE');

  const afterSwap = f.observer({
    captureCheckpoint: async () => {
      await rm(f.root, { recursive: true, force: true });
      await symlink(tmpdir(), f.root);
      return { checkpoint_digest: D('c') };
    },
  });
  await assert.rejects(afterSwap({ kind: 'quiescence', binding: {}, ack: {} }), (error) => error.code === 'HOLD_ACKS_INCOMPLETE');
});

test('empty running receiptは空集合だけを証明しprocess停止証拠を名乗らない', () => {
  const receipt = createEmptyRunningObservationReceipt({ runId: 'run-a', barrierId: 'barrier-a', frozenEventDigest: D('f') });
  assert.equal(receipt.running_count, 0);
  assert.equal(receipt.establishes_process_quiescence, false);
  assert.equal(receipt.receipt_digest, selfDigest(receipt, 'receipt_digest'));
});
