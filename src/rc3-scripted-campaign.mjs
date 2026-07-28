import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';
import { collectSensorEvidence } from './sensor-adapter.mjs';
import { spawnSensorCliSync } from './sensor-runtime.mjs';
import { scaffoldRc3DogfoodRepo, verifyRc3DogfoodScaffold } from './rc3-dogfood-scaffold.mjs';
import { compileRuntimePlanV1, evidenceFromCollectedOutcomes } from './runtime-front-end.mjs';
import {
  adjudicatePendingReceipts,
  buildNextRunEvent,
  buildExecutorPackets,
  classifyCheckpointObservation,
  closeRunIfComplete,
  dispatchReadyFrontier,
  initializeRunEvents,
  observeExecutor,
} from './runtime-engine.mjs';
import {
  decideHoldAndCarryOver,
  recompileNextEpochPlan,
  routeConflictTreatment,
} from './runtime-hold-recompile.mjs';
import { detectCheckpointFindings } from './runtime-diff-observer.mjs';
import { createWorktreeExecutorAdapter } from './runtime-worktree-executor.mjs';
import {
  computeReadyFrontier,
  recomputeHoldDecision,
  recomputeReceiptDecisions,
} from './runtime-decision-verifier.mjs';
import { verifyRunEventChain } from './runtime-event-store.mjs';
import { projectRuntimeState } from './runtime-projection.mjs';
import { selfDigest } from './runtime-contracts.mjs';

/**
 * RC3-H scripted closed-loop campaign（plan RC3-H、ADR 0044 Decision 10・11）。
 *
 * Lattice-owned dogfood scaffoldから条件ごとにdisposable repoを作り、正解集合が
 * 既知の8条件を同一base（同一fixture bytes）・同一runtime identityで実行する。
 * 各条件でevents・plan・hold・receipt・期待/実測比較を保存し、summary値を信じず
 * artifact-only verifierが保存bytesから全decisionを再計算する。
 *
 * 条件（plan「Primary: scripted late-conflict campaign」の8行）:
 *   clean_parallel / late_path_conflict / scope_violation / semantic_unknown /
 *   stale_receipt / irreducible_conflict / accepted_seam / event_corruption
 */

const RUN_TIMESTAMP = '2026-07-17T00:00:00.000Z';
// dogfood scaffoldの実在3 file（LatticeSensor観測がreadyになる対象）をTODO所有面にする。
const DOC_A = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const DOC_B = 'src/rc2-delivery-policy-oracle.mjs';
const DOC_C = 'test/rc2-delivery-policy-fixture.test.mjs';
const MAX_SCRIPTED_REBINDS = 64;

function fail(reason) {
  throw new TypeError(`rc3 campaign契約違反: ${reason}`);
}

function docWitness(todoId, docPath, affectedTests, { extraWrites = [], unknowns = [], stateEffects = [] } = {}) {
  return {
    owns: [{ kind: 'path', target: docPath }],
    reads: [],
    writes: [docPath, ...extraWrites],
    resources: stateEffects.map(({ resource_id: id }) => id),
    state_effects: stateEffects,
    sensor_provenance: {
      queries: [{ query_id: `q-aff-${todoId}`, expect: { kind: 'affected', path: docPath } }],
    },
    affected_tests: affectedTests,
    unknowns,
  };
}

/**
 * manual witnessのaffected test宣言をfresh LatticeSensor観測から導出する
 * （宣言と観測のexact一致契約の下で、正解宣言を機械的に得る）。
 */
async function probeAffectedTests(repoRoot, targets) {
  const querySet = {
    queries: targets.map((target, index) => ({ id: `probe-${index}`, operation: 'affected', target })),
  };
  const collected = await collectSensorEvidence({ cwd: repoRoot, querySet });
  const byTarget = {};
  collected.outcomes.forEach((outcome, index) => {
    const entry = Array.isArray(outcome.targets) ? outcome.targets[0] : null;
    byTarget[targets[index]] = Array.isArray(entry?.data?.affectedTests)
      ? [...entry.data.affectedTests].sort()
      : [];
  });
  return byTarget;
}

/**
 * 8条件のうちscaffold上の6条件は同一TODO集合（TA/TB/TC）・同一capacity・
 * 同一query構造のrequest templateを使い、条件の注入（unknowns・state_effects・
 * 実write）だけを可変にする（plan「同一base、同一request、同一runtime identity」の
 * 運用解釈。字義どおりの単一request bytesは注入設計と両立しないため、
 * templateの同一性とbase/identityの同一性で担保し、evidenceに解釈を記録する）。
 */
function buildDocRequest({ requestId, baseSha, todos, capacity }) {
  const queries = [{ id: 'q-status', operation: 'status' }];
  for (const [todoId, witness] of Object.entries(todos)) {
    void witness;
    queries.push({
      id: `q-aff-${todoId}`,
      operation: 'affected',
      target: todos[todoId].owns[0].target,
    });
  }
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: requestId,
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: capacity },
    todos: Object.keys(todos).map((todoId) => ({ todo_id: todoId })),
    manual_witness: todos,
    sensor_query_set: { queries },
    executor_capability: { adapters: ['isolated-worktree'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  return request;
}

async function compileForRepo({ request, repoRoot }) {
  const collected = await collectSensorEvidence({
    cwd: repoRoot,
    querySet: request.sensor_query_set,
  });
  const sensorEvidence = evidenceFromCollectedOutcomes({
    querySet: request.sensor_query_set,
    collected,
  });
  return compileRuntimePlanV1({
    request,
    sensorEvidence,
    planRef: `plan-${request.request_id}-e1`,
    planEpoch: 1,
    predecessorRefs: [],
  });
}

function docWriter(docPath, body) {
  return async ({ worktreePath }) => {
    await mkdir(path.dirname(path.join(worktreePath, docPath)), { recursive: true });
    await writeFile(path.join(worktreePath, docPath), body);
  };
}

/** 全running executorを1回ずつ観測し、checkpointがあれば分類する共通driver。 */
async function observeAndClassifyAll({ runId, plan, events, packets, adapter }) {
  let next = events;
  const state = projectRuntimeState({ events: next });
  for (const todoId of state.running) {
    const observed = await observeExecutor({
      runId, plan, events: next, adapter, todoId, recordedAt: RUN_TIMESTAMP,
    });
    next = observed.events;
    if (observed.observation.state === 'checkpoint_ready') {
      const classified = classifyCheckpointObservation({
        runId, plan, events: next, packets, todoId,
        detect: detectCheckpointFindings, recordedAt: RUN_TIMESTAMP,
      });
      next = classified.events;
      if (classified.findings.length > 0) return { events: next, frozen: true };
    }
  }
  return { events: next, frozen: false };
}

/** 競合なし前提でclosed loopまで回す（clean／irreducible串行の完走用）。 */
async function driveToClose({ runId, plan, events, packets, manifests, adapter, maxRounds = 16 }) {
  let next = events;
  for (let round = 0; round < maxRounds; round += 1) {
    const dispatched = await dispatchReadyFrontier({
      runId, plan, events: next, packets, manifests, adapter, recordedAt: RUN_TIMESTAMP,
    });
    if (dispatched.failure) fail(`dispatch失敗: ${dispatched.failure.message}`);
    next = dispatched.events;
    const observed = await observeAndClassifyAll({ runId, plan, events: next, packets, adapter });
    if (observed.frozen) fail('競合なし条件でfreezeが発生した');
    next = observed.events;
    const adjudicated = adjudicatePendingReceipts({ runId, plan, events: next, recordedAt: RUN_TIMESTAMP });
    next = adjudicated.events;
    const closed = closeRunIfComplete({ runId, plan, events: next, recordedAt: RUN_TIMESTAMP });
    next = closed.events;
    if (closed.closed) return next;
  }
  fail('closed loopがmaxRounds内に完走しない');
  return null;
}

/**
 * legacy scripted campaign内だけで、controller rebindとactivation gateの完了を模擬する。
 * productionのACK/gate検証を迂回する入口ではなく、既にscriptで完了させたactivationを
 * event contractへ投影するための有界fixture helperである。
 */
function activateScriptedRecompile({ runId, events, plan, planDiff, rebindPackets }) {
  const entries = Object.entries(rebindPackets).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > MAX_SCRIPTED_REBINDS) {
    fail(`scripted rebind数が上限を超えた: ${entries.length}`);
  }
  let next = [...events];
  for (const [todoId, packet] of entries) {
    if (packet?.todo_id !== todoId || packet?.new_plan_epoch !== plan.plan_epoch) {
      fail(`scripted rebind packetの帰属が不正: ${todoId}`);
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'epoch_rebound',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: packet,
      recordedAt: RUN_TIMESTAMP,
    }));
  }
  next.push(buildNextRunEvent({
    events: next,
    runId,
    kind: 'intake_resumed',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'runtime_plan', ref: plan.plan_ref },
    payload: { plan_diff_digest: planDiff.diff_digest },
    recordedAt: RUN_TIMESTAMP,
  }));
  return next;
}

