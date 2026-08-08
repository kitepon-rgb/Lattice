import assert from 'node:assert/strict';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import {
  BOUNDARY_MANIFEST_SCHEMA,
  RUN_REQUEST_SCHEMA,
  RUN_EVENT_KINDS,
  computeContextContentDigest,
  selfDigest,
  validateCarryOverWitness,
  validateEpochRebindPacket,
  validateExecutorPacket,
  validateExecutorReceipt,
  validateHoldDecision,
  validateRunEvent,
  validateRunRequest,
  validateRuntimeBoundaryManifest,
  validateRuntimePlan,
  validateRuntimePlanDiff,
} from '../src/runtime-contracts.mjs';
import {
  REDACTION_FORBIDDEN_PAYLOAD_KEYS,
  digestRunEvent,
  findRedactionViolations,
  verifyRunEventChain,
} from '../src/runtime-event-store.mjs';
import { verifyRuntimePlanBinding } from '../src/runtime-contracts.mjs';

// RC3-C focused test（ADR 0044 Decision 2・3.5・7.1）。
// 10 schemaのexact key／自己digest／fail closed契約と、redaction契約、
// context content digestのepoch非混入を固定する。

const SHA256_A = 'a'.repeat(64);
const SHA1_B = 'b'.repeat(40);

function withSelfDigest(value, digestField) {
  const document = { ...value };
  document[digestField] = selfDigest(document, digestField);
  return document;
}

function manualWitness(todoId) {
  const path = `src/${todoId.toLowerCase()}.mjs`;
  return {
    owns: [{ kind: 'path', target: path }],
    reads: ['src/shared.mjs'],
    writes: [path],
    resources: [],
    state_effects: [],
    sensor_provenance: { queries: [] },
    affected_tests: [`test/${todoId.toLowerCase()}.test.mjs`],
    unknowns: [],
  };
}

const RUN_REQUEST = withSelfDigest({
  schema: 'lattice.run_request.v1',
  request_id: 'rc3c-request-01',
  repo: { base_sha: SHA1_B, root_kind: 'git-worktree' },
  capacity: { executors: 2 },
  todos: [{ todo_id: 'T1' }, { todo_id: 'T2' }],
  manual_witness: { T1: manualWitness('T1'), T2: manualWitness('T2') },
  sensor_query_set: { queries: [] },
  executor_capability: { adapters: ['scripted'] },
  claim_mode: 'exact_minimum',
}, 'request_digest');

const BOUNDARY_MANIFEST = withSelfDigest({
  schema: 'lattice.boundary_manifest.v2',
  todo_id: 'T1',
  owns: [{ kind: 'path', target: 'src/a.mjs' }],
  reads: ['src/shared.mjs'],
  writes: ['src/a.mjs'],
  resources: ['policy-state'],
  state_effects: [{ resource_id: 'policy-state', kind: 'state' }],
  unknowns: [],
  affected_tests: ['test/a.test.mjs'],
  graph_evidence: [],
  witness_provenance: { 'policy-state': 'manual_state_effect' },
}, 'manifest_digest');

const RUNTIME_PLAN = withSelfDigest({
  schema: 'lattice.runtime_plan.v1',
  plan_ref: 'rc3c-plan-v1',
  plan_epoch: 1,
  request_digest: SHA256_A,
  base_sha: SHA1_B,
  nodes: [{ todo_id: 'T1' }, { todo_id: 'T2' }],
  precedence: [{ from_todo_id: 'T1', to_todo_id: 'T2' }],
  conflicts: [{ todo_ids: ['T1', 'T2'], resource_id: 'policy-state' }],
  capacity: { executors: 2 },
  manifest_digests: { T1: SHA256_A, T2: SHA256_A },
  claim: { mode: 'exact_minimum' },
  predecessor_refs: [],
}, 'plan_digest');

const RUN_EVENT = withSelfDigest({
  schema: 'lattice.run_event.v1',
  run_id: 'run-rc3c',
  sequence: 0,
  previous_digest: null,
  kind: 'run_initialized',
  actor: 'lattice-runtime',
  plan_epoch: 0,
  subject: { kind: 'run_request', ref: 'request.json' },
  payload: { request_digest: SHA256_A },
  recorded_at: '2026-07-17T00:00:00.000Z',
}, 'event_digest');

const EXECUTOR_PACKET_CONTENT = {
  todo_id: 'T1',
  task_ref: 'rc3c-task-T1',
  scope: { writes: ['src/a.mjs'] },
  base_sha: SHA1_B,
  verifier_refs: ['node --test test/a.test.mjs'],
  forbidden_operations: ['commit', 'push', 'branch', 'merge', 'rebase', 'reset', 'stash'],
};

