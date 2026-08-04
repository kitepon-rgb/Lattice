import { digestArtifact } from './artifact-contracts.mjs';
import { digestRunEvent } from './runtime-event-store.mjs';
import { projectRuntimeState } from './runtime-projection.mjs';
import { isCanonicalUtcTimestamp } from './timestamp-contract.mjs';
import {
  RUN_EVENT_KINDS,
  computeContextContentDigest,
  selfDigest,
  validateExecutorPacket,
  validateExecutorReceipt,
  validateRunEvent,
  validateRuntimePlan,
  verifyRuntimePlanBinding,
} from './runtime-contracts.mjs';

/**
 * RC3-E ready-frontier runtime engine（ADR 0044 Decision 3・4・7.4・9、plan RC3-E）。
 *
 * event chainを生成するproducer。dispatch選択とreceipt裁定は
 * `runtime-decision-verifier.mjs`と**独立の実装**で持ち、verifierは保存bytesだけから
 * 全decisionを再計算する（producer非依存検証の二重実装が意図。同一コードの
 * 自己照合にしない）。
 *
 * - minimum waveを同期barrierとして使わず、eventごとにhard predecessor・
 *   running conflict・実capacityからready frontierを再評価する（Decision 4）。
 * - dispatchは必ずexecutor_packet.v1を伴い、dispatch記録（executor_handle・
 *   worktree_id・packet_digest）がreceipt帰属の唯一の基準になる（Decision 7.4/9.3）。
 * - 稼働中TODOの重複dispatchはtyped rejectする。timeoutはfailureでなくunknownとして
 *   扱い、同一handleの回収だけを許す（Decision 9.4）。
 * - engineはevent配列を唯一のstate sourceにし、可変summaryを持たない（Decision 3.3）。
 */

const ENGINE_ACTOR = 'lattice-runtime';
/**
 * workerへ配る禁止操作。
 *
 * `commit`は含めない。自分の隔離worktreeでdetached HEADへ進めるcommitは、canonical branchを
 * 動かさず外部へ効果を出さない一方で、進行中の成果を耐久化し、diff観測が生み出した木そのものを
 * 縛れるようにする（ADR 0139）。
 *
 * 禁止のままにするのは、HEADをbaseの子孫から外す操作と、外部へ効果を出す操作である。
 * 前者は観測の前提を壊し、後者は承認なしに行わないという公開契約に当たる。
 */
const FORBIDDEN_OPERATIONS = Object.freeze([
  'push', 'branch', 'merge', 'rebase', 'reset', 'stash',
]);

