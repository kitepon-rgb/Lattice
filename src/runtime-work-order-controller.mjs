import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants, readFileSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';
import {
  armStagedWriteLease,
  CONTROLLER_OPERATIONS,
  validateArmedWriteLease,
  validateControllerRequest,
  validateRuntimeAdapterCapabilities,
  validateRuntimeHeartbeatPolicy,
} from './runtime-controller-protocol.mjs';
import {
  selfDigest,
  validateExecutorPacket,
  validateExecutorReceipt,
} from './runtime-contracts.mjs';
import { captureWorktreeDiff } from './runtime-diff-observer.mjs';
import { validateSupervisorWriteGate } from './runtime-gate-store.mjs';
import { observeManagedProcessStartIdentity } from './runtime-managed-supervisor.mjs';
import {
  scriptedWorktreeId as workOrderWorktreeId,
  scriptedWorktreePath as workOrderWorktreePath,
} from './runtime-scripted-worktree.mjs';
import {
  createRunWorkOrder,
  validateRunWorkOrder,
  validateRunWorkReport,
} from './runtime-work-order-contracts.mjs';

const MAX_DOCUMENT_BYTES = 8_388_608;
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;
const execFileAsync = promisify(execFile);
const REQUEST_SCHEMA_TO_OPERATION = Object.freeze(Object.fromEntries([
  ['lattice.adapter_dispatch_request.v1', 'dispatch'],
  ['lattice.adapter_observe_request.v1', 'observe'],
  ['lattice.adapter_running_inventory_request.v1', 'inventory'],
  ['lattice.adapter_barrier_request.v1', 'barrier'],
  ['lattice.adapter_rebind_request.v1', 'rebind'],
  ['lattice.adapter_prepare_request.v1', 'prepare'],
  ['lattice.adapter_activate_request.v1', 'activate'],
  ['lattice.adapter_release_request.v1', 'release'],
  ['lattice.adapter_revoke_request.v1', 'revoke'],
]));

export class WorkOrderAdapterControllerError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'WorkOrderAdapterControllerError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new WorkOrderAdapterControllerError(code, message, detail);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function sign(value, field) {
  value[field] = '';
  value[field] = selfDigest(value, field);
  return value;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function controllerErrorArtifact(error, requestId = null) {
  const artifact = {
    schema: 'lattice.work_order_adapter_error.v1',
    code: error?.code ?? 'WORK_ORDER_CONTROLLER_FAILED',
    message: String(error?.message ?? error),
    request_id: typeof requestId === 'string' ? requestId : null,
    detail: plain(error?.detail) ? structuredClone(error.detail) : {},
    error_digest: '',
  };
  artifact.error_digest = selfDigest(artifact, 'error_digest');
  return artifact;
}

function validateBootstrap(value) {
  return exact(value, [
    'schema',
    'request_id',
    'run_id',
    'controller_socket_ref',
    'supervisor_socket_ref',
    'supervisor_session_nonce',
    'bootstrap_digest',
  ])
    && value.schema === 'lattice.adapter_controller_bootstrap.v1'
    && ID.test(value.request_id ?? '')
    && ID.test(value.run_id ?? '')
    && typeof value.controller_socket_ref === 'string'
    && /^supervisor\/controllers\/[0-9A-Za-z][0-9A-Za-z._-]{0,127}\.sock$/u
      .test(value.controller_socket_ref)
    && value.supervisor_socket_ref === 'supervisor/control.sock'
    && typeof value.supervisor_session_nonce === 'string'
    && value.supervisor_session_nonce.length >= 32
    && SHA256.test(value.bootstrap_digest ?? '')
    && selfDigest(value, 'bootstrap_digest') === value.bootstrap_digest;
}

function validateHandshakeRequest(value, bootstrap) {
  return exact(value, [
    'schema',
    'request_id',
    'run_id',
    'supervisor_session_nonce',
    'controller_socket_ref',
    'challenge',
    'request_digest',
  ])
    && value.schema === 'lattice.adapter_controller_handshake_request.v1'
    && ID.test(value.request_id ?? '')
    && value.run_id === bootstrap.run_id
    && value.supervisor_session_nonce === bootstrap.supervisor_session_nonce
    && value.controller_socket_ref === bootstrap.controller_socket_ref
    && typeof value.challenge === 'string'
    && value.challenge.length >= 32
    && SHA256.test(value.request_digest ?? '')
    && selfDigest(value, 'request_digest') === value.request_digest;
}

