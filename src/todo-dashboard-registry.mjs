import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import {
  mkdir, open, readFile, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const REGISTRY_SCHEMA = 'lattice.todo_dashboard_registry.v1';
const DAEMON_SCHEMA = 'lattice.todo_dashboard_daemon.v1';
const DEFAULT_PORT = 0;
export const TODO_DASHBOARD_STALE_MS = 2 * 60 * 60 * 1_000;
const LOCK_ATTEMPTS = 240;
const LOCK_WAIT_MS = 25;
const LOCK_STALE_MS = 30_000;

function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function runtimeDir(env) {
  const configured = env.LATTICE_DASHBOARD_RUNTIME_DIR;
  return typeof configured === 'string' && path.isAbsolute(configured)
    ? configured : path.join(homedir(), '.lattice', 'dashboard');
}

function paths(env) {
  const root = runtimeDir(env);
  return {
    root,
    registry: path.join(root, 'projects.json'),
    descriptor: path.join(root, 'daemon.json'),
    lock: path.join(root, 'registry.lock'),
    startupLock: path.join(root, 'daemon-start.lock'),
  };
}

function validEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).sort().join(',') === 'display_name,last_seen_at,project_id,repo_root,session_id'
    && identifier(entry.project_id) && identifier(entry.session_id)
    && typeof entry.display_name === 'string' && entry.display_name.length > 0
    && typeof entry.repo_root === 'string' && path.isAbsolute(entry.repo_root)
    && Number.isFinite(Date.parse(entry.last_seen_at));
}

function validateRegistry(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== REGISTRY_SCHEMA || !Array.isArray(value.projects)
    || !value.projects.every(validEntry)) {
    const error = new Error('dashboard registry schema invalid');
    error.code = 'DASHBOARD_REGISTRY_INVALID';
    throw error;
  }
  const ids = new Set();
  for (const entry of value.projects) {
    if (ids.has(entry.project_id)) {
      const error = new Error(`dashboard project duplicate: ${entry.project_id}`);
      error.code = 'DASHBOARD_REGISTRY_INVALID';
      throw error;
    }
    ids.add(entry.project_id);
  }
  return value;
}

