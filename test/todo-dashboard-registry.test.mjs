import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runTodoCli } from '../src/todo-cli.mjs';
import {
  ensureTodoDashboardActivity,
  readActiveTodoDashboardProjects,
  registerTodoDashboardActivity,
  TODO_DASHBOARD_STALE_MS,
} from '../src/todo-dashboard-registry.mjs';

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
