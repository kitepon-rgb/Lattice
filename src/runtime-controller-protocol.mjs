import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';
import {
  selfDigest,
  validRuntimeAbandonReason,
  validateEpochRebindPacket,
  validateExecutorPacket,
} from './runtime-contracts.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const CONTROLLER_ERROR_SCHEMAS = new Set([
  'lattice.scripted_adapter_error.v1',
  'lattice.work_order_adapter_error.v1',
]);

export const CONTROLLER_OPERATIONS = Object.freeze([
  'dispatch', 'observe', 'inventory', 'barrier', 'rebind', 'prepare', 'activate', 'release', 'revoke',
]);

const RUNTIME_CONTROL_OUTCOMES = Object.freeze({
  activate: 'activated',
  finding_record: 'recorded',
  conflict: 'frozen',
  hold: 'held',
  recompile: 'recompiled',
  reprocess: 'reprocessed',
  close: 'closed',
  abandon: 'abandoned',
});
const ARTIFACT_CONTROL_OPERATIONS = new Set(['finding_record', 'recompile']);
const DIGEST_REFERENCE_OPERATIONS = new Set(['conflict']);
const MAX_CONTROL_ARTIFACT_BYTES = 8_388_608;

const WIRES = Object.freeze({
  dispatch: {
    request: ['schema', 'request_id', 'registration_digest', 'packet', 'write_lease', 'request_digest'],
    requestSchema: 'lattice.adapter_dispatch_request.v1',
    response: ['schema', 'request_id', 'executor_handle', 'worktree_id', 'packet_digest', 'lease_digest', 'worker_process', 'response_digest'],
    responseSchema: 'lattice.adapter_dispatch_response.v2',
  },
  observe: {
    request: ['schema', 'request_id', 'registration_digest', 'executor_handle', 'expected_epoch', 'expected_lease_digest', 'request_digest'],
    requestSchema: 'lattice.adapter_observe_request.v1',
    response: ['schema', 'request_id', 'observation', 'observation_digest', 'response_digest'],
    responseSchema: 'lattice.adapter_observe_response.v1',
  },
  inventory: {
    request: ['schema', 'request_id', 'registration_digest', 'frozen_event_digest', 'request_digest'],
    requestSchema: 'lattice.adapter_running_inventory_request.v1',
    response: ['schema', 'request_id', 'running_bindings', 'inventory_digest', 'response_digest'],
    responseSchema: 'lattice.adapter_running_inventory_response.v1',
  },
  barrier: {
    request: ['schema', 'request_id', 'registration_digest', 'barrier_id', 'reason', 'running_bindings', 'frozen_event_digest', 'barrier_control_digest', 'request_digest'],
    requestSchema: 'lattice.adapter_barrier_request.v1',
    response: ['schema', 'request_id', 'barrier_id', 'quiescence_acks', 'response_digest'],
    responseSchema: 'lattice.adapter_barrier_response.v1',
  },
  rebind: {
    request: ['schema', 'request_id', 'registration_digest', 'rebind_packet', 'staged_lease', 'request_digest'],
    requestSchema: 'lattice.adapter_rebind_request.v1',
    response: ['schema', 'request_id', 'rebind_ack', 'staged_lease_digest', 'response_digest'],
    responseSchema: 'lattice.adapter_rebind_response.v1',
  },
  prepare: {
    request: ['schema', 'request_id', 'registration_digest', 'executor_packet', 'staged_lease', 'request_digest'],
    requestSchema: 'lattice.adapter_prepare_request.v1',
    response: ['schema', 'request_id', 'prepare_ack', 'staged_lease_digest', 'response_digest'],
    responseSchema: 'lattice.adapter_prepare_response.v1',
  },
  activate: {
    request: ['schema', 'request_id', 'registration_digest', 'committed_epoch_digest', 'activation_digest', 'staged_lease_digests', 'request_digest'],
    requestSchema: 'lattice.adapter_activate_request.v1',
    response: ['schema', 'request_id', 'ready_ack', 'observed_pointer_digest', 'response_digest'],
    responseSchema: 'lattice.adapter_activate_response.v1',
  },
  release: {
    request: ['schema', 'request_id', 'registration_digest', 'release_barrier_digest', 'activation_digest', 'gate_generation', 'staged_lease_digests', 'request_digest'],
    requestSchema: 'lattice.adapter_release_request.v1',
    response: ['schema', 'request_id', 'release_ack', 'armed_lease_digests', 'observed_gate_generation', 'response_digest'],
    responseSchema: 'lattice.adapter_release_response.v1',
  },
  revoke: {
    request: ['schema', 'request_id', 'registration_digest', 'reason', 'lease_digests', 'request_digest'],
    requestSchema: 'lattice.adapter_revoke_request.v1',
    response: ['schema', 'request_id', 'revoked_lease_digests', 'residual_processes', 'response_digest'],
    responseSchema: 'lattice.adapter_revoke_response.v1',
  },
});

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function digest(value) { return typeof value === 'string' && SHA256.test(value); }
function identifier(value) { return typeof value === 'string' && ID.test(value); }
function uniqueSortedDigests(value) {
  return Array.isArray(value) && value.length <= 256 && value.every(digest)
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}
function selfValid(value, field) {
  try { return digest(value[field]) && selfDigest(value, field) === value[field]; } catch { return false; }
}

