import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';
import { collectSensorEvidence } from './sensor-adapter.mjs';
import { scaffoldRc3DogfoodRepo, verifyRc3DogfoodScaffold } from './rc3-dogfood-scaffold.mjs';
import { compileRuntimePlanV1, evidenceFromCollectedOutcomes } from './runtime-front-end.mjs';
import {
  adjudicatePendingReceipts,
  buildExecutorPackets,
  buildNextRunEvent,
  classifyCheckpointObservation,
  closeRunIfComplete,
  dispatchReadyFrontier,
  initializeRunEvents,
} from './runtime-engine.mjs';
import {
  decideHoldAndCarryOver,
  recompileNextEpochPlan,
  routeConflictTreatment,
} from './runtime-hold-recompile.mjs';
import { captureWorktreeDiff, detectCheckpointFindings } from './runtime-diff-observer.mjs';
import {
  computeReadyFrontier,
  recomputeHoldDecision,
  recomputeReceiptDecisions,
} from './runtime-decision-verifier.mjs';
import { verifyRunEventChain } from './runtime-event-store.mjs';
import { projectRuntimeState } from './runtime-projection.mjs';
import { selfDigest } from './runtime-contracts.mjs';

/**
 * RC3-I actual multi-agent dogfood driver（plan RC3-I、ADR 0044 Decision 9.5）。
 *
 * 親orchestrator（Claude session）が実external executor（Claude implementer
 * subagent等）を隔離worktreeへdispatchするための、状態fileベースのstep driver。
 * 各stepは別processで実行できる純関数で、runtime stateはstate JSONのevent列
 * だけから再構成する（in-memory adapter stateを持たない）。
 *
 * - core event chainはscripted campaignと同一契約。provider固有の観測
 *   （agent handle、実wall-clock、途中状態、回収、retry）は`provider_runs`として
 *   分離保存し、core成功へ丸めない（plan「provider runtime observationとして分離」）。
 * - 実executorはworktreeのfile変更だけを行う協調前提。commit・branch等の
 *   禁止操作はdiff observerのHEAD drift検査でfail loudする。
 * - 重複dispatch拒否・同一handle回収はstate上のactive attempt記録で強制する。
 */

const RUN_TIMESTAMP = '2026-07-17T00:00:00.000Z';
const RUN_ID = 'rc3i-actual-01';
const ENTRY = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const ORACLE = 'src/rc2-delivery-policy-oracle.mjs';
const SHARED_TEST = 'test/rc2-delivery-policy-fixture.test.mjs';