function fail(reason) {
  throw new TypeError(`runtime engine契約違反: ${reason}`);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requireTimestamp(value) {
  if (!isCanonicalUtcTimestamp(value)) {
    fail(`recordedAtがcanonical UTC timestampではない: ${String(value)}`);
  }
  return value;
}

function sortedText(values) {
  return [...values].sort();
}

/**
 * 直前event prefixへchainされた新しいrun eventを構築する（append専用）。
 */
export function buildNextRunEvent(options = {}) {
  if (!exactRecord(options, ['events', 'runId', 'kind', 'planEpoch', 'subject', 'payload', 'recordedAt'])) {
    fail('buildNextRunEvent optionsがexact shapeでない');
  }
  const { events, runId, kind, planEpoch, subject, payload, recordedAt } = options;
  if (!Array.isArray(events)) fail('eventsがarrayではない');
  if (!RUN_EVENT_KINDS.includes(kind)) fail(`未知のevent kind: ${String(kind)}`);
  const previous = events.length === 0 ? null : events[events.length - 1];
  // genesisはrun_initializedだけを許し、追記先prefixのrun同一性と末尾eventの
  // 自己digest整合を検査する（別runへの追記・改竄済みprefixへの追記を塞ぐ）。
  if (previous === null) {
    if (kind !== 'run_initialized') fail(`genesis eventはrun_initializedでなければならない: ${kind}`);
  } else {
    if (previous.run_id !== runId) fail(`別runのprefixへ追記できない: ${String(previous.run_id)}`);
    if (previous.event_digest !== digestRunEvent(previous)) {
      fail('prefix末尾eventのdigestが自己整合しない（改竄または破損）');
    }
  }
  const event = {
    schema: 'lattice.run_event.v1',
    run_id: runId,
    sequence: previous === null ? 0 : previous.sequence + 1,
    previous_digest: previous === null ? null : previous.event_digest,
    kind,
    actor: ENGINE_ACTOR,
    plan_epoch: planEpoch,
    subject: structuredClone(subject),
    payload: structuredClone(payload),
    recorded_at: requireTimestamp(recordedAt),
  };
  event.event_digest = digestRunEvent(event);
  if (!validateRunEvent(event)) fail(`生成eventがrun_event.v1 contractを満たさない: ${kind}`);
  return event;
}

/**
 * run genesis: run_initialized＋plan_compiledのevent prefixを作る。
 */
export function initializeRunEvents(options = {}) {
  if (!exactRecord(options, ['runId', 'request', 'plan', 'manifests', 'recordedAt'])) {
    fail('initializeRunEvents optionsがexact shapeでない');
  }
  const { runId, request, plan, manifests, recordedAt } = options;
  if (!validateRuntimePlan(plan)) fail('planがruntime_plan.v1 contractを満たさない');
  if (!verifyRuntimePlanBinding({ plan, request })) fail('planがrequestへbindできない');
  const events = [];
  events.push(buildNextRunEvent({
    events,
    runId,
    kind: 'run_initialized',
    planEpoch: 0,
    subject: { kind: 'run_request', ref: 'request.json' },
    payload: { request_digest: request.request_digest },
    recordedAt,
  }));
  events.push(buildNextRunEvent({
    events,
    runId,
    kind: 'plan_compiled',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'runtime_plan', ref: plan.plan_ref },
    payload: {
      plan_digest: plan.plan_digest,
      manifest_digests: { ...plan.manifest_digests },
      manifests_digest: digestArtifact(manifests),
    },
    recordedAt,
  }));
  return events;
}

/**
 * boundary manifestからexecutor_packet.v1を構築する（Decision 9.3）。
 */
export function buildExecutorPackets(options = {}) {
  if (!exactRecord(options, ['plan', 'manifests'])) {
    fail('buildExecutorPackets optionsがexact shapeでない');
  }
  const { plan, manifests } = options;
  if (!validateRuntimePlan(plan)) fail('planがruntime_plan.v1 contractを満たさない');
  const packets = {};
  for (const node of plan.nodes) {
    const manifest = manifests[node.todo_id];
    if (!plainRecord(manifest) || manifest.manifest_digest !== plan.manifest_digests[node.todo_id]) {
      fail(`manifestがplanのdigestと一致しない: ${node.todo_id}`);
    }
    const content = {
      todo_id: node.todo_id,
      task_ref: `${plan.plan_ref}-task-${node.todo_id}`,
      scope: { writes: [...manifest.writes] },
      base_sha: plan.base_sha,
      verifier_refs: manifest.affected_tests.map((test) => `node --test ${test}`),
      forbidden_operations: [...FORBIDDEN_OPERATIONS],
    };
    const packet = {
      schema: 'lattice.executor_packet.v1',
      packet_id: `${plan.plan_ref}-packet-${node.todo_id}`,
      ...content,
      plan_ref: plan.plan_ref,
      plan_epoch: plan.plan_epoch,
      context_content_digest: computeContextContentDigest(content),
    };
    packet.packet_digest = selfDigest(packet, 'packet_digest');
    if (!validateExecutorPacket(packet)) fail(`生成packetがexecutor_packet.v1 contractを満たさない: ${node.todo_id}`);
    packets[node.todo_id] = packet;
  }
  return packets;
}

/**
 * engine側のready frontier選択（verifierと独立の実装）。
 * hard predecessor充足・running/held除外・conflict pairの同時実行回避・
 * 実capacityの空きだけを根拠に、辞書順の貪欲選択で決める。
 */