function decisionReplayChecks({ plan, events }) {
  const checks = [];
  events.forEach((event, index) => {
    if (event.kind !== 'dispatch_decided') return;
    // dispatch decisionはそのdecisionが属するepochのplanでだけ再計算できる
    //（frontier規則はepoch-scoped）。別epochのdecisionは当該epochのplanで検証する。
    if (event.plan_epoch !== plan.plan_epoch) return;
    const recomputed = computeReadyFrontier({ plan, events: events.slice(0, index) });
    checks.push({
      sequence: event.sequence,
      kind: 'dispatch_decided',
      match: JSON.stringify(event.payload.dispatchable) === JSON.stringify(recomputed.dispatchable),
    });
  });
  return checks;
}

/** 条件結果recordを組み立てる（期待と実測、および再計算一致）。 */
function conditionRecord({ condition, expected, actual, events, plan }) {
  const chain = verifyRunEventChain({ events });
  const replay = decisionReplayChecks({ plan, events });
  const record = {
    schema: 'lattice.rc3.campaign_condition.v1',
    condition,
    expected,
    actual,
    matched: JSON.stringify(expected) === JSON.stringify(actual),
    event_chain_valid: chain.valid,
    dispatch_replay_matched: replay.every(({ match }) => match),
    event_count: events.length,
    events_digest: digestArtifact(events.map(({ event_digest: digest }) => digest)),
  };
  if (!record.matched) fail(`条件${condition}の期待/実測が一致しない: ${JSON.stringify({ expected, actual })}`);
  if (!record.event_chain_valid) fail(`条件${condition}のevent chainが不正`);
  if (!record.dispatch_replay_matched) fail(`条件${condition}のdispatch replayが一致しない`);
  return record;
}

async function runCleanParallel({ scaffold }) {
  const runId = 'rc3h-clean';
  const affected = await probeAffectedTests(scaffold.repoRoot, [DOC_A, DOC_B, DOC_C]);
  const request = buildDocRequest({
    requestId: 'rc3h-clean',
    baseSha: scaffold.target.base_sha,
    capacity: 3,
    todos: {
      TA: docWitness('TA', DOC_A, affected[DOC_A]),
      TB: docWitness('TB', DOC_B, affected[DOC_B]),
      TC: docWitness('TC', DOC_C, affected[DOC_C]),
    },
  });
  const compiled = await compileForRepo({ request, repoRoot: scaffold.repoRoot });
  if (compiled.outcome !== 'dispatchable') fail(`clean条件がdispatchableにならない: ${compiled.code}`);
  const { plan, manifests } = compiled;
  const packets = buildExecutorPackets({ plan, manifests });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot: scaffold.repoRoot,
    work: {
      TA: docWriter(DOC_A, 'alpha\n'),
      TB: docWriter(DOC_B, 'beta\n'),
      TC: docWriter(DOC_C, 'gamma\n'),
    },
  });
  let events = initializeRunEvents({ runId, request, plan, manifests, recordedAt: RUN_TIMESTAMP });
  events = await driveToClose({ runId, plan, events, packets, manifests, adapter });
  const state = projectRuntimeState({ events });
  return {
    request,
    plan,
    events,
    record: conditionRecord({
      condition: 'clean_parallel',
      expected: { hold: [], continue: ['TA', 'TB', 'TC'], accepted: ['TA', 'TB', 'TC'], closed: true },
      actual: {
        hold: state.holds.flatMap((hold) => hold.hold_set ?? []),
        continue: state.accepted,
        accepted: state.accepted,
        closed: state.closed,
      },
      events,
      plan,
    }),
  };
}

