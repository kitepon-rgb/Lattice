import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  RuntimeGateStoreError,
  createRuntimeGateStore,
  readCommittedRuntimeGate,
  validateLeaseRevokedControlEvent,
  validateRuntimeGateCommitReceipt,
} from '../src/runtime-gate-store.mjs';

const D = (character) => character.repeat(64);
const WHEN = '2026-07-21T00:00:00.000Z';

function sign(value, field) {
  const result = structuredClone(value);
  result[field] = selfDigest(result, field);
  return result;
}

function gate(generation = 1, previousGateDigest = null, committedAt = WHEN) {
  return sign({
    schema: 'lattice.supervisor_write_gate.v1', run_id: 'run-a', plan_epoch: generation,
    gate_generation: generation, release_barrier_digest: D('a'),
    controller_release_ack_digests: [D('b')], armed_lease_digests: [D('c')],
    previous_gate_digest: previousGateDigest, committed_at: committedAt, gate_digest: '',
  }, 'gate_digest');
}

function activation(value) {
  return {
    gate: value,
    control_events: [
      { kind: 'write_gate_committed', payload: {
        gate_digest: value.gate_digest, gate_generation: value.gate_generation,
      } },
      { kind: 'epoch_activated', payload: {
        plan_epoch: value.plan_epoch, gate_digest: value.gate_digest,
      } },
      { kind: 'intake_resumed', payload: {
        plan_epoch: value.plan_epoch, gate_digest: value.gate_digest,
      } },
    ],
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-gate-store-'));
  const runDir = path.join(root, 'run-a');
  await mkdir(path.join(runDir, 'supervisor'), { recursive: true });
  const activated = sign({
    schema: 'lattice.runtime_control_event.v1', run_id: 'run-a', sequence: 1,
    previous_digest: null, kind: 'supervisor_activated', session_nonce_digest: D('d'),
    payload: { supervisor_descriptor_digest: D('e') }, recorded_at: WHEN, event_digest: '',
  }, 'event_digest');
  await writeFile(path.join(runDir, 'control-events.json'),
    `${canonicalizeArtifact([activated])}\n`, { mode: 0o600 });
  return { root, runDir };
}

function store(runDir, crashInjector = null) {
  return createRuntimeGateStore({
    runDir, runId: 'run-a', sessionNonceDigest: D('d'), crashInjector,
  });
}

test('supervisor gateWriter APIはgate/event/receiptをexact bindしてreceiptをcommit pointにする', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const input = activation(gate());
  const receipt = await store(value.runDir).commit(input);
  assert.equal(receipt.schema, 'lattice.runtime_gate_commit_receipt.v1');
  assert.equal(receipt.gate_digest, input.gate.gate_digest);
  assert.equal(validateRuntimeGateCommitReceipt(receipt), true);
  const reopened = await store(value.runDir).read();
  assert.equal(reopened.receipt.receipt_digest, receipt.receipt_digest);
  assert.equal(reopened.bundle.control_events.length, 3);
  assert.deepEqual(reopened.bundle.control_events.map(({ kind }) => kind), [
    'write_gate_committed', 'epoch_activated', 'intake_resumed',
  ]);
  assert.equal(reopened.bundle.control_events[0].previous_digest,
    JSON.parse(await readFile(path.join(value.runDir, 'control-events.json')))[0].event_digest);
});

const CRASH_POINTS = [
  'after_bundle_file_fsync', 'after_bundle_rename', 'after_bundle_directory_fsync',
  'after_events_file_fsync', 'after_events_rename', 'after_events_directory_fsync',
  'after_gate_file_fsync', 'after_gate_rename', 'after_gate_directory_fsync',
  'after_receipt_file_fsync', 'after_receipt_rename', 'after_receipt_directory_fsync',
];

for (const crashPoint of CRASH_POINTS) {
  test(`${crashPoint}: same digest retryだけがroll-forwardする`, async (t) => {
    const value = await fixture();
    t.after(() => rm(value.root, { recursive: true, force: true }));
    let injected = false;
    const input = activation(gate());
    await assert.rejects(store(value.runDir, async (point) => {
      if (!injected && point === crashPoint) {
        injected = true;
        throw new Error(`crash:${point}`);
      }
    }).commit(input), new RegExp(`crash:${crashPoint}`));
    assert.equal(injected, true);
    const receipt = await store(value.runDir).recover(input);
    assert.equal(receipt.gate_digest, input.gate.gate_digest);
    assert.equal((await store(value.runDir).read()).receipt.receipt_digest,
      receipt.receipt_digest);
  });
}