/** controller実装が返す既知errorを、request bindingを含めて検証する。 */
export function validateControllerError(value, expectedRequestId = null) {
  return exact(value, ['schema', 'code', 'message', 'request_id', 'detail', 'error_digest'])
    && CONTROLLER_ERROR_SCHEMAS.has(value.schema)
    && identifier(value.code)
    && typeof value.message === 'string' && value.message.length > 0
    && identifier(value.request_id)
    && (expectedRequestId === null || value.request_id === expectedRequestId)
    && plain(value.detail)
    && selfValid(value, 'error_digest');
}

export function validateRuntimeHeartbeatPolicy(value) {
  return exact(value, ['schema', 'interval_ms', 'ttl_ms', 'disconnect_revokes_immediately', 'policy_digest'])
    && value.schema === 'lattice.runtime_heartbeat_policy.v1'
    && Number.isSafeInteger(value.interval_ms) && value.interval_ms > 0
    && Number.isSafeInteger(value.ttl_ms) && value.ttl_ms > value.interval_ms
    && value.disconnect_revokes_immediately === true
    && selfValid(value, 'policy_digest');
}

export function validateControllerHeartbeat(value) {
  return exact(value, ['schema', 'controller_id', 'registration_digest', 'supervisor_session_nonce', 'sequence', 'lease_set_digest', 'heartbeat_digest'])
    && value.schema === 'lattice.adapter_controller_heartbeat.v1'
    && identifier(value.controller_id) && digest(value.registration_digest)
    && typeof value.supervisor_session_nonce === 'string' && value.supervisor_session_nonce.length >= 32
    && Number.isSafeInteger(value.sequence) && value.sequence > 0 && digest(value.lease_set_digest)
    && selfValid(value, 'heartbeat_digest');
}

export function validateRuntimeAdapterCapabilities(value) {
  const fields = ['schema', 'operations', 'process_observation', 'worktree_fingerprint',
    'staged_write_lease', 'durable_dispatch', 'capabilities_digest'];
  if (value?.schema === 'lattice.runtime_adapter_capabilities.v2') {
    fields.push('host_driven_epoch');
  }
  return exact(value, fields)
    && ['lattice.runtime_adapter_capabilities.v1',
      'lattice.runtime_adapter_capabilities.v2'].includes(value.schema)
    && Array.isArray(value.operations) && value.operations.length === CONTROLLER_OPERATIONS.length
    && value.operations.every((op, i) => op === CONTROLLER_OPERATIONS[i])
    && value.process_observation === true && value.worktree_fingerprint === true
    && value.staged_write_lease === true && value.durable_dispatch === true
    && (value.schema !== 'lattice.runtime_adapter_capabilities.v2'
      || typeof value.host_driven_epoch === 'boolean')
    && selfValid(value, 'capabilities_digest');
}

/** hostがmanaged epochを駆動してよいとcontroller自身が宣言した能力だけを採る。 */
export function acceptsHostDrivenEpoch(value) {
  return validateRuntimeAdapterCapabilities(value)
    && value.schema === 'lattice.runtime_adapter_capabilities.v2'
    && value.host_driven_epoch === true;
}

export function validateProcessStartIdentity(value) {
  return exact(value, ['schema', 'platform', 'pid', 'started_identity', 'identity_digest'])
    && value.schema === 'lattice.process_start_identity.v1'
    && typeof value.platform === 'string' && value.platform.length > 0
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.started_identity === 'string' && value.started_identity.length > 0
    && selfValid(value, 'identity_digest');
}

export function validateControllerDescriptor(value) {
  return exact(value, ['schema', 'controller_id', 'adapter_kind', 'pid', 'process_start_identity', 'socket_ref', 'controller_session_nonce_digest', 'capabilities', 'heartbeat', 'descriptor_digest'])
    && value.schema === 'lattice.runtime_adapter_controller_descriptor.v1'
    && identifier(value.controller_id) && identifier(value.adapter_kind)
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && validateProcessStartIdentity(value.process_start_identity)
    && value.process_start_identity.pid === value.pid
    && value.socket_ref === `supervisor/controllers/${value.controller_id}.sock`
    && digest(value.controller_session_nonce_digest)
    && validateRuntimeAdapterCapabilities(value.capabilities)
    && validateRuntimeHeartbeatPolicy(value.heartbeat)
    && selfValid(value, 'descriptor_digest');
}

