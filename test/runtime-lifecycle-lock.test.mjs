import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  RuntimeLifecycleLockError,
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
  validateRuntimeLifecycleLockArtifact,
} from '../src/runtime-lifecycle-lock.mjs';

const D = (character) => character.repeat(64);
const WHEN = new Date('2026-07-21T00:00:00.000Z');

function identity(pid, startedIdentity = `fixture-${pid}`) {
  const value = {
    schema: 'lattice.process_start_identity.v1', platform: process.platform,
    pid, started_identity: startedIdentity, identity_digest: '',
  };
  value.identity_digest = selfDigest(value, 'identity_digest');
  return value;
}

async function fixture(t) {
  const runDir = await mkdtemp(path.join(tmpdir(), 'lattice-lifecycle-lock-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));
  return { runDir, lockPath: path.join(runDir, '.lifecycle.lock') };
}

function acquire(runDir, overrides = {}) {
  const current = identity(process.pid);
  return acquireRuntimeLifecycleLock({
    runDir,
    sessionNonceDigest: D('a'),
    operation: 'hold',
    requestId: 'request-a',
    processStartIdentity: current,
    observeProcessStartIdentity: async () => current,
    now: () => WHEN,
    ...overrides,
  });
}

test('並行2取得はwxで一方だけ成功し、他方をtyped RUN_BUSYにする', async (t) => {
  const { runDir, lockPath } = await fixture(t);
  const results = await Promise.allSettled([acquire(runDir), acquire(runDir)]);
  const fulfilled = results.filter(({ status }) => status === 'fulfilled');
  const rejected = results.filter(({ status }) => status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason instanceof RuntimeLifecycleLockError, true);
  assert.equal(rejected[0].reason.code, 'RUN_BUSY');
  const bytes = await readFile(lockPath, 'utf8');
  const artifact = JSON.parse(bytes);
  assert.equal(bytes, `${canonicalizeArtifact(artifact)}\n`);
  assert.equal(validateRuntimeLifecycleLockArtifact(artifact), true);
  await fulfilled[0].value.release();
});

test('dead又はPID再利用されたowner artifactを検証して回収する', async (t) => {
  const { runDir, lockPath } = await fixture(t);
  const staleIdentity = identity(process.pid, 'old-process-start');
  const stale = {
    schema: 'lattice.runtime_lifecycle_lock.v1', owner_pid: process.pid,
    owner_process_start_identity: staleIdentity, session_nonce_digest: D('b'),
    operation: 'recompile', request_id: 'old-request',
    acquired_at: WHEN.toISOString(), lock_digest: '',
  };
  stale.lock_digest = selfDigest(stale, 'lock_digest');
  await writeFile(lockPath, `${canonicalizeArtifact(stale)}\n`, { mode: 0o600, flag: 'wx' });

  const current = identity(process.pid, 'current-process-start');
  const acquired = await acquire(runDir, {
    processStartIdentity: current,
    observeProcessStartIdentity: async () => current,
    operation: 'resume', requestId: 'new-request',
  });
  assert.equal(acquired.artifact.operation, 'resume');
  assert.notEqual(acquired.artifact.lock_digest, stale.lock_digest);
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).lock_digest,
    acquired.artifact.lock_digest);
  await acquired.release();
});

test('foreign owner digestによるreleaseはlockを残して拒否する', async (t) => {
  const { runDir, lockPath } = await fixture(t);
  const acquired = await acquire(runDir);
  await assert.rejects(
    releaseRuntimeLifecycleLock({ lockPath, ownerDigest: D('f') }),
    (error) => error instanceof RuntimeLifecycleLockError
      && error.code === 'RUN_LOCK_OWNER_MISMATCH',
  );
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).lock_digest,
    acquired.artifact.lock_digest);
  await acquired.release();
});

test('待機期限切れはtyped RUN_BUSYで既存ownerを保持する', async (t) => {
  const { runDir, lockPath } = await fixture(t);
  const first = await acquire(runDir);
  await assert.rejects(acquire(runDir, {
    requestId: 'request-timeout', timeoutMs: 15, retryIntervalMs: 2,
  }), (error) => error instanceof RuntimeLifecycleLockError
    && error.code === 'RUN_BUSY' && /timeout/u.test(error.detail));
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).lock_digest,
    first.artifact.lock_digest);
  await first.release();
});