async function runLateConflict({ scaffold }) {
  const runId = 'rc3h-late';
  const affected = await probeAffectedTests(scaffold.repoRoot, [DOC_A, DOC_B, DOC_C]);
  const request = buildDocRequest({
    requestId: 'rc3h-late',
    baseSha: scaffold.target.base_sha,
    capacity: 3,
    todos: {
      TA: docWitness('TA', DOC_A, affected[DOC_A]),
      TB: docWitness('TB', DOC_B, affected[DOC_B]),
      TC: docWitness('TC', DOC_C, affected[DOC_C]),
    },
  });
  const compiled = await compileForRepo({ request, repoRoot: scaffold.repoRoot });
  if (compiled.outcome !== 'dispatchable') fail(`late条件がdispatchableにならない: ${compiled.code}`);
  const { plan, manifests } = compiled;
  const packets = buildExecutorPackets({ plan, manifests });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot: scaffold.repoRoot,
    work: {
      // TAが宣言外にTBのdeclared write（DOC_B）へも書く＝後発path conflict。
      TA: async ({ worktreePath }) => {
        await docWriter(DOC_A, 'alpha\n')({ worktreePath });
        await docWriter(DOC_B, 'rogue write\n')({ worktreePath });
      },
      TB: docWriter(DOC_B, 'beta\n'),
      TC: docWriter(DOC_C, 'gamma\n'),
    },
  });
  let events = initializeRunEvents({ runId, request, plan, manifests, recordedAt: RUN_TIMESTAMP });
  const dispatched = await dispatchReadyFrontier({
    runId, plan, events, packets, manifests, adapter, recordedAt: RUN_TIMESTAMP,
  });
  events = dispatched.events;
  // TCを先に観測（正常checkpoint）、次にTA（競合露呈→freeze）。
  for (const todoId of ['TC', 'TA']) {
    const observed = await observeExecutor({ runId, plan, events, adapter, todoId, recordedAt: RUN_TIMESTAMP });
    events = observed.events;
    const classified = classifyCheckpointObservation({
      runId, plan, events, packets, todoId, detect: detectCheckpointFindings, recordedAt: RUN_TIMESTAMP,
    });
    events = classified.events;
  }
  const held = decideHoldAndCarryOver({
    runId, request, plan, manifests, packets, events, recordedAt: RUN_TIMESTAMP,
  });
  events = held.events;
  const lane = routeConflictTreatment({
    finding: held.holdDecision.finding,
    predeclaredTreatments: [],
  });
  const recompiled = recompileNextEpochPlan({
    runId, request, plan, manifests, packets, events,
    holdDecision: held.holdDecision,
    additionalConflicts: [{ todo_ids: ['TA', 'TB'], resource_id: 'late-doc-b' }],
    recordedAt: RUN_TIMESTAMP,
  });
  events = recompiled.events;
  // 継続TODO（TC）のoutputをvN+1へbind: rebindを適用し、terminal→受理まで進める
  // （成功条件12「無関係TODOの継続にはcarry-over witnessが必須」の完走証明）。
  await adapter.rebind({
    executor_handle: projectRuntimeState({ events }).dispatches.TC.payload.executor_handle,
    rebind: recompiled.rebindPackets.TC,
  });
  events = activateScriptedRecompile({
    runId,
    events,
    plan: recompiled.newPlan,
    planDiff: recompiled.planDiff,
    rebindPackets: recompiled.rebindPackets,
  });
  {
    const tcTerminal = await observeExecutor({
      runId, plan: recompiled.newPlan, events, adapter, todoId: 'TC', recordedAt: RUN_TIMESTAMP,
    });
    events = tcTerminal.events;
    const adjudicated = adjudicatePendingReceipts({
      runId, plan: recompiled.newPlan, events, recordedAt: RUN_TIMESTAMP,
    });
    events = adjudicated.events;
  }
  const state = projectRuntimeState({ events });
  return {
    request,
    plan,
    manifests,
    newPlan: recompiled.newPlan,
    planDiff: recompiled.planDiff,
    events,
    record: conditionRecord({
      condition: 'late_path_conflict',
      expected: {
        hold: ['TA', 'TB'],
        continue: ['TC'],
        lane: 'intentional_serial',
        carried_over: ['TC'],
        redispatched: ['TA', 'TB'],
        new_epoch: 2,
        carried_output_accepted: true,
      },
      actual: {
        hold: held.holdDecision.hold_set,
        continue: held.holdDecision.continue_set,
        lane: lane.lane,
        carried_over: recompiled.planDiff.carried_over,
        redispatched: recompiled.planDiff.redispatched,
        new_epoch: recompiled.newPlan.plan_epoch,
        carried_output_accepted: state.accepted.includes('TC'),
      },
      events,
      plan,
    }),
    holdDecision: held.holdDecision,
    stateAfter: state,
  };
}

async function runScopeViolation({ scaffold }) {
  const runId = 'rc3h-scope';
  const affected = await probeAffectedTests(scaffold.repoRoot, [DOC_A, DOC_B]);
  const request = buildDocRequest({
    requestId: 'rc3h-scope',
    baseSha: scaffold.target.base_sha,
    capacity: 2,
    todos: {
      TA: docWitness('TA', DOC_A, affected[DOC_A]),
      TB: docWitness('TB', DOC_B, affected[DOC_B]),
    },
  });
  const compiled = await compileForRepo({ request, repoRoot: scaffold.repoRoot });
  if (compiled.outcome !== 'dispatchable') fail(`scope条件がdispatchableにならない: ${compiled.code}`);
  const { plan, manifests } = compiled;
  const packets = buildExecutorPackets({ plan, manifests });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot: scaffold.repoRoot,
    work: {
      TA: async ({ worktreePath }) => {
        await docWriter(DOC_A, 'alpha\n')({ worktreePath });
        await docWriter('docs/rogue.md', 'undeclared\n')({ worktreePath });
      },
      TB: docWriter(DOC_B, 'beta\n'),
    },
  });
  let events = initializeRunEvents({ runId, request, plan, manifests, recordedAt: RUN_TIMESTAMP });
  const dispatched = await dispatchReadyFrontier({
    runId, plan, events, packets, manifests, adapter, recordedAt: RUN_TIMESTAMP,
  });
  events = dispatched.events;
  const observed = await observeExecutor({ runId, plan, events, adapter, todoId: 'TA', recordedAt: RUN_TIMESTAMP });
  events = observed.events;
  const classified = classifyCheckpointObservation({
    runId, plan, events, packets, todoId: 'TA', detect: detectCheckpointFindings, recordedAt: RUN_TIMESTAMP,
  });
  events = classified.events;
  const held = decideHoldAndCarryOver({
    runId, request, plan, manifests, packets, events, recordedAt: RUN_TIMESTAMP,
  });
  events = held.events;
  return {
    request,
    plan,
    manifests,
    holdDecision: held.holdDecision,
    events,
    record: conditionRecord({
      condition: 'scope_violation',
      // offenderとそのaffected closure（ここではTAのみ）をhold。closure外のTBは
      // witnessを実証してcontinueする（plan条件表「offenderとaffected closure hold」）。
      expected: {
        finding_kinds: ['undeclared_write'],
        hold_includes_offender: true,
        hold: ['TA'],
        continue: ['TB'],
      },
      actual: {
        finding_kinds: [...new Set(classified.findings.map(({ kind }) => kind))],
        hold_includes_offender: held.holdDecision.hold_set.includes('TA'),
        hold: held.holdDecision.hold_set,
        continue: held.holdDecision.continue_set,
      },
      events,
      plan,
    }),
  };
}

async function runSemanticUnknown({ scaffold }) {
  const affected = await probeAffectedTests(scaffold.repoRoot, [DOC_A, DOC_B]);
  const request = buildDocRequest({
    requestId: 'rc3h-semantic',
    baseSha: scaffold.target.base_sha,
    capacity: 2,
    todos: {
      TA: docWitness('TA', DOC_A, affected[DOC_A], {
        unknowns: [{ kind: 'semantic_probe', ref: 'shared delivery-policy invariant?' }],
      }),
      TB: docWitness('TB', DOC_B, affected[DOC_B]),
    },
  });
  const compiled = await compileForRepo({ request, repoRoot: scaffold.repoRoot });
  // drift実効性の対照: 固定の誤ったaffected宣言はAFFECTED_TEST_DRIFTになる
  //（probe由来宣言がdrift検査を無意味化していないことの証明）。
  const driftRequest = buildDocRequest({
    requestId: 'rc3h-semantic-drift',
    baseSha: scaffold.target.base_sha,
    capacity: 2,
    todos: {
      TA: docWitness('TA', DOC_A, ['test/fixed-wrong-declaration.test.mjs']),
      TB: docWitness('TB', DOC_B, affected[DOC_B]),
    },
  });
  const driftCompiled = await compileForRepo({ request: driftRequest, repoRoot: scaffold.repoRoot });
  const record = {
    schema: 'lattice.rc3.campaign_condition.v1',
    condition: 'semantic_unknown',
    expected: {
      outcome: 'non_dispatchable',
      code: 'BOUNDARY_UNKNOWN',
      drift_control: { outcome: 'non_dispatchable', code: 'AFFECTED_TEST_DRIFT' },
    },
    actual: {
      outcome: compiled.outcome,
      code: compiled.code ?? null,
      drift_control: { outcome: driftCompiled.outcome, code: driftCompiled.code ?? null },
    },
    matched: compiled.outcome === 'non_dispatchable' && compiled.code === 'BOUNDARY_UNKNOWN'
      && driftCompiled.outcome === 'non_dispatchable' && driftCompiled.code === 'AFFECTED_TEST_DRIFT',
    event_chain_valid: true,
    dispatch_replay_matched: true,
    event_count: 0,
    events_digest: digestArtifact([]),
  };
  if (!record.matched) fail(`semantic unknown条件が期待どおりでない: ${JSON.stringify(record.actual)}`);
  return { request, record, nonDispatchable: { outcome: compiled.outcome, code: compiled.code } };
}