async function durableReplaceBytes(filePath, bytes, mode = 0o600) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}-${process.pid}.tmp`);
  let handle;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      mode,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
    await chmod(filePath, mode);
    const directoryHandle = await open(directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function readAndValidateGate(runDir, writeLease) {
  const gatePath = path.join(runDir, 'supervisor', 'write-gate.json');
  let gate;
  try {
    gate = JSON.parse(await readFile(gatePath, 'utf8'));
  } catch (error) {
    fail('WORK_ORDER_WRITE_GATE_REJECTED', '中央write gateを読めない', {
      message: String(error?.message ?? error),
    });
  }
  if (!validateSupervisorWriteGate(gate)
    || gate.run_id !== writeLease.run_id
    || gate.plan_epoch !== writeLease.plan_epoch
    || gate.gate_generation !== writeLease.gate_generation
    || gate.release_barrier_digest !== writeLease.release_barrier_digest
    || !gate.armed_lease_digests.includes(writeLease.lease_digest)) {
    fail('WORK_ORDER_WRITE_GATE_REJECTED', '中央write gateがarmed leaseを認可しない');
  }
}

/** 登録時のdigestへ束縛されたwork-order spool設定を読む。 */
async function readWorkOrderBehavior(repoRoot) {
  const descriptorPath = path.join(repoRoot, '.lattice', 'runtime', 'adapter-registry',
    'descriptors', 'work-order.json');
  let descriptor;
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
  } catch { fail('WORK_ORDER_BOOTSTRAP_INVALID', 'work-order adapterが未登録'); }
  if (typeof descriptor?.config_ref !== 'string' || typeof descriptor.config_digest !== 'string') {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'work-order adapter descriptorが不正');
  }
  const configPath = path.join(repoRoot, ...descriptor.config_ref.split('/'));
  let bytes;
  try {
    bytes = await readFile(configPath);
  } catch {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', '登録済みadapter configを読めない', {
      config_ref: descriptor.config_ref,
    });
  }
  if (sha256Bytes(bytes) !== descriptor.config_digest) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'adapter configが登録時のdigestと一致しない', {
      config_ref: descriptor.config_ref,
    });
  }
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'adapter configのJSONが不正');
  }
  if (!exact(config, ['schema', 'spool_dir'])
    || config.schema !== 'lattice.work_order_adapter_config.v1'
    || typeof config.spool_dir !== 'string'
    || !path.isAbsolute(config.spool_dir)) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'work-order adapter configがexact contractを満たさない');
  }
  let spoolDir;
  try { spoolDir = await realpath(config.spool_dir); }
  catch { fail('WORK_ORDER_BOOTSTRAP_INVALID', 'spool_dirを解決できない'); }
  const info = await lstat(spoolDir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'spool_dirがreal directoryでない');
  }
  await mkdir(path.join(spoolDir, 'orders'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(spoolDir, 'reports'), { recursive: true, mode: 0o700 });
  return { spoolDir };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readWorkReport(reportPath, packetDigest) {
  let bytes;
  try { bytes = await readFile(reportPath); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let report;
  try { report = JSON.parse(bytes.toString('utf8')); }
  catch { fail('WORK_ORDER_REPORT_INVALID', 'work reportのJSONが不正'); }
  if (!validateRunWorkReport(report)
    || report.packet_digest !== packetDigest
    || bytes.toString('utf8') !== `${canonicalizeArtifact(report)}\n`) {
    fail('WORK_ORDER_REPORT_INVALID', 'work reportがpacketへexact bindしない');
  }
  return report;
}

async function waitForWorkReport(reportPath, packetDigest, { timeoutMs = null } = {}) {
  const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;
  for (;;) {
    const report = await readWorkReport(reportPath, packetDigest);
    if (report !== null) return report;
    if (deadline !== null && Date.now() >= deadline) {
      fail('WORK_ORDER_REPORT_TIMEOUT', 'bridgeからwork reportが届かなかった');
    }
    await sleep(50);
  }
}

async function processGroupId(pid) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
    }));
  } catch { fail('WORK_ORDER_REPORT_INVALID', 'worker_pidをOS観測できない'); }
  const value = Number(stdout.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('WORK_ORDER_REPORT_INVALID', 'worker process groupを観測できない');
  }
  return value;
}

/** orderを書き、bridgeのreportを状態遷移の合図として待つ。 */
export async function spawnWorkOrderWorker({ packet, worktreePath, spoolDir }) {
  const order = createRunWorkOrder({ packet, worktreePath });
  if (!validateRunWorkOrder(order)) fail('WORK_ORDER_ORDER_INVALID', 'work order生成に失敗した');
  const orderPath = path.join(spoolDir, 'orders', `${packet.packet_digest}.json`);
  const reportPath = path.join(spoolDir, 'reports', `${packet.packet_digest}.json`);
  await durableReplaceBytes(orderPath, Buffer.from(`${canonicalizeArtifact(order)}\n`));
  const firstReport = await waitForWorkReport(reportPath, packet.packet_digest, { timeoutMs: 30_000 });
  const identity = await observeManagedProcessStartIdentity(firstReport.worker_pid)
    .catch(() => fail('WORK_ORDER_REPORT_INVALID', 'worker_pidのstart identityを観測できない'));
  const groupId = await processGroupId(firstReport.worker_pid);
  const completed = (async () => {
    let report = firstReport;
    while (report.state !== 'done') {
      await sleep(50);
      report = await waitForWorkReport(reportPath, packet.packet_digest);
      if (report.worker_pid !== firstReport.worker_pid) {
        fail('WORK_ORDER_REPORT_INVALID', 'work reportのworker_pidが途中で変化した');
      }
    }
    const checkpoint = await captureWorktreeDiff({
      worktreePath,
      baseSha: packet.base_sha,
    });
    return {
      observedDiff: checkpoint.diff.entries.map(({ path: changedPath, change }) => ({
        path: changedPath,
        change,
      })),
      checkpointDigest: checkpoint.checkpoint_digest,
    };
  })();
  return {
    pid: firstReport.worker_pid,
    process_group_id: groupId,
    process_start_identity: identity,
    completed,
  };
}

export async function createWorkOrderAdapterController({
  bootstrap,
  runDir,
  repoRoot,
  controllerSessionNonce = randomBytes(32).toString('hex'),
}) {
  if (!validateBootstrap(bootstrap)) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'controller bootstrapが不正');
  }
  const canonicalRunDir = await realpath(runDir);
  const canonicalRepoRoot = await realpath(repoRoot);
  if (path.resolve(canonicalRunDir, '..', '..', '..') !== canonicalRepoRoot) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'run storeとrepo rootのbindingが不正');
  }
  const controllerId = path.basename(bootstrap.controller_socket_ref, '.sock');
  if (!controllerId.startsWith('work-order-')
    || typeof controllerSessionNonce !== 'string'
    || controllerSessionNonce.length < 32) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'work-order controller identityが不正');
  }
  const capabilities = sign({
    schema: 'lattice.runtime_adapter_capabilities.v1',
    operations: [...CONTROLLER_OPERATIONS],
    process_observation: true,
    worktree_fingerprint: true,
    staged_write_lease: true,
    durable_dispatch: true,
    capabilities_digest: '',
  }, 'capabilities_digest');
  if (!validateRuntimeAdapterCapabilities(capabilities)) {
    fail('WORK_ORDER_CONTROLLER_INVALID', 'capabilities生成に失敗した');
  }
  const heartbeat = sign({
    schema: 'lattice.runtime_heartbeat_policy.v1',
    interval_ms: 1_000,
    ttl_ms: 10_000,
    disconnect_revokes_immediately: true,
    policy_digest: '',
  }, 'policy_digest');
  if (!validateRuntimeHeartbeatPolicy(heartbeat)) {
    fail('WORK_ORDER_CONTROLLER_INVALID', 'heartbeat policy生成に失敗した');
  }
  const descriptor = sign({
    schema: 'lattice.runtime_adapter_controller_descriptor.v1',
    controller_id: controllerId,
    adapter_kind: 'work-order',
    pid: process.pid,
    process_start_identity: await observeManagedProcessStartIdentity(process.pid),
    socket_ref: bootstrap.controller_socket_ref,
    controller_session_nonce_digest: digestArtifact(controllerSessionNonce),
    capabilities,
    heartbeat,
    descriptor_digest: '',
  }, 'descriptor_digest');
  const sessionNonceDigest = digestArtifact(bootstrap.supervisor_session_nonce);
  const behavior = await readWorkOrderBehavior(canonicalRepoRoot);
  const stagedLeases = new Map();
  const armedLeases = new Map();
  const preparedPackets = new Map();
  const tasks = new Map();
  const todoToHandle = new Map();
  let currentEpoch = 1;
  let registrationDigest = null;

  // worker poolのprocess寿命は外部adapterが所有する。controller closeで席を殺さない。
  const reapWorkers = () => {};

  const workerProcessOf = (task) => ({
    pid: task.worker.pid,
    process_group_id: task.worker.process_group_id,
    process_start_identity: structuredClone(task.worker.process_start_identity),
  });

  const persistReceipt = async (receipt) => {
    const payloadDigest = digestArtifact(receipt);
    const receiptPath = path.join(
      canonicalRunDir,
      'controllers',
      controllerId,
      'receipts',
      `${payloadDigest}.json`,
    );
    await durableReplaceBytes(
      receiptPath,
      Buffer.from(`${canonicalizeArtifact(receipt)}\n`),
    );
    return payloadDigest;
  };

  const responseFor = async (operation, request) => {
    if (!validateControllerRequest(operation, request)) {
      fail('WORK_ORDER_REQUEST_INVALID', `${operation} requestがprotocol contractを満たさない`);
    }
    if (registrationDigest !== null && request.registration_digest !== registrationDigest) {
      fail('WORK_ORDER_REGISTRATION_MISMATCH', 'controller registration digestが変化した');
    }
    registrationDigest = request.registration_digest;
    if (operation === 'prepare') {
      const packet = request.executor_packet;
      const lease = request.staged_lease;
      if (lease.run_id !== bootstrap.run_id || lease.todo_id !== packet.todo_id
        || lease.plan_epoch !== packet.plan_epoch || lease.packet_digest !== packet.packet_digest
        || lease.controller_registration_digest !== request.registration_digest
        || lease.supervisor_session_nonce_digest !== sessionNonceDigest) {
        fail('WORK_ORDER_LEASE_REJECTED', 'prepare packetとstaged leaseのbindingが不正');
      }
      const prior = stagedLeases.get(lease.lease_digest);
      if (prior !== undefined
        && canonicalizeArtifact(prior) !== canonicalizeArtifact(lease)) {
        fail('WORK_ORDER_LEASE_REJECTED', '同じdigestのstaged lease bytesが変化した');
      }
      stagedLeases.set(lease.lease_digest, structuredClone(lease));
      preparedPackets.set(packet.packet_digest, structuredClone(packet));
      currentEpoch = packet.plan_epoch;
      const ack = sign({
        schema: 'lattice.adapter_prepare_ack.v1',
        ack_id: `prepare-${packet.packet_digest.slice(0, 24)}`,
        registration_digest: request.registration_digest,
        controller_id: controllerId,
        run_id: bootstrap.run_id,
        todo_id: packet.todo_id,
        plan_epoch: packet.plan_epoch,
        packet_digest: packet.packet_digest,
        staged_lease_digest: lease.lease_digest,
        supervisor_session_nonce_digest: sessionNonceDigest,
        ack_digest: '',
      }, 'ack_digest');
      return sign({
        schema: 'lattice.adapter_prepare_response.v1',
        request_id: request.request_id,
        prepare_ack: ack,
        staged_lease_digest: lease.lease_digest,
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'activate') {
      if (request.staged_lease_digests.some((digest) => !stagedLeases.has(digest))) {
        fail('WORK_ORDER_LEASE_REJECTED', 'activateが未知のstaged leaseを含む');
      }
      const epochs = new Set(request.staged_lease_digests
        .map((digest) => stagedLeases.get(digest).plan_epoch));
      if (epochs.size > 1) fail('WORK_ORDER_LEASE_REJECTED', 'activate leaseのepochが混在する');
      if (epochs.size === 1) currentEpoch = [...epochs][0];
      const ack = sign({
        schema: 'lattice.adapter_ready_ack.v1',
        ack_id: `ready-${request.activation_digest.slice(0, 24)}`,
        registration_digest: request.registration_digest,
        controller_id: controllerId,
        run_id: bootstrap.run_id,
        plan_epoch: currentEpoch,
        activation_digest: request.activation_digest,
        staged_lease_digests: [...request.staged_lease_digests],
        supervisor_session_nonce_digest: sessionNonceDigest,
        ack_digest: '',
      }, 'ack_digest');
      return sign({
        schema: 'lattice.adapter_activate_response.v1',
        request_id: request.request_id,
        ready_ack: ack,
        observed_pointer_digest: request.committed_epoch_digest,
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'release') {
      const armed = [];
      for (const stagedDigest of request.staged_lease_digests) {
        const staged = stagedLeases.get(stagedDigest);
        if (staged === undefined) {
          fail('WORK_ORDER_LEASE_REJECTED', 'releaseが未知のstaged leaseを含む');
        }
        const lease = armStagedWriteLease(staged, {
          releaseBarrierDigest: request.release_barrier_digest,
          gateGeneration: request.gate_generation,
        });
        stagedLeases.delete(stagedDigest);
        armedLeases.set(lease.lease_digest, lease);
        armed.push(lease.lease_digest);
      }
      armed.sort();
      const ack = sign({
        schema: 'lattice.adapter_release_ack.v1',
        ack_id: `release-${request.release_barrier_digest.slice(0, 24)}`,
        registration_digest: request.registration_digest,
        controller_id: controllerId,
        run_id: bootstrap.run_id,
        plan_epoch: currentEpoch,
        release_barrier_digest: request.release_barrier_digest,
        gate_generation: request.gate_generation,
        armed_lease_digests: armed,
        supervisor_session_nonce_digest: sessionNonceDigest,
        ack_digest: '',
      }, 'ack_digest');
      return sign({
        schema: 'lattice.adapter_release_response.v1',
        request_id: request.request_id,
        release_ack: ack,
        armed_lease_digests: armed,
        observed_gate_generation: request.gate_generation,
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'dispatch') {
      const { packet, write_lease: writeLease } = request;
      if (!validateExecutorPacket(packet) || !validateArmedWriteLease(writeLease)
        || !armedLeases.has(writeLease.lease_digest)
        || writeLease.run_id !== bootstrap.run_id
        || writeLease.todo_id !== packet.todo_id
        || writeLease.plan_epoch !== packet.plan_epoch
        || writeLease.packet_digest !== packet.packet_digest
        || writeLease.controller_registration_digest !== request.registration_digest
        || writeLease.supervisor_session_nonce_digest !== sessionNonceDigest) {
        fail('WORK_ORDER_PACKET_REJECTED', 'dispatch packetとarmed leaseのbindingが不正');
      }
      const priorHandle = todoToHandle.get(packet.todo_id);
      if (priorHandle !== undefined) {
        const prior = tasks.get(priorHandle);
        if (prior.packet.packet_digest === packet.packet_digest
          && prior.lease.lease_digest === writeLease.lease_digest) {
          return sign({
            schema: 'lattice.adapter_dispatch_response.v2',
            request_id: request.request_id,
            executor_handle: prior.executorHandle,
            worktree_id: prior.worktreeId,
            packet_digest: packet.packet_digest,
            lease_digest: writeLease.lease_digest,
            worker_process: workerProcessOf(prior),
            response_digest: '',
          }, 'response_digest');
        }
        if (prior.state !== 'held') {
          fail('WORK_ORDER_DUPLICATE_DISPATCH', '同じTODOへ異なるpacketをdispatchできない');
        }
        // 長寿命worker poolのprocessを殺さず、barrierで止めた同じ席を再開して
        // successor orderへ載せ直す。process寿命は外部adapterの所有である。
        try { process.kill(prior.worker.pid, 'SIGCONT'); }
        catch (error) {
          fail('WORK_ORDER_EXECUTION_FAILED', 'held workerを再開できない', {
            pid: prior.worker.pid,
            reason: String(error?.code ?? error?.message ?? error),
          });
        }
        prior.state = 'superseded';
        todoToHandle.delete(packet.todo_id);
      }
      await readAndValidateGate(canonicalRunDir, writeLease);
      // canonical repoではなく自分の木へ書く。共有rootでは、書き込みの帰属をrootから
      // 決められないので早期警報もcheckpoint判定も成立しない。木はsupervisorが
      // dispatch前に用意する（監視を張るのがdispatchより前でなければ観測を取り逃す）。
      const worktreePath = workOrderWorktreePath({ runDir: canonicalRunDir, packet });
      try {
        const info = await lstat(worktreePath);
        if (!info.isDirectory()) throw new TypeError('not a directory');
      } catch {
        fail('WORK_ORDER_EXECUTION_FAILED', 'supervisorが用意したworktreeが無い', {
          worktree_path: worktreePath,
        });
      }
      const executorHandle = `work-order-${packet.packet_digest.slice(0, 24)}`;
      const worktreeId = workOrderWorktreeId(packet);
      // **dispatchで作業を終わらせない。** 終わらせると、走行中のTODOが1つも存在しない
      // runになり、実行時の観測——書き込みを見て、他のworkerとの重なりを掴む——が
      // 原理的に成立しない。dispatchは作業を起こして返り、完了はobserveが拾う。
      const progress = {
        schema: 'lattice.work_order_adapter_progress.v1',
        run_id: bootstrap.run_id,
        todo_id: packet.todo_id,
        executor_handle: executorHandle,
        worktree_id: worktreeId,
        state: 'running',
      };
      const worktreeReal = await realpath(worktreePath);
      // **workerは別processで起こす。** controller自身のprocessで作業すると、holdが
      // 要求する静止を証明できない——止めれば応答できず、止めなければ証明できない。
      // `detached`で独立process groupへ置く。同じgroupにcontrollerが居ると、直接OS観測が
      // 「未記録process group memberを検出」として正しく落とす。
      const spawned = await spawnWorkOrderWorker({
        packet, worktreePath: worktreeReal,
        spoolDir: behavior.spoolDir,
      });
      const task = {
        packet: structuredClone(packet),
        lease: structuredClone(writeLease),
        executorHandle,
        worktreeId,
        worktreePath: worktreeReal,
        receipt: null,
        payloadDigest: digestArtifact(progress),
        state: 'running',
        failure: null,
        settled: null,
        worker: spawned,
      };
      tasks.set(executorHandle, task);
      todoToHandle.set(packet.todo_id, executorHandle);
      task.settled = (async () => {
        try {
          const { observedDiff, checkpointDigest } = await spawned.completed;
          const receipt = sign({
            schema: 'lattice.executor_receipt.v1',
            receipt_id: `receipt-${packet.packet_digest.slice(0, 24)}`,
            executor_handle: executorHandle,
            worktree_id: worktreeId,
            base_sha: packet.base_sha,
            plan_epoch: packet.plan_epoch,
            packet_digest: packet.packet_digest,
            todo_id: packet.todo_id,
            checkpoint_digest: checkpointDigest,
            observed_diff: observedDiff,
            receipt_digest: '',
          }, 'receipt_digest');
          if (!validateExecutorReceipt(receipt)) {
            throw new TypeError('生成receiptがexecutor contractを満たさない');
          }
          task.payloadDigest = await persistReceipt(receipt);
          task.receipt = receipt;
          task.state = 'terminal';
        } catch (error) {
          // 失敗を走行中のまま放置しない。observeがtypedに落ちる形へ残す。
          task.failure = String(error?.detail?.reason ?? error?.message ?? error);
        }
      })();
      return sign({
        schema: 'lattice.adapter_dispatch_response.v2',
        request_id: request.request_id,
        executor_handle: executorHandle,
        worktree_id: worktreeId,
        packet_digest: packet.packet_digest,
        lease_digest: writeLease.lease_digest,
        worker_process: workerProcessOf(task),
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'observe') {
      const task = tasks.get(request.executor_handle);
      if (task === undefined
        || task.packet.plan_epoch !== request.expected_epoch
        || task.lease.lease_digest !== request.expected_lease_digest) {
        fail('WORK_ORDER_OBSERVATION_REJECTED', 'observe bindingがdispatch記録と一致しない');
      }
      // 走行中に落ちた作業を「まだ走っている」と言い続けない。
      if (task.failure !== null) {
        fail('WORK_ORDER_EXECUTION_FAILED', 'worker実行が失敗した', { reason: task.failure });
      }
      const observation = sign({
        schema: 'lattice.adapter_observation.v1',
        state: task.state,
        executor_handle: task.executorHandle,
        plan_epoch: task.packet.plan_epoch,
        lease_digest: task.lease.lease_digest,
        payload_digest: task.payloadDigest,
        observation_digest: '',
      }, 'observation_digest');
      return sign({
        schema: 'lattice.adapter_observe_response.v1',
        request_id: request.request_id,
        observation,
        observation_digest: observation.observation_digest,
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'inventory') {
      const runningBindings = [...tasks.values()]
        .filter((task) => task.state === 'running')
        .map((task) => ({
          todo_id: task.packet.todo_id,
          executor_handle: task.executorHandle,
          worktree_id: task.worktreeId,
          plan_epoch: task.packet.plan_epoch,
          packet_digest: task.packet.packet_digest,
          write_lease_id: task.lease.lease_id,
          controller_registration_digest: request.registration_digest,
        }))
        .sort((left, right) => left.todo_id.localeCompare(right.todo_id));
      return sign({
        schema: 'lattice.adapter_running_inventory_response.v1',
        request_id: request.request_id,
        running_bindings: runningBindings,
        inventory_digest: digestArtifact(runningBindings),
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'barrier') {
      const acks = [];
      for (const binding of request.running_bindings) {
        const task = tasks.get(binding.executor_handle);
        if (task === undefined || task.packet.todo_id !== binding.todo_id) {
          fail('WORK_ORDER_BARRIER_REJECTED', 'barrierが未知のrunning bindingを含む');
        }
        // **barrierは静止の宣言である。** worker processを実際に止め、止まった木を読む。
        // 走行中の作業を残したままackを返すと、「止まった」と言いながらworktreeが動き続ける。
        try {
          process.kill(task.worker.pid, 'SIGSTOP');
        } catch (error) {
          fail('WORK_ORDER_BARRIER_REJECTED', 'worker processを止められない', {
            pid: task.worker.pid, reason: String(error?.code ?? error?.message ?? error),
          });
        }
        task.state = 'held';
        // supervisorも同じ観測を独立に行い、3つのdigestの一致を要求する。**こちらが別の形で
        // 作ると、両者が別のものを見ていても気づけない。** 形はdirect OS observerの契約に
        // 揃え、入力（自分のprocess・自分の木）だけを独立に観測する。
        const checkpoint = await captureWorktreeDiff({
          worktreePath: task.worktreePath, baseSha: task.packet.base_sha,
        });
        const processObservationDigest = digestArtifact({
          schema: 'lattice.direct_process_observation.v2',
          root: {
            pid: task.worker.pid,
            parent_pid: process.pid,
            process_start_identity_digest: task.worker.process_start_identity.identity_digest,
            process_group_id: task.worker.process_group_id,
            state: 'stopped',
          },
          children: [],
          process_group_id: task.worker.process_group_id,
          quiesced: true,
        });
        const worktreeFingerprintDigest = digestArtifact({
          schema: 'lattice.direct_worktree_fingerprint.v1',
          worktree_id: task.worktreeId,
          worktree_realpath: task.worktreePath,
          checkpoint_digest: checkpoint.checkpoint_digest,
        });
        acks.push(sign({
          schema: 'lattice.executor_quiescence_ack.v1',
          ack_id: `barrier-${binding.packet_digest.slice(0, 24)}`,
          run_id: bootstrap.run_id,
          todo_id: binding.todo_id,
          executor_handle: binding.executor_handle,
          worktree_id: binding.worktree_id,
          plan_epoch: binding.plan_epoch,
          packet_digest: binding.packet_digest,
          write_lease_id: binding.write_lease_id,
          barrier_control_digest: request.barrier_control_digest,
          final_checkpoint_digest: checkpoint.checkpoint_digest,
          process_observation_digest: processObservationDigest,
          worktree_fingerprint_digest: worktreeFingerprintDigest,
          supervisor_session_nonce_digest: sessionNonceDigest,
          ack_digest: '',
        }, 'ack_digest'));
      }
      return sign({
        schema: 'lattice.adapter_barrier_response.v1',
        request_id: request.request_id,
        barrier_id: request.barrier_id,
        quiescence_acks: acks,
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'rebind') {
      const rebind = request.rebind_packet;
      const task = tasks.get(rebind.executor_handle);
      if (task === undefined || task.worktreeId !== rebind.worktree_id
        || task.packet.todo_id !== rebind.todo_id) {
        fail('WORK_ORDER_REBIND_REJECTED', 'rebind packetが既存taskへ帰属しない');
      }
      const staged = request.staged_lease;
      if (staged.todo_id !== rebind.todo_id || staged.plan_epoch !== rebind.new_plan_epoch
        || staged.packet_digest !== rebind.packet_digest) {
        fail('WORK_ORDER_REBIND_REJECTED', 'rebind packetとstaged leaseが一致しない');
      }
      stagedLeases.set(staged.lease_digest, structuredClone(staged));
      task.packet.plan_epoch = rebind.new_plan_epoch;
      currentEpoch = rebind.new_plan_epoch;
      const ack = sign({
        schema: 'lattice.executor_epoch_rebind_ack.v1',
        ack_id: `rebind-${rebind.packet_digest.slice(0, 24)}`,
        run_id: bootstrap.run_id,
        todo_id: rebind.todo_id,
        executor_handle: rebind.executor_handle,
        worktree_id: rebind.worktree_id,
        predecessor_epoch: rebind.new_plan_epoch - 1,
        successor_epoch: rebind.new_plan_epoch,
        // **holdされたworkerにreceiptは無い。** 作業を終えていないから止められているので、
        // 完了の記録を前提にできない。前任packetのdigestはdispatch時のpacketが持っている。
        predecessor_packet_digest: task.packet.packet_digest,
        rebind_packet_digest: rebind.packet_digest,
        new_write_lease_id: staged.lease_id,
        supervisor_session_nonce_digest: sessionNonceDigest,
        ack_digest: '',
      }, 'ack_digest');
      return sign({
        schema: 'lattice.adapter_rebind_response.v1',
        request_id: request.request_id,
        rebind_ack: ack,
        staged_lease_digest: staged.lease_digest,
        response_digest: '',
      }, 'response_digest');
    }
    if (operation === 'revoke') {
      const available = new Set([...stagedLeases.keys(), ...armedLeases.keys()]);
      if (request.lease_digests.some((digest) => !available.has(digest))) {
        fail('WORK_ORDER_REVOKE_REJECTED', 'revokeが未知のleaseを含む');
      }
      for (const leaseDigest of request.lease_digests) {
        stagedLeases.delete(leaseDigest);
        armedLeases.delete(leaseDigest);
      }
      for (const task of tasks.values()) {
        if (request.lease_digests.includes(task.lease.lease_digest)) task.state = 'held';
      }
      return sign({
        schema: 'lattice.adapter_revoke_response.v1',
        request_id: request.request_id,
        revoked_lease_digests: [...request.lease_digests],
        residual_processes: [],
        response_digest: '',
      }, 'response_digest');
    }
    fail('WORK_ORDER_UNKNOWN_OPERATION', `未知のcontroller operation: ${operation}`);
  };

  return Object.freeze({
    bootstrap: structuredClone(bootstrap),
    controllerId,
    controllerSessionNonce,
    descriptor: structuredClone(descriptor),
    heartbeat,
    reapWorkers,
    leaseSetDigest() {
      return digestArtifact([...stagedLeases.keys(), ...armedLeases.keys()].sort());
    },
    handshake(request) {
      if (!validateHandshakeRequest(request, bootstrap)) {
        fail('WORK_ORDER_HANDSHAKE_INVALID', 'handshake requestがbootstrapへbindしない');
      }
      return sign({
        schema: 'lattice.adapter_controller_handshake_response.v1',
        request_id: request.request_id,
        run_id: bootstrap.run_id,
        challenge_digest: digestArtifact(request.challenge),
        controller_session_nonce: controllerSessionNonce,
        descriptor,
        response_digest: '',
      }, 'response_digest');
    },
    async request(operation, request) {
      if (!CONTROLLER_OPERATIONS.includes(operation)) {
        fail('WORK_ORDER_UNKNOWN_OPERATION', `未知のcontroller operation: ${operation}`);
      }
      return responseFor(operation, request);
    },
  });
}

async function readBootstrapFd(fd = 3) {
  const bytes = readFileSync(fd);
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'bootstrap sizeが不正');
  }
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'bootstrapはJSON 1 documentでなければならない');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('WORK_ORDER_BOOTSTRAP_INVALID', 'bootstrap JSONが不正');
  }
  return value;
}

export async function runWorkOrderAdapterController({
  runDir = process.cwd(),
  bootstrap = null,
  stderr = process.stderr,
} = {}) {
  const resolvedBootstrap = bootstrap ?? await readBootstrapFd();
  const canonicalRunDir = await realpath(runDir);
  const repoRoot = await realpath(path.resolve(canonicalRunDir, '..', '..', '..'));
  const controller = await createWorkOrderAdapterController({
    bootstrap: resolvedBootstrap,
    runDir: canonicalRunDir,
    repoRoot,
  });
  const socketPath = path.join(canonicalRunDir, resolvedBootstrap.controller_socket_ref);
  const controllerDirectory = path.dirname(socketPath);
  await mkdir(controllerDirectory, { recursive: true, mode: 0o700 });
  await chmod(controllerDirectory, 0o700);
  let heartbeatTimer = null;
  let persistentSocket = null;
  let heartbeatSequence = 0;
  let registrationDigest = null;
  const send = (socket, document) => {
    socket.write(`${canonicalizeArtifact(document)}\n`);
  };
  const startHeartbeat = (socket, digest) => {
    persistentSocket = socket;
    registrationDigest = digest;
    if (heartbeatTimer !== null) return;
    heartbeatTimer = setInterval(() => {
      if (persistentSocket === null || persistentSocket.destroyed) return;
      heartbeatSequence += 1;
      send(persistentSocket, sign({
        schema: 'lattice.adapter_controller_heartbeat.v1',
        controller_id: controller.controllerId,
        registration_digest: registrationDigest,
        supervisor_session_nonce: resolvedBootstrap.supervisor_session_nonce,
        sequence: heartbeatSequence,
        lease_set_digest: controller.leaseSetDigest(),
        heartbeat_digest: '',
      }, 'heartbeat_digest'));
    }, controller.heartbeat.interval_ms);
    heartbeatTimer.unref();
  };
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let processing = Promise.resolve();
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_DOCUMENT_BYTES) {
        send(socket, controllerErrorArtifact(
          new WorkOrderAdapterControllerError(
            'WORK_ORDER_DOCUMENT_TOO_LARGE',
            'controller document上限を超えた',
          ),
        ));
        socket.destroy();
        return;
      }
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        processing = processing.then(async () => {
          let request;
          try {
            request = JSON.parse(line);
            if (request.schema === 'lattice.adapter_controller_handshake_request.v1') {
              send(socket, controller.handshake(request));
              return;
            }
            const operation = REQUEST_SCHEMA_TO_OPERATION[request.schema];
            if (operation === undefined) {
              fail('WORK_ORDER_UNKNOWN_OPERATION', `未知のrequest schema: ${String(request.schema)}`);
            }
            const response = await controller.request(operation, request);
            startHeartbeat(socket, request.registration_digest);
            send(socket, response);
          } catch (error) {
            send(socket, controllerErrorArtifact(error, request?.request_id));
            stderr.write(`${canonicalizeArtifact(controllerErrorArtifact(error, request?.request_id))}\n`);
            socket.destroy();
          }
        });
      }
    });
    socket.on('close', () => {
      if (socket === persistentSocket) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        persistentSocket = null;
      }
    });
  });
  server.on('error', (error) => {
    stderr.write(`${canonicalizeArtifact(controllerErrorArtifact(error))}\n`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // AF_UNIXのpath長上限へ一時repoのabsolute prefixを混入させない。supervisorも
    // run storeをcwdにして同じ固定relative refへ接続する。
    server.listen(resolvedBootstrap.controller_socket_ref, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    // 外部worker poolはadapter側が所有する。controllerはsocketだけを畳む。
    controller.reapWorkers();
    clearInterval(heartbeatTimer);
    persistentSocket?.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(socketPath, { force: true });
  };
  return Object.freeze({ controller, socketPath, close });
}
