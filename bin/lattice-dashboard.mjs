#!/usr/bin/env node

import { TODO_STATUS_DISPATCH_ONLY, projectTodoStatus } from '../src/todo-status.mjs';
import { createTodoStoreCache } from '../src/todo-store-cache.mjs';
import { ganttLiveHeadDigest, renderTodoGanttForProject } from '../src/todo-cli.mjs';
import { readProjectExternalPane } from '../src/project-identity.mjs';
import {
  forgetTodoDashboardDaemonRecord,
  readVisibleTodoDashboardProjects,
  todoDashboardMemberNeedsVisibility,
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
// room 2488's "gantt serve固着" symptom (a dashboard stuck on stale/broken state that
// only a process restart cleared, with the store and git both already fixed) traced to
// this cache — see src/todo-store-cache.mjs for why it is content-digest keyed rather
// than stat()-fingerprint keyed.
const storeCache = createTodoStoreCache();
const readCachedStore = (repoRoot) => storeCache.read(repoRoot);

async function synchronize() {
  const active = await readVisibleTodoDashboardProjects({ env,
    projectHasActiveRun: async (entry) => {
      try {
        const store = await readCachedStore(entry.repo_root);
        const active = projectTodoStatus(store, TODO_STATUS_DISPATCH_ONLY).active_set.length > 0
          || store.members.some(todoDashboardMemberNeedsVisibility);
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
        return {
          html: result.rendered.html,
          head_digest: await ganttLiveHeadDigest({ repoRoot: entry.repo_root, store }),
          // 配信のたびに読む。外部ペインを差した／外した側にdaemon再起動を要求しない。
          external_pane: await readProjectExternalPane({
            repoRoot: entry.repo_root, projectId: entry.project_id,
          }),
        };
      },
      readHead: async () => ganttLiveHeadDigest({
        repoRoot: entry.repo_root, store: await readCachedStore(entry.repo_root),
      }),
    });
    roots.set(entry.project_id, binding);
  }
  return active.length;
}

let closing = null;

/**
 * 終了経路はsignalだけではない——配信するprojectが尽きた時と同期に失敗した時も
 * ここを通る。どの経路でも自分の登録簿記録を落とす。消し損ねても次のdaemon起動が
 * 掃除するので、後始末の失敗で終了を止めない。
 */
function close() {
  if (closing === null) {
    clearInterval(timer);
    closing = (async () => {
      try { await forgetTodoDashboardDaemonRecord({ env }); } catch {}
      await dashboard.close();
    })();
  }
  return closing;
}

function exit(code) {
  close().catch(() => {}).finally(() => process.exit(code));
}

await synchronize();
const dashboard = await startTodoGanttDashboardServer({
  registry,
  port,
  onShutdown: process.platform === 'win32' ? () => exit(0) : null,
});
await writeTodoDashboardDaemonDescriptor({ port: dashboard.port, env });
const timer = setInterval(() => synchronize().then((count) => {
  if (count === 0) exit(0);
}).catch(() => exit(1)), 1_000);
process.once('SIGINT', () => exit(0));
process.once('SIGTERM', () => exit(0));
