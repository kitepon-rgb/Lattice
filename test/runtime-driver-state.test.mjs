import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeArtifact } from '../src/artifact-contracts.mjs';
import {
  RuntimeDriverStateError,
  readRuntimeDriverState,
  replaceRuntimeDriverState,
  validateRuntimeDriverState,
} from '../src/runtime-driver-state.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-driver-state-'));
  const runDir = path.join(root, '.lattice', 'runs', 'run-a');
  await mkdir(path.join(runDir, 'supervisor'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return runDir;
}

test('driver stateは停止中とexecutor完了待ちをcanonical artifactとして保存する', async (t) => {
  const runDir = await fixture(t);
  const driving = await replaceRuntimeDriverState({
    runDir,
    runId: 'run-a',
    supervisorDescriptorRef: 'supervisor/descriptor.json',
    supervisorDescriptorDigest: DIGEST_A,
    supervisorProcessStartIdentityDigest: DIGEST_B,
    driverState: 'driving',
    waitingOn: { kind: 'executor_completion', todo_ids: ['T1', 'T2'] },
    updatedAt: '2026-08-09T07:00:00.000Z',
  });
  assert.equal(validateRuntimeDriverState(driving), true);
  assert.deepEqual(await readRuntimeDriverState({ runDir }), driving);
  assert.equal(
    await readFile(path.join(runDir, 'supervisor', 'driver-state.json'), 'utf8'),
    `${canonicalizeArtifact(driving)}\n`,
  );

  const stopped = await replaceRuntimeDriverState({
    runDir,
    runId: 'run-a',
    supervisorDescriptorRef: `supervisor/restart-candidates/${'c'.repeat(64)}/descriptor.json`,
    supervisorDescriptorDigest: DIGEST_A,
    supervisorProcessStartIdentityDigest: DIGEST_B,
    driverState: 'stopped',
    waitingOn: null,
    updatedAt: '2026-08-09T07:00:01.000Z',
  });
  assert.equal(stopped.driver_state, 'stopped');
  assert.equal(stopped.waiting_on, null);
  assert.deepEqual(await readRuntimeDriverState({ runDir }), stopped);
});

test('driver stateは不正shapeと非canonical bytesをINVALID_RUN_STOREで拒否する', async (t) => {
  const runDir = await fixture(t);
  const statePath = path.join(runDir, 'supervisor', 'driver-state.json');
  await writeFile(statePath, '{"schema":"lattice.runtime_driver_state.v1"}\n');
  await assert.rejects(
    readRuntimeDriverState({ runDir }),
    (error) => error instanceof RuntimeDriverStateError && error.code === 'INVALID_RUN_STORE',
  );

  const valid = await replaceRuntimeDriverState({
    runDir,
    runId: 'run-a',
    supervisorDescriptorRef: 'supervisor/descriptor.json',
    supervisorDescriptorDigest: DIGEST_A,
    supervisorProcessStartIdentityDigest: DIGEST_B,
    driverState: 'driving',
    waitingOn: { kind: 'frontier_dispatch', todo_ids: ['T1'] },
    updatedAt: '2026-08-09T07:00:00.000Z',
  });
  await writeFile(statePath, `${JSON.stringify(valid, null, 2)}\n`);
  await assert.rejects(
    readRuntimeDriverState({ runDir }),
    (error) => error instanceof RuntimeDriverStateError && error.code === 'INVALID_RUN_STORE',
  );
});

test('driver stateがまだ無いrunはnullであり、停止中と安全に区別できる', async (t) => {
  const runDir = await fixture(t);
  assert.equal(await readRuntimeDriverState({ runDir }), null);
});
