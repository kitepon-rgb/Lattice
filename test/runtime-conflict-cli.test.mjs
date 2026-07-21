import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canonicalizeArtifact, digestArtifact } from '../src/artifact-contracts.mjs';
import { CONTROLLER_OPERATIONS, validateProcessStartIdentity } from '../src/runtime-controller-protocol.mjs';
import { buildNextRunEvent } from '../src/runtime-engine.mjs';
import { observeMacosBinaryIdentity, observeManagedProcessStartIdentity, resolveActiveRuntimePaths } from '../src/runtime-managed-supervisor.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { invokeSensorCli } from '../src/sensor-runtime.mjs';
import { reconstructHoldResultFromJournal } from '../src/runtime-cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');

test('hold recoveryは別barrierのackを旧barrierへ流用しない', () => {
  const intent = '1'.repeat(64);
  const make = (sequence, previous, kind, payload) => {
    const event = { schema: 'lattice.runtime_control_event.v1', run_id: 'run-a', sequence,
      previous_digest: previous, kind, session_nonce_digest: '2'.repeat(64), payload,
      recorded_at: '2026-07-21T00:00:00.000Z', event_digest: '' };
    event.event_digest = selfDigest(event, 'event_digest'); return event;
  };
  const prepared = make(1, null, 'hold_prepared', { request_id: 'hold-a',
    logical_intent_digest: intent, finding_digest: '3'.repeat(64), barrier_id: 'old-barrier',
    recorded_at: '2026-07-21T00:00:00.000Z' });
  const oldBarrier = make(2, prepared.event_digest, 'barrier_requested', { barrier_id: 'old-barrier',
    reason: 'conflict', running_count: 1, running_todo_ids: ['T1'], frozen_event_digest: '4'.repeat(64) });
  const newBarrier = make(3, oldBarrier.event_digest, 'barrier_requested', { barrier_id: 'new-barrier',
    reason: 'recovery', running_count: 1, running_todo_ids: ['T1'], frozen_event_digest: '4'.repeat(64) });
  const foreignAck = make(4, newBarrier.event_digest, 'executor_quiesced', { barrier_id: 'new-barrier',
    barrier_control_digest: newBarrier.event_digest, todo_id: 'T1', ack_digest: '5'.repeat(64) });
  assert.equal(reconstructHoldResultFromJournal({ journal: [prepared, oldBarrier, newBarrier, foreignAck],
    runId: 'run-a', requestId: 'hold-a', intentDigest: intent }), null);
});

function exec(command, args, cwd, expected = 0, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env });
  assert.equal(result.status, expected, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result;
}

