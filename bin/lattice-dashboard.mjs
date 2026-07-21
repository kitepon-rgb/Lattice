#!/usr/bin/env node

import { readTodoStoreStable } from '../src/todo-store.mjs';
import { renderTodoGanttForProject } from '../src/todo-cli.mjs';
import {
  readActiveTodoDashboardProjects,
  writeTodoDashboardDaemonDescriptor,
} from '../src/todo-dashboard-registry.mjs';
import {
  createTodoGanttProjectRegistry,
  startTodoGanttDashboardServer,
} from '../src/todo-gantt-live.mjs';

const env = process.env;
const configured = env.LATTICE_DASHBOARD_PORT;
const port = typeof configured === 'string' && /^(?:0|[1-9][0-9]{0,4})$/u.test(configured)
  && Number(configured) <= 65_535 ? Number(configured) : 0;
const registry = createTodoGanttProjectRegistry();
const roots = new Map();

async function synchronize() {
  const active = await readActiveTodoDashboardProjects({ env });
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
        const result = await renderTodoGanttForProject({ repoRoot: entry.repo_root,
          stable: true, displayName });
        return { html: result.rendered.html, head_digest: result.metadata.manifest_digest };
      },
      readHead: async () => (await readTodoStoreStable({ repoRoot: entry.repo_root })).manifest.manifest_digest,
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
