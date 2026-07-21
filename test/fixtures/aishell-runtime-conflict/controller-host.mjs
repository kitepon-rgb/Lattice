#!/usr/bin/env node

import net from 'node:net';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const latticeRoot = process.argv[2];
if (!latticeRoot) throw new Error('Lattice root argument is required');

const [{ canonicalizeArtifact, digestArtifact }, { selfDigest }, protocol, supervisor] = await Promise.all([
  import(pathToFileURL(path.join(latticeRoot, 'src/artifact-contracts.mjs')).href),
  import(pathToFileURL(path.join(latticeRoot, 'src/runtime-contracts.mjs')).href),
  import(pathToFileURL(path.join(latticeRoot, 'src/runtime-controller-protocol.mjs')).href),
  import(pathToFileURL(path.join(latticeRoot, 'src/runtime-managed-supervisor.mjs')).href),
]);

const bootstrap = JSON.parse(readFileSync(3, 'utf8').trim());
const sign = (value, field) => {
  value[field] = '';
  value[field] = selfDigest(value, field);
  return value;
};
const controllerId = path.basename(bootstrap.controller_socket_ref, '.sock');
const controllerSessionNonce = 'c'.repeat(64);
const heartbeat = sign({
  schema: 'lattice.runtime_heartbeat_policy.v1',
  interval_ms: 1_000,
  ttl_ms: 60_000,
  disconnect_revokes_immediately: true,
  policy_digest: '',
}, 'policy_digest');
const capabilities = sign({
  schema: 'lattice.runtime_adapter_capabilities.v1',
  operations: [...protocol.CONTROLLER_OPERATIONS],
  process_observation: true,
  worktree_fingerprint: true,
  staged_write_lease: true,
  durable_dispatch: true,
  capabilities_digest: '',
}, 'capabilities_digest');
const identity = await supervisor.observeManagedProcessStartIdentity(process.pid);
const descriptor = sign({
  schema: 'lattice.runtime_adapter_controller_descriptor.v1',
  controller_id: controllerId,
  adapter_kind: 'scripted',
  pid: process.pid,
  process_start_identity: identity,
  socket_ref: bootstrap.controller_socket_ref,
  controller_session_nonce_digest: digestArtifact(controllerSessionNonce),
  capabilities,
  heartbeat,
  descriptor_digest: '',
}, 'descriptor_digest');

function respond(socket, response) {
  socket.write(`${canonicalizeArtifact(response)}\n`);
}

const server = net.createServer((socket) => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    const request = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (request.schema === 'lattice.adapter_controller_handshake_request.v1') {
      respond(socket, sign({
        schema: 'lattice.adapter_controller_handshake_response.v1',
        request_id: request.request_id,
        run_id: request.run_id,
        challenge_digest: digestArtifact(request.challenge),
        controller_session_nonce: controllerSessionNonce,
        descriptor,
        response_digest: '',
      }, 'response_digest'));
      return;
    }
    if (request.schema === 'lattice.adapter_running_inventory_request.v1') {
      respond(socket, sign({
        schema: 'lattice.adapter_running_inventory_response.v1',
        request_id: request.request_id,
        running_bindings: [],
        inventory_digest: digestArtifact([]),
        response_digest: '',
      }, 'response_digest'));
      return;
    }
    if (request.schema === 'lattice.adapter_barrier_request.v1') {
      respond(socket, sign({ schema: 'lattice.adapter_barrier_response.v1',
        request_id: request.request_id, barrier_id: request.barrier_id,
        quiescence_acks: [], response_digest: '' }, 'response_digest'));
      return;
    }
    if (request.schema === 'lattice.adapter_prepare_request.v1') {
      globalThis.__stagedLeases ??= new Map();
      globalThis.__stagedLeases.set(request.staged_lease.lease_digest, request.staged_lease);
      const packet = request.executor_packet;
      const ack = sign({ schema: 'lattice.adapter_prepare_ack.v1', ack_id: `prepare-${packet.todo_id}`,
        registration_digest: request.registration_digest, controller_id: controllerId,
        run_id: bootstrap.run_id, todo_id: packet.todo_id, plan_epoch: packet.plan_epoch,
        packet_digest: packet.packet_digest, staged_lease_digest: request.staged_lease.lease_digest,
        supervisor_session_nonce_digest: digestArtifact(bootstrap.supervisor_session_nonce), ack_digest: '' },
      'ack_digest');
      respond(socket, sign({ schema: 'lattice.adapter_prepare_response.v1', request_id: request.request_id,
        prepare_ack: ack, staged_lease_digest: request.staged_lease.lease_digest, response_digest: '' },
      'response_digest'));
      return;
    }
    if (request.schema === 'lattice.adapter_activate_request.v1') {
      const epoch = [...(globalThis.__stagedLeases?.values() ?? [])][0]?.plan_epoch ?? 1;
      const ack = sign({ schema: 'lattice.adapter_ready_ack.v1', ack_id: `ready-${controllerId}`,
        registration_digest: request.registration_digest, controller_id: controllerId,
        run_id: bootstrap.run_id, plan_epoch: epoch, activation_digest: request.activation_digest,
        staged_lease_digests: request.staged_lease_digests,
        supervisor_session_nonce_digest: digestArtifact(bootstrap.supervisor_session_nonce), ack_digest: '' },
      'ack_digest');
      respond(socket, sign({ schema: 'lattice.adapter_activate_response.v1', request_id: request.request_id,
        ready_ack: ack, observed_pointer_digest: request.committed_epoch_digest, response_digest: '' },
      'response_digest'));
      return;
    }
    if (request.schema === 'lattice.adapter_release_request.v1') {
      const armed = [];
      for (const digest of request.staged_lease_digests) {
        const prior = globalThis.__stagedLeases.get(digest);
        const lease = { ...prior, schema: 'lattice.runtime_write_lease.v2', state: 'armed',
          release_barrier_digest: request.release_barrier_digest,
          gate_generation: request.gate_generation, lease_digest: '' };
        lease.lease_digest = selfDigest(lease, 'lease_digest');
        armed.push(lease.lease_digest);
      }
      armed.sort();
      const epoch = [...globalThis.__stagedLeases.values()][0]?.plan_epoch ?? 1;
      const ack = sign({ schema: 'lattice.adapter_release_ack.v1', ack_id: `release-${controllerId}`,
        registration_digest: request.registration_digest, controller_id: controllerId,
        run_id: bootstrap.run_id, plan_epoch: epoch,
        release_barrier_digest: request.release_barrier_digest,
        gate_generation: request.gate_generation, armed_lease_digests: armed,
        supervisor_session_nonce_digest: digestArtifact(bootstrap.supervisor_session_nonce), ack_digest: '' },
      'ack_digest');
      respond(socket, sign({ schema: 'lattice.adapter_release_response.v1', request_id: request.request_id,
        release_ack: ack, armed_lease_digests: armed,
        observed_gate_generation: request.gate_generation, response_digest: '' }, 'response_digest'));
      return;
    }
    if (request.schema === 'lattice.adapter_revoke_request.v1') {
      respond(socket, sign({
        schema: 'lattice.adapter_revoke_response.v1',
        request_id: request.request_id,
        revoked_lease_digests: request.lease_digests,
        residual_processes: [],
        response_digest: '',
      }, 'response_digest'));
    }
  });
});

server.listen(bootstrap.controller_socket_ref);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