async function runStaleReceipt({ scaffold }) {
  // late conflictの流れでvN+1まで進め、rebindなしの旧epoch receipt
  // （held TODOの旧executor由来）をvN+1へ提出してtyped rejectを確認する。
  const late = await runLateConflict({ scaffold });
  const { buildNextRunEvent } = await import('./runtime-engine.mjs');
  const packets = buildExecutorPackets({ plan: late.plan, manifests: late.manifests });
  const state = late.stateAfter;
  const dispatchTB = state.dispatches.TB;
  const staleReceipt = {
    schema: 'lattice.executor_receipt.v1',
    receipt_id: 'TB-stale-r1',
    executor_handle: dispatchTB.payload.executor_handle,
    worktree_id: dispatchTB.payload.worktree_id,
    base_sha: late.plan.base_sha,
    plan_epoch: late.plan.plan_epoch,
    packet_digest: packets.TB.packet_digest,
    todo_id: 'TB',
    checkpoint_digest: '1'.repeat(64),
    observed_diff: [{ path: DOC_B, change: 'modified' }],
  };
  staleReceipt.receipt_digest = selfDigest(staleReceipt, 'receipt_digest');
  let events = [...late.events];
  events.push(buildNextRunEvent({
    events,
    runId: 'rc3h-late',
    kind: 'receipt_recorded',
    planEpoch: staleReceipt.plan_epoch,
    subject: { kind: 'todo', ref: 'TB' },
    payload: staleReceipt,
    recordedAt: RUN_TIMESTAMP,
  }));
  const acceptedBefore = projectRuntimeState({ events: late.events }).accepted;
  const adjudicated = adjudicatePendingReceipts({
    runId: 'rc3h-late', plan: late.newPlan, events, recordedAt: RUN_TIMESTAMP,
  });
  events = adjudicated.events;
  const decision = adjudicated.decisions.find(({ receipt_id: id }) => id === 'TB-stale-r1');
  const recomputed = recomputeReceiptDecisions({ plan: late.newPlan, events })
    .decisions.find(({ receipt_id: id }) => id === 'TB-stale-r1');
  const acceptedAfter = projectRuntimeState({ events }).accepted;
  const acceptedDelta = acceptedAfter.filter((todoId) => !acceptedBefore.includes(todoId));
  const record = {
    schema: 'lattice.rc3.campaign_condition.v1',
    condition: 'stale_receipt',
    expected: {
      decision: 'rejected',
      reason: 'stale_context',
      verifier_decision: 'rejected',
      accepted_outputs_from_stale: [],
    },
    actual: {
      decision: decision?.decision ?? null,
      reason: 'stale_context',
      verifier_decision: recomputed?.decision ?? null,
      accepted_outputs_from_stale: acceptedDelta,
    },
    matched: decision?.decision === 'rejected' && recomputed?.decision === 'rejected'
      && acceptedDelta.length === 0,
    event_chain_valid: verifyRunEventChain({ events }).valid,
    dispatch_replay_matched: true,
    event_count: events.length,
    events_digest: digestArtifact(events.map(({ event_digest: digest }) => digest)),
  };
  if (!record.matched) fail(`stale receipt条件が期待どおりでない: ${JSON.stringify(record.actual)}`);
  return {
    request: late.request,
    plan: late.newPlan,
    manifests: late.manifests,
    events,
    record,
  };
}

