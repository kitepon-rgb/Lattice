import { digestArtifact } from './artifact-contracts.mjs';
import { buildNextRunEvent, buildExecutorPackets } from './runtime-engine.mjs';
import { projectRuntimeState } from './runtime-projection.mjs';
import {
  recomputeHoldDecision,
  verifyCarryOverWitness,
} from './runtime-decision-verifier.mjs';
import {
  computeContextContentDigest,
  selfDigest,
  validateCarryOverWitness,
  validateEpochRebindPacket,
  validateHoldDecision,
  validateRunRequest,
  validateRuntimePlan,
  validateRuntimePlanDiff,
  verifyRuntimePlanBinding,
} from './runtime-contracts.mjs';

/**
 * RC3-G 後発競合のselective holdとplan vN+1 recompile（ADR 0044 Decision 6・7、plan RC3-G）。
 *
 * producer側の裁定実装。affected closure・hold／continue集合は
 * `runtime-decision-verifier.mjs`と独立に計算した上で、保存bytesからの
 * verifier再計算とのexact一致をfail-loudに自己検査する（divergenceは即例外）。
 *
 * - 競合発見時はactive planへ追記しない。frozen prefixを固定してclosureを計算し、
 *   closure外のin-flight TODOはcarry-over witnessを実証できた場合だけ継続する。
 *   1 fieldでも証明不能ならholdへ戻す（fail closed、silent fallbackなし）。
 * - carry-overは旧contextの継続利用ではない。content digest不変・epochだけ更新の
 *   epoch rebind packetによる、失効後の再認可である（Decision 7.3）。
 * - 旧plan・旧context・partial patchはcontext_invalidated eventで失効し、
 *   redispatch TODOへは新plan_ref由来の別contentのpacketを発行する。
 * - irreducible conflictはprecedenceへ偽装せず、unordered conflictのまま
 *   intentional serialとして保持する（Decision 7.6）。
 */

