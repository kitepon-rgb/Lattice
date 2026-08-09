import test from 'node:test';
import assert from 'node:assert/strict';
import { digestArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  CONTROLLER_OPERATIONS, acceptsHostDrivenEpoch, armStagedWriteLease,
  createControllerRequest, createWriteGate,
  createRuntimeControlRequest,
  validateArmedWriteLease, validateControllerDescriptor, validateControllerRequest, validateControllerResponse,
  validateControllerRegistration, validateReleaseAck, validateRuntimeControlRequest,
  validateRuntimeAdapterCapabilities, validateRuntimeControlResponse,
  validateStagedWriteLease, validateExpectedWorkerProcess,
  verifyCentralWriteGate,
} from '../src/runtime-controller-protocol.mjs';

const D = (c) => c.repeat(64);
function sign(value, field) { value[field] = ''; value[field] = selfDigest(value, field); return value; }
function controlPayload(operation = 'hold') {
  const artifact = ['finding_record', 'recompile'].includes(operation) ? { schema: `test.${operation}.v1` } : null;
  const artifactDigest = artifact === null ? (operation === 'conflict' ? D('1') : null) : digestArtifact(artifact);
  const shutdownReason = ['close', 'abandon'].includes(operation) ? 'requested' : null;
  return sign({
    schema: 'lattice.runtime_control_operation.v1', operation, run_ref: 'run-a',
    artifact, artifact_digest: artifactDigest,
    checkpoint_digest: operation === 'finding_record' ? D('4') : null,
    expected_epoch: 1, expected_queue_digest: null,
    shutdown_reason: shutdownReason, operation_digest: '',
  }, 'operation_digest');
}

test('adapter capabilities v2はhost駆動同意をexactかつ自己digest付きで検証する', () => {
  const v1 = sign({ schema: 'lattice.runtime_adapter_capabilities.v1',
    operations: [...CONTROLLER_OPERATIONS], process_observation: true,
    worktree_fingerprint: true, staged_write_lease: true, durable_dispatch: true,
    capabilities_digest: '' }, 'capabilities_digest');
  assert.equal(validateRuntimeAdapterCapabilities(v1), true);
  assert.equal(acceptsHostDrivenEpoch(v1), false);

  const v2 = sign({ ...v1, schema: 'lattice.runtime_adapter_capabilities.v2',
    host_driven_epoch: true, capabilities_digest: '' }, 'capabilities_digest');
  assert.equal(validateRuntimeAdapterCapabilities(v2), true);
  assert.equal(acceptsHostDrivenEpoch(v2), true);

  const declined = sign({ ...v2, host_driven_epoch: false,
    capabilities_digest: '' }, 'capabilities_digest');
  assert.equal(validateRuntimeAdapterCapabilities(declined), true);
  assert.equal(acceptsHostDrivenEpoch(declined), false);
  for (const invalid of [
    sign({ ...v2, host_driven_epoch: 'true', capabilities_digest: '' }, 'capabilities_digest'),
    sign({ ...v2, extra: true, capabilities_digest: '' }, 'capabilities_digest'),
    sign({ ...v1, host_driven_epoch: true, capabilities_digest: '' }, 'capabilities_digest'),
  ]) {
    assert.equal(validateRuntimeAdapterCapabilities(invalid), false);
    assert.equal(acceptsHostDrivenEpoch(invalid), false);
  }
});
function controlResult(operation = 'hold', outcome = 'held') {
  return sign({
    schema: 'lattice.runtime_control_result.v1', operation, outcome,
    event_head_digest: D('2'), control_head_digest: D('3'), active_epoch: 1,
    staged_epoch: null, unmet: [], result_digest: '',
  }, 'result_digest');
}
function fixtures() {
  const heartbeat = sign({ schema: 'lattice.runtime_heartbeat_policy.v1', interval_ms: 100, ttl_ms: 500, disconnect_revokes_immediately: true, policy_digest: '' }, 'policy_digest');
  const capabilities = sign({ schema: 'lattice.runtime_adapter_capabilities.v1', operations: [...CONTROLLER_OPERATIONS], process_observation: true, worktree_fingerprint: true, staged_write_lease: true, durable_dispatch: true, capabilities_digest: '' }, 'capabilities_digest');
  const identity = sign({ schema: 'lattice.process_start_identity.v1', platform: 'darwin', pid: 42, started_identity: 'boot:42:1', identity_digest: '' }, 'identity_digest');
  const controller = sign({ schema: 'lattice.runtime_adapter_controller_descriptor.v1', controller_id: 'controller-a', adapter_kind: 'fake', pid: 42, process_start_identity: identity, socket_ref: 'supervisor/controllers/controller-a.sock', controller_session_nonce_digest: D('a'), capabilities, heartbeat, descriptor_digest: '' }, 'descriptor_digest');
  const registration = sign({ schema: 'lattice.runtime_adapter_registration.v1', registration_id: 'registration-a', run_id: 'run-a', supervisor_session_nonce_digest: D('b'), controller_descriptor_digest: controller.descriptor_digest, registered_operations: [...CONTROLLER_OPERATIONS], registered_at: '2026-07-21T00:00:00.000Z', registration_digest: '' }, 'registration_digest');
  const staged = sign({ schema: 'lattice.runtime_write_lease.v1', lease_id: 'lease-a', run_id: 'run-a', todo_id: 'T1', plan_epoch: 2, packet_digest: D('c'), controller_registration_digest: registration.registration_digest, supervisor_session_nonce_digest: D('b'), state: 'staged', ttl_ms: 500, issued_control_digest: D('d'), lease_digest: '' }, 'lease_digest');
  const armed = armStagedWriteLease(staged, { releaseBarrierDigest: D('e'), gateGeneration: 1 });
  const ack = sign({ schema: 'lattice.adapter_release_ack.v1', ack_id: 'ack-a', registration_digest: registration.registration_digest, controller_id: 'controller-a', run_id: 'run-a', plan_epoch: 2, release_barrier_digest: D('e'), gate_generation: 1, armed_lease_digests: [armed.lease_digest], supervisor_session_nonce_digest: D('b'), ack_digest: '' }, 'ack_digest');
  const gate = createWriteGate({ runId: 'run-a', planEpoch: 2, gateGeneration: 1, releaseBarrierDigest: D('e'), releaseAcks: [ack], armedLeases: [armed], committedAt: '2026-07-21T00:00:01.000Z' });
  return { controller, registration, staged, armed, ack, gate };
}

