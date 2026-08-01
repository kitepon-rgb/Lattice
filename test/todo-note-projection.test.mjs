import assert from 'node:assert/strict';
import test from 'node:test';

import { TODO_NOTE_EVENT_SCHEMA, todoSelfDigest } from '../src/todo-contracts.mjs';
import { projectTodoNoteContext } from '../src/todo-note-store.mjs';

const ACTOR = { host: 'codex', session: 'projection', agent: 'bell' };

function events(specs) {
  let previous = null;
  return specs.map((spec, index) => {
    const event = {
      schema: TODO_NOTE_EVENT_SCHEMA,
      project_id: 'lattice',
      plan_key: 'plan-a',
      task_id: spec.task_id,
      plan_version: spec.plan_version,
      sequence: index + 1,
      previous_digest: previous?.event_digest ?? null,
      actor: ACTOR,
      recorded_at: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      body: spec.body ?? `note-${index}`,
      supersedes: spec.supersedes ?? null,
      event_digest: '',
    };
    event.event_digest = todoSelfDigest(event, 'event_digest');
    previous = event;
    return event;
  });
}

const migrations = [
  {
    from_plan_version: 'v1', to_plan_version: 'v2',
    task_migration: [
      { from_task_id: 'old', to_task_id: 'middle' },
      { from_task_id: 'removed', to_task_id: null },
    ],
  },
  {
    from_plan_version: 'v2', to_plan_version: 'v3',
    task_migration: [{ from_task_id: 'middle', to_task_id: 'current' }],
  },
];

test('多段task migrationを合成し、本文と元plan version・元task idを現在taskへ投影する', () => {
  const chain = events([
    { plan_version: 'v1', task_id: 'old', body: '最初の方針' },
    { plan_version: 'v2', task_id: 'middle', body: '中間版の注意' },
    { plan_version: 'v3', task_id: 'current', body: '現在版の判断' },
  ]);
  const result = projectTodoNoteContext({
    projectId: 'lattice', planKey: 'plan-a', currentPlanVersion: 'v3',
    currentTaskId: 'current', currentTaskIds: ['current'], events: chain, migrations,
  });
  assert.deepEqual(result.context.notes.map(({ body }) => body),
    ['現在版の判断', '中間版の注意', '最初の方針']);
  assert.deepEqual(result.context.notes.map(({ origin_plan_version: version }) => version),
    ['v3', 'v2', 'v1']);
  assert.deepEqual(result.context.notes.map(({ origin_task_id: taskId }) => taskId),
    ['current', 'middle', 'old']);
  assert.equal(result.context.overflow_count, 0);
  assert.deepEqual(result.archived, []);
});

test('removed taskのnoteはarchived束へ分離し現在taskの指示として混ぜない', () => {
  const chain = events([
    { plan_version: 'v1', task_id: 'removed', body: '廃止した案' },
    { plan_version: 'v1', task_id: 'old', body: '継続する案' },
  ]);
  const result = projectTodoNoteContext({
    projectId: 'lattice', planKey: 'plan-a', currentPlanVersion: 'v3',
    currentTaskId: 'current', currentTaskIds: ['current'], events: chain, migrations,
  });
  assert.deepEqual(result.context.notes.map(({ body }) => body), ['継続する案']);
  assert.deepEqual(result.archived.map(({ body }) => body), ['廃止した案']);
});

test('supersede関係を履歴のまま保持し、訂正済みnoteを明示する', () => {
  const chain = events([{ plan_version: 'v3', task_id: 'current', body: '旧方針' }]);
  const corrected = events([
    { plan_version: 'v3', task_id: 'current', body: '旧方針' },
    { plan_version: 'v3', task_id: 'current', body: '新方針', supersedes: chain[0].event_digest },
  ]);
  const result = projectTodoNoteContext({
    projectId: 'lattice', planKey: 'plan-a', currentPlanVersion: 'v3',
    currentTaskId: 'current', currentTaskIds: ['current'], events: corrected, migrations: [],
  });
  assert.equal(result.context.notes[0].correction_state, 'current');
  assert.equal(result.context.notes[0].supersedes, corrected[0].event_digest);
  assert.equal(result.context.notes[1].correction_state, 'superseded');
  assert.equal(result.context.notes[1].superseded_by, corrected[1].event_digest);
});

test('通常供給は新しい順に本文64 KiBまでとし、残りをoverflow件数で返す', () => {
  const chain = events(Array.from({ length: 5 }, (_, index) => ({
    plan_version: 'v3', task_id: 'current', body: String(index).padEnd(16_384, 'x'),
  })));
  const result = projectTodoNoteContext({
    projectId: 'lattice', planKey: 'plan-a', currentPlanVersion: 'v3',
    currentTaskId: 'current', currentTaskIds: ['current'], events: chain, migrations: [],
  });
  assert.equal(result.context.notes.length, 4);
  assert.equal(result.context.overflow_count, 1);
  assert.equal(result.context.note_head_digest, chain.at(-1).event_digest);
  assert.equal(result.context.full_history_command,
    'lattice todo note list --plan plan-a --task current --json');
});
