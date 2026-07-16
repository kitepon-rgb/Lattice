import { digestArtifact } from './artifact-contracts.mjs';
import { validateCarryOverWitness } from './runtime-contracts.mjs';
import { projectRuntimeState } from './runtime-projection.mjs';

// RC3 runtime decision verifier（ADR 0044 Decision 4〜7）。
// dispatch／hold／continue／invalidate裁定を、保存planとevent prefixだけから
// producer非依存に再計算する。schema envelope／digestの完全検証は
// runtime-contracts.mjsのvalidatorが担い、本moduleはruntime意味論を再計算する。
// 判定はすべてevent sequenceで行い、生成時刻・到着時刻を根拠にしない（Decision 7.4）。

function invalidVerification(reason) {
  throw new TypeError(`runtime decision verifier契約違反: ${reason}`);
}

function requirePlan(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)
    || !Array.isArray(plan.nodes)
    || plan.nodes.length === 0
    || !Array.isArray(plan.precedence)
    || !Array.isArray(plan.conflicts)
    || plan.capacity === null
    || typeof plan.capacity !== 'object'
    || !Number.isSafeInteger(plan.capacity.executors)
    || plan.capacity.executors < 1
    || !Number.isSafeInteger(plan.plan_epoch)) {
    invalidVerification('runtime planの意味論的shapeが不正');
  }
  const nodeIds = plan.nodes.map((node) => node.todo_id);
  if (nodeIds.some((todoId) => typeof todoId !== 'string')
    || new Set(nodeIds).size !== nodeIds.length) {
    invalidVerification('plan nodeが不正');
  }
  return nodeIds;
}

function sorted(values) {
  return [...values].sort();
}

/**
 * ready frontierを再計算する（ADR 0044 Decision 4）。
 * minimum waveを同期barrierとして扱わず、hard predecessor充足、running集合との
 * conflict不在、実capacityだけをdispatch可否の根拠にする。intake freeze中は
 * fail closedでdispatch 0件とする。dispatchableは辞書順で空きcapacity分に切る。
 */
export function computeReadyFrontier(options = {}) {
  const { plan, events } = options;
  const nodeIds = requirePlan(plan);
  const state = projectRuntimeState({ events });

  if (state.freeze !== null || state.closed) {
    return { dispatchable: [] };
  }

  const acceptedSet = new Set(state.accepted);
  const runningSet = new Set(state.running);
  const heldSet = new Set(state.holds.flatMap((hold) => hold.hold_set ?? []));
  const slots = plan.capacity.executors - runningSet.size;
  if (slots < 1) {
    return { dispatchable: [] };
  }

  const eligible = nodeIds.filter((todoId) => {
    if (acceptedSet.has(todoId) || runningSet.has(todoId) || heldSet.has(todoId)) return false;
    return plan.precedence.every((edge) => (
      edge.to_todo_id !== todoId || acceptedSet.has(edge.from_todo_id)
    ));
  });

  // running集合だけでなく、同じfrontierで既に選んだnodeとのconflictも検査する。
  // conflict pairを同一dispatch decisionで同時実行しないための貪欲選択（辞書順）。
  const dispatchable = [];
  for (const todoId of sorted(eligible)) {
    if (dispatchable.length >= slots) break;
    const conflictFree = plan.conflicts.every((conflict) => {
      if (!conflict.todo_ids.includes(todoId)) return true;
      return conflict.todo_ids.every((member) => (
        member === todoId || (!runningSet.has(member) && !dispatchable.includes(member))
      ));
    });
    if (conflictFree) dispatchable.push(todoId);
  }

  return { dispatchable };
}

function declaredWriteCovers(declaredWrites, observedPath) {
  return declaredWrites.some((declared) => (
    declared === observedPath
    || (declared.endsWith('/') && observedPath.startsWith(declared))
  ));
}

function witnessSet(manifest, kinds) {
  const resources = new Set(manifest?.resources ?? []);
  for (const effect of manifest?.state_effects ?? []) {
    if (kinds.includes(effect.kind) && typeof effect.resource_id === 'string') {
      resources.add(effect.resource_id);
    }
  }
  return resources;
}

/**
 * 観測diffをdeclared path／resource witnessへcross-bindし、closed conflict分類の
 * findingを返す（ADR 0044 Decision 5）。宣言外writeと運転中overlapは別findingで
 * 保存し、silent mergeしない。path非交差でも共有witnessがあれば安全と推測せず
 * unknown findingにする。
 */
