import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selfDigest } from '../../src/runtime-contracts.mjs';
import { registerManagedDaemonFixture } from '../helpers/managed-daemon-fixture.mjs';

// ADR 0125受入。disposable repoで公開CLIだけを使い、adapter未登録の行き止まりが
// controller起動段階の失敗へ進むことを実測する。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');

function invoke(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
  assert.equal(result.error, undefined);
  return result;
}

function invokeCli(args, cwd) {
  return invoke(process.execPath, [CLI, ...args], cwd);
}

function assertSuccess(result, command) {
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
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

// 実daemonを起こすこの面は、いまmacOSでだけ検証している。Linuxでは管理runtimeの
// daemon lifecycleが通らない（CIで実測）。**skipは「Linuxで動く」という主張ではない**——
// 未検証であることを明示する印であり、Linux対応はbacklogの「管理runtimeのLinux検証」が持つ。
const managedDaemon = {
  skip: process.platform === 'darwin' ? false : 'managed runtime daemon is verified on macOS only',
};

test('公開CLIだけでregister後のrun activateはADAPTER_NOT_REGISTEREDを越える', managedDaemon, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-adapter-acceptance-'));
  registerManagedDaemonFixture(t, temporaryRoot);
  const repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/runs/\n.lattice/sensor/\n');
  await writeFile(path.join(repoRoot, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  await writeFile(path.join(repoRoot, 'test', 'alpha.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { alpha } from '../src/alpha.mjs';\ntest('alpha', () => assert.equal(alpha, 1));\n");
  await writeFile(path.join(repoRoot, 'adapter-config.json'), '{"fixture":true}\n');

  const gitInit = recordAcceptance(
    'git init --quiet --initial-branch=main',
    invoke('git', ['init', '--quiet', '--initial-branch=main'], repoRoot),
  );
  assertSuccess(gitInit, 'git init');
  assertSuccess(invoke('git', ['-c', 'user.email=a@example.invalid', '-c', 'user.name=a', 'add', '.'], repoRoot), 'git add');
  assertSuccess(invoke('git', [
    '-c', 'user.email=a@example.invalid', '-c', 'user.name=a',
    'commit', '--quiet', '-m', 'acceptance base',
  ], repoRoot), 'git commit');
  const baseShaResult = invoke('git', ['rev-parse', 'HEAD'], repoRoot);
  assertSuccess(baseShaResult, 'git rev-parse HEAD');
  const baseSha = baseShaResult.stdout.trim();

  const sensorInit = recordAcceptance(
    'lattice sensor init . --json',
    invokeCli(['sensor', 'init', '.', '--json'], repoRoot),
  );
  assertSuccess(sensorInit, 'lattice sensor init . --json');
  assert.equal(JSON.parse(sensorInit.stdout).status, 'ok');

  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'adapter-acceptance-01',
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
  assertSuccess(compiled, 'lattice plan compile --request request.json');
  assert.equal(JSON.parse(compiled.stdout).schema, 'lattice.plan_compile_result.v1');

  const started = recordAcceptance(
    'lattice run start --request request.json --executor scripted',
    invokeCli(['run', 'start', '--request', requestPath, '--executor', 'scripted'], repoRoot),
  );
  assertSuccess(started, 'lattice run start --request request.json --executor scripted');
  const runRef = JSON.parse(started.stdout).run_dir;

  const input = {
    schema: 'lattice.runtime_adapter_registration_input.v1',
    adapter_kind: 'scripted',
    launch_kind: 'host_binary',
    binary_path: await realpath(process.execPath),
    argv: ['-e', 'process.exit(23)'],
    config_ref: 'adapter-config.json',
  };
  const inputPath = path.join(temporaryRoot, 'adapter.json');
  await writeFile(inputPath, `${JSON.stringify(input)}\n`);
  const registered = recordAcceptance(
    'lattice run adapter register --input adapter.json',
    invokeCli(['run', 'adapter', 'register', '--input', inputPath], repoRoot),
  );
  assertSuccess(registered, 'lattice run adapter register --input adapter.json');
  assert.equal(JSON.parse(registered.stdout).outcome, 'created');

  const activated = recordAcceptance(
    `lattice run activate --run ${runRef}`,
    invokeCli(['run', 'activate', '--run', runRef], repoRoot),
  );
  assert.equal(activated.status, 1, activated.stderr);
  const activationError = JSON.parse(activated.stderr);
  assert.notEqual(activationError.code, 'ADAPTER_NOT_REGISTERED');
  assert.equal(activationError.code, 'ADAPTER_CONTROLLER_UNAVAILABLE');
});
