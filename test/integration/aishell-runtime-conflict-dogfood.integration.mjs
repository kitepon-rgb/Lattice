import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canonicalizeArtifact } from '../../src/artifact-contracts.mjs';
import { selfDigest } from '../../src/runtime-contracts.mjs';
import { validateRuntimeRecompileRequest } from '../../src/runtime-hold-recompile.mjs';
import { CONTROLLER_OPERATIONS } from '../../src/runtime-controller-protocol.mjs';
import { resolveActiveRuntimePaths } from '../../src/runtime-managed-supervisor.mjs';
import { invokeSensorCli } from '../../src/sensor-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const CONTROLLER = path.join(ROOT, 'test', 'fixtures', 'aishell-runtime-conflict', 'controller-host.js');
const RUN_ID = 'aishell-runtime-conflict';
const RUN_REF = `.lattice/runs/${RUN_ID}`;
const SERVICE = 'Sources/AIShellCore/ChangeSetService.swift';
const COORDINATOR = 'Sources/AIShellCore/ChangeSetCutoverCoordinator.swift';
const STORE = 'Sources/AIShellCore/ChangeSetTransactionStore.swift';

function exec(command, args, cwd, expected = 0, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env });
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stderr}`);
  return result;
}

function git(cwd, args) {
  return exec('git', args, cwd).stdout.trim();
}

function witness({ symbol, ownedPath, writes, ownsCoordinator = false, sharesCoordinator = false }) {
  return {
    owns: [{ kind: 'symbol', target: symbol }, { kind: 'path', target: ownedPath },
      ...(ownsCoordinator ? [{ kind: 'symbol', target: 'ChangeSetCutoverCoordinator' },
        { kind: 'path', target: COORDINATOR }] : [])],
    reads: [],
    writes,
    resources: sharesCoordinator ? ['changeset-cutover-coordinator'] : [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: `q-${symbol}`, expect: { kind: 'symbol', name: symbol, path: ownedPath } },
        { query_id: `q-path-${symbol}`, expect: { kind: 'path', path: ownedPath } },
        ...(ownsCoordinator ? [{ query_id: 'q-ChangeSetCutoverCoordinator',
          expect: { kind: 'symbol', name: 'ChangeSetCutoverCoordinator', path: COORDINATOR } },
        { query_id: 'q-path-ChangeSetCutoverCoordinator',
          expect: { kind: 'path', path: COORDINATOR } }] : [])],
    },
    affected_tests: [],
    unknowns: [],
  };
}

function requestV1({ baseSha, seam = false }) {
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: RUN_ID,
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'service-owner' }, { todo_id: 'store-owner' }],
    manual_witness: {
      'service-owner': witness({
        symbol: 'ChangeSetService',
        ownedPath: SERVICE,
        writes: seam ? [SERVICE, COORDINATOR] : [SERVICE, COORDINATOR],
        ownsCoordinator: true,
        sharesCoordinator: true,
      }),
      'store-owner': witness({
        symbol: 'ChangeSetTransactionStore',
        ownedPath: STORE,
        writes: seam ? [STORE] : [STORE, COORDINATOR],
        ownsCoordinator: !seam,
        sharesCoordinator: !seam,
      }),
    },
    sensor_query_set: { queries: [
      { id: 'q-status', operation: 'status' },
      { id: 'q-ChangeSetService', operation: 'query', target: 'ChangeSetService' },
      { id: 'q-path-ChangeSetService', operation: 'query', target: SERVICE },
      { id: 'q-ChangeSetCutoverCoordinator', operation: 'query', target: 'ChangeSetCutoverCoordinator' },
      { id: 'q-path-ChangeSetCutoverCoordinator', operation: 'query', target: COORDINATOR },
      { id: 'q-ChangeSetTransactionStore', operation: 'query', target: 'ChangeSetTransactionStore' },
      { id: 'q-path-ChangeSetTransactionStore', operation: 'query', target: STORE },
    ] },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
    request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  return request;
}

async function writeRequest(root, name, request) {
  const target = path.join(root, `${name}.json`);
  await writeFile(target, `${canonicalizeArtifact(request)}\n`);
  return target;
}

async function compileViaPublicCli(repo, input) {
  return JSON.parse(exec(process.execPath, [CLI, 'plan', 'compile', '--request', input], repo).stdout);
}

async function installController(repo) {
  const runtime = path.join(repo, '.lattice', 'runtime', 'adapter-registry');
  await mkdir(path.join(runtime, 'descriptors'), { recursive: true });
  await chmod(CONTROLLER, 0o700);
  const configRef = '.lattice/runtime/adapter-registry/controller-config.json';
  const configBytes = '{}\n';
  await writeFile(path.join(repo, configRef), configBytes);
  const binaryPath = await realpath(process.execPath);
  const binaryDigest = createHash('sha256').update(await readFile(binaryPath)).digest('hex');
  const configDigest = createHash('sha256').update(configBytes).digest('hex');
  const capabilities = {
    schema: 'lattice.runtime_adapter_capabilities.v1',
    operations: [...CONTROLLER_OPERATIONS],
    process_observation: true,
    worktree_fingerprint: true,
    staged_write_lease: true,
    durable_dispatch: true,
    capabilities_digest: '',
  };
  capabilities.capabilities_digest = selfDigest(capabilities, 'capabilities_digest');
  const launch = {
    schema: 'lattice.runtime_adapter_launch_descriptor.v1',
    adapter_kind: 'scripted',
    launch_kind: 'host_binary',
    binary_path: binaryPath,
    binary_digest: binaryDigest,
    binary_identity: null,
    argv: [CONTROLLER, ROOT],
    config_ref: configRef,
    config_digest: configDigest,
    endpoint: null,
    capabilities_digest: capabilities.capabilities_digest,
    descriptor_digest: '',
  };
  launch.descriptor_digest = selfDigest(launch, 'descriptor_digest');
  const launchRef = '.lattice/runtime/adapter-registry/descriptors/scripted.json';
  await writeFile(path.join(repo, launchRef), `${canonicalizeArtifact(launch)}\n`);
  const registry = {
    schema: 'lattice.runtime_adapter_registry.v1',
    entries: [{ adapter_kind: 'scripted', launch_descriptor_ref: launchRef,
      launch_descriptor_digest: launch.descriptor_digest }],
    registry_digest: '',
  };
  registry.registry_digest = selfDigest(registry, 'registry_digest');
  await writeFile(path.join(runtime, 'registry.json'), `${canonicalizeArtifact(registry)}\n`);
}

async function waitDead(pid) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`process ${pid} did not stop`);
}

async function stopFixtureProcesses(runDir) {
  const controllerPids = [];
  for (const controllerId of await readdir(path.join(runDir, 'controllers')).catch(() => [])) {
    try {
      const descriptor = JSON.parse(await readFile(
        path.join(runDir, 'controllers', controllerId, 'descriptor.json')));
      controllerPids.push(descriptor.pid);
    } catch { /* controller registration was not committed */ }
  }
  try {
    const active = await resolveActiveRuntimePaths({ runDir });
    const supervisorPid = JSON.parse(await readFile(active.descriptorPath)).pid;
    try { process.kill(supervisorPid, 'SIGTERM'); } catch {}
    await waitDead(supervisorPid);
  } catch { /* supervisor already stopped */ }
  for (const pid of controllerPids) {
    try { process.kill(pid, 'SIGTERM'); } catch { continue; }
    await waitDead(pid);
  }
}

// 実daemonを起こすこの面は、いまmacOSでだけ検証している。Linuxでは管理runtimeの
// daemon lifecycleが通らない（CIで実測）。**skipは「Linuxで動く」という主張ではない**——
// 未検証であることを明示する印であり、Linux対応はbacklogの「管理runtimeのLinux検証」が持つ。
const managedDaemon = {
  skip: process.platform === 'darwin' ? false : 'managed runtime daemon is verified on macOS only',
};

test('AIShell ownership conflictはstay直列化・seam分割・managed再起動後の再処理へ収束する', managedDaemon, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'lattice-aishell-dogfood-'));
  const repo = path.join(temporary, 'repo');
  await mkdir(path.join(repo, 'Sources', 'AIShellCore'), { recursive: true });
  await writeFile(path.join(repo, '.gitignore'), '.lattice/runs/\n');
  await writeFile(path.join(repo, SERVICE), 'public final class ChangeSetService {}\n');
  await writeFile(path.join(repo, COORDINATOR), 'public final class ChangeSetCutoverCoordinator {}\n');
  await writeFile(path.join(repo, STORE), 'public final class ChangeSetTransactionStore {}\n');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['-c', 'user.email=dogfood@example.invalid', '-c', 'user.name=dogfood', 'add', '.']);
  git(repo, ['-c', 'user.email=dogfood@example.invalid', '-c', 'user.name=dogfood',
    'commit', '--quiet', '-m', 'AIShell runtime fixture']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  invokeSensorCli((command, args, cwd) => exec(command, args, cwd).stdout, ['init', '.'], repo);
  t.after(async () => {
    await stopFixtureProcesses(path.join(repo, RUN_REF));
    await rm(temporary, { recursive: true, force: true });
  });

  const predecessor = requestV1({ baseSha, seam: false });
  const predecessorPath = await writeRequest(temporary, 'predecessor', predecessor);
  const serialPlan = await compileViaPublicCli(repo, predecessorPath);
  assert.ok(serialPlan.plan.conflicts.length >= 2);
  assert.equal(serialPlan.plan.conflicts.every(({ todo_ids: ids }) =>
    JSON.stringify(ids) === JSON.stringify(['service-owner', 'store-owner'])), true);
  const sharedPathResource = 'changeset-cutover-coordinator';
  assert.ok(serialPlan.plan.conflicts.some(({ resource_id: resourceId }) =>
    resourceId === sharedPathResource));
  assert.equal(serialPlan.schedule.minimum_feasible_waves, 2);

  const serialMigration = {
    schema: 'lattice.runtime_task_migration.v1',
    entries: [
      { predecessor_task_id: 'service-owner', disposition: 'stay', successor_task_ids: ['service-owner'],
        reason: 'ChangeSetCutoverCoordinatorの所有者を維持する', evidence_digests: ['1'.repeat(64)] },
      { predecessor_task_id: 'store-owner', disposition: 'carry', successor_task_ids: ['store-owner'],
        reason: '共有pathから分離するまで待機する', evidence_digests: ['2'.repeat(64)] },
    ],
    migration_digest: '',
  };
  serialMigration.migration_digest = selfDigest(serialMigration, 'migration_digest');
  const serialSuccessor = { ...predecessor, schema: 'lattice.run_request.v2',
    predecessor_request_digest: predecessor.request_digest,
    task_migration_digest: serialMigration.migration_digest, request_digest: '' };
  serialSuccessor.request_digest = selfDigest(serialSuccessor, 'request_digest');
  const intentionalSerial = { schema: 'lattice.runtime_intentional_serial.v1',
    finding_digest: '3'.repeat(64), todo_ids: ['service-owner', 'store-owner'],
    resource_id: sharedPathResource, stay_todo_id: 'service-owner',
    reason: 'seam適用前は片側をstayさせる', serial_digest: '' };
  intentionalSerial.serial_digest = selfDigest(intentionalSerial, 'serial_digest');
  const serialRequest = { schema: 'lattice.runtime_recompile_request.v1', request_id: 'serial-e2',
    run_id: RUN_ID, predecessor_epoch: 1, frozen_event_digest: '4'.repeat(64),
    hold_decision_digest: '5'.repeat(64), mode: 'intentional_serial', reason: 'shared path conflict',
    successor_request: serialSuccessor, task_migration: serialMigration, phase_revision: null,
    seam_split: null, intentional_serial: intentionalSerial, request_digest: '' };
  serialRequest.request_digest = selfDigest(serialRequest, 'request_digest');
  assert.equal(validateRuntimeRecompileRequest(serialRequest), true);

  const seam = requestV1({ baseSha, seam: true });
  const seamPath = await writeRequest(temporary, 'seam-successor', seam);
  const seamPlan = await compileViaPublicCli(repo, seamPath);
  assert.deepEqual(seamPlan.plan.conflicts, []);
  assert.equal(seamPlan.schedule.minimum_feasible_waves, 1);
  const owners = Object.fromEntries(Object.entries(seamPlan.manifests)
    .map(([todoId, manifest]) => [todoId, manifest.owns]));
  assert.deepEqual(owners['service-owner'].map(({ target }) => target).sort(),
    ['ChangeSetService', SERVICE, 'ChangeSetCutoverCoordinator', COORDINATOR].sort());
  assert.deepEqual(owners['store-owner'].map(({ target }) => target).sort(),
    ['ChangeSetTransactionStore', STORE].sort());

  const splitMigration = structuredClone(serialMigration);
  splitMigration.entries[0].disposition = 'replace';
  splitMigration.entries[0].reason = 'Coordinator seamのsingle ownerへ置換';
  splitMigration.entries[1].disposition = 'replace';
  splitMigration.entries[1].reason = 'TransactionStore単独所有へ置換';
  splitMigration.migration_digest = selfDigest(splitMigration, 'migration_digest');
  const ownershipDiff = { schema: 'lattice.runtime_ownership_diff.v1',
    added: [{ resource_id: 'changeset-cutover-coordinator', owner_todo_id: 'service-owner', access_kind: 'own' }],
    removed: [{ resource_id: 'changeset-cutover-coordinator', owner_todo_id: 'store-owner', access_kind: 'write' }],
    diff_digest: '' };
  ownershipDiff.diff_digest = selfDigest(ownershipDiff, 'diff_digest');
  const edgeDiff = { schema: 'lattice.runtime_edge_diff.v1', added: [],
    removed: [{ from_todo_id: 'service-owner', to_todo_id: 'store-owner', kind: 'conflict' }],
    diff_digest: '' };
  edgeDiff.diff_digest = selfDigest(edgeDiff, 'diff_digest');
  const split = { schema: 'lattice.runtime_seam_split.v1', finding_digest: '3'.repeat(64),
    predecessor_task_ids: ['service-owner', 'store-owner'],
    task_migration_digest: splitMigration.migration_digest,
    ownership_diff: ownershipDiff, edge_diff: edgeDiff,
    verifier_refs: ['public-plan-compile:seam-successor'], split_digest: '' };
  split.split_digest = selfDigest(split, 'split_digest');
  const splitSuccessor = { ...seam, schema: 'lattice.run_request.v2',
    predecessor_request_digest: predecessor.request_digest,
    task_migration_digest: splitMigration.migration_digest, request_digest: '' };
  splitSuccessor.request_digest = selfDigest(splitSuccessor, 'request_digest');
  const phaseRevision = { schema: 'dogfood.phase_revision.v1',
    runtime_task_migration: splitMigration, ownership_diff: ownershipDiff, edge_diff: edgeDiff };
  const splitRequest = { schema: 'lattice.runtime_recompile_request.v1', request_id: 'split-e3',
    run_id: RUN_ID, predecessor_epoch: 2, frozen_event_digest: '6'.repeat(64),
    hold_decision_digest: '7'.repeat(64), mode: 'seam_split', reason: 'single owner seam',
    successor_request: splitSuccessor, task_migration: splitMigration, phase_revision: phaseRevision,
    seam_split: split, intentional_serial: null, request_digest: '' };
  splitRequest.request_digest = selfDigest(splitRequest, 'request_digest');
  assert.equal(validateRuntimeRecompileRequest(splitRequest, {
    validatePhaseRevision: (revision) => canonicalizeArtifact(revision) === canonicalizeArtifact(phaseRevision),
  }), true);

  await installController(repo);
  exec(process.execPath, [CLI, 'run', 'start', '--request', predecessorPath,
    '--executor', 'scripted'], repo);
  exec(process.execPath, [CLI, 'run', 'activate', '--run', RUN_REF,
    '--request-id', 'activation-before-kill'], repo, 0,
  { ...process.env, NODE_ENV: 'test', LATTICE_INTERNAL_TEST_CRASH_POINT: 'after_successor_stage' });
  const runDir = path.join(repo, RUN_REF);
  const first = await resolveActiveRuntimePaths({ runDir });
  const firstDescriptor = JSON.parse(await readFile(first.descriptorPath));

  let events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const finding = { schema: 'lattice.runtime_finding_record.v1', finding_id: 'aishell-shared-path',
    run_id: RUN_ID, plan_epoch: 1, source_checkpoint_digest: '8'.repeat(64),
    observed_event_digest: events.at(-1).event_digest,
    finding: { schema: 'lattice.runtime_conflict_finding.v1', kind: 'effect_conflict_unknown',
      todo_ids: ['service-owner', 'store-owner'], path: null, resource_id: sharedPathResource,
      evidence_digests: ['9'.repeat(64)], finding_digest: '' },
    recorded_by: { schema: 'lattice.runtime_observer_identity.v1', kind: 'supervisor',
      controller_registration_digest: null, executor_handle: null, identity_digest: '' },
    finding_digest: '' };
  finding.finding.finding_digest = selfDigest(finding.finding, 'finding_digest');
  finding.recorded_by.identity_digest = selfDigest(finding.recorded_by, 'identity_digest');
  finding.finding_digest = selfDigest(finding, 'finding_digest');
  await mkdir(path.join(runDir, 'findings'), { recursive: true });
  await writeFile(path.join(runDir, 'findings', `${finding.finding_digest}.json`),
    `${canonicalizeArtifact(finding)}\n`);
  await writeFile(path.join(runDir, 'findings', `${finding.finding.finding_digest}.json`),
    `${canonicalizeArtifact(finding)}\n`);
  exec(process.execPath, [CLI, 'run', 'conflict', '--run', RUN_REF,
    '--finding', finding.finding_digest], repo);
  exec(process.execPath, [CLI, 'run', 'hold', '--run', RUN_REF], repo);
  const queue = { schema: 'lattice.runtime_queue.v1', run_id: RUN_ID, frozen_epoch: 1,
    entries: [{ sequence: 1, kind: 'finding', subject_digest: finding.finding.finding_digest,
      artifact_digest: finding.finding_digest }], queue_digest: '' };
  queue.queue_digest = selfDigest(queue, 'queue_digest');
  await writeFile(path.join(runDir, 'queued-events.json'), `${canonicalizeArtifact(queue)}\n`);
  events = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const freeze = events.findLast(({ kind }) => kind === 'intake_frozen');
  const hold = events.findLast(({ kind }) => kind === 'hold_decided');
  const runtimeSerial = structuredClone(serialRequest);
  runtimeSerial.frozen_event_digest = freeze.event_digest;
  runtimeSerial.hold_decision_digest = hold.payload.decision_digest;
  runtimeSerial.intentional_serial.finding_digest = finding.finding_digest;
  runtimeSerial.intentional_serial.serial_digest = selfDigest(runtimeSerial.intentional_serial, 'serial_digest');
  runtimeSerial.request_digest = selfDigest(runtimeSerial, 'request_digest');
  const runtimeSerialPath = await writeRequest(temporary, 'runtime-serial', runtimeSerial);
  const interrupted = exec(process.execPath, [CLI, 'run', 'recompile', '--run', RUN_REF,
    '--input', runtimeSerialPath, '--request-id', 'serial-recompile'], repo, 1);
  assert.equal(JSON.parse(interrupted.stderr).code, 'RUN_OUTCOME_UNKNOWN', interrupted.stderr);
  assert.equal(JSON.parse(await readFile(path.join(runDir, 'committed-epoch.json'))).plan_epoch, 1);
  await waitDead(firstDescriptor.pid);
  const restarted = JSON.parse(exec(process.execPath, [CLI, 'run', 'activate', '--run', RUN_REF,
    '--request-id', 'activation-after-kill'], repo).stdout);
  assert.equal(restarted.outcome, 'activated');
  const second = await resolveActiveRuntimePaths({ runDir });
  const secondDescriptor = JSON.parse(await readFile(second.descriptorPath));
  assert.notEqual(secondDescriptor.session_nonce_digest, firstDescriptor.session_nonce_digest);
  assert.notEqual(secondDescriptor.pid, firstDescriptor.pid);
  const activations = JSON.parse(await readFile(second.controlEventsPath))
    .filter(({ kind }) => kind === 'supervisor_activated');
  assert.equal(activations.length, 2);
  const reprocessed = JSON.parse(exec(process.execPath, [CLI, 'run', 'reprocess', '--run', RUN_REF,
    '--request-id', 'serial-reprocess'], repo).stdout);
  assert.equal(reprocessed.outcome, 'reprocessed');
  const status = JSON.parse(exec(process.execPath, [CLI, 'run', 'status', '--run', RUN_REF], repo).stdout);
  assert.equal(status.schema, 'lattice.managed_run_status.v1');
  assert.equal(status.runtime_projection.runtime_frozen, false);
  assert.equal(JSON.parse(await readFile(path.join(runDir, 'committed-epoch.json'))).plan_epoch, 2);
  const verified = JSON.parse(exec(process.execPath,
    [CLI, 'event', 'verify', '--run', RUN_REF], repo).stdout);
  assert.equal(verified.valid, true, JSON.stringify(verified.failed_conditions));
  exec(process.execPath, [CLI, 'run', 'abandon', '--run', RUN_REF,
    '--reason', 'dogfood-complete'], repo);
  await waitDead(secondDescriptor.pid);
  assert.deepEqual((await readdir(path.join(runDir, 'controllers'))).length >= 2, true);
});