async function readJson(ref, missing) {
  let bytes;
  try { bytes = await readFile(ref, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return missing;
    throw error;
  }
  try { return JSON.parse(bytes); } catch {
    const error = new Error(`invalid JSON: ${ref}`);
    error.code = 'DASHBOARD_REGISTRY_INVALID';
    throw error;
  }
}

async function atomicJson(ref, value) {
  const temporary = `${ref}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, ref);
}

async function withLock(lockRef, action) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    let handle;
    try {
      handle = await open(lockRef, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      try { return await action(); } finally {
        await handle.close();
        await rm(lockRef, { force: true });
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lock = JSON.parse(await readFile(lockRef, 'utf8'));
        let alive = Number.isSafeInteger(lock.pid) && lock.pid > 0;
        if (alive) {
          try { process.kill(lock.pid, 0); } catch { alive = false; }
        }
        if (!alive || Date.now() - Date.parse(lock.created_at) > LOCK_STALE_MS) {
          await rm(lockRef, { force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError?.code === 'ENOENT') continue;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  const error = new Error('dashboard registry lock timeout');
  error.code = 'DASHBOARD_REGISTRY_BUSY';
  throw error;
}

export async function readActiveTodoDashboardProjects({ env = process.env, now = Date.now() } = {}) {
  const ref = paths(env).registry;
  const document = validateRegistry(await readJson(ref, { schema: REGISTRY_SCHEMA, projects: [] }));
  return document.projects.filter((entry) => now - Date.parse(entry.last_seen_at) <= TODO_DASHBOARD_STALE_MS)
    .sort((left, right) => left.display_name.localeCompare(right.display_name, 'ja')
      || left.project_id.localeCompare(right.project_id, 'en'));
}

export async function registerTodoDashboardActivity({
  repoRoot, projectId, displayName = projectId, sessionId, env = process.env,
  now = new Date(),
}) {
  if (!path.isAbsolute(repoRoot) || !identifier(projectId) || !identifier(sessionId)
    || typeof displayName !== 'string' || displayName.length === 0 || displayName !== displayName.trim()
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('dashboard activity is invalid');
  }
  const canonicalRoot = await realpath(repoRoot);
  const refs = paths(env);
  await mkdir(refs.root, { recursive: true, mode: 0o700 });
  await withLock(refs.lock, async () => {
    const current = validateRegistry(await readJson(refs.registry, { schema: REGISTRY_SCHEMA, projects: [] }));
    const cutoff = now.getTime() - TODO_DASHBOARD_STALE_MS;
    const projects = current.projects.filter((entry) => Date.parse(entry.last_seen_at) >= cutoff
      && entry.project_id !== projectId);
    projects.push({ project_id: projectId, display_name: displayName, repo_root: canonicalRoot,
      session_id: sessionId, last_seen_at: now.toISOString() });
    projects.sort((left, right) => left.project_id.localeCompare(right.project_id, 'en'));
    await atomicJson(refs.registry, { schema: REGISTRY_SCHEMA, projects });
  });
  return { projectId, displayName, repoRoot: canonicalRoot, sessionId };
}

async function daemonHealthy(descriptor) {
  if (descriptor === null || typeof descriptor !== 'object' || descriptor.schema !== DAEMON_SCHEMA
    || !Number.isSafeInteger(descriptor.pid) || descriptor.pid <= 0
    || !Number.isSafeInteger(descriptor.port) || descriptor.port <= 0 || descriptor.port > 65_535) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/__lattice/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (response.status !== 200) return false;
    const body = await response.json();
    return body?.schema === 'lattice.todo_dashboard_health.v1' && body.pid === descriptor.pid
      && body.port === descriptor.port;
  } catch { return false; }
}

export async function writeTodoDashboardDaemonDescriptor({ port, env = process.env }) {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) throw new TypeError('daemon port invalid');
  const refs = paths(env);
  await mkdir(refs.root, { recursive: true, mode: 0o700 });
  await atomicJson(refs.descriptor, { schema: DAEMON_SCHEMA, pid: process.pid, port,
    started_at: new Date().toISOString() });
}

export async function ensureTodoDashboardDaemon({ env = process.env } = {}) {
  const refs = paths(env);
  await mkdir(refs.root, { recursive: true, mode: 0o700 });
  return withLock(refs.startupLock, async () => {
    const existing = await readJson(refs.descriptor, null);
    if (await daemonHealthy(existing)) return existing;
    const portText = env.LATTICE_DASHBOARD_PORT;
    const port = typeof portText === 'string' && /^(?:0|[1-9][0-9]{0,4})$/u.test(portText)
      && Number(portText) <= 65_535 ? Number(portText) : DEFAULT_PORT;
    await rm(refs.descriptor, { force: true });
    const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../bin/lattice-dashboard.mjs')], {
      detached: true,
      stdio: 'ignore',
      env: { ...env, LATTICE_DASHBOARD_RUNTIME_DIR: refs.root, LATTICE_DASHBOARD_PORT: String(port) },
    });
    child.unref();
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const descriptor = await readJson(refs.descriptor, null);
      if (await daemonHealthy(descriptor)) return descriptor;
    }
    const error = new Error('dashboard daemon did not become ready');
    error.code = 'DASHBOARD_DAEMON_UNAVAILABLE';
    throw error;
  });
}

export async function ensureTodoDashboardActivity(options) {
  const registered = await registerTodoDashboardActivity(options);
  const daemon = await ensureTodoDashboardDaemon({ env: options.env });
  const deadline = Date.now() + 2_500;
  let visible = false;
  while (!visible && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/__lattice/health`, {
        signal: AbortSignal.timeout(500),
      });
      const health = response.status === 200 ? await response.json() : null;
      visible = health?.schema === 'lattice.todo_dashboard_health.v1'
        && health.port === daemon.port
        && health.project_ids?.includes(registered.projectId);
    } catch { visible = false; }
    if (!visible) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!visible) {
    const error = new Error('registered project did not become visible');
    error.code = 'DASHBOARD_PROJECT_UNAVAILABLE';
    throw error;
  }
  return { ...registered, host: '127.0.0.1', port: daemon.port,
    url: `http://127.0.0.1:${daemon.port}/projects/${encodeURIComponent(registered.projectId)}/` };
}