export function validateControllerRegistration(value) {
  return exact(value, ['schema', 'registration_id', 'run_id', 'supervisor_session_nonce_digest', 'controller_descriptor_digest', 'registered_operations', 'registered_at', 'registration_digest'])
    && value.schema === 'lattice.runtime_adapter_registration.v1'
    && identifier(value.registration_id) && identifier(value.run_id)
    && digest(value.supervisor_session_nonce_digest) && digest(value.controller_descriptor_digest)
    && Array.isArray(value.registered_operations)
    && value.registered_operations.length === CONTROLLER_OPERATIONS.length
    && value.registered_operations.every((op, i) => op === CONTROLLER_OPERATIONS[i])
    && typeof value.registered_at === 'string' && !Number.isNaN(Date.parse(value.registered_at))
    && selfValid(value, 'registration_digest');
}

export function validateAdapterRegistry(value) {
  return exact(value, ['schema', 'entries', 'registry_digest'])
    && value.schema === 'lattice.runtime_adapter_registry.v1'
    && Array.isArray(value.entries) && value.entries.length > 0 && value.entries.length <= 256
    && value.entries.every((entry) => exact(entry, ['adapter_kind', 'launch_descriptor_ref', 'launch_descriptor_digest'])
      && identifier(entry.adapter_kind) && typeof entry.launch_descriptor_ref === 'string'
      && entry.launch_descriptor_ref === `.lattice/runtime/adapter-registry/descriptors/${entry.adapter_kind}.json`
      && digest(entry.launch_descriptor_digest))
    && new Set(value.entries.map((entry) => entry.adapter_kind)).size === value.entries.length
    && value.entries.every((entry, index) => index === 0 || value.entries[index - 1].adapter_kind < entry.adapter_kind)
    && selfValid(value, 'registry_digest');
}

function nullableDigest(value) { return value === null || digest(value); }
export function validateAdapterLaunchDescriptor(value) {
  if (!exact(value, ['schema', 'adapter_kind', 'launch_kind', 'binary_path', 'binary_digest', 'binary_identity', 'argv', 'config_ref', 'config_digest', 'endpoint', 'capabilities_digest', 'descriptor_digest'])
    || value.schema !== 'lattice.runtime_adapter_launch_descriptor.v1'
    || !identifier(value.adapter_kind) || !['host_binary', 'existing_endpoint'].includes(value.launch_kind)
    || !Array.isArray(value.argv) || value.argv.length > 64 || !value.argv.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
    || !digest(value.capabilities_digest) || !selfValid(value, 'descriptor_digest')) return false;
  if (value.launch_kind === 'host_binary') {
    return typeof value.binary_path === 'string' && value.binary_path.startsWith('/')
      && digest(value.binary_digest) && value.endpoint === null
      && (value.binary_identity === null || (exact(value.binary_identity, ['schema', 'kind', 'cdhash', 'signing_identifier', 'team_identifier', 'designated_requirement_digest', 'identity_digest'])
        && value.binary_identity.schema === 'lattice.macos_binary_identity.v1'
        && value.binary_identity.kind === 'macos_codesign'
        && [value.binary_identity.cdhash, value.binary_identity.designated_requirement_digest].every(digest)
        && typeof value.binary_identity.signing_identifier === 'string'
        && typeof value.binary_identity.team_identifier === 'string'
        && selfValid(value.binary_identity, 'identity_digest')))
      && typeof value.config_ref === 'string' && value.config_ref.length > 0 && digest(value.config_digest);
  }
  return value.binary_path === null && value.binary_digest === null && value.binary_identity === null
    && value.argv.length === 0 && value.config_ref === null && value.config_digest === null
    && typeof value.endpoint === 'string' && value.endpoint.length > 0;
}

export function createControllerBootstrap({ requestId, runId, controllerSocketRef, supervisorSocketRef, supervisorSessionNonce }) {
  const value = { schema: 'lattice.adapter_controller_bootstrap.v1', request_id: requestId, run_id: runId, controller_socket_ref: controllerSocketRef, supervisor_socket_ref: supervisorSocketRef, supervisor_session_nonce: supervisorSessionNonce, bootstrap_digest: '' };
  value.bootstrap_digest = selfDigest(value, 'bootstrap_digest');
  return value;
}

export function validateControllerHandshakeResponse(value, { requestId, challenge, runId }) {
  return exact(value, ['schema', 'request_id', 'run_id', 'challenge_digest', 'controller_session_nonce', 'descriptor', 'response_digest'])
    && value.schema === 'lattice.adapter_controller_handshake_response.v1'
    && value.request_id === requestId && value.run_id === runId
    && value.challenge_digest === digestArtifact(challenge)
    && typeof value.controller_session_nonce === 'string' && value.controller_session_nonce.length >= 32
    && validateControllerDescriptor(value.descriptor)
    && value.descriptor.controller_session_nonce_digest === digestArtifact(value.controller_session_nonce)
    && selfValid(value, 'response_digest');
}