test('controller descriptor/registrationとstaged v1→armed v2をexact検証する', () => {
  const f = fixtures();
  assert.equal(validateControllerDescriptor(f.controller), true);
  assert.equal(validateControllerRegistration(f.registration), true);
  assert.equal(validateStagedWriteLease(f.staged), true);
  assert.equal(validateArmedWriteLease(f.armed), true);
  assert.equal(validateReleaseAck(f.ack), true);
  assert.notEqual(f.staged.lease_digest, f.armed.lease_digest);
  assert.equal(f.staged.state, 'staged');
  assert.equal(f.armed.state, 'armed');
});

test('process identityはkey挿入順に依存せずfield差替えだけを拒否する', () => {
  const f = fixtures();
  const source = f.controller.process_start_identity;
  const reordered = { identity_digest: source.identity_digest, started_identity: source.started_identity, pid: source.pid, platform: source.platform, schema: source.schema };
  const descriptor = { ...f.controller, process_start_identity: reordered };
  descriptor.descriptor_digest = selfDigest(descriptor, 'descriptor_digest');
  assert.equal(validateControllerDescriptor(descriptor), true);
  const changed = structuredClone(descriptor);
  changed.process_start_identity.started_identity = 'different';
  changed.descriptor_digest = selfDigest(changed, 'descriptor_digest');
  assert.equal(validateControllerDescriptor(changed), false);
});

test('worker processは後方互換のstatic形とdynamic group宣言を受理する', () => {
  const identity = (pid) => sign({ schema: 'lattice.process_start_identity.v1',
    platform: 'darwin', pid, started_identity: `boot:${pid}`, identity_digest: '' },
  'identity_digest');
  const root = { pid: 42, process_group_id: 42, process_start_identity: identity(42) };
  assert.equal(validateExpectedWorkerProcess(root), true);
  assert.equal(validateExpectedWorkerProcess({ ...root,
    process_membership: 'dynamic_group' }), true);
  assert.equal(validateExpectedWorkerProcess({ ...root,
    process_membership: 'unknown' }), false);
});

test('controller operationのschema cross-useと余剰fieldを拒否する', () => {
  const request = createControllerRequest('observe', { request_id: 'request-a', registration_digest: D('a'), executor_handle: 'exec-a', expected_epoch: 1, expected_lease_digest: D('b') });
  assert.equal(validateControllerRequest('observe', request), true);
  assert.equal(validateControllerRequest('dispatch', request), false);
  assert.equal(validateControllerRequest('observe', { ...request, acknowledged: true }), false);
});

