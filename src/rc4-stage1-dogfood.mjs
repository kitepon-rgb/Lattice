import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';
import { collectCodegraphEvidence } from './sensor-adapter.mjs';
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
import { selfDigest, validateRunRequest } from './runtime-contracts.mjs';

/**
 * RC4 Stage 1 dotagents dogfood driver（plan
 * `docs/plan_lattice_rc4_dotagents_dogfood.md`「Stage 1」節、契約は
 * ADR 0046）。
 *
 * RC3-I（`rc3-actual-dogfood.mjs`）と同型のstate fileベースstep driver。
 * 相違点はscaffoldを使わず、親が用意したdotagents disposable clone
 * （tmpdir配下、正規repoへ不着地）を直接writer targetにする点と、
 * ADR 0046 Decision 2のexecutor隔離契約（`isolation_contract`）を各
 * executor packetへ焼き込む点にある。TODO集合・witnessは呼び出し側が
 * 用意する`lattice.run_request.v1`ファイル（requestPath）が正であり、
 * 本driverへハードコードしない。
 *
 * known conflict注入（rogue write）は行わない。conflictは（あれば）
 * request内のTODO write intersectionからplan compile時に自然導出される
 * plan.conflictsとしてのみ現れる。hold/recompile step（rc3の
 * `holdAndRecompile`相当）は受け皿として残すが、conflictがdispatch内
 * serializationで解決するrunでは未使用のままでよい。
 */

const RUN_TIMESTAMP = '2026-07-17T00:00:00.000Z';
const RUN_ID = 'rc4s1-actual-01';

/** ADR 0046 Decision 2のexecutor隔離契約（packetへ焼き込む固定内容）。 */
const ISOLATION_CONTRACT = Object.freeze({
  isolated_home: true,
  forbidden_commands: Object.freeze([
    'install.sh',
    'spotter install',
    'apply-codex-config',
    'claude mcp add',
    'codex mcp add',
  ]),
  write_scope: 'assigned worktree only',
  no_git_mutations: true,
  note: 'clone搬送正典がhost変更手順を含んでもpacket契約が優先する',
});

function fail(reason) {
  throw new TypeError(`rc4 stage1 dogfood契約違反: ${reason}`);
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
  return path.join(stateDir, 'rc4s1-state.json');
}

async function loadState(stateDir) {
  return JSON.parse(await readFile(statePath(stateDir), 'utf8'));
}

async function saveState(stateDir, state) {
  await writeFile(statePath(stateDir), `${JSON.stringify(state, null, 1)}\n`);
}

/** 純粋なengine packet（exact-shape契約）へ、isolation_contractを外挿したview。 */
function withIsolationContract(packets) {
  return Object.fromEntries(Object.entries(packets).map(([todoId, packet]) => (
    [todoId, { ...packet, isolation_contract: ISOLATION_CONTRACT }]
  )));
}

