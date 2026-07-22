import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';
import { isCanonicalUtcTimestamp } from './timestamp-contract.mjs';

// RC3 runtime契約（ADR 0044 Decision 2・3・5・7）。
// RC2公開済みschemaを変更しない加算moduleであり、全schemaはexact key、
// bounded collection、canonical serialization、自己digest規則をfail closedで検査する。
// field追加・意味変更はschema versionを上げ、新しいADRで裁定する。

const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const MAX_COLLECTION = 256;
const MAX_NODES_PER_PLAN = 8;

// 人間向けaudit reasonは表示を偽装できる制御文字を拒否しつつ、通常のUnicode説明を保持する。
const AUDIT_BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function validRuntimeAbandonReason(value) {
  return typeof value === 'string'
    && value === value.trim()
    && [...value].length >= 1
    && [...value].length <= 256
    && !/\p{Cc}/u.test(value)
    && !/[\u2028\u2029]/u.test(value)
    && !AUDIT_BIDI_CONTROLS.test(value);
}

// ADR 0044 Decision 3.2のclosed event kind set。拡張はrun_event.v2＋新ADRでだけ行う。
export const RUN_EVENT_KINDS = Object.freeze([
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

// ADR 0044 Decision 5のclosed conflict分類と、Decision 7.5のhold理由kind。
export const RUNTIME_CONFLICT_KINDS = Object.freeze([
  'observed_write_conflict',
  'semantic_conflict_unknown',
  'effect_conflict_unknown',
  'scope_violation',
  'stale_context',
]);
export const HOLD_REASON_KINDS = Object.freeze([
  ...RUNTIME_CONFLICT_KINDS,
  'carry_over_unprovable',
]);

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function digest(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function gitSha(value) {
  return typeof value === 'string' && SHA1.test(value);
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function timestamp(value) {
  return isCanonicalUtcTimestamp(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MAX_PATH_BYTES = 1024;

/**
 * repo相対pathだけを受理する（不正pathのfail closed、ADR 0044 Decision 2）。
 * 絶対path、`..`遡上、空segment、制御文字、`\`区切りを拒否する。
 * 末尾`/`はdeclared write prefix（directory宣言）としてのみ許す。
 */
function repoRelativePath(value, { allowPrefix = false } = {}) {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
    || CONTROL_CHARACTER.test(value)
    || value.includes('\\')
    || value.startsWith('/')) {
    return false;
  }
  const isPrefix = value.endsWith('/');
  if (isPrefix && !allowPrefix) return false;
  const body = isPrefix ? value.slice(0, -1) : value;
  const segments = body.split('/');
  return segments.every((segment) => (
    segment.length > 0 && segment !== '.' && segment !== '..'
  ));
}

function repoPathArray(value, options) {
  return boundedArray(value, (entry) => repoRelativePath(entry, options));
}

const OWN_KINDS = Object.freeze(['symbol', 'path']);
const STATE_EFFECT_KINDS = Object.freeze([
  'state',
  'schema',
  'invariant',
  'effect',
  'external_effect',
]);

function ownEntry(value) {
  return plainObject(value)
    && exactRecord(value, ['kind', 'target'])
    && OWN_KINDS.includes(value.kind)
    && typeof value.target === 'string'
    && value.target.length > 0
    && Buffer.byteLength(value.target, 'utf8') <= MAX_PATH_BYTES;
}

function stateEffectEntry(value) {
  return plainObject(value)
    && exactRecord(value, ['resource_id', 'kind'])
    && identifier(value.resource_id)
    && STATE_EFFECT_KINDS.includes(value.kind);
}

function unknownEntry(value) {
  return plainObject(value)
    && exactRecord(value, ['kind', 'ref'])
    && identifier(value.kind)
    && typeof value.ref === 'string'
    && value.ref.length > 0;
}

const MANUAL_WITNESS_FIELDS = Object.freeze([
  'owns',
  'reads',
  'writes',
  'resources',
  'state_effects',
  'sensor_provenance',
  'affected_tests',
  'unknowns',
]);

function manualWitnessEntry(value) {
  return plainObject(value)
    && exactRecord(value, MANUAL_WITNESS_FIELDS)
    && boundedArray(value.owns, ownEntry)
    && repoPathArray(value.reads)
    && repoPathArray(value.writes, { allowPrefix: true })
    && boundedArray(value.resources, identifier)
    && boundedArray(value.state_effects, stateEffectEntry)
    && plainObject(value.sensor_provenance)
    && repoPathArray(value.affected_tests)
    && boundedArray(value.unknowns, unknownEntry);
}

function boundedArray(value, predicate, { min = 0, max = MAX_COLLECTION } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= max
    && value.every((entry) => predicate(entry));
}

function uniqueIdentifierArray(value, options) {
  return boundedArray(value, identifier, options)
    && new Set(value).size === value.length;
}

function validateSafely(value, validator) {
  try {
    canonicalizeArtifact(value);
    return validator(value) === true;
  } catch {
    return false;
  }
}

/**
 * 自己digest規則: `digestField`自身を除いた残り全fieldのcanonical JSON SHA-256。
 * `run_request.v1`の`request_digest`（RC2 `admission_digest`と同型）を全schemaへ適用する。
 */
export function selfDigest(value, digestField) {
  const projection = {};
  for (const key of Object.keys(value)) {
    if (key !== digestField) projection[key] = value[key];
  }
  return digestArtifact(projection);
}

function selfDigestValid(value, digestField) {
  return digest(value[digestField]) && value[digestField] === selfDigest(value, digestField);
}

const WITNESS_PROVENANCE = Object.freeze([
  'sensor',
  'manual_candidate_spec',
  'manual_state_effect',
]);

/** `lattice.run_request.v1`。manual witnessはTODOごとに完備でなければならない。 */
export function validateRunRequest(value) {
  return validateSafely(value, (request) => {
    if (!exactRecord(request, [
      'schema',
      'request_id',
      'repo',
      'capacity',
      'todos',
      'manual_witness',
      'sensor_query_set',
      'executor_capability',
      'claim_mode',
      'request_digest',
    ])
      || request.schema !== 'lattice.run_request.v1'
      || !identifier(request.request_id)
      || !exactRecord(request.repo, ['base_sha', 'root_kind'])
      || !gitSha(request.repo.base_sha)
      || !identifier(request.repo.root_kind)
      || !exactRecord(request.capacity, ['executors'])
      || !positiveInteger(request.capacity.executors)
      || !boundedArray(request.todos, (todo) => (
        exactRecord(todo, ['todo_id']) && identifier(todo.todo_id)
      ), { min: 1 })) {
      return false;
    }
    const todoIds = request.todos.map((todo) => todo.todo_id);
    if (new Set(todoIds).size !== todoIds.length) return false;
    return plainObject(request.manual_witness)
      && exactRecord(request.manual_witness, todoIds)
      && Object.values(request.manual_witness).every(manualWitnessEntry)
      && plainObject(request.sensor_query_set)
      && plainObject(request.executor_capability)
      && request.claim_mode === 'exact_minimum'
      && selfDigestValid(request, 'request_digest');
  });
}

/**
 * runtime planをrun requestへcross-bindする（ADR 0044 Decision 2）。
 * 同一TODO集合を別base／別requestへ再包装したplanをtyped rejectするための検証で、
 * schema単体のvalidatorとは別に、request bytesとの一致を要求する。
 */
export function verifyRuntimePlanBinding(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) return false;
  const { plan, request } = options;
  if (!validateRuntimePlan(plan) || !validateRunRequest(request)) return false;
  if (plan.request_digest !== request.request_digest) return false;
  if (plan.base_sha !== request.repo.base_sha) return false;
  const requestTodoIds = new Set(request.todos.map((todo) => todo.todo_id));
  return plan.nodes.every((node) => requestTodoIds.has(node.todo_id));
}

/** `lattice.boundary_manifest.v2`。witness_provenanceはresourceごとに区別する。 */
export function validateRuntimeBoundaryManifest(value) {
  return validateSafely(value, (manifest) => (
    exactRecord(manifest, [
      'schema',
      'todo_id',
      'owns',
      'reads',
      'writes',
      'resources',
      'state_effects',
      'unknowns',
      'affected_tests',
      'graph_evidence',
      'witness_provenance',
      'manifest_digest',
    ])
    && manifest.schema === 'lattice.boundary_manifest.v2'
    && identifier(manifest.todo_id)
    && boundedArray(manifest.owns, ownEntry)
    && repoPathArray(manifest.reads)
    && repoPathArray(manifest.writes, { allowPrefix: true })
    && boundedArray(manifest.resources, identifier)
    && boundedArray(manifest.state_effects, stateEffectEntry)
    && boundedArray(manifest.unknowns, unknownEntry)
    && repoPathArray(manifest.affected_tests)
    && boundedArray(manifest.graph_evidence, plainObject)
    && plainObject(manifest.witness_provenance)
    && Object.values(manifest.witness_provenance).every((entry) => (
      WITNESS_PROVENANCE.includes(entry)
    ))
    && selfDigestValid(manifest, 'manifest_digest')
  ));
}

/** `lattice.runtime_plan.v1`。exact_minimum claimは1〜8 nodeだけを受理する（Decision 1）。 */
export function validateRuntimePlan(value) {
  return validateSafely(value, (plan) => {
    if (!exactRecord(plan, [
      'schema',
      'plan_ref',
      'plan_epoch',
      'request_digest',
      'base_sha',
      'nodes',
      'precedence',
      'conflicts',
      'capacity',
      'manifest_digests',
      'claim',
      'predecessor_refs',
      'plan_digest',
    ])
      || plan.schema !== 'lattice.runtime_plan.v1'
      || !identifier(plan.plan_ref)
      || !nonNegativeInteger(plan.plan_epoch)
      || !digest(plan.request_digest)
      || !gitSha(plan.base_sha)
      || !boundedArray(plan.nodes, (node) => (
        exactRecord(node, ['todo_id']) && identifier(node.todo_id)
      ), { min: 1, max: MAX_NODES_PER_PLAN })
      || !exactRecord(plan.claim, ['mode'])
      || plan.claim.mode !== 'exact_minimum'
      || !exactRecord(plan.capacity, ['executors'])
      || !positiveInteger(plan.capacity.executors)
      || !boundedArray(plan.predecessor_refs, (entry) => typeof entry === 'string')) {
      return false;
    }
    const nodeIds = plan.nodes.map((node) => node.todo_id);
    const nodeSet = new Set(nodeIds);
    if (nodeSet.size !== nodeIds.length) return false;
    if (!boundedArray(plan.precedence, (edge) => (
      exactRecord(edge, ['from_todo_id', 'to_todo_id'])
      && nodeSet.has(edge.from_todo_id)
      && nodeSet.has(edge.to_todo_id)
      && edge.from_todo_id !== edge.to_todo_id
    ))) {
      return false;
    }
    if (!boundedArray(plan.conflicts, (conflict) => (
      exactRecord(conflict, ['todo_ids', 'resource_id'])
      && Array.isArray(conflict.todo_ids)
      && conflict.todo_ids.length === 2
      && conflict.todo_ids.every((todoId) => nodeSet.has(todoId))
      && conflict.todo_ids[0] !== conflict.todo_ids[1]
      && identifier(conflict.resource_id)
    ))) {
      return false;
    }
    return plainObject(plan.manifest_digests)
      && exactRecord(plan.manifest_digests, nodeIds)
      && Object.values(plan.manifest_digests).every(digest)
      && selfDigestValid(plan, 'plan_digest');
  });
}

/** `lattice.run_event.v1`のevent単体shape。chain規則はruntime-event-store.mjsが検査する。 */
export function validateRunEvent(value) {
  return validateSafely(value, (event) => (
    exactRecord(event, [
      'schema',
      'run_id',
      'sequence',
      'previous_digest',
      'kind',
      'actor',
      'plan_epoch',
      'subject',
      'payload',
      'recorded_at',
      'event_digest',
    ])
    && event.schema === 'lattice.run_event.v1'
    && identifier(event.run_id)
    && nonNegativeInteger(event.sequence)
    && (event.previous_digest === null || digest(event.previous_digest))
    && (event.sequence === 0) === (event.previous_digest === null)
    && RUN_EVENT_KINDS.includes(event.kind)
    && identifier(event.actor)
    && nonNegativeInteger(event.plan_epoch)
    && exactRecord(event.subject, ['kind', 'ref'])
    && identifier(event.subject.kind)
    && typeof event.subject.ref === 'string'
    && plainObject(event.payload)
    && timestamp(event.recorded_at)
    && selfDigestValid(event, 'event_digest')
  ));
}

const CONTEXT_CONTENT_FIELDS = Object.freeze([
  'todo_id',
  'task_ref',
  'scope',
  'base_sha',
  'verifier_refs',
  'forbidden_operations',
]);

/**
 * ADR 0044 Decision 7.1のcontent projection digest。plan帰属field
 * （packet_id・plan_ref・plan_epoch・packet_digest）を除いた6 fieldだけを対象にし、
 * epoch rebindが「content不変・epochだけ更新」であることを機械検査可能にする。
 */
export function computeContextContentDigest(packet) {
  const projection = {};
  for (const field of CONTEXT_CONTENT_FIELDS) {
    projection[field] = packet[field];
  }
  return digestArtifact(projection);
}

/** `lattice.executor_packet.v1`。dispatch時に発行する唯一のcontext packet。 */
export function validateExecutorPacket(value) {
  return validateSafely(value, (packet) => (
    exactRecord(packet, [
      'schema',
      'packet_id',
      'todo_id',
      'task_ref',
      'scope',
      'base_sha',
      'plan_ref',
      'plan_epoch',
      'verifier_refs',
      'forbidden_operations',
      'context_content_digest',
      'packet_digest',
    ])
    && packet.schema === 'lattice.executor_packet.v1'
    && identifier(packet.packet_id)
    && identifier(packet.todo_id)
    && identifier(packet.task_ref)
    && plainObject(packet.scope)
    && gitSha(packet.base_sha)
    && identifier(packet.plan_ref)
    && nonNegativeInteger(packet.plan_epoch)
    && boundedArray(packet.verifier_refs, (entry) => typeof entry === 'string')
    && boundedArray(packet.forbidden_operations, (entry) => typeof entry === 'string', { min: 1 })
    && packet.context_content_digest === computeContextContentDigest(packet)
    && selfDigestValid(packet, 'packet_digest')
  ));
}

/** `lattice.executor_receipt.v1`。binding欠落はtyped rejectの対象（Decision 7.4）。 */
export function validateExecutorReceipt(value) {
  return validateSafely(value, (receipt) => (
    exactRecord(receipt, [
      'schema',
      'receipt_id',
      'executor_handle',
      'worktree_id',
      'base_sha',
      'plan_epoch',
      'packet_digest',
      'todo_id',
      'checkpoint_digest',
      'observed_diff',
      'receipt_digest',
    ])
    && receipt.schema === 'lattice.executor_receipt.v1'
    && identifier(receipt.receipt_id)
    && identifier(receipt.executor_handle)
    && identifier(receipt.worktree_id)
    && gitSha(receipt.base_sha)
    && nonNegativeInteger(receipt.plan_epoch)
    && digest(receipt.packet_digest)
    && identifier(receipt.todo_id)
    && digest(receipt.checkpoint_digest)
    && boundedArray(receipt.observed_diff, (entry) => (
      exactRecord(entry, ['path', 'change'])
      && repoRelativePath(entry.path)
      && ['added', 'modified', 'deleted'].includes(entry.change)
    ))
    && selfDigestValid(receipt, 'receipt_digest')
  ));
}

/** `lattice.hold_decision.v1`。hold／continueは交差しない。 */
export function validateHoldDecision(value) {
  return validateSafely(value, (decision) => {
    if (!exactRecord(decision, [
      'schema',
      'decision_id',
      'finding',
      'frozen_prefix_digest',
      'affected_closure',
      'hold_set',
      'continue_set',
      'evidence_digests',
      'decision_digest',
    ])
      || decision.schema !== 'lattice.hold_decision.v1'
      || !identifier(decision.decision_id)
      || !plainObject(decision.finding)
      || !HOLD_REASON_KINDS.includes(decision.finding.kind)
      || !digest(decision.frozen_prefix_digest)
      || !uniqueIdentifierArray(decision.affected_closure)
      || !uniqueIdentifierArray(decision.hold_set)
      || !uniqueIdentifierArray(decision.continue_set)
      || !boundedArray(decision.evidence_digests, digest)) {
      return false;
    }
    const holdSet = new Set(decision.hold_set);
    return decision.continue_set.every((todoId) => !holdSet.has(todoId))
      && selfDigestValid(decision, 'decision_digest');
  });
}

const INVARIANT_DIGEST_FIELDS = Object.freeze([
  'todo_input',
  'boundary_manifest',
  'validator',
  'context_content',
]);

/** `lattice.carry_over_witness.v1`。invariant digestは保存bytesから再計算できる。 */
export function validateCarryOverWitness(value) {
  return validateSafely(value, (witness) => (
    exactRecord(witness, [
      'schema',
      'witness_id',
      'todo_id',
      'predecessor_epoch',
      'successor_epoch',
      'invariant_digests',
      'non_overlap_evidence',
      'receipt_bindings',
      'witness_digest',
    ])
    && witness.schema === 'lattice.carry_over_witness.v1'
    && identifier(witness.witness_id)
    && identifier(witness.todo_id)
    && nonNegativeInteger(witness.predecessor_epoch)
    && nonNegativeInteger(witness.successor_epoch)
    && witness.successor_epoch > witness.predecessor_epoch
    && exactRecord(witness.invariant_digests, INVARIANT_DIGEST_FIELDS)
    && INVARIANT_DIGEST_FIELDS.every((field) => digest(witness.invariant_digests[field]))
    && boundedArray(witness.non_overlap_evidence, (entry) => typeof entry === 'string')
    && boundedArray(witness.receipt_bindings, (binding) => (
      exactRecord(binding, [
        'receipt_id',
        'checkpoint_digest',
        'recorded_sequence',
        'within_frozen_prefix',
      ])
      && identifier(binding.receipt_id)
      && digest(binding.checkpoint_digest)
      && nonNegativeInteger(binding.recorded_sequence)
      && typeof binding.within_frozen_prefix === 'boolean'
    ))
    && selfDigestValid(witness, 'witness_digest')
  ));
}

/** `lattice.epoch_rebind_packet.v1`。content不変・plan帰属だけを更新する（Decision 7.3）。 */
export function validateEpochRebindPacket(value) {
  return validateSafely(value, (packet) => (
    exactRecord(packet, [
      'schema',
      'packet_id',
      'todo_id',
      'executor_handle',
      'worktree_id',
      'witness_digest',
      'context_content_digest',
      'authorized_checkpoint_digest',
      'old_plan_ref',
      'new_plan_ref',
      'new_plan_epoch',
      'packet_digest',
    ])
    && packet.schema === 'lattice.epoch_rebind_packet.v1'
    && identifier(packet.packet_id)
    && identifier(packet.todo_id)
    && identifier(packet.executor_handle)
    && identifier(packet.worktree_id)
    && digest(packet.witness_digest)
    && digest(packet.context_content_digest)
    && digest(packet.authorized_checkpoint_digest)
    && identifier(packet.old_plan_ref)
    && identifier(packet.new_plan_ref)
    && packet.old_plan_ref !== packet.new_plan_ref
    && positiveInteger(packet.new_plan_epoch)
    && selfDigestValid(packet, 'packet_digest')
  ));
}

/** `lattice.runtime_plan_diff.v1`。carry-overとredispatchは交差しない。 */
export function validateRuntimePlanDiff(value) {
  return validateSafely(value, (diff) => {
    if (!exactRecord(diff, [
      'schema',
      'old_plan_ref',
      'new_plan_ref',
      'accepted_checkpoints',
      'invalidated_contexts',
      'carried_over',
      'redispatched',
      'node_edge_diff',
      'diff_digest',
    ])
      || diff.schema !== 'lattice.runtime_plan_diff.v1'
      || !identifier(diff.old_plan_ref)
      || !identifier(diff.new_plan_ref)
      || diff.old_plan_ref === diff.new_plan_ref
      || !boundedArray(diff.accepted_checkpoints, digest)
      || !uniqueIdentifierArray(diff.invalidated_contexts)
      || !uniqueIdentifierArray(diff.carried_over)
      || !uniqueIdentifierArray(diff.redispatched)
      || !plainObject(diff.node_edge_diff)) {
      return false;
    }
    const carried = new Set(diff.carried_over);
    return diff.redispatched.every((todoId) => !carried.has(todoId))
      && selfDigestValid(diff, 'diff_digest');
  });
}