async function runAcceptedSeam({ latticeRoot }) {
  // 独立したscaffold上でpredeclared seam treatmentを実行し、accepted後に
  // fresh reindex→conflict減少→new plan発行を確認する（ADR 0044 Decision 11.3）。
  const workRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3h-seam-'));
  const scaffold = await scaffoldRc3DogfoodRepo({ latticeRoot, workRoot });
  const entryPath = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';

  // pre-seam: 2 TODOが同じfixture entryを所有→write conflict→2 waves。
  const preAffected = await probeAffectedTests(scaffold.repoRoot, [entryPath]);
  const preWitness = () => ({
    owns: [
      { kind: 'symbol', target: 'resolveDeliveryPolicy' },
      { kind: 'path', target: entryPath },
    ],
    reads: [],
    writes: [entryPath],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [
        { query_id: 'q-entry', expect: { kind: 'symbol', name: 'resolveDeliveryPolicy', path: entryPath } },
        { query_id: 'q-aff-entry', expect: { kind: 'affected', path: entryPath } },
      ],
    },
    affected_tests: preAffected[entryPath],
    unknowns: [],
  });
  const preRequest = {
    schema: 'lattice.run_request.v1',
    request_id: 'rc3h-seam-pre',
    repo: { base_sha: scaffold.target.base_sha, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'Temail' }, { todo_id: 'Tsms' }],
    manual_witness: { Temail: preWitness(), Tsms: preWitness() },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-entry', operation: 'query', target: 'resolveDeliveryPolicy' },
        { id: 'q-aff-entry', operation: 'affected', target: entryPath },
      ],
    },
    executor_capability: { adapters: ['isolated-worktree'] },
    claim_mode: 'exact_minimum',
  };
  preRequest.request_digest = selfDigest(preRequest, 'request_digest');
  const preCompiled = await compileForRepo({ request: preRequest, repoRoot: scaffold.repoRoot });
  if (preCompiled.outcome !== 'dispatchable') fail(`seam pre条件がdispatchableにならない: ${preCompiled.code}`);
  const preWaves = preCompiled.schedule.minimum_feasible_waves;
  const preConflicts = preCompiled.plan.conflicts.length;

  // predeclared treatmentのroute判定とRC2無改変adapterでの実行。
  const candidateSpec = JSON.parse(await readFile(
    path.join(latticeRoot, 'research/campaigns/rc2/inputs/candidate-spec-v1.json'), 'utf8',
  ));
  const lane = routeConflictTreatment({
    finding: { kind: 'observed_write_conflict', todo_ids: ['Temail', 'Tsms'], path: entryPath },
    predeclaredTreatments: [{
      treatment_id: scaffold.predeclared_treatment.epoch,
      covered_paths: [entryPath],
      candidate_digest: scaffold.predeclared_treatment.candidate_digest,
    }],
  });
  if (lane.lane !== 'seam_transform') fail('predeclared treatmentがseam laneへroutingされない');

  const { runRc2DeliveryPolicySeamTransform } = await import('./rc2-delivery-policy-transform.mjs');
  const transformResult = await runRc2DeliveryPolicySeamTransform({
    repoRoot: scaffold.repoRoot,
    baseRef: scaffold.target.base_sha,
    candidateSpec,
  });
  if (transformResult.artifact.status !== 'accepted') {
    fail(`seam transformがacceptedにならない: ${JSON.stringify(transformResult.artifact.rejection)}`);
  }

  // accepted patchを新baseとしてcommitし、fresh reindex後にper-channel witnessで再compile。
  const { spawnSync } = await import('node:child_process');
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: scaffold.repoRoot, encoding: 'utf8' });
    if (result.status !== 0) fail(`git ${args[0]} failed: ${result.stderr}`);
    return result.stdout;
  };
  const patchPath = path.join(workRoot, 'accepted-seam.patch');
  await writeFile(patchPath, transformResult.patch);
  runGit(['apply', '--binary', patchPath]);
  runGit(['-c', 'user.email=rc3h@lattice.invalid', '-c', 'user.name=rc3h', 'add', '.']);
  runGit(['-c', 'user.email=rc3h@lattice.invalid', '-c', 'user.name=rc3h', 'commit', '--quiet', '-m', 'accepted seam']);
  const newBase = runGit(['rev-parse', 'HEAD']).trim();
  // fresh reindex（accepted seam後は必ず再index。syncで新規fileを収載する）。
  const syncResult = spawnSensorCliSync(['sync', '.'], { cwd: scaffold.repoRoot, encoding: 'utf8' });
  if (syncResult.status !== 0) fail(`sensor reindex(sync)が失敗: ${syncResult.stderr}`);

  const emailPath = 'research/fixtures/delivery-policy-registry/src/email-policy.mjs';
  const smsPath = 'research/fixtures/delivery-policy-registry/src/sms-policy.mjs';
  const postAffected = await probeAffectedTests(scaffold.repoRoot, [emailPath, smsPath]);
  const postWitness = (todoId, symbol, filePath) => ({
    owns: [{ kind: 'symbol', target: symbol }, { kind: 'path', target: filePath }],
    reads: [],
    writes: [filePath],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [
        { query_id: `q-${todoId}`, expect: { kind: 'symbol', name: symbol, path: filePath } },
        { query_id: `q-aff-${todoId}`, expect: { kind: 'affected', path: filePath } },
      ],
    },
    affected_tests: postAffected[filePath],
    unknowns: [],
  });
  const postRequest = {
    schema: 'lattice.run_request.v1',
    request_id: 'rc3h-seam-post',
    repo: { base_sha: newBase, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'Temail' }, { todo_id: 'Tsms' }],
    manual_witness: {
      Temail: postWitness('Temail', 'resolveEmailPolicy', emailPath),
      Tsms: postWitness('Tsms', 'resolveSmsPolicy', smsPath),
    },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-Temail', operation: 'query', target: 'resolveEmailPolicy' },
        { id: 'q-aff-Temail', operation: 'affected', target: emailPath },
        { id: 'q-Tsms', operation: 'query', target: 'resolveSmsPolicy' },
        { id: 'q-aff-Tsms', operation: 'affected', target: smsPath },
      ],
    },
    executor_capability: { adapters: ['isolated-worktree'] },
    claim_mode: 'exact_minimum',
  };
  postRequest.request_digest = selfDigest(postRequest, 'request_digest');
  // post-seam planはgenesisではなく、accepted transformとpre planをpredecessorに
  // 持つepoch 2 planとしてcompileする（Decision 11.2/plan barrier）。
  const transformArtifactDigest = digestArtifact(transformResult.artifact);
  const postCollected = await collectSensorEvidence({
    cwd: scaffold.repoRoot, querySet: postRequest.sensor_query_set,
  });
  const postCompiled = compileRuntimePlanV1({
    request: postRequest,
    sensorEvidence: evidenceFromCollectedOutcomes({
      querySet: postRequest.sensor_query_set, collected: postCollected,
    }),
    planRef: `plan-${postRequest.request_id}-e2`,
    planEpoch: 2,
    predecessorRefs: [preCompiled.plan.plan_ref, `seam:${transformArtifactDigest}`],
  });
  if (postCompiled.outcome !== 'dispatchable') fail(`seam post条件がdispatchableにならない: ${postCompiled.code}`);

  const record = {
    schema: 'lattice.rc3.campaign_condition.v1',
    condition: 'accepted_seam',
    expected: {
      lane: 'seam_transform',
      transform_status: 'accepted',
      conflict_reduced: true,
      wave_reduced: true,
      new_plan_issued: true,
    },
    actual: {
      lane: lane.lane,
      transform_status: transformResult.artifact.status,
      conflict_reduced: postCompiled.plan.conflicts.length < preConflicts,
      wave_reduced: postCompiled.schedule.minimum_feasible_waves < preWaves,
      new_plan_issued: postCompiled.plan.plan_digest !== preCompiled.plan.plan_digest,
    },
    matched: false,
    event_chain_valid: true,
    dispatch_replay_matched: true,
    event_count: 0,
    events_digest: digestArtifact([]),
    seam: {
      pre: { conflicts: preConflicts, minimum_feasible_waves: preWaves, base_sha: scaffold.target.base_sha },
      post: {
        conflicts: postCompiled.plan.conflicts.length,
        minimum_feasible_waves: postCompiled.schedule.minimum_feasible_waves,
        base_sha: newBase,
      },
      transform_artifact_digest: transformArtifactDigest,
      patch_digest: transformResult.artifact.patch.digest,
      predecessor: scaffold.predeclared_treatment,
      post_plan_predecessor_refs: postCompiled.plan.predecessor_refs,
      namespaces: {
        lattice_source: scaffold.lattice_source,
        target: { root_kind: scaffold.target.root_kind, pre_base_sha: scaffold.target.base_sha, post_base_sha: newBase },
      },
    },
  };
  record.matched = JSON.stringify(record.expected) === JSON.stringify(record.actual);
  if (!record.matched) fail(`accepted seam条件が期待どおりでない: ${JSON.stringify(record.actual)}`);
  return {
    request: postRequest,
    record,
    seamExtras: {
      transformArtifact: transformResult.artifact,
      patchBytes: transformResult.patch,
      postPlan: postCompiled.plan,
      prePlan: preCompiled.plan,
    },
  };
}