export function validateRuntimeControlRequest(value) {
  return exact(value, ['schema', 'request_id', 'run_id', 'operation', 'payload', 'session_nonce', 'request_digest'])
    && value.schema === 'lattice.runtime_control_request.v1'
    && identifier(value.request_id) && identifier(value.run_id)
    && ['activate', 'finding_record', 'conflict', 'hold', 'recompile', 'reprocess', 'close', 'abandon'].includes(value.operation)
    && validateRuntimeControlOperation(value.payload)
    && value.payload.operation === value.operation
    && typeof value.session_nonce === 'string' && value.session_nonce.length >= 32
    && selfValid(value, 'request_digest');
}

function validateRuntimeControlOperation(value) {
  return exact(value, ['schema', 'operation', 'run_ref', 'artifact', 'artifact_digest', 'checkpoint_digest',
    'expected_epoch', 'expected_queue_digest', 'shutdown_reason', 'operation_digest'])
    && value.schema === 'lattice.runtime_control_operation.v1'
    && ['activate', 'finding_record', 'conflict', 'hold', 'recompile', 'reprocess', 'close', 'abandon'].includes(value.operation)
    && typeof value.run_ref === 'string' && value.run_ref.length > 0
    && (ARTIFACT_CONTROL_OPERATIONS.has(value.operation)
      ? plain(value.artifact)
        && Buffer.byteLength(canonicalizeArtifact(value.artifact), 'utf8') <= MAX_CONTROL_ARTIFACT_BYTES
        && digest(value.artifact_digest) && digestArtifact(value.artifact) === value.artifact_digest
      : value.artifact === null)
    && (DIGEST_REFERENCE_OPERATIONS.has(value.operation)
      ? digest(value.artifact_digest)
      : (ARTIFACT_CONTROL_OPERATIONS.has(value.operation) || value.artifact_digest === null))
    && (value.operation === 'finding_record'
      ? digest(value.checkpoint_digest) : value.checkpoint_digest === null)
    && Number.isSafeInteger(value.expected_epoch) && value.expected_epoch > 0
    && nullableDigest(value.expected_queue_digest)
    && (value.operation === 'abandon'
      ? validRuntimeAbandonReason(value.shutdown_reason)
      : value.operation === 'close'
        ? typeof value.shutdown_reason === 'string' && value.shutdown_reason.length > 0
        : value.shutdown_reason === null)
    && selfValid(value, 'operation_digest');
}

export function createRuntimeControlRequest({ requestId, runId, operation, payload, sessionNonce }) {
  const request = { schema: 'lattice.runtime_control_request.v1', request_id: requestId, run_id: runId, operation, payload, session_nonce: sessionNonce, request_digest: '' };
  request.request_digest = selfDigest(request, 'request_digest');
  if (!validateRuntimeControlRequest(request)) throw new TypeError('INVALID_RUNTIME_CONTROL_REQUEST');
  return request;
}

export function validateRuntimeControlResponse(value, expectedOperation = null) {
  return exact(value, ['schema', 'request_id', 'run_id', 'outcome', 'result', 'control_head_digest', 'response_digest'])
    && value.schema === 'lattice.runtime_control_response.v1'
    && identifier(value.request_id) && identifier(value.run_id)
    && ['completed', 'rejected', 'unknown'].includes(value.outcome)
    && validateRuntimeControlResult(value.result)
    && (expectedOperation === null || value.result.operation === expectedOperation)
    && value.result.control_head_digest === value.control_head_digest
    && (value.outcome === 'completed'
      ? value.result.outcome === RUNTIME_CONTROL_OUTCOMES[value.result.operation]
      : value.result.outcome === value.outcome)
    && nullableDigest(value.control_head_digest)
    && selfValid(value, 'response_digest');
}

function validateRuntimeControlResult(value) {
  const fields = ['schema', 'operation', 'outcome', 'event_head_digest', 'control_head_digest',
    'active_epoch', 'staged_epoch', 'unmet', 'result_digest'];
  if (value?.operation === 'finding_record' && value?.outcome === 'recorded') fields.push('finding_digest');
  return exact(value, fields)
    && value.schema === 'lattice.runtime_control_result.v1'
    && Object.hasOwn(RUNTIME_CONTROL_OUTCOMES, value.operation)
    && [RUNTIME_CONTROL_OUTCOMES[value.operation], 'rejected', 'unknown'].includes(value.outcome)
    && nullableDigest(value.event_head_digest) && nullableDigest(value.control_head_digest)
    && Number.isSafeInteger(value.active_epoch) && value.active_epoch > 0
    && (value.staged_epoch === null
      || (Number.isSafeInteger(value.staged_epoch) && value.staged_epoch > 0))
    && Array.isArray(value.unmet) && value.unmet.length <= 256
    && value.unmet.every((entry) => typeof entry === 'string' && entry.length > 0)
    && (value.operation !== 'finding_record' || value.outcome !== 'recorded'
      || digest(value.finding_digest))
    && selfValid(value, 'result_digest');
}