async function createUnmanagedRun({ twoTodos = false, sharedResource = false } = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'lattice-conflict-cli-'));
  const repo = path.join(temporary, 'repo');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, '.gitignore'), '.lattice/runs/\n');
  await writeFile(path.join(repo, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  if (twoTodos) await writeFile(path.join(repo, 'src', 'beta.mjs'), 'export const beta = 2;\n');
  await writeFile(path.join(repo, 'test', 'alpha.test.mjs'), [
    "import assert from 'node:assert/strict';", "import test from 'node:test';",
    "import { alpha } from '../src/alpha.mjs';", "test('alpha', () => assert.equal(alpha, 1));", '',
  ].join('\n'));
  if (twoTodos) await writeFile(path.join(repo, 'test', 'beta.test.mjs'), [
    "import assert from 'node:assert/strict';", "import test from 'node:test';",
    "import { beta } from '../src/beta.mjs';", "test('beta', () => assert.equal(beta, 2));", '',
  ].join('\n'));
  exec('git', ['init', '--quiet', '--initial-branch=main'], repo);
  exec('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'add', '.'], repo);
  exec('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'base'], repo);
  const baseSha = exec('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
  invokeSensorCli((command, args, cwd) => exec(command, args, cwd).stdout, ['init', '.'], repo);
  const request = {
    schema: 'lattice.run_request.v1', request_id: 'conflict-cli-fixture',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' }, capacity: { executors: 1 },
    todos: [{ todo_id: 'T1' }, ...(twoTodos ? [{ todo_id: 'T2' }] : [])], manual_witness: { T1: {
      owns: [{ kind: 'symbol', target: 'alpha' }, { kind: 'path', target: 'src/alpha.mjs' }],
      reads: [], writes: ['src/alpha.mjs'], resources: sharedResource ? ['shared-state'] : [], state_effects: [],
      sensor_provenance: { queries: [
        { query_id: 'q-alpha', expect: { kind: 'symbol', name: 'alpha', path: 'src/alpha.mjs' } },
        { query_id: 'q-aff', expect: { kind: 'affected', path: 'src/alpha.mjs' } },
      ] }, affected_tests: ['test/alpha.test.mjs'], unknowns: [],
    }, ...(twoTodos ? { T2: {
      owns: [{ kind: 'symbol', target: 'beta' }, { kind: 'path', target: 'src/beta.mjs' }],
      reads: [], writes: ['src/beta.mjs'], resources: sharedResource ? ['shared-state'] : [], state_effects: [],
      sensor_provenance: { queries: [
        { query_id: 'q-beta', expect: { kind: 'symbol', name: 'beta', path: 'src/beta.mjs' } },
        { query_id: 'q-beta-aff', expect: { kind: 'affected', path: 'src/beta.mjs' } },
      ] }, affected_tests: ['test/beta.test.mjs'], unknowns: [],
    } } : {}) }, sensor_query_set: { queries: [
      { id: 'q-status', operation: 'status' }, { id: 'q-alpha', operation: 'query', target: 'alpha' },
      { id: 'q-aff', operation: 'affected', target: 'src/alpha.mjs' },
      ...(twoTodos ? [{ id: 'q-beta', operation: 'query', target: 'beta' },
        { id: 'q-beta-aff', operation: 'affected', target: 'src/beta.mjs' }] : []),
    ] }, executor_capability: { adapters: ['scripted'] }, claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(temporary, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  exec(process.execPath, [CLI, 'run', 'start', '--request', requestPath, '--executor', 'scripted'], repo);
  return { temporary, repo, runRef: '.lattice/runs/conflict-cli-fixture', request };
}

async function installManagedControllerFixture(fixture, { signed = false } = {}) {
  const runtimeDir = path.join(fixture.repo, '.lattice', 'runtime', 'adapter-registry');
  const descriptorDir = path.join(runtimeDir, 'descriptors');
  await mkdir(descriptorDir, { recursive: true });
  const controllerPath = path.join(runtimeDir, 'controller-host.mjs');
  const artifactUrl = new URL('../src/artifact-contracts.mjs', import.meta.url).href;
  const contractsUrl = new URL('../src/runtime-contracts.mjs', import.meta.url).href;
  const supervisorUrl = new URL('../src/runtime-managed-supervisor.mjs', import.meta.url).href;
  const directObserverUrl = new URL('../src/runtime-direct-os-observer.mjs', import.meta.url).href;
  const controllerSource = `#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { canonicalizeArtifact, digestArtifact } from ${JSON.stringify(artifactUrl)};
import { selfDigest } from ${JSON.stringify(contractsUrl)};
import { observeManagedProcessStartIdentity } from ${JSON.stringify(supervisorUrl)};
import { createDirectOsProcessObserver } from ${JSON.stringify(directObserverUrl)};
const bootstrap = JSON.parse(readFileSync(3, 'utf8').trim());
const socketPath = bootstrap.controller_socket_ref;
const sign = (value, field) => { value[field] = ''; value[field] = selfDigest(value, field); return value; };
const heartbeat = sign({ schema: 'lattice.runtime_heartbeat_policy.v1', interval_ms: 1000, ttl_ms: 60000, disconnect_revokes_immediately: true, policy_digest: '' }, 'policy_digest');
const capabilities = sign({ schema: 'lattice.runtime_adapter_capabilities.v1', operations: ${JSON.stringify([...CONTROLLER_OPERATIONS])}, process_observation: true, worktree_fingerprint: true, staged_write_lease: true, durable_dispatch: true, capabilities_digest: '' }, 'capabilities_digest');
const identity = await observeManagedProcessStartIdentity(process.pid);
const controllerSessionNonce = 'c'.repeat(64);
const controllerId = path.basename(bootstrap.controller_socket_ref, '.sock');
const workers = new Set();
const descriptor = sign({ schema: 'lattice.runtime_adapter_controller_descriptor.v1', controller_id: controllerId, adapter_kind: 'scripted', pid: process.pid, process_start_identity: identity, socket_ref: bootstrap.controller_socket_ref, controller_session_nonce_digest: digestArtifact(controllerSessionNonce), capabilities, heartbeat, descriptor_digest: '' }, 'descriptor_digest');
const observer = createDirectOsProcessObserver({ resolveObservationBinding: async ({binding}) => { const pid=Number(binding.executor_handle.slice(4)); const worktree=execFileSync('/bin/realpath',[path.join(process.cwd(),'../../..')],{encoding:'utf8'}).trim(); return { process_pid:pid, process_group_id:Number(execFileSync('/bin/ps',['-o','pgid=','-p',String(pid)],{encoding:'utf8'}).trim()), process_start_identity:await observeManagedProcessStartIdentity(pid), process_children:[], worktree_path:worktree, worktree_realpath:worktree, base_sha:execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:path.join(process.cwd(),'../../..'),encoding:'utf8'}).trim() }; } });
let connectionCount=0;
const server = net.createServer((socket) => { connectionCount += 1; const persistent=connectionCount>1; let buffer=''; socket.setEncoding('utf8'); socket.on('close',()=>{ if(persistent) process.exit(0); }); socket.on('data', async (chunk) => { buffer += chunk; const nl=buffer.indexOf('\\n'); if(nl<0)return; const request=JSON.parse(buffer.slice(0,nl)); buffer=buffer.slice(nl+1); if(request.schema==='lattice.adapter_controller_handshake_request.v1'){ const response=sign({ schema:'lattice.adapter_controller_handshake_response.v1', request_id:request.request_id, run_id:request.run_id, challenge_digest:digestArtifact(request.challenge), controller_session_nonce:controllerSessionNonce, descriptor, response_digest:'' }, 'response_digest'); socket.write(canonicalizeArtifact(response)+'\\n'); return; } if(request.schema==='lattice.adapter_barrier_request.v1'){ const acks=[]; for(const binding of request.running_bindings){ const pid=Number(binding.executor_handle.slice(4)); workers.add(pid); process.kill(-pid,'SIGSTOP'); await new Promise(r=>setTimeout(r,50)); const observed=await observer({kind:'quiescence',binding,ack:{worktree_id:binding.worktree_id}}); acks.push(sign({ schema:'lattice.executor_quiescence_ack.v1', ack_id:'ack-'+binding.todo_id, run_id:bootstrap.run_id, todo_id:binding.todo_id, executor_handle:binding.executor_handle, worktree_id:binding.worktree_id, plan_epoch:binding.plan_epoch, packet_digest:binding.packet_digest, write_lease_id:binding.write_lease_id, barrier_control_digest:request.barrier_control_digest, final_checkpoint_digest:observed.final_checkpoint_digest, process_observation_digest:observed.process_observation_digest, worktree_fingerprint_digest:observed.worktree_fingerprint_digest, supervisor_session_nonce_digest:digestArtifact(bootstrap.supervisor_session_nonce), ack_digest:'' },'ack_digest')); } const response=sign({schema:'lattice.adapter_barrier_response.v1',request_id:request.request_id,barrier_id:request.barrier_id,quiescence_acks:acks,response_digest:''},'response_digest'); socket.write(canonicalizeArtifact(response)+'\\n'); return; } if(request.schema==='lattice.adapter_revoke_request.v1'){ for(const pid of workers){ try{process.kill(-pid,'SIGCONT');process.kill(-pid,'SIGTERM');}catch{} } const response=sign({schema:'lattice.adapter_revoke_response.v1',request_id:request.request_id,revoked_lease_digests:request.lease_digests,residual_processes:[],response_digest:''},'response_digest'); socket.write(canonicalizeArtifact(response)+'\\n'); } }); });
server.listen(socketPath);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
  const extraOperations = await readFile(path.join(ROOT, 'test', 'fixtures',
    'runtime-controller-operations.fragment.js.txt'), 'utf8');
  const enhancedControllerSource = controllerSource.replace(
    "if(request.schema==='lattice.adapter_revoke_request.v1')",
    `${extraOperations}if(request.schema==='lattice.adapter_revoke_request.v1')`,
  );
  await writeFile(controllerPath, enhancedControllerSource, { mode: 0o700 });
  await chmod(controllerPath, 0o700);
  const configRef = '.lattice/runtime/adapter-registry/controller-config.json';
  const configPath = path.join(fixture.repo, configRef);
  const configBytes = `${canonicalizeArtifact({})}\n`;
  await writeFile(configPath, configBytes);
  const binaryPath = await realpath(process.execPath);
  const binaryDigest = createHash('sha256').update(await readFile(binaryPath)).digest('hex');
  const configDigest = createHash('sha256').update(configBytes).digest('hex');
  const capabilities = { schema: 'lattice.runtime_adapter_capabilities.v1', operations: [...CONTROLLER_OPERATIONS],
    process_observation: true, worktree_fingerprint: true, staged_write_lease: true,
    durable_dispatch: true, capabilities_digest: '' };
  capabilities.capabilities_digest = selfDigest(capabilities, 'capabilities_digest');
  const launch = { schema: 'lattice.runtime_adapter_launch_descriptor.v1', adapter_kind: 'scripted',
    launch_kind: 'host_binary', binary_path: binaryPath, binary_digest: binaryDigest,
    binary_identity: signed ? await observeMacosBinaryIdentity(binaryPath) : null,
    argv: [controllerPath], config_ref: configRef, config_digest: configDigest,
    endpoint: null, capabilities_digest: capabilities.capabilities_digest, descriptor_digest: '' };
  launch.descriptor_digest = selfDigest(launch, 'descriptor_digest');
  const launchRef = '.lattice/runtime/adapter-registry/descriptors/scripted.json';
  await writeFile(path.join(fixture.repo, launchRef), `${canonicalizeArtifact(launch)}\n`);
  const registry = { schema: 'lattice.runtime_adapter_registry.v1', entries: [{ adapter_kind: 'scripted',
    launch_descriptor_ref: launchRef, launch_descriptor_digest: launch.descriptor_digest }], registry_digest: '' };
  registry.registry_digest = selfDigest(registry, 'registry_digest');
  await writeFile(path.join(runtimeDir, 'registry.json'), `${canonicalizeArtifact(registry)}\n`);
}

test('conflict・hold・reprocessは公開argvだがunmanaged runへfallbackしない', async (t) => {
  const fixture = await createUnmanagedRun();
  t.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  for (const argv of [
    ['run', 'conflict', '--run', fixture.runRef, '--finding', 'd'.repeat(64)],
    ['run', 'hold', '--run', fixture.runRef],
    ['run', 'reprocess', '--run', fixture.runRef],
  ]) {
    const result = exec(process.execPath, [CLI, ...argv], fixture.repo, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).code, 'RUN_NOT_MANAGED');
  }
});

test('public finding recordは保存checkpointから再導出できないcandidateを実daemonで拒否する', async (t) => {
  const fixture = await createUnmanagedRun({ twoTodos: true });
  const runDir = path.join(fixture.repo, fixture.runRef);
  t.after(async () => {
    try {
      for (const controllerId of await readdir(path.join(runDir, 'controllers'))) {
        try {
          const descriptor = JSON.parse(await readFile(path.join(runDir, 'controllers', controllerId,
            'descriptor.json')));
          process.kill(descriptor.pid, 'SIGTERM');
        } catch { /* already stopped */ }
      }
    } catch { /* activation前失敗 */ }
    await rm(fixture.temporary, { recursive: true, force: true });
  });
  await installManagedControllerFixture(fixture);
  exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo);
  let events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const checkpointDigest = digestArtifact({ todo_id: 'T1', path: 'src/beta.mjs', sequence: 1 });
  events.push(buildNextRunEvent({ events, runId: fixture.request.request_id,
    kind: 'checkpoint_observed', planEpoch: 1, subject: { kind: 'todo', ref: 'T1' },
    payload: { checkpoint_digest: checkpointDigest, diff: { entries: [{
      path: 'src/beta.mjs', change: 'modified', content_digest: digestArtifact('beta-change'),
    }] } }, recordedAt: new Date().toISOString() }));
  await writeFile(path.join(runDir, 'events.json'), `${JSON.stringify(events)}\n`);
  const candidate = { schema: 'lattice.runtime_finding_candidate.v1',
    proposed_kind: 'stale_context', todo_ids: ['T1'], path: 'src/beta.mjs', resource_id: null,
    evidence_digests: [checkpointDigest], candidate_digest: '' };
  candidate.candidate_digest = selfDigest(candidate, 'candidate_digest');
  const input = path.join(fixture.temporary, 'finding-candidate.json');
  await writeFile(input, `${canonicalizeArtifact(candidate)}\n`);
  const rejected = exec(process.execPath, [CLI, 'run', 'finding', 'record', '--run', fixture.runRef,
    '--checkpoint', checkpointDigest, '--input', input], fixture.repo, 1);
  assert.equal(JSON.parse(rejected.stderr).code, 'FINDING_UNRESOLVED');
  assert.deepEqual(await readdir(path.join(runDir, 'findings')).catch(() => []), []);

  candidate.proposed_kind = 'scope_violation';
  candidate.candidate_digest = selfDigest(candidate, 'candidate_digest');
  await writeFile(input, `${canonicalizeArtifact(candidate)}\n`);
  const accepted = exec(process.execPath, [CLI, 'run', 'finding', 'record', '--run', fixture.runRef,
    '--checkpoint', checkpointDigest, '--input', input], fixture.repo);
  assert.equal(JSON.parse(accepted.stdout).outcome, 'recorded');
});

test('external hold ack surfaceはusage違反のまま閉じる', async (t) => {
  const fixture = await createUnmanagedRun();
  t.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  const result = exec(process.execPath, [CLI, 'run', 'hold', 'ack', '--run', fixture.runRef,
    '--input', 'forged.json'], fixture.repo, 2);
  assert.match(result.stderr, /unsupported command or arguments/u);
});

test('signed host binaryはpre/post-exec codesign identityをproduction observerで照合する', async (t) => {
  const fixture = await createUnmanagedRun();
  t.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  await installManagedControllerFixture(fixture, { signed: true });
  const activated = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo);
  assert.equal(JSON.parse(activated.stdout).outcome, 'activated');
  exec(process.execPath, [CLI, 'run', 'abandon', '--run', fixture.runRef, '--reason', 'signed-cleanup'], fixture.repo);
});

test('crashしたmanaged supervisorを新nonceで再起動しcontrollerを孤児化しない', async (t) => {
  const fixture = await createUnmanagedRun();
  t.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  await installManagedControllerFixture(fixture);
  exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo);
  const runDir = path.join(fixture.repo, fixture.runRef);
  const firstSupervisor = JSON.parse(await readFile(path.join(runDir, 'supervisor', 'descriptor.json')));
  const firstControllerId = (await readdir(path.join(runDir, 'controllers')))[0];
  const firstController = JSON.parse(await readFile(path.join(runDir, 'controllers', firstControllerId, 'descriptor.json')));
  process.kill(firstSupervisor.pid, 'SIGKILL');
  const firstDeadline = Date.now() + 3_000;
  while (Date.now() < firstDeadline) {
    try { process.kill(firstController.pid, 0); } catch { break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.throws(() => process.kill(firstController.pid, 0));
  const restarted = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo);
  assert.equal(JSON.parse(restarted.stdout).outcome, 'activated');
  const activePaths = await resolveActiveRuntimePaths({ runDir });
  const secondSupervisor = JSON.parse(await readFile(activePaths.descriptorPath));
  assert.notEqual(secondSupervisor.pid, firstSupervisor.pid);
  assert.notEqual(secondSupervisor.session_nonce_digest, firstSupervisor.session_nonce_digest);
  const activations = JSON.parse(await readFile(activePaths.controlEventsPath))
    .filter((event) => event.kind === 'supervisor_activated');
  assert.equal(activations.length, 2);
  exec(process.execPath, [CLI, 'run', 'abandon', '--run', fixture.runRef, '--reason', 'restart-cleanup'], fixture.repo);
  const secondControllerId = (await readdir(path.join(runDir, 'controllers'))).find((id) => id !== firstControllerId);
  const secondController = JSON.parse(await readFile(path.join(runDir, 'controllers', secondControllerId, 'descriptor.json')));
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const alive = [secondSupervisor.pid, secondController.pid].some((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!alive) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.throws(() => process.kill(secondSupervisor.pid, 0));
  assert.throws(() => process.kill(secondController.pid, 0));
  await assert.rejects(readFile(activePaths.sessionPath), { code: 'ENOENT' });
});

test('restart activation失敗は旧descriptor/session/control/gate証拠をbyte不変で残す', async (t) => {
  const fixture = await createUnmanagedRun();
  t.after(() => rm(fixture.temporary, { recursive: true, force: true }));
  await installManagedControllerFixture(fixture);
  exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo);
  const runDir = path.join(fixture.repo, fixture.runRef);
  const supervisorDir = path.join(runDir, 'supervisor');
  const descriptorPath = path.join(supervisorDir, 'descriptor.json');
  const sessionPath = path.join(supervisorDir, 'session');
  const controlPath = path.join(runDir, 'control-events.json');
  const descriptorBefore = await readFile(descriptorPath);
  const sessionBefore = await readFile(sessionPath);
  const controlBefore = await readFile(controlPath);
  const gateSentinel = Buffer.from('gate-proof-byte-preserve\n');
  await writeFile(path.join(supervisorDir, 'write-gate.json'), gateSentinel);
  const descriptor = JSON.parse(descriptorBefore);
  process.kill(descriptor.pid, 'SIGKILL');
  const registryPath = path.join(fixture.repo, '.lattice/runtime/adapter-registry/registry.json');
  const registry = JSON.parse(await readFile(registryPath));
  registry.entries[0].launch_descriptor_digest = 'f'.repeat(64);
  registry.registry_digest = selfDigest(registry, 'registry_digest');
  await writeFile(registryPath, `${canonicalizeArtifact(registry)}\n`);
  const failed = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo, 1);
  assert.equal(JSON.parse(failed.stderr).code, 'ADAPTER_LAUNCH_INVALID');
  assert.deepEqual(await readFile(descriptorPath), descriptorBefore);
  assert.deepEqual(await readFile(sessionPath), sessionBefore);
  assert.deepEqual(await readFile(controlPath), controlBefore);
  assert.deepEqual(await readFile(path.join(supervisorDir, 'write-gate.json')), gateSentinel);
  const candidates = await readdir(path.join(supervisorDir, 'restart-candidates')).catch(() => []);
  assert.deepEqual(candidates, []);
});

test('実controller daemonはholdからsuccessor prepare/release/中央gate/intake resumeまで公開CLIで完走する', async (t) => {
  const fixture = await createUnmanagedRun({ twoTodos: true, sharedResource: true });
  t.after(async () => {
    const runDir = path.join(fixture.repo, fixture.runRef);
    try {
      const active = await resolveActiveRuntimePaths({ runDir });
      process.kill(JSON.parse(await readFile(active.descriptorPath)).pid, 'SIGTERM');
    } catch { /* already stopped */ }
    await rm(fixture.temporary, { recursive: true, force: true });
  });
  await installManagedControllerFixture(fixture);
  exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo, 0,
    { ...process.env, NODE_ENV: 'test',
      LATTICE_INTERNAL_TEST_CONTROLLER_COUNT: '2',
      LATTICE_INTERNAL_TEST_CRASH_POINT: 'after_run_event_batch_receipt' });
  const runDir = path.join(fixture.repo, fixture.runRef);
  let events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const finding = { schema: 'lattice.runtime_finding_record.v1', finding_id: 'finding-recompile-e2e',
    run_id: fixture.request.request_id, plan_epoch: 1, source_checkpoint_digest: 'a'.repeat(64),
    observed_event_digest: events.at(-1).event_digest,
    finding: { schema: 'lattice.runtime_conflict_finding.v1', kind: 'effect_conflict_unknown',
      todo_ids: ['T1', 'T2'], path: null, resource_id: 'shared-state',
      evidence_digests: ['b'.repeat(64)], finding_digest: '' },
    recorded_by: { schema: 'lattice.runtime_observer_identity.v1', kind: 'supervisor',
      controller_registration_digest: null, executor_handle: null, identity_digest: '' },
    finding_digest: '' };
  finding.finding.finding_digest = selfDigest(finding.finding, 'finding_digest');
  finding.recorded_by.identity_digest = selfDigest(finding.recorded_by, 'identity_digest');
  finding.finding_digest = selfDigest(finding, 'finding_digest');
  await writeFile(path.join(runDir, 'findings', `${finding.finding_digest}.json`),
    `${canonicalizeArtifact(finding)}\n`);
  exec(process.execPath, [CLI, 'run', 'conflict', '--run', fixture.runRef,
    '--finding', finding.finding_digest], fixture.repo);
  exec(process.execPath, [CLI, 'run', 'hold', '--run', fixture.runRef], fixture.repo);
  const queued = { schema: 'lattice.runtime_queue.v1', run_id: fixture.request.request_id,
    frozen_epoch: 1, entries: [{ sequence: 1, kind: 'finding',
      subject_digest: finding.finding.finding_digest, artifact_digest: finding.finding_digest }],
    queue_digest: '' };
  queued.queue_digest = selfDigest(queued, 'queue_digest');
  await writeFile(path.join(runDir, 'queued-events.json'), `${canonicalizeArtifact(queued)}\n`);
  events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const freeze = events.findLast((event) => event.kind === 'intake_frozen');
  const hold = events.findLast((event) => event.kind === 'hold_decided');
  const migration = { schema: 'lattice.runtime_task_migration.v1', entries: [
    { predecessor_task_id: 'T1', disposition: 'stay', successor_task_ids: ['T1'],
      reason: 'serial owner', evidence_digests: ['1'.repeat(64)] },
    { predecessor_task_id: 'T2', disposition: 'carry', successor_task_ids: ['T2'],
      reason: 'serial peer', evidence_digests: ['2'.repeat(64)] },
  ], migration_digest: '' };
  migration.migration_digest = selfDigest(migration, 'migration_digest');
  const successor = { ...fixture.request, schema: 'lattice.run_request.v2',
    predecessor_request_digest: fixture.request.request_digest,
    task_migration_digest: migration.migration_digest, request_digest: '' };
  successor.request_digest = selfDigest(successor, 'request_digest');
  const serial = { schema: 'lattice.runtime_intentional_serial.v1',
    finding_digest: finding.finding_digest, todo_ids: ['T1', 'T2'], resource_id: 'shared-state',
    stay_todo_id: 'T1', reason: 'intentional serial e2e', serial_digest: '' };
  serial.serial_digest = selfDigest(serial, 'serial_digest');
  const recompile = { schema: 'lattice.runtime_recompile_request.v1', request_id: 'recompile-e2e',
    run_id: fixture.request.request_id, predecessor_epoch: 1,
    frozen_event_digest: freeze.event_digest, hold_decision_digest: hold.payload.decision_digest,
    mode: 'intentional_serial', reason: 'shared state', successor_request: successor,
    task_migration: migration, phase_revision: null, seam_split: null,
    intentional_serial: serial, request_digest: '' };
  recompile.request_digest = selfDigest(recompile, 'request_digest');
  const input = path.join(fixture.temporary, 'recompile.json');
  await writeFile(input, `${canonicalizeArtifact(recompile)}\n`);
  const crashed = exec(process.execPath, [CLI, 'run', 'recompile', '--run', fixture.runRef,
    '--input', input, '--request-id', 'recompile-pointer-crash'], fixture.repo, 1);
  assert.equal(JSON.parse(crashed.stderr).code, 'RUN_OUTCOME_UNKNOWN');
  const committedBeforeRestart = JSON.parse(await readFile(path.join(runDir, 'committed-epoch.json')));
  assert.equal(committedBeforeRestart.plan_epoch, 1);
  events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  assert.equal(events.some((event) => event.kind === 'plan_recompiled'), false);
  assert.equal((await readdir(runDir)).filter((name) => name.startsWith('run-event-batch-')).length, 1);
  const restartedForStage = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo, 0,
    { ...process.env, NODE_ENV: 'test', LATTICE_INTERNAL_TEST_CONTROLLER_COUNT: '2',
      LATTICE_INTERNAL_TEST_CRASH_POINT: 'after_successor_stage' });
  assert.equal(JSON.parse(restartedForStage.stdout).outcome, 'activated');
  const crashedStageReplay = exec(process.execPath, [CLI, 'run', 'reprocess', '--run', fixture.runRef,
    '--request-id', 'reprocess-stage-crash'], fixture.repo, 1);
  assert.equal(JSON.parse(crashedStageReplay.stderr).code, 'RUN_OUTCOME_UNKNOWN', crashedStageReplay.stderr);
  assert.equal(JSON.parse(await readFile(path.join(runDir, 'committed-epoch.json'))).plan_epoch, 1);
  const restartedForReprocess = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo, 0,
    { ...process.env, NODE_ENV: 'test', LATTICE_INTERNAL_TEST_CONTROLLER_COUNT: '2',
      LATTICE_INTERNAL_TEST_CRASH_POINT: 'after_first_controller_release' });
  assert.equal(JSON.parse(restartedForReprocess.stdout).outcome, 'activated');
  const crashedReprocess = exec(process.execPath, [CLI, 'run', 'reprocess', '--run', fixture.runRef,
    '--request-id', 'reprocess-stage-crash'], fixture.repo, 1);
  assert.equal(JSON.parse(crashedReprocess.stderr).code, 'RUN_OUTCOME_UNKNOWN', crashedReprocess.stderr);
  const committedAfterReplay = JSON.parse(await readFile(path.join(runDir, 'committed-epoch.json')));
  assert.equal(committedAfterReplay.plan_epoch, 2);
  await assert.rejects(readFile(path.join(runDir, 'supervisor', 'write-gate.json')), { code: 'ENOENT' });
  const preRecoveryEvents = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  assert.equal(preRecoveryEvents.some((event) => event.kind === 'intake_resumed'
    && event.plan_epoch === 2), false);
  const restarted = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo, 0,
    { ...process.env, NODE_ENV: 'test', LATTICE_INTERNAL_TEST_CONTROLLER_COUNT: '2' });
  assert.equal(JSON.parse(restarted.stdout).outcome, 'activated');
  const completedAfterGate = exec(process.execPath, [CLI, 'run', 'reprocess', '--run', fixture.runRef,
    '--request-id', 'reprocess-stage-crash'], fixture.repo);
  assert.equal(JSON.parse(completedAfterGate.stdout).outcome, 'reprocessed');
  const completedLedger = JSON.parse(await readFile(path.join(runDir, 'control-request-ledger.json')));
  assert.equal(completedLedger.entries.find((entry) => entry.request_id === 'reprocess-stage-crash')?.state,
    'completed');
  events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  assert.equal(events.some((event) => event.kind === 'intake_resumed'
    && event.plan_epoch === 2), true);
  const completedRuntime = await resolveActiveRuntimePaths({ runDir });
  process.kill(JSON.parse(await readFile(completedRuntime.descriptorPath)).pid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const restartedAfterGate = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo, 0,
    { ...process.env, NODE_ENV: 'test', LATTICE_INTERNAL_TEST_CONTROLLER_COUNT: '2' });
  assert.equal(JSON.parse(restartedAfterGate.stdout).outcome, 'activated');
  const result = exec(process.execPath, [CLI, 'run', 'reprocess', '--run', fixture.runRef,
    '--request-id', 'reprocess-stage-crash'], fixture.repo);
  assert.equal(JSON.parse(result.stdout).outcome, 'reprocessed');
  const pointer = JSON.parse(await readFile(path.join(runDir, 'committed-epoch.json')));
  const release = JSON.parse(await readFile(path.join(runDir, 'release-epoch.json')));
  const gate = JSON.parse(await readFile(path.join(runDir, 'supervisor', 'write-gate.json')));
  events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  assert.equal(pointer.plan_epoch, 2);
  assert.equal(release.plan_epoch, 2);
  assert.equal(release.controller_ready_ack_digests.length, 2);
  assert.equal(gate.plan_epoch, 2);
  assert.equal(gate.gate_generation, 2);
  assert.equal(gate.release_barrier_digest, release.release_digest);
  assert.equal(gate.controller_release_ack_digests.length, 2);
  assert.equal(gate.armed_lease_digests.length, release.staged_lease_digests.length);
  assert.equal(new Set(gate.controller_release_ack_digests).size, 2);
  assert.equal(new Set(gate.armed_lease_digests).size, gate.armed_lease_digests.length);
  assert.equal(events.at(-1).kind, 'intake_resumed');
  assert.equal(events.at(-1).payload.write_gate_digest, gate.gate_digest);
  const activeRuntime = await resolveActiveRuntimePaths({ runDir });
  const controlEvents = JSON.parse(await readFile(activeRuntime.controlEventsPath));
  const intakeControlIndex = controlEvents.findLastIndex((event) => event.kind === 'intake_resumed'
    && event.payload.plan_epoch === 2);
  const gateControlBatch = controlEvents.slice(intakeControlIndex - 2, intakeControlIndex + 1);
  assert.deepEqual(gateControlBatch.map((event) => event.kind),
    ['write_gate_committed', 'epoch_activated', 'intake_resumed']);
  assert.equal(gateControlBatch[0].payload.gate_digest, gate.gate_digest);
  assert.equal(gateControlBatch[0].payload.gate_generation, gate.gate_generation);
  assert.equal(gateControlBatch[1].previous_digest, gateControlBatch[0].event_digest);
  assert.equal(gateControlBatch[1].payload.gate_digest, gate.gate_digest);
  assert.equal(gateControlBatch[2].previous_digest, gateControlBatch[1].event_digest);
  assert.equal(gateControlBatch[2].payload.gate_digest, gate.gate_digest);
  assert.equal(gateControlBatch.every((event) => event.session_nonce_digest
    === activeRuntime.pointer.session_nonce_digest), true);
  const reprocessedQueue = JSON.parse(await readFile(path.join(runDir, 'queued-events.json')));
  assert.deepEqual(reprocessedQueue.entries, []);
  assert.deepEqual(events.filter((event) => event.kind === 'context_invalidated')
    .map((event) => event.subject.ref).sort(), ['T1', 'T2']);
  assert.equal(events.filter((event) => event.kind === 'plan_recompiled'
    && event.plan_epoch === 2).length, 1);
  assert.equal(events.filter((event) => event.kind === 'epoch_rebound'
    && event.plan_epoch === 2).length, 0);
  const eventBatchReceipts = (await readdir(runDir))
    .filter((name) => name.startsWith('run-event-batch-'));
  const eventBatchPhases = await Promise.all(eventBatchReceipts.map(async (name) =>
    JSON.parse(await readFile(path.join(runDir, name))).phase));
  assert.equal(eventBatchPhases.filter((phase) => phase === 'recompile').length, 1);
  assert.equal(eventBatchPhases.filter((phase) => phase === 'epoch_rebound').length, 1);
  assert.equal(eventBatchPhases.filter((phase) => phase.startsWith('epoch_rebound_recovery_')).length, 2);
  const ledger = JSON.parse(await readFile(path.join(runDir, 'control-request-ledger.json')));
  const reprocessLedger = ledger.entries.find((entry) => entry.request_id === 'reprocess-stage-crash');
  assert.equal(reprocessLedger?.state, 'completed');
  assert.equal(reprocessLedger?.response?.result?.outcome, 'reprocessed');
  exec(process.execPath, [CLI, 'run', 'abandon', '--run', fixture.runRef,
    '--reason', 'recompile-e2e-cleanup'], fixture.repo);
});

test('activate後もdaemonが生存しfinding→conflict→hold receiptとdispatch freezeを維持する', async (t) => {
  const fixture = await createUnmanagedRun();
  let worker = null;
  t.after(async () => {
    if (worker?.pid) {
      try { process.kill(-worker.pid, 'SIGCONT'); process.kill(-worker.pid, 'SIGTERM'); } catch { /* already stopped */ }
    }
    const runDir = path.join(fixture.repo, fixture.runRef);
    const descriptorPaths = [path.join(runDir, 'supervisor', 'descriptor.json')];
    try {
      for (const controllerId of await readdir(path.join(runDir, 'controllers'))) {
        descriptorPaths.push(path.join(runDir, 'controllers', controllerId, 'descriptor.json'));
      }
    } catch { /* activation前失敗 */ }
    for (const descriptorPath of descriptorPaths) {
      try { process.kill(JSON.parse(await readFile(descriptorPath)).pid, 'SIGTERM'); } catch { /* already stopped */ }
    }
    await rm(fixture.temporary, { recursive: true, force: true });
  });
  await installManagedControllerFixture(fixture);
  const activate = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef],
    fixture.repo, 0, { ...process.env, NODE_ENV: 'test',
      LATTICE_INTERNAL_TEST_CRASH_POINT: 'after_hold_effect' });
  assert.equal(JSON.parse(activate.stdout).outcome, 'activated');
  const runDir = path.join(fixture.repo, fixture.runRef);
  worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: fixture.repo, detached: true, stdio: 'ignore',
  });
  worker.unref();
  await new Promise((resolve) => setTimeout(resolve, 100));
  let events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const epoch = JSON.parse(await readFile(path.join(runDir, 'epochs', '00000001', 'epoch-bundle.json')));
  const controllerId = (await readdir(path.join(runDir, 'controllers')))[0];
  const registration = JSON.parse(await readFile(path.join(runDir, 'controllers', controllerId, 'registration.json')));
  const packet = epoch.executor_packets.T1;
  const workerIdentity = await observeManagedProcessStartIdentity(worker.pid);
  assert.equal(validateProcessStartIdentity(workerIdentity), true);
  const workerGroup = Number(exec('/bin/ps', ['-o', 'pgid=', '-p', String(worker.pid)], fixture.repo).stdout.trim());
  events.push(buildNextRunEvent({ events, runId: 'conflict-cli-fixture', kind: 'executor_dispatched',
    planEpoch: 1, subject: { kind: 'todo', ref: 'T1' }, payload: {
      executor_handle: `pid-${worker.pid}`, worktree_id: 'fixture-worktree',
      packet_digest: packet.packet_digest, write_lease_id: 'fixture-lease',
      controller_registration_digest: registration.registration_digest,
      direct_os_observation_binding: { process_pid: worker.pid, process_group_id: workerGroup,
        process_start_identity: workerIdentity, process_children: [],
        worktree_path: await realpath(fixture.repo), worktree_realpath: await realpath(fixture.repo),
        base_sha: exec('git', ['rev-parse', 'HEAD'], fixture.repo).stdout.trim() },
    }, recordedAt: new Date().toISOString() }));
  await writeFile(path.join(runDir, 'events.json'), `${JSON.stringify(events)}\n`);
  const finding = { schema: 'lattice.runtime_finding_record.v1', finding_id: 'finding-e2e',
    run_id: 'conflict-cli-fixture', plan_epoch: 1, source_checkpoint_digest: 'a'.repeat(64),
    observed_event_digest: events.at(-1).event_digest,
    finding: { schema: 'lattice.runtime_conflict_finding.v1', kind: 'observed_write_conflict',
      todo_ids: ['T1'], path: 'src/alpha.mjs', resource_id: null, evidence_digests: ['b'.repeat(64)], finding_digest: '' },
    recorded_by: { schema: 'lattice.runtime_observer_identity.v1', kind: 'supervisor',
      controller_registration_digest: null, executor_handle: null, identity_digest: '' }, finding_digest: '' };
  finding.finding.finding_digest = selfDigest(finding.finding, 'finding_digest');
  finding.recorded_by.identity_digest = selfDigest(finding.recorded_by, 'identity_digest');
  finding.finding_digest = selfDigest(finding, 'finding_digest');
  await mkdir(path.join(runDir, 'findings'), { recursive: true });
  const malformed = structuredClone(finding);
  malformed.finding_id = 'finding-malformed';
  malformed.recorded_by.unexpected = true;
  malformed.finding_digest = selfDigest(malformed, 'finding_digest');
  await writeFile(path.join(runDir, 'findings', `${malformed.finding_digest}.json`), `${JSON.stringify(malformed)}\n`);
  const beforeMalformed = await readFile(path.join(runDir, 'events.json'));
  const rejected = exec(process.execPath, [CLI, 'run', 'conflict', '--run', fixture.runRef,
    '--finding', malformed.finding_digest], fixture.repo, 1);
  assert.equal(JSON.parse(rejected.stderr).code, 'FINDING_UNRESOLVED');
  assert.deepEqual(await readFile(path.join(runDir, 'events.json')), beforeMalformed);
  await writeFile(path.join(runDir, 'findings', `${finding.finding_digest}.json`), `${JSON.stringify(finding)}\n`);
  exec(process.execPath, [CLI, 'run', 'conflict', '--run', fixture.runRef,
    '--finding', finding.finding_digest], fixture.repo);
  const crashedHold = exec(process.execPath, [CLI, 'run', 'hold', '--run', fixture.runRef],
    fixture.repo, 1);
  const crashedError = JSON.parse(crashedHold.stderr);
  assert.equal(crashedError.code, 'RUN_OUTCOME_UNKNOWN');
  const holdRequestId = crashedError.message.match(/request_id=([0-9A-Za-z._-]+)/u)?.[1];
  assert.match(holdRequestId, /^[0-9A-Za-z._-]+$/u);
  assert.match(exec('/bin/ps', ['-o', 'state=', '-p', String(worker.pid)], fixture.repo).stdout.trim(), /^T/u);
  const restarted = exec(process.execPath, [CLI, 'run', 'activate', '--run', fixture.runRef], fixture.repo);
  assert.equal(JSON.parse(restarted.stdout).outcome, 'activated');
  const hold = exec(process.execPath, [CLI, 'run', 'hold', '--run', fixture.runRef,
    '--request-id', holdRequestId], fixture.repo);
  assert.equal(JSON.parse(hold.stdout).outcome, 'held');
  const held = JSON.parse(await readFile(path.join(runDir, 'hold-result.json')));
  assert.equal(held.outcome, 'held');
  assert.equal(held.quiescence_ack_digests.length, 1);
  assert.match(exec('/bin/ps', ['-o', 'state=', '-p', String(worker.pid)], fixture.repo).stdout.trim(), /^T/u);
  const resume = exec(process.execPath, [CLI, 'run', 'resume', '--run', fixture.runRef], fixture.repo);
  assert.deepEqual(JSON.parse(resume.stdout).dispatchable, []);
  const active = await resolveActiveRuntimePaths({ runDir });
  const supervisorPid = JSON.parse(await readFile(active.descriptorPath)).pid;
  const controllerDescriptors = await Promise.all((await readdir(path.join(runDir, 'controllers')))
    .map(async (id) => JSON.parse(await readFile(path.join(runDir, 'controllers', id, 'descriptor.json')))));
  const controllerPid = controllerDescriptors.find((descriptor) => {
    try { process.kill(descriptor.pid, 0); return true; } catch { return false; }
  }).pid;
  const abandoned = exec(process.execPath, [CLI, 'run', 'abandon', '--run', fixture.runRef,
    '--reason', 'e2e-cleanup'], fixture.repo);
  assert.equal(JSON.parse(abandoned.stdout).outcome, 'abandoned');
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const alive = [supervisorPid, controllerPid, worker.pid].some((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
    let socketExists = true;
    try { await readFile(path.join(runDir, 'supervisor', 'session')); } catch { socketExists = false; }
    if (!alive && !socketExists) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const pid of [supervisorPid, controllerPid, worker.pid]) {
    assert.throws(() => process.kill(pid, 0));
  }
  await assert.rejects(readFile(path.join(runDir, 'supervisor', 'session')),
    (error) => error.code === 'ENOENT');
  worker = null;
});
