import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeTodoArtifact, todoSelfDigest } from '../src/todo-contracts.mjs';
import { validateProjectStatus } from '../src/project-cli.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-project-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

function createInput() {
  const value = {
    schema: 'lattice.plan_create_input.v1', project_id: 'sample-project',
    plan_key: 'main', plan_version: 'v1',
    actor: { host: 'host-1', session: 'session-1', agent: 'agent-1' },
    recorded_at: new Date().toISOString(),
    tasks: [{
      task_id: 'T1', title: '最初の仕事', lane: 'main', narrative_ref: null,
      narrative_anchor: null, compile_binding: null, parent_task_id: null,
    }],
    hard_dependencies: [], joins: [], input_digest: '',
  };
  value.input_digest = todoSelfDigest(value, 'input_digest');
  return value;
}

test('status --jsonは未初期化repoを成功として発見し実在する次commandを返す', async (context) => {
  const root = await workspace(context);
  const execution = run(root, ['status', '--json']);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, '');
  const result = JSON.parse(execution.stdout);
  assert.equal(result.schema, 'lattice.project_status.v1');
  assert.equal(result.cli.available, true);
  assert.match(result.cli.version, /^\d+\.\d+\.\d+$/u);
  assert.equal(result.project.root, await realpath(root));
  assert.equal(result.project.project_id, null);
  assert.equal(result.state, 'uninitialized');
  assert.equal(result.store.ref, '.lattice/todo');
  assert.equal(result.can_create_plan, true);
  assert.equal(result.next_action.command, 'lattice plan create --input .lattice/plan-create.json');
  assert.equal(result.next_action.input_schema, 'lattice.plan_create_input.v1');
  assert.equal(result.next_action.schema_command, 'lattice plan create --schema --json');
  assert.equal(result.result_digest, todoSelfDigest(result, 'result_digest'));
  assert.equal(validateProjectStatus(result), true);

  const schemaExecution = run(root, ['plan', 'create', '--schema', '--json']);
  assert.equal(schemaExecution.status, 0, schemaExecution.stderr);
  assert.equal(JSON.parse(schemaExecution.stdout).title, 'lattice.plan_create_input.v1');
});

test('status --jsonはSHA-256 Git HEADもtyped projectとして返す', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-project-sha256-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', '--object-format=sha256'], { cwd: root });
  execFileSync('git', [
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '--quiet', '-m', 'fixture',
  ], { cwd: root });
  const execution = run(root, ['status', '--json']);
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.state, 'uninitialized');
  assert.match(result.project.git_head, /^[0-9a-f]{64}$/u);
  assert.equal(validateProjectStatus(result), true);
});

test('status --jsonは末尾空白を含むrepo rootを改変しない', async (context) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'lattice-project-space-'));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'repo ');
  await mkdir(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const result = JSON.parse(run(root, ['status', '--json']).stdout);
  assert.equal(result.project.root, await realpath(root));
  assert.equal(result.store.absolute_path, path.join(await realpath(root), '.lattice', 'todo'));
});

test('status --jsonはsymlink .latticeを未初期化へ丸めない', async (context) => {
  const root = await workspace(context);
  const outside = await mkdtemp(path.join(tmpdir(), 'lattice-project-outside-'));
  context.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, '.lattice'));
  const execution = run(root, ['status', '--json']);
  assert.equal(execution.status, 1);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.state, 'invalid');
  assert.equal(result.can_create_plan, false);
  assert.equal(result.next_action.reason, 'lattice_root_invalid');
});

