import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildDispatchRecord } from '../research/fixtures/dispatch-record/src/dispatch-record.mjs';

async function readJson(relativePath) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

test('dispatch fixture preserves the channel and label matrix', () => {
  const cases = [
    {
      input: { priority: 'urgent', recipient: ' ops ', title: ' Database down ' },
      expected: { channel: 'pager', label: 'ops:Database down' },
    },
    {
      input: { priority: 'routine', recipient: 'team-a', title: 'Weekly digest' },
      expected: { channel: 'queue', label: 'team-a:Weekly digest' },
    },
  ];

  for (const fixture of cases) {
    const actual = buildDispatchRecord(fixture.input);
    assert.deepEqual(actual, fixture.expected);
    assert.equal(Object.isFrozen(actual), true);
  }
});

test('dispatch fixture preserves validation failures', () => {
  const exactKeys = /^dispatch input must be a plain object with exact keys: priority, recipient, title$/;

  assert.throws(() => buildDispatchRecord(null), { name: 'TypeError', message: exactKeys });
  assert.throws(
    () => buildDispatchRecord({ priority: 'routine', recipient: 'ops' }),
    { name: 'TypeError', message: exactKeys },
  );
  assert.throws(
    () => buildDispatchRecord({ priority: 'routine', recipient: 'ops', title: 'x', extra: true }),
    { name: 'TypeError', message: exactKeys },
  );
  assert.throws(
    () => buildDispatchRecord({ priority: 'later', recipient: 'ops', title: 'x' }),
    { name: 'TypeError', message: /^priority must be urgent or routine$/ },
  );
  assert.throws(
    () => buildDispatchRecord({ priority: 'routine', recipient: ' ', title: 'x' }),
    { name: 'TypeError', message: /^recipient must be a non-empty string$/ },
  );
  assert.throws(
    () => buildDispatchRecord({ priority: 'routine', recipient: 'ops', title: '' }),
    { name: 'TypeError', message: /^title must be a non-empty string$/ },
  );
});

test('RC1 inputs keep the causal controls fixed', async () => {
  const [planInput, normal, negative, querySet] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson('research/campaigns/rc1/inputs/query-set.json'),
  ]);

  assert.equal(planInput.schema, 'lattice.plan_input.v1');
  assert.equal(planInput.capacity.writers, 2);
  assert.deepEqual(planInput.todos.map(({ id }) => id), ['channel-policy', 'label-policy']);
  assert.equal(new Set(planInput.todos.map(({ anchor }) => anchor.path)).size, 1);
  assert.equal(new Set(planInput.todos.map(({ anchor }) => anchor.symbol)).size, 1);

  assert.deepEqual(normal.evidence.map(({ state_writes: writes }) => writes), [[], []]);
  assert.deepEqual(
    negative.evidence.map(({ state_writes: writes }) => writes),
    [['dispatch-registry'], ['dispatch-registry']],
  );
  assert.deepEqual(
    normal.evidence.map(({ state_writes: _writes, ...entry }) => entry),
    negative.evidence.map(({ state_writes: _writes, ...entry }) => entry),
  );

  const queryIds = querySet.queries.map(({ id }) => id);
  assert.equal(new Set(queryIds).size, queryIds.length);
  assert.deepEqual(
    querySet.queries.filter(({ operation }) => operation === 'query').map(({ target }) => target),
    ['buildDispatchRecord', 'selectDispatchChannel', 'formatDispatchLabel'],
  );
});
