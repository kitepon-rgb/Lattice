import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';
import { validateExpectedWorkerProcess } from './runtime-controller-protocol.mjs';
import { classifyObservedDiff } from './runtime-decision-verifier.mjs';
import { captureWorktreeDiff, detectCheckpointFindings } from './runtime-diff-observer.mjs';
import { acquireRuntimeLifecycleLock } from './runtime-lifecycle-lock.mjs';
import { observeManagedProcessStartIdentity } from './runtime-managed-supervisor.mjs';
import { ensureScriptedWorktree } from './runtime-scripted-worktree.mjs';
import {
  selfDigest, validateRuntimeBoundaryManifest, validateRuntimePlan,
} from './runtime-contracts.mjs';
import {
  readTodoIndependenceArtifact, readTodoStore, readTodoWitnessSet,
} from './todo-store.mjs';

export const PULL_RUN_META_SCHEMA = 'lattice.pull_run_meta.v1';
const PULL_EVENT_SCHEMA = 'lattice.pull_run_event.v1';
const PULL_EVENTS_FILE = 'pull-events.json';
const LEGACY_META_SCHEMAS = new Set(['lattice.run_meta.v1', 'lattice.run_meta.v2']);
const ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_FILE_BYTES = 8_388_608;
const execFileAsync = promisify(execFile);

export class PullRunError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PullRunError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) { throw new PullRunError(code, message, detail); }
function now() { return new Date().toISOString(); }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value, keys) {
  return plain(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function identifier(value) { return typeof value === 'string' && ID.test(value); }
function sha256(value) { return typeof value === 'string' && SHA256.test(value); }
function timestamp(value) {
  return typeof value === 'string' && TIMESTAMP.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function run(command, args, cwd, allowExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const output = {
        code, signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (signal === null && allowExitCodes.includes(code)) resolve(output);
      else reject(new PullRunError(
        'GIT_OBSERVATION_FAILED', `${command} ${args.join(' ')} failed`, output,
      ));
    });
  });
}

async function readJson(filePath, label) {
  let info;
  try { info = await lstat(filePath); }
  catch { fail('INVALID_RUN_STORE', `${label}を読めない`); }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) {
    fail('INVALID_RUN_STORE', `${label}が安全なbounded regular fileでない`);
  }
  let value;
  try { value = JSON.parse(await readFile(filePath, 'utf8')); }
  catch { fail('INVALID_RUN_STORE', `${label}がJSONとして不正`); }
  return value;
}

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeCanonicalNew(filePath, value) {
  await writeFile(filePath, `${canonicalizeArtifact(value)}\n`, { mode: 0o600, flag: 'wx' });
}