export function classifyObservedDiff(options = {}) {
  const { plan, manifests, observations } = options;
  requirePlan(plan);
  if (manifests === null || typeof manifests !== 'object' || Array.isArray(manifests)
    || !Array.isArray(observations)) {
    invalidVerification('manifests／observationsが不正');
  }

  const findings = [];
  const observedByTodo = new Map();
  for (const observation of observations) {
    if (observation === null || typeof observation !== 'object'
      || typeof observation.todo_id !== 'string'
      || !Array.isArray(observation.paths)) {
      invalidVerification('observationが不正');
    }
    const manifest = manifests[observation.todo_id];
    if (manifest === undefined) {
      invalidVerification(`boundary manifestがないTODOの観測: ${observation.todo_id}`);
    }
    observedByTodo.set(observation.todo_id, [...new Set(observation.paths)].sort());
  }

  for (const [todoId, paths] of observedByTodo) {
    const declaredWrites = manifests[todoId].writes ?? [];
    for (const path of paths) {
      if (!declaredWriteCovers(declaredWrites, path)) {
        findings.push({ kind: 'scope_violation', todo_ids: [todoId], path });
      }
    }
  }

  const writersByPath = new Map();
  for (const [todoId, paths] of observedByTodo) {
    for (const path of paths) {
      const writers = writersByPath.get(path) ?? [];
      writers.push(todoId);
      writersByPath.set(path, writers);
    }
  }
  const overlapPairs = new Set();
  for (const [path, writers] of [...writersByPath.entries()].sort()) {
    if (writers.length < 2) continue;
    const sortedWriters = sorted(writers);
    for (let left = 0; left < sortedWriters.length; left += 1) {
      for (let right = left + 1; right < sortedWriters.length; right += 1) {
        findings.push({
          kind: 'observed_write_conflict',
          todo_ids: [sortedWriters[left], sortedWriters[right]],
          path,
        });
        overlapPairs.add(`${sortedWriters[left]} ${sortedWriters[right]}`);
      }
    }
  }

  const todoIds = sorted(observedByTodo.keys());
  for (let left = 0; left < todoIds.length; left += 1) {
    for (let right = left + 1; right < todoIds.length; right += 1) {
      const pairKey = `${todoIds[left]} ${todoIds[right]}`;
      if (overlapPairs.has(pairKey)) continue;
      // dynamic／semantic／effect unknownを持つTODOは、path非交差でも独立性を
      // 主張できない（ADR 0044 Decision 1.5・5.1）。unknown由来のpairをevidence
      // acquisition対象のsemantic conflict unknownとして保存する。
      const declaredUnknowns = [
        ...(manifests[todoIds[left]].unknowns ?? []),
        ...(manifests[todoIds[right]].unknowns ?? []),
      ];
      if (declaredUnknowns.length > 0) {
        findings.push({
          kind: 'semantic_conflict_unknown',
          todo_ids: [todoIds[left], todoIds[right]],
          resource_id: null,
          unknowns: structuredClone(declaredUnknowns),
        });
      }
      for (const [kind, witnessKinds] of [
        ['semantic_conflict_unknown', ['state', 'schema', 'invariant']],
        ['effect_conflict_unknown', ['effect', 'external_effect']],
      ]) {
        const leftWitness = kind === 'semantic_conflict_unknown'
          ? witnessSet(manifests[todoIds[left]], witnessKinds)
          : witnessSet({ state_effects: manifests[todoIds[left]].state_effects }, witnessKinds);
        const rightWitness = kind === 'semantic_conflict_unknown'
          ? witnessSet(manifests[todoIds[right]], witnessKinds)
          : witnessSet({ state_effects: manifests[todoIds[right]].state_effects }, witnessKinds);
        for (const resourceId of sorted(leftWitness)) {
          if (rightWitness.has(resourceId)) {
            findings.push({
              kind,
              todo_ids: [todoIds[left], todoIds[right]],
              resource_id: resourceId,
            });
          }
        }
      }
    }
  }

  return { findings };
}

