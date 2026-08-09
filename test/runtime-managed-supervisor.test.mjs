import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { canonicalizeArtifact, digestArtifact } from '../src/artifact-contracts.mjs';
import { buildNextRunEvent } from '../src/runtime-engine.mjs';
import {
  RuntimeManagedSupervisor,
  observeManagedProcessStartIdentity,
  runtimeManagedSupervisorInternal,
  sendRuntimeControlRequest,
  serveRuntimeControlSocket,
} from '../src/runtime-managed-supervisor.mjs';
import { CONTROLLER_OPERATIONS, armStagedWriteLease, createRuntimeControlRequest } from '../src/runtime-controller-protocol.mjs';

const D = (c) => c.repeat(64);
function sign(value, field) { value[field] = ''; value[field] = selfDigest(value, field); return value; }
function controllerHeartbeat(sequence) {
  return sign({
    schema: 'lattice.adapter_controller_heartbeat.v1',
    controller_id: 'controller-a',
    registration_digest: D('a'),
    supervisor_session_nonce: 'n'.repeat(64),
    sequence,
    lease_set_digest: D('b'),
    heartbeat_digest: '',
  }, 'heartbeat_digest');
}
function dispatchResponse(requestId) {
  const identity = sign({
    schema: 'lattice.process_start_identity.v1',
    platform: 'darwin',
    pid: 42,
    started_identity: 'boot:42:1',
    identity_digest: '',
  }, 'identity_digest');
  return sign({
    schema: 'lattice.adapter_dispatch_response.v2',
    request_id: requestId,
    executor_handle: 'exec-a',
    worktree_id: 'wt-a',
    packet_digest: D('c'),
    lease_digest: D('d'),
    worker_process: { pid: 42, process_group_id: 42, process_start_identity: identity },
    response_digest: '',
  }, 'response_digest');
}

