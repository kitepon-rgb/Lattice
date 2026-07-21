import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { canonicalizeArtifact } from './artifact-contracts.mjs';
import { selfDigest } from './runtime-contracts.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GATE_EVENT_KINDS = Object.freeze([
  'write_gate_committed',
  'epoch_activated',
  'intake_resumed',
]);

export class RuntimeGateStoreError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'RuntimeGateStoreError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail) { throw new RuntimeGateStoreError(code, detail); }
function digest(value) { return typeof value === 'string' && SHA256.test(value); }
function identifier(value) { return typeof value === 'string' && ID.test(value); }
function timestamp(value) {
  return typeof value === 'string' && TIMESTAMP.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value, keys) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
function sortedUniqueDigests(value) {
  return Array.isArray(value) && value.length <= 256 && value.every(digest)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}
function selfDigestValid(value, field) {
  if (!digest(value?.[field])) return false;
  try { return selfDigest(value, field) === value[field]; } catch { return false; }
}

export function validateSupervisorWriteGate(value) {
  return exact(value, [
    'schema', 'run_id', 'plan_epoch', 'gate_generation', 'release_barrier_digest',
    'controller_release_ack_digests', 'armed_lease_digests', 'previous_gate_digest',
    'committed_at', 'gate_digest',
  ])
    && value.schema === 'lattice.supervisor_write_gate.v1'
    && identifier(value.run_id)
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch >= 1
    && Number.isSafeInteger(value.gate_generation) && value.gate_generation >= 1
    && digest(value.release_barrier_digest)
    && sortedUniqueDigests(value.controller_release_ack_digests)
    && sortedUniqueDigests(value.armed_lease_digests)
    && (value.previous_gate_digest === null || digest(value.previous_gate_digest))
    && timestamp(value.committed_at)
    && selfDigestValid(value, 'gate_digest');
}

function validGateEventPayload(kind, value) {
  if (kind === 'write_gate_committed') {
    return exact(value, ['gate_digest', 'gate_generation'])
      && digest(value.gate_digest)
      && Number.isSafeInteger(value.gate_generation) && value.gate_generation >= 1;
  }
  return exact(value, ['plan_epoch', 'gate_digest'])
    && Number.isSafeInteger(value.plan_epoch) && value.plan_epoch >= 1
    && digest(value.gate_digest);
}

/** Gate batchが所有する3 eventのcanonical exact validator。 */
export function validateRuntimeGateControlEvent(value) {
  return exact(value, [
    'schema', 'run_id', 'sequence', 'previous_digest', 'kind',
    'session_nonce_digest', 'payload', 'recorded_at', 'event_digest',
  ])
    && value.schema === 'lattice.runtime_control_event.v1'
    && identifier(value.run_id)
    && Number.isSafeInteger(value.sequence) && value.sequence >= 0
    && (value.previous_digest === null || digest(value.previous_digest))
    && GATE_EVENT_KINDS.includes(value.kind)
    && digest(value.session_nonce_digest)
    && validGateEventPayload(value.kind, value.payload)
    && timestamp(value.recorded_at)
    && selfDigestValid(value, 'event_digest');
}

/**
 * revoke失敗を成功証拠へ丸めないためのexact validator。
 * `lease_revoked`はcontroller responseと完全な失効集合、residual zeroを必須にする。
 */
export function validateLeaseRevokedControlEvent(value) {
  return exact(value, [
    'schema', 'run_id', 'sequence', 'previous_digest', 'kind',
    'session_nonce_digest', 'payload', 'recorded_at', 'event_digest',
  ])
    && value.schema === 'lattice.runtime_control_event.v1'
    && identifier(value.run_id)
    && Number.isSafeInteger(value.sequence) && value.sequence >= 0
    && (value.previous_digest === null || digest(value.previous_digest))
    && value.kind === 'lease_revoked'
    && digest(value.session_nonce_digest)
    && exact(value.payload, [
      'controller_id', 'reason', 'requested_lease_digests', 'revoked_lease_digests',
      'residual_processes', 'revoke_response_digest',
    ])
    && identifier(value.payload.controller_id)
    && typeof value.payload.reason === 'string' && value.payload.reason.length > 0
    && sortedUniqueDigests(value.payload.requested_lease_digests)
    && sortedUniqueDigests(value.payload.revoked_lease_digests)
    && JSON.stringify(value.payload.requested_lease_digests)
      === JSON.stringify(value.payload.revoked_lease_digests)
    && Array.isArray(value.payload.residual_processes)
    && value.payload.residual_processes.length === 0
    && digest(value.payload.revoke_response_digest)
    && timestamp(value.recorded_at)
    && selfDigestValid(value, 'event_digest');
}

