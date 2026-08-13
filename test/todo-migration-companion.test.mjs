import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import { runTodoCli } from '../src/todo-cli.mjs';
import { appendTodoExtraction, compileTodoExtraction } from '../src/todo-migration.mjs';
import { computeReadyFrontier } from '../src/todo-status.mjs';
import {
  appendImportedPlan,
  appendTodoEvent,
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoStore,
} from '../src/todo-store.mjs';

const NOW = '2026-08-13T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const WRITER = createTodoStoreWriter({ caller: 'g4-migration' });
const AUTHOR = createTodoStoreWriter({ caller: 'g5-authoring' });

const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-companion-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await writeFile(path.join(root, 'plan.md'), '# companion\n- [ ] R\n');
  await writeFile(path.join(root, 'evidence.md'), '# evidence\n');
  execFileSync('git', ['add', 'plan.md', 'evidence.md'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });

  await initializeTodoStore({
    repoRoot: root, writer: WRITER, projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main', plan_version: 'v1',
        predecessor_plan_digest: null, tasks: [task('T')], hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  return root;
}

async function extraction(root, reason = 'repairを先に完了する') {
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  const target = store.members.find(({ plan }) => plan.plan_key === 'main');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const value = {
    schema: 'lattice.todo_extraction.v3', project_id: 'project-1', plan_key: 'companion', plan_version: 'v1',
    actor: ACTOR, recorded_at: NOW,
    tasks: [{
      task_id: 'R', title: 'repair', lane: 'main', design_memo: 'NO_PLAN', narrative_ref: null,
      compile_binding: null, disposition: 'register_pending', start: null, completion: null,
      source: {
        origin_plan_ref: 'plan.md', origin_line: 2, source_commit: sourceCommit,
        heading_path: ['companion'], markdown_depth: 0, parent_task_id: null, checkbox_state: 'unchecked',
      },
      migration_context: {
        external_canonical_ref: null, carry_over_ref: null, h_required: false, condition: null,
        evidence_refs: [], notes: [],
      },
    }],
    hard_dependencies: [{
      from: { project_id: 'project-1', plan_key: 'companion', task_id: 'R' },
      to: {
        project_id: 'project-1', plan_key: 'main', task_id: 'T',
        expected_topology_digest: target.plan.topology_digest,
      },
      reason,
    }],
    joins: [], extraction_digest: '',
  };
  value.extraction_digest = todoSelfDigest(value, 'extraction_digest');
  return value;
}

function evidence(root) {
  const content = readFile(path.join(root, 'evidence.md'));
  const gitBlobOid = execFileSync('git', ['rev-parse', 'HEAD:evidence.md'], {
    cwd: root, encoding: 'utf8',
  }).trim();
  return content.then((bytes) => ({
    evidence_id: 'fixture', repo_id: 'self', path: 'evidence.md', git_blob_oid: gitBlobOid,
    content_digest: createHash('sha256').update(bytes).digest('hex'), media_type: 'text/markdown',
    anchor_digest: null,
  }));
}

test('v3 companion edgeはreasonをedgeへ保持し、target側chainとready frontierへ投影する', async (context) => {
  const root = await workspace(context);
  const input = await extraction(root);
  const imported = await appendTodoExtraction({ repoRoot: root, extraction: input });
  assert.equal(imported.crossPlanDependencies.length, 1);
  assert.equal(imported.crossPlanDependencies[0].payload.reason, 'repairを先に完了する');

  const store = await readTodoStore({ repoRoot: root, now: NOW });
  const companion = store.members.find(({ plan }) => plan.plan_key === 'companion');
  const target = store.members.find(({ plan }) => plan.plan_key === 'main');
  assert.deepEqual(companion.plan.hard_dependencies, [{
    from: { project_id: 'project-1', plan_key: 'companion', task_id: 'R' },
    to: { project_id: 'project-1', plan_key: 'main', task_id: 'T',
      expected_topology_digest: target.plan.topology_digest },
  }]);
  assert.equal(target.plan_scoped.events.length, 1);
  assert.equal(target.plan_scoped.events[0].payload.reason, 'repairを先に完了する');
  assert.deepEqual(computeReadyFrontier(store), [{ plan_key: 'companion', task_id: 'R', label: 'repair' }]);
});

test('companion repair完了後はtargetがreadyへ戻る', async (context) => {
  const root = await workspace(context);
  await appendTodoExtraction({ repoRoot: root, extraction: await extraction(root) });
  await appendTodoEvent({
    repoRoot: root, writer: AUTHOR, planKey: 'companion', now: NOW,
    event: { kind: 'start', task_id: 'R', actor: ACTOR, recorded_at: NOW,
      payload: { override_reason: null } },
  });
  await appendTodoEvent({
    repoRoot: root, writer: AUTHOR, planKey: 'companion', now: NOW,
    event: { kind: 'done', task_id: 'R', actor: ACTOR, recorded_at: NOW,
      payload: { done_mode: 'authored', imported: false, evidence: await evidence(root) } },
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  assert.deepEqual(computeReadyFrontier(store), [{ plan_key: 'main', task_id: 'T', label: 'T' }]);
});

test('cross-plan activation後の失敗は新planとtarget edgeを同時にrollbackする', async (context) => {
  const root = await workspace(context);
  const input = await extraction(root);
  const request = compileTodoExtraction(input, root);
  request.onProtocolStage = async (stage) => {
    if (stage === 'cross_plan_dependencies_activated') throw new Error('after-edge');
  };
  await assert.rejects(() => appendImportedPlan(request), /after-edge/u);
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  assert.deepEqual(store.members.map(({ plan }) => plan.plan_key), ['main']);
  assert.deepEqual(store.members[0].plan_scoped.events, []);
});

test('migrate resultはcompanionの接続、frontier、次の操作をtypedに返す', async (context) => {
  const root = await workspace(context);
  const input = await extraction(root);
  await writeFile(path.join(root, 'companion.json'), `${JSON.stringify(input)}\n`);
  let stdout = '';
  let stderr = '';
  const exit = await runTodoCli({
    argv: ['migrate', '--input', 'companion.json'], cwd: root,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    env: {
      ...process.env, LATTICE_TODO_ACTOR_HOST: 'host-1',
      LATTICE_TODO_ACTOR_SESSION: 'session-1', LATTICE_TODO_ACTOR_AGENT: 'agent-1',
      LATTICE_DASHBOARD_AUTOSTART: '0',
    },
  });
  assert.equal(exit, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.companion.connections[0].repair.task_id, 'R');
  assert.equal(result.companion.connections[0].target.task_id, 'T');
  assert.equal(result.companion.connections[0].reason, 'repairを先に完了する');
  assert.deepEqual(result.companion.connected_frontier, [
    { plan_key: 'companion', task_id: 'R', label: 'repair' },
  ]);
  assert.equal(result.companion.next_action,
    'lattice todo revise-phase --plan companion --input <phase-revision.json>');
});