export function createControllerRequest(operation, fields) {
  const wire = WIRES[operation];
  if (!wire) throw new TypeError('UNKNOWN_CONTROLLER_OPERATION');
  const request = { schema: wire.requestSchema, ...fields, request_digest: '' };
  request.request_digest = selfDigest(request, 'request_digest');
  if (!validateControllerRequest(operation, request)) throw new TypeError('INVALID_CONTROLLER_REQUEST');
  return request;
}

export function validateControllerRequest(operation, value) {
  const wire = WIRES[operation];
  if (!(Boolean(wire) && exact(value, wire.request) && value.schema === wire.requestSchema
    && identifier(value.request_id) && digest(value.registration_digest)
    && selfValid(value, 'request_digest'))) return false;
  if (operation === 'dispatch') return validateExecutorPacket(value.packet) && validateArmedWriteLease(value.write_lease);
  if (operation === 'observe') return identifier(value.executor_handle) && Number.isSafeInteger(value.expected_epoch)
    && value.expected_epoch > 0 && digest(value.expected_lease_digest);
  if (operation === 'inventory') return digest(value.frozen_event_digest);
  if (operation === 'barrier') return identifier(value.barrier_id) && typeof value.reason === 'string'
    && value.reason.length > 0 && Array.isArray(value.running_bindings)
    && value.running_bindings.every(validateProtocolRunningBinding) && digest(value.frozen_event_digest)
    && digest(value.barrier_control_digest);
  if (operation === 'rebind') return validateEpochRebindPacket(value.rebind_packet) && validateStagedWriteLease(value.staged_lease);
  if (operation === 'prepare') return validateExecutorPacket(value.executor_packet) && validateStagedWriteLease(value.staged_lease);
  if (operation === 'activate') return digest(value.committed_epoch_digest) && digest(value.activation_digest)
    && uniqueSortedDigests(value.staged_lease_digests);
  if (operation === 'release') return digest(value.release_barrier_digest) && digest(value.activation_digest)
    && Number.isSafeInteger(value.gate_generation) && value.gate_generation > 0
    && uniqueSortedDigests(value.staged_lease_digests);
  return typeof value.reason === 'string' && value.reason.length > 0 && uniqueSortedDigests(value.lease_digests);
}

export function validateControllerResponse(operation, value, expectedRequestId = null) {
  const wire = WIRES[operation];
  if (!(Boolean(wire) && exact(value, wire.response) && value.schema === wire.responseSchema
    && identifier(value.request_id) && (expectedRequestId === null || value.request_id === expectedRequestId)
    && selfValid(value, 'response_digest'))) return false;
  // v2で`worker_process`を必須にした。executorがcontroller自身のprocessだと、holdが
  // 要求する静止を証明できない（止めれば応答できず、止めなければ証明できない）。
  // 誰を止めればよいかをdispatchの時点で名指しさせる。
  if (operation === 'dispatch') return identifier(value.executor_handle) && identifier(value.worktree_id)
    && digest(value.packet_digest) && digest(value.lease_digest)
    && validateExpectedWorkerProcess(value.worker_process);
  if (operation === 'observe') return exact(value.observation, ['schema', 'state', 'executor_handle', 'plan_epoch', 'lease_digest', 'payload_digest', 'observation_digest'])
    && value.observation.schema === 'lattice.adapter_observation.v1'
    && ['running', 'checkpoint_ready', 'terminal', 'held'].includes(value.observation.state)
    && identifier(value.observation.executor_handle) && Number.isSafeInteger(value.observation.plan_epoch)
    && value.observation.plan_epoch > 0 && digest(value.observation.lease_digest)
    && digest(value.observation.payload_digest) && selfValid(value.observation, 'observation_digest')
    && value.observation_digest === value.observation.observation_digest;
  if (operation === 'inventory') return Array.isArray(value.running_bindings)
    && value.running_bindings.length <= 4096
    && value.running_bindings.every(validateProtocolRunningBinding)
    && value.running_bindings.every((binding, index) => index === 0
      || value.running_bindings[index - 1].todo_id < binding.todo_id)
    && new Set(value.running_bindings.map((binding) => binding.executor_handle)).size === value.running_bindings.length
    && digest(value.inventory_digest)
    && value.inventory_digest === digestArtifact(value.running_bindings);
  if (operation === 'barrier') return identifier(value.barrier_id) && Array.isArray(value.quiescence_acks)
    && value.quiescence_acks.every(validateQuiescenceAck);
  if (operation === 'rebind') return validateEpochRebindAck(value.rebind_ack) && digest(value.staged_lease_digest);
  if (operation === 'prepare') return validatePrepareAck(value.prepare_ack)
    && value.prepare_ack.staged_lease_digest === value.staged_lease_digest;
  if (operation === 'activate') return validateReadyAck(value.ready_ack)
    && digest(value.observed_pointer_digest);
  if (operation === 'release') return validateReleaseAck(value.release_ack)
    && uniqueSortedDigests(value.armed_lease_digests)
    && Number.isSafeInteger(value.observed_gate_generation) && value.observed_gate_generation > 0;
  return uniqueSortedDigests(value.revoked_lease_digests) && Array.isArray(value.residual_processes)
    && value.residual_processes.every((entry) => exact(entry, ['schema', 'pid', 'process_start_identity_digest', 'state'])
      && entry.schema === 'lattice.adapter_residual_process.v1'
      && Number.isSafeInteger(entry.pid) && entry.pid > 0 && digest(entry.process_start_identity_digest)
      && ['running', 'stopped', 'unknown'].includes(entry.state));
}

