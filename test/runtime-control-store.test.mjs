import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeArtifact, digestArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { createRuntimeControlRequest } from '../src/runtime-controller-protocol.mjs';
import {
  RuntimeControlStoreError,
  createRuntimeControlStore,
  validateRuntimeControlEventPayload,
  validateRuntimeControlJournal,
  validateRuntimeControlRequestLedger,
} from '../src/runtime-control-store.mjs';

const D = (character) => character.repeat(64);
const WHEN = '2026-07-21T00:00:00.000Z';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-control-store-'));
  const runDir = path.join(root, 'run-a');
  await mkdir(runDir);
  return { root, runDir };
}

function store(runDir, options = {}) {
  return createRuntimeControlStore({ runDir, runId: 'run-a', clock: () => WHEN, ...options });
}

function event(kind, recordedAt = WHEN) {
  const payloads = {
    controller_registered: { controller_id: 'controller-a', registration_digest: D('b') },
    controller_heartbeat: { controller_id: 'controller-a', registration_digest: D('b'),
      sequence: 1, lease_set_digest: D('c') },
    barrier_requested: { barrier_id: 'barrier-a', reason: 'test', running_count: 0,
      running_todo_ids: [], frozen_event_digest: D('d') },
  };
  return { run_id: 'run-a', kind, session_nonce_digest: D('a'), payload: payloads[kind], recorded_at: recordedAt };
}

function operation(operation = 'hold') {
  const artifact = ['finding_record', 'recompile'].includes(operation) ? { schema: `test.${operation}.v1` } : null;
  const artifactDigest = artifact === null ? (operation === 'conflict' ? D('b') : null) : digestArtifact(artifact);
  const shutdownReason = ['close', 'abandon'].includes(operation) ? 'requested' : null;
  const value = {
    schema: 'lattice.runtime_control_operation.v1', operation, run_ref: 'run-a',
    artifact, artifact_digest: artifactDigest,
    checkpoint_digest: operation === 'finding_record' ? D('c') : null,
    expected_epoch: 1, expected_queue_digest: null,
    shutdown_reason: shutdownReason, operation_digest: '',
  };
  value.operation_digest = selfDigest(value, 'operation_digest');
  return value;
}

test('control event payloadは現producer全kindをdiscriminator別exact検証する', () => {
  const observation = { schema: 'test.process.v1', quiesced: true };
  const worktreeFingerprint = { schema: 'test.worktree.v1', checkpoint_digest: D('f') };
  const checkpoint = { schema: 'test.checkpoint.v1', checkpoint_digest: D('f') };
  const directObservation = { quiesced: true,
    process_observation_digest: digestArtifact(observation),
    worktree_fingerprint_digest: digestArtifact(worktreeFingerprint),
    final_checkpoint_digest: checkpoint.checkpoint_digest, observation,
    worktree_fingerprint: worktreeFingerprint, checkpoint, write_enabled: false };
  const ack = { schema: 'lattice.executor_quiescence_ack.v1', ack_id: 'ack-a', run_id: 'run-a',
    todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', plan_epoch: 1,
    packet_digest: D('1'), write_lease_id: 'lease-a', barrier_control_digest: D('9'),
    final_checkpoint_digest: directObservation.final_checkpoint_digest,
    process_observation_digest: directObservation.process_observation_digest,
    worktree_fingerprint_digest: directObservation.worktree_fingerprint_digest,
    supervisor_session_nonce_digest: D('a'), ack_digest: '' };
  ack.ack_digest = selfDigest(ack, 'ack_digest');
  const valid = {
    supervisor_activated: { supervisor_descriptor_digest: D('1'), controller_descriptor_digest: D('2'), registration_digest: D('3') },
    supervisor_stopped: { shutdown_result_digest: D('4') },
    controller_registered: { controller_id: 'controller-a', registration_digest: D('5') },
    controller_heartbeat: { controller_id: 'controller-a', registration_digest: D('5'), sequence: 1, lease_set_digest: D('6') },
    controller_recovery_rebound: { old_registration_digests: [D('5')], new_registration_digest: D('6'), running_todo_ids: ['T1'] },
    dispatch_routed: { controller_id: 'controller-a', request_digest: D('7'), response_digest: D('8') },
    observation_routed: { controller_id: 'controller-a', request_digest: D('7'), response_digest: D('8') },
    hold_prepared: { request_id: 'request-a', logical_intent_digest: D('8'), finding_digest: D('7'), barrier_id: 'barrier-a', recorded_at: WHEN },
    barrier_requested: { barrier_id: 'barrier-a', reason: 'test', running_count: 0, running_todo_ids: [], frozen_event_digest: D('9') },
    executor_quiesced: { barrier_id: 'barrier-a', barrier_control_digest: D('9'), todo_id: 'T1',
      ack, direct_observation: directObservation,
      evidence_digest: digestArtifact({ ack, direct_observation: directObservation }) },
    lease_revoked: { controller_id: 'controller-a', reason: 'test', response_digest: D('b') },
    epoch_rebind_acknowledged: { todo_id: 'T1', ack_digest: D('c'), staged_lease_digest: D('d') },
    write_gate_committed: { gate_digest: D('e'), gate_generation: 1 },
    epoch_activated: { plan_epoch: 2, gate_digest: D('e') },
    intake_resumed: { plan_epoch: 2, gate_digest: D('e') },
    supervisor_recovery_barrier: { barrier_id: 'barrier-a' },
  };
  for (const [kind, payload] of Object.entries(valid)) {
    assert.equal(validateRuntimeControlEventPayload(kind, payload), true, kind);
    assert.equal(validateRuntimeControlEventPayload(kind, { ...payload, extra: true }), false, `${kind}:extra`);
  }
  assert.equal(validateRuntimeControlEventPayload('supervisor_stopped', { signal: 'SIGTERM' }), true);
  assert.equal(validateRuntimeControlEventPayload('lease_revoked', { controller_id: 'controller-a', reason: 'test' }), true);
  assert.equal(validateRuntimeControlEventPayload('unknown_kind', {}), false);
});

