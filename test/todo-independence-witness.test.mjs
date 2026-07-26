import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TODO_WITNESS_SET_SCHEMA,
  validateTodoWitnessSet,
} from '../src/todo-independence-contracts.mjs';
import {
  TodoIndependenceError,
  migrateWitnessSetTaskIds,
} from '../src/todo-independence.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// ADR 0128 Decision 6。revision後の宣言はtask migrationでid写像するだけとし、
// 宣言内容が改訂後も妥当かは主張しない。解決できないidはfail closedにする。

const witness = (path) => ({
  owns: [{ kind: 'path', target: path }],
  reads: [],
  writes: [path],
  resources: [],
  state_effects: [],
  sensor_provenance: {
    queries: [{ query_id: 'q-target', expect: { kind: 'affected', path } }],
  },
  affected_tests: [],
  unknowns: [],
});

function witnessSet(manualWitness) {
  const value = {
    schema: TODO_WITNESS_SET_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    capacity: { executors: 2 },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-target', operation: 'affected', target: 'src/alpha.mjs' },
      ],
    },
    manual_witness: manualWitness,
    witness_set_digest: '',
  };
  value.witness_set_digest = todoSelfDigest(value, 'witness_set_digest');
  return value;
}

const entry = (from, to) => ({ from_task_id: from, to_task_id: to });

test('task migrationでtask_idを写し、digestを取り直す', () => {
  const before = witnessSet({ 'old-1': witness('src/alpha.mjs'), 'old-2': witness('src/beta.mjs') });
  const migration = migrateWitnessSetTaskIds({
    witnessSet: before,
    taskMigration: [entry('old-1', 'new-1'), entry('old-2', 'new-2')],
    planTaskIds: ['new-1', 'new-2'],
  });

  assert.deepEqual(Object.keys(migration.witnessSet.manual_witness).sort(), ['new-1', 'new-2']);
  assert.equal(migration.migrated_count, 2);
  assert.equal(migration.removed_count, 0);
  assert.equal(migration.unchanged_count, 0);
  assert.equal(validateTodoWitnessSet(migration.witnessSet), true);
  assert.notEqual(migration.witnessSet.witness_set_digest, before.witness_set_digest);
  // 宣言内容そのものは写すだけで書き換えない。
  assert.deepEqual(migration.witnessSet.manual_witness['new-1'], before.manual_witness['old-1']);
});

test('removedの宣言は落とし、同一idはそのまま通す', () => {
  const migration = migrateWitnessSetTaskIds({
    witnessSet: witnessSet({
      keep: witness('src/alpha.mjs'),
      gone: witness('src/beta.mjs'),
    }),
    taskMigration: [entry('keep', 'keep'), entry('gone', 'removed')],
    planTaskIds: ['keep'],
  });

  assert.deepEqual(Object.keys(migration.witnessSet.manual_witness), ['keep']);
  assert.equal(migration.removed_count, 1);
  assert.equal(migration.unchanged_count, 1);
  assert.equal(migration.migrated_count, 0);
});

test('移行済みの宣言へ再実行しても結果が変わらない', () => {
  const before = witnessSet({ 'old-1': witness('src/alpha.mjs') });
  const taskMigration = [entry('old-1', 'new-1')];
  const planTaskIds = ['new-1'];

  const once = migrateWitnessSetTaskIds({ witnessSet: before, taskMigration, planTaskIds });
  const twice = migrateWitnessSetTaskIds({
    witnessSet: once.witnessSet, taskMigration, planTaskIds,
  });

  assert.deepEqual(twice.witnessSet, once.witnessSet);
  assert.equal(twice.unchanged_count, 1);
  assert.equal(twice.migrated_count, 0);
});

test('移行表にも現planにも無いidはfail closedにする', () => {
  assert.throws(() => migrateWitnessSetTaskIds({
    witnessSet: witnessSet({ stranger: witness('src/alpha.mjs') }),
    taskMigration: [entry('old-1', 'new-1')],
    planTaskIds: ['new-1'],
  }), (error) => error instanceof TodoIndependenceError
    && error.code === 'WITNESS_MIGRATION_UNRESOLVED'
    && error.detail.task_ids[0] === 'stranger'
    && error.detail.next_action === 'update_witness_set_manually');
});

test('全宣言が消える移行は空の宣言を書き残さず止める', () => {
  assert.throws(() => migrateWitnessSetTaskIds({
    witnessSet: witnessSet({ gone: witness('src/alpha.mjs') }),
    taskMigration: [entry('gone', 'removed')],
    planTaskIds: [],
  }), (error) => error.code === 'WITNESS_MIGRATION_EMPTY');
});