test('controller inventoryはsorted full running binding集合と集合digestをexact検証する', () => {
  const request = createControllerRequest('inventory', { request_id: 'inventory-a',
    registration_digest: D('a'), frozen_event_digest: D('b') });
  assert.equal(validateControllerRequest('inventory', request), true);
  const binding = { todo_id: 'T1', executor_handle: 'exec-a', worktree_id: 'wt-a',
    plan_epoch: 1, packet_digest: D('c'), write_lease_id: 'lease-a',
    controller_registration_digest: D('a') };
  const response = sign({ schema: 'lattice.adapter_running_inventory_response.v1',
    request_id: request.request_id, running_bindings: [binding],
    inventory_digest: digestArtifact([binding]), response_digest: '' }, 'response_digest');
  assert.equal(validateControllerResponse('inventory', response, request.request_id), true);
  const forged = structuredClone(response);
  forged.running_bindings[0].packet_digest = D('d');
  sign(forged, 'response_digest');
  assert.equal(validateControllerResponse('inventory', forged, request.request_id), false);
  const duplicateExecutor = structuredClone(response);
  duplicateExecutor.running_bindings.push({ ...binding, todo_id: 'T2' });
  duplicateExecutor.inventory_digest = digestArtifact(duplicateExecutor.running_bindings);
  sign(duplicateExecutor, 'response_digest');
  assert.equal(validateControllerResponse('inventory', duplicateExecutor, request.request_id), false);
});

test('runtime control requestはnested operationをexact・digest・operation binding検証する', () => {
  const request = createRuntimeControlRequest({
    requestId: 'request-a', runId: 'run-a', operation: 'hold',
    payload: controlPayload(), sessionNonce: 'n'.repeat(64),
  });
  assert.equal(validateRuntimeControlRequest(request), true);

  for (const mutate of [
    (value) => { value.payload.extra = true; },
    (value) => { value.payload.expected_epoch = 2; },
    (value) => { value.payload.operation = 'conflict'; sign(value.payload, 'operation_digest'); },
  ]) {
    const invalid = structuredClone(request);
    mutate(invalid);
    sign(invalid, 'request_digest');
    assert.equal(validateRuntimeControlRequest(invalid), false);
  }

  for (const operation of ['activate', 'finding_record', 'conflict', 'hold', 'recompile', 'reprocess', 'close', 'abandon']) {
    const valid = createRuntimeControlRequest({ requestId: `request-${operation}`, runId: 'run-a',
      operation, payload: controlPayload(operation), sessionNonce: 'n'.repeat(64) });
    assert.equal(validateRuntimeControlRequest(valid), true);
  }
  const closeWithoutReason = { ...controlPayload('close'), shutdown_reason: null };
  sign(closeWithoutReason, 'operation_digest');
  assert.throws(() => createRuntimeControlRequest({ requestId: 'request-close', runId: 'run-a',
    operation: 'close', payload: closeWithoutReason, sessionNonce: 'n'.repeat(64) }),
  /INVALID_RUNTIME_CONTROL_REQUEST/);
  for (const reason of ['', ' padded ', 'C1\u0085', 'line\u2028break', 'bidi\u202efake', 'あ'.repeat(257)]) {
    const invalidAbandon = { ...controlPayload('abandon'), shutdown_reason: reason };
    sign(invalidAbandon, 'operation_digest');
    assert.throws(() => createRuntimeControlRequest({ requestId: 'request-abandon', runId: 'run-a',
      operation: 'abandon', payload: invalidAbandon, sessionNonce: 'n'.repeat(64) }),
    /INVALID_RUNTIME_CONTROL_REQUEST/);
  }
  const holdWithArtifact = { ...controlPayload('hold'), artifact_digest: D('5') };
  sign(holdWithArtifact, 'operation_digest');
  assert.throws(() => createRuntimeControlRequest({ requestId: 'request-hold', runId: 'run-a',
    operation: 'hold', payload: holdWithArtifact, sessionNonce: 'n'.repeat(64) }),
  /INVALID_RUNTIME_CONTROL_REQUEST/);
});

