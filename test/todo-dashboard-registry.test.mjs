import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runTodoCli } from '../src/todo-cli.mjs';
import {
  adoptTodoDashboardActivity,
  ensureTodoDashboardDaemon,
  ensureTodoDashboardActivity,
  readActiveTodoDashboardProjects,
  readVisibleTodoDashboardProjects,
  registerTodoDashboardActivity,
  todoDashboardMemberNeedsVisibility,
  TODO_DASHBOARD_CODE_VERSION,
  TODO_DASHBOARD_STALE_MS,
} from '../src/todo-dashboard-registry.mjs';

test('監査判断待ちと棄却済みPhaseはactive taskが無くてもdashboardへ残す', () => {
  for (const status of ['gate_ready', 'reviewing', 'rejected']) {
    assert.equal(todoDashboardMemberNeedsVisibility({ phases: [{ phase_id: 'audit', status }] }), true);
  }
  for (const status of ['accepted', 'closed_unaudited']) {
    assert.equal(todoDashboardMemberNeedsVisibility({ phases: [{ phase_id: 'audit', status }] }), false);
  }
  assert.equal(todoDashboardMemberNeedsVisibility({}), false);
});

async function healthServer(body) {
  const server = createServer((request, response) => {
    if (request.url !== '/__lattice/health') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(`${JSON.stringify(typeof body === 'function' ? body() : body)}\n`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}

async function writeDaemonDescriptor(runtime, descriptor) {
  await writeFile(path.join(runtime, 'daemon.json'), `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });
}

test('dashboard --helpはdaemonやregistryを作らず終了する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-help-'));
  const runtime = path.join(root, 'runtime');
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.resolve('bin/lattice-dashboard.mjs'), '--help'], {
    cwd: process.cwd(),
    env: { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Usage: lattice-dashboard\n');
  await assert.rejects(stat(runtime), (error) => error.code === 'ENOENT');
});

test('session activity registryはprojectをupsertし期限切れentryを一覧から除外する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-registry-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_DASHBOARD_RUNTIME_DIR: path.join(root, 'runtime') };
  const current = new Date('2026-07-21T10:00:00.000Z');
  await registerTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
    displayName: '古い名前', sessionId: 'session-a', env,
    now: new Date(current.getTime() - TODO_DASHBOARD_STALE_MS - 1) });
  assert.deepEqual(await readActiveTodoDashboardProjects({ env, now: current.getTime() }), []);
  await registerTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
    displayName: 'Lattice', sessionId: 'session-b', env, now: current });
  const active = await readActiveTodoDashboardProjects({ env, now: current.getTime() });
  assert.equal(active.length, 1);
  assert.equal(active[0].display_name, 'Lattice');
  assert.equal(active[0].session_id, 'session-b');
});

test('同一project_idを別canonical rootから登録しても既存registryを置換しない', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-root-conflict-'));
  const canonical = path.join(root, 'canonical');
  const scratch = path.join(root, 'scratch');
  await Promise.all([mkdir(canonical), mkdir(scratch)]);
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_DASHBOARD_RUNTIME_DIR: path.join(root, 'runtime') };
  await registerTodoDashboardActivity({ repoRoot: canonical, projectId: 'bingo',
    displayName: 'Bingo', sessionId: 'canonical-session', env,
    now: new Date('2026-08-01T00:00:00.000Z') });
  const registryRef = path.join(root, 'runtime', 'projects.json');
  const before = await readFile(registryRef);

  await assert.rejects(registerTodoDashboardActivity({ repoRoot: scratch, projectId: 'bingo',
    displayName: 'Bingo scratch', sessionId: 'scratch-session', env,
    now: new Date('2026-08-01T00:01:00.000Z') }), (error) => {
    assert.equal(error.code, 'PROJECT_ROOT_CONFLICT');
    assert.deepEqual(error.detail, {
      project_id: 'bingo', next_action: 'lattice todo dashboard adopt --json',
    });
    assert.equal(error.message.includes(canonical), false);
    assert.equal(error.message.includes(scratch), false);
    return true;
  });
  assert.deepEqual(await readFile(registryRef), before);
  const [entry] = await readActiveTodoDashboardProjects({
    env, now: Date.parse('2026-08-01T00:01:00.000Z'),
  });
  assert.equal(entry.repo_root, await realpath(canonical));
  assert.equal(entry.session_id, 'canonical-session');

  const adopted = await adoptTodoDashboardActivity({ repoRoot: scratch, projectId: 'bingo',
    displayName: 'Bingo', sessionId: 'adopt-session', env,
    now: new Date('2026-08-01T00:02:00.000Z') });
  assert.equal(adopted.adopted, true);
  const [moved] = await readActiveTodoDashboardProjects({
    env, now: Date.parse('2026-08-01T00:02:00.000Z'),
  });
  assert.equal(moved.repo_root, await realpath(scratch));
  assert.equal(moved.session_id, 'adopt-session');
});

test('期限切れactivityでもstoreにactive runがあれば一覧へ残す', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-active-run-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_DASHBOARD_RUNTIME_DIR: path.join(root, 'runtime') };
  const current = new Date('2026-07-21T10:00:00.000Z');
  await registerTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'aishell',
    displayName: 'AIShell', sessionId: 'session-old', env,
    now: new Date(current.getTime() - TODO_DASHBOARD_STALE_MS - 1) });
  await registerTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
    displayName: 'Lattice', sessionId: 'session-current', env, now: current });
  assert.deepEqual((await readActiveTodoDashboardProjects({ env, now: current.getTime() }))
    .map(({ project_id: projectId }) => projectId), ['lattice']);
  const checked = [];
  const visible = await readVisibleTodoDashboardProjects({ env, now: current.getTime(),
    projectHasActiveRun: async ({ project_id: projectId }) => {
      checked.push(projectId);
      return projectId === 'aishell';
    },
  });
  assert.deepEqual(visible.map(({ project_id: projectId }) => projectId), ['aishell', 'lattice']);
  assert.deepEqual(checked, ['aishell']);
});

test('通常session activityだけでdashboard daemonを起動し同じdaemonを再利用する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-daemon-'));
  const runtime = path.join(root, 'runtime');
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime,
    LATTICE_DASHBOARD_PORT: '0', LATTICE_DASHBOARD_AUTOSTART: '1' };
  let daemonPid = null;
  context.after(async () => {
    if (daemonPid !== null) {
      try { process.kill(daemonPid, 'SIGTERM'); } catch {}
    }
    await rm(root, { recursive: true, force: true });
  });
  const [first, concurrent] = await Promise.all([
    ensureTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
      displayName: 'Lattice', sessionId: 'session-a', env }),
    ensureTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
      displayName: 'Lattice', sessionId: 'session-a', env }),
  ]);
  const descriptor = JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8'));
  assert.equal((await stat(path.join(runtime, 'daemon.json'))).mode & 0o777, 0o600);
  daemonPid = descriptor.pid;
  assert.ok(first.port > 0);
  assert.equal(concurrent.port, first.port);
  const index = await fetch(`http://127.0.0.1:${first.port}/projects/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Lattice/u);
  const second = await ensureTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
    displayName: 'Lattice', sessionId: 'session-a', env });
  const reused = JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8'));
  assert.equal(second.port, first.port);
  assert.equal(reused.pid, daemonPid);
  process.kill(daemonPid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const restarted = await ensureTodoDashboardActivity({ repoRoot: process.cwd(), projectId: 'lattice',
    displayName: 'Lattice', sessionId: 'session-a', env });
  const replacement = JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8'));
  assert.notEqual(replacement.pid, daemonPid);
  assert.ok(restarted.port > 0);
  daemonPid = replacement.pid;
});

test('legacy health daemonは新daemon成功後だけPID一致を根拠に停止して置換する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-legacy-upgrade-'));
  const runtime = path.join(root, 'runtime');
  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const legacyPid = 987_654;
  const legacy = await healthServer({ schema: 'lattice.todo_dashboard_health.v1', pid: legacyPid,
    project_ids: ['lattice'] });
  await writeDaemonDescriptor(runtime, { schema: 'lattice.todo_dashboard_daemon.v1', pid: legacyPid,
    port: legacy.port, started_at: new Date().toISOString() });
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime, LATTICE_DASHBOARD_PORT: '61234' };
  let replacement = null;
  let signaled = false;
  context.after(async () => {
    if (replacement !== null) try { process.kill(replacement.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => legacy.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  replacement = await ensureTodoDashboardDaemon({ env,
    signalProcess(pid, signal) {
      assert.equal(pid, legacyPid); assert.equal(signal, 'SIGTERM'); signaled = true; legacy.server.close();
    },
    isProcessAlive: () => !signaled,
  });
  assert.equal(signaled, true);
  assert.notEqual(replacement.pid, legacyPid);
  assert.notEqual(replacement.port, legacy.port);
});

test('古い版を配信し続けているdaemonは新版へ置換される', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-version-drift-'));
  const runtime = path.join(root, 'runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const stalePid = 987_655;
  // 応答形は現行と同じで、名乗る版数だけが古い。install済みのコードとの差が
  // 「配信中のプロセスだけ取り残されている」ことの唯一の手掛かりになる。
  const staleBody = { schema: 'lattice.todo_dashboard_health.v1', pid: stalePid, port: 0,
    project_ids: ['lattice'], version: '0.0.1-old' };
  const stale = await healthServer(() => staleBody);
  staleBody.port = stale.port;
  await writeDaemonDescriptor(runtime, { schema: 'lattice.todo_dashboard_daemon.v1', pid: stalePid,
    port: stale.port, started_at: new Date().toISOString() });
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime };
  let replacement = null;
  let signaled = false;
  context.after(async () => {
    if (replacement !== null) try { process.kill(replacement.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => stale.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  replacement = await ensureTodoDashboardDaemon({ env,
    signalProcess(pid, signal) {
      assert.equal(pid, stalePid); assert.equal(signal, 'SIGTERM'); signaled = true; stale.server.close();
    },
    isProcessAlive: () => !signaled,
  });
  assert.equal(signaled, true, '古い版のdaemonは停止させる');
  assert.notEqual(replacement.pid, stalePid);

  const health = await (await fetch(`http://127.0.0.1:${replacement.port}/__lattice/health`)).json();
  assert.equal(health.version, TODO_DASHBOARD_CODE_VERSION, '新daemonは自分の版数を名乗る');
});

test('PID不一致healthの無関係serviceにはsignalせず新daemonへ置換する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-unrelated-'));
  const runtime = path.join(root, 'runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const unrelated = await healthServer({ schema: 'lattice.todo_dashboard_health.v1', pid: 222_222,
    project_ids: [] });
  await writeDaemonDescriptor(runtime, { schema: 'lattice.todo_dashboard_daemon.v1', pid: 111_111,
    port: unrelated.port, started_at: new Date().toISOString() });
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime, LATTICE_DASHBOARD_PORT: '0' };
  let replacement = null;
  context.after(async () => {
    if (replacement !== null) try { process.kill(replacement.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => unrelated.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  replacement = await ensureTodoDashboardDaemon({ env,
    signalProcess() { throw new Error('unrelated PID must not be signaled'); },
  });
  assert.notEqual(replacement.pid, 111_111);
  assert.equal((await fetch(`http://127.0.0.1:${unrelated.port}/__lattice/health`)).status, 200);
});

test('生存中dashboardの一時的health timeoutは新daemonで孤児化せずtyped拒否する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-busy-'));
  const runtime = path.join(root, 'runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const daemonPid = 777_777;
  let busyPort = null;
  const busy = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({ schema: 'lattice.todo_dashboard_health.v1',
        pid: daemonPid, port: busyPort, project_ids: ['lattice'] })}\n`);
    }, 100);
  });
  await new Promise((resolve, reject) => {
    busy.once('error', reject);
    busy.listen(0, '127.0.0.1', resolve);
  });
  busyPort = busy.address().port;
  await writeDaemonDescriptor(runtime, { schema: 'lattice.todo_dashboard_daemon.v1',
    pid: daemonPid, port: busyPort, started_at: new Date().toISOString() });
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime };
  let spawnCount = 0;
  context.after(async () => {
    await new Promise((resolve) => busy.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(ensureTodoDashboardDaemon({ env, attestationTimeoutMs: 20,
    isProcessAlive: () => true,
    spawnDaemon() { spawnCount += 1; throw new Error('must not spawn'); },
  }), (error) => error.code === 'DASHBOARD_DAEMON_UNRESPONSIVE');
  assert.equal(spawnCount, 0);
});

test('新daemon起動中にlegacy再attestationを失ったPIDへはsignalしない', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-attestation-race-'));
  const runtime = path.join(root, 'runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const legacyPid = 555_555;
  let legacyBody = { schema: 'lattice.todo_dashboard_health.v1', pid: legacyPid,
    project_ids: ['lattice'] };
  const legacy = await healthServer(() => legacyBody);
  await writeDaemonDescriptor(runtime, { schema: 'lattice.todo_dashboard_daemon.v1', pid: legacyPid,
    port: legacy.port, started_at: new Date().toISOString() });
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime, LATTICE_DASHBOARD_PORT: '0' };
  context.after(async () => {
    const descriptor = JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8'));
    if (descriptor.pid !== legacyPid) try { process.kill(descriptor.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => legacy.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(ensureTodoDashboardDaemon({ env,
    spawnDaemon(...args) {
      legacyBody = { ...legacyBody, pid: legacyPid + 1 };
      return spawn(...args);
    },
    signalProcess() { throw new Error('lost attestation PID must not be signaled'); },
    isProcessAlive: () => true,
  }), (error) => error.code === 'DASHBOARD_LEGACY_ATTESTATION_LOST');
});

test('死んだreplacementは猶予の満了を待たず諦め、生きている遅い子は待ち切る',
  async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-liveness-'));
    const runtime = path.join(root, 'runtime');
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const legacyPid = 555_555;
    const body = { schema: 'lattice.todo_dashboard_health.v1', pid: legacyPid, port: 0,
      project_ids: ['lattice'] };
    const served = await healthServer(() => body);
    body.port = served.port;
    const descriptor = { schema: 'lattice.todo_dashboard_daemon.v1', pid: legacyPid,
      port: served.port, started_at: new Date().toISOString() };
    await writeDaemonDescriptor(runtime, descriptor);
    const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime, LATTICE_DASHBOARD_PORT: '0' };
    context.after(async () => {
      await new Promise((resolve) => served.server.close(resolve));
      await rm(root, { recursive: true, force: true });
    });

    // 死んだ子を待ち続けない。猶予10秒でも、死を見た時点で諦める。
    const startedAt = Date.now();
    await assert.rejects(ensureTodoDashboardDaemon({ env, startupTimeoutMs: 10_000,
      spawnDaemon: () => ({ pid: 777_777, unref() {}, kill() {} }),
      replacementIsProcessAlive: () => false,
      signalProcess() { throw new Error('legacy must remain available'); },
    }), (error) => error.code === 'DASHBOARD_DAEMON_UNAVAILABLE');
    assert.ok(Date.now() - startedAt < 3_000, '死んだreplacementを猶予いっぱい待っている');
    assert.deepEqual(JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8')), descriptor);

    // 生きている子は、pollを何周も跨ぐ遅さでも待って受け取る。
    await rm(path.join(runtime, 'daemon.json'), { force: true });
    let descriptorWritten = false;
    setTimeout(() => {
      body.pid = 888_888;
      body.version = TODO_DASHBOARD_CODE_VERSION;
      descriptorWritten = true;
      writeDaemonDescriptor(runtime, { schema: 'lattice.todo_dashboard_daemon.v1', pid: 888_888,
        port: served.port, started_at: new Date().toISOString() });
    }, 700);
    const slow = await ensureTodoDashboardDaemon({ env, startupTimeoutMs: 10_000,
      spawnDaemon: () => ({ pid: 888_888, unref() {}, kill() {} }),
      replacementIsProcessAlive: () => true,
      signalProcess() { throw new Error('legacyは無いのでsignalしない'); },
    });
    assert.equal(descriptorWritten, true);
    assert.equal(slow.pid, 888_888);
  });

test('新daemon起動失敗時はattested legacyを停止せずdescriptorと可用性を維持する',
  async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-upgrade-rollback-'));
    const runtime = path.join(root, 'runtime');
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const legacyPid = 333_333;
    const legacy = await healthServer({ schema: 'lattice.todo_dashboard_health.v1', pid: legacyPid,
      project_ids: ['lattice'] });
    const descriptor = { schema: 'lattice.todo_dashboard_daemon.v1', pid: legacyPid,
      port: legacy.port, started_at: new Date().toISOString() };
    await writeDaemonDescriptor(runtime, descriptor);
    const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime, LATTICE_DASHBOARD_PORT: '0' };
    let fakeKilled = false;
    context.after(async () => {
      await new Promise((resolve) => legacy.server.close(resolve));
      await rm(root, { recursive: true, force: true });
    });
    await assert.rejects(ensureTodoDashboardDaemon({ env, startupTimeoutMs: 120,
      spawnDaemon: () => ({ pid: 444_444, unref() {}, kill() { fakeKilled = true; } }),
      signalProcess() { throw new Error('legacy must remain available'); },
    }), (error) => error.code === 'DASHBOARD_DAEMON_UNAVAILABLE');
    assert.equal(fakeKilled, true);
    assert.deepEqual(JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8')), descriptor);
    assert.equal((await fetch(`http://127.0.0.1:${legacy.port}/__lattice/health`)).status, 200);
  });

test('旧daemon停止失敗時はreplacementを停止確認してlegacy descriptorへrollbackする',
  async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-stop-rollback-'));
    const runtime = path.join(root, 'runtime');
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const legacyPid = 666_666;
    const legacy = await healthServer({ schema: 'lattice.todo_dashboard_health.v1', pid: legacyPid,
      project_ids: ['lattice'] });
    const descriptor = { schema: 'lattice.todo_dashboard_daemon.v1', pid: legacyPid,
      port: legacy.port, started_at: new Date().toISOString() };
    await writeDaemonDescriptor(runtime, descriptor);
    const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime, LATTICE_DASHBOARD_PORT: '0' };
    let replacementChild = null;
    context.after(async () => {
      if (replacementChild?.exitCode === null && replacementChild?.signalCode === null) {
        replacementChild.kill('SIGKILL');
      }
      await new Promise((resolve) => legacy.server.close(resolve));
      await rm(root, { recursive: true, force: true });
    });
    await assert.rejects(ensureTodoDashboardDaemon({ env, legacyStopTimeoutMs: 120,
      spawnDaemon(...args) { replacementChild = spawn(...args); return replacementChild; },
      signalProcess() {},
      isProcessAlive: () => true,
    }), (error) => error.code === 'DASHBOARD_LEGACY_STOP_FAILED');
    assert.ok(replacementChild.exitCode !== null || replacementChild.signalCode !== null);
    assert.deepEqual(JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8')), descriptor);
    assert.equal((await fetch(`http://127.0.0.1:${legacy.port}/__lattice/health`)).status, 200);
  });