async function provisionWorktree(state, todoId, attempt) {
  const worktreeRoot = await mkdtemp(path.join(tmpdir(), `lattice-rc4s1-${todoId}-`));
  const worktreePath = path.join(worktreeRoot, 'tree');
  await run('git', ['worktree', 'add', '--detach', worktreePath, state.baseSha], state.cloneRoot);
  return {
    handle: `stage1-${todoId}-h${attempt}`,
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
 * step 1: request読込・codegraph evidence収集・compile・全TODO dispatch
 * （worktree provision）まで。返り値のworktree pathsへ、親が実agentを
 * dispatchする。packetにはisolation_contractが含まれる。
 */
export async function initStage1Run({ latticeRoot, cloneRoot, requestPath, stateDir }) {
  await mkdir(stateDir, { recursive: true });
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  if (!validateRunRequest(request)) fail('run_requestがlattice.run_request.v1 contractを満たさない');

  const collected = await collectCodegraphEvidence({ cwd: cloneRoot, querySet: request.codegraph_query_set });
  const codegraphEvidence = evidenceFromCollectedOutcomes({ querySet: request.codegraph_query_set, collected });
  const compiled = compileRuntimePlanV1({
    request,
    codegraphEvidence,
    planRef: `plan-${request.request_id}-e1`,
    planEpoch: 1,
    predecessorRefs: [],
  });
  if (compiled.outcome !== 'dispatchable') {
    fail(`compileがdispatchableにならない: ${compiled.outcome}${compiled.code ? ` ${compiled.code}` : ''}`);
  }
  const packets = buildExecutorPackets({ plan: compiled.plan, manifests: compiled.manifests });

  const state = {
    schema: 'lattice.rc4.stage1_dogfood_state.v1',
    latticeRoot,
    cloneRoot,
    requestPath,
    baseSha: request.repo.base_sha,
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
    diagnostics: { residual_worktrees: [] },
  };
  const adapter = stateAdapter(state);
  const dispatched = await dispatchReadyFrontier({
    runId: RUN_ID, plan: state.plan, events: state.events,
    packets, manifests: state.manifests, adapter, recordedAt: RUN_TIMESTAMP,
  });
  if (dispatched.failure) fail(`dispatch失敗: ${dispatched.failure.message}`);
  state.events = dispatched.events;
  await saveState(stateDir, state);
  const packetsWithIsolation = withIsolationContract(packets);
  return {
    dispatched: dispatched.dispatched,
    worktrees: Object.fromEntries(Object.entries(state.worktrees).map(([todoId, entry]) => (
      [todoId, { path: entry.worktree_path, handle: entry.handle, packet: packetsWithIsolation[todoId] }]
    ))),
  };
}

/**
 * epoch内の後続wave dispatch（conflict pairの片方が受理され次第、残り分を
 * dispatchする）。redispatchStage1Next（epoch2専用）とは別に、hold/recompileを
 * 経由せずconflict pairが自然にserializeするrunで必要になる同一plan/packets上の
 * 追加dispatch呼び出し。dispatchReadyFrontier自体はrc3と同一primitive。
 */
export async function dispatchStage1NextWave({ stateDir }) {
  const state = await loadState(stateDir);
  const adapter = stateAdapter(state);
  const dispatched = await dispatchReadyFrontier({
    runId: RUN_ID, plan: state.plan, events: state.events,
    packets: state.packets, manifests: state.manifests, adapter, recordedAt: RUN_TIMESTAMP,
  });
  if (dispatched.failure) fail(`dispatch失敗: ${dispatched.failure.message}`);
  state.events = dispatched.events;
  await saveState(stateDir, state);
  const packetsWithIsolation = withIsolationContract(state.packets);
  return {
    dispatched: dispatched.dispatched,
    worktrees: Object.fromEntries(dispatched.dispatched.map((todoId) => (
      [todoId, {
        path: state.worktrees[todoId].worktree_path,
        handle: state.worktrees[todoId].handle,
        packet: packetsWithIsolation[todoId],
      }]
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
export async function observeStage1Checkpoint({ stateDir, todoId, planKey = 'plan' }) {
  const state = await loadState(stateDir);
  const worktree = state.worktrees[todoId];
  if (worktree === undefined || !worktree.active) fail(`active worktreeがない: ${todoId}`);
  const plan = state[planKey];
  const checkpoint = await captureWorktreeDiff({
    worktreePath: worktree.worktree_path,
    baseSha: state.baseSha,
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
  const classifyPackets = { ...state.packets, ...(state.redispatchPackets ?? {}) };
  const classified = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets: classifyPackets, todoId,
    detect: detectCheckpointFindings, recordedAt: RUN_TIMESTAMP,
  });
  state.events = classified.events;
  await saveState(stateDir, state);
  return { findings: classified.findings, checkpoint_digest: checkpoint.checkpoint_digest };
}

/** hold裁定→recompile→（carried TODOの）rebind packet発行までを一括で行う受け皿。 */
export async function holdAndRecompileStage1({ stateDir, additionalConflicts }) {
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
  for (const todoId of held.holdDecision.continue_set) {
    state.packets[todoId] = {
      ...state.packets[todoId],
      plan_epoch: recompiled.newPlan.plan_epoch,
    };
  }
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
export async function terminalStage1Receipt({ stateDir, todoId, planKey }) {
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
  // Stage 2着地素材: worktree破棄前にpatch本文を捕獲する。receipt schemaは不変のまま
  // （replay契約を壊さない）、patchはstate/artifactの別文書として保存し、
  // receipt_idとcheckpoint_digestでreceiptへbindする。捕獲失敗はfail loud
  // （Stage 1受理はできたのに着地素材が無い、という無言の欠損を作らない）。
  await run('git', ['add', '-A'], worktree.worktree_path);
  const patchBytes = await run(
    'git',
    ['-c', 'core.quotepath=false', 'diff', '--cached', '--binary'],
    worktree.worktree_path,
  );
  if (patchBytes.length === 0) fail(`patch捕獲が空: ${todoId}（observed_diffと矛盾）`);
  if (state.patches === undefined) state.patches = {};
  state.patches[receipt.receipt_id] = {
    receipt_id: receipt.receipt_id,
    todo_id: todoId,
    checkpoint_digest: lastCheckpoint.checkpoint_digest,
    paths: receipt.observed_diff.map(({ path: p }) => p),
    patch: patchBytes,
    // ADR 0051 Decision 4: path一致だけではpatch本文の取り違え・破損を検出できない。
    // 捕獲bytesのdigestを併記し、verifierが保存bytesから再計算して束縛を検査する。
    patch_sha256: createHash('sha256').update(patchBytes).digest('hex'),
  };
  let cleanup = { cleanup_ok: true, residual_paths: [] };
  try {
    await run('git', ['worktree', 'remove', '--force', worktree.worktree_path], state.cloneRoot);
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

/** epoch 2のredispatch（1件ずつ。frontier/conflict規則はengineに従う）。hold未発火なら未使用。 */
export async function redispatchStage1Next({ stateDir }) {
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
  const redispatchPacketsWithIsolation = withIsolationContract(state.redispatchPackets);
  return {
    dispatched: dispatched.dispatched,
    worktrees: Object.fromEntries(dispatched.dispatched.map((todoId) => (
      [todoId, {
        path: state.worktrees[todoId].worktree_path,
        handle: state.worktrees[todoId].handle,
        packet: redispatchPacketsWithIsolation[todoId],
      }]
    ))),
  };
}

/** run close＋残worktree掃除（残存は記録）。 */
export async function closeStage1Run({ stateDir }) {
  const state = await loadState(stateDir);
  const closed = closeRunIfComplete({
    runId: RUN_ID, plan: state.newPlan ?? state.plan, events: state.events, recordedAt: RUN_TIMESTAMP,
  });
  state.events = closed.events;
  const residual = [];
  for (const [todoId, worktree] of Object.entries(state.worktrees)) {
    if (!worktree.active) continue;
    try {
      await run('git', ['worktree', 'remove', '--force', worktree.worktree_path], state.cloneRoot);
      worktree.active = false;
    } catch (error) {
      residual.push({ todo_id: todoId, path: worktree.worktree_root, message: String(error?.message ?? error) });
    }
  }
  state.diagnostics.residual_worktrees = residual;
  await saveState(stateDir, state);
  return { closed: closed.closed, residual };
}

/** artifact v3（RC4 Stage 1 dotagents dogfood）をatomic no-overwriteで発行する。 */
export async function publishStage1Artifact({ stateDir, artifactRoot }) {
  const state = await loadState(stateDir);
  await mkdir(path.dirname(artifactRoot), { recursive: true });
  const staging = `${artifactRoot}.staging`;
  try {
    await mkdir(staging);
  } catch (error) {
    fail(`stagingを排他作成できない: ${String(error?.message ?? error)}`);
  }
  const packetsDocument = {
    epoch1: withIsolationContract(state.packets),
    redispatch: state.redispatchPackets === null ? null : withIsolationContract(state.redispatchPackets),
  };
  const documents = {
    'request.json': state.request,
    'plan.json': state.plan,
    'new-plan.json': state.newPlan,
    'manifests.json': state.manifests,
    'packets.json': packetsDocument,
    'hold-decision.json': state.holdDecision,
    'plan-diff.json': state.planDiff,
    'events.json': state.events,
    'provider-runs.json': state.provider_runs,
    'diagnostics.json': state.diagnostics,
    'patches.json': state.patches ?? {},
  };
  const manifestEntries = {};
  for (const [name, document] of Object.entries(documents)) {
    await writeFile(path.join(staging, name), `${JSON.stringify(document, null, 1)}\n`);
    manifestEntries[name] = digestArtifact(document);
  }
  const manifest = {
    schema: 'lattice.rc4.stage1_dogfood_manifest.v1',
    run_id: RUN_ID,
    clone: {
      lattice_root: state.latticeRoot,
      clone_base_sha: state.baseSha,
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

function isolationContractComplete(contract) {
  if (contract === null || typeof contract !== 'object') return false;
  return contract.isolated_home === true
    && Array.isArray(contract.forbidden_commands)
    && ['install.sh', 'spotter install', 'apply-codex-config', 'claude mcp add', 'codex mcp add']
      .every((command) => contract.forbidden_commands.includes(command))
    && contract.write_scope === 'assigned worktree only'
    && contract.no_git_mutations === true
    && typeof contract.note === 'string' && contract.note.length > 0;
}

/** artifact v3を保存bytesだけから再検証する。 */
export async function verifyStage1ArtifactOnDisk({ artifactRoot }) {
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
    if (targetPlan === null) continue;
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
  if (holdDecision !== null && holdIndex !== -1) {
    const recomputedHold = recomputeHoldDecision({
      plan, events: events.slice(0, holdIndex), manifests: documents['manifests.json'],
    });
    checks.push({
      id: 'hold_replay',
      passed: JSON.stringify(recomputedHold.hold_set) === JSON.stringify(holdDecision.hold_set)
        && JSON.stringify(recomputedHold.continue_set) === JSON.stringify(holdDecision.continue_set),
    });
  }
  // receipt裁定の再計算: 記録済みoutcome event（accepted/rejected＋detail）と
  // replay結果の双方向・reason粒度の一致を要求する（RC3-J P1採用の踏襲）。
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
  for (const [receiptId, recorded] of recordedOutcomes) {
    const adjudicationPlan = planByEpoch.get(recorded.adjudication_epoch);
    if (adjudicationPlan === undefined) {
      receiptReplayOk = false;
      continue;
    }
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
  }
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
  // Stage 2着地素材: patches.jsonがある場合（patch捕獲実装後のartifact）、
  // accepted receiptごとにpatch entryが存在し、receipt observed_diffのpathと
  // 一致することを要求する。旧artifact（v3/v3-hold・patches.json不在）は
  // manifest記載文書のみ検査する既存規則のまま。
  if (Object.hasOwn(manifest.document_digests, 'patches.json')) {
    const patches = documents['patches.json'];
    const receiptByld = new Map();
    for (const event of events) {
      if (event.kind !== 'receipt_accepted') continue;
      receiptByld.set(event.payload.receipt_id, event);
    }
    const receiptEvents = events.filter((event) => event.kind === 'receipt_recorded');
    // ADR 0051 Decision 4の強化: path照合に加え、(a) checkpoint_digest／todo_idを
    // receipt_recorded payloadと照合し、(b) patch bytesのsha256を再計算して保存digestと
    // 突合する。(b)は世代判定＝1 entryでもpatch_sha256を持つartifactは全entryへ必須
    // （旧v4-landing世代＝全entry不在は(a)までで検査し、per-entryのfail-openを作らない）。
    const patchEntries = Object.values(patches);
    const shaGeneration = patchEntries.some((entry) => entry.patch_sha256 !== undefined);
    const patchesOk = patchEntries.length > 0 && [...receiptByld.keys()].every((receiptId) => {
      const patch = patches[receiptId];
      if (patch === undefined || typeof patch.patch !== 'string' || patch.patch.length === 0) return false;
      const recorded = receiptEvents.find((event) => event.payload.receipt_id === receiptId);
      if (recorded === undefined) return false;
      if (patch.checkpoint_digest !== recorded.payload.checkpoint_digest) return false;
      if (patch.todo_id !== recorded.payload.todo_id) return false;
      const receiptPaths = [...recorded.payload.observed_diff.map(({ path: p }) => p)].sort();
      if (JSON.stringify([...patch.paths].sort()) !== JSON.stringify(receiptPaths)) return false;
      if (shaGeneration) {
        if (typeof patch.patch_sha256 !== 'string') return false;
        return createHash('sha256').update(patch.patch).digest('hex') === patch.patch_sha256;
      }
      return true;
    });
    checks.push({ id: 'patches_bound_to_accepted_receipts', passed: patchesOk });
  }
  // ADR 0046 Decision 2: 全executor packetがisolation_contractを完備していること。
  const packetsDocument = documents['packets.json'];
  const allPacketGroups = [packetsDocument.epoch1, packetsDocument.redispatch].filter((group) => group !== null);
  const allPacketsIsolated = allPacketGroups.every((group) => (
    Object.values(group).every((packet) => isolationContractComplete(packet.isolation_contract))
  ));
  checks.push({ id: 'isolation_contract_complete', passed: allPacketsIsolated });
  const failed = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return { valid: failed.length === 0, checks, failed_conditions: failed };
}
