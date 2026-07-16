import assert from 'node:assert/strict';
import test from 'node:test';

// RC3-B expected-red characterization（ADR 0044 Decision 3）。
// 対象moduleはRC3-Cで実装されるまで存在せず、本fileの全testは
// `ERR_MODULE_NOT_FOUND`だけを理由にfailしなければならない。
// event storeはrun単位のappend-only canonical event列であり、sequence gap、
// 重複、fork、digest不一致、未知kindをtyped rejectしなければならない。
const EVENT_STORE_MODULE = '../src/runtime-event-store.mjs';

const RUN_ID = 'run-rc3b-event-chain';

// ADR 0044 Decision 3.2のclosed kind set。拡張はrun_event.v2＋新ADRでだけ行う。
const CLOSED_EVENT_KINDS = Object.freeze([
  'run_initialized',
  'plan_compiled',
  'plan_verified',
  'dispatch_decided',
  'executor_dispatched',
  'checkpoint_observed',
  'receipt_recorded',
  'conflict_found',
  'intake_frozen',
  'hold_decided',
  'carry_over_witnessed',
  'epoch_rebound',
  'context_invalidated',
  'plan_recompiled',
  'intake_resumed',
  'receipt_accepted',
  'receipt_rejected',
  'executor_terminal',
  'run_closed',
]);

async function chain(specs) {
  const { digestRunEvent } = await import(EVENT_STORE_MODULE);
  const events = [];
  let previousDigest = null;
  for (const [index, spec] of specs.entries()) {
    const event = {
      schema: 'lattice.run_event.v1',
      run_id: RUN_ID,
      sequence: index,
      previous_digest: previousDigest,
      kind: spec.kind,
      actor: spec.actor ?? 'lattice-runtime',
      plan_epoch: spec.plan_epoch ?? 1,
      subject: spec.subject ?? { kind: 'run', ref: RUN_ID },
      payload: spec.payload ?? {},
      recorded_at: '2026-07-17T00:00:00.000Z',
    };
    event.event_digest = digestRunEvent(event);
    events.push(event);
    previousDigest = event.event_digest;
  }
  return events;
}

async function validChain() {
  return chain([
    { kind: 'run_initialized', payload: { request_digest: 'a'.repeat(64) } },
    { kind: 'plan_compiled' },
    { kind: 'plan_verified' },
    { kind: 'dispatch_decided', payload: { dispatched: ['T1'] } },
    { kind: 'executor_dispatched', subject: { kind: 'todo', ref: 'T1' } },
  ]);
}

test('正規のdigest chainを持つevent列はvalidである', async () => {
  const { verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();

  const verification = verifyRunEventChain({ events });
  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
  assert.deepEqual(verification.failed_conditions, []);
});

test('closed setの全event kindがgenesisからの正規chainとして受理される', async () => {
  const { verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  // run_initializedをgenesisに、closed set全kindを一度ずつ並べる。
  // 未知kind拒否（成功条件22）の対偶として、既知kind全受理を固定する。
  const events = await chain(CLOSED_EVENT_KINDS.map((kind) => ({ kind })));

  const verification = verifyRunEventChain({ events });
  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
});

test('sequence gapのあるevent列はtyped rejectされる', async () => {
  const { verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();
  const gapped = [...events.slice(0, 2), ...events.slice(3)];

  const verification = verifyRunEventChain({ events: gapped });
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('sequence_gap'), JSON.stringify(verification.failed_conditions));
});

test('同一eventの重複appendはtyped rejectされる', async () => {
  const { verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();
  const duplicated = [...events, structuredClone(events.at(-1))];

  const verification = verifyRunEventChain({ events: duplicated });
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('duplicate_event'), JSON.stringify(verification.failed_conditions));
});

test('同一sequenceに異なるeventが並ぶforkはtyped rejectされる', async () => {
  const { digestRunEvent, verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();
  const fork = structuredClone(events.at(-1));
  fork.kind = 'executor_terminal';
  delete fork.event_digest;
  fork.event_digest = digestRunEvent(fork);

  const verification = verifyRunEventChain({ events: [...events, fork] });
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('sequence_fork'), JSON.stringify(verification.failed_conditions));
});

test('previous digestが直前eventと一致しないchainはtyped rejectされる', async () => {
  const { digestRunEvent, verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();
  const broken = structuredClone(events);
  broken[2].previous_digest = 'f'.repeat(64);
  delete broken[2].event_digest;
  broken[2].event_digest = digestRunEvent(broken[2]);

  const verification = verifyRunEventChain({ events: broken });
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('digest_chain_mismatch'), JSON.stringify(verification.failed_conditions));
});

test('payload改竄でevent digestが再計算と一致しないeventはtyped rejectされる', async () => {
  const { verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();
  const tampered = structuredClone(events);
  tampered[3].payload = { dispatched: ['T1', 'T9'] };

  const verification = verifyRunEventChain({ events: tampered });
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('event_digest_mismatch'), JSON.stringify(verification.failed_conditions));
});

test('closed set外のevent kindはdigestが正しくてもtyped rejectされる', async () => {
  const { digestRunEvent, verifyRunEventChain } = await import(EVENT_STORE_MODULE);
  const events = await validChain();
  const unknown = structuredClone(events.at(-1));
  unknown.sequence += 1;
  unknown.previous_digest = events.at(-1).event_digest;
  unknown.kind = 'plan_teleported';
  delete unknown.event_digest;
  unknown.event_digest = digestRunEvent(unknown);

  const verification = verifyRunEventChain({ events: [...events, unknown] });
  assert.equal(verification.valid, false);
  assert.ok(verification.failed_conditions.includes('unknown_kind'), JSON.stringify(verification.failed_conditions));
});