function fail(reason) {
  throw new TypeError(`hold/recompile契約違反: ${reason}`);
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

function sorted(values) {
  return [...values].sort();
}

function sha16(value) {
  return digestArtifact({ path: value }).slice(0, 16);
}

const WITNESS_KINDS = Object.freeze(['state', 'schema', 'invariant', 'effect', 'external_effect']);

function manifestResourceIds(manifest) {
  const ids = new Set(manifest?.resources ?? []);
  for (const effect of manifest?.state_effects ?? []) {
    if (WITNESS_KINDS.includes(effect.kind) && typeof effect.resource_id === 'string') {
      ids.add(effect.resource_id);
    }
  }
  return ids;
}

/** producer独自のaffected closure計算（conflict edge伝播＋共有resource witness到達）。 */
function computeAffectedClosure(plan, manifests, seedTodoIds) {
  const closure = new Set(seedTodoIds);
  const byResource = new Map();
  for (const [todoId, manifest] of Object.entries(manifests)) {
    for (const resourceId of manifestResourceIds(manifest)) {
      const members = byResource.get(resourceId) ?? new Set();
      members.add(todoId);
      byResource.set(resourceId, members);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const conflict of plan.conflicts) {
      const [left, right] = conflict.todo_ids;
      if (closure.has(left) !== closure.has(right)) {
        closure.add(left);
        closure.add(right);
        changed = true;
      }
    }
    // hard predecessorの下流はaffected（前提が失効するため。Decision 6.3）。
    for (const edge of plan.precedence) {
      if (closure.has(edge.from_todo_id) && !closure.has(edge.to_todo_id)) {
        closure.add(edge.to_todo_id);
        changed = true;
      }
    }
    for (const todoId of [...closure]) {
      const manifest = manifests[todoId];
      if (manifest === undefined) continue;
      for (const resourceId of manifestResourceIds(manifest)) {
        for (const member of byResource.get(resourceId) ?? []) {
          if (!closure.has(member)) {
            closure.add(member);
            changed = true;
          }
        }
      }
    }
  }
  return closure;
}

/**
 * carry-over witness documentを構築し、提供sourcesに対して自己実証する。
 * 実証できない場合はnullでなくreasons付きの失敗を返す（呼び出し側がholdへ戻す）。
 */
export function buildCarryOverWitness(options = {}) {
  if (!exactRecord(options, [
    'todoId', 'predecessorEpoch', 'successorEpoch', 'sources', 'nonOverlapEvidence', 'receiptBindings',
  ])) {
    fail('buildCarryOverWitness optionsがexact shapeでない');
  }
  const { todoId, predecessorEpoch, successorEpoch, sources, nonOverlapEvidence, receiptBindings } = options;
  const witness = {
    schema: 'lattice.carry_over_witness.v1',
    witness_id: `witness-${todoId}-e${successorEpoch}`,
    todo_id: todoId,
    predecessor_epoch: predecessorEpoch,
    successor_epoch: successorEpoch,
    invariant_digests: {
      todo_input: digestArtifact(sources.todo_input),
      boundary_manifest: digestArtifact(sources.boundary_manifest),
      validator: digestArtifact(sources.validator),
      context_content: digestArtifact(sources.context_content),
    },
    non_overlap_evidence: [...nonOverlapEvidence],
    receipt_bindings: structuredClone(receiptBindings),
  };
  witness.witness_digest = selfDigest(witness, 'witness_digest');
  // 構築不能はthrowでなくtyped失敗で返す（呼び出し側がholdへ戻すため）。
  if (!validateCarryOverWitness(witness)) {
    return { witness: null, reasons: ['witness_schema', 'carry_over_unprovable'] };
  }
  const verified = verifyCarryOverWitness({ witness, sources });
  if (!verified.valid) {
    return { witness: null, reasons: verified.reasons };
  }
  return { witness, reasons: [] };
}

/**
 * frozen prefixからhold decisionを裁定し、carry_over_witnessed／hold_decided eventを
 * 追記する。continueできるのはwitnessを実証済みのclosure外running TODOだけで、
 * 証明不能TODOはholdへ戻す。裁定はverifier再計算とのexact一致を自己検査する。
 */
export function decideHoldAndCarryOver(options = {}) {
  if (!exactRecord(options, [
    'runId', 'request', 'plan', 'manifests', 'packets', 'events', 'recordedAt',
  ])) {
    fail('decideHoldAndCarryOver optionsがexact shapeでない');
  }
  const { runId, request, plan, manifests, packets, events, recordedAt } = options;
  if (!validateRuntimePlan(plan)) fail('planがruntime_plan.v1 contractを満たさない');
  if (!validateRunRequest(request)) fail('requestがrun_request.v1 contractを満たさない');

  const state = projectRuntimeState({ events });
  if (state.freeze === null) fail('freezeされていないprefixからholdを裁定できない');
  const freezeSequence = state.freeze.sequence;
  // seedは現plan epochのconflictだけにする（過去epochで処理済みのconflictを
  // 再seedしない。二度目以降のfreezeでの再混入防止）。
  const currentEpochConflictSequences = new Set(events
    .filter((event) => event.kind === 'conflict_found' && event.plan_epoch === plan.plan_epoch)
    .map((event) => event.sequence));
  const frozenConflicts = state.conflicts.filter((conflict) => (
    conflict.sequence <= freezeSequence && currentEpochConflictSequences.has(conflict.sequence)
  ));
  if (frozenConflicts.length === 0) fail('frozen prefix内にconflict findingがない');

  const seed = frozenConflicts.flatMap((conflict) => conflict.todo_ids ?? []);
  const closure = computeAffectedClosure(plan, manifests, seed);

  // frozen prefix時点のrunning集合（producer独自計算）。
  const frozenRunning = new Set();
  for (const event of events) {
    if (event.sequence > freezeSequence) continue;
    if (event.kind === 'executor_dispatched' && event.subject?.kind === 'todo') {
      frozenRunning.add(event.subject.ref);
    }
    if ((event.kind === 'receipt_accepted' || event.kind === 'executor_terminal')
      && event.subject?.kind === 'todo') {
      frozenRunning.delete(event.subject.ref);
    }
  }

  const conflictEventDigests = events
    .filter((event) => event.kind === 'conflict_found' && event.sequence <= freezeSequence)
    .map((event) => event.event_digest);

  let next = [...events];
  const holdSet = new Set();
  const continueSet = new Set();
  const witnessFailures = {};

  // 競合findingが指すpath集合（carry-over候補の非交差検査に使う）。
  const findingPaths = new Set(frozenConflicts.flatMap((conflict) => (
    typeof conflict.path === 'string' ? [conflict.path] : (conflict.paths ?? [])
  )));

  for (const todoId of sorted(frozenRunning)) {
    if (closure.has(todoId)) {
      holdSet.add(todoId);
      continue;
    }
    // closure外のin-flight TODO: witnessを構築・実証できた場合だけcontinue。
    const packet = packets[todoId];
    if (packet === undefined || manifests[todoId] === undefined) {
      holdSet.add(todoId);
      witnessFailures[todoId] = ['missing_packet_or_manifest'];
      continue;
    }
    // freeze後に当該TODOの未取り込みdiff／receipt eventが存在するなら
    // carry-over不能（Decision 7.2「freeze後に未取り込みdiff eventが存在しない」）。
    const postFreezeEvents = events.some((event) => (
      event.sequence > freezeSequence
      && event.subject?.kind === 'todo'
      && event.subject.ref === todoId
      && ['checkpoint_observed', 'receipt_recorded'].includes(event.kind)
    ));
    if (postFreezeEvents) {
      holdSet.add(todoId);
      witnessFailures[todoId] = ['post_freeze_events'];
      continue;
    }
    // 競合finding pathと当該TODOのdeclared write／観測pathが交差するなら
    // 非交差を証明できない（Decision 7.2の changed scope 非交差条件）。
    const declaredWrites = manifests[todoId].writes ?? [];
    const observedPaths = state.checkpoints
      .filter((entry) => entry.todo_id === todoId && entry.sequence <= freezeSequence)
      .flatMap((entry) => (entry.payload?.diff?.entries ?? []).map(({ path }) => path));
    const intersects = [...findingPaths].some((findingPath) => (
      declaredWrites.some((declared) => (
        declared === findingPath || (declared.endsWith('/') && findingPath.startsWith(declared))
      ))
      || observedPaths.includes(findingPath)
    ));
    if (intersects) {
      holdSet.add(todoId);
      witnessFailures[todoId] = ['finding_scope_overlap'];
      continue;
    }
    const receiptBindings = state.receipts
      .filter((receipt) => (
        receipt.todo_id === todoId
        && receipt.sequence <= freezeSequence
        && receipt.accepted_sequence === null
        && receipt.rejected_sequence === null
      ))
      .map((receipt) => ({
        receipt_id: receipt.receipt_id,
        checkpoint_digest: receipt.payload?.checkpoint_digest ?? '0'.repeat(64),
        recorded_sequence: receipt.sequence,
        within_frozen_prefix: true,
      }));
    const sources = {
      todo_input: request.manual_witness[todoId],
      boundary_manifest: manifests[todoId],
      validator: packet.verifier_refs,
      context_content: {
        todo_id: packet.todo_id,
        task_ref: packet.task_ref,
        scope: packet.scope,
        base_sha: packet.base_sha,
        verifier_refs: packet.verifier_refs,
        forbidden_operations: packet.forbidden_operations,
      },
    };
    const built = buildCarryOverWitness({
      todoId,
      predecessorEpoch: plan.plan_epoch,
      successorEpoch: plan.plan_epoch + 1,
      sources,
      nonOverlapEvidence: conflictEventDigests.map((digest) => `conflict_found#${digest.slice(0, 16)}`),
      receiptBindings,
    });
    if (built.witness === null) {
      holdSet.add(todoId);
      witnessFailures[todoId] = built.reasons;
      continue;
    }
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'carry_over_witnessed',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: { witness_digest: built.witness.witness_digest, witness: built.witness },
      recordedAt,
    }));
    continueSet.add(todoId);
  }
  for (const todoId of closure) {
    if (!continueSet.has(todoId)) holdSet.add(todoId);
  }

  const holdDecision = {
    schema: 'lattice.hold_decision.v1',
    decision_id: `hold-${runId}-seq${freezeSequence}`,
    finding: structuredClone(frozenConflicts.at(-1)),
    frozen_prefix_digest: state.freeze.frozen_prefix_digest ?? digestArtifact(
      events.filter((event) => event.sequence <= freezeSequence).map((event) => event.event_digest),
    ),
    affected_closure: sorted(closure),
    hold_set: sorted(holdSet),
    continue_set: sorted(continueSet),
    evidence_digests: conflictEventDigests,
  };
  holdDecision.decision_digest = selfDigest(holdDecision, 'decision_digest');
  if (!validateHoldDecision(holdDecision)) fail('hold decisionがcontractを満たさない');

  next.push(buildNextRunEvent({
    events: next,
    runId,
    kind: 'hold_decided',
    planEpoch: plan.plan_epoch,
    subject: { kind: 'runtime_plan', ref: plan.plan_ref },
    payload: structuredClone(holdDecision),
    recordedAt,
  }));

  // 独立verifierとのexact一致を自己検査する（divergenceはfail loud）。
  const recomputed = recomputeHoldDecision({ plan, events: next, manifests });
  if (JSON.stringify(recomputed.hold_set) !== JSON.stringify(holdDecision.hold_set)
    || JSON.stringify(recomputed.continue_set) !== JSON.stringify(holdDecision.continue_set)) {
    fail(`hold裁定がverifier再計算と一致しない: producer=${JSON.stringify({
      hold: holdDecision.hold_set, continue: holdDecision.continue_set,
    })} verifier=${JSON.stringify({ hold: recomputed.hold_set, continue: recomputed.continue_set })}`);
  }

  return { events: next, holdDecision, witnessFailures };
}

