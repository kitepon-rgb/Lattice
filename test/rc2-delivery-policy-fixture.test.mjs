import assert from 'node:assert/strict';
import test from 'node:test';

const FIXTURE_MODULE = '../research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const ORACLE_MODULE = '../src/rc2-delivery-policy-oracle.mjs';

const CASES = [
  {
    id: 'email-routine',
    input: { channel: 'email', urgency: 'routine' },
    expected: { channel: 'email', transport: 'smtp', retry_limit: 3, delay_seconds: 60 },
  },
  {
    id: 'email-urgent',
    input: { channel: 'email', urgency: 'urgent' },
    expected: { channel: 'email', transport: 'smtp', retry_limit: 5, delay_seconds: 0 },
  },
  {
    id: 'sms-routine',
    input: { channel: 'sms', urgency: 'routine' },
    expected: { channel: 'sms', transport: 'sms', retry_limit: 2, delay_seconds: 30 },
  },
  {
    id: 'sms-urgent',
    input: { channel: 'sms', urgency: 'urgent' },
    expected: { channel: 'sms', transport: 'sms', retry_limit: 4, delay_seconds: 0 },
  },
  {
    id: 'push-routine',
    input: { channel: 'push', urgency: 'routine' },
    expected: { channel: 'push', transport: 'push', retry_limit: 1, delay_seconds: 10 },
  },
  {
    id: 'push-urgent',
    input: { channel: 'push', urgency: 'urgent' },
    expected: { channel: 'push', transport: 'push', retry_limit: 3, delay_seconds: 0 },
  },
];

for (const fixtureCase of CASES) {
  test(`delivery policy fixture returns the exact ${fixtureCase.id} behavior`, async () => {
    const { resolveDeliveryPolicy } = await import(FIXTURE_MODULE);
    assert.deepEqual(resolveDeliveryPolicy(fixtureCase.input), fixtureCase.expected);
  });
}

test('delivery policy fixture rejects non-exact input shapes', async () => {
  const { resolveDeliveryPolicy } = await import(FIXTURE_MODULE);

  assert.throws(() => resolveDeliveryPolicy(null), { name: 'TypeError' });
  assert.throws(() => resolveDeliveryPolicy({ channel: 'email' }), { name: 'TypeError' });
  assert.throws(
    () => resolveDeliveryPolicy({ channel: 'email', urgency: 'routine', extra: true }),
    { name: 'TypeError' },
  );
});

test('delivery policy fixture rejects an unknown channel as RangeError', async () => {
  const { resolveDeliveryPolicy } = await import(FIXTURE_MODULE);

  assert.throws(
    () => resolveDeliveryPolicy({ channel: 'webhook', urgency: 'routine' }),
    { name: 'RangeError' },
  );
});

test('delivery policy fixture rejects an unknown urgency as RangeError', async () => {
  const { resolveDeliveryPolicy } = await import(FIXTURE_MODULE);

  assert.throws(
    () => resolveDeliveryPolicy({ channel: 'email', urgency: 'later' }),
    { name: 'RangeError' },
  );
});

test('delivery policy oracle black-boxes the same table from the supplied repoRoot', async () => {
  const { runRc2DeliveryPolicyOracle } = await import(ORACLE_MODULE);
  const receipt = await runRc2DeliveryPolicyOracle({ repoRoot: process.cwd() });

  assert.equal(receipt.outcome, 'passed');
  assert.deepEqual(receipt.case_results.map(({ id, outcome }) => ({ id, outcome })),
    CASES.map(({ id }) => ({ id, outcome: 'passed' })));
  assert.equal(Object.hasOwn(receipt, 'expected_waves'), false);
  assert.equal(Object.hasOwn(receipt, 'conflicts'), false);
  assert.equal(Object.hasOwn(receipt, 'candidate_id'), false);
});