function selectDispatchable(plan, state, events) {
  if (state.freeze !== null || state.closed) return [];
  const accepted = new Set(state.accepted);
  const running = new Set(state.running);
  // dispatch済み・terminal済み・heldの除外は現plan epochへscopeする
  // （旧epoch分はcontext失効後にredispatch可能。RC3-G）。
  const held = new Set();
  const terminal = new Set();
  const dispatched = new Set();
  for (const event of events) {
    if (event.plan_epoch !== plan.plan_epoch) continue;
    if (event.kind === 'hold_decided') {
      for (const todoId of event.payload?.hold_set ?? []) held.add(todoId);
    }
    if (event.subject?.kind !== 'todo') continue;
    if (event.kind === 'executor_dispatched') dispatched.add(event.subject.ref);
    if (event.kind === 'executor_terminal') terminal.add(event.subject.ref);
  }
  const free = plan.capacity.executors - running.size;
  if (free < 1) return [];

  const chosen = [];
  for (const node of sortedText(plan.nodes.map((entry) => entry.todo_id))) {
    if (chosen.length >= free) break;
    if (accepted.has(node) || running.has(node) || held.has(node) || terminal.has(node)) continue;
    if (dispatched.has(node)) continue; // 同一epoch内の再dispatchを塞ぐ
    const predecessorsMet = plan.precedence.every((edge) => (
      edge.to_todo_id !== node || accepted.has(edge.from_todo_id)
    ));
    if (!predecessorsMet) continue;
    const conflictFree = plan.conflicts.every((conflict) => {
      if (!conflict.todo_ids.includes(node)) return true;
      return conflict.todo_ids.every((member) => (
        member === node || (!running.has(member) && !chosen.includes(member))
      ));
    });
    if (conflictFree) chosen.push(node);
  }
  return chosen;
}

/**
 * ready frontierを評価し、dispatch_decided eventと、選択TODOごとの
 * executor_dispatched eventを追記する。dispatchはadapterへ委ね、opaque handleだけを
 * event payloadへ保存する。返り値は追記後のevents（入力配列は変更しない）。
 */
export async function dispatchReadyFrontier(options = {}) {
  if (!exactRecord(options, ['runId', 'plan', 'events', 'packets', 'manifests', 'adapter', 'recordedAt'])) {
    fail('dispatchReadyFrontier optionsがexact shapeでない');
  }
  const { runId, plan, events, packets, manifests, adapter, recordedAt } = options;
  if (!validateRuntimePlan(plan)) fail('planがruntime_plan.v1 contractを満たさない');
  if (typeof adapter?.dispatch !== 'function') fail('adapterがdispatchを実装していない');

  const state = projectRuntimeState({ events });
  const dispatchable = selectDispatchable(plan, state, events);
  let next = [...events];
  next.push(buildNextRunEvent({
    events: next,
    runId,
    kind: 'dispatch_decided',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'runtime_plan', ref: plan.plan_ref },
    payload: {
      dispatchable: [...dispatchable],
      running: [...state.running],
      accepted: [...state.accepted],
      capacity: plan.capacity.executors,
    },
    recordedAt,
  }));

  const dispatchedNow = [];
  for (const todoId of dispatchable) {
    const packet = packets[todoId];
    if (!validateExecutorPacket(packet) || packet.todo_id !== todoId) {
      fail(`dispatchにはexecutor_packet.v1が必要: ${todoId}`);
    }
    // packetはactive planへ帰属しなければならない。自己整合しただけの
    // 別plan／別scope packetのdispatchを塞ぐ（review P1採用）。
    const manifest = manifests[todoId];
    if (packet.plan_ref !== plan.plan_ref
      || packet.plan_epoch !== plan.plan_epoch
      || packet.base_sha !== plan.base_sha
      || packet.packet_id !== `${plan.plan_ref}-packet-${todoId}`
      || packet.task_ref !== `${plan.plan_ref}-task-${todoId}`
      || !plainRecord(manifest)
      || manifest.manifest_digest !== plan.manifest_digests[todoId]
      || JSON.stringify(packet.scope.writes) !== JSON.stringify(manifest.writes)) {
      fail(`packetがactive planへ帰属しない: ${todoId}`);
    }
    // adapter失敗時も、成功済みdispatchの証拠を失わずtyped failureとして返す
    // （起動済みexecutorをevent store外へ孤立させない。review P1採用）。
    let dispatchResult;
    try {
      dispatchResult = await adapter.dispatch({ packet });
    } catch (error) {
      return {
        events: next,
        dispatched: dispatchedNow,
        failure: { todo_id: todoId, message: String(error?.message ?? error) },
      };
    }
    if (!plainRecord(dispatchResult)
      || typeof dispatchResult.executor_handle !== 'string'
      || dispatchResult.executor_handle.length === 0
      || typeof dispatchResult.worktree_id !== 'string'
      || dispatchResult.worktree_id.length === 0) {
      fail(`adapter dispatchがopaque handle／worktreeを返さない: ${todoId}`);
    }
    const dispatchPayload = {
      executor_handle: dispatchResult.executor_handle,
      worktree_id: dispatchResult.worktree_id,
      packet_digest: packet.packet_digest,
      context_content_digest: packet.context_content_digest,
    };
    const managedFields = [
      'write_lease_id',
      'write_lease_digest',
      'controller_registration_digest',
      'controller_session_nonce_digest',
      'direct_os_observation_binding',
    ];
    if (managedFields.some((field) => Object.hasOwn(dispatchResult, field))) {
      if (!managedFields.every((field) => Object.hasOwn(dispatchResult, field))) {
        fail(`managed adapter dispatch bindingが不足する: ${todoId}`);
      }
      Object.assign(dispatchPayload, Object.fromEntries(
        managedFields.map((field) => [field, structuredClone(dispatchResult[field])]),
      ));
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'executor_dispatched',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: dispatchPayload,
      recordedAt,
    }));
    dispatchedNow.push(todoId);
  }
  return { events: next, dispatched: dispatchedNow, failure: null };
}

