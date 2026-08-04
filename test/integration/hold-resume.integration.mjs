import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createHash } from 'node:crypto';

import { selfDigest } from '../../src/runtime-contracts.mjs';
import { registerManagedDaemonFixture } from '../helpers/managed-daemon-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const CONTROLLER = path.join(ROOT, 'bin', 'lattice-scripted-adapter.mjs');

// 実daemonを起こす面はmacOSでのみ検証している（backlog「管理runtimeのLinux検証」）。
// skipは「Linuxで動く」という主張ではなく、未検証であることの印である。
const managedDaemon = {
  skip: process.platform === 'darwin' ? false : 'managed runtime daemon is verified on macOS only',
};

function invoke(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0' },
  });
  assert.equal(result.error, undefined);
  return result;
}

const cli = (args, cwd) => invoke(process.execPath, [CLI, ...args], cwd);

function ok(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return result;
}

function witness(symbol) {
  const writePath = `src/${symbol}.mjs`;
  return {
    owns: [{ kind: 'symbol', target: symbol }, { kind: 'path', target: writePath }],
    reads: [], writes: [writePath], resources: [], state_effects: [],
    sensor_provenance: { queries: [
      { query_id: `q-${symbol}`, expect: { kind: 'symbol', name: symbol, path: writePath } },
      { query_id: `q-${symbol}-affected`, expect: { kind: 'affected', path: writePath } },
    ] },
    affected_tests: [`test/${symbol}.test.mjs`], unknowns: [],
  };
}