function validatePrepareAck(value) {
  return exact(value, ['schema', 'ack_id', 'registration_digest', 'controller_id', 'run_id', 'todo_id', 'plan_epoch', 'packet_digest', 'staged_lease_digest', 'supervisor_session_nonce_digest', 'ack_digest'])
    && value.schema === 'lattice.adapter_prepare_ack.v1'
    && ['ack_id', 'controller_id', 'run_id', 'todo_id'].every((key) => identifier(value[key]))
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0
    && ['registration_digest', 'packet_digest', 'staged_lease_digest', 'supervisor_session_nonce_digest'].every((key) => digest(value[key]))
    && selfValid(value, 'ack_digest');
}

function validateReadyAck(value) {
  return exact(value, ['schema', 'ack_id', 'registration_digest', 'controller_id', 'run_id', 'plan_epoch', 'activation_digest', 'staged_lease_digests', 'supervisor_session_nonce_digest', 'ack_digest'])
    && value.schema === 'lattice.adapter_ready_ack.v1'
    && ['ack_id', 'controller_id', 'run_id'].every((key) => identifier(value[key]))
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0
    && ['registration_digest', 'activation_digest', 'supervisor_session_nonce_digest'].every((key) => digest(value[key]))
    && uniqueSortedDigests(value.staged_lease_digests) && selfValid(value, 'ack_digest');
}

function validateProtocolRunningBinding(value) {
  return exact(value, ['todo_id', 'executor_handle', 'worktree_id', 'plan_epoch', 'packet_digest', 'write_lease_id', 'controller_registration_digest'])
    && identifier(value.todo_id) && identifier(value.executor_handle) && identifier(value.worktree_id)
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0 && digest(value.packet_digest)
    && identifier(value.write_lease_id) && digest(value.controller_registration_digest);
}

/**
 * dispatchが名指しするworker process。直接OS観測が期待するchild processと同じ形にする
 * ——照合先の形が分かれると、supervisorとcontrollerが別のものを見ていても気づけない。
 */
function validateExpectedWorkerProcessLeaf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0')
      === ['pid', 'process_group_id', 'process_start_identity'].sort().join('\0')
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && Number.isSafeInteger(value.process_group_id) && value.process_group_id > 0
    && validateProcessStartIdentity(value.process_start_identity)
    && value.process_start_identity.pid === value.pid;
}

export function validateExpectedWorkerProcess(value) {
  if (validateExpectedWorkerProcessLeaf(value)) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0')
      !== ['pid', 'process_group_id', 'process_start_identity', 'process_membership'].sort().join('\0')
    || !validateExpectedWorkerProcessLeaf({
      pid: value.pid,
      process_group_id: value.process_group_id,
      process_start_identity: value.process_start_identity,
    })
    || value.process_membership !== 'dynamic_group') return false;
  return true;
}

export function validateQuiescenceAck(value) {
  return exact(value, ['schema', 'ack_id', 'run_id', 'todo_id', 'executor_handle', 'worktree_id', 'plan_epoch', 'packet_digest', 'write_lease_id', 'barrier_control_digest', 'final_checkpoint_digest', 'process_observation_digest', 'worktree_fingerprint_digest', 'supervisor_session_nonce_digest', 'ack_digest'])
    && value.schema === 'lattice.executor_quiescence_ack.v1'
    && ['ack_id', 'run_id', 'todo_id', 'executor_handle', 'worktree_id', 'write_lease_id'].every((key) => identifier(value[key]))
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0
    && ['packet_digest', 'barrier_control_digest', 'final_checkpoint_digest', 'process_observation_digest', 'worktree_fingerprint_digest', 'supervisor_session_nonce_digest'].every((key) => digest(value[key]))
    && selfValid(value, 'ack_digest');
}

