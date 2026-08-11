import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { TODO_STRUCTURE_SET_SCHEMA } from '../src/todo-structure-contracts.mjs';
import { renderCliHelp } from '../src/cli-help.mjs';
import { canonicalizeTodoArtifact, todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoStore,
  todoStructureBindingRef,
  todoStructureSourceRef,
} from '../src/todo-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const NOW = '2026-08-11T13:00:00.000Z';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).replace(/\r?\n$/u, '');
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI, 'todo', ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0' },
  });
}

const parse = (text) => JSON.parse(text.trim().split('\n').at(-1));

const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-structure-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  const baselineSha = git(root, ['rev-parse', 'HEAD']);
  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [task('T1'), task('T2')], hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  return { root, baselineSha, member: store.members[0] };
}

function planned() {
  return {
    outcome: '入力を整理して成果へ渡す', inputs: [], operations: [], outputs: [], code_anchors: [],
    failures: ['入力不足'], first_live_e2e: '実入力を一件処理する', non_goals: ['並列性を判定する'],
  };
}

function structureSet({ baselineSha, member }, overrides = {}) {
  const value = {
    schema: TODO_STRUCTURE_SET_SCHEMA,
    project_id: 'project-1', plan_key: 'main', plan_version: 'v1',
    topology_digest: member.plan.topology_digest,
    profile: 'code-dataflow', baseline_sha: baselineSha,
    external_contracts: [],
    tasks: [
      { task_id: 'T1', applicability: 'graph', planned: planned() },
      { task_id: 'T2', applicability: 'excluded', excluded_reason: 'fixtureでは文書作業だけを行う' },
    ],
    structure_set_digest: '',
    ...overrides,
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

async function writeDraft(root, value, name = 'structure-draft.json') {
  await writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
  return name;
}

async function snapshotTree(root) {
  const result = {};
  async function walk(current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else result[relative] = (await readFile(absolute)).toString('hex');
    }
  }
  await walk(root, '');
  return result;
}

test('structure input dry-runはplan identity・coverage・baselineを無変更で検査する', async (context) => {
  const fixture = await workspace(context);
  const inputRef = await writeDraft(fixture.root, structureSet(fixture));
  const before = await snapshotTree(path.join(fixture.root, '.lattice', 'todo'));

  const execution = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', inputRef, '--dry-run', '--json',
  ]);
  assert.equal(execution.status, 0, execution.stderr);
  const result = parse(execution.stdout);
  assert.equal(result.schema, 'lattice.todo_structure_input_dry_run_result.v1');
  assert.equal(result.valid, true);
  assert.equal(result.current_head_sha, fixture.baselineSha);
  assert.equal(result.source_ref, '.lattice/todo/structure/main.json');
  assert.deepEqual(result.violations, []);
  assert.deepEqual(await snapshotTree(path.join(fixture.root, '.lattice', 'todo')), before);
  await assert.rejects(lstat(path.join(fixture.root, result.source_ref)), { code: 'ENOENT' });
});

test('structure inputは検査成功後だけcanonical sourceを保存しbindingを発行しない', async (context) => {
  const fixture = await workspace(context);
  const set = structureSet(fixture);
  const inputRef = await writeDraft(fixture.root, set);
  const execution = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', inputRef,
  ]);
  assert.equal(execution.status, 0, execution.stderr);
  const result = parse(execution.stdout);
  assert.equal(result.schema, 'lattice.todo_structure_input_result.v1');
  assert.equal(result.enabled, false);
  assert.equal(result.source_ref, todoStructureSourceRef('main'));
  assert.equal(await readFile(path.join(fixture.root, result.source_ref), 'utf8'),
    `${canonicalizeTodoArtifact(set)}\n`);
  await assert.rejects(lstat(path.join(fixture.root, todoStructureBindingRef('main', 'v1'))), {
    code: 'ENOENT',
  });
});

test('coverage・plan identity違反はpointerを返しsource bytesを作らない', async (context) => {
  const fixture = await workspace(context);
  const set = structureSet(fixture, {
    plan_version: 'v2',
    tasks: [{ task_id: 'T1', applicability: 'graph', planned: planned() }],
  });
  const inputRef = await writeDraft(fixture.root, set);
  const dryRun = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', inputRef, '--dry-run', '--json',
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const report = parse(dryRun.stdout);
  assert.equal(report.valid, false);
  assert.equal(report.violations.some(({ code, path: pointer }) => code === 'plan_version_mismatch'
    && pointer === '/plan_version'), true);
  assert.equal(report.violations.some(({ code, path: pointer }) => code === 'coverage_missing'
    && pointer === '/tasks'), true);

  const write = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', inputRef,
  ]);
  assert.equal(write.status, 1);
  assert.equal(parse(write.stderr).code, 'INVALID_TODO_STRUCTURE_SET');
  await assert.rejects(lstat(path.join(fixture.root, todoStructureSourceRef('main'))), { code: 'ENOENT' });
});

test('baselineが実commitでもHEAD祖先でなければdry-runで区別する', async (context) => {
  const fixture = await workspace(context);
  const tree = git(fixture.root, ['write-tree']);
  const unrelated = git(fixture.root, ['commit-tree', tree, '-m', 'unrelated root']);
  const inputRef = await writeDraft(fixture.root, structureSet(fixture, { baseline_sha: unrelated }));
  const execution = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', inputRef, '--dry-run', '--json',
  ]);
  assert.equal(execution.status, 0, execution.stderr);
  const result = parse(execution.stdout);
  assert.equal(result.valid, false);
  assert.equal(result.violations.some(({ code }) => code === 'baseline_not_ancestor'), true);
});

test('repo外inputはgit・store読取より前にtyped usage拒否する', async (context) => {
  const fixture = await workspace(context);
  const execution = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', '/tmp/structure.json', '--dry-run', '--json',
  ]);
  assert.equal(execution.status, 2);
  const error = parse(execution.stderr);
  assert.equal(error.code, 'INPUT_OUTSIDE_REPOSITORY');
  assert.equal(error.detail.argument, '--input');
});

test('bindingが既に在るplanのplanned sourceをinput writerで上書きしない', async (context) => {
  const fixture = await workspace(context);
  const set = structureSet(fixture);
  const inputRef = await writeDraft(fixture.root, set);
  const bindingRef = todoStructureBindingRef('main', 'v1');
  await mkdir(path.dirname(path.join(fixture.root, bindingRef)), { recursive: true });
  await writeFile(path.join(fixture.root, bindingRef), '{}\n');

  const execution = runCli(fixture.root, [
    'structure', 'input', '--plan', 'main', '--input', inputRef,
  ]);
  assert.equal(execution.status, 1);
  const error = parse(execution.stderr);
  assert.equal(error.code, 'STRUCTURE_ALREADY_ENABLED');
  assert.equal(error.detail.reason, 'immutable_binding_exists');
  await assert.rejects(lstat(path.join(fixture.root, todoStructureSourceRef('main'))), { code: 'ENOENT' });
});

test('todo helpはstructure schema・dry-run・保存後も未有効であることを案内する', () => {
  const namespace = renderCliHelp(['todo', '--help']);
  assert.match(namespace, /structure --schema --json/u);
  assert.match(namespace, /structure input --plan <key> --input <file> --dry-run --json/u);
  assert.match(namespace, /compile成功までは有効化しない/u);
  assert.equal(renderCliHelp(['todo', 'structure', '--help']),
    'Usage: lattice todo structure --schema --json | input --plan <key> --input <file> [--dry-run --json]\n');
});
