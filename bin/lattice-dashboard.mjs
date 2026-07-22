#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import path from 'node:path';

import { readTodoStoreStable } from '../src/todo-store.mjs';
import { projectTodoStatus } from '../src/todo-status.mjs';
import { renderTodoGanttForProject } from '../src/todo-cli.mjs';
import {
  readVisibleTodoDashboardProjects,
  writeTodoDashboardDaemonDescriptor,
} from '../src/todo-dashboard-registry.mjs';
import {
  createTodoGanttProjectRegistry,
  startTodoGanttDashboardServer,
} from '../src/todo-gantt-live.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  process.stdout.write('Usage: lattice-dashboard\n');
  process.exit(0);
}
if (args.length > 0) {
  process.stderr.write('Usage: lattice-dashboard\n');
  process.exit(2);
}

const env = process.env;
const configured = env.LATTICE_DASHBOARD_PORT;
const port = typeof configured === 'string' && /^(?:0|[1-9][0-9]{0,4})$/u.test(configured)
  && Number(configured) <= 65_535 ? Number(configured) : 0;
const registry = createTodoGanttProjectRegistry();
const roots = new Map();
const reportedStoreReadFailures = new Set();
const storeCache = new Map();

function manifestFingerprint(value) {
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
}

async function readCachedStore(repoRoot) {
  const manifestRef = path.join(repoRoot, '.lattice', 'todo', 'manifest.json');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeFingerprint = manifestFingerprint(await stat(manifestRef));
    const cached = storeCache.get(repoRoot);
    if (cached?.fingerprint === beforeFingerprint) return cached.store;
    const store = await readTodoStoreStable({ repoRoot });
    const afterFingerprint = manifestFingerprint(await stat(manifestRef));
    if (beforeFingerprint === afterFingerprint) {
      storeCache.set(repoRoot, { fingerprint: afterFingerprint, store });
      return store;
    }
  }
  return readTodoStoreStable({ repoRoot });
}

async function synchronize() {
  const active = await readVisibleTodoDashboardProjects({ env,
    projectHasActiveRun: async (entry) => {
      try {
        const active = projectTodoStatus(await readCachedStore(entry.repo_root)).active_set.length > 0;
        reportedStoreReadFailures.delete(entry.project_id);
        return active;
      } catch (error) {
        if (!reportedStoreReadFailures.has(entry.project_id)) {
          reportedStoreReadFailures.add(entry.project_id);
          console.error(JSON.stringify({ schema: 'lattice.dashboard_project_store_error.v1',
            project_id: entry.project_id, message: error instanceof Error ? error.message : String(error) }));
        }
        return false;
      }
    },
  });
  const activeIds = new Set(active.map(({ project_id: projectId }) => projectId));
  for (const projectId of roots.keys()) {
    if (!activeIds.has(projectId)) {
      registry.unregister(projectId);
      roots.delete(projectId);
    }
  }
  for (const entry of active) {
    const binding = `${entry.repo_root}\0${entry.display_name}`;
    if (roots.get(entry.project_id) === binding) continue;
    registry.unregister(entry.project_id);
    registry.register({
      projectId: entry.project_id,
      displayName: entry.display_name,
      render: async ({ displayName }) => {
        const store = await readCachedStore(entry.repo_root);
        const result = await renderTodoGanttForProject({ repoRoot: entry.repo_root,
          stable: true, displayName, readModel: store });
        return { html: result.rendered.html, head_digest: result.metadata.manifest_digest };
      },
      readHead: async () => (await readCachedStore(entry.repo_root)).manifest.manifest_digest,
    });
    roots.set(entry.project_id, binding);
  }
  return active.length;
}

await synchronize();
const dashboard = await startTodoGanttDashboardServer({ registry, port });
await writeTodoDashboardDaemonDescriptor({ port: dashboard.port, env });
const timer = setInterval(() => synchronize().then((count) => {
  if (count === 0) process.exit(0);
}).catch(() => process.exit(1)), 1_000);
const close = async () => {
  clearInterval(timer);
  await dashboard.close();
};
process.once('SIGINT', () => close().finally(() => process.exit(0)));
process.once('SIGTERM', () => close().finally(() => process.exit(0)));