test('todo CLIの通常activityが明示serveなしでproject登録とdaemon起動をensureする', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dashboard-cli-'));
  const runtime = path.join(root, 'runtime');
  const env = { ...process.env, LATTICE_DASHBOARD_RUNTIME_DIR: runtime,
    LATTICE_DASHBOARD_PORT: '0', LATTICE_DASHBOARD_AUTOSTART: '1', LATTICE_TODO_ACTOR_HOST: 'codex',
    LATTICE_TODO_ACTOR_SESSION: 'session-cli', LATTICE_TODO_ACTOR_AGENT: 'root' };
  let daemonPid = null;
  context.after(async () => {
    if (daemonPid !== null) {
      try { process.kill(daemonPid, 'SIGTERM'); } catch {}
    }
    await rm(root, { recursive: true, force: true });
  });
  let stdout = '';
  let stderr = '';
  const code = await runTodoCli({ argv: ['status', '--json'], cwd: process.cwd(), env,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } } });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).project_id, 'lattice');
  const descriptor = JSON.parse(await readFile(path.join(runtime, 'daemon.json'), 'utf8'));
  daemonPid = descriptor.pid;
  assert.ok(descriptor.port > 0);
  const registry = await readActiveTodoDashboardProjects({ env });
  assert.equal(registry.length, 1);
  assert.equal(registry[0].project_id, 'lattice');
});