function request(requestId = 'request-a', op = 'hold') {
  return createRuntimeControlRequest({ requestId, runId: 'run-a', operation: op,
    payload: operation(op), sessionNonce: 'n'.repeat(64) });
}

function publicEntry(input, disposition, state, output = null) {
  const intent = { request_id: input.request_id, run_id: input.run_id,
    operation: input.operation, payload: input.payload, intent_digest: '' };
  return { disposition, state, request_digest: input.request_digest,
    intent_digest: selfDigest(intent, 'intent_digest'), response: output };
}

function response(value, outcome = 'completed') {
  const result = {
    schema: 'lattice.runtime_control_result.v1', operation: value.operation,
    outcome: outcome === 'completed'
      ? ({ activate: 'activated', hold: 'held' }[value.operation] ?? 'reprocessed') : 'rejected',
    event_head_digest: D('c'),
    control_head_digest: D('d'), active_epoch: 1, staged_epoch: null, unmet: [], result_digest: '',
  };
  result.result_digest = selfDigest(result, 'result_digest');
  const document = {
    schema: 'lattice.runtime_control_response.v1', request_id: value.request_id,
    run_id: value.run_id, outcome, result, control_head_digest: result.control_head_digest,
    response_digest: '',
  };
  document.response_digest = selfDigest(document, 'response_digest');
  return document;
}

test('別factoryからの並行append 2件もsequence欠落・lost updateなし', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const [first, second] = await Promise.all([
    store(value.runDir).append(event('controller_registered', '2026-07-21T00:00:00.000Z')),
    store(value.runDir).append(event('controller_heartbeat', '2026-07-21T00:00:01.000Z')),
  ]);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.match(second, /^[0-9a-f]{64}$/);
  const events = await store(value.runDir).readEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(({ sequence }) => sequence), [1, 2]);
  assert.equal(events[1].previous_digest, events[0].event_digest);
  assert.equal(validateRuntimeControlJournal(events, 'run-a'), true);
});

for (const crashPoint of [
  'after_control_events_file_fsync',
  'after_control_events_rename',
  'after_run_directory_fsync',
]) {
  test(`${crashPoint}: canonical appendはsame-digest retryできる`, async (t) => {
    const value = await fixture();
    t.after(() => rm(value.root, { recursive: true, force: true }));
    let injected = false;
    const input = event('barrier_requested');
    await assert.rejects(store(value.runDir, { crashInjector: (point) => {
      if (!injected && point === crashPoint) { injected = true; throw new Error(`crash:${point}`); }
    } }).append(input), new RegExp(`crash:${crashPoint}`));
    const digest = await store(value.runDir).append(input);
    const events = await store(value.runDir).readEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].event_digest, digest);
  });
}