const EXECUTOR_PACKET = withSelfDigest({
  schema: 'lattice.executor_packet.v1',
  packet_id: 'rc3c-packet-T1',
  ...EXECUTOR_PACKET_CONTENT,
  plan_ref: 'rc3c-plan-v1',
  plan_epoch: 1,
  context_content_digest: computeContextContentDigest(EXECUTOR_PACKET_CONTENT),
}, 'packet_digest');

const EXECUTOR_RECEIPT = withSelfDigest({
  schema: 'lattice.executor_receipt.v1',
  receipt_id: 'rc3c-receipt-T1-r1',
  executor_handle: 'scripted-exec-1',
  worktree_id: 'wt-t1',
  base_sha: SHA1_B,
  plan_epoch: 1,
  packet_digest: EXECUTOR_PACKET.packet_digest,
  todo_id: 'T1',
  checkpoint_digest: SHA256_A,
  observed_diff: [{ path: 'src/a.mjs', change: 'modified' }],
}, 'receipt_digest');

const HOLD_DECISION = withSelfDigest({
  schema: 'lattice.hold_decision.v1',
  decision_id: 'rc3c-hold-01',
  finding: { kind: 'observed_write_conflict', todo_ids: ['T1', 'T2'], path: 'src/a.mjs' },
  frozen_prefix_digest: SHA256_A,
  affected_closure: ['T1', 'T2'],
  hold_set: ['T1', 'T2'],
  continue_set: ['T3'],
  evidence_digests: [SHA256_A],
}, 'decision_digest');

const CARRY_OVER_WITNESS = withSelfDigest({
  schema: 'lattice.carry_over_witness.v1',
  witness_id: 'rc3c-witness-T3',
  todo_id: 'T3',
  predecessor_epoch: 1,
  successor_epoch: 2,
  invariant_digests: {
    todo_input: SHA256_A,
    boundary_manifest: SHA256_A,
    validator: SHA256_A,
    context_content: SHA256_A,
  },
  non_overlap_evidence: ['hold_decision#seq44'],
  receipt_bindings: [{
    receipt_id: 'T3-r1',
    checkpoint_digest: SHA256_A,
    recorded_sequence: 38,
    within_frozen_prefix: true,
  }],
}, 'witness_digest');

const EPOCH_REBIND_PACKET = withSelfDigest({
  schema: 'lattice.epoch_rebind_packet.v1',
  packet_id: 'rc3c-rebind-T3',
  todo_id: 'T3',
  executor_handle: 'scripted-exec-3',
  worktree_id: 'wt-t3',
  witness_digest: CARRY_OVER_WITNESS.witness_digest,
  context_content_digest: SHA256_A,
  authorized_checkpoint_digest: SHA256_A,
  old_plan_ref: 'rc3c-plan-v1',
  new_plan_ref: 'rc3c-plan-v2',
  new_plan_epoch: 2,
}, 'packet_digest');

const RUNTIME_PLAN_DIFF = withSelfDigest({
  schema: 'lattice.runtime_plan_diff.v1',
  old_plan_ref: 'rc3c-plan-v1',
  new_plan_ref: 'rc3c-plan-v2',
  accepted_checkpoints: [SHA256_A],
  invalidated_contexts: ['T1', 'T2'],
  carried_over: ['T3'],
  redispatched: ['T1', 'T2'],
  node_edge_diff: { added_nodes: [], removed_nodes: [] },
}, 'diff_digest');

const SCHEMA_CASES = [
  ['run_request.v1', validateRunRequest, RUN_REQUEST, 'request_digest'],
  ['boundary_manifest.v2', validateRuntimeBoundaryManifest, BOUNDARY_MANIFEST, 'manifest_digest'],
  ['runtime_plan.v1', validateRuntimePlan, RUNTIME_PLAN, 'plan_digest'],
  ['run_event.v1', validateRunEvent, RUN_EVENT, 'event_digest'],
  ['executor_packet.v1', validateExecutorPacket, EXECUTOR_PACKET, 'packet_digest'],
  ['executor_receipt.v1', validateExecutorReceipt, EXECUTOR_RECEIPT, 'receipt_digest'],
  ['hold_decision.v1', validateHoldDecision, HOLD_DECISION, 'decision_digest'],
  ['carry_over_witness.v1', validateCarryOverWitness, CARRY_OVER_WITNESS, 'witness_digest'],
  ['epoch_rebind_packet.v1', validateEpochRebindPacket, EPOCH_REBIND_PACKET, 'packet_digest'],
  ['runtime_plan_diff.v1', validateRuntimePlanDiff, RUNTIME_PLAN_DIFF, 'diff_digest'],
];

test('10 schemaのnormative exampleを全validatorが受理する', () => {
  for (const [name, validator, example] of SCHEMA_CASES) {
    assert.equal(validator(example), true, name);
  }
});