function affectedClosure(plan, seedTodoIds, manifests) {
  const closure = new Set(seedTodoIds);
  // manifestsが与えられた場合、同一resource witnessへ到達するTODOをclosureへ
  // 含める（ADR 0044 Decision 6.3の第三要素）。resource→TODOのindexを先に作る。
  const byResource = new Map();
  if (manifests !== undefined) {
    for (const [todoId, manifest] of Object.entries(manifests)) {
      for (const resourceId of witnessSet(manifest, [
        'state', 'schema', 'invariant', 'effect', 'external_effect',
      ])) {
        const members = byResource.get(resourceId) ?? new Set();
        members.add(todoId);
        byResource.set(resourceId, members);
      }
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
    for (const edge of plan.precedence) {
      if (closure.has(edge.from_todo_id) && !closure.has(edge.to_todo_id)) {
        closure.add(edge.to_todo_id);
        changed = true;
      }
    }
    for (const members of byResource.values()) {
      if ([...members].some((todoId) => closure.has(todoId))) {
        for (const todoId of members) {
          if (!closure.has(todoId)) {
            closure.add(todoId);
            changed = true;
          }
        }
      }
    }
  }
  return closure;
}

/**
 * carry_over_witnessed eventが埋め込むwitness documentをschema・自己digest・
 * 帰属で検証する。event payloadは`{ witness_digest, witness }`を持ち、witnessは
 * `lattice.carry_over_witness.v1`の完全documentでなければならない。
 * invariant digestと提供bytesの再照合はverifyCarryOverWitnessが行う（RC3-Gで
 * 保存artifactと配線する）。ここでは存在・shape・digest整合を実証できない
 * witnessをすべて不成立として扱う（fail closed）。
 */
function witnessedForContinue(witnessRecord, todoId) {
  if (witnessRecord === undefined) return false;
  const payload = witnessRecord.payload;
  const witness = payload?.witness;
  if (witness === null || witness === undefined) return false;
  if (!validateCarryOverWitness(witness)) return false;
  if (witness.todo_id !== todoId) return false;
  if (typeof payload.witness_digest !== 'string'
    || payload.witness_digest !== witness.witness_digest) {
    return false;
  }
  return true;
}

/**
 * frozen prefixからaffected closureとhold／continue集合を再計算する
 * （ADR 0044 Decision 6・7.2）。closure外のrunning TODOでも、schema・自己digest
 * 整合まで実証できたcarry-over witnessが保存bytesに存在しなければcontinueできない
 * （fail closed）。manifestsを渡すと同一resource witness到達もclosureへ含める。
 */
export function recomputeHoldDecision(options = {}) {
  const { plan, events, manifests } = options;
  requirePlan(plan);
  const state = projectRuntimeState({ events });
  if (state.freeze === null) {
    invalidVerification('intake_frozen eventのないprefixからhold decisionを再計算できない');
  }
  const freezeSequence = state.freeze.sequence;

  const frozenConflicts = state.conflicts.filter((conflict) => (
    conflict.sequence <= freezeSequence
  ));
  if (frozenConflicts.length === 0) {
    invalidVerification('frozen prefix内にconflict findingがない');
  }
  const finding = frozenConflicts.at(-1);
  const seed = frozenConflicts.flatMap((conflict) => conflict.todo_ids ?? []);
  const closure = affectedClosure(plan, seed, manifests);

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

  const holdSet = new Set();
  const continueSet = new Set();
  const reasons = {};
  for (const todoId of frozenRunning) {
    if (closure.has(todoId)) {
      holdSet.add(todoId);
      reasons[todoId] = 'affected_closure';
    } else if (witnessedForContinue(state.witnesses[todoId], todoId)) {
      continueSet.add(todoId);
    } else {
      holdSet.add(todoId);
      reasons[todoId] = 'carry_over_unprovable';
    }
  }
  for (const todoId of closure) {
    if (!holdSet.has(todoId) && !continueSet.has(todoId)) {
      holdSet.add(todoId);
      reasons[todoId] = 'affected_closure';
    }
  }

  return {
    finding: structuredClone(finding),
    frozen_prefix_sequence: freezeSequence,
    hold_set: sorted(holdSet),
    continue_set: sorted(continueSet),
    reasons,
  };
}

/**
 * receipt受理裁定をevent prefixから再計算する（ADR 0044 Decision 7.4）。
 * 「rebind前」「rebind後」は生成時刻でなくevent sequenceで判定する。
 * freeze後のvN epoch receiptはwitness bindingの有無によらずstale_contextで
 * rejectし、frozen prefix内のpending receiptはwitness bindingがある場合だけ
 * 受理する。証明できない受理はすべてrejectへ倒す（fail closed）。
 */
const RECEIPT_BINDING_FIELDS = Object.freeze([
  'executor_handle',
  'worktree_id',
  'base_sha',
  'packet_digest',
  'checkpoint_digest',
]);

export function recomputeReceiptDecisions(options = {}) {
  const { plan, events } = options;
  requirePlan(plan);
  const state = projectRuntimeState({ events });
  // freezeはresumeで消えない永続境界として扱う。resume後もvN epoch receiptの
  // stale判定は最初のfreeze境界に対して行う（受理へ反転させない）。
  const freezes = [
    ...state.freeze_history.map((entry) => entry.sequence),
    ...(state.freeze === null ? [] : [state.freeze.sequence]),
  ].sort((left, right) => left - right);
  const freezeBoundary = freezes.length === 0 ? null : freezes[0];

  const decisions = state.receipts.map((receipt) => {
    const base = {
      receipt_id: receipt.receipt_id,
      todo_id: receipt.todo_id,
      sequence: receipt.sequence,
    };
    const reject = (detail) => (
      { ...base, decision: 'rejected', reason: 'stale_context', detail }
    );

    // 帰属照合の基準はdispatch記録であり、executor自己申告ではない（Decision 7.4）。
    const payload = receipt.payload ?? {};
    if (RECEIPT_BINDING_FIELDS.some((field) => typeof payload[field] !== 'string')) {
      return reject('binding_missing');
    }
    const dispatch = state.dispatches[receipt.todo_id];
    if (dispatch === undefined) {
      return reject('not_dispatched');
    }
    const dispatchPayload = dispatch.payload ?? {};
    if (payload.executor_handle !== dispatchPayload.executor_handle
      || payload.worktree_id !== dispatchPayload.worktree_id
      || payload.packet_digest !== dispatchPayload.packet_digest) {
      return reject('binding_mismatch');
    }
    if (typeof plan.base_sha === 'string' && payload.base_sha !== plan.base_sha) {
      return reject('base_mismatch');
    }
    if (receipt.plan_epoch !== plan.plan_epoch) {
      return reject('epoch_mismatch');
    }
    if (receipt.rejected_sequence !== null) {
      return reject('recorded_rejection');
    }
    if (freezeBoundary === null) {
      return { ...base, decision: 'accepted', reason: null, detail: null };
    }
    if (receipt.accepted_sequence !== null && receipt.accepted_sequence <= freezeBoundary) {
      return { ...base, decision: 'accepted', reason: null, detail: null };
    }
    if (receipt.sequence > freezeBoundary) {
      return reject('post_freeze');
    }
    // frozen prefix内のpending receiptは、実証済みwitness documentの
    // receipt_bindingsが当該receiptをbindする場合だけ有効になる（Decision 7.5）。
    const witnessRecord = state.witnesses[receipt.todo_id];
    if (!witnessedForContinue(witnessRecord, receipt.todo_id)) {
      return reject('witness_unproven');
    }
    const bound = witnessRecord.payload.witness.receipt_bindings.some((binding) => (
      binding.receipt_id === receipt.receipt_id
      && binding.recorded_sequence === receipt.sequence
      && binding.within_frozen_prefix === true
    ));
    if (bound) {
      return { ...base, decision: 'accepted', reason: null, detail: null };
    }
    return reject('unbound_receipt');
  });

  return { decisions };
}

const INVARIANT_DIGEST_FIELDS = Object.freeze([
  'todo_input',
  'boundary_manifest',
  'validator',
  'context_content',
]);

/**
 * carry-over witnessのinvariant digestを提供bytesから再計算する
 * （ADR 0044 Decision 7.2・7.5）。1 fieldでも証明不能ならvalid falseとし、
 * reasonsへ具体的なfailureと`carry_over_unprovable`を返す。
 */
export function verifyCarryOverWitness(options = {}) {
  const { witness, sources } = options;
  const reasons = [];
  if (witness === null || typeof witness !== 'object' || Array.isArray(witness)
    || witness.invariant_digests === null
    || typeof witness.invariant_digests !== 'object') {
    return { valid: false, reasons: ['witness_shape', 'carry_over_unprovable'] };
  }
  if (sources === null || typeof sources !== 'object' || Array.isArray(sources)) {
    return { valid: false, reasons: ['sources_shape', 'carry_over_unprovable'] };
  }

  if (!Number.isSafeInteger(witness.predecessor_epoch)
    || !Number.isSafeInteger(witness.successor_epoch)
    || witness.successor_epoch <= witness.predecessor_epoch) {
    reasons.push('epoch_ordering');
  }

  for (const field of INVARIANT_DIGEST_FIELDS) {
    if (sources[field] === undefined) {
      reasons.push(`missing_source:${field}`);
      continue;
    }
    let recomputed = null;
    try {
      recomputed = digestArtifact(sources[field]);
    } catch {
      reasons.push(`source_not_canonical:${field}`);
      continue;
    }
    if (witness.invariant_digests[field] !== recomputed) {
      reasons.push(`invariant_digest_mismatch:${field}`);
    }
  }

  if (typeof witness.witness_digest === 'string') {
    const projection = {};
    for (const key of Object.keys(witness)) {
      if (key !== 'witness_digest') projection[key] = witness[key];
    }
    let selfDigest = null;
    try {
      selfDigest = digestArtifact(projection);
    } catch {
      selfDigest = null;
    }
    if (witness.witness_digest !== selfDigest) {
      reasons.push('witness_digest_mismatch');
    }
  } else {
    reasons.push('witness_digest_mismatch');
  }

  if (reasons.length > 0) {
    reasons.push('carry_over_unprovable');
    return { valid: false, reasons };
  }
  return { valid: true, reasons: [] };
}
