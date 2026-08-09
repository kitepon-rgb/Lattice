import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selfDigest } from '../../src/runtime-contracts.mjs';
import { registerManagedDaemonFixture } from '../helpers/managed-daemon-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const CONTROLLER = path.join(ROOT, 'bin', 'lattice-scripted-adapter.mjs');
const ENV = {
  ...process.env,
  FORCE_COLOR: undefined,
  NO_COLOR: '1',
  LATTICE_DASHBOARD_AUTOSTART: '0',
};

function invoke(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: ENV,
  });
  assert.equal(result.error, undefined);
  return result;
}

function invokeCli(args, cwd) {
  return invoke(process.execPath, [CLI, ...args], cwd);
}

function assertSuccess(result, command) {
  assert.equal(result.status, 0, `${command}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
}

function parseCli(args, cwd) {
  const result = invokeCli(args, cwd);
  assertSuccess(result, `lattice ${args.join(' ')}`);
  return JSON.parse(result.stdout);
}

async function waitForProjection(args, cwd, predicate) {
  const deadline = Date.now() + 15_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = parseCli(args, cwd);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`driver projectionが期限内に現れない: ${JSON.stringify(latest)}`);
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function createManagedRun(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'lattice-driver-projection-'));
  const tracked = [];
  registerManagedDaemonFixture(t, temporary, { tracked });
  const repoRoot = path.join(temporary, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/\n');
  await writeFile(path.join(repoRoot, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  await writeFile(
    path.join(repoRoot, 'test', 'alpha.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { alpha } from '../src/alpha.mjs';\ntest('alpha', () => assert.equal(alpha, 1));\n",
  );
  await writeFile(
    path.join(repoRoot, 'adapter-config.json'),
    `${JSON.stringify({ mode: 'deterministic', hold_ms: 4_000 })}\n`,
  );

  assertSuccess(invoke('git', ['init', '--quiet', '--initial-branch=main'], repoRoot), 'git init');
  assertSuccess(invoke('git', [
    '-c', 'user.email=a@example.invalid', '-c', 'user.name=a', 'add', '.',
  ], repoRoot), 'git add');
  assertSuccess(invoke('git', [
    '-c', 'user.email=a@example.invalid', '-c', 'user.name=a',
    'commit', '--quiet', '-m', 'driver projection base',
  ], repoRoot), 'git commit');
  const base = invoke('git', ['rev-parse', 'HEAD'], repoRoot);
  assertSuccess(base, 'git rev-parse HEAD');
  assertSuccess(invokeCli(['sensor', 'init', '.', '--json'], repoRoot), 'sensor init');

  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'driver-projection-acceptance',
    repo: { base_sha: base.stdout.trim(), root_kind: 'git-worktree' },
    capacity: { executors: 1 },
    todos: [{ todo_id: 'T1' }],
    manual_witness: {
      T1: {
        owns: [
          { kind: 'symbol', target: 'alpha' },
          { kind: 'path', target: 'src/alpha.mjs' },
        ],
        reads: [],
        writes: ['src/alpha.mjs'],
        resources: [],
        state_effects: [],
        sensor_provenance: {
          queries: [
            { query_id: 'q-alpha', expect: { kind: 'symbol', name: 'alpha', path: 'src/alpha.mjs' } },
            { query_id: 'q-alpha-affected', expect: { kind: 'affected', path: 'src/alpha.mjs' } },
          ],
        },
        affected_tests: ['test/alpha.test.mjs'],
        unknowns: [],
      },
    },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-alpha', operation: 'query', target: 'alpha' },
        { id: 'q-alpha-affected', operation: 'affected', target: 'src/alpha.mjs' },
      ],
    },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
    request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(temporary, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  assertSuccess(invokeCli(['plan', 'compile', '--request', requestPath], repoRoot), 'plan compile');
  const started = invokeCli([
    'run', 'start', '--request', requestPath, '--executor', 'scripted',
  ], repoRoot);
  assertSuccess(started, 'run start');
  const runRef = JSON.parse(started.stdout).run_dir;

  const registration = {
    schema: 'lattice.runtime_adapter_registration_input.v1',
    adapter_kind: 'scripted',
    launch_kind: 'host_binary',
    binary_path: process.execPath,
    argv: [CONTROLLER],
    config_ref: 'adapter-config.json',
  };
  const registrationPath = path.join(temporary, 'adapter.json');
  await writeFile(registrationPath, `${JSON.stringify(registration)}\n`);
  assertSuccess(invokeCli([
    'run', 'adapter', 'register', '--input', registrationPath,
  ], repoRoot), 'adapter register');
  return { repoRoot, runRef, tracked };
}

test('別processのobserve/statusがforeground driverの待機対象と停止を区別する', {
  skip: process.platform === 'darwin' ? false : 'process start identity観測はmacOS契約',
}, async (t) => {
  const { repoRoot, runRef, tracked } = await createManagedRun(t);

  assert.deepEqual(parseCli(['run', 'observe', '--run', runRef], repoRoot).driver_state, 'stopped');
  assert.equal(parseCli(['run', 'status', '--run', runRef], repoRoot).waiting_on, null);

  const help = invokeCli(['run', 'activate', '--help'], repoRoot);
  assertSuccess(help, 'run activate --help');
  assert.match(help.stdout, /全waveが完了するまで戻らないforeground driver/u);
  assert.match(help.stdout, /driver_stateとwaiting_on/u);

  const activated = spawn(process.execPath, [CLI, 'run', 'activate', '--run', runRef], {
    cwd: repoRoot,
    env: ENV,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tracked.push(activated.pid);
  const activationResult = waitForChild(activated);

  const observation = await waitForProjection(
    ['run', 'observe', '--run', runRef],
    repoRoot,
    (value) => value.driver_state === 'driving'
      && value.waiting_on?.kind === 'executor_completion'
      && value.waiting_on.todo_ids.join(',') === 'T1',
  );
  assert.equal(observation.driver_state, 'driving');
  const status = await waitForProjection(
    ['run', 'status', '--run', runRef],
    repoRoot,
    (value) => value.driver_state === 'driving',
  );
  assert.deepEqual(status.waiting_on, { kind: 'executor_completion', todo_ids: ['T1'] });

  const completed = await activationResult;
  assert.equal(completed.status, 0,
    `run activate\nstdout: ${completed.stdout}\nstderr: ${completed.stderr}`);
  assert.equal(completed.signal, null);

  assert.deepEqual(parseCli(['run', 'observe', '--run', runRef], repoRoot).driver_state, 'stopped');
  assert.equal(parseCli(['run', 'status', '--run', runRef], repoRoot).waiting_on, null);
  const closed = invokeCli(['run', 'close', '--run', runRef], repoRoot);
  assertSuccess(closed, 'run close');
});
