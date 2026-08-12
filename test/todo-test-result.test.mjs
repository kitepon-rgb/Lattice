import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createTodoStoreWriter, initializeTodoStore } from '../src/todo-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/lattice.mjs');
const ACTOR = { host: 'host-1', session: 'session-1', agent: 'agent-1' };
const NOW = '2026-07-18T00:00:00.000Z';

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-test-result-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [{ task_id: 'T1', title: 'Task 1', lane: 'main', narrative_ref: null,
          compile_binding: null }], hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  return root;
}

function run(root, args) {
  const env = {
    ...process.env,
    NO_COLOR: '1',
    LATTICE_DASHBOARD_AUTOSTART: '0',
    LATTICE_TODO_ACTOR_HOST: ACTOR.host,
    LATTICE_TODO_ACTOR_SESSION: ACTOR.session,
    LATTICE_TODO_ACTOR_AGENT: ACTOR.agent,
  };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' });
}

function json(result, expectedStatus = 0) {
  assert.equal(result.status, expectedStatus, result.stderr);
  return JSON.parse(expectedStatus === 0 ? result.stdout : result.stderr);
}

async function evidence(root) {
  const bytes = Buffer.from('evidence\n', 'utf8');
  await writeFile(path.join(root, 'evidence.md'), bytes);
  const object = spawnSync('git', ['hash-object', '-w', 'evidence.md'], { cwd: root, encoding: 'utf8' });
  assert.equal(object.status, 0, object.stderr);
  const descriptor = {
    evidence_id: 'evidence', repo_id: 'self', path: 'evidence.md',
    git_blob_oid: object.stdout.trim(), content_digest: createHash('sha256').update(bytes).digest('hex'),
    media_type: 'text/markdown', anchor_digest: null,
  };
  await writeFile(path.join(root, 'evidence.json'), `${JSON.stringify(descriptor)}\n`);
}

test('test_resultは旧storeでnull、新しいdoneとsnapshotへ原文保存され、reopenで現在値を外す', async (context) => {
  const root = await workspace(context);
  await evidence(root);
  const initialSnapshot = JSON.parse(await readFile(path.join(root,
    '.lattice/todo/plans/main/v1/snapshot.json'), 'utf8'));
  assert.equal(initialSnapshot.schema, 'lattice.todo_snapshot.v1');
  const initial = json(run(root, ['todo', 'show', '--plan', 'main', '--task', 'T1', '--json']));
  assert.equal(initial.schema, 'lattice.todo_detail_result.v3');
  assert.equal(initial.state.test_result, null);

  json(run(root, ['todo', 'start', '--plan', 'main', '--task', 'T1']));
  const markdown = '## 最終試験\n\n- focused: 2/2\n- related: 95/95\n';
  await writeFile(path.join(root, 'test-result.md'), markdown);
  json(run(root, ['todo', 'done', '--plan', 'main', '--task', 'T1',
    '--evidence', 'evidence.json', '--test-result', 'test-result.md']));

  const shown = json(run(root, ['todo', 'show', '--plan', 'main', '--task', 'T1', '--json']));
  assert.equal(shown.state.test_result, markdown);
  const journal = (await readFile(path.join(root,
    '.lattice/todo/plans/main/v1/journal/active.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(journal.at(-1).payload.test_result, markdown);
  const snapshot = JSON.parse(await readFile(path.join(root,
    '.lattice/todo/plans/main/v1/snapshot.json'), 'utf8'));
  assert.equal(snapshot.schema, 'lattice.todo_snapshot.v3');
  assert.equal(snapshot.tasks[0].test_result, markdown);

  json(run(root, ['todo', 'reopen', '--plan', 'main', '--task', 'T1', '--reason', 'correction']));
  const reopened = json(run(root, ['todo', 'show', '--plan', 'main', '--task', 'T1', '--json']));
  assert.equal(reopened.state.test_result, null);
  const reopenedSnapshot = JSON.parse(await readFile(path.join(root,
    '.lattice/todo/plans/main/v1/snapshot.json'), 'utf8'));
  assert.equal(reopenedSnapshot.schema, 'lattice.todo_snapshot.v3');
  assert.equal(reopenedSnapshot.tasks[0].test_result, null);
});

test('test_result未指定の既存doneはnull、空白だけのfileはstore無変更で拒否する', async (context) => {
  const root = await workspace(context);
  await evidence(root);
  json(run(root, ['todo', 'start', '--plan', 'main', '--task', 'T1']));
  await writeFile(path.join(root, 'blank.md'), ' \n\t');
  const journalRef = path.join(root, '.lattice/todo/plans/main/v1/journal/active.jsonl');
  const snapshotRef = path.join(root, '.lattice/todo/plans/main/v1/snapshot.json');
  const before = [await readFile(journalRef), await readFile(snapshotRef)];
  const failure = json(run(root, ['todo', 'done', '--plan', 'main', '--task', 'T1',
    '--evidence', 'evidence.json', '--test-result', 'blank.md']), 1);
  assert.equal(failure.code, 'INVALID_TEST_RESULT');
  assert.deepEqual([await readFile(journalRef), await readFile(snapshotRef)], before);

  json(run(root, ['todo', 'done', '--plan', 'main', '--task', 'T1', '--evidence', 'evidence.json']));
  const shown = json(run(root, ['todo', 'show', '--plan', 'main', '--task', 'T1', '--json']));
  assert.equal(shown.state.test_result, null);
  const snapshot = JSON.parse(await readFile(snapshotRef, 'utf8'));
  assert.equal(snapshot.schema, 'lattice.todo_snapshot.v1');
  assert.equal(Object.hasOwn(snapshot.tasks[0], 'test_result'), false);
});