for (const crashPoint of [
  'after_request_ledger_file_fsync',
  'after_request_ledger_rename',
  'after_request_ledger_directory_fsync',
]) {
  test(`${crashPoint}: completed response publishもsame digestで回復する`, async (t) => {
    const value = await fixture();
    t.after(() => rm(value.root, { recursive: true, force: true }));
    const input = request();
    await store(value.runDir).beginRequest(input);
    const output = response(input);
    let injected = false;
    await assert.rejects(store(value.runDir, { crashInjector: (point) => {
      if (!injected && point === crashPoint) { injected = true; throw new Error(`crash:${point}`); }
    } }).completeRequest(input, output), new RegExp(`crash:${crashPoint}`));
    assert.deepEqual(await store(value.runDir).completeRequest(input, output), output);
    assert.deepEqual(await store(value.runDir).readRequest(input),
      publicEntry(input, 'completed', 'completed', output));
  });
}

test('disk prefixのnoncanonical bytes・chain改ざんをappend前に拒否する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await store(value.runDir).append(event('controller_registered'));
  const pathname = path.join(value.runDir, 'control-events.json');
  const events = JSON.parse(await readFile(pathname));
  events[0].sequence = 2;
  events[0].event_digest = selfDigest(events[0], 'event_digest');
  await writeFile(pathname, `${canonicalizeArtifact(events)}\n`);
  await assert.rejects(store(value.runDir).append(event('controller_heartbeat')),
    (error) => error instanceof RuntimeControlStoreError && error.code === 'INVALID_CONTROL_STORE');
});

test('request ledgerはin_progress/completedを耐久化し同一digestを再照会する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const input = request();
  assert.deepEqual(await store(value.runDir).beginRequest(input),
    publicEntry(input, 'started', 'in_progress'));
  assert.deepEqual(await store(value.runDir).beginRequest(input),
    publicEntry(input, 'in_progress', 'in_progress'));
  const output = response(input);
  assert.deepEqual(await store(value.runDir).completeRequest(input, output), output);
  assert.deepEqual(await store(value.runDir).completeRequest(input, output), output);
  assert.deepEqual(await store(value.runDir).beginRequest(input),
    publicEntry(input, 'completed', 'completed', output));
  assert.deepEqual(await store(value.runDir).readRequest(input),
    publicEntry(input, 'completed', 'completed', output));
  const ledger = JSON.parse(await readFile(path.join(value.runDir, 'control-request-ledger.json')));
  assert.equal(validateRuntimeControlRequestLedger(ledger, 'run-a'), true);
});

test('同一request_idの異digestとcompleted response差替えを拒否する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const first = request();
  await store(value.runDir).beginRequest(first);
  const different = request('request-a', 'close');
  await assert.rejects(store(value.runDir).beginRequest(different),
    (error) => error instanceof RuntimeControlStoreError && error.code === 'REQUEST_ID_CONFLICT');
  const output = response(first);
  await store(value.runDir).completeRequest(first, output);
  const changed = response(first);
  changed.result.event_head_digest = D('e');
  changed.result.result_digest = selfDigest(changed.result, 'result_digest');
  changed.response_digest = selfDigest(changed, 'response_digest');
  await assert.rejects(store(value.runDir).completeRequest(first, changed),
    (error) => error instanceof RuntimeControlStoreError && error.code === 'REQUEST_RESPONSE_CONFLICT');
});

test('durable recoveryだけは同一intentのrejected responseをcompletedへ単調昇格する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const first = request();
  await store(value.runDir).beginRequest(first);
  await store(value.runDir).completeRequest(first, response(first, 'rejected'));
  const retried = createRuntimeControlRequest({ requestId: first.request_id, runId: first.run_id,
    operation: first.operation, payload: first.payload, sessionNonce: 'm'.repeat(64) });
  const recovered = response(retried);
  assert.deepEqual(await store(value.runDir).recoverCompletedRequest(retried, recovered), recovered);
  assert.deepEqual(await store(value.runDir).readRequest(retried),
    publicEntry(retried, 'completed', 'completed', recovered));
  await assert.rejects(store(value.runDir).recoverCompletedRequest(retried, response(retried)),
    (error) => error instanceof RuntimeControlStoreError && error.code === 'REQUEST_RESPONSE_CONFLICT');
});