test('最新requestとboundary manifestは線宣言を受理し、旧版はfieldを拒否する', () => {
  const lines = [{
    line_id: 'room-sse-event', role: 'reads',
    anchors: [{ kind: 'symbol', name: 'consumeRoomEvent', path: 'src/t1.mjs' }],
  }];
  const request = withSelfDigest({
    ...RUN_REQUEST,
    schema: RUN_REQUEST_SCHEMA,
    manual_witness: { T1: { ...manualWitness('T1'), lines }, T2: manualWitness('T2') },
  }, 'request_digest');
  assert.equal(validateRunRequest(request), true);

  const oldRequest = withSelfDigest({
    ...request, schema: 'lattice.run_request.v4',
  }, 'request_digest');
  assert.equal(validateRunRequest(oldRequest), false);

  const manifest = withSelfDigest({
    ...BOUNDARY_MANIFEST, schema: BOUNDARY_MANIFEST_SCHEMA, lines,
  }, 'manifest_digest');
  assert.equal(validateRuntimeBoundaryManifest(manifest), true);
  const oldManifest = withSelfDigest({
    ...manifest, schema: 'lattice.boundary_manifest.v3',
  }, 'manifest_digest');
  assert.equal(validateRuntimeBoundaryManifest(oldManifest), false);
});

test('run_event timestampは実在する暦日のcanonical UTC millisecondsだけを受理する', () => {
  const impossibleDate = withSelfDigest(
    { ...RUN_EVENT, recorded_at: '2026-02-30T00:00:00.000Z' },
    'event_digest',
  );
  const shortFraction = withSelfDigest(
    { ...RUN_EVENT, recorded_at: '2026-07-17T00:00:00.0Z' },
    'event_digest',
  );
  assert.equal(validateRunEvent(impossibleDate), false);
  assert.equal(validateRunEvent(shortFraction), false);
});

test('未知field追加・schema名不一致・digest破壊をfail closedで拒否する', () => {
  for (const [name, validator, example, digestField] of SCHEMA_CASES) {
    const unknownField = { ...example, extra_field: true };
    assert.equal(validator(unknownField), false, `${name}: unknown field`);

    const wrongSchema = withSelfDigest(
      { ...example, schema: `${example.schema}-forged` },
      digestField,
    );
    assert.equal(validator(wrongSchema), false, `${name}: schema mismatch`);

    const corruptedDigest = { ...example, [digestField]: 'f'.repeat(64) };
    assert.equal(validator(corruptedDigest), false, `${name}: digest corruption`);
  }
});

test('必須field欠落をfail closedで拒否する', () => {
  for (const [name, validator, example, digestField] of SCHEMA_CASES) {
    for (const key of Object.keys(example)) {
      const projection = { ...example };
      delete projection[key];
      const candidate = key === digestField
        ? projection
        : withSelfDigest(projection, digestField);
      assert.equal(validator(candidate), false, `${name}: missing ${key}`);
    }
  }
});

test('context content digestはplan帰属fieldの変更で不変、content変更で変化する', () => {
  // ADR 0044 Decision 7.1: rebindは「content不変・epochだけ更新」をdigestで機械検査
  // できなければならない。plan_epoch／plan_ref／packet_idはcontent projectionへ
  // 混入しない。
  const rebound = withSelfDigest({
    ...EXECUTOR_PACKET,
    packet_id: 'rc3c-packet-T1-rebound',
    plan_ref: 'rc3c-plan-v2',
    plan_epoch: 2,
  }, 'packet_digest');
  assert.equal(
    computeContextContentDigest(rebound),
    computeContextContentDigest(EXECUTOR_PACKET),
  );
  assert.equal(validateExecutorPacket(rebound), true);
  assert.notEqual(rebound.packet_digest, EXECUTOR_PACKET.packet_digest);

  const contentChanged = computeContextContentDigest({
    ...EXECUTOR_PACKET_CONTENT,
    scope: { writes: ['src/b.mjs'] },
  });
  assert.notEqual(contentChanged, computeContextContentDigest(EXECUTOR_PACKET));

  const contentForged = withSelfDigest({
    ...EXECUTOR_PACKET,
    scope: { writes: ['src/b.mjs'] },
  }, 'packet_digest');
  assert.equal(validateExecutorPacket(contentForged), false);
});

