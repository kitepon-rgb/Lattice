import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createTodoStoreWriter, initializeTodoStore } from '../src/todo-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/lattice.mjs');
const ACTOR = { host: 'host-1', session: 'session-1', agent: 'agent-1' };
const NOW = '2026-08-01T00:00:00.000Z';

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-note-auto-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [{ task_id: 'T1', title: 'Task 1', lane: 'main', narrative_ref: null,
          compile_binding: null }], hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  return root;
}

function run(root, args) {
  const env = { ...process.env, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0',
    LATTICE_TODO_ACTOR_HOST: ACTOR.host, LATTICE_TODO_ACTOR_SESSION: ACTOR.session,
    LATTICE_TODO_ACTOR_AGENT: ACTOR.agent };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' });
}

test('通常の個別ToDo詳細はnote listなしでbounded note contextを返す', async (t) => {
  const root = await workspace(t);
  assert.equal(run(root,
    ['todo', 'note', '--plan', 'main', '--task', 'T1', '--message', '既定方針']).status, 0);
  const shown = run(root, ['todo', 'show', '--plan', 'main', '--task', 'T1', '--json']);
  assert.equal(shown.status, 0, shown.stderr);
  const result = JSON.parse(shown.stdout);
  assert.equal(result.schema, 'lattice.todo_detail_result.v2');
  assert.equal(result.task.task_id, 'T1');
  assert.equal(result.design_memo.status, 'missing_legacy');
  assert.equal(result.note_context.notes[0].body, '既定方針');
  assert.equal(result.note_context.overflow_count, 0);
  assert.match(result.note_context.full_history_command, /todo note list/u);
});

test('todo start成功resultは事前取得した同じnote contextを必ず同梱する', async (t) => {
  const root = await workspace(t);
  assert.equal(run(root,
    ['todo', 'note', '--plan', 'main', '--task', 'T1', '--message', 'start時に読む']).status, 0);
  const started = run(root, ['todo', 'start', '--plan', 'main', '--task', 'T1']);
  assert.equal(started.status, 0, started.stderr);
  const result = JSON.parse(started.stdout);
  assert.equal(result.schema, 'lattice.todo_mutation_result.v4');
  assert.equal(result.kind, 'start');
  assert.equal(result.design_memo.status, 'missing_legacy');
  assert.equal(result.note_context.notes[0].body, 'start時に読む');
  assert.equal(result.note_context.note_head_digest, result.note_context.notes[0].event_digest);
});

test('note無しでも詳細/startは明示的な空contextを返す', async (t) => {
  const root = await workspace(t);
  const shown = JSON.parse(run(root,
    ['todo', 'show', '--plan', 'main', '--task', 'T1', '--json']).stdout);
  assert.deepEqual(shown.note_context.notes, []);
  assert.equal(shown.note_context.note_head_digest, null);
  const started = JSON.parse(run(root,
    ['todo', 'start', '--plan', 'main', '--task', 'T1']).stdout);
  assert.deepEqual(started.note_context.notes, []);
});

test('note取得不能ならstart前にtyped failureしlifecycleを部分進行させない', async (t) => {
  const root = await workspace(t);
  assert.equal(run(root,
    ['todo', 'note', '--plan', 'main', '--task', 'T1', '--message', '壊す']).status, 0);
  const activeNote = path.join(root, '.lattice/todo/notes/main/active.jsonl');
  await writeFile(activeNote, ` ${await readFile(activeNote, 'utf8')}`);
  const journal = path.join(root, '.lattice/todo/plans/main/v1/journal/active.jsonl');
  const before = await readFile(journal);
  const started = run(root, ['todo', 'start', '--plan', 'main', '--task', 'T1']);
  assert.equal(started.status, 1);
  assert.equal(JSON.parse(started.stderr).code, 'NOTE_LOG_CORRUPT');
  assert.deepEqual(await readFile(journal), before);
});