/**
 * 稼働executorをadapter経由で観測し、checkpoint／terminalをeventへ写す。
 * timeout（unknown）はfailureへ丸めず、eventを追加しない（同一handleでの再観測だけを許す）。
 */
export async function observeExecutor(options = {}) {
  if (!exactRecord(options, ['runId', 'plan', 'events', 'adapter', 'todoId', 'recordedAt'])) {
    fail('observeExecutor optionsがexact shapeでない');
  }
  const { runId, plan, events, adapter, todoId, recordedAt } = options;
  if (typeof adapter?.observe !== 'function') fail('adapterがobserveを実装していない');
  const state = projectRuntimeState({ events });
  const dispatch = state.dispatches[todoId];
  if (dispatch === undefined) fail(`未dispatchのTODOを観測できない: ${todoId}`);
  // terminal報告済みexecutorの再観測は二重receipt（同一receipt再送での二重受理）
  // の入口になるためfail closed（review P1採用）。guardは現plan epochへscopeする
  // （旧epochでcontext_invalidated終端されたTODOのredispatch後観測を塞がない）。
  const terminalInEpoch = events.some((event) => (
    event.kind === 'executor_terminal'
    && event.plan_epoch === plan.plan_epoch
    && event.subject?.kind === 'todo'
    && event.subject.ref === todoId
  ));
  if (terminalInEpoch) fail(`terminal報告済みTODOを再観測できない: ${todoId}`);

  const observation = await adapter.observe({ executor_handle: dispatch.payload.executor_handle });
  if (!plainRecord(observation) || typeof observation.state !== 'string') {
    fail(`adapter observationが不正: ${todoId}`);
  }

  let next = [...events];
  if (observation.state === 'unknown') {
    return { events: next, observation: { state: 'unknown' } };
  }
  if (observation.state === 'checkpoint_ready') {
    if (!plainRecord(observation.checkpoint)
      || typeof observation.checkpoint.checkpoint_digest !== 'string'
      || !/^[0-9a-f]{64}$/.test(observation.checkpoint.checkpoint_digest)) {
      fail(`checkpoint payloadにはcheckpoint_digestが必要: ${todoId}`);
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'checkpoint_observed',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: structuredClone(observation.checkpoint),
      recordedAt,
    }));
    return { events: next, observation: { state: 'checkpoint_ready' } };
  }
  if (observation.state === 'terminal') {
    if (!validateExecutorReceipt(observation.receipt)) {
      fail(`terminal receiptがexecutor_receipt.v1 contractを満たさない: ${todoId}`);
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'receipt_recorded',
      planEpoch: observation.receipt.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: structuredClone(observation.receipt),
      recordedAt,
    }));
    // cleanup失敗は成功へ丸めず、残存pathと回収条件をterminal eventへ保存する
    // （plan RC3-F）。cleanup情報のないadapterは省略可。
    const terminalPayload = {
      executor_handle: dispatch.payload.executor_handle,
      terminal_state: 'reported',
    };
    if (plainRecord(observation.cleanup)) {
      terminalPayload.cleanup = structuredClone(observation.cleanup);
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'executor_terminal',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: terminalPayload,
      recordedAt,
    }));
    return { events: next, observation: { state: 'terminal' } };
  }
  if (observation.state === 'hold_requested') {
    // executorからの競合通報はconflict_found eventとして保存し、直後にevent intakeを
    // freezeする（競合発見時にdispatchを続けるfail-open経路を塞ぐ。review P1採用）。
    // affected closure計算とhold裁定・resumeはRC3-Gのhold契約が所有する。
    if (!plainRecord(observation.finding)
      || typeof observation.finding.kind !== 'string'
      || observation.finding.kind.length === 0) {
      fail(`hold requestにはfinding payloadが必要: ${todoId}`);
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'conflict_found',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: {
        ...structuredClone(observation.finding),
        reported_by: dispatch.payload.executor_handle,
      },
      recordedAt,
    }));
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'intake_frozen',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'runtime_plan', ref: plan.plan_ref },
      payload: {
        frozen_prefix_digest: digestArtifact(next.map((event) => event.event_digest)),
        reason_kind: observation.finding.kind,
      },
      recordedAt,
    }));
    return { events: next, observation: { state: 'hold_requested' } };
  }
  if (observation.state === 'running') {
    return { events: next, observation: { state: 'running' } };
  }
  fail(`未知のadapter observation state: ${observation.state}`);
  return null;
}