/**
 * 競合findingをtreatment laneへ送る（Decision 7.6）。
 * predeclared treatmentがfindingのpath集合を覆う場合だけseam laneを返し、
 * それ以外（shared state/effect・未宣言path競合）はintentional serialにする。
 */
export function routeConflictTreatment(options = {}) {
  if (!exactRecord(options, ['finding', 'predeclaredTreatments'])) {
    fail('routeConflictTreatment optionsがexact shapeでない');
  }
  const { finding, predeclaredTreatments } = options;
  if (!plainRecord(finding) || typeof finding.kind !== 'string') fail('findingが不正');
  if (finding.kind === 'observed_write_conflict' && typeof finding.path === 'string') {
    for (const treatment of predeclaredTreatments) {
      if (Array.isArray(treatment.covered_paths) && treatment.covered_paths.includes(finding.path)) {
        return { lane: 'seam_transform', treatment: structuredClone(treatment) };
      }
    }
  }
  return { lane: 'intentional_serial', treatment: null };
}

/**
 * hold決定後のplan vN+1をcompileする。carried-over TODOへはepoch rebind packet
 * （content不変・epoch/plan refのみ更新）、hold TODOへは新plan_ref由来の
 * 新context packetを発行し、旧contextを失効してintakeを再開する。
 */
