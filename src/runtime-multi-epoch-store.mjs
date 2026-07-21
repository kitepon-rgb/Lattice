import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';
import { buildExecutorPackets } from './runtime-engine.mjs';
import {
  RUNTIME_CONFLICT_KINDS,
  validateExecutorPacket,
  validateRunRequest,
  validateRuntimeBoundaryManifest,
  validateRuntimePlan,
  verifyRuntimePlanBinding,
} from './runtime-contracts.mjs';

const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const EPOCH_DIRECTORY = /^\d{8}$/u;
const TRANSACTION_ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;

export class RuntimeEpochStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeEpochStoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuntimeEpochStoreError(code, message);
}

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  return plainRecord(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function selfDigestValid(value, field) {
  if (!plainRecord(value) || !HEX_DIGEST.test(value[field] ?? '')) return false;
  const body = { ...value };
  delete body[field];
  return digestArtifact(body) === value[field];
}

export function validateRuntimeFindingRecord(value) {
  if (!exactRecord(value, ['schema', 'finding_id', 'run_id', 'plan_epoch',
    'source_checkpoint_digest', 'observed_event_digest', 'finding', 'recorded_by', 'finding_digest'])
    || value.schema !== 'lattice.runtime_finding_record.v1'
    || !TRANSACTION_ID.test(value.finding_id ?? '') || !TRANSACTION_ID.test(value.run_id ?? '')
    || !Number.isSafeInteger(value.plan_epoch) || value.plan_epoch < 1
    || !HEX_DIGEST.test(value.source_checkpoint_digest ?? '')
    || !HEX_DIGEST.test(value.observed_event_digest ?? '')
    || !selfDigestValid(value, 'finding_digest')) return false;
  const finding = value.finding;
  if (!exactRecord(finding, ['schema', 'kind', 'todo_ids', 'path', 'resource_id',
    'evidence_digests', 'finding_digest'])
    || finding.schema !== 'lattice.runtime_conflict_finding.v1'
    || !RUNTIME_CONFLICT_KINDS.includes(finding.kind)
    || !Array.isArray(finding.todo_ids) || finding.todo_ids.length < 1 || finding.todo_ids.length > 256
    || finding.todo_ids.some((todoId) => !TRANSACTION_ID.test(todoId))
    || new Set(finding.todo_ids).size !== finding.todo_ids.length
    || finding.todo_ids.some((todoId, index) => index > 0 && finding.todo_ids[index - 1] >= todoId)
    || !(finding.path === null || (typeof finding.path === 'string' && finding.path.length > 0))
    || !(finding.resource_id === null || TRANSACTION_ID.test(finding.resource_id))
    || !Array.isArray(finding.evidence_digests) || finding.evidence_digests.length > 256
    || finding.evidence_digests.some((entry) => !HEX_DIGEST.test(entry))
    || new Set(finding.evidence_digests).size !== finding.evidence_digests.length
    || finding.evidence_digests.some((entry, index) => index > 0 && finding.evidence_digests[index - 1] >= entry)
    || !selfDigestValid(finding, 'finding_digest')) return false;
  const pathKind = ['observed_write_conflict', 'scope_violation', 'stale_context'].includes(finding.kind);
  if (pathKind !== (finding.path !== null) || pathKind === (finding.resource_id !== null)) return false;
  const observer = value.recorded_by;
  return exactRecord(observer, ['schema', 'kind', 'controller_registration_digest',
    'executor_handle', 'identity_digest'])
    && observer.schema === 'lattice.runtime_observer_identity.v1'
    && ['supervisor', 'controller', 'executor'].includes(observer.kind)
    && (observer.controller_registration_digest === null
      || HEX_DIGEST.test(observer.controller_registration_digest))
    && (observer.executor_handle === null || TRANSACTION_ID.test(observer.executor_handle))
    && selfDigestValid(observer, 'identity_digest');
}

async function readRegularJson(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch {
    fail('INVALID_RUN_STORE', `${label}を読めない`);
  }
  if (!info.isFile() || info.isSymbolicLink()) fail('INVALID_RUN_STORE', `${label}がregular fileではない`);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    fail('INVALID_RUN_STORE', `${label}がvalid JSONではない`);
  }
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableJson(filePath, value, { exclusive = true } = {}) {
  const bytes = `${JSON.stringify(value, null, 1)}\n`;
  const handle = await open(filePath, exclusive ? 'wx' : 'w', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceDurableJson(directory, name, value) {
  const temporary = path.join(directory, `.${name}-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeDurableJson(temporary, value);
    await rename(temporary, path.join(directory, name));
    await fsyncDirectory(directory);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function validateLegacyInputs({ request, compileArtifact, legacyMeta }) {
  const compileKeys = ['schema', 'request_digest', 'plan', 'manifests', 'schedule', 'graph_digest', 'result_digest'];
  const metaKeys = ['schema', 'run_id', 'executor_adapter', 'plan_digest'];
  const compileBody = { ...compileArtifact };
  delete compileBody.result_digest;
  if (!validateRunRequest(request)
    || !exactRecord(legacyMeta, metaKeys) || legacyMeta.schema !== 'lattice.run_meta.v1'
    || legacyMeta.run_id !== request.request_id
    || !exactRecord(compileArtifact, compileKeys)
    || compileArtifact.schema !== 'lattice.plan_compile_result.v1'
    || compileArtifact.result_digest !== digestArtifact(compileBody)
    || compileArtifact.request_digest !== request.request_digest
    || !validateRuntimePlan(compileArtifact.plan)
    || !verifyRuntimePlanBinding({ plan: compileArtifact.plan, request })
    || compileArtifact.plan.plan_digest !== legacyMeta.plan_digest) {
    fail('INVALID_RUN_STORE', 'legacy epoch 1 artifact bindingが不正');
  }
  const todoIds = compileArtifact.plan.nodes.map(({ todo_id: todoId }) => todoId).sort();
  if (Object.keys(compileArtifact.manifests ?? {}).sort().join('\0') !== todoIds.join('\0')) {
    fail('INVALID_RUN_STORE', 'epoch 1 manifest key集合がplanと一致しない');
  }
  for (const todoId of todoIds) {
    const manifest = compileArtifact.manifests[todoId];
    if (!validateRuntimeBoundaryManifest(manifest)
      || manifest.manifest_digest !== compileArtifact.plan.manifest_digests[todoId]) {
      fail('INVALID_RUN_STORE', `epoch 1 manifest bindingが不正: ${todoId}`);
    }
  }
}

function normalizeActivationMeta(meta, request, compileArtifact) {
  if (meta?.schema === 'lattice.run_meta.v1') return meta;
  if (exactRecord(meta, [
    'schema', 'run_id', 'executor_adapter', 'run_event_schema', 'control_event_schema',
    'epoch_bundle_schema', 'created_plan_digest', 'meta_digest',
  ]) && meta.schema === 'lattice.run_meta.v2'
    && meta.run_id === request.request_id
    && meta.created_plan_digest === compileArtifact.plan.plan_digest
    && selfDigestValid(meta, 'meta_digest')) {
    return {
      schema: 'lattice.run_meta.v1',
      run_id: meta.run_id,
      executor_adapter: meta.executor_adapter,
      plan_digest: meta.created_plan_digest,
    };
  }
  fail('INVALID_RUN_STORE', 'activation対象run metaがv1／同一runのv2ではない');
}

function buildEpochOneBundle({ request, compileArtifact, legacyMeta }) {
  validateLegacyInputs({ request, compileArtifact, legacyMeta });
  const bundle = {
    schema: 'lattice.runtime_epoch_bundle.v1',
    run_id: legacyMeta.run_id,
    plan_epoch: 1,
    request,
    plan: compileArtifact.plan,
    manifests: compileArtifact.manifests,
    executor_packets: buildExecutorPackets({
      plan: compileArtifact.plan,
      manifests: compileArtifact.manifests,
    }),
    rebind_packets: null,
    plan_diff: null,
    task_migration: null,
    treatment: null,
    phase_revision_digest: null,
    phase_revision_commit_receipt: null,
    predecessor_bundle_digest: null,
  };
  bundle.bundle_digest = digestArtifact(bundle);
  return bundle;
}

export function validateRuntimeEpochBundle(bundle) {
  if (!exactRecord(bundle, [
    'schema', 'run_id', 'plan_epoch', 'request', 'plan', 'manifests', 'executor_packets',
    'rebind_packets', 'plan_diff', 'task_migration', 'treatment', 'phase_revision_digest',
    'phase_revision_commit_receipt', 'predecessor_bundle_digest', 'bundle_digest',
  ]) || bundle.schema !== 'lattice.runtime_epoch_bundle.v1'
    || !Number.isInteger(bundle.plan_epoch) || bundle.plan_epoch < 1
    || bundle.plan_epoch !== bundle.plan?.plan_epoch
    || bundle.run_id !== bundle.request?.request_id
    || !validateRunRequest(bundle.request)
    || !validateRuntimePlan(bundle.plan)
    || !verifyRuntimePlanBinding({ plan: bundle.plan, request: bundle.request })
    || !selfDigestValid(bundle, 'bundle_digest')) return false;
  const todoIds = bundle.plan.nodes.map(({ todo_id: todoId }) => todoId).sort();
  if (Object.keys(bundle.manifests ?? {}).sort().join('\0') !== todoIds.join('\0')
    || Object.keys(bundle.executor_packets ?? {}).sort().join('\0') !== todoIds.join('\0')) return false;
  for (const todoId of todoIds) {
    const manifest = bundle.manifests[todoId];
    const packet = bundle.executor_packets[todoId];
    if (!validateRuntimeBoundaryManifest(manifest)
      || manifest.manifest_digest !== bundle.plan.manifest_digests[todoId]
      || !validateExecutorPacket(packet)
      || packet.todo_id !== todoId
      || packet.plan_ref !== bundle.plan.plan_ref
      || packet.plan_epoch !== bundle.plan_epoch) return false;
  }
  if (bundle.plan_epoch === 1) {
    return ['rebind_packets', 'plan_diff', 'task_migration', 'treatment',
      'phase_revision_digest', 'phase_revision_commit_receipt', 'predecessor_bundle_digest']
      .every((key) => bundle[key] === null);
  }
  return HEX_DIGEST.test(bundle.predecessor_bundle_digest ?? '');
}

function validateRunMetaV2(meta, createdBundle) {
  return exactRecord(meta, [
    'schema', 'run_id', 'executor_adapter', 'run_event_schema', 'control_event_schema',
    'epoch_bundle_schema', 'created_plan_digest', 'meta_digest',
  ]) && meta.schema === 'lattice.run_meta.v2'
    && meta.run_id === createdBundle.run_id
    && meta.run_event_schema === 'lattice.run_event.v1'
    && meta.control_event_schema === 'lattice.runtime_control_event.v1'
    && meta.epoch_bundle_schema === 'lattice.runtime_epoch_bundle.v1'
    && meta.created_plan_digest === createdBundle.plan.plan_digest
    && selfDigestValid(meta, 'meta_digest');
}

function validateCommittedPointer(pointer, bundle) {
  return exactRecord(pointer, [
    'schema', 'run_id', 'plan_epoch', 'plan_ref', 'bundle_digest',
    'activation_run_event_digest', 'activation_control_event_digest', 'pointer_digest',
  ]) && pointer.schema === 'lattice.committed_epoch_pointer.v1'
    && pointer.run_id === bundle.run_id
    && pointer.plan_epoch === bundle.plan_epoch
    && pointer.plan_ref === bundle.plan.plan_ref
    && pointer.bundle_digest === bundle.bundle_digest
    && HEX_DIGEST.test(pointer.activation_run_event_digest ?? '')
    && HEX_DIGEST.test(pointer.activation_control_event_digest ?? '')
    && selfDigestValid(pointer, 'pointer_digest');
}

/** v1 aliasをbyte不変のままepoch 1へ昇格し、pointerを最後にcommitする。 */
export async function activateEpochOneStore({
  runDir, request, compileArtifact, legacyMeta, activationRunEventDigest, activationControlEventDigest,
}) {
  if (!HEX_DIGEST.test(activationRunEventDigest ?? '')
    || !HEX_DIGEST.test(activationControlEventDigest ?? '')) {
    fail('INVALID_RUN_STORE', 'activation event digestが不正');
  }
  const runEvents = await readRegularJson(path.join(runDir, 'events.json'), 'run events');
  const controlEvents = await readRegularJson(path.join(runDir, 'control-events.json'), 'runtime control events');
  const controlHead = controlEvents.at?.(-1);
  if (!Array.isArray(runEvents) || runEvents.at(-1)?.event_digest !== activationRunEventDigest
    || !Array.isArray(controlEvents)
    || controlHead?.event_digest !== activationControlEventDigest
    || controlHead?.kind !== 'supervisor_activated'
    || !selfDigestValid(controlHead, 'event_digest')) {
    fail('INVALID_RUN_STORE', 'activation pointerがdurable event headへbindしない');
  }
  const normalizedMeta = normalizeActivationMeta(legacyMeta, request, compileArtifact);
  const bundle = buildEpochOneBundle({ request, compileArtifact, legacyMeta: normalizedMeta });
  const epochsDir = path.join(runDir, 'epochs');
  const epochDir = path.join(epochsDir, '00000001');
  const stagingDir = path.join(runDir, `.epoch-1-${process.pid}-${Date.now()}.tmp`);
  await mkdir(epochsDir, { recursive: true });
  await mkdir(path.join(runDir, 'staging'), { recursive: true });
  await mkdir(path.join(runDir, 'findings'), { recursive: true });
  await mkdir(path.join(runDir, 'controllers'), { recursive: true });
  await mkdir(path.join(runDir, 'leases'), { recursive: true });
  for (const directory of [epochsDir, path.join(runDir, 'staging'), path.join(runDir, 'findings'),
    path.join(runDir, 'controllers'), path.join(runDir, 'leases')]) await fsyncDirectory(directory);
  await fsyncDirectory(runDir);

  try {
    const existing = await readRegularJson(path.join(epochDir, 'epoch-bundle.json'), 'epoch 1 bundle');
    if (!validateRuntimeEpochBundle(existing) || existing.bundle_digest !== bundle.bundle_digest) {
      fail('EPOCH_BUNDLE_CONFLICT', 'epoch 1へ異なるbundleが存在する');
    }
  } catch (error) {
    if (error instanceof RuntimeEpochStoreError && error.message.endsWith('を読めない')) {
      await mkdir(stagingDir);
      await writeDurableJson(path.join(stagingDir, 'epoch-bundle.json'), bundle);
      await fsyncDirectory(stagingDir);
      try {
        await rename(stagingDir, epochDir);
        await fsyncDirectory(epochsDir);
      } catch (renameError) {
        await rm(stagingDir, { recursive: true, force: true });
        if (renameError?.code !== 'EEXIST' && renameError?.code !== 'ENOTEMPTY') throw renameError;
        const raced = await readRegularJson(path.join(epochDir, 'epoch-bundle.json'), 'epoch 1 bundle');
        if (!validateRuntimeEpochBundle(raced) || raced.bundle_digest !== bundle.bundle_digest) {
          fail('EPOCH_BUNDLE_CONFLICT', 'epoch 1 concurrent commitが異なる');
        }
      }
    } else {
      throw error;
    }
  }

  const meta = {
    schema: 'lattice.run_meta.v2',
    run_id: normalizedMeta.run_id,
    executor_adapter: normalizedMeta.executor_adapter,
    run_event_schema: 'lattice.run_event.v1',
    control_event_schema: 'lattice.runtime_control_event.v1',
    epoch_bundle_schema: 'lattice.runtime_epoch_bundle.v1',
    created_plan_digest: compileArtifact.plan.plan_digest,
  };
  meta.meta_digest = digestArtifact(meta);
  await replaceDurableJson(runDir, 'run-meta.json', meta);

  const pointer = {
    schema: 'lattice.committed_epoch_pointer.v1',
    run_id: normalizedMeta.run_id,
    plan_epoch: 1,
    plan_ref: compileArtifact.plan.plan_ref,
    bundle_digest: bundle.bundle_digest,
    activation_run_event_digest: activationRunEventDigest,
    activation_control_event_digest: activationControlEventDigest,
  };
  pointer.pointer_digest = digestArtifact(pointer);
  await replaceDurableJson(runDir, 'committed-epoch.json', pointer);
  return { bundle, meta, pointer };
}

/** pointerを正本としてactive bundleだけを読む。directory最大値へfallbackしない。 */
export async function readCommittedEpochStore(runDir) {
  const meta = await readRegularJson(path.join(runDir, 'run-meta.json'), 'run meta');
  if (meta?.schema !== 'lattice.run_meta.v2') return null;
  const pointer = await readRegularJson(path.join(runDir, 'committed-epoch.json'), 'committed epoch pointer');
  if (!Number.isInteger(pointer?.plan_epoch) || pointer.plan_epoch < 1) {
    fail('INVALID_RUN_STORE', 'committed epoch pointerのepochが不正');
  }
  const epochName = String(pointer.plan_epoch).padStart(8, '0');
  if (!EPOCH_DIRECTORY.test(epochName)) fail('INVALID_RUN_STORE', 'epoch directory名が不正');
  const bundle = await readRegularJson(path.join(runDir, 'epochs', epochName, 'epoch-bundle.json'), 'epoch bundle');
  const createdBundle = pointer.plan_epoch === 1
    ? bundle
    : await readRegularJson(path.join(runDir, 'epochs', '00000001', 'epoch-bundle.json'), 'created epoch bundle');
  if (!validateRuntimeEpochBundle(bundle)
    || !validateRuntimeEpochBundle(createdBundle)
    || createdBundle.plan_epoch !== 1
    || !validateRunMetaV2(meta, createdBundle)
    || !validateCommittedPointer(pointer, bundle)) {
    fail('INVALID_RUN_STORE', 'multi-epoch store bindingが不正');
  }
  let previous = createdBundle;
  for (let epoch = 2; epoch <= pointer.plan_epoch; epoch += 1) {
    const current = epoch === pointer.plan_epoch
      ? bundle
      : await readRegularJson(path.join(runDir, 'epochs', String(epoch).padStart(8, '0'), 'epoch-bundle.json'), `epoch ${epoch} bundle`);
    if (!validateRuntimeEpochBundle(current) || current.plan_epoch !== epoch
      || current.run_id !== meta.run_id
      || current.predecessor_bundle_digest !== previous.bundle_digest) {
      fail('INVALID_RUN_STORE', `epoch ${epoch} predecessor chainが不正`);
    }
    previous = current;
  }
  return { meta, pointer, bundle };
}

/**
 * successorはLPG028のrun_request.v2／migration／treatment verifierを必須注入する。
 * v1 validatorやopaque objectへfallbackせず、verifier未導入中はstore無変更で拒否する。
 */
export async function stageSuccessorEpoch({ runDir, transactionId, bundle, validateSuccessor }) {
  if (!TRANSACTION_ID.test(transactionId ?? '')) {
    fail('INVALID_RUN_STORE', 'staging transaction idが不正');
  }
  if (typeof validateSuccessor !== 'function') {
    fail('UNSUPPORTED_SUCCESSOR_SCHEMA', 'run_request.v2 successor verifierが未指定');
  }
  const committed = await readCommittedEpochStore(runDir);
  if (committed === null || bundle?.schema !== 'lattice.runtime_epoch_bundle.v1'
    || bundle.plan_epoch !== committed.pointer.plan_epoch + 1
    || bundle.predecessor_bundle_digest !== committed.bundle.bundle_digest) {
    fail('EPOCH_BUNDLE_CONFLICT', 'successor bundleがcommitted predecessorへbindしない');
  }
  const verdict = await validateSuccessor(structuredClone(bundle), {
    predecessor: structuredClone(committed.bundle),
    pointer: structuredClone(committed.pointer),
  });
  if (verdict !== true) {
    fail('UNSUPPORTED_SUCCESSOR_SCHEMA', 'run_request.v2 successor verifierがbundleを棄却した');
  }
  const stagingRoot = path.join(runDir, 'staging');
  const transactionDir = path.join(stagingRoot, transactionId);
  await mkdir(stagingRoot, { recursive: true });
  await fsyncDirectory(runDir);
  try {
    await mkdir(transactionDir);
    await writeDurableJson(path.join(transactionDir, 'epoch-bundle.json'), bundle);
    await fsyncDirectory(transactionDir);
    await fsyncDirectory(stagingRoot);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      await rm(transactionDir, { recursive: true, force: true });
      throw error;
    }
    const existing = await readRegularJson(path.join(transactionDir, 'epoch-bundle.json'), 'staged epoch bundle');
    if (existing.bundle_digest !== bundle.bundle_digest) {
      fail('EPOCH_BUNDLE_CONFLICT', '同一transactionへ異なるsuccessor bundleが存在する');
    }
  }
  return { transaction_id: transactionId, bundle_digest: bundle.bundle_digest };
}

export async function isManagedRunFrozen(runDir, events) {
  const committed = await readCommittedEpochStore(runDir);
  if (committed === null) return false;
  const lastFreeze = events.findLast((event) => event.kind === 'intake_frozen');
  const lastResume = events.findLast((event) => event.kind === 'intake_resumed'
    && event.plan_epoch === committed.pointer.plan_epoch);
  const hasFreeze = lastFreeze !== undefined
    && (lastResume === undefined || lastResume.sequence < lastFreeze.sequence);
  let gateValid = false;
  try {
    const gate = await readRegularJson(path.join(runDir, 'supervisor', 'write-gate.json'), 'supervisor write gate');
    gateValid = exactRecord(gate, [
      'schema', 'run_id', 'plan_epoch', 'gate_generation', 'release_barrier_digest',
      'controller_release_ack_digests', 'armed_lease_digests', 'previous_gate_digest',
      'committed_at', 'gate_digest',
    ]) && gate.schema === 'lattice.supervisor_write_gate.v1'
      && gate.run_id === committed.meta.run_id
      && gate.plan_epoch === committed.pointer.plan_epoch
      && selfDigestValid(gate, 'gate_digest');
  } catch (error) {
    if (!(error instanceof RuntimeEpochStoreError)) throw error;
  }
  return hasFreeze || !gateValid;
}