/**
 * engine側のreceipt裁定（verifierと独立の実装。Decision 7.4の帰属規則）。
 * 帰属の基準はdispatch記録（handle・worktree・packet digest）であり、
 * executor自己申告を信用しない。裁定はreceipt_accepted／receipt_rejected eventへ保存する。
 */
/**
 * 直近のcheckpoint観測をdeclared scope／他running TODOへcross-bindし、
 * findingがあればconflict_found＋intake_frozenを追記する（RC3-F検出、裁定はRC3-G）。
 */
export function classifyCheckpointObservation(options = {}) {
  if (!exactRecord(options, ['runId', 'plan', 'events', 'packets', 'todoId', 'detect', 'recordedAt'])) {
    fail('classifyCheckpointObservation optionsがexact shapeでない');
  }
  const { runId, plan, events, packets, todoId, detect, recordedAt } = options;
  if (typeof detect !== 'function') fail('detect関数が必要');
  const state = projectRuntimeState({ events });
  const checkpoints = state.checkpoints.filter((entry) => entry.todo_id === todoId);
  if (checkpoints.length === 0) fail(`checkpoint未観測のTODOを分類できない: ${todoId}`);
  const checkpoint = checkpoints[checkpoints.length - 1].payload;
  const { findings: detectedFindings } = detect({
    todoId,
    checkpoint,
    packets,
    runningTodoIds: state.running,
  });
  if (!Array.isArray(detectedFindings)) fail('detectがfindings配列を返さない');
  const observations = detectedFindings
    .filter((finding) => finding.kind === 'undeclared_write' && finding.todo_ids?.length === 1)
    .map((finding) => ({ ...finding, kind: 'prediction_excess' }));
  const findings = detectedFindings.filter((finding) => !(
    finding.kind === 'undeclared_write' && finding.todo_ids?.length === 1
  ));
  // 再分類のidempotence: 既に保存済みのfinding（kind＋todo_ids＋path）は再記録しない。
  const recordedKeys = new Set(state.conflicts.map((conflict) => (
    `${conflict.kind}|${[...(conflict.todo_ids ?? [])].sort().join(',')}|${conflict.path ?? ''}`
  )));
  const freshFindings = findings.filter((finding) => !recordedKeys.has(
    `${finding.kind}|${[...(finding.todo_ids ?? [])].sort().join(',')}|${finding.path ?? ''}`,
  ));
  let next = [...events];
  for (const finding of freshFindings) {
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'conflict_found',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: structuredClone(finding),
      recordedAt,
    }));
  }
  if (freshFindings.length > 0 && state.freeze === null) {
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'intake_frozen',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'runtime_plan', ref: plan.plan_ref },
      payload: {
        frozen_prefix_digest: digestArtifact(next.map((event) => event.event_digest)),
        reason_kind: findings[0].kind,
      },
      recordedAt,
    }));
  }
  return { events: next, findings: freshFindings, observations };
}

