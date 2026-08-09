import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  TodoStoreError,
  createTodoStoreWriter,
  initializeTodoStore,
  readTodoIndependenceArtifact,
  readTodoStore,
  todoIndependenceRef,
  writeTodoIndependenceArtifact,
} from '../src/todo-store.mjs';
import {
  TODO_INDEPENDENCE_LEGACY_MARKER_SCHEMA,
  TODO_INDEPENDENCE_SCHEMA,
} from '../src/todo-independence-contracts.mjs';
import { canonicalizeTodoArtifact, todoSelfDigest } from '../src/todo-contracts.mjs';

// ADR 0127 Decision 1。independence artifactはplanへ並置し、manifestへは登録しない。
// active planへbindできない記録は書かせない。読めない記録をnullへ丸めない。

const NOW = '2026-07-26T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const BASE_SHA = 'a'.repeat(40);

const task = (taskId) => ({
  task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null,
});

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-independence-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
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
        tasks: [task('T1'), task('T2')],
        hard_dependencies: [],
        joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  return { root, plan: store.members[0].plan };
}

function artifactFor(plan, overrides = {}) {
  const value = {
    schema: TODO_INDEPENDENCE_SCHEMA,
    project_id: plan.project_id,
    plan_key: plan.plan_key,
    plan_version: plan.plan_version,
    topology_digest: plan.topology_digest,
    base_sha: BASE_SHA,
    witness_set_digest: 'd'.repeat(64),
    compiled_at: NOW,
    task_ids: ['T1', 'T2'],
    task_boundaries: [
      { task_id: 'T1', paths: ['src/t1.mjs'] },
      { task_id: 'T2', paths: ['src/t2.mjs'] },
    ],
    conflict_resources: [],
    conflicts: [],
    precedences: [],
    unknowns: [],
    wave_plan: { waves: [{ task_ids: ['T1', 'T2'] }], minimum_feasible_waves: 1 },
    outcome: 'compiled',
    result_digest: '',
    ...overrides,
  };
  // v4: scope_expanded は task_ids と1:1でなければ validator が落とす。
  // fixture の既定は「膨張ゼロ・比較相手なし」で、膨張そのものを測る test は overrides で上書きする
  value.scope_expanded = value.scope_expanded ?? (value.task_ids ?? []).map((taskId) => ({
    task_id: taskId, compared_witness_digest: null, first_seen_path_count: 0,
    path_count: 0, added_paths: [], removed_paths: [], growth_events: 0, gate_shape: false,
  }));
  value.result_digest = todoSelfDigest(value, 'result_digest');
  return value;
}

async function expectCode(promise, code, reason) {
  await assert.rejects(promise, (error) => error instanceof TodoStoreError
    && error.code === code && (reason === undefined || error.detail.reason === reason));
}

test('artifactはplan versionディレクトリへ書かれ、そのまま読み戻せる', async (context) => {
  const { root, plan } = await workspace(context);
  const artifact = artifactFor(plan);

  const written = await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });
  assert.equal(written.ref, todoIndependenceRef('main', plan.plan_version));
  assert.equal(written.ref, `.lattice/todo/plans/main/${plan.plan_version}/independence.json`);

  const bytes = await readFile(path.join(root, written.ref));
  assert.equal(bytes.toString('utf8'), `${canonicalizeTodoArtifact(artifact)}\n`);

  const read = await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW });
  assert.deepEqual(read, artifact);
});

test('artifactはmanifestを変えない', async (context) => {
  const { root, plan } = await workspace(context);
  const before = await readFile(path.join(root, '.lattice/todo/manifest.json'));
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact: artifactFor(plan), now: NOW });
  const after = await readFile(path.join(root, '.lattice/todo/manifest.json'));
  assert.deepEqual(after, before);
});

test('記録が無ければnullを返す（未判定と読めない状態を区別する）', async (context) => {
  const { root } = await workspace(context);
  const read = await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW });
  assert.equal(read, null);
});

