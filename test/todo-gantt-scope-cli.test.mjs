import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  appendTodoEvent, createTodoStoreWriter, initializeTodoStore,
} from '../src/todo-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const NOW = '2026-07-18T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });

const task = (taskId, lane) => ({ task_id: taskId, title: taskId, lane,
  narrative_ref: null, compile_binding: null });
const ref = (taskId) => ({ project_id: 'project-1', plan_key: 'main', task_id: taskId });

const run = (root, args) => spawnSync(process.execPath, [CLI, ...args],
  { cwd: root, encoding: 'utf8' });

/**
 * A store with one finished branch (F) that no live work depends on, plus a
 * live chain (T1 -> T2). Only F is foldable.
 */
async function foldableWorkspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-scope-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }], now: NOW,
    plans: [{
      plan: { schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [task('F', 'done-lane'), task('T1', 'live'), task('T2', 'live')],
        hard_dependencies: [{ from: ref('T1'), to: ref('T2') }], joins: [] },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
  });
  const bytes = Buffer.from('finished branch evidence\n');
  const oid = execFileSync('git', ['hash-object', '-w', '--stdin'],
    { cwd: root, input: bytes, encoding: 'utf8' }).trim();
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'F', actor: ACTOR, recorded_at: NOW,
      payload: { override_reason: null } } });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'done', task_id: 'F', actor: ACTOR, recorded_at: NOW,
      payload: { evidence: { evidence_id: 'finished', repo_id: 'self', path: 'evidence.txt',
        git_blob_oid: oid, content_digest: createHash('sha256').update(bytes).digest('hex'),
        media_type: 'text/plain', anchor_digest: null } } } });
  return root;
}

test('既定scopeは完走した枝を畳み、--scope allは全件描く', async (context) => {
  const root = await foldableWorkspace(context);

  const live = run(root, ['todo', 'gantt', '--out', '.lattice/generated/live.html']);
  assert.equal(live.status, 0, live.stderr);
  const liveResult = JSON.parse(live.stdout);
  assert.equal(liveResult.scope, 'live');
  assert.equal(liveResult.folded_task_count, 1);

  const all = run(root, ['todo', 'gantt', '--out', '.lattice/generated/all.html', '--scope', 'all']);
  assert.equal(all.status, 0, all.stderr);
  const allResult = JSON.parse(all.stdout);
  assert.equal(allResult.scope, 'all');
  assert.equal(allResult.folded_task_count, 0);

  const liveHtml = await readFile(path.join(root, liveResult.output_ref), 'utf8');
  const allHtml = await readFile(path.join(root, allResult.output_ref), 'utf8');
  // 畳んだ図はFを描かず、全件の図は描く。生きた工程はどちらにも出る。
  assert.doesNotMatch(liveHtml, /data-task-id="F"/u);
  assert.match(allHtml, /data-task-id="F"/u);
  for (const html of [liveHtml, allHtml]) {
    assert.match(html, /data-task-id="T1"/u);
    assert.match(html, /data-task-id="T2"/u);
  }
  // 畳んでいることと戻し方が図の上で読める。
  assert.match(liveHtml, /完走済み 1件を畳んで表示中/u);
  assert.match(liveHtml, /--scope all/u);
  // 総数は畳み込み前のまま。
  assert.match(liveHtml, /aria-label="main — 3 ToDo"/u);
  // 一覧からは消さず、畳んだ群としてまとめる。
  assert.match(liveHtml, /完走済みとして畳んだ工程 1件/u);
});

test('gantt statusはscope違いの生成物をstaleと誤判定しない', async (context) => {
  const root = await foldableWorkspace(context);
  const all = run(root, ['todo', 'gantt', '--out', '.lattice/generated/all.html', '--scope', 'all']);
  assert.equal(all.status, 0, all.stderr);

  const status = run(root, ['todo', 'gantt', 'status', '--out', '.lattice/generated/all.html']);
  assert.equal(status.status, 0, status.stderr);
  const result = JSON.parse(status.stdout);
  assert.equal(result.scope, 'all');
  assert.equal(result.artifact_status, 'current');
});

test('未知のscope値はusage failureになる', async (context) => {
  const root = await foldableWorkspace(context);
  const bad = run(root, ['todo', 'gantt', '--scope', 'everything']);
  assert.equal(bad.status, 2);
});
