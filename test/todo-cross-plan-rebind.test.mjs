import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runTodoCli } from '../src/todo-cli.mjs';
import {
  appendTodoEvent,
  buildTodoPlan,
  createSuccessorTodoPlan,
  createTodoStoreWriter,
  initializeTodoStore,
  projectTodoCrossPlanDependencies,
  readTodoStore,
  rebindTodoCrossPlanDependency,
} from '../src/todo-store.mjs';

const NOW = '2026-08-09T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const task = (taskId) => ({ task_id: taskId, title: taskId, lane: 'main',
  narrative_ref: null, compile_binding: null });

async function staleWorkspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-cross-plan-rebind-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await writeFile(path.join(root, 'evidence.md'), '# evidence\n');
  execFileSync('git', ['add', 'evidence.md'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });

  const plan = (planKey, taskId) => ({
    schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: planKey,
    plan_version: 'v1', predecessor_plan_digest: null,
    tasks: [task(taskId)], hard_dependencies: [], joins: [],
  });
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [
      { plan: plan('producer', 'P'), genesis: { actor: ACTOR, recorded_at: NOW } },
      { plan: plan('consumer', 'C'), genesis: { actor: ACTOR, recorded_at: NOW } },
    ],
    now: NOW,
  });
  const before = await readTodoStore({ repoRoot: root, now: NOW });
  const producer = before.members.find(({ plan: value }) => value.plan_key === 'producer');
  const consumer = before.members.find(({ plan: value }) => value.plan_key === 'consumer');
  const from = {
    project_id: before.project_id, plan_key: 'producer', task_id: 'P',
    expected_topology_digest: producer.plan.topology_digest,
  };
  const to = {
    project_id: before.project_id, plan_key: 'consumer', task_id: 'C',
    expected_topology_digest: consumer.plan.topology_digest,
  };
  const connected = await appendTodoEvent({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    planKey: 'consumer', now: NOW,
    event: { kind: 'cross_plan_dependency', actor: ACTOR, recorded_at: NOW,
      payload: { from, to, reason: 'fixture edge' } },
  });

  const successor = buildTodoPlan({
    ...producer.plan,
    plan_version: 'v2',
    predecessor_plan_digest: producer.plan.plan_digest,
    tasks: [task('P')],
  });
  await createSuccessorTodoPlan({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    planKey: 'producer', plan: successor,
    genesis: { actor: ACTOR, recorded_at: NOW, task_migration: [{ from_task_id: 'P', to_task_id: 'P' }] },
    now: NOW,
  });
  return { root, connected, oldFrom: from, oldTo: to, successor };
}

test('revision後のstale cross-plan edgeをrebindするred fixture', async (context) => {
  const { root } = await staleWorkspace(context);
  await assert.rejects(() => readTodoStore({ repoRoot: root, now: NOW }), (error) => (
    error.code === 'STORE_INCONSISTENT' && error.detail.reason === 'binding_stale'
  ));
});

test('stale edgeは旧eventを残したappend-only rebindでready読取へ戻る', async (context) => {
  const { root, connected, oldFrom, oldTo, successor } = await staleWorkspace(context);
  const rebound = await rebindTodoCrossPlanDependency({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    projectId: 'project-1',
    fromPlanKey: 'producer', fromTaskId: 'P', toPlanKey: 'consumer', toTaskId: 'C',
    oldEventDigest: connected.event.event_digest,
    oldFromTopologyDigest: oldFrom.expected_topology_digest,
    oldToTopologyDigest: oldTo.expected_topology_digest,
    currentFromTopologyDigest: successor.topology_digest,
    currentToTopologyDigest: oldTo.expected_topology_digest,
    reason: 'revision後のfixtureを現行topologyへ再束縛',
    actor: ACTOR,
    recordedAt: NOW,
    now: NOW,
  });
  assert.equal(rebound.event.kind, 'cross_plan_dependency_rebind');
  assert.equal(rebound.event.payload.supersedes, connected.event.event_digest);
  assert.equal(rebound.event.payload.from.expected_topology_digest, successor.topology_digest);

  const after = await readTodoStore({ repoRoot: root, now: NOW });
  const dependencies = projectTodoCrossPlanDependencies(after.members);
  assert.equal(dependencies.length, 1);
  assert.equal(dependencies[0].event_digest, rebound.event.event_digest);
  assert.equal(dependencies[0].from.expected_topology_digest, successor.topology_digest);
  const consumer = after.members.find(({ plan }) => plan.plan_key === 'consumer');
  assert.equal(consumer.plan_scoped.events.length, 2);
  assert.equal(consumer.plan_scoped.events[0].event_digest, connected.event.event_digest);
});

test('公開CLIは旧新topologyとfrontier diffを含むrebind receiptを返す', async (context) => {
  const { root, connected, oldFrom, oldTo, successor } = await staleWorkspace(context);
  let stdout = '';
  let stderr = '';
  const exit = await runTodoCli({
    argv: [
      'dependency', 'rebind', '--from-plan', 'producer', '--from-task', 'P',
      '--to-plan', 'consumer', '--to-task', 'C', '--event-digest', connected.event.event_digest,
      '--old-from-topology', oldFrom.expected_topology_digest,
      '--old-to-topology', oldTo.expected_topology_digest,
      '--current-from-topology', successor.topology_digest,
      '--current-to-topology', oldTo.expected_topology_digest,
      '--reason', 'CLIからfixtureを再束縛',
    ],
    cwd: root,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    env: {
      ...process.env,
      LATTICE_TODO_ACTOR_HOST: ACTOR.host,
      LATTICE_TODO_ACTOR_SESSION: ACTOR.session,
      LATTICE_TODO_ACTOR_AGENT: ACTOR.agent,
      LATTICE_DASHBOARD_AUTOSTART: '0',
    },
  });
  assert.equal(exit, 0, stderr);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.schema, 'lattice.todo_dependency_rebind_result.v1');
  assert.equal(receipt.rebound, true);
  assert.equal(receipt.old_event_digest, connected.event.event_digest);
  assert.equal(receipt.old_topology.from, oldFrom.expected_topology_digest);
  assert.equal(receipt.new_topology.from, successor.topology_digest);
  assert.ok(Array.isArray(receipt.frontier_diff.before));
  assert.ok(Array.isArray(receipt.frontier_diff.after));
  assert.match(receipt.result_digest, /^[0-9a-f]{64}$/u);
});
