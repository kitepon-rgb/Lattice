import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  lstat,
  realpath,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeTest from 'node:test';

const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

import {
  selfDigest,
  validateExecutorReceipt,
} from '../../src/runtime-contracts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const CONTROLLER = path.join(ROOT, 'bin', 'lattice-scripted-adapter.mjs');

function invoke(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      FORCE_COLOR: undefined,
      NO_COLOR: '1',
      LATTICE_DASHBOARD_AUTOSTART: '0',
    },
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

function recordAcceptance(command, result) {
  if (process.env.LATTICE_ACCEPTANCE_LOG !== '1') return result;
  process.stdout.write([
    `$ ${command}`,
    `exit: ${result.status}`,
    `stdout: ${result.stdout.trim() || '(empty)'}`,
    `stderr: ${result.stderr.trim() || '(empty)'}`,
    '',
  ].join('\n'));
  return result;
}

test('配布scripted controllerで公開CLIのactivateから子receipt受理とcloseまで完走する', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-scripted-controller-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/\n');
  await writeFile(path.join(repoRoot, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  await writeFile(
    path.join(repoRoot, 'test', 'alpha.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { alpha } from '../src/alpha.mjs';\ntest('alpha', () => assert.equal(alpha, 1));\n",
  );
  await writeFile(path.join(repoRoot, 'adapter-config.json'), '{"mode":"deterministic"}\n');

  assertSuccess(recordAcceptance(
    'git init --quiet --initial-branch=main',
    invoke('git', ['init', '--quiet', '--initial-branch=main'], repoRoot),
  ), 'git init');
  assertSuccess(
    invoke('git', ['-c', 'user.email=a@example.invalid', '-c', 'user.name=a', 'add', '.'], repoRoot),
    'git add',
  );
  assertSuccess(invoke('git', [
    '-c',
    'user.email=a@example.invalid',
    '-c',
    'user.name=a',
    'commit',
    '--quiet',
    '-m',
    'acceptance base',
  ], repoRoot), 'git commit');
  const baseShaResult = invoke('git', ['rev-parse', 'HEAD'], repoRoot);
  assertSuccess(baseShaResult, 'git rev-parse HEAD');
  const baseSha = baseShaResult.stdout.trim();

  const sensorInit = recordAcceptance(
    'lattice sensor init . --json',
    invokeCli(['sensor', 'init', '.', '--json'], repoRoot),
  );
  assertSuccess(sensorInit, 'sensor init');
  const clean = recordAcceptance(
    'git status --porcelain',
    invoke('git', ['status', '--porcelain'], repoRoot),
  );
  assertSuccess(clean, 'git status');
  assert.equal(clean.stdout, '');

  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'scripted-controller-acceptance',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
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
            {
              query_id: 'q-alpha',
              expect: { kind: 'symbol', name: 'alpha', path: 'src/alpha.mjs' },
            },
            {
              query_id: 'q-alpha-affected',
              expect: { kind: 'affected', path: 'src/alpha.mjs' },
            },
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
  const requestPath = path.join(temporaryRoot, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);

  const compiled = recordAcceptance(
    'lattice plan compile --request request.json',
    invokeCli(['plan', 'compile', '--request', requestPath], repoRoot),
  );
  assertSuccess(compiled, 'plan compile');
  const started = recordAcceptance(
    'lattice run start --request request.json --executor scripted',
    invokeCli(['run', 'start', '--request', requestPath, '--executor', 'scripted'], repoRoot),
  );
  assertSuccess(started, 'run start');
  const runRef = JSON.parse(started.stdout).run_dir;

  const registrationInput = {
    schema: 'lattice.runtime_adapter_registration_input.v1',
    adapter_kind: 'scripted',
    launch_kind: 'host_binary',
    binary_path: process.execPath,
    argv: [CONTROLLER],
    config_ref: 'adapter-config.json',
  };
  const registrationPath = path.join(temporaryRoot, 'adapter.json');
  await writeFile(registrationPath, `${JSON.stringify(registrationInput)}\n`);
  const registered = recordAcceptance(
    'lattice run adapter register --input adapter.json',
    invokeCli(['run', 'adapter', 'register', '--input', registrationPath], repoRoot),
  );
  assertSuccess(registered, 'adapter register');

  const activated = recordAcceptance(
    `lattice run activate --run ${runRef}`,
    invokeCli(['run', 'activate', '--run', runRef], repoRoot),
  );
  assertSuccess(activated, 'run activate');

  const observed = recordAcceptance(
    `lattice run observe --run ${runRef}`,
    invokeCli(['run', 'observe', '--run', runRef], repoRoot),
  );
  assertSuccess(observed, 'run observe');
  assert.deepEqual(JSON.parse(observed.stdout).accepted, ['T1']);
  const status = recordAcceptance(
    `lattice run status --run ${runRef}`,
    invokeCli(['run', 'status', '--run', runRef], repoRoot),
  );
  assertSuccess(status, 'run status');
  assert.deepEqual(JSON.parse(status.stdout).accepted, ['T1']);
  assert.deepEqual(JSON.parse(status.stdout).running, []);

  const runDir = path.join(repoRoot, ...runRef.split('/'));
  const events = JSON.parse(await readFile(path.join(runDir, 'events.json'), 'utf8'));
  const dispatch = events.find((event) => event.kind === 'executor_dispatched');

  // workerは自分の木へ書く。canonical repoは触られない——共有rootでは書き込みの帰属を
  // rootから決められず、早期警報もcheckpoint判定も成立しないからである。
  const worktreePath = dispatch.payload.direct_os_observation_binding.worktree_path;
  assert.equal(worktreePath.startsWith(path.join(await realpath(runDir), 'worktrees')), true,
    worktreePath);
  assert.notEqual(worktreePath, await realpath(repoRoot));
  const written = JSON.parse(await readFile(path.join(worktreePath, 'src', 'alpha.mjs'), 'utf8'));
  assert.equal(written.schema, 'lattice.scripted_adapter_write.v1');
  assert.equal(written.todo_id, 'T1');
  assert.equal(await readFile(path.join(repoRoot, 'src', 'alpha.mjs'), 'utf8'),
    'export const alpha = 1;\n');
  // run store配下なのでcanonical repoのstatusも汚れない。
  assert.equal(invoke('git', ['status', '--porcelain'], repoRoot).stdout, '');
  const receiptEvent = events.find((event) => event.kind === 'receipt_recorded');
  assert.equal(validateExecutorReceipt(receiptEvent.payload), true);
  assert.equal(receiptEvent.payload.packet_digest, dispatch.payload.packet_digest);
  assert.equal(receiptEvent.payload.base_sha, baseSha);
  assert.equal(receiptEvent.payload.plan_epoch, 1);
  assert.equal(receiptEvent.payload.executor_handle, dispatch.payload.executor_handle);
  assert.equal(receiptEvent.payload.worktree_id, dispatch.payload.worktree_id);
  assert.deepEqual(receiptEvent.payload.observed_diff, [
    { path: 'src/alpha.mjs', change: 'modified' },
  ]);
  const controllerId = (await readdir(path.join(runDir, 'controllers')))[0];
  const socketInfo = await lstat(path.join(
    runDir,
    'supervisor',
    'controllers',
    `${controllerId}.sock`,
  ));
  assert.equal(socketInfo.mode & 0o077, 0);

  const closed = recordAcceptance(
    `lattice run close --run ${runRef}`,
    invokeCli(['run', 'close', '--run', runRef], repoRoot),
  );
  assertSuccess(closed, 'run close');
  assert.equal(JSON.parse(closed.stdout).outcome, 'closed');
});
