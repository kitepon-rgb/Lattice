import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeTodoArtifact, todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  TODO_STRUCTURE_BINDING_SCHEMA,
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  TODO_STRUCTURE_SET_SCHEMA,
  digestTodoStructureTransform,
} from '../src/todo-structure-contracts.mjs';
import {
  buildTodoStructureCompileArtifact,
  migrateTodoStructureSetTaskIds,
  readTodoStructureState,
} from '../src/todo-structure-store.mjs';
import {
  TodoStoreError,
  buildTodoPlan,
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoStore,
  todoStructureRealizationRef,
  writeTodoStructureBinding,
  writeTodoStructureCompileArtifact,
  writeTodoStructureSource,
} from '../src/todo-store.mjs';

const NOW = '2026-08-11T15:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-structure-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  git(root, ['add', 'README.md']); git(root, ['commit', '--quiet', '-m', 'fixture']);
  const baselineSha = git(root, ['rev-parse', 'HEAD']);
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null, tasks: [task('T1')],
        hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  return { root, baselineSha, member: store.members[0] };
}

function planned() {
  return {
    outcome: '入力を成果へ変換する', inputs: [], operations: [], outputs: [], code_anchors: [],
    failures: ['入力不足'], first_live_e2e: '実入力を一件処理する', non_goals: ['並列性判定'],
  };
}