test('partial publishへdifferent digest retryはstoreを上書きせずfail closed', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const first = activation(gate());
  await assert.rejects(store(value.runDir, (point) => {
    if (point === 'after_bundle_directory_fsync') throw new Error('crash');
  }).commit(first), /crash/);
  const different = activation(gate(1, null, '2026-07-21T00:00:01.000Z'));
  await assert.rejects(store(value.runDir).recover(different), (error) => (
    error instanceof RuntimeGateStoreError && error.code === 'GATE_COMMIT_CONFLICT'
  ));
  const receipt = await store(value.runDir).recover(first);
  assert.equal(receipt.gate_digest, first.gate.gate_digest);
});

test('same digest completed retryはreceipt bytesを変えずidempotent', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const input = activation(gate());
  const first = await store(value.runDir).commit(input);
  const receiptPath = path.join(value.runDir, 'supervisor', 'gate-receipts',
    '00000001.receipt.json');
  const bytes = await readFile(receiptPath);
  const second = await store(value.runDir).commit(input);
  assert.deepEqual(second, first);
  assert.deepEqual(await readFile(receiptPath), bytes);
});

test('generation 2はprevious gateとprevious receiptを両方chainする', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const firstGate = gate();
  const first = await store(value.runDir).commit(activation(firstGate));
  const secondGate = gate(2, firstGate.gate_digest, '2026-07-21T00:00:01.000Z');
  const second = await store(value.runDir).commit(activation(secondGate));
  assert.equal(second.previous_receipt_digest, first.receipt_digest);
  const reopened = await readCommittedRuntimeGate({ runDir: value.runDir, expectedRunId: 'run-a' });
  assert.equal(reopened.gate.gate_generation, 2);
  assert.equal(reopened.receipt.previous_receipt_digest, first.receipt_digest);
  await assert.rejects(store(value.runDir).commit(activation(firstGate)), (error) => (
    error instanceof RuntimeGateStoreError && error.code === 'GATE_COMMIT_CONFLICT'
  ));
  assert.equal((await store(value.runDir).read()).gate.gate_generation, 2);
});

test('readはlatestだけでなくgeneration 1までのreceipt chain改ざんを拒否する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const firstGate = gate();
  await store(value.runDir).commit(activation(firstGate));
  await store(value.runDir).commit(activation(
    gate(2, firstGate.gate_digest, '2026-07-21T00:00:01.000Z'),
  ));
  const firstReceiptPath = path.join(value.runDir, 'supervisor', 'gate-receipts',
    '00000001.receipt.json');
  const firstReceipt = JSON.parse(await readFile(firstReceiptPath));
  firstReceipt.control_head_digest = D('f');
  firstReceipt.receipt_digest = selfDigest(firstReceipt, 'receipt_digest');
  await writeFile(firstReceiptPath, `${canonicalizeArtifact(firstReceipt)}\n`);
  await assert.rejects(store(value.runDir).read(), (error) => (
    error instanceof RuntimeGateStoreError && error.code === 'INVALID_GATE_STORE'
  ));
});

test('receipt unknown field/noncanonical bytes/tamperはread時にfail closed', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await store(value.runDir).commit(activation(gate()));
  const receiptPath = path.join(value.runDir, 'supervisor', 'gate-receipts',
    '00000001.receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath));
  receipt.unknown = true;
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  await assert.rejects(store(value.runDir).read(), (error) => (
    error instanceof RuntimeGateStoreError && error.code === 'INVALID_GATE_STORE'
  ));
});

test('gate exact schema違反は一切publishしない', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const invalid = gate();
  invalid.unknown = true;
  await assert.rejects(store(value.runDir).commit(activation(invalid)), (error) => (
    error instanceof RuntimeGateStoreError && error.code === 'INVALID_GATE_COMMIT'
  ));
  assert.equal(await store(value.runDir).read(), null);
});

test('lease_revoked成功証拠はresponse digest、exact revoked集合、residual zeroを必須にする', () => {
  const event = sign({
    schema: 'lattice.runtime_control_event.v1', run_id: 'run-a', sequence: 4,
    previous_digest: D('1'), kind: 'lease_revoked', session_nonce_digest: D('d'),
    payload: {
      controller_id: 'controller-a', reason: 'shutdown',
      requested_lease_digests: [D('2')], revoked_lease_digests: [D('2')],
      residual_processes: [], revoke_response_digest: D('3'),
    },
    recorded_at: WHEN, event_digest: '',
  }, 'event_digest');
  assert.equal(validateLeaseRevokedControlEvent(event), true);
  const failed = structuredClone(event);
  failed.payload.residual_processes = ['pid:42'];
  failed.event_digest = selfDigest(failed, 'event_digest');
  assert.equal(validateLeaseRevokedControlEvent(failed), false);
  const missingReceipt = structuredClone(event);
  delete missingReceipt.payload.revoke_response_digest;
  missingReceipt.event_digest = selfDigest(missingReceipt, 'event_digest');
  assert.equal(validateLeaseRevokedControlEvent(missingReceipt), false);
});