const RECEIPT_BINDING_FIELDS = Object.freeze([
  'executor_handle',
  'worktree_id',
  'base_sha',
  'packet_digest',
  'checkpoint_digest',
]);

function witnessProvenReceiptBinding(state, receipt) {
  const witnessRecord = state.witnesses[receipt.todo_id];
  const witness = witnessRecord?.payload?.witness;
  if (witness === null || witness === undefined) return false;
  if (witness.todo_id !== receipt.todo_id) return false;
  if (typeof witnessRecord.payload.witness_digest !== 'string'
    || witnessRecord.payload.witness_digest !== witness.witness_digest
    || witness.witness_digest !== selfDigest(witness, 'witness_digest')) {
    return false;
  }
  return Array.isArray(witness.receipt_bindings) && witness.receipt_bindings.some((binding) => (
    binding.receipt_id === receipt.receipt_id
    && binding.recorded_sequence === receipt.sequence
    && binding.within_frozen_prefix === true
  ));
}

export function adjudicatePendingReceipts(options = {}) {
  if (!exactRecord(options, ['runId', 'plan', 'events', 'recordedAt'])) {
    fail('adjudicatePendingReceipts optionsがexact shapeでない');
  }
  const { runId, plan, events, recordedAt } = options;
  if (!validateRuntimePlan(plan)) fail('planがruntime_plan.v1 contractを満たさない');
  const state = projectRuntimeState({ events });
  // freezeはresumeで消えない永続境界（Decision 7.4のstale判定基準は最初のfreeze）。
  // 境界は現plan epochで発生したfreezeへscopeする（vN+1 receiptをvNのfreezeで
  // 塞がない。verifierと同一規則）。
  const freezes = events
    .filter((event) => event.kind === 'intake_frozen' && event.plan_epoch === plan.plan_epoch)
    .map((event) => event.sequence)
    .sort((left, right) => left - right);
  const freezeBoundary = freezes.length === 0 ? null : freezes[0];
  const seenReceiptIds = new Set();
  for (const receipt of state.receipts) {
    if (receipt.accepted_sequence !== null || receipt.rejected_sequence !== null) {
      seenReceiptIds.add(receipt.receipt_id);
    }
  }

  let next = [...events];
  const decisions = [];
  for (const receipt of state.receipts) {
    if (receipt.accepted_sequence !== null || receipt.rejected_sequence !== null) continue;
    const payload = receipt.payload ?? {};
    const dispatch = state.dispatches[receipt.todo_id];
    let rejection = null;
    if (seenReceiptIds.has(receipt.receipt_id)) {
      rejection = 'duplicate_receipt_id';
    } else if (RECEIPT_BINDING_FIELDS.some((field) => typeof payload[field] !== 'string')) {
      rejection = 'binding_missing';
    } else if (dispatch === undefined) {
      rejection = 'not_dispatched';
    } else if (payload.executor_handle !== dispatch.payload.executor_handle
      || payload.worktree_id !== dispatch.payload.worktree_id
      || payload.packet_digest !== dispatch.payload.packet_digest) {
      rejection = 'binding_mismatch';
    } else if (payload.base_sha !== plan.base_sha) {
      rejection = 'base_mismatch';
    } else if (receipt.plan_epoch !== plan.plan_epoch) {
      rejection = 'epoch_mismatch';
    } else if ((() => {
      // dispatchが旧epochのTODOが現epochのreceiptを名乗る場合、epoch_rebound
      // event（rebindのsequenceがreceiptより前、new_plan_epoch一致）を必須にする。
      // rebindなしのepoch自称は旧contextの偽装であり受理しない（Decision 7.3/7.4）。
      const dispatchEvent = events.find((event) => (
        event.kind === 'executor_dispatched'
        && event.subject?.kind === 'todo'
        && event.subject.ref === receipt.todo_id
        && event.sequence === dispatch.sequence
      ));
      if (dispatchEvent === undefined || dispatchEvent.plan_epoch === plan.plan_epoch) return false;
      const rebound = state.rebinds[receipt.todo_id];
      return rebound === undefined
        || rebound.payload?.new_plan_epoch !== plan.plan_epoch
        || rebound.sequence >= receipt.sequence;
    })()) {
      rejection = 'unrebound_epoch';
    } else if ((() => {
      // receipt以前の最後の観測checkpointへのbindを要求（digestとobserved_diff。
      // executor自己申告をbinding証拠にしない。RC3-F）。bindingは同一dispatch
      // attemptへscopeする＝最後のdispatch以降のcheckpointだけが対象
      // （redispatch後のreceiptを旧attemptのcheckpointで塞がない。RC3-G）。
      const attemptStart = dispatch.sequence;
      const observedCheckpoints = state.checkpoints.filter((entry) => (
        entry.todo_id === receipt.todo_id
        && entry.sequence > attemptStart
        && entry.sequence < receipt.sequence
        // supervisorが自分の判断で撮ったcheckpoint（I/O警報のprobe）は、executorの
        // 申告境界ではない。走行中の任意の一点なので、その後も書き続けたexecutorの
        // receiptと一致しないのが正常である。ここへ混ぜると、正当なreceiptが
        // checkpoint_mismatchで落ちる。証拠としては残り、findingの導出には使われる。
        && entry.payload?.observed_by !== 'supervisor_probe'
      ));
      if (observedCheckpoints.length === 0) return false;
      const last = observedCheckpoints[observedCheckpoints.length - 1].payload;
      if (typeof last?.checkpoint_digest === 'string'
        && payload.checkpoint_digest !== last.checkpoint_digest) {
        return true;
      }
      if (last?.diff?.entries !== undefined && Array.isArray(last.diff.entries)) {
        const expected = JSON.stringify(last.diff.entries.map(({ path: p, change }) => ({ path: p, change })));
        const reported = JSON.stringify((payload.observed_diff ?? []).map(({ path: p, change }) => ({ path: p, change })));
        if (expected !== reported) return true;
      }
      return false;
    })()) {
      rejection = 'checkpoint_mismatch';
    } else if (freezeBoundary !== null) {
      // freeze境界を跨いだreceiptはstale（Decision 7.4）。frozen prefix内のreceiptは
      // 実証済みcarry-over witnessのbindingがある場合だけ受理（Decision 7.5）。
      if (receipt.sequence > freezeBoundary) {
        rejection = 'post_freeze';
      } else if (!witnessProvenReceiptBinding(state, receipt)) {
        rejection = 'witness_unproven';
      }
    }
    seenReceiptIds.add(receipt.receipt_id);
    if (rejection === null) {
      next.push(buildNextRunEvent({
        events: next,
        runId,
        kind: 'receipt_accepted',
        planEpoch: plan.plan_epoch,
        subject: { kind: 'todo', ref: receipt.todo_id },
        payload: { receipt_id: receipt.receipt_id, checkpoint_digest: payload.checkpoint_digest ?? null },
        recordedAt,
      }));
      decisions.push({ receipt_id: receipt.receipt_id, decision: 'accepted' });
    } else {
      next.push(buildNextRunEvent({
        events: next,
        runId,
        kind: 'receipt_rejected',
        planEpoch: plan.plan_epoch,
        subject: { kind: 'todo', ref: receipt.todo_id },
        payload: { receipt_id: receipt.receipt_id, reason: 'stale_context', detail: rejection },
        recordedAt,
      }));
      decisions.push({ receipt_id: receipt.receipt_id, decision: 'rejected', detail: rejection });
    }
  }
  return { events: next, decisions };
}

/**
 * 全TODO terminalかつpending receipt 0の時だけrun_closedを追記する。
 */
export function closeRunIfComplete(options = {}) {
  if (!exactRecord(options, ['runId', 'plan', 'events', 'recordedAt'])) {
    fail('closeRunIfComplete optionsがexact shapeでない');
  }
  const { runId, plan, events, recordedAt } = options;
  const state = projectRuntimeState({ events });
  const nodeIds = plan.nodes.map((node) => node.todo_id);
  const done = nodeIds.every((todoId) => state.accepted.includes(todoId));
  const pending = state.receipts.some((receipt) => (
    receipt.accepted_sequence === null && receipt.rejected_sequence === null
  ));
  if (!done || pending || state.closed) return { events, closed: state.closed };
  const next = [...events];
  next.push(buildNextRunEvent({
    events: next,
    runId,
    kind: 'run_closed',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'runtime_plan', ref: plan.plan_ref },
    payload: { accepted: sortedText(state.accepted) },
    recordedAt,
  }));
  return { events: next, closed: true };
}
