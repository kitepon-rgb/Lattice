import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { canonicalizeArtifact, digestArtifact } from '../src/artifact-contracts.mjs';
import { RuntimeManagedSupervisor, observeManagedProcessStartIdentity, sendRuntimeControlRequest, serveRuntimeControlSocket } from '../src/runtime-managed-supervisor.mjs';
import { CONTROLLER_OPERATIONS, armStagedWriteLease, createRuntimeControlRequest } from '../src/runtime-controller-protocol.mjs';

const D = (c) => c.repeat(64);
function sign(value, field) { value[field] = ''; value[field] = selfDigest(value, field); return value; }
function fixture() {
  const heartbeat = sign({ schema: 'lattice.runtime_heartbeat_policy.v1', interval_ms: 100, ttl_ms: 500, disconnect_revokes_immediately: true, policy_digest: '' }, 'policy_digest');
  const capabilities = sign({ schema: 'lattice.runtime_adapter_capabilities.v1', operations: [...CONTROLLER_OPERATIONS], process_observation: true, worktree_fingerprint: true, staged_write_lease: true, durable_dispatch: true, capabilities_digest: '' }, 'capabilities_digest');
  const identity = sign({ schema: 'lattice.process_start_identity.v1', platform: 'darwin', pid: 42, started_identity: 'boot:42:1', identity_digest: '' }, 'identity_digest');
  const descriptor = sign({ schema: 'lattice.runtime_adapter_controller_descriptor.v1', controller_id: 'controller-a', adapter_kind: 'fake', pid: 42, process_start_identity: identity, socket_ref: 'supervisor/controllers/controller-a.sock', controller_session_nonce_digest: D('a'), capabilities, heartbeat, descriptor_digest: '' }, 'descriptor_digest');
  const registration = sign({ schema: 'lattice.runtime_adapter_registration.v1', registration_id: 'registration-a', run_id: 'run-a', supervisor_session_nonce_digest: D('b'), controller_descriptor_digest: descriptor.descriptor_digest, registered_operations: [...CONTROLLER_OPERATIONS], registered_at: '2026-07-21T00:00:00.000Z', registration_digest: '' }, 'registration_digest');
  const binding = { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', plan_epoch: 1, packet_digest: D('c'), write_lease_id: 'old-lease', controller_registration_digest: registration.registration_digest };
  const quiescenceAck = sign({ schema: 'lattice.executor_quiescence_ack.v1', ack_id: 'quiet-a', run_id: 'run-a', todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', plan_epoch: 1, packet_digest: D('c'), write_lease_id: 'old-lease', barrier_control_digest: D('d'), final_checkpoint_digest: D('e'), process_observation_digest: D('f'), worktree_fingerprint_digest: D('1'), supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
  const staged = sign({ schema: 'lattice.runtime_write_lease.v1', lease_id: 'new-lease', run_id: 'run-a', todo_id: 'T1', plan_epoch: 2, packet_digest: D('2'), controller_registration_digest: registration.registration_digest, supervisor_session_nonce_digest: D('b'), state: 'staged', ttl_ms: 500, issued_control_digest: D('3'), lease_digest: '' }, 'lease_digest');
  const rebindPacket = sign({ schema: 'lattice.epoch_rebind_packet.v1', packet_id: 'rebind-packet-a', todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', witness_digest: D('4'), context_content_digest: D('5'), authorized_checkpoint_digest: D('6'), old_plan_ref: 'plan-v1', new_plan_ref: 'plan-v2', new_plan_epoch: 2, packet_digest: '' }, 'packet_digest');
  const rebindAck = sign({ schema: 'lattice.executor_epoch_rebind_ack.v1', ack_id: 'rebind-a', run_id: 'run-a', todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', predecessor_epoch: 1, successor_epoch: 2, predecessor_packet_digest: D('c'), rebind_packet_digest: rebindPacket.packet_digest, new_write_lease_id: 'new-lease', supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
  return { descriptor, registration, binding, quiescenceAck, staged, rebindPacket, rebindAck };
}

function response(operation, request, f) {
  if (operation === 'barrier') return sign({ schema: 'lattice.adapter_barrier_response.v1', request_id: request.request_id, barrier_id: request.barrier_id, quiescence_acks: [f.quiescenceAck], response_digest: '' }, 'response_digest');
  if (operation === 'rebind') return sign({ schema: 'lattice.adapter_rebind_response.v1', request_id: request.request_id, rebind_ack: f.rebindAck, staged_lease_digest: f.staged.lease_digest, response_digest: '' }, 'response_digest');
  if (operation === 'activate') {
    const readyAck = sign({ schema: 'lattice.adapter_ready_ack.v1', ack_id: 'ready-a', registration_digest: f.registration.registration_digest, controller_id: 'controller-a', run_id: 'run-a', plan_epoch: 2, activation_digest: request.activation_digest, staged_lease_digests: request.staged_lease_digests, supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
    return sign({ schema: 'lattice.adapter_activate_response.v1', request_id: request.request_id, ready_ack: readyAck, observed_pointer_digest: request.committed_epoch_digest, response_digest: '' }, 'response_digest');
  }
  if (operation === 'release') {
    const armed = armStagedWriteLease(f.staged, { releaseBarrierDigest: request.release_barrier_digest, gateGeneration: request.gate_generation });
    f.releaseAck = sign({ schema: 'lattice.adapter_release_ack.v1', ack_id: 'release-a', registration_digest: f.registration.registration_digest, controller_id: 'controller-a', run_id: 'run-a', plan_epoch: 2, release_barrier_digest: request.release_barrier_digest, gate_generation: request.gate_generation, armed_lease_digests: [armed.lease_digest], supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
    return sign({ schema: 'lattice.adapter_release_response.v1', request_id: request.request_id, release_ack: f.releaseAck, armed_lease_digests: [armed.lease_digest], observed_gate_generation: request.gate_generation, response_digest: '' }, 'response_digest');
  }
  if (operation === 'revoke') return sign({ schema: 'lattice.adapter_revoke_response.v1', request_id: request.request_id, revoked_lease_digests: request.lease_digests, residual_processes: [], response_digest: '' }, 'response_digest');
  throw new Error(`unexpected ${operation}`);
}

function makeSupervisor(f, nowRef) {
  const events = [];
  const gates = [];
  const supervisor = new RuntimeManagedSupervisor({
    runId: 'run-a', sessionNonceDigest: D('b'), clock: () => nowRef.value,
    processObserver: async ({ kind, ack }) => kind === 'quiescence'
      ? { quiesced: true, process_observation_digest: ack.process_observation_digest, worktree_fingerprint_digest: ack.worktree_fingerprint_digest, final_checkpoint_digest: ack.final_checkpoint_digest }
      : { rebind_ack_digest: ack.ack_digest, write_enabled: false },
    runningBindingResolver: async () => [f.binding],
    journal: { append: async (event) => { events.push(event); return event.kind === 'barrier_requested' ? D('d') : D('9'); } },
    gateWriter: { commit: async (bundle) => { gates.push(bundle); return { gate_digest: bundle.gate.gate_digest, control_head_digest: D('8') }; } },
  });
  const transport = { request: async (operation, request) => response(operation, request, f) };
  return { supervisor, transport, events, gates };
}

test('全running barrierはcontroller直接ackとOS再観測の一致を要求する', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s.transport });
  const acks = await s.supervisor.barrierAll({ barrierId: 'barrier-a', reason: 'conflict', frozenEventDigest: D('8') });
  assert.equal(acks.length, 1);
  assert.equal(s.supervisor.frozen, true);
  assert.deepEqual(s.events.filter((event) => event.kind === 'executor_quiesced').map((event) => event.payload.todo_id), ['T1']);
});

test('ack本文が正しくても独立再観測が不一致ならholdを完了しない', async () => {
  const f = fixture(); const events = [];
  const supervisor = new RuntimeManagedSupervisor({ runId: 'run-a', sessionNonceDigest: D('b'), clock: () => 0,
    processObserver: async () => ({ quiesced: false, process_observation_digest: D('f'), worktree_fingerprint_digest: D('1'), final_checkpoint_digest: D('e') }),
    runningBindingResolver: async () => [f.binding],
    journal: { append: async (event) => { events.push(event); return event.kind === 'barrier_requested' ? D('d') : D('9'); } }, gateWriter: { commit: async () => {} } });
  await supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: { request: async (op, req) => response(op, req, f) } });
  await assert.rejects(supervisor.barrierAll({ barrierId: 'barrier-a', reason: 'conflict', frozenEventDigest: D('8') }), (error) => error.code === 'HOLD_ACKS_INCOMPLETE');
});

test('direct rebind ack後もstaged leaseは中央gate commitまでwrite不能', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s.transport });
  await s.supervisor.barrierAll({ barrierId: 'barrier-a', reason: 'conflict', frozenEventDigest: D('8') });
  await s.supervisor.rebindController({ controllerId: 'controller-a', rebindPacket: f.rebindPacket, stagedLease: f.staged, expected: { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', predecessor_packet_digest: D('c'), rebind_packet_digest: f.rebindPacket.packet_digest } });
  await assert.rejects(s.supervisor.authorizeWrite({ leaseDigest: f.staged.lease_digest }), (error) => error.code === 'RUN_FROZEN');
  const committed = await s.supervisor.commitWriteGate({ planEpoch: 2, committedEpochDigest: D('4'), activationDigest: D('6'), releaseBarrierDigest: D('5'), committedAt: '2026-07-21T00:00:01.000Z' });
  assert.equal(s.gates.length, 1);
  assert.equal(s.supervisor.frozen, false);
  now.value = 1;
  assert.equal((await s.supervisor.authorizeWrite({ leaseDigest: committed.armedLeases[0].lease_digest })).state, 'armed');
});

test('heartbeat TTL超過とsocket断はleaseをfail closed revokeしfreezeする', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s.transport });
  now.value = 501;
  await assert.rejects(s.supervisor.assertControllerHealth(), (error) => error.code === 'CONTROLLER_HEARTBEAT_EXPIRED');
  assert.equal(s.supervisor.frozen, true);
  const s2 = makeSupervisor(f, { value: 0 });
  await s2.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s2.transport });
  await assert.rejects(s2.supervisor.disconnect('controller-a'), (error) => error.code === 'CONTROLLER_HEARTBEAT_EXPIRED');
  assert.equal(s2.supervisor.frozen, true);
});

test('heartbeatはsession・単調sequence・supervisor実lease集合を照合する', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s.transport });
  await s.supervisor.heartbeat({ controllerId: 'controller-a', registrationDigest: f.registration.registration_digest, sequence: 1, leaseSetDigest: digestArtifact([]), sessionNonceDigest: D('b') });
  await assert.rejects(s.supervisor.heartbeat({ controllerId: 'controller-a', registrationDigest: f.registration.registration_digest, sequence: 1, leaseSetDigest: digestArtifact([]), sessionNonceDigest: D('b') }), (error) => error.code === 'CONTROLLER_HEARTBEAT_EXPIRED');
  assert.equal(s.supervisor.frozen, true);
});