test('event payloadの禁止keyはredaction違反として検出される', () => {
  assert.deepEqual(findRedactionViolations({ request_digest: SHA256_A }), []);
  assert.deepEqual(
    findRedactionViolations({ token: 'x' }),
    [{ pointer: '/token', key: 'token' }],
  );
  assert.deepEqual(
    findRedactionViolations({ nested: [{ Prompt: 'full text' }] }),
    [{ pointer: '/nested/0/Prompt', key: 'Prompt' }],
  );
  assert.ok(REDACTION_FORBIDDEN_PAYLOAD_KEYS.includes('credential'));
  assert.ok(REDACTION_FORBIDDEN_PAYLOAD_KEYS.includes('cookie'));
});

test('禁止keyを含むpayloadのevent chainはtyped rejectされる', () => {
  const contaminated = {
    schema: 'lattice.run_event.v1',
    run_id: 'run-rc3c',
    sequence: 0,
    previous_digest: null,
    kind: 'run_initialized',
    actor: 'lattice-runtime',
    plan_epoch: 0,
    subject: { kind: 'run_request', ref: 'request.json' },
    payload: { prompt: 'the entire prompt text' },
    recorded_at: '2026-07-17T00:00:00.000Z',
  };
  contaminated.event_digest = digestRunEvent(contaminated);

  const verification = verifyRunEventChain({ events: [contaminated] });
  assert.equal(verification.valid, false);
  assert.ok(
    verification.failed_conditions.includes('payload_redaction'),
    JSON.stringify(verification.failed_conditions),
  );
});

test('closed event kind setはADR 0044 Decision 3.2と完全一致する', () => {
  assert.equal(RUN_EVENT_KINDS.length, 19);
  assert.equal(new Set(RUN_EVENT_KINDS).size, 19);
  assert.equal(Object.isFrozen(RUN_EVENT_KINDS), true);
});

// ここから下は、RC3-C実装の異provider review（codex-sidecar `review`、
// gpt-5.6-sol×high）で採用したfindingを固定する敵対ケース。

test('不正path・witness欠落・未知todo fieldをfail closedで拒否する', () => {
  const absoluteWrite = withSelfDigest(
    { ...BOUNDARY_MANIFEST, writes: ['/absolute.mjs'] },
    'manifest_digest',
  );
  assert.equal(validateRuntimeBoundaryManifest(absoluteWrite), false);

  const traversalRead = withSelfDigest(
    { ...BOUNDARY_MANIFEST, reads: ['../secret'] },
    'manifest_digest',
  );
  assert.equal(validateRuntimeBoundaryManifest(traversalRead), false);

  const emptyAffectedTest = withSelfDigest(
    { ...BOUNDARY_MANIFEST, affected_tests: [''] },
    'manifest_digest',
  );
  assert.equal(validateRuntimeBoundaryManifest(emptyAffectedTest), false);

  const unknownTodoField = withSelfDigest({
    ...RUN_REQUEST,
    todos: [{ todo_id: 'T1', unknown: 'accepted' }, { todo_id: 'T2' }],
  }, 'request_digest');
  assert.equal(validateRunRequest(unknownTodoField), false);

  const missingWitness = withSelfDigest(
    { ...RUN_REQUEST, manual_witness: {} },
    'request_digest',
  );
  assert.equal(validateRunRequest(missingWitness), false);
});

test('runtime planは別request・別baseへの再包装をrejectする', () => {
  // ADR 0044 Decision 2: 同一TODO集合を持つ別base／別requestへのplan再包装を
  // typed rejectする。cross-bindingはschema単体validatorと別の検証で行う。
  const boundPlan = withSelfDigest({
    ...RUNTIME_PLAN,
    request_digest: RUN_REQUEST.request_digest,
  }, 'plan_digest');
  assert.equal(verifyRuntimePlanBinding({ plan: boundPlan, request: RUN_REQUEST }), true);

  const foreignRequest = withSelfDigest(
    { ...RUN_REQUEST, request_id: 'rc3c-request-02' },
    'request_digest',
  );
  assert.equal(verifyRuntimePlanBinding({ plan: boundPlan, request: foreignRequest }), false);

  const rebasedPlan = withSelfDigest(
    { ...boundPlan, base_sha: 'c'.repeat(40) },
    'plan_digest',
  );
  assert.equal(verifyRuntimePlanBinding({ plan: rebasedPlan, request: RUN_REQUEST }), false);
});

test('redactionはalias keyとsecret形式valueも検出する', () => {
  assert.ok(findRedactionViolations({ authToken: 'x' }).length > 0);
  assert.ok(findRedactionViolations({ headers: { Authorization: 'zzz' } }).length > 0);
  assert.ok(findRedactionViolations({ note: 'Bearer abc.def' }).length > 0);
  assert.ok(findRedactionViolations({
    material: '-----BEGIN RSA PRIVATE KEY-----',
  }).length > 0);
  assert.deepEqual(
    findRedactionViolations({ request_digest: SHA256_A, observed_paths: ['src/a.mjs'] }),
    [],
  );
});
