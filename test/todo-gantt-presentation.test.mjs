import assert from 'node:assert/strict';
import {
  mkdir, mkdtemp, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadTodoGanttPresentation,
  projectTodoGanttPresentation,
  TODO_GANTT_PRESENTATION_REF,
} from '../src/todo-gantt-presentation.mjs';
import { digestTodoArtifact } from '../src/todo-contracts.mjs';
import { TodoStoreError } from '../src/todo-store.mjs';

function fixture(plans = [{
  plan_key: 'main',
  tasks: [
    { task_id: 'fm-0001', lane: 'O1' },
    { task_id: 'fm-0010', lane: 'O2' },
    { task_id: 'plain-task', lane: 'maintenance' },
  ],
}]) {
  return {
    schema: 'lattice.todo_store_read.v1',
    project_id: 'project-1',
    members: plans.map((plan) => ({
      plan: {
        project_id: 'project-1', plan_key: plan.plan_key,
        tasks: plan.tasks.map((task) => ({ title: task.task_id, ...task })),
      },
    })),
  };
}

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-gantt-presentation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.lattice', 'todo'), { recursive: true });
  return root;
}

async function writePresentation(root, value) {
  await writeFile(path.join(root, TODO_GANTT_PRESENTATION_REF), `${JSON.stringify(value)}\n`);
}

test('工程番号はplan内で一意な数字suffixだけをcanonical taskへ束縛する', () => {
  const readModel = fixture([{
    plan_key: 'main',
    tasks: [
      { task_id: 'fm-0001', lane: 'O1' },
      { task_id: 'legacy-1', lane: 'O1' },
      { task_id: 'fm-0010', lane: 'O2' },
      { task_id: 'plain-task', lane: 'maintenance' },
    ],
  }, {
    plan_key: 'secondary',
    tasks: [{ task_id: 's-0010', lane: 'O1' }],
  }]);

  const projected = projectTodoGanttPresentation(readModel, null);
  assert.deepEqual(projected.task_numbers, [
    {
      project_id: 'project-1', plan_key: 'main', task_id: 'fm-0010',
      display_number: '0010', normalized_number: '10', globally_unique: false,
    },
    {
      project_id: 'project-1', plan_key: 'secondary', task_id: 's-0010',
      display_number: '0010', normalized_number: '10', globally_unique: false,
    },
  ]);
});

test('sidecarなしはraw lane fallback用の空metadataと工程番号bindingを返す', async (context) => {
  const root = await workspace(context);
  const projected = await loadTodoGanttPresentation({ repoRoot: root, readModel: fixture() });
  assert.equal(projected.schema, 'lattice.todo_gantt_presentation_model.v1');
  assert.equal(projected.configured, false);
  assert.deepEqual(projected.lanes, []);
  assert.equal(projected.task_numbers.length, 2);
  assert.equal(projected.presentation_digest, digestTodoArtifact({
    schema: projected.schema,
    project_id: projected.project_id,
    configured: projected.configured,
    lanes: projected.lanes,
    task_numbers: projected.task_numbers,
  }));
});

test('valid sidecarはplan/lane順へ正規化し名称と説明を保持する', async (context) => {
  const root = await workspace(context);
  await writePresentation(root, {
    schema: 'lattice.todo_gantt_presentation.v1',
    project_id: 'project-1',
    plans: [{
      plan_key: 'main',
      lanes: [
        { lane: 'O2', name: 'Observer製品完成', description: 'Observerを製品として完成させる。' },
        { lane: 'O1', name: 'Throughline feed', description: 'completed turnを観測する。' },
      ],
    }],
  });

  const projected = await loadTodoGanttPresentation({ repoRoot: root, readModel: fixture() });
  assert.equal(projected.configured, true);
  assert.deepEqual(projected.lanes.map(({ lane, name }) => [lane, name]), [
    ['O1', 'Throughline feed'],
    ['O2', 'Observer製品完成'],
  ]);
  const digest = projected.presentation_digest;

  await writePresentation(root, {
    schema: 'lattice.todo_gantt_presentation.v1',
    project_id: 'project-1',
    plans: [{
      plan_key: 'main',
      lanes: [
        { lane: 'O1', name: 'Throughline feed', description: 'completed turnを観測する。' },
        { lane: 'O2', name: 'Observer製品完成', description: 'Observerを製品として完成させる。' },
      ],
    }],
  });
  assert.equal((await loadTodoGanttPresentation({ repoRoot: root, readModel: fixture() })).presentation_digest, digest);
});

test('unknown laneとduplicate JSON keyはtyped errorでfail closedする', async (context) => {
  const root = await workspace(context);
  await writePresentation(root, {
    schema: 'lattice.todo_gantt_presentation.v1',
    project_id: 'project-1',
    plans: [{
      plan_key: 'main',
      lanes: [{ lane: 'unknown', name: 'Unknown', description: '存在しないlane。' }],
    }],
  });
  await assert.rejects(
    loadTodoGanttPresentation({ repoRoot: root, readModel: fixture() }),
    (error) => error instanceof TodoStoreError
      && error.code === 'PRESENTATION_INVALID'
      && error.detail.reason === 'presentation_lane_unknown',
  );

  await writeFile(path.join(root, TODO_GANTT_PRESENTATION_REF), [
    '{"schema":"lattice.todo_gantt_presentation.v1",',
    '"project_id":"project-1","project_id":"project-2","plans":[]}',
  ].join(''));
  await assert.rejects(
    loadTodoGanttPresentation({ repoRoot: root, readModel: fixture() }),
    (error) => error instanceof TodoStoreError
      && error.code === 'PRESENTATION_INVALID'
      && error.detail.reason === 'presentation_duplicate_key',
  );
});

test('sidecar symlinkは安全でない入力として拒否する', async (context) => {
  const root = await workspace(context);
  const target = path.join(root, 'presentation-target.json');
  await writeFile(target, '{}');
  await symlink(target, path.join(root, TODO_GANTT_PRESENTATION_REF));
  await assert.rejects(
    loadTodoGanttPresentation({ repoRoot: root, readModel: fixture() }),
    (error) => error instanceof TodoStoreError
      && error.code === 'PRESENTATION_INVALID'
      && error.detail.reason === 'presentation_path_unsafe',
  );
});