test('holdConflictは全running停止証拠をbindしたtyped held receiptだけを返す', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s.transport });
  const held = await s.supervisor.holdConflict({ findingDigest: D('7'), frozenEventDigest: D('8'), barrierId: 'barrier-a', reason: 'observed_write_conflict', recordedAt: '2026-07-21T00:00:02.000Z' });
  assert.equal(held.schema, 'lattice.runtime_hold_result.v1');
  assert.equal(held.outcome, 'held');
  assert.deepEqual(held.quiescence_ack_digests, [f.quiescenceAck.ack_digest]);
  assert.equal(held.result_digest, selfDigest(held, 'result_digest'));
  assert.equal(s.supervisor.frozen, true);
});

test('deep run pathでもcwd anchorのrelative AF_UNIXでlisten/connectする', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-long-socket-'));
  const requestedRunDir = path.join(root, 'a'.repeat(48), 'b'.repeat(48), 'run-a');
  await mkdir(path.join(requestedRunDir, 'supervisor'), { recursive: true });
  const runDir = await realpath(requestedRunDir);
  const supervisorDir = path.join(runDir, 'supervisor');
  const originalCwd = process.cwd();
  process.chdir(runDir);
  let server;
  try {
    server = await serveRuntimeControlSocket({ socketPath: path.join(supervisorDir, 'control.sock'), handler: async (request) => {
      const result = sign({ schema: 'lattice.runtime_control_result.v1', operation: request.operation,
        outcome: 'held', event_head_digest: D('9'), control_head_digest: D('a'), active_epoch: 1,
        staged_epoch: null, unmet: [], result_digest: '' }, 'result_digest');
      const response = { schema: 'lattice.runtime_control_response.v1', request_id: request.request_id, run_id: request.run_id, outcome: 'completed', result, control_head_digest: D('a'), response_digest: '' };
      return sign(response, 'response_digest');
    } });
    const identity = await observeManagedProcessStartIdentity(process.pid);
    const descriptor = sign({ schema: 'lattice.runtime_supervisor_descriptor.v1', run_id: 'run-a', pid: process.pid, process_start_identity: identity, socket_ref: 'supervisor/control.sock', session_nonce_digest: digestArtifact('n'.repeat(64)), protocol_version: 'v1', activated_at: '2026-07-21T00:00:00.000Z', descriptor_digest: '' }, 'descriptor_digest');
    await writeFile(path.join(supervisorDir, 'descriptor.json'), `${canonicalizeArtifact(descriptor)}\n`, { mode: 0o600 });
    const payload = sign({ schema: 'lattice.runtime_control_operation.v1', operation: 'hold',
      run_ref: 'run-a', artifact_digest: null, expected_epoch: 1, expected_queue_digest: null,
      shutdown_reason: null, operation_digest: '' }, 'operation_digest');
    const request = createRuntimeControlRequest({ requestId: 'request-a', runId: 'run-a', operation: 'hold', payload, sessionNonce: 'n'.repeat(64) });
    const response = await sendRuntimeControlRequest({ socketPath: path.join(supervisorDir, 'control.sock'), request });
    assert.equal(response.outcome, 'completed');
    assert.equal(process.cwd(), runDir);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});
