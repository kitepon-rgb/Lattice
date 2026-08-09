import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access, chmod, mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createTodoStoreWriter,
  initializeTodoStore,
} from '../../src/todo-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'bin/lattice.mjs');
const DONE_SCRIPT = path.join(REPO_ROOT, '.team/scripts/done.sh');
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function actorEnv(overrides = {}) {
  return {
    ...process.env,
    NO_COLOR: '1',
    LATTICE_DASHBOARD_AUTOSTART: '0',
    LATTICE_TODO_ACTOR_HOST: ACTOR.host,
    LATTICE_TODO_ACTOR_SESSION: ACTOR.session,
    LATTICE_TODO_ACTOR_AGENT: ACTOR.agent,
    ...overrides,
  };
}

function runCli(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: actorEnv(),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-atomic-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Lattice Test']);
  git(root, ['config', 'user.email', 'lattice-test@example.invalid']);
  git(root, ['config', 'commit.gpgSign', 'false']);

  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1',
        project_id: 'project-1',
        plan_key: 'main',
        plan_version: 'v1',
        predecessor_plan_digest: null,
        tasks: [{
          task_id: 'ac2', title: 'ac2', lane: 'main', narrative_ref: null, compile_binding: null,
        }],
        hard_dependencies: [],
        joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: '2026-08-09T00:00:00.000Z' },
    }],
    now: '2026-08-09T00:00:00.000Z',
  });

  await mkdir(path.join(root, '.team/scripts'), { recursive: true });
  await writeFile(path.join(root, '.team/scripts/done.sh'), await readFile(DONE_SCRIPT));
  await chmod(path.join(root, '.team/scripts/done.sh'), 0o755);
  await writeFile(path.join(root, '.team/lattice-wrapper.sh'), [
    '#!/bin/sh',
    'exec "$LATTICE_TEST_NODE" "$LATTICE_TEST_CLI" "$@"',
    '',
  ].join('\n'));
  await chmod(path.join(root, '.team/lattice-wrapper.sh'), 0o755);
  await mkdir(path.join(root, 'evidence/main'), { recursive: true });
  await writeFile(path.join(root, 'evidence/main/ac2.md'), '# ac2 evidence\n');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/app.mjs'), 'export const app = 1;\n');
  await writeFile(path.join(root, 'src/staged.mjs'), 'export const staged = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);

  const started = runCli(root, ['todo', 'start', '--plan', 'main', '--task', 'ac2']);
  assert.equal(started.status, 'in-progress');
  git(root, ['add', '--', '.lattice/todo']);
  git(root, ['commit', '--quiet', '-m', 'start ac2']);
  return root;
}

test('done.shはdirty sourceと既存stageを保ってstoreだけをatomic commitする', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'src/app.mjs'), 'export const app = 2;\n');
  await writeFile(path.join(root, 'src/staged.mjs'), 'export const staged = 2;\n');
  git(root, ['add', '--', 'src/staged.mjs']);
  const stagedBefore = git(root, ['ls-files', '--stage', '--', 'src/staged.mjs']);
  const parent = git(root, ['rev-parse', 'HEAD']).trim();

  const completed = spawnSync('/bin/bash', ['.team/scripts/done.sh', 'ac2'], {
    cwd: root,
    encoding: 'utf8',
    env: actorEnv({
      PEERTABLE_PLAN: 'main',
      LATTICE_CLI: path.join(root, '.team/lattice-wrapper.sh'),
      LATTICE_TEST_NODE: process.execPath,
      LATTICE_TEST_CLI: CLI,
    }),
  });
  assert.equal(completed.error, undefined);
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout.trim());
  assert.equal(result.schema, 'lattice.todo_store_atomic_commit_result.v1');
  assert.equal(result.operation_result.status, 'done');
  assert.equal(result.commit.parent_sha, parent);
  assert.ok(result.commit.paths.length > 0);
  assert.ok(result.commit.paths.every((ref) => ref.startsWith('.lattice/todo/')));
  assert.deepEqual(result.commit.paths, git(root,
    ['diff-tree', '--no-commit-id', '--name-only', '-r', result.commit.commit_sha])
    .trim().split('\n').filter(Boolean));

  assert.equal(await readFile(path.join(root, 'src/app.mjs'), 'utf8'),
    'export const app = 2;\n');
  assert.equal(git(root, ['ls-files', '--stage', '--', 'src/staged.mjs']), stagedBefore);
  assert.equal(git(root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.lattice/todo']), '');
  await assert.rejects(access(path.join(root, '.ev-ac2.json')));
});