export function validateRuntimeGateBundle(value) {
  if (!(exact(value, [
    'schema', 'run_id', 'gate', 'control_events', 'previous_control_head_digest',
    'previous_receipt_digest', 'bundle_digest',
  ])
    && value.schema === 'lattice.runtime_gate_commit_bundle.v1'
    && identifier(value.run_id)
    && validateSupervisorWriteGate(value.gate)
    && value.gate.run_id === value.run_id
    && Array.isArray(value.control_events) && value.control_events.length === 3
    && value.control_events.every(validateRuntimeGateControlEvent)
    && value.control_events.map((event) => event.kind).join(',') === GATE_EVENT_KINDS.join(',')
    && (value.previous_control_head_digest === null || digest(value.previous_control_head_digest))
    && (value.previous_receipt_digest === null || digest(value.previous_receipt_digest))
    && selfDigestValid(value, 'bundle_digest'))) return false;
  const [committed, activated, resumed] = value.control_events;
  return committed.previous_digest === value.previous_control_head_digest
    && activated.previous_digest === committed.event_digest
    && resumed.previous_digest === activated.event_digest
    && committed.sequence + 1 === activated.sequence
    && activated.sequence + 1 === resumed.sequence
    && committed.run_id === value.run_id && activated.run_id === value.run_id && resumed.run_id === value.run_id
    && committed.payload.gate_digest === value.gate.gate_digest
    && committed.payload.gate_generation === value.gate.gate_generation
    && activated.payload.gate_digest === value.gate.gate_digest
    && activated.payload.plan_epoch === value.gate.plan_epoch
    && resumed.payload.gate_digest === value.gate.gate_digest
    && resumed.payload.plan_epoch === value.gate.plan_epoch;
}

export function validateRuntimeGateCommitReceipt(value) {
  return exact(value, [
    'schema', 'run_id', 'gate_generation', 'gate_digest', 'bundle_digest',
    'control_head_digest', 'previous_receipt_digest', 'committed_at', 'receipt_digest',
  ])
    && value.schema === 'lattice.runtime_gate_commit_receipt.v1'
    && identifier(value.run_id)
    && Number.isSafeInteger(value.gate_generation) && value.gate_generation >= 1
    && digest(value.gate_digest) && digest(value.bundle_digest)
    && digest(value.control_head_digest)
    && (value.previous_receipt_digest === null || digest(value.previous_receipt_digest))
    && timestamp(value.committed_at)
    && selfDigestValid(value, 'receipt_digest');
}

function canonicalBytes(value) { return Buffer.from(`${canonicalizeArtifact(value)}\n`); }