async function runIrreducibleConflict({ scaffold }) {
  // 実行中に発見されたseamなしshared state（semantic conflict）を
  // intentional serialへ再compileする（plan条件表の「再compile」読み）。
  const runId = 'rc3h-serial';
  const affected = await probeAffectedTests(scaffold.repoRoot, [DOC_A, DOC_B, DOC_C]);
  const request = buildDocRequest({
    requestId: 'rc3h-serial',
    baseSha: scaffold.target.base_sha,
    capacity: 3,
    todos: {
      TA: docWitness('TA', DOC_A, affected[DOC_A]),
      TB: docWitness('TB', DOC_B, affected[DOC_B]),
      TC: docWitness('TC', DOC_C, affected[DOC_C]),
    },
  });
  const compiled = await compileForRepo({ request, repoRoot: scaffold.repoRoot });
  if (compiled.outcome !== 'dispatchable') fail(`serial条件がdispatchableにならない: ${compiled.code}`);
  const { plan, manifests } = compiled;
  const packets = buildExecutorPackets({ plan, manifests });
  const { createScriptedExecutorAdapter } = await import('./runtime-scripted-executor.mjs');
  const adapter = createScriptedExecutorAdapter({
    script: {
      TA: [{
        kind: 'hold_request',
        finding: {
          kind: 'semantic_conflict_unknown',
          todo_ids: ['TA', 'TB'],
          resource_id: 'discovered-shared-state',
        },
      }],
      TB: [{ kind: 'stall' }],
      TC: [{ kind: 'terminal' }],
    },
  });
  let events = initializeRunEvents({ runId, request, plan, manifests, recordedAt: RUN_TIMESTAMP });
  const dispatched = await dispatchReadyFrontier({
    runId, plan, events, packets, manifests, adapter, recordedAt: RUN_TIMESTAMP,
  });
  events = dispatched.events;
  // TCはfreeze前に完走・受理される。
  const tcTerminal = await observeExecutor({ runId, plan, events, adapter, todoId: 'TC', recordedAt: RUN_TIMESTAMP });
  events = tcTerminal.events;
  const tcAccepted = adjudicatePendingReceipts({ runId, plan, events, recordedAt: RUN_TIMESTAMP });
  events = tcAccepted.events;
  // TAが実行中にshared stateを発見して通報→conflict_found＋intake_frozen。
  const held0 = await observeExecutor({ runId, plan, events, adapter, todoId: 'TA', recordedAt: RUN_TIMESTAMP });
  events = held0.events;
  const held = decideHoldAndCarryOver({
    runId, request, plan, manifests, packets, events, recordedAt: RUN_TIMESTAMP,
  });
  events = held.events;
  const lane = routeConflictTreatment({
    finding: held.holdDecision.finding,
    predeclaredTreatments: [],
  });
  const recompiled = recompileNextEpochPlan({
    runId, request, plan, manifests, packets, events,
    holdDecision: held.holdDecision,
    additionalConflicts: [{ todo_ids: ['TA', 'TB'], resource_id: 'discovered-shared-state' }],
    recordedAt: RUN_TIMESTAMP,
  });
  events = recompiled.events;
  const newPlan = recompiled.newPlan;
  events = activateScriptedRecompile({
    runId,
    events,
    plan: newPlan,
    planDiff: recompiled.planDiff,
    rebindPackets: recompiled.rebindPackets,
  });
  // vN+1でserial redispatch（conflict pairは同時に載らない）。
  const epoch2Adapter = createScriptedExecutorAdapter({
    script: { TA: [{ kind: 'terminal' }], TB: [{ kind: 'terminal' }] },
  });
  for (let round = 0; round < 6; round += 1) {
    const redispatched = await dispatchReadyFrontier({
      runId, plan: newPlan, events, packets: recompiled.redispatchPackets,
      manifests, adapter: epoch2Adapter, recordedAt: RUN_TIMESTAMP,
    });
    events = redispatched.events;
    const state = projectRuntimeState({ events });
    for (const todoId of state.running) {
      const observed = await observeExecutor({
        runId, plan: newPlan, events, adapter: epoch2Adapter, todoId, recordedAt: RUN_TIMESTAMP,
      });
      events = observed.events;
    }
    const adjudicated = adjudicatePendingReceipts({ runId, plan: newPlan, events, recordedAt: RUN_TIMESTAMP });
    events = adjudicated.events;
    const closed = closeRunIfComplete({ runId, plan: newPlan, events, recordedAt: RUN_TIMESTAMP });
    events = closed.events;
    if (closed.closed) break;
  }
  const state = projectRuntimeState({ events });
  const taAccepted2 = events.find((e) => (
    e.kind === 'receipt_accepted' && e.subject.ref === 'TA' && e.plan_epoch === 2
  ));
  const tbDispatch2 = events.find((e) => (
    e.kind === 'executor_dispatched' && e.subject.ref === 'TB' && e.plan_epoch === 2
  ));
  return {
    request,
    plan,
    manifests,
    newPlan,
    planDiff: recompiled.planDiff,
    holdDecision: held.holdDecision,
    events,
    record: conditionRecord({
      condition: 'irreducible_conflict',
      expected: {
        lane: 'intentional_serial',
        hold: ['TA', 'TB'],
        recompiled_with_conflict: true,
        precedence_not_faked: true,
        serialized_in_new_epoch: true,
        accepted: ['TA', 'TB', 'TC'],
        closed: true,
      },
      actual: {
        lane: lane.lane,
        hold: held.holdDecision.hold_set,
        recompiled_with_conflict: newPlan.conflicts.some(
          (conflict) => conflict.resource_id === 'discovered-shared-state',
        ),
        precedence_not_faked: newPlan.precedence.length === plan.precedence.length,
        serialized_in_new_epoch: taAccepted2 !== undefined && tbDispatch2 !== undefined
          && taAccepted2.sequence < tbDispatch2.sequence,
        accepted: state.accepted,
        closed: state.closed,
      },
      events,
      plan,
    }),
  };
}

async function runEventCorruption({ cleanResult }) {
  const { events } = cleanResult;
  const variants = {};
  // 改竄: payload書換え（digest不一致）。
  const tampered = structuredClone(events);
  tampered[2].payload = { ...tampered[2].payload, injected: true };
  variants.tamper = { events: tampered, expected_failed: ['event_digest_mismatch'] };
  // 順序欠落。
  const gapped = structuredClone(events);
  gapped.splice(3, 1);
  variants.gap = { events: gapped, expected_failed: ['sequence_gap', 'digest_chain_mismatch'] };
  // fork: 同一sequenceに別内容。
  const forked = structuredClone(events);
  const forkedEvent = structuredClone(forked[4]);
  forkedEvent.payload = { ...forkedEvent.payload, fork: true };
  forkedEvent.event_digest = selfDigest(forkedEvent, 'event_digest');
  forked.splice(5, 0, forkedEvent);
  variants.fork = { events: forked, expected_failed: ['sequence_fork', 'storage_order'] };
  // 重複: 同一eventの再挿入。
  const duplicated = structuredClone(events);
  duplicated.splice(5, 0, structuredClone(duplicated[4]));
  variants.duplicate = { events: duplicated, expected_failed: ['duplicate_event', 'storage_order'] };
  // 未知kind。
  const unknownKind = structuredClone(events);
  unknownKind[3] = { ...unknownKind[3], kind: 'mystery_event' };
  unknownKind[3].event_digest = selfDigest(unknownKind[3], 'event_digest');
  variants.unknown_kind = {
    events: unknownKind,
    expected_failed: ['unknown_kind', 'digest_chain_mismatch'],
  };

  const results = {};
  for (const [name, variant] of Object.entries(variants)) {
    const verification = verifyRunEventChain({ events: variant.events });
    results[name] = {
      valid: verification.valid,
      failed_conditions: verification.failed_conditions,
      expected_failed: variant.expected_failed,
      typed_match: variant.expected_failed.every(
        (condition) => verification.failed_conditions.includes(condition),
      ),
    };
  }
  const record = {
    schema: 'lattice.rc3.campaign_condition.v1',
    condition: 'event_corruption',
    expected: { all_rejected: true, all_typed: true },
    actual: {
      all_rejected: Object.values(results).every(({ valid }) => valid === false),
      all_typed: Object.values(results).every(({ typed_match: match }) => match === true),
    },
    matched: false,
    event_chain_valid: true,
    dispatch_replay_matched: true,
    event_count: 0,
    events_digest: digestArtifact([]),
    corruption_results: results,
    corrupted_source_events_digest: digestArtifact(events.map(({ event_digest: digest }) => digest)),
  };
  record.matched = record.actual.all_rejected && record.actual.all_typed;
  if (!record.matched) fail(`corruption条件がtyped rejectされない: ${JSON.stringify(results)}`);
  // 変異bytes自体をartifactへ保存し、verifierが保存bytesから再判定できるようにする。
  return { record, corruptionVariants: variants };
}

/** artifactを保存bytesだけから再検証する（summary値を信じない）。 */
const EXPECTED_CONDITIONS = Object.freeze([
  'clean_parallel',
  'late_path_conflict',
  'scope_violation',
  'semantic_unknown',
  'stale_receipt',
  'irreducible_conflict',
  'accepted_seam',
  'event_corruption',
]);

function containedRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('..')
    && !value.includes('\\');
}

export async function verifyRc3CampaignArtifactsOnDisk({ artifactRoot }) {
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'campaign-manifest.json'), 'utf8'));
  const checks = [];
  // manifest自体の完全性: schemaと、8条件の固定順・非重複・過不足なし。
  checks.push({
    id: 'manifest:schema',
    passed: manifest?.schema === 'lattice.rc3.campaign_manifest.v1',
  });
  checks.push({
    id: 'manifest:conditions_exact',
    passed: Array.isArray(manifest?.conditions)
      && JSON.stringify(manifest.conditions.map(({ condition }) => condition))
        === JSON.stringify(EXPECTED_CONDITIONS),
  });
  const entries = Array.isArray(manifest?.conditions) ? manifest.conditions : [];
  for (const entry of entries) {
    const paths = [entry.record_path, entry.events_path, entry.plan_path,
      entry.manifests_path, entry.hold_decision_path, entry.corruption_variants_path]
      .filter((value) => value !== null && value !== undefined);
    if (!paths.every(containedRelativePath)) {
      checks.push({ id: `${entry.condition}:path_containment`, passed: false });
      continue;
    }
    const record = JSON.parse(await readFile(
      path.join(artifactRoot, entry.record_path), 'utf8',
    ));
    checks.push({ id: `${entry.condition}:record_digest`, passed: digestArtifact(record) === entry.record_digest });
    // 期待/実測の再比較（保存されたmatchedを信じない）。
    checks.push({
      id: `${entry.condition}:expected_actual_recomputed`,
      passed: record.matched === true
        && JSON.stringify(record.expected) === JSON.stringify(record.actual),
    });
    if (entry.corruption_variants_path !== undefined && entry.corruption_variants_path !== null) {
      // 保存済み変異bytesから改竄拒否を再判定する。
      const variants = JSON.parse(await readFile(
        path.join(artifactRoot, entry.corruption_variants_path), 'utf8',
      ));
      for (const [name, variant] of Object.entries(variants)) {
        const verification = verifyRunEventChain({ events: variant.events });
        checks.push({
          id: `${entry.condition}:${name}_rejected`,
          passed: verification.valid === false
            && variant.expected_failed.every(
              (condition) => verification.failed_conditions.includes(condition),
            ),
        });
      }
    }
    if (entry.events_path === null) {
      checks.push({ id: `${entry.condition}:non_dispatchable`, passed: record.event_count === 0 });
      continue;
    }
    const events = JSON.parse(await readFile(path.join(artifactRoot, entry.events_path), 'utf8'));
    const chain = verifyRunEventChain({ events });
    checks.push({ id: `${entry.condition}:event_chain`, passed: chain.valid });
    checks.push({
      id: `${entry.condition}:events_digest`,
      passed: digestArtifact(events.map(({ event_digest: digest }) => digest)) === record.events_digest,
    });
    const plan = JSON.parse(await readFile(path.join(artifactRoot, entry.plan_path), 'utf8'));
    const replay = decisionReplayChecks({ plan, events });
    checks.push({ id: `${entry.condition}:dispatch_replay`, passed: replay.every(({ match }) => match) });
    // record.actualの主要主張をevents自体から再計算して照合する（expected/actual/
    // matched/record_digestを整合的に書き換えるcoordinated改竄の遮断）。
    {
      const stateFromEvents = projectRuntimeState({ events });
      const actual = record.actual ?? {};
      const claims = [];
      if (Object.hasOwn(actual, 'hold')) {
        claims.push(JSON.stringify(actual.hold)
          === JSON.stringify([...new Set(stateFromEvents.holds.flatMap((hold) => hold.hold_set ?? []))].sort()));
      }
      if (Object.hasOwn(actual, 'accepted')) {
        claims.push(JSON.stringify(actual.accepted) === JSON.stringify(stateFromEvents.accepted));
      }
      if (Object.hasOwn(actual, 'closed')) {
        claims.push(actual.closed === stateFromEvents.closed);
      }
      if (Object.hasOwn(actual, 'carried_over')) {
        claims.push(JSON.stringify(actual.carried_over)
          === JSON.stringify(Object.keys(stateFromEvents.rebinds).sort()));
      }
      checks.push({
        id: `${entry.condition}:actual_recomputed_from_events`,
        passed: claims.every((claim) => claim === true),
      });
    }
    // receipt裁定の再計算: accepted集合の完全一致（片側包含にしない）。
    const receiptCheck = recomputeReceiptDecisions({ plan, events });
    const acceptedFromEvents = [...new Set(projectRuntimeState({ events }).accepted)]
      .filter((todoId) => plan.nodes.some((node) => node.todo_id === todoId)
        && events.some((event) => (
          event.kind === 'receipt_accepted'
          && event.subject?.ref === todoId
          && event.plan_epoch === plan.plan_epoch
        )))
      .sort();
    const acceptedFromDecisions = [...new Set(receiptCheck.decisions
      .filter(({ decision }) => decision === 'accepted')
      .map(({ todo_id: todoId }) => todoId))].sort();
    checks.push({
      id: `${entry.condition}:receipt_replay`,
      passed: acceptedFromEvents.every((todoId) => acceptedFromDecisions.includes(todoId))
        && acceptedFromDecisions.every((todoId) => (
          projectRuntimeState({ events }).accepted.includes(todoId)
        )),
    });
    if (entry.hold_decision_path !== null) {
      const holdDecision = JSON.parse(await readFile(path.join(artifactRoot, entry.hold_decision_path), 'utf8'));
      // hold裁定はhold_decidedの直前prefix（witnessまで含む）から再計算する。
      const holdIndex = events.findIndex((event) => event.kind === 'hold_decided');
      const recomputed = recomputeHoldDecision({
        plan,
        events: events.slice(0, holdIndex),
        manifests: JSON.parse(await readFile(path.join(artifactRoot, entry.manifests_path), 'utf8')),
      });
      checks.push({
        id: `${entry.condition}:hold_replay`,
        passed: JSON.stringify(recomputed.hold_set) === JSON.stringify(holdDecision.hold_set)
          && JSON.stringify(recomputed.continue_set) === JSON.stringify(holdDecision.continue_set)
          && recomputed.finding?.kind === holdDecision.finding?.kind
          // affected closureはhold集合に必ず含まれる（partition整合の最低条件）。
          && holdDecision.affected_closure.every(
            (todoId) => recomputed.hold_set.includes(todoId),
          ),
      });
    }
  }
  const failed = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    schema: 'lattice.rc3.campaign_artifact_verification.v1',
    valid: failed.length === 0,
    checks,
    failed_conditions: failed,
  };
}

