import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { todoSelfDigest } from '../../src/todo-contracts.mjs';
import {
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  TODO_STRUCTURE_SET_SCHEMA,
  digestTodoStructureTransform,
} from '../../src/todo-structure-contracts.mjs';
import {
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoStore,
} from '../../src/todo-store.mjs';
import { registerManagedDaemonFixture } from './managed-daemon-fixture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
export const STRUCTURE_E2E_ACTOR = Object.freeze({
  host: 'fixture-host', session: 'fixture-session', agent: 'fixture-agent',
});
const ENV = Object.freeze({
  ...process.env, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0',
  LATTICE_TODO_ACTOR_HOST: STRUCTURE_E2E_ACTOR.host,
  LATTICE_TODO_ACTOR_SESSION: STRUCTURE_E2E_ACTOR.session,
  LATTICE_TODO_ACTOR_AGENT: STRUCTURE_E2E_ACTOR.agent,
});

export function structureE2eGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function runStructureE2eCli(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf8', env: ENV,
  });
  assert.equal(result.error, undefined);
  return result;
}

export const parseStructureE2eJson = (text) => JSON.parse(text.trim().split('\n').at(-1));

const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

const plan = (planKey, taskIds) => ({
  schema: 'lattice.todo_plan.v1', project_id: 'structure-e2e', plan_key: planKey,
  plan_version: 'v1', predecessor_plan_digest: null,
  tasks: taskIds.map(task), hard_dependencies: [], joins: [],
});

export async function createTodoStructureE2eFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-structure-e2e-'));
  registerManagedDaemonFixture(t, root);
  structureE2eGit(root, ['init', '--quiet']);
  structureE2eGit(root, ['config', 'user.name', 'Lattice Structure E2E']);
  structureE2eGit(root, ['config', 'user.email', 'structure-e2e@example.invalid']);
  structureE2eGit(root, ['config', 'commit.gpgSign', 'false']);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, '.gitignore'), [
    '.lattice/sensor/', '.lattice/test-inputs/', '.lattice/evidence/', '',
  ].join('\n'));
  await writeFile(path.join(root, 'README.md'), 'structure e2e\n');
  await writeFile(path.join(root, 'src/lifecycle.mjs'),
    'export function runLifecycle(value) { return value; }\n');
  await writeFile(path.join(root, 'src/negative.mjs'),
    'export function inspectNegative(value) { return value; }\n');
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'structure-e2e', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [
      { plan: plan('negative', ['A', 'B']), genesis: { actor: STRUCTURE_E2E_ACTOR,
        recorded_at: '2026-08-11T00:00:00.000Z' } },
      { plan: plan('lifecycle', ['L1', 'L2']), genesis: { actor: STRUCTURE_E2E_ACTOR,
        recorded_at: '2026-08-11T00:00:00.000Z' } },
      { plan: plan('plain', ['P1']), genesis: { actor: STRUCTURE_E2E_ACTOR,
        recorded_at: '2026-08-11T00:00:00.000Z' } },
    ],
    now: '2026-08-11T00:00:00.000Z',
  });
  structureE2eGit(root, ['add', '--', '.gitignore', 'README.md', 'src', '.lattice/todo']);
  structureE2eGit(root, ['commit', '--quiet', '-m', 'structure e2e baseline']);
  const store = await readTodoStore({ repoRoot: root });
  return {
    root, baselineSha: structureE2eGit(root, ['rev-parse', 'HEAD']),
    members: new Map(store.members.map((member) => [member.plan.plan_key, member])),
  };
}

export const structureContract = (shapeId) => ({
  shape_id: shapeId, schema_ref: null, identity_fields: ['id'],
  lifecycle: 'immutable_artifact', cardinality: 'one', compatible_shape_ids: [],
});

export function emptyTransform(taskId, { codeAnchors = [] } = {}) {
  return {
    outcome: `${taskId}の入力を整理する`, inputs: [], operations: [], outputs: [],
    code_anchors: codeAnchors, failures: [`${taskId}の処理失敗`],
    first_live_e2e: `${taskId}を一件実行する`, non_goals: ['並列可否を判定する'],
  };
}

export function structureSet(fixture, planKey, tasks) {
  const member = fixture.members.get(planKey);
  const value = {
    schema: TODO_STRUCTURE_SET_SCHEMA, project_id: 'structure-e2e', plan_key: planKey,
    plan_version: 'v1', topology_digest: member.plan.topology_digest,
    profile: 'code-dataflow', baseline_sha: fixture.baselineSha,
    external_contracts: [], tasks, structure_set_digest: '',
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

export async function writeStructureE2eJson(root, name, value) {
  const directory = path.join(root, '.lattice/test-inputs');
  await mkdir(directory, { recursive: true });
  const relative = `.lattice/test-inputs/${name}`;
  await writeFile(path.join(root, relative), `${JSON.stringify(value)}\n`);
  return relative;
}

export async function writeStructureE2eEvidence(root, taskId) {
  const directory = path.join(root, '.lattice/evidence');
  await mkdir(directory, { recursive: true });
  const evidenceRef = `.lattice/evidence/${taskId}.txt`;
  const bytes = Buffer.from(`${taskId} evidence\n`, 'utf8');
  await writeFile(path.join(root, evidenceRef), bytes);
  const descriptor = {
    evidence_id: `${taskId}-evidence`, repo_id: 'self', path: evidenceRef,
    git_blob_oid: structureE2eGit(root, ['hash-object', '-w', evidenceRef]),
    content_digest: createHash('sha256').update(bytes).digest('hex'),
    media_type: 'text/plain', anchor_digest: null,
  };
  return writeStructureE2eJson(root, `${taskId}-evidence.json`, descriptor);
}

export function structureRealization(set, taskId, commitOid, overrides = {}) {
  const planned = set.tasks.find(({ task_id: id }) => id === taskId).planned;
  const value = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: set.project_id, plan_key: set.plan_key, plan_version: set.plan_version,
    task_id: taskId, sequence: 1, previous_digest: null,
    structure_set_digest: set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(planned), head_sha: commitOid,
    commit_oids: [commitOid], realized: structuredClone(planned), supersedes: null,
    actor: STRUCTURE_E2E_ACTOR, recorded_at: '2026-08-11T01:00:00.000Z',
    realization_digest: '', ...overrides,
  };
  value.realization_digest = todoSelfDigest(value, 'realization_digest');
  return value;
}