async function readCanonical(pathname, validator, label, { missing = false } = {}) {
  let stat;
  let bytes;
  try {
    stat = await lstat(pathname);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('INVALID_GATE_STORE', `${label}がregular fileでない`);
    bytes = await readFile(pathname);
  } catch (error) {
    if (error?.code === 'ENOENT' && missing) return null;
    if (error instanceof RuntimeGateStoreError) throw error;
    fail('INVALID_GATE_STORE', `${label}を読めない`);
  }
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_GATE_STORE', `${label}がJSONでない`); }
  if (!validator(value)) fail('INVALID_GATE_STORE', `${label}のexact schema又はdigestが不正`);
  if (!bytes.equals(canonicalBytes(value))) fail('INVALID_GATE_STORE', `${label}がcanonical bytesでない`);
  return value;
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function inject(crashInjector, point, context) {
  if (typeof crashInjector === 'function') await crashInjector(point, structuredClone(context));
}

async function atomicPublish(pathname, value, validator, crashInjector, label) {
  const existing = await readCanonical(pathname, validator, label, { missing: true });
  if (existing !== null) {
    if (!canonicalBytes(existing).equals(canonicalBytes(value))) {
      fail('GATE_COMMIT_CONFLICT', `${label}に異なるdigestが既にある`);
    }
    return;
  }
  const directory = path.dirname(pathname);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(pathname)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(canonicalBytes(value));
    await handle.sync();
    await handle.close();
    handle = null;
    await inject(crashInjector, `after_${label}_file_fsync`, { pathname });
    await rename(temporary, pathname);
    await inject(crashInjector, `after_${label}_rename`, { pathname });
    await fsyncDirectory(directory);
    await inject(crashInjector, `after_${label}_directory_fsync`, { pathname });
  } finally {
    if (handle !== null && handle !== undefined) await handle.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function atomicReplace(pathname, previousValue, value, validator, crashInjector, label) {
  const existing = await readCanonical(pathname, validator, label, { missing: true });
  if (existing !== null && canonicalBytes(existing).equals(canonicalBytes(value))) return;
  if ((existing === null) !== (previousValue === null)
    || (existing !== null && !canonicalBytes(existing).equals(canonicalBytes(previousValue)))) {
    fail('GATE_COMMIT_CONFLICT', `${label}のcommitted prefixが変化した`);
  }
  const directory = path.dirname(pathname);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(pathname)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(canonicalBytes(value));
    await handle.sync();
    await handle.close();
    handle = null;
    await inject(crashInjector, `after_${label}_file_fsync`, { pathname });
    await rename(temporary, pathname);
    await inject(crashInjector, `after_${label}_rename`, { pathname });
    await fsyncDirectory(directory);
    await inject(crashInjector, `after_${label}_directory_fsync`, { pathname });
  } finally {
    if (handle !== null && handle !== undefined) await handle.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

function gateName(generation, suffix) {
  return `${String(generation).padStart(8, '0')}.${suffix}.json`;
}

function pathsFor(runDir, generation) {
  const supervisorDir = path.join(runDir, 'supervisor');
  return {
    supervisorDir,
    gate: path.join(supervisorDir, 'write-gate.json'),
    events: path.join(runDir, 'control-events.json'),
    bundle: path.join(supervisorDir, 'gate-commits', gateName(generation, 'bundle')),
    receipt: path.join(supervisorDir, 'gate-receipts', gateName(generation, 'receipt')),
  };
}

function validateControlJournal(value) {
  if (!Array.isArray(value) || value.length > 100_000) return false;
  return value.every((event, index) => (
    exact(event, ['schema', 'run_id', 'sequence', 'previous_digest', 'kind', 'session_nonce_digest', 'payload', 'recorded_at', 'event_digest'])
    && event.schema === 'lattice.runtime_control_event.v1'
    && identifier(event.run_id)
    && Number.isSafeInteger(event.sequence) && event.sequence >= 1
    && (index === 0 || event.sequence === value[index - 1].sequence + 1)
    && (index === 0 ? event.previous_digest === null : event.previous_digest === value[index - 1].event_digest)
    && digest(event.session_nonce_digest) && plain(event.payload) && timestamp(event.recorded_at)
    && selfDigestValid(event, 'event_digest')
  ));
}

function createEvents({ runId, sessionNonceDigest, previousEvents, templates, committedAt }) {
  let previousDigest = previousEvents.at(-1)?.event_digest ?? null;
  const firstSequence = (previousEvents.at(-1)?.sequence ?? 0) + 1;
  const events = templates.map((template, offset) => {
    if (!exact(template, ['kind', 'payload']) || !GATE_EVENT_KINDS.includes(template.kind)
      || !validGateEventPayload(template.kind, template.payload)) {
      fail('INVALID_GATE_COMMIT', 'gate control event template不正');
    }
    const event = {
      schema: 'lattice.runtime_control_event.v1', run_id: runId,
      sequence: firstSequence + offset, previous_digest: previousDigest,
      kind: template.kind, session_nonce_digest: sessionNonceDigest,
      payload: structuredClone(template.payload), recorded_at: committedAt, event_digest: '',
    };
    event.event_digest = selfDigest(event, 'event_digest');
    previousDigest = event.event_digest;
    return event;
  });
  return events;
}

async function readPriorState(runDir, gate) {
  const currentGate = await readCanonical(pathsFor(runDir, gate.gate_generation).gate,
    validateSupervisorWriteGate, 'gate', { missing: true });
  let previousReceipt = null;
  if (gate.gate_generation > 1) {
    previousReceipt = await readCanonical(
      pathsFor(runDir, gate.gate_generation - 1).receipt,
      validateRuntimeGateCommitReceipt, 'previous_receipt', { missing: false },
    );
  }
  if (gate.gate_generation === 1) {
    if (gate.previous_gate_digest !== null || currentGate !== null) {
      if (currentGate?.gate_digest !== gate.gate_digest) fail('GATE_COMMIT_CONFLICT', 'generation 1 gate chain不正');
    }
  } else if (gate.previous_gate_digest !== previousReceipt?.gate_digest) {
    fail('GATE_COMMIT_CONFLICT', 'previous gate/receipt chain不一致');
  }
  if (currentGate === null && gate.gate_generation !== 1) {
    fail('GATE_COMMIT_CONFLICT', 'previous committed gateがない');
  }
  if (currentGate !== null
    && currentGate.gate_generation !== gate.gate_generation
    && currentGate.gate_generation !== gate.gate_generation - 1) {
    fail('GATE_COMMIT_CONFLICT', 'stale又はfuture gate generation retry');
  }
  if (currentGate?.gate_generation === gate.gate_generation
    && currentGate.gate_digest !== gate.gate_digest) {
    fail('GATE_COMMIT_CONFLICT', '同一generation gate digest衝突');
  }
  if (currentGate?.gate_generation === gate.gate_generation - 1
    && currentGate.gate_digest !== gate.previous_gate_digest) {
    fail('GATE_COMMIT_CONFLICT', 'current gate chain不一致');
  }
  return { currentGate, previousReceipt };
}

async function buildCommit({ runDir, runId, sessionNonceDigest, activation }) {
  if (!plain(activation) || !exact(activation, ['gate', 'control_events'])
    || !validateSupervisorWriteGate(activation.gate)
    || activation.gate.run_id !== runId || !digest(sessionNonceDigest)) {
    fail('INVALID_GATE_COMMIT', 'gate activation入力不正');
  }
  const { previousReceipt } = await readPriorState(runDir, activation.gate);
  const eventPath = pathsFor(runDir, activation.gate.gate_generation).events;
  const priorEvents = await readCanonical(eventPath, validateControlJournal, 'control_events', { missing: true }) ?? [];
  const alreadyAppended = priorEvents.slice(-3);
  let baseEvents = priorEvents;
  let newEvents;
  if (alreadyAppended.length === 3
    && alreadyAppended.map((event) => event.kind).join(',') === GATE_EVENT_KINDS.join(',')
    && alreadyAppended.every((event) => event.payload.gate_digest === activation.gate.gate_digest)) {
    newEvents = alreadyAppended;
    baseEvents = priorEvents.slice(0, -3);
  } else {
    newEvents = createEvents({ runId, sessionNonceDigest, previousEvents: priorEvents,
      templates: activation.control_events, committedAt: activation.gate.committed_at });
  }
  const previousControlHeadDigest = baseEvents.at(-1)?.event_digest ?? null;
  const bundle = {
    schema: 'lattice.runtime_gate_commit_bundle.v1', run_id: runId,
    gate: structuredClone(activation.gate), control_events: structuredClone(newEvents),
    previous_control_head_digest: previousControlHeadDigest,
    previous_receipt_digest: previousReceipt?.receipt_digest ?? null, bundle_digest: '',
  };
  bundle.bundle_digest = selfDigest(bundle, 'bundle_digest');
  const receipt = {
    schema: 'lattice.runtime_gate_commit_receipt.v1', run_id: runId,
    gate_generation: activation.gate.gate_generation, gate_digest: activation.gate.gate_digest,
    bundle_digest: bundle.bundle_digest, control_head_digest: newEvents.at(-1).event_digest,
    previous_receipt_digest: bundle.previous_receipt_digest,
    committed_at: activation.gate.committed_at, receipt_digest: '',
  };
  receipt.receipt_digest = selfDigest(receipt, 'receipt_digest');
  return { bundle, receipt, baseEvents, newEvents, currentGate: (await readPriorState(runDir, activation.gate)).currentGate };
}

async function commitBuilt({ runDir, built, crashInjector }) {
  const generation = built.bundle.gate.gate_generation;
  const paths = pathsFor(runDir, generation);
  await atomicPublish(paths.bundle, built.bundle, validateRuntimeGateBundle, crashInjector, 'bundle');
  const committedBundle = await readCanonical(paths.bundle, validateRuntimeGateBundle, 'bundle');
  if (committedBundle.bundle_digest !== built.bundle.bundle_digest) fail('GATE_COMMIT_CONFLICT', 'bundle digest衝突');
  await atomicReplace(paths.events, built.baseEvents, [...built.baseEvents, ...built.newEvents], validateControlJournal, crashInjector, 'events');
  await atomicReplace(paths.gate, built.currentGate, built.bundle.gate, validateSupervisorWriteGate, crashInjector, 'gate');
  // receipt renameが唯一のcommit point。これ以前のartifactはsame digest recovery専用である。
  await atomicPublish(paths.receipt, built.receipt, validateRuntimeGateCommitReceipt, crashInjector, 'receipt');
  return structuredClone(built.receipt);
}

export async function commitRuntimeGateActivation(options) {
  const built = await buildCommit(options);
  return commitBuilt({ runDir: options.runDir, built, crashInjector: options.crashInjector });
}

export async function recoverRuntimeGateCommit(options) {
  return commitRuntimeGateActivation(options);
}

export async function readCommittedRuntimeGate({ runDir, expectedRunId = null }) {
  const gatePath = path.join(runDir, 'supervisor', 'write-gate.json');
  const gate = await readCanonical(gatePath, validateSupervisorWriteGate, 'gate', { missing: true });
  if (gate === null) return null;
  if (expectedRunId !== null && gate.run_id !== expectedRunId) fail('INVALID_GATE_STORE', 'gate run binding不一致');
  const paths = pathsFor(runDir, gate.gate_generation);
  const bundle = await readCanonical(paths.bundle, validateRuntimeGateBundle, 'bundle');
  const receipt = await readCanonical(paths.receipt, validateRuntimeGateCommitReceipt, 'receipt');
  const events = await readCanonical(paths.events, validateControlJournal, 'control_events');
  if (bundle.gate.gate_digest !== gate.gate_digest
    || receipt.run_id !== gate.run_id
    || receipt.gate_generation !== gate.gate_generation
    || receipt.gate_digest !== gate.gate_digest
    || receipt.bundle_digest !== bundle.bundle_digest
    || receipt.control_head_digest !== events.at(-1)?.event_digest
    || receipt.control_head_digest !== bundle.control_events.at(-1)?.event_digest
    || receipt.previous_receipt_digest !== bundle.previous_receipt_digest
    || receipt.committed_at !== gate.committed_at) {
    fail('INVALID_GATE_STORE', 'gate/bundle/event/receipt binding不一致');
  }
  let newerReceipt = receipt;
  let newerGate = gate;
  for (let generation = gate.gate_generation - 1; generation >= 1; generation -= 1) {
    const previousPaths = pathsFor(runDir, generation);
    const previousReceipt = await readCanonical(previousPaths.receipt,
      validateRuntimeGateCommitReceipt, `receipt generation ${generation}`);
    const previousBundle = await readCanonical(previousPaths.bundle,
      validateRuntimeGateBundle, `bundle generation ${generation}`);
    if (previousReceipt.gate_generation !== generation
      || previousReceipt.run_id !== gate.run_id
      || previousBundle.run_id !== gate.run_id
      || previousBundle.gate.gate_generation !== generation
      || previousReceipt.bundle_digest !== previousBundle.bundle_digest
      || previousReceipt.gate_digest !== previousBundle.gate.gate_digest
      || previousReceipt.control_head_digest !== previousBundle.control_events.at(-1).event_digest
      || newerReceipt.previous_receipt_digest !== previousReceipt.receipt_digest
      || newerGate.previous_gate_digest !== previousReceipt.gate_digest) {
      fail('INVALID_GATE_STORE', `receipt chain generation ${generation}不一致`);
    }
    newerReceipt = previousReceipt;
    newerGate = previousBundle.gate;
  }
  if (newerReceipt.previous_receipt_digest !== null || newerGate.previous_gate_digest !== null) {
    fail('INVALID_GATE_STORE', 'generation 1 chain不正');
  }
  return { gate: structuredClone(gate), bundle: structuredClone(bundle), receipt: structuredClone(receipt) };
}

/** RuntimeManagedSupervisorの`gateWriter` dependencyへそのまま渡せるadapter。 */
export function createRuntimeGateStore({ runDir, runId, sessionNonceDigest, crashInjector = null }) {
  if (typeof runDir !== 'string' || !path.isAbsolute(runDir) || !identifier(runId) || !digest(sessionNonceDigest)) {
    fail('INVALID_GATE_COMMIT', 'gate store設定不正');
  }
  return Object.freeze({
    commit: (activation) => commitRuntimeGateActivation({ runDir, runId, sessionNonceDigest, activation, crashInjector }),
    recover: (activation) => recoverRuntimeGateCommit({ runDir, runId, sessionNonceDigest, activation, crashInjector }),
    read: () => readCommittedRuntimeGate({ runDir, expectedRunId: runId }),
  });
}
