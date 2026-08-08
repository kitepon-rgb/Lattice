import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TODO_NOTE_CONTEXT_SCHEMA,
  TODO_NOTE_EVENT_SCHEMA,
  TODO_LIMITS,
  todoSelfDigest,
  validateTodoNoteContext,
  validateTodoNoteEvent,
} from '../src/todo-contracts.mjs';

const DIGEST = (character) => character.repeat(64);
const ACTOR = { host: 'codex', session: 'task-memory', agent: 'bell' };

function noteEvent(overrides = {}) {
  const value = {
    schema: TODO_NOTE_EVENT_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    task_id: 'task-001',
    plan_version: 'v1',
    sequence: 1,
    previous_digest: null,
    actor: ACTOR,
    recorded_at: '2026-08-01T00:00:00.000Z',
    body: '## 方針\n\n境界を先に固定する。',
    supersedes: null,
    event_digest: '',
    ...overrides,
  };
  value.event_digest = todoSelfDigest(value, 'event_digest');
  return value;
}

function noteContext(overrides = {}) {
  const value = {
    schema: TODO_NOTE_CONTEXT_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    task_id: 'task-001',
    notes: [{
      event_digest: DIGEST('a'),
      origin_plan_version: 'v1',
      scope: 'task',
      origin_task_id: 'task-old',
      actor: ACTOR,
      recorded_at: '2026-08-01T00:00:00.000Z',
      body: '移行前に決めた方針。',
      supersedes: null,
      superseded_by: null,
      correction_state: 'current',
    }],
    note_head_digest: DIGEST('b'),
    overflow_count: 0,
    full_history_command: 'lattice todo note list --plan plan-a --json',
    context_digest: '',
    ...overrides,
  };
  value.context_digest = todoSelfDigest(value, 'context_digest');
  return value;
}

test('note eventは独立chain用のexact shapeと自己digestを要求する', () => {
  assert.equal(validateTodoNoteEvent(noteEvent()), true);

  const extra = noteEvent();
  extra.lifecycle_status = 'in-progress';
  assert.equal(validateTodoNoteEvent(extra), false);

  const tampered = noteEvent();
  tampered.body = '改ざん';
  assert.equal(validateTodoNoteEvent(tampered), false);
});

test('note本文は16 KiBまでのMarkdownで、改行以外のC0制御文字を拒否する', () => {
  assert.equal(validateTodoNoteEvent(noteEvent({ body: 'a'.repeat(TODO_LIMITS.noteBodyBytes) })), true);
  assert.equal(validateTodoNoteEvent(noteEvent({ body: 'a'.repeat(TODO_LIMITS.noteBodyBytes + 1) })), false);
  assert.equal(validateTodoNoteEvent(noteEvent({ body: '方針\u0000' })), false);
  assert.equal(validateTodoNoteEvent(noteEvent({ body: '1行目\n2行目\t補足' })), true);
});

test('通常読取へ自動同梱するcontextは来歴・訂正状態・head・overflowを必須にする', () => {
  assert.equal(validateTodoNoteContext(noteContext()), true);

  for (const key of ['notes', 'note_head_digest', 'overflow_count', 'full_history_command']) {
    const missing = noteContext();
    delete missing[key];
    missing.context_digest = todoSelfDigest(missing, 'context_digest');
    assert.equal(validateTodoNoteContext(missing), false, `${key}は必須`);
  }
});

test('訂正済みnoteはsuperseded_byを持ち、context本文は64 KiBを超えない', () => {
  const superseded = noteContext();
  superseded.notes[0].correction_state = 'superseded';
  superseded.notes[0].superseded_by = DIGEST('c');
  superseded.context_digest = todoSelfDigest(superseded, 'context_digest');
  assert.equal(validateTodoNoteContext(superseded), true);

  const inconsistent = structuredClone(superseded);
  inconsistent.notes[0].superseded_by = null;
  inconsistent.context_digest = todoSelfDigest(inconsistent, 'context_digest');
  assert.equal(validateTodoNoteContext(inconsistent), false);

  const tooLarge = noteContext();
  tooLarge.notes[0].body = 'a'.repeat(TODO_LIMITS.noteContextBytes + 1);
  tooLarge.context_digest = todoSelfDigest(tooLarge, 'context_digest');
  assert.equal(validateTodoNoteContext(tooLarge), false);
});

test('noteが無いtaskも明示的な空contextを返し、別コマンド発見を前提にしない', () => {
  const empty = noteContext({ notes: [], note_head_digest: null });
  assert.equal(validateTodoNoteContext(empty), true);
  assert.match(empty.full_history_command, /^lattice todo note list /u);
});
