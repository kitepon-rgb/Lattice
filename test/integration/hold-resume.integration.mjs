import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selfDigest } from '../../src/runtime-contracts.mjs';

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

// 請求項7・8の再開側。**barrierは全workerを止める**——静止の証明はrun全体に対して要るからで
// ある。だがhold裁定は止めた相手を`hold_set`と`continue_set`へ分ける。裁定を出しただけで
// processへ反映しなければ、続けてよいと判定した作業も止まったままになる。
test('holdは全workerを止め、再開はrebindまで起きない', managedDaemon, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-hold-resume-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
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

  // **holdの直後は、continue_setも止まったままが正しい。** rebindは静止を要求する
  // （`write_enabled === false`）ので、ここで再開すると後継epochへ束ね直せない。
  // carry-overは「作業を捨てない」であって「一度も止まらない」ではない。
  const pidOf = (todoId) => runEvents.findLast((event) => event.kind === 'executor_dispatched'
    && event.subject?.ref === todoId)?.payload?.direct_os_observation_binding?.process_pid;
  const stateOf = (pid) => invoke('ps', ['-o', 'stat=', '-p', String(pid)], repoRoot).stdout.trim();
  for (const todoId of [...decided.payload.hold_set, ...decided.payload.continue_set]) {
    assert.equal(stateOf(pidOf(todoId)).startsWith('T'), true,
      `hold後に止まっていない: ${todoId}`);
  }
  // 再開はrebindの後にしか起きない。holdだけを通したこの時点では記録が無いのが正しい。
  const control = JSON.parse(await readFile(path.join(runDir, 'control-events.json'), 'utf8'));
  assert.equal(control.find((event) => event.kind === 'workers_resumed'), undefined,
    'rebind前に再開している');

  ok(cli(['run', 'abandon', '--run', runRef, '--reason', 'acceptance'], repoRoot), 'run abandon');
  // 破棄の決定として終了が記録され、processが残らないこと。
  const after = JSON.parse(await readFile(path.join(runDir, 'control-events.json'), 'utf8'));
  assert.notEqual(after.find((event) => event.kind === 'worker_processes_terminated'), undefined,
    '破棄の記録が無い');
  for (const todoId of [...decided.payload.hold_set, ...decided.payload.continue_set]) {
    assert.equal(stateOf(pidOf(todoId)), '', `worker processが残っている: ${todoId}`);
  }
});
