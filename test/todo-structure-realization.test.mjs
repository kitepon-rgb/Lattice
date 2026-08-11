import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  TODO_STRUCTURE_SET_SCHEMA,
  digestTodoStructureTransform,
} from '../src/todo-structure-contracts.mjs';
import {
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoStore,
  readTodoStructureRealizationChain,
  readTodoStructureSource,
} from '../src/todo-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin/lattice.mjs');
const NOW = '2026-08-11T14:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, 'todo', ...args], {
    cwd: root, encoding: 'utf8',
    env: {
      ...process.env, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0',
      LATTICE_TODO_ACTOR_HOST: ACTOR.host,
      LATTICE_TODO_ACTOR_SESSION: ACTOR.session,
      LATTICE_TODO_ACTOR_AGENT: ACTOR.agent,
    },
  });
}

const parse = (text) => JSON.parse(text.trim().split('\n').at(-1));
const todoTask = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

function transform(taskId, overrides = {}) {
  return {
    outcome: `${taskId}が実装を更新する`, inputs: [], operations: [], outputs: [],
    code_anchors: [{
      anchor_id: 'implementation', effect: 'modify', path: 'src/shared.mjs',
      symbol: null, expected_at: 'current',
    }],
    failures: ['実装更新失敗'], first_live_e2e: `${taskId}の実装を一件実行する`,
    non_goals: ['並列可否判定'], ...overrides,
  };
}

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-structure-realize-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  await writeFile(path.join(root, '.gitignore'), '.lattice/sensor/\n');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/shared.mjs'), 'export const value = 1;\n');
  git(root, ['add', '.gitignore', 'src/shared.mjs']);
  git(root, ['commit', '--quiet', '-m', 'baseline']);
  const baselineSha = git(root, ['rev-parse', 'HEAD']);
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [todoTask('T1'), todoTask('T2')], hard_dependencies: [], joins: [],
      }, genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  const set = {
    schema: TODO_STRUCTURE_SET_SCHEMA, project_id: 'project-1', plan_key: 'main',
    plan_version: 'v1', topology_digest: store.members[0].plan.topology_digest,
    profile: 'code-dataflow', baseline_sha: baselineSha, external_contracts: [],
    tasks: [
      { task_id: 'T1', applicability: 'graph', planned: transform('T1') },
      { task_id: 'T2', applicability: 'graph', planned: transform('T2') },
    ],
    structure_set_digest: '',
  };
  set.structure_set_digest = todoSelfDigest(set, 'structure_set_digest');
  await writeFile(path.join(root, 'structure.json'), `${JSON.stringify(set)}\n`);
  const input = run(root, [
    'structure', 'input', '--plan', 'main', '--input', 'structure.json',
  ]);
  assert.equal(input.status, 0, input.stderr);
  git(root, ['add', '.lattice/todo', 'structure.json']);
  git(root, ['commit', '--quiet', '-m', 'structure source']);
  const sensor = spawnSync(process.execPath, [CLI, 'sensor', 'init', '.', '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(sensor.status, 0, sensor.stderr);
  const compiled = run(root, [
    'structure', 'compile', '--plan', 'main', '--input', '.lattice/todo/structure/main.json',
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(parse(compiled.stdout).enabled, true);
  await writeFile(path.join(root, 'src/shared.mjs'), 'export const value = 2;\n');
  git(root, ['add', 'src/shared.mjs']);
  git(root, ['commit', '--quiet', '-m', 'implementation']);
  return {
    root, set, implementationCommit: git(root, ['rev-parse', 'HEAD']),
  };
}

function realization(fixture, taskId, overrides = {}) {
  const planned = fixture.set.tasks.find(({ task_id: id }) => id === taskId).planned;
  const value = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: fixture.set.project_id, plan_key: fixture.set.plan_key,
    plan_version: fixture.set.plan_version, task_id: taskId,
    sequence: 1, previous_digest: null,
    structure_set_digest: fixture.set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(planned),
    head_sha: fixture.implementationCommit,
    commit_oids: [fixture.implementationCommit], realized: structuredClone(planned),
    supersedes: null, actor: ACTOR, recorded_at: NOW, realization_digest: '',
    ...overrides,
  };
  value.realization_digest = todoSelfDigest(value, 'realization_digest');
  return value;
}

async function writeInput(root, name, value) {
  await writeFile(path.join(root, name), `${JSON.stringify(value)}\n`);
  return name;
}

test('realizeはstale planned・unreachable commitを無変更で拒否する', async (context) => {
  const data = await fixture(context);
  const stale = realization(data, 'T1', { planned_digest: 'a'.repeat(64) });
  const staleRef = await writeInput(data.root, 'stale.json', stale);
  const staleResult = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', staleRef,
  ]);
  assert.equal(staleResult.status, 1);
  assert.equal(parse(staleResult.stderr).detail.reason, 'planned_digest_mismatch');

  const unreachable = realization(data, 'T1', { commit_oids: ['f'.repeat(40)] });
  const unreachableRef = await writeInput(data.root, 'unreachable.json', unreachable);
  const unreachableResult = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', unreachableRef,
  ]);
  assert.equal(unreachableResult.status, 1);
  assert.equal(parse(unreachableResult.stderr).code, 'STRUCTURE_REALIZATION_COMMIT_UNREACHABLE');

  const unboundTransform = transform('T1');
  unboundTransform.code_anchors[0].path = 'src/not-changed.mjs';
  const unbound = realization(data, 'T1', { realized: unboundTransform });
  const unboundRef = await writeInput(data.root, 'unbound.json', unbound);
  const unboundResult = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', unboundRef,
  ]);
  assert.equal(unboundResult.status, 1);
  assert.equal(parse(unboundResult.stderr).code, 'STRUCTURE_REALIZATION_ANCHOR_UNBOUND');
  const source = await readTodoStructureSource({ repoRoot: data.root, planKey: 'main' });
  assert.deepEqual(await readTodoStructureRealizationChain({
    repoRoot: data.root, structureSet: source, taskId: 'T1',
  }), []);
});