async function replaceCanonical(runDir, name, value) {
  const temporary = path.join(runDir, `.${name}-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(Buffer.from(`${canonicalizeArtifact(value)}\n`));
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path.join(runDir, name));
    await syncDirectory(runDir);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function validateMeta(meta) {
  return exact(meta, [
    'schema', 'run_id', 'plan_key', 'selection', 'equipment', 'created_at', 'meta_digest',
  ])
    && meta.schema === PULL_RUN_META_SCHEMA
    && identifier(meta.run_id) && identifier(meta.plan_key)
    && meta.selection === 'pull' && meta.equipment === 'detached-worktree'
    && typeof meta.created_at === 'string'
    && sha256(meta.meta_digest) && selfDigest(meta, 'meta_digest') === meta.meta_digest;
}

export async function inspectRunMode(runDir) {
  const meta = await readJson(path.join(runDir, 'run-meta.json'), 'run meta');
  if (meta?.schema === PULL_RUN_META_SCHEMA) {
    if (!validateMeta(meta)) fail('INVALID_RUN_STORE', 'pull run meta bindingが不正');
    for (const legacyName of ['request.json', 'plan-compile-result.json', 'events.json']) {
      try {
        await lstat(path.join(runDir, legacyName));
        fail('MIXED_RUN_STORE', `pull storeへlegacy artifactが混在: ${legacyName}`);
      } catch (error) {
        if (error instanceof PullRunError) throw error;
        if (error?.code !== 'ENOENT') fail('INVALID_RUN_STORE', `${legacyName}の存在確認に失敗`);
      }
    }
    return { mode: 'pull', meta };
  }
  if (LEGACY_META_SCHEMAS.has(meta?.schema)) {
    try {
      await lstat(path.join(runDir, PULL_EVENTS_FILE));
      fail('MIXED_RUN_STORE', `legacy storeへpull artifactが混在: ${PULL_EVENTS_FILE}`);
    } catch (error) {
      if (error instanceof PullRunError) throw error;
      if (error?.code !== 'ENOENT') fail('INVALID_RUN_STORE', `${PULL_EVENTS_FILE}の存在確認に失敗`);
    }
    return { mode: 'legacy', meta };
  }
  fail('UNSUPPORTED_RUN_STORE_SCHEMA', '未知のrun meta schema', { schema: meta?.schema ?? null });
}

function buildEvent({ events, meta, kind, taskId = null, payload }) {
  const event = {
    schema: PULL_EVENT_SCHEMA,
    run_id: meta.run_id,
    sequence: events.length,
    previous_event_digest: events.at(-1)?.event_digest ?? null,
    kind,
    task_id: taskId,
    recorded_at: now(),
    payload: structuredClone(payload),
    event_digest: '',
  };
  event.event_digest = selfDigest(event, 'event_digest');
  return event;
}

function verifyEvents(events, meta) {
  if (!Array.isArray(events) || events.length < 1) fail('INVALID_PULL_EVENT_CHAIN', 'pull event列が空');
  let previous = null;
  for (const [index, event] of events.entries()) {
    if (!exact(event, [
      'schema', 'run_id', 'sequence', 'previous_event_digest', 'kind', 'task_id',
      'recorded_at', 'payload', 'event_digest',
    ])
      || event.schema !== PULL_EVENT_SCHEMA || event.run_id !== meta.run_id
      || event.sequence !== index || event.previous_event_digest !== previous
      || !sha256(event.event_digest) || selfDigest(event, 'event_digest') !== event.event_digest
      || typeof event.kind !== 'string' || !(event.task_id === null || identifier(event.task_id))
      || !plain(event.payload)) {
      fail('INVALID_PULL_EVENT_CHAIN', `pull event chainが不正: sequence ${index}`);
    }
    previous = event.event_digest;
  }
}

async function readPullStore(runDir) {
  const { mode, meta } = await inspectRunMode(runDir);
  if (mode !== 'pull') fail('RUN_MODE_MISMATCH', 'pull commandへlegacy runを渡せない');
  const events = await readJson(path.join(runDir, PULL_EVENTS_FILE), 'pull events');
  verifyEvents(events, meta);
  return { meta, events };
}

function project(events, meta) {
  const intakes = new Map();
  let closed = false;
  for (const event of events) {
    if (event.kind === 'intake_recorded') {
      intakes.set(event.task_id, {
        task_id: event.task_id,
        sequence: event.sequence,
        ...structuredClone(event.payload),
        worker: null,
        accepted: null,
      });
    } else if (event.kind === 'intervention_changed') {
      const intake = intakes.get(event.task_id);
      if (intake) intake.intervention = structuredClone(event.payload.intervention);
    } else if (event.kind === 'worker_attached') {
      const intake = intakes.get(event.task_id);
      if (intake) intake.worker = { ...structuredClone(event.payload), stopped: false };
    } else if (event.kind === 'worker_stopped' || event.kind === 'worker_resumed') {
      const intake = intakes.get(event.task_id);
      if (intake?.worker) intake.worker.stopped = event.kind === 'worker_stopped';
    } else if (event.kind === 'task_accepted') {
      const intake = intakes.get(event.task_id);
      if (intake) intake.accepted = structuredClone(event.payload);
    } else if (event.kind === 'run_closed') closed = true;
  }
  return {
    run_id: meta.run_id,
    plan_key: meta.plan_key,
    plan_version: [...intakes.values()][0]?.plan_version ?? null,
    intakes: [...intakes.values()].sort((left, right) => left.sequence - right.sequence),
    closed,
  };
}

function publicIntake(intake) {
  return {
    task_id: intake.task_id,
    actor: structuredClone(intake.actor),
    plan_version: intake.plan_version,
    activation_event_digest: intake.activation_event_digest,
    base_sha: intake.base_sha,
    worktree_path: intake.worktree_path,
    packet_digest: intake.packet.packet_digest,
    intervention: structuredClone(intake.intervention),
    worker_attached: intake.worker !== null,
    worker_stopped: intake.worker?.stopped ?? false,
    accepted_head_sha: intake.accepted?.head_sha ?? null,
  };
}

function actorFromEnvironment(environment = process.env) {
  const actor = {
    host: environment.LATTICE_TODO_ACTOR_HOST,
    session: environment.LATTICE_TODO_ACTOR_SESSION,
    agent: environment.LATTICE_TODO_ACTOR_AGENT,
  };
  if (!Object.values(actor).every(identifier)) {
    fail('TODO_ACTOR_REQUIRED', 'intakeにはTodo startと同じactor host/session/agentが必要');
  }
  return actor;
}

function sameActor(left, right) {
  return left?.host === right.host && left?.session === right.session && left?.agent === right.agent;
}

function activeMember(store, planKey) {
  const member = store.members?.find((entry) => entry.plan?.plan_key === planKey);
  if (!member) fail('PLAN_NOT_ACTIVE', `active planが見つからない: ${planKey}`);
  return member;
}

function literalEvent(member, { kind, taskId, actor }) {
  return member.journal?.events?.findLast((event) => (
    event.kind === kind && event.task_id === taskId
      && event.plan_version === member.plan.plan_version && sameActor(event.actor, actor)
  )) ?? null;
}

function resolveStartBinding(store, meta, taskId, actor) {
  const member = activeMember(store, meta.plan_key);
  const task = member.tasks.find((entry) => entry.task_id === taskId);
  if (!task || task.status === 'pending') fail('TASK_NOT_STARTED', `ToDoがstartされていない: ${taskId}`);
  if (task.status !== 'in-progress') {
    fail('TASK_START_BINDING_UNSUPPORTED', `in-progressのliteral startだけをintakeできる: ${taskId}`);
  }
  const activation = literalEvent(member, { kind: 'start', taskId, actor });
  if (activation === null) {
    fail('TASK_START_BINDING_UNSUPPORTED', 'reopen/carry/importをliteral startへ推定しない');
  }
  return { member, task, activation };
}

async function headSha(repoRoot) {
  const result = await run('git', ['rev-parse', 'HEAD'], repoRoot);
  const value = result.stdout.trim();
  if (!SHA1.test(value)) fail('REPO_UNRESOLVED', 'canonical HEADを解決できない');
  return value;
}

function boundaryFor(artifact, taskId) {
  return artifact?.task_boundaries?.find((entry) => entry.task_id === taskId) ?? null;
}

function pathTouches(boundary, changed) {
  return boundary === changed
    || (boundary.endsWith('/') && changed.startsWith(boundary))
    || (changed.endsWith('/') && boundary.startsWith(changed));
}

async function boundaryVerdict({ repoRoot, store, member, meta, taskId, intakeBase }) {
  let artifact;
  let witnessSet;
  try {
    [artifact, witnessSet] = await Promise.all([
      readTodoIndependenceArtifact({ repoRoot, store, planKey: meta.plan_key }),
      readTodoWitnessSet({ repoRoot, planKey: meta.plan_key }),
    ]);
  } catch (error) {
    return { state: 'hold', reason: 'boundary_unverified', next_action: 'recompile_independence',
      detail: { cause: error?.code ?? 'artifact_read_failed' }, artifact: null, witnessSet: null };
  }
  const bindingValid = artifact !== null
    && artifact.schema === 'lattice.todo_independence.v3'
    && artifact.project_id === store.project_id
    && artifact.plan_key === meta.plan_key
    && artifact.plan_version === member.plan.plan_version
    && artifact.topology_digest === member.plan.topology_digest
    && witnessSet?.project_id === store.project_id
    && witnessSet?.plan_key === meta.plan_key
    && witnessSet?.witness_set_digest === artifact.witness_set_digest;
  if (!bindingValid) {
    return { state: 'hold', reason: 'boundary_unverified', next_action: 'recompile_independence',
      detail: { cause: 'artifact_binding_mismatch' }, artifact, witnessSet };
  }
  if (artifact.outcome !== 'compiled') {
    return { state: 'hold', reason: 'boundary_unverified', next_action: 'recompile_independence',
      detail: { cause: 'independence_outcome_unknown' }, artifact, witnessSet };
  }
  const boundary = boundaryFor(artifact, taskId);
  if (boundary === null || !Array.isArray(boundary.paths)) {
    return { state: 'hold', reason: 'boundary_unverified', next_action: 'declare_and_recompile',
      detail: { cause: 'task_boundary_missing' }, artifact, witnessSet };
  }
  if (!SHA1.test(artifact.base_sha)) {
    return { state: 'hold', reason: 'boundary_unverified', next_action: 'recompile_independence',
      detail: { cause: 'compiled_base_missing' }, artifact, witnessSet };
  }
  const reachable = await run(
    'git', ['merge-base', '--is-ancestor', artifact.base_sha, intakeBase], repoRoot, [0, 1, 128],
  );
  if (reachable.code !== 0) {
    return { state: 'hold', reason: 'version_drift', next_action: 'recompile_independence',
      detail: { cause: 'compiled_base_unreachable' }, artifact, witnessSet };
  }
  let changedPaths = [];
  if (artifact.base_sha !== intakeBase) {
    const changed = await run(
      'git', ['diff', '--name-only', '-z', `${artifact.base_sha}..${intakeBase}`], repoRoot,
    );
    changedPaths = changed.stdout.split('\0').filter(Boolean).sort();
  }
  const intersecting = changedPaths.filter((changed) => (
    boundary.paths.some((declared) => pathTouches(declared, changed))
  ));
  if (intersecting.length > 0) {
    return { state: 'hold', reason: 'version_drift', next_action: 'recompile_independence',
      detail: { cause: 'boundary_intersecting_drift', changed_paths: intersecting }, artifact, witnessSet };
  }
  const taskUnknowns = artifact.unknowns.filter((unknown) => unknown.task_id === taskId);
  if (taskUnknowns.length > 0) {
    return { state: 'hold', reason: 'boundary_unverified', next_action: 'resolve_unknown_and_recompile',
      detail: { cause: 'task_boundary_unknown', unknowns: taskUnknowns }, artifact, witnessSet };
  }
  return { state: 'none', reason: null, next_action: null,
    detail: { compiled_base_sha: artifact.base_sha, changed_path_count: changedPaths.length },
    artifact, witnessSet };
}

function buildManifest(witnessSet, taskId) {
  const witness = witnessSet?.manual_witness?.[taskId];
  if (!plain(witness)) fail('BOUNDARY_UNVERIFIED', `witnessが無い: ${taskId}`);
  const manifest = {
    schema: 'lattice.boundary_manifest.v2',
    todo_id: taskId,
    owns: structuredClone(witness.owns),
    reads: structuredClone(witness.reads),
    writes: structuredClone(witness.writes),
    resources: structuredClone(witness.resources),
    state_effects: structuredClone(witness.state_effects),
    unknowns: structuredClone(witness.unknowns),
    affected_tests: structuredClone(witness.affected_tests),
    ...(witness.lines === undefined ? {} : { lines: structuredClone(witness.lines) }),
    graph_evidence: [],
    witness_provenance: Object.fromEntries(
      witness.resources.map((resourceId) => [resourceId, 'manual_state_effect']),
    ),
    manifest_digest: '',
  };
  manifest.manifest_digest = selfDigest(manifest, 'manifest_digest');
  if (!validateRuntimeBoundaryManifest(manifest)) {
    fail('BOUNDARY_UNVERIFIED', `runtime boundary manifestへ変換できない: ${taskId}`);
  }
  return manifest;
}

function planningConstraint(artifact, taskId, state, member) {
  const active = new Set(state.intakes.filter((entry) => entry.accepted === null).map((entry) => entry.task_id));
  const conflict = artifact?.conflicts?.find((entry) => (
    entry.task_ids.includes(taskId)
      && entry.task_ids.some((other) => other !== taskId && active.has(other))
  ));
  if (conflict) return { kind: 'conflict', detail: structuredClone(conflict) };
  const precedence = artifact?.precedences?.find((entry) => (
    entry.to_task_id === taskId && (() => {
      const predecessorIntake = state.intakes.find((intake) => (
        intake.task_id === entry.from_task_id
      ));
      const predecessorDone = member.tasks.find((task) => (
        task.task_id === entry.from_task_id
      ))?.status === 'done';
      if (predecessorIntake !== undefined) return predecessorIntake.accepted === null;
      return !predecessorDone;
    })()
  ));
  if (precedence) return { kind: 'precedence', detail: structuredClone(precedence) };
  return null;
}

function interventionPayload(verdict, constraint = null) {
  if (verdict.state === 'none' && constraint === null) {
    return { state: 'none', reason: null, next_action: null, lease_state: 'granted', detail: verdict.detail };
  }
  return {
    state: 'hold',
    reason: constraint === null ? verdict.reason
      : constraint.kind === 'precedence' ? 'planning_precedence' : 'planning_conflict',
    next_action: constraint === null ? verdict.next_action
      : constraint.kind === 'precedence' ? 'wait_for_predecessor_accept'
        : 'wait_for_prior_intake_or_resolve_seam',
    lease_state: 'withheld',
    detail: constraint === null ? verdict.detail : { [constraint.kind]: constraint.detail },
  };
}

function packetFor({ meta, taskId, baseSha, manifest }) {
  const packet = {
    schema: 'lattice.pull_executor_packet.v1',
    run_id: meta.run_id,
    todo_id: taskId,
    base_sha: baseSha,
    scope: { writes: [...manifest.writes] },
    manifest_digest: manifest.manifest_digest,
    packet_digest: '',
  };
  packet.packet_digest = selfDigest(packet, 'packet_digest');
  return packet;
}

async function acquirePullLock(runDir, operation, requestId) {
  return acquireRuntimeLifecycleLock({
    lockPath: path.join(runDir, '.pull-intake.lock'),
    sessionNonceDigest: digestArtifact({ run_dir: runDir, schema: PULL_RUN_META_SCHEMA }),
    operation,
    requestId,
    timeoutMs: 0,
  });
}

async function appendEvent(runDir, current, event) {
  const next = [...current.events, event];
  verifyEvents(next, current.meta);
  await replaceCanonical(runDir, PULL_EVENTS_FILE, next);
  return { meta: current.meta, events: next };
}

export async function startPullRun({ repoRoot, runDir, runId, planKey, equipment }) {
  if (![repoRoot, runDir].every((value) => typeof value === 'string' && path.isAbsolute(value))
    || !identifier(runId) || !identifier(planKey) || equipment !== 'detached-worktree') {
    fail('INVALID_PULL_START', 'pull start入力が不正');
  }
  const temporary = await mkdtemp(path.join(path.dirname(runDir), `.${runId}.pull-tmp-`));
  const meta = {
    schema: PULL_RUN_META_SCHEMA,
    run_id: runId,
    plan_key: planKey,
    selection: 'pull',
    equipment,
    created_at: now(),
    meta_digest: '',
  };
  meta.meta_digest = selfDigest(meta, 'meta_digest');
  const events = [buildEvent({
    events: [], meta, kind: 'run_started',
    payload: { selection: 'pull', equipment, plan_key: planKey },
  })];
  try {
    try {
      await lstat(runDir);
      fail('RUN_EXISTS', 'run storeが既に存在する');
    } catch (error) {
      if (error instanceof PullRunError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
    await writeCanonicalNew(path.join(temporary, 'run-meta.json'), meta);
    await writeCanonicalNew(path.join(temporary, PULL_EVENTS_FILE), events);
    await rename(temporary, runDir);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    schema: 'lattice.pull_run_start_result.v1',
    outcome: 'started', run_id: runId, plan_key: planKey,
    selection: 'pull', equipment, intake_count: 0,
  };
}

export async function intakePullTask({ repoRoot, runDir, taskId, environment = process.env }) {
  if (!identifier(taskId)) fail('INVALID_TASK_ID', 'task idが不正');
  const actor = actorFromEnvironment(environment);
  const lock = await acquirePullLock(runDir, 'intake', `${taskId}-${randomUUID()}`);
  try {
    let current = await readPullStore(runDir);
    let state = project(current.events, current.meta);
    if (state.closed) fail('RUN_CLOSED', 'closed pull runへintakeできない');
    const existing = state.intakes.find((entry) => entry.task_id === taskId);
    if (existing !== undefined) {
      if (!sameActor(existing.actor, actor)) {
        fail('INTAKE_BINDING_CONFLICT', '同taskを別actor bindingでintakeできない');
      }
      const store = await readTodoStore({ repoRoot });
      const member = activeMember(store, current.meta.plan_key);
      const activation = literalEvent(member, { kind: 'start', taskId, actor });
      if (member.plan.plan_version !== existing.plan_version
        || member.plan.topology_digest !== existing.topology_digest
        || activation?.event_digest !== existing.activation_event_digest) {
        fail('INTAKE_BINDING_CONFLICT', '既存intakeのactivation/version bindingと一致しない');
      }
      const result = { schema: 'lattice.pull_intake_result.v1', outcome: 'intaked',
        already_intaked: true, ...publicIntake(state.intakes.find((entry) => entry.task_id === taskId)) };
      result.result_digest = digestArtifact(result);
      return result;
    }

    const store = await readTodoStore({ repoRoot });
    const { member, activation } = resolveStartBinding(store, current.meta, taskId, actor);
    const baseSha = await headSha(repoRoot);
    const verdict = await boundaryVerdict({
      repoRoot, store, member, meta: current.meta, taskId, intakeBase: baseSha,
    });
    let manifest;
    try { manifest = buildManifest(verdict.witnessSet, taskId); }
    catch (error) {
      if (!(error instanceof PullRunError)) throw error;
      manifest = {
        schema: 'lattice.boundary_manifest.v2', todo_id: taskId,
        owns: [], reads: [], writes: [], resources: [], state_effects: [], unknowns: [],
        affected_tests: [], graph_evidence: [], witness_provenance: {}, manifest_digest: '',
      };
      manifest.manifest_digest = selfDigest(manifest, 'manifest_digest');
      verdict.state = 'hold'; verdict.reason = 'boundary_unverified';
      verdict.next_action = 'declare_and_recompile'; verdict.detail = { cause: error.code };
    }
    const packet = packetFor({ meta: current.meta, taskId, baseSha, manifest });
    const worktreePath = await ensureScriptedWorktree({ repoRoot, runDir, packet });
    const firstVersion = state.plan_version;
    if (firstVersion !== null && firstVersion !== member.plan.plan_version) {
      verdict.state = 'hold'; verdict.reason = 'version_drift'; verdict.next_action = 'close_or_rebase_run';
      verdict.detail = { cause: 'run_plan_version_mismatch', run_version: firstVersion,
        task_version: member.plan.plan_version };
    }
    const constraint = verdict.state === 'none'
      ? planningConstraint(verdict.artifact, taskId, state, member) : null;
    const intervention = interventionPayload(verdict, constraint);

    // worktree供給後・event確定前にTodo正本を再読し、version/start bindingのTOCTOUを閉じる。
    const confirmation = await readTodoStore({ repoRoot });
    const confirmed = resolveStartBinding(confirmation, current.meta, taskId, actor);
    if (confirmed.member.plan.plan_version !== member.plan.plan_version
      || confirmed.member.plan.topology_digest !== member.plan.topology_digest
      || confirmed.activation.event_digest !== activation.event_digest) {
      intervention.state = 'hold'; intervention.reason = 'version_drift';
      intervention.next_action = 'retry_intake_on_active_version'; intervention.lease_state = 'withheld';
      intervention.detail = { cause: 'todo_binding_changed_during_intake', equipment_state: 'isolated' };
    }
    const payload = {
      actor, project_id: store.project_id,
      plan_version: member.plan.plan_version,
      topology_digest: member.plan.topology_digest,
      activation_event_digest: activation.event_digest,
      base_sha: baseSha,
      worktree_path: worktreePath,
      packet,
      manifest,
      independence_result_digest: verdict.artifact?.result_digest ?? null,
      witness_set_digest: verdict.witnessSet?.witness_set_digest ?? null,
      intervention,
    };
    current = await appendEvent(runDir, current, buildEvent({
      events: current.events, meta: current.meta, kind: 'intake_recorded', taskId, payload,
    }));
    const intake = project(current.events, current.meta).intakes.find((entry) => entry.task_id === taskId);
    const result = { schema: 'lattice.pull_intake_result.v1', outcome: 'intaked',
      already_intaked: false, ...publicIntake(intake) };
    result.result_digest = digestArtifact(result);
    return result;
  } finally { await lock.release(); }
}

async function observeProcessBinding(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) fail('INVALID_WORKER_PID', 'pidが正整数でない');
  const processStartIdentity = await observeManagedProcessStartIdentity(pid);
  const { stdout: pgidOut } = await execFileAsync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  const { stdout: argvOut } = await execFileAsync('/bin/ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  const processGroupId = Number(pgidOut.trim());
  const argv = argvOut.trim();
  const expected = { pid, process_group_id: processGroupId, process_start_identity: processStartIdentity };
  if (!validateExpectedWorkerProcess(expected) || argv.length === 0) {
    fail('WORKER_IDENTITY_MISMATCH', 'worker process identityを完全観測できない');
  }
  return {
    pid, process_group_id: processGroupId,
    process_start_identity: processStartIdentity,
    argv_digest: createHash('sha256').update(argv, 'utf8').digest('hex'),
  };
}

async function signalAttachedWorker(intake, signal) {
  if (intake.worker === null) return false;
  let observed;
  try { observed = await observeProcessBinding(intake.worker.pid); }
  catch { fail('WORKER_IDENTITY_MISMATCH', 'signal前にworkerを再認証できない'); }
  if (observed.process_start_identity.identity_digest
      !== intake.worker.process_start_identity.identity_digest
    || observed.argv_digest !== intake.worker.argv_digest
    || observed.process_group_id !== intake.worker.process_group_id) {
    fail('WORKER_IDENTITY_MISMATCH', 'signal前のlstart/argv/pgidがattach bindingと一致しない');
  }
  try { process.kill(intake.worker.pid, signal); }
  catch { fail('WORKER_SIGNAL_FAILED', `workerへ${signal}を送れない`); }
  return true;
}

function validateAttachInput(input) {
  if (!exact(input, [
    'schema', 'name', 'session', 'pid', 'started_identity', 'argv_digest', 'recorded_at',
  ])
    || input.schema !== 'lattice.pull_worker_attach_input.v1'
    || !identifier(input.name) || !identifier(input.session)
    || !Number.isSafeInteger(input.pid) || input.pid < 1
    || typeof input.started_identity !== 'string' || input.started_identity.length < 1
    || input.started_identity.length > 512
    || !sha256(input.argv_digest)
    || !timestamp(input.recorded_at)) {
    fail('INVALID_WORKER_ATTACH_INPUT', '生のexpected start identityとargv digestを持つattach inputが不正');
  }
}

export async function attachPullWorker({ runDir, taskId, input, environment = process.env }) {
  validateAttachInput(input);
  const actor = actorFromEnvironment(environment);
  const lock = await acquirePullLock(runDir, 'attach', `${taskId}-${randomUUID()}`);
  try {
    let current = await readPullStore(runDir);
    let state = project(current.events, current.meta);
    const intake = state.intakes.find((entry) => entry.task_id === taskId);
    if (!intake) fail('TASK_NOT_INTAKED', `taskがintakeされていない: ${taskId}`);
    if (!sameActor(intake.actor, actor)) fail('WORKER_ACTOR_MISMATCH', 'start/intake actorだけがattachできる');
    if (input.name !== actor.agent || input.session !== actor.session) {
      fail('WORKER_ACTOR_MISMATCH', 'attach inputの席identityがTodo actorと一致しない');
    }
    const binding = await observeProcessBinding(input.pid);
    if (binding.process_group_id !== input.pid
      || binding.process_start_identity.started_identity !== input.started_identity
      || binding.argv_digest !== input.argv_digest) {
      fail('WORKER_IDENTITY_MISMATCH', 'expected pid/lstart/argvと現在のOS観測が一致しない');
    }
    const occupied = state.intakes.find((entry) => (
      entry.task_id !== taskId && entry.accepted === null && entry.worker?.pid === input.pid
    ));
    if (occupied) {
      fail('WORKER_ALREADY_ATTACHED', `同じworkerは複数active intakeへattachできない: ${occupied.task_id}`);
    }
    if (intake.worker !== null) {
      if (digestArtifact(binding) !== digestArtifact({
        pid: intake.worker.pid, process_group_id: intake.worker.process_group_id,
        process_start_identity: intake.worker.process_start_identity,
        argv_digest: intake.worker.argv_digest,
      })) fail('WORKER_BINDING_CONFLICT', '同taskへ別worker identityをattachできない');
    } else {
      current = await appendEvent(runDir, current, buildEvent({
        events: current.events, meta: current.meta, kind: 'worker_attached', taskId,
        payload: binding,
      }));
      state = project(current.events, current.meta);
    }
    const refreshed = state.intakes.find((entry) => entry.task_id === taskId);
    if (refreshed.intervention.state === 'hold' && !refreshed.worker.stopped) {
      await signalAttachedWorker(refreshed, 'SIGSTOP');
      current = await appendEvent(runDir, current, buildEvent({
        events: current.events, meta: current.meta, kind: 'worker_stopped', taskId,
        payload: { reason: refreshed.intervention.reason },
      }));
    }
    const result = { schema: 'lattice.pull_worker_attach_result.v1', outcome: 'attached',
      task_id: taskId, pid: input.pid, stopped: project(current.events, current.meta)
        .intakes.find((entry) => entry.task_id === taskId).worker.stopped };
    result.result_digest = digestArtifact(result);
    return result;
  } finally { await lock.release(); }
}

function observationModel(state) {
  const intakes = state.intakes.filter((entry) => (
    entry.accepted === null && entry.intervention.state !== 'hold'
  ));
  const manifests = Object.fromEntries(intakes.map((entry) => [entry.task_id, entry.manifest]));
  const nodes = intakes.map((entry) => ({ todo_id: entry.task_id })).sort((l, r) => l.todo_id.localeCompare(r.todo_id));
  const plan = {
    schema: 'lattice.runtime_plan.v1',
    plan_ref: `pull-${state.run_id}-observation`, plan_epoch: 1,
    request_digest: digestArtifact({ run_id: state.run_id, task_ids: nodes.map((entry) => entry.todo_id) }),
    base_sha: intakes[0]?.base_sha ?? '0'.repeat(40),
    nodes, precedence: [], conflicts: [], capacity: { executors: Math.max(1, intakes.length) },
    manifest_digests: Object.fromEntries(nodes.map(({ todo_id: taskId }) => (
      [taskId, manifests[taskId].manifest_digest]
    ))),
    claim: { mode: 'exact_minimum' }, predecessor_refs: [], plan_digest: '',
  };
  plan.plan_digest = selfDigest(plan, 'plan_digest');
  if (!validateRuntimePlan(plan)) fail('CONTRACT_VIOLATION', 'pull observation planを構成できない');
  return { intakes, manifests, plan };
}

function doneBinding(store, intake) {
  const member = activeMember(store, intake.plan_key ?? store.members
    .find((entry) => entry.plan.plan_version === intake.plan_version)?.plan.plan_key);
  if (member.plan.plan_version !== intake.plan_version
    || member.plan.topology_digest !== intake.topology_digest) {
    fail('VERSION_DRIFT', 'accept時にplan version/topologyが変わっている');
  }
  const task = member.tasks.find((entry) => entry.task_id === intake.task_id);
  if (task?.status !== 'done') fail('TASK_NOT_DONE', `todo done前はacceptできない: ${intake.task_id}`);
  const event = literalEvent(member, { kind: 'done', taskId: intake.task_id, actor: intake.actor });
  if (event === null) fail('TASK_DONE_BINDING_UNSUPPORTED', 'same-version literal authored doneだけをacceptする');
  return event;
}

async function changeIntervention(runDir, current, taskId, intervention) {
  return appendEvent(runDir, current, buildEvent({
    events: current.events, meta: current.meta, kind: 'intervention_changed', taskId,
    payload: { intervention },
  }));
}

export async function acceptPullTask({ repoRoot, runDir, taskId, environment = process.env }) {
  const actor = actorFromEnvironment(environment);
  const lock = await acquirePullLock(runDir, 'accept', `${taskId}-${randomUUID()}`);
  try {
    let current = await readPullStore(runDir);
    let state = project(current.events, current.meta);
    const intake = state.intakes.find((entry) => entry.task_id === taskId);
    if (!intake) fail('TASK_NOT_INTAKED', `taskがintakeされていない: ${taskId}`);
    if (!sameActor(intake.actor, actor)) fail('WORKER_ACTOR_MISMATCH', 'intake actorだけがacceptできる');
    if (intake.accepted !== null) {
      const result = { schema: 'lattice.pull_accept_result.v1', outcome: 'accepted',
        already_accepted: true, task_id: taskId, head_sha: intake.accepted.head_sha,
        done_event_digest: intake.accepted.done_event_digest };
      result.result_digest = digestArtifact(result); return result;
    }
    if (intake.intervention.state === 'hold') {
      fail('TASK_HELD', 'hold中taskはacceptできない', {
        reason: intake.intervention.reason, next_action: intake.intervention.next_action,
      });
    }
    const store = await readTodoStore({ repoRoot });
    const done = doneBinding(store, { ...intake, plan_key: current.meta.plan_key });
    const checkpoint = await captureWorktreeDiff({
      worktreePath: intake.worktree_path, baseSha: intake.base_sha,
    });
    const model = observationModel(state);
    const packets = Object.fromEntries(model.intakes.map((entry) => [entry.task_id, entry.packet]));
    const direct = detectCheckpointFindings({
      todoId: taskId, checkpoint, packets, manifests: model.manifests,
      runningTodoIds: model.intakes.map((entry) => entry.task_id),
    }).findings;
    const observations = [];
    for (const entry of model.intakes) {
      if (entry.task_id === taskId) {
        observations.push({ todo_id: taskId, paths: checkpoint.diff.entries.map((item) => item.path) });
      } else if (entry.last_checkpoint?.diff?.entries) {
        observations.push({ todo_id: entry.task_id,
          paths: entry.last_checkpoint.diff.entries.map((item) => item.path) });
      }
    }
    const independent = classifyObservedDiff({
      plan: model.plan, manifests: model.manifests, observations,
      relevantTodoIds: model.intakes.map((entry) => entry.task_id),
    }).findings;
    const findings = [...direct, ...independent].filter((finding, index, all) => (
      index === all.findIndex((candidate) => digestArtifact(candidate) === digestArtifact(finding))
    ));
    if (findings.length > 0) {
      const affected = new Set(findings.flatMap((finding) => finding.todo_ids));
      for (const affectedTaskId of [...affected].sort()) {
        const affectedIntake = project(current.events, current.meta).intakes
          .find((entry) => entry.task_id === affectedTaskId);
        if (!affectedIntake || affectedIntake.accepted !== null) continue;
        const intervention = { state: 'hold', reason: 'runtime_conflict',
          next_action: 'inspect_findings_and_resolve_or_split', lease_state: 'revoked',
          detail: { findings: findings.filter((finding) => finding.todo_ids.includes(affectedTaskId)) } };
        current = await changeIntervention(runDir, current, affectedTaskId, intervention);
        const stoppedIntake = project(current.events, current.meta).intakes
          .find((entry) => entry.task_id === affectedTaskId);
        if (stoppedIntake.worker && !stoppedIntake.worker.stopped) {
          await signalAttachedWorker(stoppedIntake, 'SIGSTOP');
          current = await appendEvent(runDir, current, buildEvent({
            events: current.events, meta: current.meta, kind: 'worker_stopped', taskId: affectedTaskId,
            payload: { reason: 'runtime_conflict' },
          }));
        }
      }
      fail('RUNTIME_CONFLICT_HOLD', 'observed diffがruntime conflictを生成した', { findings });
    }
    current = await appendEvent(runDir, current, buildEvent({
      events: current.events, meta: current.meta, kind: 'task_accepted', taskId,
      payload: { done_event_digest: done.event_digest,
        checkpoint_digest: checkpoint.checkpoint_digest, checkpoint,
        head_sha: checkpoint.diff.head_sha },
    }));

    // 先着taskがacceptedになった後、planning conflictだけで待っていた後着を再投影する。
    state = project(current.events, current.meta);
    const planningMember = activeMember(store, current.meta.plan_key);
    for (const waiting of state.intakes.filter((entry) => (
      entry.accepted === null
        && ['planning_conflict', 'planning_precedence'].includes(entry.intervention.reason)
    ))) {
      const artifact = await readTodoIndependenceArtifact({ repoRoot, planKey: current.meta.plan_key });
      if (planningConstraint(artifact, waiting.task_id, state, planningMember) !== null) continue;
      const intervention = { state: 'none', reason: null, next_action: null,
        lease_state: 'granted', detail: { released_by_accepted_task: taskId } };
      current = await changeIntervention(runDir, current, waiting.task_id, intervention);
      const resumed = project(current.events, current.meta).intakes
        .find((entry) => entry.task_id === waiting.task_id);
      if (resumed.worker?.stopped) {
        await signalAttachedWorker(resumed, 'SIGCONT');
        current = await appendEvent(runDir, current, buildEvent({
          events: current.events, meta: current.meta, kind: 'worker_resumed', taskId: waiting.task_id,
          payload: { released_by_accepted_task: taskId },
        }));
      }
    }
    const result = { schema: 'lattice.pull_accept_result.v1', outcome: 'accepted',
      already_accepted: false, task_id: taskId, head_sha: checkpoint.diff.head_sha,
      done_event_digest: done.event_digest, checkpoint_digest: checkpoint.checkpoint_digest };
    result.result_digest = digestArtifact(result); return result;
  } finally { await lock.release(); }
}

export async function observePullRun(runDir) {
  const stored = await readPullStore(runDir);
  const state = project(stored.events, stored.meta);
  const output = {
    schema: 'lattice.pull_run_observation.v1', run_id: state.run_id,
    plan_key: state.plan_key, plan_version: state.plan_version,
    intakes: state.intakes.map(publicIntake),
    hold_count: state.intakes.filter((entry) => entry.intervention.state === 'hold').length,
    accepted_count: state.intakes.filter((entry) => entry.accepted !== null).length,
    closed: state.closed, event_count: stored.events.length,
    events_digest: digestArtifact(stored.events.map((event) => event.event_digest)),
  };
  output.result_digest = digestArtifact(output); return output;
}

export async function statusPullRun(runDir) {
  const observed = await observePullRun(runDir);
  const output = { ...observed, schema: 'lattice.pull_run_status.v1' };
  output.result_digest = digestArtifact(output); return output;
}

export async function interventionPullTask(runDir, taskId) {
  const stored = await readPullStore(runDir);
  const intake = project(stored.events, stored.meta).intakes.find((entry) => entry.task_id === taskId);
  if (!intake) fail('TASK_NOT_INTAKED', `taskがintakeされていない: ${taskId}`);
  const output = { schema: 'lattice.pull_intervention.v1', run_id: stored.meta.run_id,
    task_id: taskId, ...structuredClone(intake.intervention),
    worker_attached: intake.worker !== null, worker_stopped: intake.worker?.stopped ?? false };
  output.result_digest = digestArtifact(output); return output;
}

async function repositoryLanding(repoRoot, acceptedReceipts) {
  const push = await run('git', ['rev-parse', '--symbolic-full-name', '@{push}'], repoRoot, [0, 128]);
  let pushState = 'no_upstream'; let pushRef = null; let unpushedCommits = null;
  if (push.code === 0 && push.stdout.trim()) {
    pushRef = push.stdout.trim(); pushState = 'tracked';
    const count = await run('git', ['rev-list', '--count', `${pushRef}..HEAD`], repoRoot);
    unpushedCommits = Number(count.stdout.trim());
  }
  const remote = await run('git', ['remote'], repoRoot);
  const remoteNames = remote.stdout.split('\n').filter(Boolean);
  let defaultBranchRef = null;
  if (remoteNames.length === 1) {
    const symbolic = await run('git', ['symbolic-ref', '--quiet', `refs/remotes/${remoteNames[0]}/HEAD`], repoRoot, [0, 1]);
    if (symbolic.code === 0) defaultBranchRef = symbolic.stdout.trim();
  }
  const receipts = [];
  for (const receipt of acceptedReceipts) {
    let landingState = 'default_branch_unresolved'; let landed = false;
    if (defaultBranchRef !== null) {
      const ancestry = await run('git', ['merge-base', '--is-ancestor', receipt.head_sha, defaultBranchRef], repoRoot, [0, 1]);
      landed = ancestry.code === 0; landingState = landed ? 'landed' : 'not_landed';
    }
    receipts.push({ ...receipt, landing_state: landingState, landed });
  }
  return { receipts, repository: {
    default_branch_state: defaultBranchRef === null ? 'unresolved' : 'resolved',
    default_branch_ref: defaultBranchRef, push_state: pushState, push_ref: pushRef, unpushed_commits: unpushedCommits,
  } };
}

export async function landingPullRun({ repoRoot, runDir }) {
  const stored = await readPullStore(runDir);
  const state = project(stored.events, stored.meta);
  const accepted = state.intakes.filter((entry) => entry.accepted !== null).map((entry) => ({
    todo_id: entry.task_id,
    receipt_id: entry.accepted.done_event_digest,
    head_sha: entry.accepted.head_sha,
  }));
  const { receipts, repository } = await repositoryLanding(repoRoot, accepted);
  const output = { schema: 'lattice.run_landing_report.v1', run_id: state.run_id,
    landed: receipts.length > 0 && receipts.every((entry) => entry.landed),
    accepted_receipts: receipts, repository };
  output.result_digest = digestArtifact(output); return output;
}

export async function closePullRun({ repoRoot, runDir }) {
  const lock = await acquirePullLock(runDir, 'close', `close-${randomUUID()}`);
  try {
    let current = await readPullStore(runDir);
    const state = project(current.events, current.meta);
    if (state.closed) {
      const output = { schema: 'lattice.pull_run_close_result.v1', outcome: 'closed',
        run_id: state.run_id, already_closed: true, intake_count: state.intakes.length,
        landing: await landingPullRun({ repoRoot, runDir }) };
      output.result_digest = digestArtifact(output); return output;
    }
    if (state.intakes.length === 0) fail('RUN_EMPTY', 'intake 0件のpull runは正常closeできない');
    const incomplete = state.intakes.filter((entry) => entry.accepted === null);
    if (incomplete.length > 0) {
      fail('RUN_NOT_COMPLETE', 'pending/hold中intakeが残っている', {
        task_ids: incomplete.map((entry) => entry.task_id),
      });
    }
    current = await appendEvent(runDir, current, buildEvent({
      events: current.events, meta: current.meta, kind: 'run_closed',
      payload: { accepted_task_ids: state.intakes.map((entry) => entry.task_id).sort() },
    }));
    const output = { schema: 'lattice.pull_run_close_result.v1', outcome: 'closed',
      run_id: state.run_id, already_closed: false, intake_count: state.intakes.length,
      landing: await landingPullRun({ repoRoot, runDir }) };
    output.result_digest = digestArtifact(output); return output;
  } finally { await lock.release(); }
}

export async function listPullRunEntry(runDir) {
  const stored = await readPullStore(runDir);
  const state = project(stored.events, stored.meta);
  return { closed: state.closed, entry: {
    run_id: state.run_id, run_ref: null, base_sha: null,
    executor_adapter: null, selection: 'pull', plan_key: state.plan_key,
  } };
}