function fail(reason) {
  throw new TypeError(`rc3 actual dogfood契約違反: ${reason}`);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolve(Buffer.concat(stdout).toString('utf8'));
      else {
        reject(new TypeError(
          `${command} ${args[0]} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ));
      }
    });
  });
}

function statePath(stateDir) {
  return path.join(stateDir, 'rc3i-state.json');
}

async function loadState(stateDir) {
  return JSON.parse(await readFile(statePath(stateDir), 'utf8'));
}

async function saveState(stateDir, state) {
  await writeFile(statePath(stateDir), `${JSON.stringify(state, null, 1)}\n`);
}

function witness(todoId, target, affectedTests) {
  return {
    owns: [{ kind: 'path', target }],
    reads: [],
    writes: [target],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: `q-aff-${todoId}`, expect: { kind: 'affected', path: target } }],
    },
    affected_tests: affectedTests,
    unknowns: [],
  };
}

async function provisionWorktree(state, todoId, attempt) {
  const worktreeRoot = await mkdtemp(path.join(tmpdir(), `lattice-rc3i-${todoId}-`));
  const worktreePath = path.join(worktreeRoot, 'tree');
  await run('git', ['worktree', 'add', '--detach', worktreePath, state.scaffold.target.base_sha], state.scaffold.repoRoot);
  return {
    handle: `actual-${todoId}-h${attempt}`,
    worktree_id: `wt-${todoId}-a${attempt}`,
    worktree_root: worktreeRoot,
    worktree_path: worktreePath,
    attempt,
    active: true,
  };
}

/** state駆動のexecutor adapter（dispatch=worktree provision、重複はstateで拒否）。 */
function stateAdapter(state) {
  return {
    kind: 'actual-agent',
    async dispatch({ packet } = {}) {
      const existing = state.worktrees[packet.todo_id];
      if (existing !== undefined && existing.active) {
        fail(`同一TODOの重複dispatchを拒否する: ${packet.todo_id}`);
      }
      const attempt = existing === undefined ? 1 : existing.attempt + 1;
      const provisioned = await provisionWorktree(state, packet.todo_id, attempt);
      state.worktrees[packet.todo_id] = provisioned;
      return { executor_handle: provisioned.handle, worktree_id: provisioned.worktree_id };
    },
  };
}

/**
 * step 1: scaffold・compile・全TODO dispatch（worktree provision）まで。
 * 返り値のworktree pathsへ、親が実agentをdispatchする。
 */
export async function initActualDogfoodRun({ latticeRoot, stateDir }) {
  await mkdir(stateDir, { recursive: true });
  const workRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3i-scaffold-'));
  const scaffold = await scaffoldRc3DogfoodRepo({ latticeRoot, workRoot });
  const scaffoldVerified = await verifyRc3DogfoodScaffold({
    latticeRoot, repoRoot: scaffold.repoRoot, expected: scaffold,
  });
  if (scaffoldVerified.outcome !== 'verified') fail('scaffold検証が失敗');

  const probeQuerySet = {
    queries: [ENTRY, ORACLE, SHARED_TEST].map((target, index) => (
      { id: `probe-${index}`, operation: 'affected', target }
    )),
  };
  const probed = await collectSensorEvidence({ cwd: scaffold.repoRoot, querySet: probeQuerySet });
  const affectedByTarget = {};
  probed.outcomes.forEach((outcome, index) => {
    const entry = Array.isArray(outcome.targets) ? outcome.targets[0] : null;
    affectedByTarget[probeQuerySet.queries[index].target] = Array.isArray(entry?.data?.affectedTests)
      ? [...entry.data.affectedTests].sort()
      : [];
  });

  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'rc3i-actual',
    repo: { base_sha: scaffold.target.base_sha, root_kind: 'git-worktree' },
    capacity: { executors: 3 },
    todos: [{ todo_id: 'TA' }, { todo_id: 'TB' }, { todo_id: 'TC' }],
    manual_witness: {
      TA: witness('TA', ENTRY, affectedByTarget[ENTRY]),
      TB: witness('TB', ORACLE, affectedByTarget[ORACLE]),
      TC: witness('TC', SHARED_TEST, affectedByTarget[SHARED_TEST]),
    },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-aff-TA', operation: 'affected', target: ENTRY },
        { id: 'q-aff-TB', operation: 'affected', target: ORACLE },
        { id: 'q-aff-TC', operation: 'affected', target: SHARED_TEST },
      ],
    },
    executor_capability: { adapters: ['actual-agent'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');

  const collected = await collectSensorEvidence({ cwd: scaffold.repoRoot, querySet: request.sensor_query_set });
  const compiled = compileRuntimePlanV1({
    request,
    sensorEvidence: evidenceFromCollectedOutcomes({ querySet: request.sensor_query_set, collected }),
    planRef: 'plan-rc3i-actual-e1',
    planEpoch: 1,
    predecessorRefs: [],
  });
  if (compiled.outcome !== 'dispatchable') fail(`compileがdispatchableにならない: ${compiled.code}`);
  const packets = buildExecutorPackets({ plan: compiled.plan, manifests: compiled.manifests });

  const state = {
    schema: 'lattice.rc3.actual_dogfood_state.v1',
    scaffold,
    request,
    plan: compiled.plan,
    manifests: compiled.manifests,
    packets,
    newPlan: null,
    rebindPackets: null,
    redispatchPackets: null,
    holdDecision: null,
    planDiff: null,
    events: initializeRunEvents({
      runId: RUN_ID, request, plan: compiled.plan, manifests: compiled.manifests, recordedAt: RUN_TIMESTAMP,
    }),
    worktrees: {},
    provider_runs: [],
    probes: {},
  };
  const adapter = stateAdapter(state);
  const dispatched = await dispatchReadyFrontier({
    runId: RUN_ID, plan: state.plan, events: state.events,
    packets, manifests: state.manifests, adapter, recordedAt: RUN_TIMESTAMP,
  });
  if (dispatched.failure) fail(`dispatch失敗: ${dispatched.failure.message}`);
  state.events = dispatched.events;
  await saveState(stateDir, state);
  return {
    dispatched: dispatched.dispatched,
    worktrees: Object.fromEntries(Object.entries(state.worktrees).map(([todoId, entry]) => (
      [todoId, { path: entry.worktree_path, handle: entry.handle, packet: packets[todoId] }]
    ))),
  };
}

/** provider観測（agent handle・時刻・状態遷移）をledgerへ追記する。core eventsへは入れない。 */
export async function recordProviderObservation({ stateDir, observation }) {
  const state = await loadState(stateDir);
  state.provider_runs.push(observation);
  await saveState(stateDir, state);
  return { count: state.provider_runs.length };
}

/** 指定TODOのworktree実diffをcheckpoint観測し、findingがあればconflict+freezeまで進める。 */
export async function observeActualCheckpoint({ stateDir, todoId, planKey = 'plan' }) {
  const state = await loadState(stateDir);
  const worktree = state.worktrees[todoId];
  if (worktree === undefined || !worktree.active) fail(`active worktreeがない: ${todoId}`);
  const plan = state[planKey];
  const checkpoint = await captureWorktreeDiff({
    worktreePath: worktree.worktree_path,
    baseSha: state.scaffold.target.base_sha,
  });
  let events = [...state.events];
  events.push(buildNextRunEvent({
    events,
    runId: RUN_ID,
    kind: 'checkpoint_observed',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'todo', ref: todoId },
    payload: structuredClone(checkpoint),
    recordedAt: RUN_TIMESTAMP,
  }));
  const packets = plan.plan_epoch === 1 ? state.packets : state.redispatchPackets ?? state.packets;
  const classifyPackets = { ...state.packets, ...(state.redispatchPackets ?? {}) };
  void packets;
  const classified = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets: classifyPackets, manifests: state.manifests, todoId,
    detect: detectCheckpointFindings, recordedAt: RUN_TIMESTAMP,
  });
  state.events = classified.events;
  await saveState(stateDir, state);
  return { findings: classified.findings, checkpoint_digest: checkpoint.checkpoint_digest };
}

/** hold裁定→recompile→（carried TODOの）rebind packet発行までを一括で行う。 */
export async function holdAndRecompile({ stateDir, additionalConflicts }) {
  const state = await loadState(stateDir);
  const held = decideHoldAndCarryOver({
    runId: RUN_ID,
    request: state.request,
    plan: state.plan,
    manifests: state.manifests,
    packets: state.packets,
    events: state.events,
    recordedAt: RUN_TIMESTAMP,
  });
  const lane = routeConflictTreatment({
    finding: held.holdDecision.finding,
    predeclaredTreatments: [],
  });
  const recompiled = recompileNextEpochPlan({
    runId: RUN_ID,
    request: state.request,
    plan: state.plan,
    manifests: state.manifests,
    packets: state.packets,
    events: held.events,
    holdDecision: held.holdDecision,
    additionalConflicts,
    recordedAt: RUN_TIMESTAMP,
  });
  state.events = recompiled.events;
  state.holdDecision = held.holdDecision;
  state.newPlan = recompiled.newPlan;
  state.planDiff = recompiled.planDiff;
  state.rebindPackets = recompiled.rebindPackets;
  state.redispatchPackets = recompiled.redispatchPackets;
  // rebind: carried TODOのpacket epochを更新（同一handle・content不変）。
  for (const todoId of held.holdDecision.continue_set) {
    state.packets[todoId] = {
      ...state.packets[todoId],
      plan_epoch: recompiled.newPlan.plan_epoch,
    };
  }
  // hold集合のworktreeは失効（active解除。掃除はcleanupWorktreesで記録付き実施）。
  for (const todoId of held.holdDecision.hold_set) {
    if (state.worktrees[todoId] !== undefined) state.worktrees[todoId].active = false;
  }
  await saveState(stateDir, state);
  return {
    hold: held.holdDecision.hold_set,
    continue: held.holdDecision.continue_set,
    lane: lane.lane,
    new_epoch: recompiled.newPlan.plan_epoch,
  };
}

/** terminal receipt（現attemptの最終checkpointへbind）を記録し、受理裁定まで行う。 */
export async function terminalActualReceipt({ stateDir, todoId, planKey }) {
  const state = await loadState(stateDir);
  const plan = state[planKey];
  const worktree = state.worktrees[todoId];
  if (worktree === undefined || !worktree.active) fail(`active worktreeがない: ${todoId}`);
  const packet = planKey === 'newPlan' && state.redispatchPackets?.[todoId] !== undefined
    ? state.redispatchPackets[todoId]
    : state.packets[todoId];
  const stateProjection = projectRuntimeState({ events: state.events });
  const dispatchRecord = stateProjection.dispatches[todoId];
  const attemptCheckpoints = stateProjection.checkpoints.filter((entry) => (
    entry.todo_id === todoId && entry.sequence > dispatchRecord.sequence
  ));
  if (attemptCheckpoints.length === 0) fail(`checkpoint未観測でterminalにできない: ${todoId}`);
  const lastCheckpoint = attemptCheckpoints[attemptCheckpoints.length - 1].payload;
  const receipt = {
    schema: 'lattice.executor_receipt.v1',
    receipt_id: `${todoId}-a${worktree.attempt}-r1`,
    executor_handle: worktree.handle,
    worktree_id: worktree.worktree_id,
    base_sha: packet.base_sha,
    plan_epoch: packet.plan_epoch,
    packet_digest: dispatchRecord.payload.packet_digest,
    todo_id: todoId,
    checkpoint_digest: lastCheckpoint.checkpoint_digest,
    observed_diff: lastCheckpoint.diff.entries.map(({ path: p, change }) => ({ path: p, change })),
  };
  receipt.receipt_digest = selfDigest(receipt, 'receipt_digest');
  let events = [...state.events];
  events.push(buildNextRunEvent({
    events,
    runId: RUN_ID,
    kind: 'receipt_recorded',
    planEpoch: receipt.plan_epoch,
    subject: { kind: 'todo', ref: todoId },
    payload: receipt,
    recordedAt: RUN_TIMESTAMP,
  }));
  // worktree cleanup（失敗は成功へ丸めずterminal payloadへ記録）。
  let cleanup = { cleanup_ok: true, residual_paths: [] };
  try {
    await run('git', ['worktree', 'remove', '--force', worktree.worktree_path], state.scaffold.repoRoot);
  } catch (error) {
    cleanup = {
      cleanup_ok: false,
      residual_paths: [worktree.worktree_root],
      message: String(error?.message ?? error),
    };
  }
  events.push(buildNextRunEvent({
    events,
    runId: RUN_ID,
    kind: 'executor_terminal',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'todo', ref: todoId },
    payload: { executor_handle: worktree.handle, terminal_state: 'reported', cleanup },
    recordedAt: RUN_TIMESTAMP,
  }));
  const adjudicated = adjudicatePendingReceipts({
    runId: RUN_ID, plan, events, recordedAt: RUN_TIMESTAMP,
  });
  state.events = adjudicated.events;
  state.worktrees[todoId].active = false;
  await saveState(stateDir, state);
  return { decisions: adjudicated.decisions, receipt_id: receipt.receipt_id };
}

/** 重複dispatch拒否のprobe（typed拒否をprovider観測として記録）。 */
export async function probeDuplicateDispatch({ stateDir, todoId }) {
  const state = await loadState(stateDir);
  const adapter = stateAdapter(state);
  let refused = null;
  try {
    await adapter.dispatch({ packet: state.packets[todoId] });
  } catch (error) {
    refused = String(error?.message ?? error);
  }
  state.probes.duplicate_dispatch = { todo_id: todoId, refused };
  await saveState(stateDir, state);
  if (refused === null) fail('重複dispatchが拒否されなかった');
  return { refused };
}

/** 旧epoch stale receiptのprobe（typed rejectを記録）。 */
export async function probeStaleReceipt({ stateDir, todoId }) {
  const state = await loadState(stateDir);
  const stateProjection = projectRuntimeState({ events: state.events });
  const dispatchRecord = stateProjection.dispatches[todoId];
  const staleReceipt = {
    schema: 'lattice.executor_receipt.v1',
    receipt_id: `${todoId}-stale-r1`,
    executor_handle: dispatchRecord.payload.executor_handle,
    worktree_id: dispatchRecord.payload.worktree_id,
    base_sha: state.plan.base_sha,
    plan_epoch: state.plan.plan_epoch,
    packet_digest: dispatchRecord.payload.packet_digest,
    todo_id: todoId,
    checkpoint_digest: '2'.repeat(64),
    observed_diff: [],
  };
  staleReceipt.receipt_digest = selfDigest(staleReceipt, 'receipt_digest');
  let events = [...state.events];
  events.push(buildNextRunEvent({
    events,
    runId: RUN_ID,
    kind: 'receipt_recorded',
    planEpoch: staleReceipt.plan_epoch,
    subject: { kind: 'todo', ref: todoId },
    payload: staleReceipt,
    recordedAt: RUN_TIMESTAMP,
  }));
  const adjudicated = adjudicatePendingReceipts({
    runId: RUN_ID, plan: state.newPlan, events, recordedAt: RUN_TIMESTAMP,
  });
  const decision = adjudicated.decisions.find(({ receipt_id: id }) => id === staleReceipt.receipt_id);
  if (decision?.decision !== 'rejected') fail('stale receiptがrejectされなかった');
  state.events = adjudicated.events;
  state.probes.stale_receipt = { todo_id: todoId, decision };
  await saveState(stateDir, state);
  return { decision };
}

/** epoch 2のredispatch（1件ずつ。frontier/conflict規則はengineに従う）。 */
export async function redispatchNext({ stateDir }) {
  const state = await loadState(stateDir);
  const adapter = stateAdapter(state);
  const dispatched = await dispatchReadyFrontier({
    runId: RUN_ID,
    plan: state.newPlan,
    events: state.events,
    packets: state.redispatchPackets,
    manifests: state.manifests,
    adapter,
    recordedAt: RUN_TIMESTAMP,
  });
  if (dispatched.failure) fail(`redispatch失敗: ${dispatched.failure.message}`);
  state.events = dispatched.events;
  await saveState(stateDir, state);
  return {
    dispatched: dispatched.dispatched,
    worktrees: Object.fromEntries(dispatched.dispatched.map((todoId) => (
      [todoId, {
        path: state.worktrees[todoId].worktree_path,
        handle: state.worktrees[todoId].handle,
        packet: state.redispatchPackets[todoId],
      }]
    ))),
  };
}

/** run close＋残worktree掃除（残存は記録）。 */
export async function closeActualRun({ stateDir }) {
  const state = await loadState(stateDir);
  const closed = closeRunIfComplete({
    runId: RUN_ID, plan: state.newPlan ?? state.plan, events: state.events, recordedAt: RUN_TIMESTAMP,
  });
  state.events = closed.events;
  const residual = [];
  for (const [todoId, worktree] of Object.entries(state.worktrees)) {
    if (!worktree.active) continue;
    try {
      await run('git', ['worktree', 'remove', '--force', worktree.worktree_path], state.scaffold.repoRoot);
      worktree.active = false;
    } catch (error) {
      residual.push({ todo_id: todoId, path: worktree.worktree_root, message: String(error?.message ?? error) });
    }
  }
  state.probes.residual_worktrees = residual;
  await saveState(stateDir, state);
  return { closed: closed.closed, residual };
}

/** artifact v2をatomic no-overwriteで発行する。 */
export async function publishActualArtifact({ stateDir, artifactRoot }) {
  const state = await loadState(stateDir);
  await mkdir(path.dirname(artifactRoot), { recursive: true });
  const staging = `${artifactRoot}.staging`;
  try {
    await mkdir(staging);
  } catch (error) {
    fail(`stagingを排他作成できない: ${String(error?.message ?? error)}`);
  }
  const documents = {
    'request.json': state.request,
    'plan.json': state.plan,
    'new-plan.json': state.newPlan,
    'manifests.json': state.manifests,
    'hold-decision.json': state.holdDecision,
    'plan-diff.json': state.planDiff,
    'events.json': state.events,
    'provider-runs.json': state.provider_runs,
    'probes.json': state.probes,
  };
  const manifestEntries = {};
  for (const [name, document] of Object.entries(documents)) {
    await writeFile(path.join(staging, name), `${JSON.stringify(document, null, 1)}\n`);
    manifestEntries[name] = digestArtifact(document);
  }
  const manifest = {
    schema: 'lattice.rc3.actual_dogfood_manifest.v1',
    run_id: RUN_ID,
    scaffold: {
      lattice_source_base_sha: state.scaffold.lattice_source.base_sha,
      target_base_sha: state.scaffold.target.base_sha,
      path_digests: state.scaffold.target.path_digests,
    },
    document_digests: manifestEntries,
  };
  await writeFile(path.join(staging, 'dogfood-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  try {
    let exists = true;
    try {
      await readFile(path.join(artifactRoot, 'dogfood-manifest.json'));
    } catch (error) {
      exists = error?.code !== 'ENOENT';
    }
    if (exists) throw new TypeError('既存artifact rootが存在する');
    await rename(staging, artifactRoot);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(staging, { recursive: true, force: true });
    fail(`artifact発行に失敗（上書き禁止）: ${String(error?.message ?? error)}`);
  }
  return { manifest };
}

/** artifact v2を保存bytesだけから再検証する。 */
export async function verifyActualArtifactOnDisk({ artifactRoot }) {
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'dogfood-manifest.json'), 'utf8'));
  const checks = [];
  const documents = {};
  for (const [name, digest] of Object.entries(manifest.document_digests)) {
    const document = JSON.parse(await readFile(path.join(artifactRoot, name), 'utf8'));
    documents[name] = document;
    checks.push({ id: `digest:${name}`, passed: digestArtifact(document) === digest });
  }
  const events = documents['events.json'];
  const plan = documents['plan.json'];
  const newPlan = documents['new-plan.json'];
  const chain = verifyRunEventChain({ events });
  checks.push({ id: 'event_chain', passed: chain.valid });
  for (const [label, targetPlan] of [['e1', plan], ['e2', newPlan]]) {
    events.forEach((event, index) => {
      if (event.kind !== 'dispatch_decided' || event.plan_epoch !== targetPlan.plan_epoch) return;
      const recomputed = computeReadyFrontier({ plan: targetPlan, events: events.slice(0, index) });
      checks.push({
        id: `dispatch_replay:${label}:seq${event.sequence}`,
        passed: JSON.stringify(event.payload.dispatchable) === JSON.stringify(recomputed.dispatchable),
      });
    });
  }
  const holdDecision = documents['hold-decision.json'];
  const holdIndex = events.findIndex((event) => event.kind === 'hold_decided');
  const recomputedHold = recomputeHoldDecision({
    plan, events: events.slice(0, holdIndex), manifests: documents['manifests.json'],
  });
  checks.push({
    id: 'hold_replay',
    passed: JSON.stringify(recomputedHold.hold_set) === JSON.stringify(holdDecision.hold_set)
      && JSON.stringify(recomputedHold.continue_set) === JSON.stringify(holdDecision.continue_set),
  });
  // receipt裁定の再計算: 記録済みoutcome event（accepted/rejected＋detail）と
  // replay結果の双方向・reason粒度の一致を要求する（片側包含にしない。RC3-J P1採用）。
  // 各receiptの裁定は「outcome eventのepoch＝裁定時のactive plan」で再計算する
  //（receiptが名乗るepochではない。staleは新planの下でepoch_mismatchになる）。
  const recordedOutcomes = new Map();
  for (const event of events) {
    if (event.kind !== 'receipt_accepted' && event.kind !== 'receipt_rejected') continue;
    const receiptId = event.payload?.receipt_id;
    if (typeof receiptId !== 'string') continue;
    recordedOutcomes.set(receiptId, {
      decision: event.kind === 'receipt_accepted' ? 'accepted' : 'rejected',
      detail: event.payload?.detail ?? null,
      adjudication_epoch: event.plan_epoch,
    });
  }
  const planByEpoch = new Map([plan, newPlan]
    .filter((entry) => entry !== null)
    .map((entry) => [entry.plan_epoch, entry]));
  let receiptReplayOk = recordedOutcomes.size > 0;
  const acceptedInReplay = new Set();
  for (const [receiptId, recorded] of recordedOutcomes) {
    const adjudicationPlan = planByEpoch.get(recorded.adjudication_epoch);
    if (adjudicationPlan === undefined) {
      receiptReplayOk = false;
      continue;
    }
    // 裁定「前」のprefix（outcome event以前）に対するreplayと比較する。
    const outcomeIndex = events.findIndex((event) => (
      (event.kind === 'receipt_accepted' || event.kind === 'receipt_rejected')
      && event.payload?.receipt_id === receiptId
    ));
    const replayed = recomputeReceiptDecisions({
      plan: adjudicationPlan,
      events: events.slice(0, outcomeIndex),
    }).decisions.find(({ receipt_id: id }) => id === receiptId);
    if (replayed === undefined
      || replayed.decision !== recorded.decision
      || (recorded.decision === 'rejected' && replayed.detail !== recorded.detail)) {
      receiptReplayOk = false;
    }
    if (replayed?.decision === 'accepted') acceptedInReplay.add(receiptId);
  }
  // 最終planでのfull replayに現れる受理が、記録済みoutcomeへ全て対応することも要求。
  if (newPlan !== null) {
    for (const decision of recomputeReceiptDecisions({ plan: newPlan, events }).decisions) {
      if (decision.decision === 'accepted' && !recordedOutcomes.has(decision.receipt_id)) {
        receiptReplayOk = false;
      }
    }
  }
  checks.push({ id: 'receipt_replay_bidirectional', passed: receiptReplayOk });
  checks.push({
    id: 'provider_separation',
    passed: events.every((event) => (
      JSON.stringify(event.payload).includes('provider_handle') === false
    )),
  });
  const failed = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return { valid: failed.length === 0, checks, failed_conditions: failed };
}
