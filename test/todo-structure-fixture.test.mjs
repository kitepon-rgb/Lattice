import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('./fixtures/todo-structure/peertable-logical-dataflow-v0.json', import.meta.url);
const scenariosUrl = new URL('./fixtures/todo-structure/structure-scenarios-v0.json', import.meta.url);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

test('Peertable由来fixtureは未完了16件を秘密なしで固定する', async () => {
  const fixture = await readJson(fixtureUrl);
  assert.deepEqual(Object.keys(fixture), ['schema', 'captured_at', 'source', 'tasks']);
  assert.equal(fixture.schema, 'peertable.logical_dataflow.fixture.v0');
  assert.equal(fixture.tasks.length, 16);

  const refs = fixture.tasks.map(({ plan_key: planKey, task_id: taskId }) => `${planKey}/${taskId}`);
  assert.equal(new Set(refs).size, refs.length);
  assert.deepEqual([...new Set(fixture.tasks.map(({ status }) => status))].sort(), [
    'blocked', 'in-progress', 'pending',
  ]);
  assert.equal(fixture.tasks.filter(({ status }) => status === 'pending').length, 6);
  assert.equal(fixture.tasks.filter(({ status }) => status === 'in-progress').length, 9);
  assert.equal(fixture.tasks.filter(({ status }) => status === 'blocked').length, 1);

  for (const task of fixture.tasks) {
    assert.deepEqual(Object.keys(task), [
      'plan_key', 'task_id', 'status', 'outcome', 'receives', 'organizes', 'emits', 'failures',
      'first_live_e2e', 'non_goals',
    ]);
    for (const field of ['outcome', 'first_live_e2e']) assert.ok(task[field].length > 0);
    for (const field of ['receives', 'organizes', 'emits', 'failures', 'non_goals']) {
      assert.ok(task[field].length > 0, `${task.task_id}.${field}`);
      assert.ok(task[field].every((entry) => typeof entry === 'string' && entry.length > 0));
    }
  }

  const serialized = JSON.stringify(fixture);
  assert.doesNotMatch(serialized, /\/Users\/|PEERTABLE_POST_TOKEN|X-Peertable-Token|\.token\b/u);
});

test('structureシナリオは正例と5種類の負例を別verdictへ固定する', async () => {
  const fixture = await readJson(scenariosUrl);
  assert.deepEqual(Object.keys(fixture), ['schema', 'scenarios']);
  assert.equal(fixture.schema, 'lattice.todo_structure_scenarios.fixture.v0');
  assert.equal(fixture.scenarios.length, 6);
  assert.equal(new Set(fixture.scenarios.map(({ scenario_id: id }) => id)).size, 6);
  assert.deepEqual(
    fixture.scenarios.map(({ expected_verdict: verdict }) => verdict),
    ['consistent', 'inconsistent', 'inconsistent', 'inconsistent', 'unknown', 'inconsistent'],
  );
  assert.deepEqual(
    fixture.scenarios.slice(1).map(({ expected_finding_code: code }) => code),
    [
      'STRUCTURE_DEPENDENCY_MISSING',
      'STRUCTURE_CONTRACT_MISMATCH',
      'STRUCTURE_OUTPUT_ORPHANED',
      'STRUCTURE_CODE_ANCHOR_AMBIGUOUS',
      'STRUCTURE_FINAL_DRIFT',
    ],
  );
});