test('finding/recompile artifactはbounded canonical本文とdigestをsocket request内でexact束縛する', () => {
  for (const operation of ['finding_record', 'recompile']) {
    const payload = controlPayload(operation);
    const request = createRuntimeControlRequest({ requestId: `request-${operation}`,
      runId: 'run-a', operation, payload, sessionNonce: 'n'.repeat(64) });
    assert.equal(validateRuntimeControlRequest(request), true);
    const changed = structuredClone(request);
    changed.payload.artifact.extra = true;
    sign(changed.payload, 'operation_digest'); sign(changed, 'request_digest');
    assert.equal(validateRuntimeControlRequest(changed), false);
    const cross = structuredClone(request);
    cross.operation = 'hold'; cross.payload.operation = 'hold';
    sign(cross.payload, 'operation_digest'); sign(cross, 'request_digest');
    assert.equal(validateRuntimeControlRequest(cross), false);
  }
});

test('runtime control responseはnested resultをexact・digest・control head binding検証する', () => {
  const result = controlResult();
  const response = sign({
    schema: 'lattice.runtime_control_response.v1', request_id: 'request-a', run_id: 'run-a',
    outcome: 'completed', result, control_head_digest: result.control_head_digest,
    response_digest: '',
  }, 'response_digest');
  assert.equal(validateRuntimeControlResponse(response, 'hold'), true);

  for (const mutate of [
    (value) => { value.result.extra = true; },
    (value) => { value.result.active_epoch = 2; },
    (value) => { value.control_head_digest = D('4'); },
  ]) {
    const invalid = structuredClone(response);
    mutate(invalid);
    sign(invalid, 'response_digest');
    assert.equal(validateRuntimeControlResponse(invalid), false);
  }

  const rejected = structuredClone(response);
  rejected.outcome = 'rejected';
  sign(rejected, 'response_digest');
  assert.equal(validateRuntimeControlResponse(rejected, 'hold'), false);

  const wrongOperation = structuredClone(response);
  wrongOperation.result.operation = 'conflict';
  sign(wrongOperation.result, 'result_digest');
  sign(wrongOperation, 'response_digest');
  assert.equal(validateRuntimeControlResponse(wrongOperation, 'hold'), false);

  const wrongOutcome = structuredClone(response);
  wrongOutcome.result.outcome = 'activated';
  sign(wrongOutcome.result, 'result_digest');
  sign(wrongOutcome, 'response_digest');
  assert.equal(validateRuntimeControlResponse(wrongOutcome, 'hold'), false);
});

test('中央gate verifierはfull descriptor/registration/ack/lease chainだけを許可する', () => {
  const f = fixtures();
  const valid = verifyCentralWriteGate({ gate: f.gate, runId: 'run-a', planEpoch: 2, releaseBarrierDigest: D('e'), sessionNonceDigest: D('b'), registrations: [f.registration], controllers: [f.controller], releaseAcks: [f.ack], armedLeases: [f.armed] });
  assert.deepEqual(valid, { valid: true, gate_digest: f.gate.gate_digest });
  const summaryRegistration = { registration_digest: f.registration.registration_digest };
  assert.equal(verifyCentralWriteGate({ gate: f.gate, runId: 'run-a', planEpoch: 2, releaseBarrierDigest: D('e'), sessionNonceDigest: D('b'), registrations: [summaryRegistration], controllers: [f.controller], releaseAcks: [f.ack], armedLeases: [f.armed] }).valid, false);
  const stale = structuredClone(f.armed); stale.supervisor_session_nonce_digest = D('f'); sign(stale, 'lease_digest');
  assert.equal(verifyCentralWriteGate({ gate: f.gate, runId: 'run-a', planEpoch: 2, releaseBarrierDigest: D('e'), sessionNonceDigest: D('b'), registrations: [f.registration], controllers: [f.controller], releaseAcks: [f.ack], armedLeases: [stale] }).valid, false);
});

test('release ackのlease余剰・別controller流用をfail closedにする', () => {
  const f = fixtures();
  const forged = structuredClone(f.ack); forged.armed_lease_digests = [D('0'), f.armed.lease_digest].sort(); sign(forged, 'ack_digest');
  const gate = createWriteGate({ runId: 'run-a', planEpoch: 2, gateGeneration: 1, releaseBarrierDigest: D('e'), releaseAcks: [forged], armedLeases: [f.armed], committedAt: '2026-07-21T00:00:01.000Z' });
  assert.equal(verifyCentralWriteGate({ gate, runId: 'run-a', planEpoch: 2, releaseBarrierDigest: D('e'), sessionNonceDigest: D('b'), registrations: [f.registration], controllers: [f.controller], releaseAcks: [forged], armedLeases: [f.armed] }).valid, false);
});