test('plan createはcanonical inputから初期storeを作りstatusをreadyへ遷移させる', async (context) => {
  const root = await workspace(context);
  await mkdir(path.join(root, '.lattice'));
  const input = createInput();
  await writeFile(path.join(root, '.lattice', 'plan-create.json'), `${canonicalizeTodoArtifact(input)}\n`);
  const created = run(root, ['plan', 'create', '--input', '.lattice/plan-create.json']);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stderr, '');
  const createResult = JSON.parse(created.stdout);
  assert.equal(createResult.schema, 'lattice.plan_create_result.v1');
  assert.equal(createResult.project_id, 'sample-project');
  assert.equal(createResult.plan_key, 'main');
  assert.equal(createResult.result_digest, todoSelfDigest(createResult, 'result_digest'));

  const status = run(root, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  const result = JSON.parse(status.stdout);
  assert.equal(result.state, 'ready');
  assert.equal(result.project.project_id, 'sample-project');
  assert.deepEqual(result.active_plans, [{ plan_key: 'main', plan_version: 'v1' }]);
  assert.equal(result.can_create_plan, false);
  assert.equal(result.next_action.command, 'lattice todo start --plan main --task T1');

  const started = run(root, ['todo', 'start', '--plan', 'main', '--task', 'T1'], {
    LATTICE_TODO_ACTOR_HOST: 'host-1',
    LATTICE_TODO_ACTOR_SESSION: 'session-1',
    LATTICE_TODO_ACTOR_AGENT: 'agent-1',
  });
  assert.equal(started.status, 0, started.stderr);
  const active = JSON.parse(run(root, ['status', '--json']).stdout);
  assert.equal(active.state, 'active_run');
  assert.deepEqual(active.active_runs, [{ plan_key: 'main', task_id: 'T1', label: '最初の仕事' }]);
  assert.equal(active.next_action.command, 'lattice todo status');
  assert.equal(validateProjectStatus(active), true);
});

test('壊れたstore配置はMarkdown fallbackせずtyped invalidを返す', async (context) => {
  const root = await workspace(context);
  await mkdir(path.join(root, '.lattice', 'todo'), { recursive: true });
  const execution = run(root, ['status', '--json']);
  assert.equal(execution.status, 1);
  assert.equal(execution.stderr, '');
  const result = JSON.parse(execution.stdout);
  assert.equal(result.state, 'invalid');
  assert.equal(result.can_create_plan, false);
  assert.equal(result.next_action.reason, 'store_layout_invalid');
  assert.equal(result.next_action.command, 'lattice todo verify');
});

test('plan createの非canonical inputはtyped failureでstoreを書かない', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, 'plan.json'), `${JSON.stringify(createInput(), null, 2)}\n`);
  const execution = run(root, ['plan', 'create', '--input', 'plan.json']);
  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, '');
  const failure = JSON.parse(execution.stderr);
  assert.equal(failure.schema, 'lattice.cli_error.v2');
  assert.equal(failure.code, 'INPUT_INVALID');
  assert.equal(failure.detail.reason, 'input_bytes_noncanonical');
  const status = JSON.parse(run(root, ['status', '--json']).stdout);
  assert.equal(status.state, 'uninitialized');
});

test('plan createのmissing inputはENOENTを漏らさずtyped INPUT_INVALIDを返す', async (context) => {
  const root = await workspace(context);
  const execution = run(root, ['plan', 'create', '--input', 'missing.json']);
  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, '');
  const failure = JSON.parse(execution.stderr);
  assert.equal(failure.code, 'INPUT_INVALID');
  assert.equal(failure.detail.reason, 'input_unreadable');
});

test('plan createは上限超過inputを全量parseせずtyped拒否する', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, 'large.json'), Buffer.alloc(8_388_609, 0x20));
  const execution = run(root, ['plan', 'create', '--input', 'large.json']);
  assert.equal(execution.status, 1);
  const failure = JSON.parse(execution.stderr);
  assert.equal(failure.code, 'INPUT_INVALID');
  assert.equal(failure.detail.reason, 'input_too_large');
});

test('plan createはunsafe .latticeで失敗してもstagingを残さない', async (context) => {
  const root = await workspace(context);
  const input = createInput();
  await writeFile(path.join(root, 'plan.json'), `${canonicalizeTodoArtifact(input)}\n`);
  await writeFile(path.join(root, '.lattice'), 'not-a-directory\n');
  const execution = run(root, ['plan', 'create', '--input', 'plan.json']);
  assert.equal(execution.status, 1);
  const failure = JSON.parse(execution.stderr);
  assert.equal(failure.code, 'STORE_INCONSISTENT');
  assert.equal(failure.detail.reason, 'unsafe_lattice_root');
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith('.lattice-todo-authoring-')), []);
});