test('active planへbindできない記録は書かせない', async (context) => {
  const { root, plan } = await workspace(context);

  await expectCode(writeTodoIndependenceArtifact({
    repoRoot: root, artifact: artifactFor(plan, { plan_version: 'v9' }), now: NOW,
  }), 'INDEPENDENCE_BINDING_MISMATCH', 'plan_version_mismatch');

  await expectCode(writeTodoIndependenceArtifact({
    repoRoot: root, artifact: artifactFor(plan, { topology_digest: 'f'.repeat(64) }), now: NOW,
  }), 'INDEPENDENCE_BINDING_MISMATCH', 'topology_digest_mismatch');

  await expectCode(writeTodoIndependenceArtifact({
    repoRoot: root, artifact: artifactFor(plan, { project_id: 'other' }), now: NOW,
  }), 'INDEPENDENCE_BINDING_MISMATCH', 'project_id_mismatch');

  await expectCode(writeTodoIndependenceArtifact({
    repoRoot: root,
    artifact: artifactFor(plan, {
      task_ids: ['T1', 'T9'],
      task_boundaries: [
        { task_id: 'T1', paths: ['src/t1.mjs'] },
        { task_id: 'T9', paths: ['src/t9.mjs'] },
      ],
      wave_plan: { waves: [{ task_ids: ['T1', 'T9'] }], minimum_feasible_waves: 1 },
    }),
    now: NOW,
  }), 'INDEPENDENCE_BINDING_MISMATCH', 'task_absent_from_plan');

  await expectCode(writeTodoIndependenceArtifact({
    repoRoot: root, artifact: artifactFor(plan, { plan_key: 'absent-plan' }), now: NOW,
  }), 'STORE_INCONSISTENT', 'plan_not_active');
});

test('契約を満たさないartifactは書かせない', async (context) => {
  const { root, plan } = await workspace(context);
  const tampered = artifactFor(plan);
  tampered.base_sha = 'b'.repeat(40); // 自己digestが合わなくなる

  await expectCode(writeTodoIndependenceArtifact({ repoRoot: root, artifact: tampered, now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID', 'independence_artifact_invalid');

  const legacy = artifactFor(plan, { schema: 'lattice.todo_independence.v2' });
  await expectCode(writeTodoIndependenceArtifact({ repoRoot: root, artifact: legacy, now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID', 'independence_artifact_invalid');
});

test('identityが揃った既知の旧契約は本体を信用せずlegacy markerとして返す', async (context) => {
  const { root, plan } = await workspace(context);
  const { ref } = await writeTodoIndependenceArtifact({
    repoRoot: root, artifact: artifactFor(plan), now: NOW,
  });

  for (const schema of ['lattice.todo_independence.v1', 'lattice.todo_independence.v2']) {
    await writeFile(path.join(root, ref), `${canonicalizeTodoArtifact({
      schema,
      project_id: plan.project_id,
      plan_key: plan.plan_key,
      plan_version: plan.plan_version,
      topology_digest: plan.topology_digest,
      base_sha: BASE_SHA,
      witness_set_digest: 'd'.repeat(64),
      result_digest: 'e'.repeat(64),
      ignored_body: true,
    })}\n`);
    const read = await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW });
    assert.deepEqual(read, {
      schema: TODO_INDEPENDENCE_LEGACY_MARKER_SCHEMA,
      legacy_schema: schema,
      project_id: 'project-1',
      plan_key: 'main',
      plan_version: null,
      topology_digest: null,
      base_sha: null,
    });
  }
});

test('壊れた・非canonical・未知schema・不正な現行v3はfail closedにする', async (context) => {
  const { root, plan } = await workspace(context);
  const { ref } = await writeTodoIndependenceArtifact({
    repoRoot: root, artifact: artifactFor(plan), now: NOW,
  });

  await writeFile(path.join(root, ref), '{"schema":"lattice.todo_independence.v4"}\n');
  await expectCode(readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID', 'schema_invalid');

  await writeFile(path.join(root, ref), `{"schema":"${TODO_INDEPENDENCE_SCHEMA}"}\n`);
  await expectCode(readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID', 'schema_invalid');

  await writeFile(path.join(root, ref), '{"schema":"lattice.todo_independence.v2"}\n');
  await expectCode(readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID', 'schema_invalid');

  // canonical JSON+LF規律を外れたbytesも受理しない。
  const artifact = artifactFor(plan);
  await writeFile(path.join(root, ref), `${JSON.stringify(artifact, null, 2)}\n`);
  await expectCode(readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID');

  await writeFile(path.join(root, ref), '{broken-json}\n');
  await expectCode(readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }),
    'INDEPENDENCE_ARTIFACT_INVALID', 'artifact_truncated_or_trailing_bytes');
});

test('同じrefへの再compileは前の記録を置き換える', async (context) => {
  const { root, plan } = await workspace(context);
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact: artifactFor(plan), now: NOW });

  const next = artifactFor(plan, {
    base_sha: 'c'.repeat(40),
    outcome: 'unknown',
    wave_plan: null,
    unknowns: [{ task_id: 'T1', kind: 'sensor_unbound', ref: 'path:src/a.mjs' }],
  });
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact: next, now: NOW });

  const read = await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW });
  assert.equal(read.outcome, 'unknown');
  assert.equal(read.base_sha, 'c'.repeat(40));
});
