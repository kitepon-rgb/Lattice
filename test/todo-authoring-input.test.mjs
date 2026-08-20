import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  matchFlagCommand,
  parseAuthoringJson,
  readAuthoringJsonFile,
  repairAuthoringArtifact,
} from '../src/todo-authoring-input.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

test('flag parserは順不同を受理し、未知flagと位置引数を拒否する', () => {
  const matched = matchFlagCommand(
    ['done', '--task', 'T1', '--plan', 'main', '--evidence', 'ev.json'],
    ['done'],
    { known: ['plan', 'task', 'evidence'], required: ['plan', 'task', 'evidence'] },
  );
  assert.equal(matched.task, 'T1');
  assert.equal(matched.plan, 'main');
  assert.equal(matched.evidence, 'ev.json');
  assert.equal(matchFlagCommand(
    ['done', '--plan', 'main', '--task', 'T1', 'extra'],
    ['done'],
    { known: ['plan', 'task'], required: ['plan', 'task'] },
  ), null);
  assert.equal(matchFlagCommand(
    ['done', '--plan', 'main', '--task', 'T1', '--unknown', 'x'],
    ['done'],
    { known: ['plan', 'task'], required: ['plan', 'task'] },
  ), null);
});

test('pretty-print JSONとdigest欠落を直し、設計メモは空のままにする', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-authoring-input-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const draft = {
    schema: 'lattice.plan_create_input.v4',
    project_id: 'p1',
    plan_key: 'main',
    plan_version: 'v1',
    actor: { host: 'h', session: 's', agent: 'a' },
    recorded_at: '2026-08-20T00:00:00.000Z',
    tasks: [],
    hard_dependencies: [],
    joins: [],
    phases: [],
    phase_accept_dependencies: [],
    input_digest: '',
  };
  await writeFile(path.join(root, 'draft.json'), `${JSON.stringify(draft, null, 2)}\n`);
  const parsed = await readAuthoringJsonFile(root, 'draft.json');
  assert.equal(parsed.input_digest, todoSelfDigest({ ...draft, input_digest: '' }, 'input_digest'));
  assert.equal(repairAuthoringArtifact({ hello: 'world' }).hello, 'world');
  const memo = { schema: 'lattice.todo_extraction.v4', tasks: [{ design_memo: '' }] };
  assert.equal(repairAuthoringArtifact(memo).tasks[0].design_memo, '');
});

test('BOMとCRLFのJSONはparseし、commentは拒否する', () => {
  const value = parseAuthoringJson('\uFEFF{"a":1}\r\n');
  assert.deepEqual(value, { a: 1 });
  assert.throws(() => parseAuthoringJson('{"a":1,}'), { code: 'INVALID_JSON' });
  assert.throws(() => parseAuthoringJson('{"a":1 /* c */}'), { code: 'INVALID_JSON' });
});
