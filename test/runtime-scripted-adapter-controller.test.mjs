import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeTest from 'node:test';

const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { validateControllerHandshakeResponse } from '../src/runtime-controller-protocol.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  createScriptedAdapterController,
  ScriptedAdapterControllerError,
} from '../src/runtime-scripted-adapter-controller.mjs';

function sign(value, field) {
  value[field] = '';
  value[field] = selfDigest(value, field);
  return value;
}

test('scripted controller handshakeはbootstrap challengeとprocess identityへexact bindする', async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-scripted-unit-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const runDir = path.join(repoRoot, '.lattice', 'runs', 'run-a');
  await mkdir(path.join(runDir, 'supervisor', 'controllers'), { recursive: true });
  const bootstrap = sign({
    schema: 'lattice.adapter_controller_bootstrap.v1',
    request_id: 'bootstrap-a',
    run_id: 'run-a',
    controller_socket_ref: 'supervisor/controllers/scripted-test.sock',
    supervisor_socket_ref: 'supervisor/control.sock',
    supervisor_session_nonce: 's'.repeat(64),
    bootstrap_digest: '',
  }, 'bootstrap_digest');
  const controller = await createScriptedAdapterController({
    bootstrap,
    runDir,
    repoRoot,
    controllerSessionNonce: 'c'.repeat(64),
  });
  const challenge = 'challenge-'.repeat(8);
  const request = sign({
    schema: 'lattice.adapter_controller_handshake_request.v1',
    request_id: 'handshake-a',
    run_id: bootstrap.run_id,
    supervisor_session_nonce: bootstrap.supervisor_session_nonce,
    controller_socket_ref: bootstrap.controller_socket_ref,
    challenge,
    request_digest: '',
  }, 'request_digest');
  const response = controller.handshake(request);

  assert.equal(validateControllerHandshakeResponse(response, {
    requestId: request.request_id,
    challenge,
    runId: bootstrap.run_id,
  }), true);
  assert.equal(response.descriptor.pid, process.pid);
  assert.equal(response.descriptor.process_start_identity.pid, process.pid);
  assert.equal(
    response.descriptor.controller_session_nonce_digest,
    digestArtifact(response.controller_session_nonce),
  );
  assert.deepEqual(
    response.descriptor.capabilities.operations,
    ['dispatch', 'observe', 'inventory', 'barrier', 'rebind', 'prepare', 'activate', 'release', 'revoke'],
  );
});

test('scripted controllerは未知operationをfallbackせずtypedに拒否する', async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-scripted-unit-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const runDir = path.join(repoRoot, '.lattice', 'runs', 'run-b');
  await mkdir(path.join(runDir, 'supervisor', 'controllers'), { recursive: true });
  const bootstrap = sign({
    schema: 'lattice.adapter_controller_bootstrap.v1',
    request_id: 'bootstrap-b',
    run_id: 'run-b',
    controller_socket_ref: 'supervisor/controllers/scripted-test.sock',
    supervisor_socket_ref: 'supervisor/control.sock',
    supervisor_session_nonce: 's'.repeat(64),
    bootstrap_digest: '',
  }, 'bootstrap_digest');
  const controller = await createScriptedAdapterController({
    bootstrap,
    runDir,
    repoRoot,
    controllerSessionNonce: 'c'.repeat(64),
  });

  await assert.rejects(
    controller.request('fallback', {}),
    (error) => error instanceof ScriptedAdapterControllerError
      && error.code === 'SCRIPTED_UNKNOWN_OPERATION',
  );
});
