import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { digestArtifact } from './artifact-contracts.mjs';
import { selfDigest } from './runtime-contracts.mjs';
import { validateProcessStartIdentity } from './runtime-controller-protocol.mjs';
import { captureWorktreeDiff } from './runtime-diff-observer.mjs';

const execFileAsync = promisify(execFile);
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class DirectOsObservationError extends Error {
  constructor(detail) {
    super(`HOLD_ACKS_INCOMPLETE: ${detail}`);
    this.name = 'DirectOsObservationError';
    this.code = 'HOLD_ACKS_INCOMPLETE';
    this.detail = detail;
  }
}

function fail(detail) {
  throw new DirectOsObservationError(detail);
}

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function identityFor(pid, startedIdentity) {
  const identity = {
    schema: 'lattice.process_start_identity.v1',
    platform: process.platform,
    pid,
    started_identity: startedIdentity,
    identity_digest: '',
  };
  identity.identity_digest = selfDigest(identity, 'identity_digest');
  return identity;
}

function validExpectedProcess(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === ['pid', 'process_group_id', 'process_start_identity'].sort().join('\0')
    && positivePid(value.pid) && positivePid(value.process_group_id)
    && validateProcessStartIdentity(value.process_start_identity)
    && value.process_start_identity.pid === value.pid;
}

function validateResolvedBinding(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !positivePid(value.process_pid) || !positivePid(value.process_group_id)
    || !validateProcessStartIdentity(value.process_start_identity)
    || value.process_start_identity.pid !== value.process_pid
    || !Array.isArray(value.process_children)
    || !value.process_children.every(validExpectedProcess)
    || !['static', 'dynamic_group'].includes(value.process_membership_policy ?? 'static')
    || typeof value.worktree_path !== 'string' || !path.isAbsolute(value.worktree_path)
    || typeof value.base_sha !== 'string' || !GIT_SHA1.test(value.base_sha)) {
    fail('observation binding不正');
  }
  const pids = [value.process_pid, ...value.process_children.map((child) => child.pid)];
  if (new Set(pids).size !== pids.length) fail('observation bindingのPID重複');
  if (value.process_children.some((child) => child.process_group_id !== value.process_group_id)) {
    fail('observation binding内のprocess group不一致');
  }
}

async function runPsSnapshot() {
  try {
    const { stdout } = await execFileAsync('/bin/ps', [
      '-axo', 'pid=,ppid=,pgid=,state=,lstart=',
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    fail(`ps観測失敗: ${error?.code ?? error?.message ?? 'unknown'}`);
  }
}

function parsePsSnapshot(stdout) {
  if (typeof stdout !== 'string') fail('ps観測結果が文字列でない');
  const records = new Map();
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) fail(`ps観測結果を解析できない: ${line}`);
    const pid = Number(match[1]);
    const record = {
      pid,
      parent_pid: Number(match[2]),
      process_group_id: Number(match[3]),
      raw_state: match[4],
      started_identity: match[5].trim(),
    };
    if (!positivePid(record.pid) || !Number.isSafeInteger(record.parent_pid) || record.parent_pid < 0
      || !positivePid(record.process_group_id) || record.started_identity.length === 0
      || records.has(pid)) fail('ps観測結果のprocess record不正');
    records.set(pid, record);
  }
  if (records.size === 0) fail('ps観測結果が空');
  return records;
}

async function takePsSnapshot(psSnapshot) {
  try {
    return parsePsSnapshot(await psSnapshot());
  } catch (error) {
    if (error instanceof DirectOsObservationError) throw error;
    fail(`ps観測失敗: ${error?.code ?? error?.message ?? 'unknown'}`);
  }
}

function descendantPids(records, rootPid) {
  const found = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records.values()) {
      if (record.pid !== rootPid && !found.has(record.pid)
        && (record.parent_pid === rootPid || found.has(record.parent_pid))) {
        found.add(record.pid);
        changed = true;
      }
    }
  }
  return found;
}

function stateOf(record) {
  if (record.raw_state.startsWith('T')) return 'stopped';
  if (record.raw_state.startsWith('Z')) return 'zombie';
  fail(`processがquiescedでない: ${record.pid} (${record.raw_state})`);
}

function verifyProcess(expected, actual, label) {
  if (!actual) fail(`${label} processが見つからない: ${expected.pid}`);
  const observedIdentity = identityFor(actual.pid, actual.started_identity);
  if (observedIdentity.identity_digest !== expected.process_start_identity.identity_digest) {
    fail(`${label} PID再利用又はstart identity差替え: ${expected.pid}`);
  }
  if (actual.process_group_id !== expected.process_group_id) {
    fail(`${label} process group不一致: ${expected.pid}`);
  }
  return {
    pid: actual.pid,
    parent_pid: actual.parent_pid,
    process_start_identity_digest: observedIdentity.identity_digest,
    process_group_id: actual.process_group_id,
    state: stateOf(actual),
  };
}

function sameDirectoryIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino;
}