test('他taskがclaim済みのcommitを再利用させない', async (context) => {
  const data = await fixture(context);
  const first = realization(data, 'T1');
  const firstRef = await writeInput(data.root, 'first.json', first);
  assert.equal(run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', firstRef,
  ]).status, 0);
  const other = realization(data, 'T2');
  const otherRef = await writeInput(data.root, 'other.json', other);
  const result = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T2', '--input', otherRef,
  ]);
  assert.equal(result.status, 1);
  assert.equal(parse(result.stderr).code, 'STRUCTURE_REALIZATION_COMMIT_CLAIMED');
});

test('訂正はsupersedesで追記し、readは全履歴・最新effective・planned差分を返す', async (context) => {
  const data = await fixture(context);
  const first = realization(data, 'T1');
  const firstRef = await writeInput(data.root, 'first.json', first);
  const firstResult = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', firstRef,
  ]);
  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.equal(parse(firstResult.stdout).history_length, 1);

  const broken = realization(data, 'T1', {
    sequence: 2, previous_digest: first.realization_digest,
    supersedes: 'e'.repeat(64),
  });
  const brokenRef = await writeInput(data.root, 'broken.json', broken);
  const brokenResult = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', brokenRef,
  ]);
  assert.equal(brokenResult.status, 1);
  assert.equal(parse(brokenResult.stderr).detail.reason, 'supersedes_target_missing');

  const correctedTransform = transform('T1', { outcome: 'T1が訂正版の実装を更新する' });
  const corrected = realization(data, 'T1', {
    sequence: 2, previous_digest: first.realization_digest,
    supersedes: first.realization_digest, realized: correctedTransform,
    recorded_at: '2026-08-11T14:01:00.000Z',
  });
  const correctedRef = await writeInput(data.root, 'corrected.json', corrected);
  const correctedResult = run(data.root, [
    'structure', 'realize', '--plan', 'main', '--task', 'T1', '--input', correctedRef,
  ]);
  assert.equal(correctedResult.status, 0, correctedResult.stderr);
  assert.equal(parse(correctedResult.stdout).history_length, 2);
  assert.deepEqual(parse(correctedResult.stdout).effective.changed_fields, ['outcome']);

  const projected = run(data.root, ['structure', '--plan', 'main', '--json']);
  assert.equal(projected.status, 0, projected.stderr);
  const body = parse(projected.stdout);
  assert.equal(body.effective.history.length, 2);
  assert.equal(body.effective.tasks[0].form, 'realized');
  assert.equal(body.effective.tasks[0].realization_digest, corrected.realization_digest);
  assert.deepEqual(body.effective.tasks[0].changed_fields, ['outcome']);
  assert.equal(body.effective.tasks[1].form, 'planned');
});