export function recompileNextEpochPlan(options = {}) {
  if (!exactRecord(options, [
    'runId', 'request', 'plan', 'manifests', 'packets', 'events', 'holdDecision',
    'additionalConflicts', 'recordedAt',
  ])) {
    fail('recompileNextEpochPlan optionsがexact shapeでない');
  }
  const {
    runId, request, plan, manifests, packets, events, holdDecision, additionalConflicts, recordedAt,
  } = options;
  if (!validateRuntimePlan(plan)) fail('planがruntime_plan.v1 contractを満たさない');
  if (!validateHoldDecision(holdDecision)) fail('holdDecisionがcontractを満たさない');
  if (!Array.isArray(additionalConflicts)) fail('additionalConflictsがarrayではない');

  const state = projectRuntimeState({ events });
  if (state.freeze === null) fail('freeze中でないprefixからrecompileできない');

  // 新planは追記でなく全体を再発行する（plan version barrier）。
  const conflictKeys = new Set(plan.conflicts.map((conflict) => (
    `${[...conflict.todo_ids].sort().join(',')}|${conflict.resource_id}`
  )));
  const mergedConflicts = [...plan.conflicts.map((conflict) => structuredClone(conflict))];
  for (const conflict of additionalConflicts) {
    if (!plainRecord(conflict) || !Array.isArray(conflict.todo_ids) || typeof conflict.resource_id !== 'string') {
      fail('additional conflictが不正');
    }
    const key = `${[...conflict.todo_ids].sort().join(',')}|${conflict.resource_id}`;
    if (conflictKeys.has(key)) continue;
    conflictKeys.add(key);
    mergedConflicts.push({ todo_ids: [...conflict.todo_ids].sort(), resource_id: conflict.resource_id });
  }
  mergedConflicts.sort((left, right) => (
    (left.todo_ids[0] < right.todo_ids[0] ? -1 : left.todo_ids[0] > right.todo_ids[0] ? 1 : 0)
    || (left.todo_ids[1] < right.todo_ids[1] ? -1 : left.todo_ids[1] > right.todo_ids[1] ? 1 : 0)
    || (left.resource_id < right.resource_id ? -1 : 1)
  ));

  const newEpoch = plan.plan_epoch + 1;
  const newPlanRef = `plan-${request.request_id}-e${newEpoch}`;
  const acceptedCheckpoints = state.receipts
    .filter((receipt) => receipt.accepted_sequence !== null)
    .map((receipt) => receipt.payload?.checkpoint_digest)
    .filter((digest) => typeof digest === 'string');

  const newPlan = {
    schema: 'lattice.runtime_plan.v1',
    plan_ref: newPlanRef,
    plan_epoch: newEpoch,
    request_digest: request.request_digest,
    base_sha: plan.base_sha,
    nodes: structuredClone(plan.nodes),
    precedence: structuredClone(plan.precedence),
    conflicts: mergedConflicts,
    capacity: structuredClone(plan.capacity),
    manifest_digests: structuredClone(plan.manifest_digests),
    claim: { mode: 'exact_minimum' },
    predecessor_refs: [plan.plan_ref, ...acceptedCheckpoints.map((digest) => `checkpoint:${digest}`)],
  };
  newPlan.plan_digest = selfDigest(newPlan, 'plan_digest');
  if (!validateRuntimePlan(newPlan)) fail('新planがruntime_plan.v1 contractを満たさない');
  if (!verifyRuntimePlanBinding({ plan: newPlan, request })) fail('新planがrequestへbindできない');

  let next = [...events];

  // hold集合のrunning executorを旧epochで終端する（放棄の証拠化。runningから
  // 外れることで、新epochでのredispatchが可能になる）。
  const runningSet = new Set(state.running);
  for (const todoId of holdDecision.hold_set) {
    if (!runningSet.has(todoId)) continue;
    const dispatch = state.dispatches[todoId];
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'executor_terminal',
      planEpoch: plan.plan_epoch,
      subject: { kind: 'todo', ref: todoId },
      payload: {
        executor_handle: dispatch?.payload?.executor_handle ?? 'unknown',
        terminal_state: 'context_invalidated',
      },
      recordedAt,
    }));
  }

  next.push(buildNextRunEvent({
    events: next,
    runId,
    kind: 'plan_recompiled',
    planEpoch: newEpoch,
    subject: { kind: 'runtime_plan', ref: newPlanRef },
    payload: {
      old_plan_ref: plan.plan_ref,
      new_plan_digest: newPlan.plan_digest,
      hold_decision_digest: holdDecision.decision_digest,
    },
    recordedAt,
  }));

  // 旧contextの全失効（Decision 7: 例外なく一斉失効。carried-overは失効後に
  // rebindで「内容同一性を証明した新epochへの再認可」を受ける）。
  for (const todoId of sorted([...holdDecision.hold_set, ...holdDecision.continue_set])) {
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'context_invalidated',
      planEpoch: newEpoch,
      subject: { kind: 'todo', ref: todoId },
      payload: {
        old_plan_ref: plan.plan_ref,
        invalidated: ['agent_context', 'partial_patch', 'interface_assumption', 'boundary_evidence'],
        reauthorized_via: holdDecision.continue_set.includes(todoId) ? 'epoch_rebind' : 'redispatch',
      },
      recordedAt,
    }));
  }

  // carried-over TODOがrecompileで追加されるconflictの当事者なら設計矛盾
  // （closureに入っているべき）。fail loudで止める。
  for (const conflict of additionalConflicts) {
    for (const todoId of conflict.todo_ids ?? []) {
      if (holdDecision.continue_set.includes(todoId)) {
        fail(`carried-over TODOが追加conflictの当事者になっている: ${todoId}`);
      }
    }
  }

  // freeze時点のfrozen prefix境界（authorized checkpoint lineageの基準）。
  const freezeSequenceForLineage = events
    .filter((event) => event.kind === 'intake_frozen' && event.plan_epoch === plan.plan_epoch)
    .map((event) => event.sequence)
    .sort((left, right) => left - right)[0] ?? null;

  // carried-over TODOへのepoch rebind packet（content不変・epoch/plan refだけ更新）。
  const rebindPackets = {};
  for (const todoId of holdDecision.continue_set) {
    const packet = packets[todoId];
    const dispatch = state.dispatches[todoId];
    const witnessRecord = state.witnesses[todoId];
    if (packet === undefined || dispatch === undefined || witnessRecord === undefined) {
      fail(`carried-over TODOのpacket／dispatch／witnessが欠落: ${todoId}`);
    }
    // authorized checkpointはfrozen prefix内の最後の観測checkpoint。checkpointが
    // 一件もないcarry-overはgenesis sentinel（64桁ゼロ、RC3-J ADRで正式裁定予定）。
    const frozenCheckpoints = state.checkpoints.filter((entry) => (
      entry.todo_id === todoId
      && (freezeSequenceForLineage === null || entry.sequence <= freezeSequenceForLineage)
    ));
    const authorizedCheckpointDigest = frozenCheckpoints.length > 0
      ? frozenCheckpoints[frozenCheckpoints.length - 1].payload?.checkpoint_digest ?? '0'.repeat(64)
      : '0'.repeat(64);
    const rebind = {
      schema: 'lattice.epoch_rebind_packet.v1',
      packet_id: `${newPlanRef}-rebind-${todoId}`,
      todo_id: todoId,
      executor_handle: dispatch.payload.executor_handle,
      worktree_id: dispatch.payload.worktree_id,
      witness_digest: witnessRecord.payload.witness_digest,
      context_content_digest: packet.context_content_digest,
      authorized_checkpoint_digest: authorizedCheckpointDigest,
      old_plan_ref: plan.plan_ref,
      new_plan_ref: newPlanRef,
      new_plan_epoch: newEpoch,
    };
    rebind.packet_digest = selfDigest(rebind, 'packet_digest');
    if (!validateEpochRebindPacket(rebind)) fail(`rebind packetがcontractを満たさない: ${todoId}`);
    if (rebind.context_content_digest !== computeContextContentDigest({
      todo_id: packet.todo_id,
      task_ref: packet.task_ref,
      scope: packet.scope,
      base_sha: packet.base_sha,
      verifier_refs: packet.verifier_refs,
      forbidden_operations: packet.forbidden_operations,
    })) {
      fail(`rebindのcontent digestがvN packet contentと一致しない: ${todoId}`);
    }
    rebindPackets[todoId] = rebind;
    next.push(buildNextRunEvent({
      events: next,
      runId,
      kind: 'epoch_rebound',
      planEpoch: newEpoch,
      subject: { kind: 'todo', ref: todoId },
      payload: structuredClone(rebind),
      recordedAt,
    }));
  }

  // redispatch TODOへは新plan_ref由来の別content packetを発行する。
  const allNewPackets = buildExecutorPackets({ plan: newPlan, manifests });
  const redispatchPackets = Object.fromEntries(
    holdDecision.hold_set.map((todoId) => [todoId, allNewPackets[todoId]]),
  );

  const planDiff = {
    schema: 'lattice.runtime_plan_diff.v1',
    old_plan_ref: plan.plan_ref,
    new_plan_ref: newPlanRef,
    accepted_checkpoints: sorted(acceptedCheckpoints),
    invalidated_contexts: [...holdDecision.hold_set],
    carried_over: [...holdDecision.continue_set],
    redispatched: [...holdDecision.hold_set],
    node_edge_diff: {
      added_nodes: [],
      removed_nodes: [],
      added_conflicts: mergedConflicts.length - plan.conflicts.length,
    },
  };
  planDiff.diff_digest = selfDigest(planDiff, 'diff_digest');
  if (!validateRuntimePlanDiff(planDiff)) fail('plan diffがcontractを満たさない');

  // intake再開（freeze境界はfreeze_historyとして永続し、receipt stale判定は
  // 最初のfreezeに対して行われ続ける）。
  next.push(buildNextRunEvent({
    events: next,
    runId,
    kind: 'intake_resumed',
    planEpoch: newEpoch,
    subject: { kind: 'runtime_plan', ref: newPlanRef },
    payload: { plan_diff_digest: planDiff.diff_digest },
    recordedAt,
  }));

  return {
    events: next,
    newPlan,
    planDiff,
    rebindPackets,
    redispatchPackets,
  };
}