const unitTest = (symbol) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n`
  + `import { ${symbol} } from '../src/${symbol}.mjs';\ntest('${symbol}', () => assert.ok(${symbol}));\n`;

// 請求項7・8の再開側。barrierは競合の影響群だけを止め、`continue_set`のworkerは
// origin bindingを保ったまま走り続ける。後継epochへ移すのは`hold_set`だけである。
test('競合群だけをholdし、無関係workerはoriginのまま継続する', managedDaemon, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-hold-resume-'));
  registerManagedDaemonFixture(t, temporaryRoot);
  const repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/\n');
  for (const symbol of ['alpha', 'beta', 'gamma']) {
    await writeFile(path.join(repoRoot, 'src', `${symbol}.mjs`), `export const ${symbol} = 1;\n`);
    await writeFile(path.join(repoRoot, 'test', `${symbol}.test.mjs`), unitTest(symbol));
  }
  // T2が宣言外のsrc/alpha.mjs——T1のscope——へも書く。T3は無関係なのでcontinue_setへ落ちる。
  await writeFile(path.join(repoRoot, 'adapter-config.json'),
    `${JSON.stringify({ mode: 'deterministic', hold_ms: 10_000, extra_writes: ['src/alpha.mjs'] })}\n`);

  const git = (...args) => ok(invoke('git', ['-c', 'user.email=a@example.invalid',
    '-c', 'user.name=a', ...args], repoRoot), `git ${args[0]}`);
  ok(invoke('git', ['init', '--quiet', '--initial-branch=main'], repoRoot), 'git init');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  const baseSha = ok(invoke('git', ['rev-parse', 'HEAD'], repoRoot), 'rev-parse').stdout.trim();
  ok(cli(['sensor', 'init', '.', '--json'], repoRoot), 'sensor init');

  const queries = (symbol) => [
    { id: `q-${symbol}`, operation: 'query', target: symbol },
    { id: `q-${symbol}-affected`, operation: 'affected', target: `src/${symbol}.mjs` },
  ];
  const request = {
    schema: 'lattice.run_request.v1', request_id: 'hold-resume-live',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 3 },
    todos: [{ todo_id: 'T1' }, { todo_id: 'T2' }, { todo_id: 'T3' }],
    manual_witness: { T1: witness('alpha'), T2: witness('beta'), T3: witness('gamma') },
    sensor_query_set: { queries: [{ id: 'q-status', operation: 'status' },
      ...queries('alpha'), ...queries('beta'), ...queries('gamma')] },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum', request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(temporaryRoot, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  ok(cli(['plan', 'compile', '--request', requestPath], repoRoot), 'plan compile');
  const runRef = JSON.parse(ok(cli(['run', 'start', '--request', requestPath,
    '--executor', 'scripted'], repoRoot), 'run start').stdout).run_dir;
  await writeFile(path.join(temporaryRoot, 'adapter.json'), `${JSON.stringify({
    schema: 'lattice.runtime_adapter_registration_input.v1',
    adapter_kind: 'scripted', launch_kind: 'host_binary', binary_path: process.execPath,
    argv: [CONTROLLER], config_ref: 'adapter-config.json',
  })}\n`);
  ok(cli(['run', 'adapter', 'register', '--input', path.join(temporaryRoot, 'adapter.json')],
    repoRoot), 'adapter register');
  ok(cli(['run', 'activate', '--run', runRef], repoRoot), 'run activate');

  const runDir = path.join(repoRoot, ...runRef.split('/'));
  const runEvents = JSON.parse(await readFile(path.join(runDir, 'events.json'), 'utf8'));
  const decided = runEvents.find((event) => event.kind === 'hold_decided');
  assert.notEqual(decided, undefined, runEvents.map((e) => e.kind).join(','));
  assert.ok(decided.payload.continue_set.length > 0, JSON.stringify(decided.payload));

  // holdの直後、競合当事者だけが停止し、無関係なcontinue_setは止まらない。
  const pidOf = (todoId) => runEvents.findLast((event) => event.kind === 'executor_dispatched'
    && event.subject?.ref === todoId)?.payload?.direct_os_observation_binding?.process_pid;
  const stateOf = (pid) => invoke('ps', ['-o', 'stat=', '-p', String(pid)], repoRoot).stdout.trim();
  for (const todoId of decided.payload.hold_set) {
    assert.equal(stateOf(pidOf(todoId)).startsWith('T'), true, `hold後に止まっていない: ${todoId}`);
  }
  for (const todoId of decided.payload.continue_set) {
    assert.equal(stateOf(pidOf(todoId)).startsWith('T'), false, `無関係workerまで停止した: ${todoId}`);
  }
  const beforeRecompile = JSON.parse(await readFile(path.join(runDir, 'control-events.json'), 'utf8'));
  assert.equal(beforeRecompile.find((event) => event.kind === 'workers_resumed'), undefined,
    'rebind前に再開している');

  // **止めた相手を後継epochへ繋ぎ直し、そこで再開する。** 請求項7の「一方を停止し、
  // 他方を確定し、停止した方を再開する」の後半がここで成立する。
  const conflict = runEvents.findLast((event) => event.kind === 'conflict_found');
  assert.equal(conflict.payload.kind, 'observed_write_conflict', JSON.stringify(conflict.payload));
  const frozen = runEvents.findLast((event) => event.kind === 'intake_frozen');
  const sha16 = (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
  const migration = { schema: 'lattice.runtime_task_migration.v1',
    entries: ['T1', 'T2', 'T3'].map((id) => ({ predecessor_task_id: id, disposition: 'stay',
      successor_task_ids: [id], reason: 'serialize contested path', evidence_digests: [] })),
    migration_digest: '' };
  migration.migration_digest = selfDigest(migration, 'migration_digest');
  const successor = { schema: 'lattice.run_request.v2', request_id: request.request_id,
    repo: request.repo, capacity: request.capacity, todos: request.todos,
    manual_witness: request.manual_witness, sensor_query_set: request.sensor_query_set,
    executor_capability: request.executor_capability, claim_mode: request.claim_mode,
    predecessor_request_digest: request.request_digest,
    task_migration_digest: migration.migration_digest, request_digest: '' };
  successor.request_digest = selfDigest(successor, 'request_digest');
  const contested = [...conflict.payload.todo_ids].sort();
  const serial = { schema: 'lattice.runtime_intentional_serial.v1',
    finding_digest: conflict.payload.finding_digest, todo_ids: contested,
    // 係争pathから導出する。path findingにresource_idは無い（finding契約がそう定めている）。
    resource_id: `own-path-${sha16(conflict.payload.path)}`,
    stay_todo_id: contested[0], reason: 'serialize contested path', serial_digest: '' };
  serial.serial_digest = selfDigest(serial, 'serial_digest');
  const recompile = { schema: 'lattice.runtime_recompile_request.v1', request_id: 'serial-r1',
    run_id: request.request_id, predecessor_epoch: 1,
    frozen_event_digest: frozen.event_digest,
    hold_decision_digest: decided.payload.decision_digest,
    mode: 'intentional_serial', reason: 'path conflict serialization',
    successor_request: successor, task_migration: migration, phase_revision: null,
    seam_split: null, intentional_serial: serial, request_digest: '' };
  recompile.request_digest = selfDigest(recompile, 'request_digest');
  const recompilePath = path.join(temporaryRoot, 'recompile.json');
  await writeFile(recompilePath, `${JSON.stringify(recompile)}\n`);
  const recompiled = ok(cli(['run', 'recompile', '--run', runRef, '--input', recompilePath],
    repoRoot), 'run recompile');
  assert.equal(JSON.parse(recompiled.stdout).outcome, 'recompiled');

  const afterRecompile = JSON.parse(await readFile(path.join(runDir, 'control-events.json'), 'utf8'));
  assert.equal(afterRecompile.find((event) => event.kind === 'epoch_rebind_acknowledged'),
    undefined, '無関係workerをrebindしている');
  assert.equal(afterRecompile.find((event) => event.kind === 'workers_resumed'),
    undefined, '止めていないworkerへresumeを発行している');

  // 無関係workerはoriginのまま継続し、競合当事者だけが止まったまま残る。
  const afterEvents = JSON.parse(await readFile(path.join(runDir, 'events.json'), 'utf8'));
  assert.equal(afterEvents.some((event) => event.kind === 'epoch_rebound'), false,
    '無関係workerを別epochへ付け替えている');
  for (const todoId of decided.payload.hold_set) {
    assert.equal(stateOf(pidOf(todoId)).startsWith('T'), true, `当事者が止まっていない: ${todoId}`);
  }
  for (const todoId of decided.payload.continue_set) {
    assert.equal(stateOf(pidOf(todoId)).startsWith('T'), false, `無関係workerが停止した: ${todoId}`);
  }

  ok(cli(['run', 'abandon', '--run', runRef, '--reason', 'acceptance'], repoRoot), 'run abandon');
  // 破棄の決定として終了が記録され、processが残らないこと。
  const after = JSON.parse(await readFile(path.join(runDir, 'control-events.json'), 'utf8'));
  assert.notEqual(after.find((event) => event.kind === 'worker_processes_terminated'), undefined,
    '破棄の記録が無い');
  for (const todoId of [...decided.payload.hold_set, ...decided.payload.continue_set]) {
    assert.equal(stateOf(pidOf(todoId)), '', `worker processが残っている: ${todoId}`);
  }
});