test('restart activationは同一intentのfresh session responseへledgerを更新する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const first = request('activation-a', 'activate');
  await store(value.runDir).beginRequest(first);
  await store(value.runDir).completeRequest(first, response(first));
  const retried = createRuntimeControlRequest({ requestId: first.request_id, runId: first.run_id,
    operation: first.operation, payload: first.payload, sessionNonce: 'm'.repeat(64) });
  const fresh = response(retried);
  fresh.result.control_head_digest = D('e');
  fresh.result.result_digest = selfDigest(fresh.result, 'result_digest');
  fresh.control_head_digest = fresh.result.control_head_digest;
  fresh.response_digest = selfDigest(fresh, 'response_digest');
  assert.notEqual(fresh.response_digest, response(first).response_digest);
  assert.deepEqual(await store(value.runDir).replaceCompletedActivationRequest(retried, fresh), fresh);
  assert.deepEqual(await store(value.runDir).readRequest(retried),
    publicEntry(retried, 'completed', 'completed', fresh));
});

test('pointer commit後のin_progress activationもcurrent session responseへledgerを結び直す', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const first = request('activation-in-progress', 'activate');
  await store(value.runDir).beginRequest(first);
  const retried = createRuntimeControlRequest({ requestId: first.request_id, runId: first.run_id,
    operation: first.operation, payload: first.payload, sessionNonce: 'm'.repeat(64) });
  const fresh = response(retried);
  assert.deepEqual(await store(value.runDir).replaceCompletedActivationRequest(retried, fresh), fresh);
  assert.deepEqual(await store(value.runDir).readRequest(retried),
    publicEntry(retried, 'completed', 'completed', fresh));
});

for (const crashPoint of [
  'after_request_ledger_file_fsync',
  'after_request_ledger_rename',
  'after_request_ledger_directory_fsync',
]) {
  test(`${crashPoint}: request ledger mutationはsame request digestで回復する`, async (t) => {
    const value = await fixture();
    t.after(() => rm(value.root, { recursive: true, force: true }));
    let injected = false;
    const input = request();
    await assert.rejects(store(value.runDir, { crashInjector: (point) => {
      if (!injected && point === crashPoint) { injected = true; throw new Error(`crash:${point}`); }
    } }).beginRequest(input), new RegExp(`crash:${crashPoint}`));
    assert.deepEqual(await store(value.runDir).beginRequest(input),
      publicEntry(input, crashPoint === 'after_request_ledger_file_fsync' ? 'started' : 'in_progress',
        'in_progress'));
  });
}

test('I/O早期警報のcontrol eventは、警報digestと結果を必ず持つ', () => {
  // ADR 0143。findingではないが、記録は残す——気づいたのに黙っている状態を作らない。
  const body = { warning_kind: 'io_overlap_warning', todo_ids: ['T1', 'T2'], path: 'src/page.mjs' };
  const payload = { ...body, probe_outcome: 'observed', warning_digest: digestArtifact(body) };
  assert.equal(validateRuntimeControlEventPayload('io_warning_observed', payload), true);

  // digestが本文と合わないものを受けない。記録が主張と食い違う状態を残さない。
  assert.equal(validateRuntimeControlEventPayload('io_warning_observed',
    { ...payload, path: 'src/other.mjs' }), false);

  // probeの結果はclosed setにする。「確かめていない」と「確かめて消えていた」を混ぜない。
  assert.equal(validateRuntimeControlEventPayload('io_warning_observed',
    { ...payload, probe_outcome: 'maybe' }), false);

  // todo_idsは昇順一意。順序が揺れると同じ事実が別の記録になる。
  const swapped = { ...body, todo_ids: ['T2', 'T1'] };
  assert.equal(validateRuntimeControlEventPayload('io_warning_observed',
    { ...swapped, probe_outcome: 'observed', warning_digest: digestArtifact(swapped) }), false);

  assert.equal(validateRuntimeControlEventPayload('io_warning_observed',
    { ...payload, extra: true }), false);
});