export function validateEpochRebindAck(value) {
  return exact(value, ['schema', 'ack_id', 'run_id', 'todo_id', 'executor_handle', 'worktree_id', 'predecessor_epoch', 'successor_epoch', 'predecessor_packet_digest', 'rebind_packet_digest', 'new_write_lease_id', 'supervisor_session_nonce_digest', 'ack_digest'])
    && value.schema === 'lattice.executor_epoch_rebind_ack.v1'
    && ['ack_id', 'run_id', 'todo_id', 'executor_handle', 'worktree_id', 'new_write_lease_id'].every((key) => identifier(value[key]))
    && Number.isSafeInteger(value.predecessor_epoch) && value.predecessor_epoch > 0
    && value.successor_epoch === value.predecessor_epoch + 1
    && ['predecessor_packet_digest', 'rebind_packet_digest', 'supervisor_session_nonce_digest'].every((key) => digest(value[key]))
    && selfValid(value, 'ack_digest');
}

export function validateStagedWriteLease(value) {
  return exact(value, ['schema', 'lease_id', 'run_id', 'todo_id', 'plan_epoch', 'packet_digest', 'controller_registration_digest', 'supervisor_session_nonce_digest', 'state', 'ttl_ms', 'issued_control_digest', 'lease_digest'])
    && value.schema === 'lattice.runtime_write_lease.v1' && value.state === 'staged'
    && ['lease_id', 'run_id', 'todo_id'].every((key) => identifier(value[key]))
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0
    && Number.isSafeInteger(value.ttl_ms) && value.ttl_ms > 0
    && ['packet_digest', 'controller_registration_digest', 'supervisor_session_nonce_digest', 'issued_control_digest'].every((key) => digest(value[key]))
    && selfValid(value, 'lease_digest');
}

export function validateArmedWriteLease(value) {
  return exact(value, ['schema', 'lease_id', 'run_id', 'todo_id', 'plan_epoch', 'packet_digest', 'controller_registration_digest', 'supervisor_session_nonce_digest', 'state', 'ttl_ms', 'issued_control_digest', 'release_barrier_digest', 'gate_generation', 'lease_digest'])
    && value.schema === 'lattice.runtime_write_lease.v2' && value.state === 'armed'
    && ['lease_id', 'run_id', 'todo_id'].every((key) => identifier(value[key]))
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0
    && Number.isSafeInteger(value.ttl_ms) && value.ttl_ms > 0
    && Number.isSafeInteger(value.gate_generation) && value.gate_generation > 0
    && ['packet_digest', 'controller_registration_digest', 'supervisor_session_nonce_digest', 'issued_control_digest', 'release_barrier_digest'].every((key) => digest(value[key]))
    && selfValid(value, 'lease_digest');
}

export function armStagedWriteLease(staged, { releaseBarrierDigest, gateGeneration }) {
  if (!validateStagedWriteLease(staged) || !digest(releaseBarrierDigest)
    || !Number.isSafeInteger(gateGeneration) || gateGeneration < 1) throw new TypeError('INVALID_STAGED_LEASE_ARM');
  const armed = { ...staged, schema: 'lattice.runtime_write_lease.v2', state: 'armed', release_barrier_digest: releaseBarrierDigest, gate_generation: gateGeneration };
  armed.lease_digest = selfDigest(armed, 'lease_digest');
  return armed;
}

export function validateReleaseAck(value) {
  return exact(value, ['schema', 'ack_id', 'registration_digest', 'controller_id', 'run_id', 'plan_epoch', 'release_barrier_digest', 'gate_generation', 'armed_lease_digests', 'supervisor_session_nonce_digest', 'ack_digest'])
    && value.schema === 'lattice.adapter_release_ack.v1'
    && ['ack_id', 'controller_id', 'run_id'].every((key) => identifier(value[key]))
    && ['registration_digest', 'release_barrier_digest', 'supervisor_session_nonce_digest'].every((key) => digest(value[key]))
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch > 0
    && Number.isSafeInteger(value.gate_generation) && value.gate_generation > 0
    && uniqueSortedDigests(value.armed_lease_digests)
    && selfValid(value, 'ack_digest');
}

