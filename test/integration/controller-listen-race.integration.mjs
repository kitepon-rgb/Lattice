import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selfDigest } from '../../src/runtime-contracts.mjs';
import { registerManagedDaemonFixture } from '../helpers/managed-daemon-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const DELAYED_CONTROLLER = path.join(ROOT, 'test', 'helpers', 'scripted-adapter-listen-delay.mjs');
const ENV = { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0' };

function invoke(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, env: ENV });
  assert.equal(result.error, undefined);
  return result;
}

function ok(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return result;
}

const cli = (args, cwd) => invoke(process.execPath, [CLI, ...args], cwd);

// controllerのsocket file出現はbindの証拠でありlistenの証拠ではない。CI負荷下で
// controllerがbindとlistenの間でpreemptされると、supervisorの単発接続がECONNREFUSEDで
// 落ちていた（2026-08-22実被弾: runtime-conflict-cliのrestart activateがADAPTER_
// CONTROLLER_UNAVAILABLEで確率的に失敗）。wrapperがその盤面を決定論的に作り、
// supervisorがlisten受理まで起動待ちを続けてactivationを完走することを固定する。
test('controllerのbind後listen前の窓を踏んでもactivationは完走する', {
  skip: process.platform === 'darwin' ? false : 'managed runtime daemon is verified on macOS only',
}, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'lattice-listen-race-'));
  registerManagedDaemonFixture(t, temporary);
  const repoRoot = path.join(temporary, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/\n');
  await writeFile(path.join(repoRoot, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  await writeFile(path.join(repoRoot, 'test', 'alpha.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\n"
    + "import { alpha } from '../src/alpha.mjs';\ntest('alpha', () => assert.equal(alpha, 1));\n");
  await writeFile(path.join(repoRoot, 'adapter-config.json'),
    `${JSON.stringify({ mode: 'deterministic', hold_ms: 100 })}\n`);
  const git = (...args) => ok(invoke('git', ['-c', 'user.email=a@example.invalid',
    '-c', 'user.name=a', ...args], repoRoot), `git ${args.join(' ')}`);
  ok(invoke('git', ['init', '--quiet', '--initial-branch=main'], repoRoot), 'git init');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  const baseSha = ok(invoke('git', ['rev-parse', 'HEAD'], repoRoot), 'rev-parse').stdout.trim();
  ok(cli(['sensor', 'init', '.', '--json'], repoRoot), 'sensor init');

  const request = {
    schema: 'lattice.run_request.v1', request_id: 'listen-race-acceptance',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 1 },
    todos: [{ todo_id: 'T1' }],
    manual_witness: { T1: {
      owns: [{ kind: 'symbol', target: 'alpha' }, { kind: 'path', target: 'src/alpha.mjs' }],
      reads: [], writes: ['src/alpha.mjs'], resources: [], state_effects: [],
      sensor_provenance: { queries: [
        { query_id: 'q-alpha', expect: { kind: 'symbol', name: 'alpha', path: 'src/alpha.mjs' } },
        { query_id: 'q-alpha-affected', expect: { kind: 'affected', path: 'src/alpha.mjs' } },
      ] },
      affected_tests: ['test/alpha.test.mjs'], unknowns: [],
    } },
    sensor_query_set: { queries: [
      { id: 'q-status', operation: 'status' },
      { id: 'q-alpha', operation: 'query', target: 'alpha' },
      { id: 'q-alpha-affected', operation: 'affected', target: 'src/alpha.mjs' },
    ] },
    executor_capability: { adapters: ['scripted'] }, claim_mode: 'exact_minimum',
    request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(temporary, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  ok(cli(['plan', 'compile', '--request', requestPath], repoRoot), 'plan compile');
  const runRef = JSON.parse(ok(cli(['run', 'start', '--request', requestPath,
    '--executor', 'scripted'], repoRoot), 'run start').stdout).run_dir;
  await writeFile(path.join(temporary, 'adapter.json'), `${JSON.stringify({
    schema: 'lattice.runtime_adapter_registration_input.v1',
    adapter_kind: 'scripted', launch_kind: 'host_binary', binary_path: process.execPath,
    argv: [DELAYED_CONTROLLER, '--as-controller'], config_ref: 'adapter-config.json',
  })}\n`);
  ok(cli(['run', 'adapter', 'register', '--input', path.join(temporary, 'adapter.json')],
    repoRoot), 'adapter register');
  const activated = ok(cli(['run', 'activate', '--run', runRef], repoRoot), 'run activate');
  assert.equal(JSON.parse(activated.stdout).outcome, 'activated');
  ok(cli(['run', 'abandon', '--run', runRef, '--reason', 'acceptance'], repoRoot), 'run abandon');
});