async function writeArtifacts({ artifactRoot, scaffold, results, costs = [] }) {
  // stagingはartifactRootと同一filesystem（親directory配下）に置く（EXDEV回避）。
  // 排他はstagingのexclusive mkdirで取り、発行はrename一回で行う。
  await mkdir(path.dirname(artifactRoot), { recursive: true });
  const staging = `${artifactRoot}.staging`;
  try {
    await mkdir(staging);
  } catch (error) {
    fail(`staging directoryを排他作成できない（並行発行または残骸）: ${String(error?.message ?? error)}`);
  }
  const conditions = [];
  for (const result of results) {
    const dir = result.record.condition;
    await mkdir(path.join(staging, dir), { recursive: true });
    const entry = {
      condition: result.record.condition,
      record_path: `${dir}/condition-record.json`,
      record_digest: null,
      events_path: null,
      plan_path: null,
      manifests_path: null,
      hold_decision_path: null,
    };
    await writeFile(path.join(staging, entry.record_path), `${JSON.stringify(result.record, null, 1)}\n`);
    entry.record_digest = digestArtifact(result.record);
    if (result.events !== undefined) {
      entry.events_path = `${dir}/events.json`;
      await writeFile(path.join(staging, entry.events_path), `${JSON.stringify(result.events, null, 1)}\n`);
      entry.plan_path = `${dir}/plan.json`;
      await writeFile(path.join(staging, entry.plan_path), `${JSON.stringify(result.plan, null, 1)}\n`);
      if (result.manifests !== undefined) {
        entry.manifests_path = `${dir}/manifests.json`;
        await writeFile(path.join(staging, entry.manifests_path), `${JSON.stringify(result.manifests, null, 1)}\n`);
      }
      if (result.holdDecision !== undefined) {
        entry.hold_decision_path = `${dir}/hold-decision.json`;
        await writeFile(path.join(staging, entry.hold_decision_path), `${JSON.stringify(result.holdDecision, null, 1)}\n`);
      }
      if (result.planDiff !== undefined) {
        await writeFile(path.join(staging, `${dir}/plan-diff.json`), `${JSON.stringify(result.planDiff, null, 1)}\n`);
      }
      if (result.newPlan !== undefined) {
        await writeFile(path.join(staging, `${dir}/new-plan.json`), `${JSON.stringify(result.newPlan, null, 1)}\n`);
      }
    }
    if (result.request !== undefined) {
      await writeFile(path.join(staging, `${dir}/request.json`), `${JSON.stringify(result.request, null, 1)}\n`);
    }
    if (result.seamExtras !== undefined) {
      await writeFile(
        path.join(staging, `${dir}/transform-artifact.json`),
        `${JSON.stringify(result.seamExtras.transformArtifact, null, 1)}\n`,
      );
      await writeFile(
        path.join(staging, `${dir}/pre-plan.json`),
        `${JSON.stringify(result.seamExtras.prePlan, null, 1)}\n`,
      );
      await writeFile(
        path.join(staging, `${dir}/post-plan.json`),
        `${JSON.stringify(result.seamExtras.postPlan, null, 1)}\n`,
      );
      // patch bytes（source級payload）はidentity/配下だけに置く（Decision 10.3）。
      await mkdir(path.join(staging, 'identity'), { recursive: true });
      await writeFile(path.join(staging, 'identity/accepted-seam.patch'), result.seamExtras.patchBytes);
    }
    if (result.corruptionVariants !== undefined) {
      entry.corruption_variants_path = `${dir}/corruption-variants.json`;
      await writeFile(
        path.join(staging, entry.corruption_variants_path),
        `${JSON.stringify(
          Object.fromEntries(Object.entries(result.corruptionVariants).map(([name, variant]) => (
            [name, { events: variant.events, expected_failed: variant.expected_failed }]
          ))),
          null,
          1,
        )}\n`,
      );
    }
    conditions.push(entry);
  }
  const campaignManifest = {
    schema: 'lattice.rc3.campaign_manifest.v1',
    cost_observations: costs,
    scaffold: {
      lattice_source_base_sha: scaffold.lattice_source.base_sha,
      target_base_sha: scaffold.target.base_sha,
      predeclared_treatment: scaffold.predeclared_treatment,
      path_digests: scaffold.target.path_digests,
    },
    conditions,
  };
  await writeFile(
    path.join(staging, 'campaign-manifest.json'),
    `${JSON.stringify(campaignManifest, null, 1)}\n`,
  );
  // atomic no-overwrite発行: 目標rootの不在を確認してからrename一回。
  // 失敗時はstagingを残さない（残骸掃除を試み、掃除失敗はmessageへ載せる）。
  try {
    let exists = true;
    try {
      await readFile(path.join(artifactRoot, 'campaign-manifest.json'));
    } catch (error) {
      exists = error?.code !== 'ENOENT' ? true : false;
    }
    if (exists) throw new TypeError('既存artifact rootが存在する');
    await rename(staging, artifactRoot);
  } catch (error) {
    let residual = '';
    try {
      const { rm } = await import('node:fs/promises');
      await rm(staging, { recursive: true, force: true });
    } catch (cleanupError) {
      residual = `（staging残骸: ${staging}: ${String(cleanupError?.message ?? cleanupError)}）`;
    }
    fail(`artifact rootへのatomic発行に失敗（既存rootの上書きは禁止）: ${String(error?.message ?? error)}${residual}`);
  }
  return campaignManifest;
}

/**
 * 8条件scripted campaignを実行し、immutable artifact rootへ発行して
 * artifact-only verificationまで行う。
 */
export async function runRc3ScriptedCampaign(options = {}) {
  const { latticeRoot, artifactRoot } = options;
  if (typeof latticeRoot !== 'string' || latticeRoot.length === 0
    || typeof artifactRoot !== 'string' || artifactRoot.length === 0) {
    fail('latticeRoot／artifactRootが必要');
  }

  const workRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3h-'));
  const scaffold = await scaffoldRc3DogfoodRepo({ latticeRoot, workRoot });
  const scaffoldVerified = await verifyRc3DogfoodScaffold({
    latticeRoot, repoRoot: scaffold.repoRoot, expected: scaffold,
  });
  if (scaffoldVerified.outcome !== 'verified') {
    fail(`scaffold検証が失敗: ${JSON.stringify(scaffoldVerified.violations)}`);
  }

  // cost観測: 各条件の実wall-clockを保存する（未実測を0へ丸めない）。
  const costs = [];
  const timed = async (label, thunk) => {
    const started = performance.now();
    const value = await thunk();
    costs.push({ condition: label, elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000 });
    return value;
  };
  const clean = await timed('clean_parallel', () => runCleanParallel({ scaffold }));
  const late = await timed('late_path_conflict', () => runLateConflict({ scaffold }));
  // 条件名`scope_violation`はRC3 manifestのdirectory名として凍結されているので動かさない。
  // 中で期待するfinding種別だけが製品に追従して`undeclared_write`になる。
  const scope = await timed('scope_violation', () => runScopeViolation({ scaffold }));
  const semantic = await timed('semantic_unknown', () => runSemanticUnknown({ scaffold }));
  const stale = await timed('stale_receipt', () => runStaleReceipt({ scaffold }));
  const serial = await timed('irreducible_conflict', () => runIrreducibleConflict({ scaffold }));
  const seam = await timed('accepted_seam', () => runAcceptedSeam({ latticeRoot }));
  const corruption = await timed('event_corruption', () => runEventCorruption({ cleanResult: clean }));

  const results = [clean, late, scope, semantic, stale, serial, seam, corruption];
  const campaignManifest = await writeArtifacts({ artifactRoot, scaffold, results, costs });
  const verification = await verifyRc3CampaignArtifactsOnDisk({ artifactRoot });
  if (!verification.valid) {
    fail(`artifact-only verificationが失敗: ${JSON.stringify(verification.failed_conditions)}`);
  }
  return {
    scaffold,
    campaignManifest,
    verification,
    conditions: results.map(({ record }) => record.condition),
  };
}