async function controllerTransportFixture(t, onRequest) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-controller-transport-'));
  const socketPath = path.join(root, 'controller.sock');
  const sockets = new Set();
  const timers = new Set();
  const schedule = (handler, delay, repeat = false) => {
    const timer = repeat ? setInterval(handler, delay) : setTimeout(handler, delay);
    timers.add(timer);
    return timer;
  };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        onRequest({ socket, request, schedule });
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  const transport = runtimeManagedSupervisorInternal.createControllerSocketTransport(
    socketPath,
    60,
    100,
  );
  await transport.ensureConnected();
  t.after(async () => {
    transport.close();
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return transport;
}

test('dispatch待機は検証済みheartbeatでTTLを更新し固定request timeoutを越える', async (t) => {
  let sequence = 0;
  const transport = await controllerTransportFixture(t, ({ socket, request, schedule }) => {
    schedule(() => {
      sequence += 1;
      socket.write(`${canonicalizeArtifact(controllerHeartbeat(sequence))}\n`);
    }, 20, true);
    schedule(() => {
      socket.write(`${canonicalizeArtifact(dispatchResponse(request.request_id))}\n`);
    }, 230);
  });
  let validatedSequence = 0;
  transport.setHeartbeatHandler(async (heartbeat) => {
    assert.equal(heartbeat.sequence, validatedSequence + 1);
    validatedSequence = heartbeat.sequence;
  });
  const started = Date.now();
  const responseArtifact = await transport.request('dispatch', { request_id: 'dispatch-a' });
  assert.equal(responseArtifact.executor_handle, 'exec-a');
  assert.ok(Date.now() - started >= 180);
  assert.ok(validatedSequence >= 5);
});

test('非dispatchはheartbeat中も固定request timeoutを維持する', async (t) => {
  let sequence = 0;
  const transport = await controllerTransportFixture(t, ({ socket, schedule }) => {
    schedule(() => {
      sequence += 1;
      socket.write(`${canonicalizeArtifact(controllerHeartbeat(sequence))}\n`);
    }, 20, true);
  });
  transport.setHeartbeatHandler(async () => {});
  await assert.rejects(
    transport.request('inventory', { request_id: 'inventory-a' }),
    (error) => error.code === 'ADAPTER_CONTROLLER_UNAVAILABLE'
      && /inventory timeout/u.test(error.message),
  );
});

test('dispatchはheartbeat停止・検証失敗・socket切断をtyped failureにする', async (t) => {
  await t.test('heartbeat停止', async (subtest) => {
    const transport = await controllerTransportFixture(subtest, () => {});
    transport.setHeartbeatHandler(async () => {});
    await assert.rejects(
      transport.request('dispatch', { request_id: 'dispatch-stopped' }),
      (error) => error.code === 'ADAPTER_CONTROLLER_UNAVAILABLE'
        && /dispatch timeout/u.test(error.message),
    );
  });
  await t.test('heartbeat検証失敗', async (subtest) => {
    const transport = await controllerTransportFixture(
      subtest,
      ({ socket, schedule }) => schedule(() => {
        socket.write(`${canonicalizeArtifact(controllerHeartbeat(1))}\n`);
      }, 20),
    );
    transport.setHeartbeatHandler(() => {
      throw new Error('heartbeat binding不正');
    });
    await assert.rejects(
      transport.request('dispatch', { request_id: 'dispatch-invalid-heartbeat' }),
      (error) => error.code === 'ADAPTER_CONTROLLER_UNAVAILABLE',
    );
  });
  await t.test('socket切断', async (subtest) => {
    const transport = await controllerTransportFixture(
      subtest,
      ({ socket, schedule }) => schedule(() => socket.destroy(), 20),
    );
    transport.setHeartbeatHandler(async () => {});
    await assert.rejects(
      transport.request('dispatch', { request_id: 'dispatch-disconnected' }),
      (error) => error.code === 'ADAPTER_CONTROLLER_UNAVAILABLE'
        && /disconnected/u.test(error.message),
    );
  });
});
function fixture() {
  const heartbeat = sign({ schema: 'lattice.runtime_heartbeat_policy.v1', interval_ms: 100, ttl_ms: 500, disconnect_revokes_immediately: true, policy_digest: '' }, 'policy_digest');
  const capabilities = sign({ schema: 'lattice.runtime_adapter_capabilities.v1', operations: [...CONTROLLER_OPERATIONS], process_observation: true, worktree_fingerprint: true, staged_write_lease: true, durable_dispatch: true, capabilities_digest: '' }, 'capabilities_digest');
  const identity = sign({ schema: 'lattice.process_start_identity.v1', platform: 'darwin', pid: 42, started_identity: 'boot:42:1', identity_digest: '' }, 'identity_digest');
  const descriptor = sign({ schema: 'lattice.runtime_adapter_controller_descriptor.v1', controller_id: 'controller-a', adapter_kind: 'fake', pid: 42, process_start_identity: identity, socket_ref: 'supervisor/controllers/controller-a.sock', controller_session_nonce_digest: D('a'), capabilities, heartbeat, descriptor_digest: '' }, 'descriptor_digest');
  const registration = sign({ schema: 'lattice.runtime_adapter_registration.v1', registration_id: 'registration-a', run_id: 'run-a', supervisor_session_nonce_digest: D('b'), controller_descriptor_digest: descriptor.descriptor_digest, registered_operations: [...CONTROLLER_OPERATIONS], registered_at: '2026-07-21T00:00:00.000Z', registration_digest: '' }, 'registration_digest');
  const binding = { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', plan_epoch: 1, packet_digest: D('c'), write_lease_id: 'old-lease', controller_registration_digest: registration.registration_digest };
  const observation = { schema: 'test.process_observation.v1', quiesced: true };
  const worktreeFingerprint = { schema: 'test.worktree_fingerprint.v1', checkpoint_digest: D('e') };
  const checkpoint = { schema: 'test.checkpoint.v1', checkpoint_digest: D('e') };
  const directObservation = { quiesced: true,
    process_observation_digest: digestArtifact(observation),
    worktree_fingerprint_digest: digestArtifact(worktreeFingerprint),
    final_checkpoint_digest: checkpoint.checkpoint_digest, observation, worktree_fingerprint: worktreeFingerprint,
    checkpoint, write_enabled: false };
  const quiescenceAck = sign({ schema: 'lattice.executor_quiescence_ack.v1', ack_id: 'quiet-a', run_id: 'run-a', todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', plan_epoch: 1, packet_digest: D('c'), write_lease_id: 'old-lease', barrier_control_digest: D('d'), final_checkpoint_digest: directObservation.final_checkpoint_digest, process_observation_digest: directObservation.process_observation_digest, worktree_fingerprint_digest: directObservation.worktree_fingerprint_digest, supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
  const staged = sign({ schema: 'lattice.runtime_write_lease.v1', lease_id: 'new-lease', run_id: 'run-a', todo_id: 'T1', plan_epoch: 2, packet_digest: D('2'), controller_registration_digest: registration.registration_digest, supervisor_session_nonce_digest: D('b'), state: 'staged', ttl_ms: 500, issued_control_digest: D('3'), lease_digest: '' }, 'lease_digest');
  const rebindPacket = sign({ schema: 'lattice.epoch_rebind_packet.v1', packet_id: 'rebind-packet-a', todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', witness_digest: D('4'), context_content_digest: D('5'), authorized_checkpoint_digest: D('6'), old_plan_ref: 'plan-v1', new_plan_ref: 'plan-v2', new_plan_epoch: 2, packet_digest: '' }, 'packet_digest');
  const rebindAck = sign({ schema: 'lattice.executor_epoch_rebind_ack.v1', ack_id: 'rebind-a', run_id: 'run-a', todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', predecessor_epoch: 1, successor_epoch: 2, predecessor_packet_digest: D('c'), rebind_packet_digest: rebindPacket.packet_digest, new_write_lease_id: 'new-lease', supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
  return { descriptor, registration, binding, quiescenceAck, directObservation,
    staged, rebindPacket, rebindAck };
}

function response(operation, request, f) {
  if (operation === 'inventory') return sign({ schema: 'lattice.adapter_running_inventory_response.v1', request_id: request.request_id, running_bindings: [], inventory_digest: digestArtifact([]), response_digest: '' }, 'response_digest');
  if (operation === 'barrier') return sign({ schema: 'lattice.adapter_barrier_response.v1', request_id: request.request_id, barrier_id: request.barrier_id, quiescence_acks: [f.quiescenceAck], response_digest: '' }, 'response_digest');
  if (operation === 'rebind') return sign({ schema: 'lattice.adapter_rebind_response.v1', request_id: request.request_id, rebind_ack: f.rebindAck, staged_lease_digest: f.staged.lease_digest, response_digest: '' }, 'response_digest');
  if (operation === 'prepare') {
    const ack = sign({ schema: 'lattice.adapter_prepare_ack.v1',
      ack_id: `prepare-${request.executor_packet.todo_id}`,
      registration_digest: f.registration.registration_digest,
      controller_id: f.descriptor.controller_id, run_id: 'run-a',
      todo_id: request.executor_packet.todo_id,
      plan_epoch: request.executor_packet.plan_epoch,
      packet_digest: request.executor_packet.packet_digest,
      staged_lease_digest: request.staged_lease.lease_digest,
      supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
    return sign({ schema: 'lattice.adapter_prepare_response.v1', request_id: request.request_id,
      prepare_ack: ack, staged_lease_digest: request.staged_lease.lease_digest,
      response_digest: '' }, 'response_digest');
  }
  if (operation === 'activate') {
    const readyAck = sign({ schema: 'lattice.adapter_ready_ack.v1', ack_id: 'ready-a', registration_digest: f.registration.registration_digest, controller_id: 'controller-a', run_id: 'run-a', plan_epoch: f.staged.plan_epoch, activation_digest: request.activation_digest, staged_lease_digests: request.staged_lease_digests, supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
    return sign({ schema: 'lattice.adapter_activate_response.v1', request_id: request.request_id, ready_ack: readyAck, observed_pointer_digest: request.committed_epoch_digest, response_digest: '' }, 'response_digest');
  }
  if (operation === 'release') {
    const armed = armStagedWriteLease(f.staged, { releaseBarrierDigest: request.release_barrier_digest, gateGeneration: request.gate_generation });
    f.releaseAck = sign({ schema: 'lattice.adapter_release_ack.v1', ack_id: 'release-a', registration_digest: f.registration.registration_digest, controller_id: 'controller-a', run_id: 'run-a', plan_epoch: f.staged.plan_epoch, release_barrier_digest: request.release_barrier_digest, gate_generation: request.gate_generation, armed_lease_digests: [armed.lease_digest], supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
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
      ? structuredClone(f.directObservation)
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

test('対象barrierは競合群だけを止め、無関係なrunning bindingを残す', async () => {
  const f = fixture();
  const unaffected = { ...f.binding, todo_id: 'T2', executor_handle: 'exec-b',
    worktree_id: 'wt-b', packet_digest: D('2'), write_lease_id: 'old-lease-b' };
  let inventoryCount = 0;
  let barrierTodoIds = [];
  const supervisor = new RuntimeManagedSupervisor({
    runId: 'run-a', sessionNonceDigest: D('b'), clock: () => 0,
    processObserver: async () => structuredClone(f.directObservation),
    runningBindingResolver: async () => [f.binding, unaffected],
    journal: { append: async (event) => event.kind === 'barrier_requested' ? D('d') : D('9') },
    gateWriter: { commit: async () => {} },
  });
  const transport = { request: async (operation, request) => {
    if (operation === 'inventory') {
      const bindings = inventoryCount++ === 0 ? [f.binding, unaffected] : [unaffected];
      return sign({ schema: 'lattice.adapter_running_inventory_response.v1',
        request_id: request.request_id, running_bindings: bindings,
        inventory_digest: digestArtifact(bindings), response_digest: '' }, 'response_digest');
    }
    if (operation === 'barrier') {
      barrierTodoIds = request.running_bindings.map((binding) => binding.todo_id);
    }
    return response(operation, request, f);
  } };
  await supervisor.registerController({ descriptor: f.descriptor,
    registration: f.registration, transport });
  const acks = await supervisor.barrierSelected({ barrierId: 'barrier-selected',
    reason: 'conflict', frozenEventDigest: D('8'), todoIds: ['T1'] });
  assert.deepEqual(acks.map((ack) => ack.todo_id), ['T1']);
  assert.deepEqual(barrierTodoIds, ['T1']);
  assert.equal(supervisor.frozen, true);
});

test('restart barrierはdurable storeと複数controller inventoryのrunning和集合を全件停止する', async () => {
  const f = fixture();
  const second = fixture();
  second.descriptor.controller_id = 'controller-b';
  second.descriptor.pid = 43;
  second.descriptor.process_start_identity.pid = 43;
  sign(second.descriptor.process_start_identity, 'identity_digest');
  second.descriptor.socket_ref = 'supervisor/controllers/controller-b.sock';
  sign(second.descriptor, 'descriptor_digest');
  second.registration.registration_id = 'registration-b';
  second.registration.controller_descriptor_digest = second.descriptor.descriptor_digest;
  sign(second.registration, 'registration_digest');
  second.binding = { ...second.binding, todo_id: 'T2', executor_handle: 'exec-b',
    worktree_id: 'wt-b', packet_digest: D('2'), write_lease_id: 'old-lease-b',
    controller_registration_digest: second.registration.registration_digest };
  Object.assign(second.quiescenceAck, { todo_id: 'T2', executor_handle: 'exec-b',
    worktree_id: 'wt-b', packet_digest: D('2'), write_lease_id: 'old-lease-b' });
  sign(second.quiescenceAck, 'ack_digest');
  const events = [];
  const barrierOwnership = new Map();
  const supervisor = new RuntimeManagedSupervisor({ runId: 'run-a', sessionNonceDigest: D('b'), clock: () => 0,
    processObserver: async ({ binding }) => structuredClone(binding.todo_id === 'T1' ? f.directObservation : second.directObservation),
    runningBindingResolver: async () => [f.binding],
    journal: { append: async (event) => { events.push(event); return event.kind === 'barrier_requested' ? D('d') : D('9'); } },
    gateWriter: { commit: async () => {} } });
  const transportFor = (ownedFixture, directInventory) => {
    let inventoryCount = 0;
    return { request: async (operation, request) => {
      if (operation === 'inventory') {
        inventoryCount += 1;
        const bindings = inventoryCount === 1 ? directInventory : [];
        return sign({ schema: 'lattice.adapter_running_inventory_response.v1', request_id: request.request_id,
          running_bindings: bindings, inventory_digest: digestArtifact(bindings), response_digest: '' }, 'response_digest');
      }
      if (operation === 'barrier') barrierOwnership.set(ownedFixture.descriptor.controller_id,
        request.running_bindings.map((binding) => ({ todo_id: binding.todo_id,
          registration_digest: binding.controller_registration_digest })));
      return response(operation, request, ownedFixture);
    } };
  };
  await supervisor.registerController({ descriptor: f.descriptor, registration: f.registration,
    transport: transportFor(f, []) });
  await supervisor.registerController({ descriptor: second.descriptor, registration: second.registration,
    transport: transportFor(second, [second.binding]) });
  const acks = await supervisor.recoveryBarrier({ barrierId: 'barrier-restart', frozenEventDigest: D('8') });
  assert.deepEqual(acks.map((ack) => ack.todo_id).sort(), ['T1', 'T2']);
  const barrier = events.find((event) => event.kind === 'barrier_requested');
  assert.deepEqual(barrier.payload.running_todo_ids, ['T1', 'T2']);
  assert.deepEqual(barrierOwnership.get('controller-a'), [{ todo_id: 'T1',
    registration_digest: f.registration.registration_digest }]);
  assert.deepEqual(barrierOwnership.get('controller-b'), [{ todo_id: 'T2',
    registration_digest: second.registration.registration_digest }]);
});

test('controller inventoryがdurable bindingと不一致又はbarrier後に残存すればfail closed', async () => {
  const make = (inventorySequence) => {
    const f = fixture(); let inventoryCount = 0;
    const supervisor = new RuntimeManagedSupervisor({ runId: 'run-a', sessionNonceDigest: D('b'), clock: () => 0,
      processObserver: async () => structuredClone(f.directObservation), runningBindingResolver: async () => [f.binding],
      journal: { append: async (event) => event.kind === 'barrier_requested' ? D('d') : D('9') },
      gateWriter: { commit: async () => {} } });
    const transport = { request: async (operation, request) => {
      if (operation !== 'inventory') return response(operation, request, f);
      const bindings = inventorySequence[inventoryCount++] ?? [];
      return sign({ schema: 'lattice.adapter_running_inventory_response.v1', request_id: request.request_id,
        running_bindings: bindings, inventory_digest: digestArtifact(bindings), response_digest: '' }, 'response_digest');
    } };
    return { f, supervisor, transport };
  };
  const mismatchedFixture = fixture();
  const mismatched = { ...mismatchedFixture.binding, packet_digest: D('0') };
  const first = make([[mismatched]]);
  await first.supervisor.registerController({ descriptor: first.f.descriptor, registration: first.f.registration, transport: first.transport });
  await assert.rejects(first.supervisor.recoveryBarrier({ barrierId: 'barrier-mismatch', frozenEventDigest: D('8') }),
    (error) => error.code === 'HOLD_ACKS_INCOMPLETE');

  const residualFixture = fixture();
  const extraResidual = { ...residualFixture.binding, todo_id: 'T2', executor_handle: 'exec-extra',
    worktree_id: 'wt-extra', write_lease_id: 'lease-extra' };
  const second = make([[], [extraResidual]]);
  await second.supervisor.registerController({ descriptor: second.f.descriptor, registration: second.f.registration, transport: second.transport });
  await assert.rejects(second.supervisor.recoveryBarrier({ barrierId: 'barrier-residual', frozenEventDigest: D('8') }),
    (error) => error.code === 'HOLD_ACKS_INCOMPLETE');

  const unknownFixture = fixture();
  const unknown = { ...unknownFixture.binding, todo_id: 'T2', executor_handle: 'exec-unknown',
    worktree_id: 'wt-unknown', write_lease_id: 'lease-unknown', controller_registration_digest: D('f') };
  const third = make([[unknown]]);
  await third.supervisor.registerController({ descriptor: third.f.descriptor, registration: third.f.registration, transport: third.transport });
  await assert.rejects(third.supervisor.recoveryBarrier({ barrierId: 'barrier-unknown', frozenEventDigest: D('8') }),
    (error) => error.code === 'HOLD_ACKS_INCOMPLETE');
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
  const rebindEvidence = await s.supervisor.rebindController({ controllerId: 'controller-a', rebindPacket: f.rebindPacket, stagedLease: f.staged, expected: { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a', predecessor_packet_digest: D('c'), rebind_packet_digest: f.rebindPacket.packet_digest } });
  const acknowledged = s.events.find((event) => event.kind === 'epoch_rebind_acknowledged');
  assert.equal(rebindEvidence.ack.rebind_packet_digest, f.rebindPacket.packet_digest);
  assert.equal(rebindEvidence.control_event_digest, D('9'));
  assert.equal(acknowledged.payload.ack_digest, rebindEvidence.ack.ack_digest);
  assert.equal(acknowledged.payload.staged_lease_digest, f.staged.lease_digest);
  assert.equal(f.staged.controller_registration_digest, f.registration.registration_digest);
  const runEvents = [buildNextRunEvent({ events: [], runId: 'run-a', kind: 'run_initialized',
    planEpoch: 1, subject: { kind: 'run', ref: 'run-a' }, payload: {},
    recordedAt: '2026-07-21T00:00:00.000Z' })];
  const reboundEvent = buildNextRunEvent({ events: runEvents, runId: 'run-a', kind: 'epoch_rebound',
    planEpoch: 2, subject: { kind: 'todo', ref: 'T1' }, payload: { ...f.rebindPacket,
      rebind_ack_digest: rebindEvidence.ack.ack_digest,
      control_event_digest: rebindEvidence.control_event_digest,
      controller_registration_digest: f.registration.registration_digest },
    recordedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(reboundEvent.payload.rebind_ack_digest, acknowledged.payload.ack_digest);
  assert.equal(reboundEvent.payload.control_event_digest, rebindEvidence.control_event_digest);
  assert.equal(reboundEvent.payload.controller_registration_digest, f.registration.registration_digest);
  await assert.rejects(s.supervisor.authorizeWrite({ leaseDigest: f.staged.lease_digest }), (error) => error.code === 'RUN_FROZEN');
  let releaseBarrier;
  const committed = await s.supervisor.commitWriteGate({ planEpoch: 2,
    committedEpochDigest: D('4'), activationDigest: D('6'),
    commitReleaseBarrier: async (barrier) => { releaseBarrier = barrier;
      return { release_digest: barrier.release_digest }; },
    committedAt: '2026-07-21T00:00:01.000Z' });
  assert.equal(releaseBarrier.schema, 'lattice.release_epoch_barrier.v1');
  assert.deepEqual(releaseBarrier.controller_ready_ack_digests, [releaseBarrier.controller_ready_ack_digests[0]]);
  assert.equal(s.gates.length, 1);
  assert.equal(s.supervisor.frozen, false);
  now.value = 1;
  assert.equal((await s.supervisor.authorizeWrite({ leaseDigest: committed.armedLeases[0].lease_digest })).state, 'armed');
});

test('部分replan後も対象外TODOのorigin leaseを元gateで認可できる', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor,
    registration: f.registration, transport: s.transport });
  await s.supervisor.barrierAll({ barrierId: 'barrier-first', reason: 'initial',
    frozenEventDigest: D('8') });
  await s.supervisor.rebindController({ controllerId: 'controller-a',
    rebindPacket: f.rebindPacket, stagedLease: f.staged,
    expected: { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a',
      predecessor_packet_digest: D('c'), rebind_packet_digest: f.rebindPacket.packet_digest } });
  const first = await s.supervisor.commitWriteGate({ planEpoch: 2,
    committedEpochDigest: D('4'), activationDigest: D('6'),
    commitReleaseBarrier: async (barrier) => ({ release_digest: barrier.release_digest }),
    committedAt: '2026-07-21T00:00:01.000Z' });
  const originLease = first.armedLeases[0];

  await s.supervisor.barrierSelected({ barrierId: 'barrier-second', reason: 'other-conflict',
    frozenEventDigest: D('8'), todoIds: ['T2'] });
  f.rebindPacket = sign({ schema: 'lattice.epoch_rebind_packet.v1',
    packet_id: 'rebind-packet-second', todo_id: 'T1', executor_handle: 'exec-a',
    worktree_id: 'wt-a', witness_digest: D('4'), context_content_digest: D('5'),
    authorized_checkpoint_digest: D('6'), old_plan_ref: 'plan-v2',
    new_plan_ref: 'plan-v3', new_plan_epoch: 3, packet_digest: '' }, 'packet_digest');
  f.staged = sign({ schema: 'lattice.runtime_write_lease.v1', lease_id: 'lease-t2',
    run_id: 'run-a', todo_id: 'T1', plan_epoch: 3,
    packet_digest: f.rebindPacket.packet_digest,
    controller_registration_digest: f.registration.registration_digest,
    supervisor_session_nonce_digest: D('b'), state: 'staged', ttl_ms: 500,
    issued_control_digest: D('3'), lease_digest: '' }, 'lease_digest');
  f.rebindAck = sign({ schema: 'lattice.executor_epoch_rebind_ack.v1',
    ack_id: 'rebind-second', run_id: 'run-a', todo_id: 'T1', executor_handle: 'exec-a',
    worktree_id: 'wt-a', predecessor_epoch: 2, successor_epoch: 3,
    predecessor_packet_digest: D('c'), rebind_packet_digest: f.rebindPacket.packet_digest,
    new_write_lease_id: f.staged.lease_id, supervisor_session_nonce_digest: D('b'),
    ack_digest: '' }, 'ack_digest');
  await s.supervisor.rebindController({ controllerId: 'controller-a',
    rebindPacket: f.rebindPacket, stagedLease: f.staged,
    expected: { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a',
      predecessor_packet_digest: D('c'), rebind_packet_digest: f.rebindPacket.packet_digest } });
  await s.supervisor.commitWriteGate({ planEpoch: 3,
    committedEpochDigest: D('5'), activationDigest: D('7'),
    commitReleaseBarrier: async (barrier) => ({ release_digest: barrier.release_digest }),
    committedAt: '2026-07-21T00:00:02.000Z' });

  assert.equal((await s.supervisor.authorizeWrite({
    leaseDigest: originLease.lease_digest })).lease_digest, originLease.lease_digest);
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

test('heartbeatはsessionと単調sequenceを照合する', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  await s.supervisor.registerController({ descriptor: f.descriptor, registration: f.registration, transport: s.transport });
  await s.supervisor.heartbeat({ controllerId: 'controller-a', registrationDigest: f.registration.registration_digest, sequence: 1, leaseSetDigest: digestArtifact([]), sessionNonceDigest: D('b') });
  await assert.rejects(s.supervisor.heartbeat({ controllerId: 'controller-a', registrationDigest: f.registration.registration_digest, sequence: 1, leaseSetDigest: digestArtifact([]), sessionNonceDigest: D('b') }), (error) => error.code === 'CONTROLLER_HEARTBEAT_EXPIRED');
  assert.equal(s.supervisor.frozen, true);
});

test('同じlease集合のheartbeatとrunning pollはjournalを増やさない', async () => {
  const f = fixture(); const now = { value: 0 }; const s = makeSupervisor(f, now);
  const observationResponse = (request, state) => {
    const observation = sign({ schema: 'lattice.adapter_observation.v1', state,
      executor_handle: request.executor_handle, plan_epoch: request.expected_epoch,
      lease_digest: request.expected_lease_digest, payload_digest: D('7'),
      observation_digest: '' }, 'observation_digest');
    return sign({ schema: 'lattice.adapter_observe_response.v1',
      request_id: request.request_id, observation,
      observation_digest: observation.observation_digest, response_digest: '' },
    'response_digest');
  };
  let observationState = 'running';
  s.transport.request = async (operation, request) => operation === 'observe'
    ? observationResponse(request, observationState) : response(operation, request, f);
  await s.supervisor.registerController({ descriptor: f.descriptor,
    registration: f.registration, transport: s.transport });

  const unchanged = digestArtifact([]);
  const changed = digestArtifact([D('1')]);
  await s.supervisor.heartbeat({ controllerId: 'controller-a',
    registrationDigest: f.registration.registration_digest, sequence: 1,
    leaseSetDigest: unchanged, sessionNonceDigest: D('b') });
  now.value = 100;
  await s.supervisor.heartbeat({ controllerId: 'controller-a',
    registrationDigest: f.registration.registration_digest, sequence: 2,
    leaseSetDigest: unchanged, sessionNonceDigest: D('b') });
  now.value = 200;
  await s.supervisor.heartbeat({ controllerId: 'controller-a',
    registrationDigest: f.registration.registration_digest, sequence: 3,
    leaseSetDigest: changed, sessionNonceDigest: D('b') });
  assert.deepEqual(s.events.filter((event) => event.kind === 'controller_heartbeat')
    .map((event) => event.payload.sequence), [1, 3]);

  const observeFields = { executor_handle: 'exec-a', expected_epoch: 1,
    expected_lease_digest: D('c') };
  await s.supervisor.route('observe', 'controller-a', observeFields);
  await s.supervisor.route('observe', 'controller-a', observeFields);
  assert.equal(s.events.some((event) => event.kind === 'observation_routed'), false);

  for (const nonRunningState of ['checkpoint_ready', 'held', 'terminal']) {
    observationState = nonRunningState;
    await s.supervisor.route('observe', 'controller-a', observeFields);
  }
  assert.equal(s.events.filter((event) => event.kind === 'observation_routed').length, 3);
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
      run_ref: 'run-a', artifact: null, artifact_digest: null, checkpoint_digest: null,
      expected_epoch: 1, expected_queue_digest: null,
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