async function inspectWorktree(worktreePath, expectedRealpath = null) {
  let info;
  let observedRealpath;
  try {
    info = await lstat(worktreePath);
    observedRealpath = await realpath(worktreePath);
  } catch (error) {
    fail(`worktree観測失敗: ${error?.code ?? error?.message ?? 'unknown'}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('worktreeがreal directoryでない');
  if (observedRealpath !== worktreePath) fail('worktree pathがsymlink又は非canonical');
  if (expectedRealpath !== null && observedRealpath !== expectedRealpath) fail('worktree realpath差替え');
  return { info, observedRealpath };
}

/** durable bindingへ保存するためのprocess start identityをDirect OSから取得する。 */
export async function observeDirectOsProcessStartIdentity(pid, { psSnapshot = runPsSnapshot } = {}) {
  if (!positivePid(pid) || typeof psSnapshot !== 'function') fail('process identity観測入力不正');
  const records = await takePsSnapshot(psSnapshot);
  const record = records.get(pid);
  if (!record) fail(`processが見つからない: ${pid}`);
  return identityFor(pid, record.started_identity);
}

/**
 * RuntimeManagedSupervisorのprocessObserverとして渡すDirect OS observer。
 * resolverはjournal由来のimmutable bindingへprocess_pid、start identity、PGID、
 * process_children、worktree_path、base_shaを補完する。
 */
export function createDirectOsProcessObserver({
  resolveObservationBinding,
  psSnapshot = runPsSnapshot,
  captureCheckpoint = captureWorktreeDiff,
} = {}) {
  if (typeof resolveObservationBinding !== 'function' || typeof psSnapshot !== 'function'
    || typeof captureCheckpoint !== 'function') fail('Direct OS observer dependency不足');
  return async ({ kind, binding, ack }) => {
    if (!['quiescence', 'rebind'].includes(kind)) fail('未知のDirect OS observation kind');
    const resolved = await resolveObservationBinding({
      binding: structuredClone(binding),
      ack: structuredClone(ack),
    });
    validateResolvedBinding(resolved);

    const records = await takePsSnapshot(psSnapshot);
    const expectedRoot = {
      pid: resolved.process_pid,
      process_group_id: resolved.process_group_id,
      process_start_identity: resolved.process_start_identity,
    };
    const root = verifyProcess(expectedRoot, records.get(resolved.process_pid), 'root');
    const actualDescendants = descendantPids(records, resolved.process_pid);
    const dynamicGroup = resolved.process_membership_policy === 'dynamic_group';
    const expectedChildren = dynamicGroup
      ? [...actualDescendants].map((pid) => {
        const record = records.get(pid);
        if (record.process_group_id !== resolved.process_group_id) {
          fail(`dynamic childがrootと別process groupに居る: ${pid}`);
        }
        return {
          pid,
          process_group_id: record.process_group_id,
          process_start_identity: identityFor(pid, record.started_identity),
        };
      })
      : resolved.process_children;
    const expectedDescendants = new Set(expectedChildren.map((child) => child.pid));
    if (!dynamicGroup) {
      for (const pid of expectedDescendants) {
        if (!actualDescendants.has(pid)) fail(`保存済みchildが見つからない: ${pid}`);
      }
      for (const pid of actualDescendants) {
        if (!expectedDescendants.has(pid)) fail(`未記録childを検出: ${pid}`);
      }
    }
    const expectedGroup = new Set([resolved.process_pid, ...actualDescendants]);
    for (const record of records.values()) {
      if (record.process_group_id === resolved.process_group_id && !expectedGroup.has(record.pid)) {
        fail(`未記録process group memberを検出: ${record.pid}`);
      }
    }
    const children = expectedChildren
      .map((expected) => verifyProcess(expected, records.get(expected.pid), 'child'))
      .sort((left, right) => left.pid - right.pid);

    const before = await inspectWorktree(resolved.worktree_path, resolved.worktree_realpath ?? null);
    let checkpoint;
    try {
      checkpoint = await captureCheckpoint({ worktreePath: before.observedRealpath, baseSha: resolved.base_sha });
    } catch (error) {
      if (error instanceof DirectOsObservationError) throw error;
      fail(`checkpoint観測失敗: ${error?.message ?? 'unknown'}`);
    }
    if (checkpoint === null || typeof checkpoint !== 'object' || !SHA256.test(checkpoint.checkpoint_digest ?? '')) {
      fail('checkpoint観測結果不正');
    }
    const after = await inspectWorktree(resolved.worktree_path, before.observedRealpath);
    if (!sameDirectoryIdentity(before.info, after.info)) fail('checkpoint観測中にworktreeが差替えられた');

    const processObservation = {
      schema: 'lattice.direct_process_observation.v2',
      root,
      children,
      process_group_id: resolved.process_group_id,
      quiesced: true,
    };
    const worktreeFingerprint = {
      schema: 'lattice.direct_worktree_fingerprint.v1',
      worktree_id: binding?.worktree_id ?? ack?.worktree_id,
      worktree_realpath: after.observedRealpath,
      checkpoint_digest: checkpoint.checkpoint_digest,
    };
    return {
      quiesced: true,
      process_observation_digest: digestArtifact(processObservation),
      worktree_fingerprint_digest: digestArtifact(worktreeFingerprint),
      final_checkpoint_digest: checkpoint.checkpoint_digest,
      observation: processObservation,
      worktree_fingerprint: worktreeFingerprint,
      checkpoint,
      write_enabled: false,
    };
  };
}

/** running=0の事実だけを表し、process停止証拠には昇格しないreceipt。 */
export function createEmptyRunningObservationReceipt({ runId, barrierId, frozenEventDigest }) {
  if (typeof runId !== 'string' || runId.length === 0
    || typeof barrierId !== 'string' || barrierId.length === 0
    || !SHA256.test(frozenEventDigest ?? '')) fail('empty running receipt入力不正');
  const receipt = {
    schema: 'lattice.empty_running_observation_receipt.v1',
    run_id: runId,
    barrier_id: barrierId,
    frozen_event_digest: frozenEventDigest,
    running_count: 0,
    establishes_process_quiescence: false,
    receipt_digest: '',
  };
  receipt.receipt_digest = selfDigest(receipt, 'receipt_digest');
  return receipt;
}