function structureSet(fixture, overrides = {}) {
  const value = {
    schema: TODO_STRUCTURE_SET_SCHEMA, project_id: 'project-1', plan_key: 'main',
    plan_version: fixture.member.plan.plan_version,
    topology_digest: fixture.member.plan.topology_digest,
    profile: 'code-dataflow', baseline_sha: fixture.baselineSha, external_contracts: [],
    tasks: [{ task_id: 'T1', applicability: 'graph', planned: planned() }],
    structure_set_digest: '', ...overrides,
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

function compilerInputs(set) {
  const sourceProjection = {
    schema: 'lattice.todo_structure_source_projection.v1',
    structure_set_digest: set.structure_set_digest,
    sensor_status: { outcome: 'ready', evidence: null }, anchors: [], summary: {},
    projection_digest: '',
  };
  sourceProjection.projection_digest = todoSelfDigest(sourceProjection, 'projection_digest');
  const gitProvenance = {
    schema: 'lattice.todo_structure_git_provenance.v1',
    structure_set_digest: set.structure_set_digest,
    baseline_sha: set.baseline_sha, head_sha: set.baseline_sha,
    commit_order: [], changesets: [], summary: {}, sensor_diff: {}, provenance_digest: '',
  };
  gitProvenance.provenance_digest = todoSelfDigest(gitProvenance, 'provenance_digest');
  const overlay = {
    schema: 'lattice.todo_structure_overlay.v1',
    structure_set_digest: set.structure_set_digest,
    source_projection_digest: sourceProjection.projection_digest,
    git_provenance_digest: gitProvenance.provenance_digest,
    todo_chain: null, graph: { nodes: [], edges: [] }, verdict: 'consistent', findings: [],
    finding_summary: { total: 0, returned: 0, omitted: 0, errors: 0, unknowns: 0, notices: 0 },
    overlay_digest: '',
  };
  overlay.overlay_digest = todoSelfDigest(overlay, 'overlay_digest');
  return { sourceProjection, gitProvenance, overlay };
}

async function activate(fixture) {
  const set = structureSet(fixture);
  await writeTodoStructureSource({ repoRoot: fixture.root, structureSet: set, now: NOW });
  const inputs = compilerInputs(set);
  const artifact = buildTodoStructureCompileArtifact({
    structureSet: set, ...inputs, compiledAt: NOW, actor: ACTOR,
  });
  await writeTodoStructureCompileArtifact({ repoRoot: fixture.root, artifact, now: NOW });
  const binding = {
    schema: TODO_STRUCTURE_BINDING_SCHEMA,
    project_id: set.project_id, plan_key: set.plan_key, plan_version: set.plan_version,
    topology_digest: set.topology_digest, profile: set.profile, baseline_sha: set.baseline_sha,
    structure_set_digest: set.structure_set_digest, compiled_head_sha: artifact.current_head_sha,
    compile_artifact_digest: artifact.artifact_digest, activated_at: NOW, actor: ACTOR,
    binding_digest: '',
  };
  binding.binding_digest = todoSelfDigest(binding, 'binding_digest');
  await writeTodoStructureBinding({ repoRoot: fixture.root, binding, now: NOW });
  return { set, artifact, binding };
}

test('保存artifactとHEAD identityだけでfreshを返す', async (context) => {
  const fixture = await workspace(context);
  const { artifact } = await activate(fixture);
  const state = await readTodoStructureState({
    repoRoot: fixture.root, planKey: 'main', now: NOW,
  });
  assert.equal(state.status, 'fresh');
  assert.equal(state.compiled_verdict, 'consistent');
  assert.equal(state.effective_verdict, 'consistent');
  assert.equal(state.artifact_digest, artifact.artifact_digest);
});

test('HEAD変更後はcompiled verdictを有効なconsistentとして返さない', async (context) => {
  const fixture = await workspace(context);
  await activate(fixture);
  await writeFile(path.join(fixture.root, 'README.md'), 'changed\n');
  git(fixture.root, ['add', 'README.md']); git(fixture.root, ['commit', '--quiet', '-m', 'changed']);
  const state = await readTodoStructureState({ repoRoot: fixture.root, planKey: 'main', now: NOW });
  assert.equal(state.status, 'stale');
  assert.equal(state.compiled_verdict, 'consistent');
  assert.equal(state.effective_verdict, null);
  assert.deepEqual(state.stale_reasons, ['current_head_sha']);
});

test('structure sourceまたはrealization headの変更は再compile待ちのstaleになる', async (context) => {
  const sourceFixture = await workspace(context);
  const activatedSource = await activate(sourceFixture);
  const changedSource = structuredClone(activatedSource.set);
  changedSource.tasks[0].planned.outcome = '別の入力を成果へ変換する';
  changedSource.structure_set_digest = todoSelfDigest(changedSource, 'structure_set_digest');
  const sourceRef = path.join(sourceFixture.root, '.lattice/todo/structure/main.json');
  await writeFile(sourceRef, `${canonicalizeTodoArtifact(changedSource)}\n`);
  const sourceState = await readTodoStructureState({
    repoRoot: sourceFixture.root, planKey: 'main', now: NOW,
  });
  assert.equal(sourceState.status, 'stale');
  assert.deepEqual(sourceState.stale_reasons, ['structure_set_digest']);
  assert.equal(sourceState.effective_verdict, null);

  const realizationFixture = await workspace(context);
  const { set } = await activate(realizationFixture);
  const record = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: set.project_id, plan_key: set.plan_key, plan_version: set.plan_version,
    task_id: 'T1', sequence: 1, previous_digest: null,
    structure_set_digest: set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(set.tasks[0].planned),
    head_sha: set.baseline_sha, commit_oids: [set.baseline_sha],
    realized: structuredClone(set.tasks[0].planned), supersedes: null,
    actor: ACTOR, recorded_at: NOW, realization_digest: '',
  };
  record.realization_digest = todoSelfDigest(record, 'realization_digest');
  const realizationRef = todoStructureRealizationRef('main', 'v1', 'T1');
  await mkdir(path.dirname(path.join(realizationFixture.root, realizationRef)), { recursive: true });
  await writeFile(path.join(realizationFixture.root, realizationRef),
    `${canonicalizeTodoArtifact(record)}\n`);
  const realizationState = await readTodoStructureState({
    repoRoot: realizationFixture.root, planKey: 'main', now: NOW,
  });
  assert.equal(realizationState.status, 'stale');
  assert.deepEqual(realizationState.stale_reasons, ['realization_head_digest']);
  assert.equal(realizationState.effective_verdict, null);
});

test('compile artifactはbinding発行後に上書きできない', async (context) => {
  const fixture = await workspace(context);
  const { artifact } = await activate(fixture);
  await assert.rejects(
    writeTodoStructureCompileArtifact({ repoRoot: fixture.root, artifact, now: NOW }),
    (error) => error instanceof TodoStoreError
      && error.code === 'STRUCTURE_ALREADY_ENABLED',
  );
});

test('未設定と破損realization chainを区別する', async (context) => {
  const missingFixture = await workspace(context);
  const missing = await readTodoStructureState({
    repoRoot: missingFixture.root, planKey: 'main', now: NOW,
  });
  assert.equal(missing.status, 'missing');

  const fixture = await workspace(context);
  const { set } = await activate(fixture);
  const ref = todoStructureRealizationRef('main', 'v1', 'T1');
  await mkdir(path.dirname(path.join(fixture.root, ref)), { recursive: true });
  await writeFile(path.join(fixture.root, ref), '{not-json}\n');
  await assert.rejects(
    readTodoStructureState({ repoRoot: fixture.root, planKey: 'main', now: NOW }),
    (error) => error instanceof TodoStoreError
      && error.code === 'INVALID_TODO_STRUCTURE_REALIZATION_CHAIN',
  );
  assert.equal(set.plan_version, 'v1');
});

test('旧plan versionのsourceはmissingでなくsupersededになる', async (context) => {
  const fixture = await workspace(context);
  const old = structureSet(fixture, { plan_version: 'v0' });
  const ref = path.join(fixture.root, '.lattice/todo/structure/main.json');
  await mkdir(path.dirname(ref), { recursive: true });
  await writeFile(ref, `${canonicalizeTodoArtifact(old)}\n`);
  const state = await readTodoStructureState({ repoRoot: fixture.root, planKey: 'main', now: NOW });
  assert.equal(state.status, 'superseded');
  assert.equal(state.reason, 'plan_revision_changed');
});

test('revision helperはtask IDだけを写し意味の妥当性をrequiredのまま返す', async () => {
  const predecessor = buildTodoPlan({
    schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
    plan_version: 'v1', predecessor_plan_digest: null, tasks: [task('T1')],
    hard_dependencies: [], joins: [],
  });
  const successor = buildTodoPlan({
    schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
    plan_version: 'v2', predecessor_plan_digest: predecessor.plan_digest, tasks: [task('T2')],
    hard_dependencies: [], joins: [],
  });
  const set = structureSet({
    baselineSha: 'a'.repeat(40), member: { plan: predecessor },
  });
  const result = migrateTodoStructureSetTaskIds({
    structureSet: set,
    taskMigration: [{ from_task_id: 'T1', to_task_id: 'T2', state_policy: 'reset_pending' }],
    successorPlan: successor,
  });
  assert.equal(result.structure_set.plan_version, 'v2');
  assert.equal(result.structure_set.topology_digest, successor.topology_digest);
  assert.deepEqual(result.copied_task_ids, ['T2']);
  assert.equal(result.semantic_validation, 'required');
});