export function createWriteGate({ runId, planEpoch, gateGeneration, releaseBarrierDigest, releaseAcks, armedLeases, previousGateDigest = null, committedAt }) {
  const gate = {
    schema: 'lattice.supervisor_write_gate.v1', run_id: runId, plan_epoch: planEpoch,
    gate_generation: gateGeneration, release_barrier_digest: releaseBarrierDigest,
    controller_release_ack_digests: releaseAcks.map((ack) => ack.ack_digest).sort(),
    armed_lease_digests: armedLeases.map((lease) => lease.lease_digest).sort(),
    previous_gate_digest: previousGateDigest, committed_at: committedAt, gate_digest: '',
  };
  gate.gate_digest = selfDigest(gate, 'gate_digest');
  return gate;
}

export function verifyCentralWriteGate({ gate, runId, planEpoch, releaseBarrierDigest, sessionNonceDigest, registrations, controllers, releaseAcks, armedLeases, previousGate = null }) {
  const fail = (reason) => ({ valid: false, reason });
  if (!exact(gate, ['schema', 'run_id', 'plan_epoch', 'gate_generation', 'release_barrier_digest', 'controller_release_ack_digests', 'armed_lease_digests', 'previous_gate_digest', 'committed_at', 'gate_digest'])
    || gate.schema !== 'lattice.supervisor_write_gate.v1' || !selfValid(gate, 'gate_digest')) return fail('gate_invalid');
  if (gate.run_id !== runId || gate.plan_epoch !== planEpoch || gate.release_barrier_digest !== releaseBarrierDigest) return fail('gate_binding_mismatch');
  if (gate.gate_generation !== (previousGate?.gate_generation ?? 0) + 1
    || gate.previous_gate_digest !== (previousGate?.gate_digest ?? null)) return fail('gate_chain_mismatch');
  if (!Array.isArray(registrations) || !Array.isArray(controllers) || registrations.length !== controllers.length
    || releaseAcks.length !== registrations.length) return fail('controller_set_mismatch');
  const controllerByDigest = new Map();
  for (const controller of controllers) {
    if (!validateControllerDescriptor(controller) || controllerByDigest.has(controller.descriptor_digest)) return fail('controller_invalid');
    controllerByDigest.set(controller.descriptor_digest, controller);
  }
  const registrationByDigest = new Map();
  for (const registration of registrations) {
    const controller = controllerByDigest.get(registration.controller_descriptor_digest);
    if (!validateControllerRegistration(registration) || !controller || registration.run_id !== runId
      || registration.supervisor_session_nonce_digest !== sessionNonceDigest
      || registrationByDigest.has(registration.registration_digest)) return fail('registration_invalid');
    registrationByDigest.set(registration.registration_digest, { registration, controller });
  }
  const leaseByDigest = new Map();
  for (const lease of armedLeases) {
    if (!validateArmedWriteLease(lease) || lease.run_id !== runId || lease.plan_epoch !== planEpoch
      || lease.supervisor_session_nonce_digest !== sessionNonceDigest
      || lease.release_barrier_digest !== releaseBarrierDigest || lease.gate_generation !== gate.gate_generation
      || !registrationByDigest.has(lease.controller_registration_digest) || leaseByDigest.has(lease.lease_digest)) return fail('lease_invalid');
    leaseByDigest.set(lease.lease_digest, lease);
  }
  const seenRegistrations = new Set();
  const ackLeaseUnion = new Set();
  for (const ack of releaseAcks) {
    const binding = registrationByDigest.get(ack.registration_digest);
    if (!validateReleaseAck(ack) || !binding || seenRegistrations.has(ack.registration_digest)
      || binding.controller.controller_id !== ack.controller_id || ack.run_id !== runId
      || ack.plan_epoch !== planEpoch || ack.release_barrier_digest !== releaseBarrierDigest
      || ack.gate_generation !== gate.gate_generation || ack.supervisor_session_nonce_digest !== sessionNonceDigest) return fail('release_ack_invalid');
    seenRegistrations.add(ack.registration_digest);
    for (const leaseDigest of ack.armed_lease_digests) {
      const lease = leaseByDigest.get(leaseDigest);
      if (!lease || lease.controller_registration_digest !== ack.registration_digest || ackLeaseUnion.has(leaseDigest)) return fail('release_ack_lease_invalid');
      ackLeaseUnion.add(leaseDigest);
    }
  }
  const expectedAcks = releaseAcks.map((ack) => ack.ack_digest).sort();
  const expectedLeases = [...leaseByDigest.keys()].sort();
  if (JSON.stringify(gate.controller_release_ack_digests) !== JSON.stringify(expectedAcks)
    || JSON.stringify(gate.armed_lease_digests) !== JSON.stringify(expectedLeases)
    || JSON.stringify([...ackLeaseUnion].sort()) !== JSON.stringify(expectedLeases)) return fail('gate_membership_mismatch');
  return { valid: true, gate_digest: gate.gate_digest };
}

export function controllerProtocolDigest(value) { return digestArtifact(value); }
