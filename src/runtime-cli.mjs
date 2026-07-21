import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';
import { collectSensorEvidence } from './sensor-adapter.mjs';
import {
  compileRuntimePlanV1,
  evidenceFromCollectedOutcomes,
} from './runtime-front-end.mjs';
import {
  validateRunRequest,
  validateRuntimeBoundaryManifest,
  validateRuntimePlan,
  verifyRuntimePlanBinding,
  selfDigest,
} from './runtime-contracts.mjs';
import {
  buildNextRunEvent,
  closeRunIfComplete,
  initializeRunEvents,
} from './runtime-engine.mjs';
import {
  computeReadyFrontier,
  recomputeReceiptDecisions,
} from './runtime-decision-verifier.mjs';
import { verifyRunEventChain } from './runtime-event-store.mjs';
import { projectRuntimeState } from './runtime-projection.mjs';
import { verifySchedulabilityPlanV2 } from './schedulability-verifier-v2.mjs';
import {
  activateEpochOneStore,
  RuntimeEpochStoreError,
  isManagedRunFrozen,
  readCommittedEpochStore,
  validateRuntimeFindingRecord,
} from './runtime-multi-epoch-store.mjs';
import { createRuntimeControlRequest, validateRuntimeControlResponse } from './runtime-controller-protocol.mjs';
import { createRuntimeControlStore } from './runtime-control-store.mjs';
import { createRuntimeGateStore } from './runtime-gate-store.mjs';
import { acquireRuntimeLifecycleLock } from './runtime-lifecycle-lock.mjs';
import {
  ManagedRuntimeError,
  launchDurableSupervisor,
  observeManagedProcessStartIdentity,
  prepareManagedSupervisorRestart,
  resolveActiveRuntimePaths,
  sendRuntimeActivationRequest,
  sendRuntimeControlRequest,
} from './runtime-managed-supervisor.mjs';

/**
 * RC3-D CLI surface（ADR 0044 Decision 8）。
 *
 *   lattice plan compile --request <run-request.json>
 *   lattice plan verify  --request <run-request.json> --plan <plan.json>
 *   lattice run start    --request <run-request.json> --executor <adapter>
 *   lattice run observe  --run .lattice/runs/<run-id>
 *   lattice run status   --run .lattice/runs/<run-id>
 *   lattice run resume   --run .lattice/runs/<run-id>
 *   lattice run close    --run .lattice/runs/<run-id>
 *   lattice run abandon  --run .lattice/runs/<run-id> --reason <reason>
 *   lattice event verify --run .lattice/runs/<run-id>
 *
 * - stdout: versioned JSON 1行のみ。診断はstderr。
 * - exit 0: 成功（artifact refとdigestを含むversioned JSON）。
 * - exit 1: typed契約失敗。stderrへ`lattice.cli_error.v2` JSON 1行。
 * - exit 2: usage違反（未知command、引数の欠落・重複・余剰・順序不正）。
 * - `--executor`等の暗黙fallbackを持たず、未実装surfaceはusage違反として拒否する。
 *
 * plan verifyは保存planを信用せず、requestとfresh LatticeSensor観測からplanを
 * producerで再コンパイルしてdigest完全一致を要求し、さらにschedule minimumを
 * producer非依存の`verifySchedulabilityPlanV2`で再計算する（成功条件5）。
 */

const MAX_INPUT_BYTES = 8_388_608;
const COMPILE_RESULT_SCHEMA = 'lattice.plan_compile_result.v1';
const VERIFY_RESULT_SCHEMA = 'lattice.plan_verify_result.v1';
const CLI_ERROR_SCHEMA = 'lattice.cli_error.v2';
// 現役run storeは対象Git repo内のLattice-owned・ignored rootへ限定する。
const RUN_STORE_ROOT = ['.lattice', 'runs'];
const RUN_REF = /^\.lattice\/runs\/([0-9A-Za-z](?:[0-9A-Za-z._-]{0,127}))$/u;
const ABANDON_REASON = /^[0-9A-Za-z](?:[0-9A-Za-z._:-]{0,127})$/u;
const KNOWN_ADAPTERS = Object.freeze(['scripted', 'isolated-worktree', 'actual-agent']);

class CliContractError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'CliContractError';
    this.code = code;
    this.detail = detail;
  }
}

function usageFailure(stderr, args) {
  const received = args.length === 0 ? '(none)' : args.join(' ');
  stderr.write(`lattice: unsupported command or arguments: ${received}\n`);
  return 2;
}

function typedFailure(stderr, code, message, detail) {
  const payload = { schema: CLI_ERROR_SCHEMA, code, message };
  // ADR 0052 Decision 1: detailは非空plain objectの場合だけ出す（null・非object・空objectは省略）。
  if (detail !== null && typeof detail === 'object' && !Array.isArray(detail) && Object.keys(detail).length > 0) {
    payload.detail = detail;
  }
  stderr.write(`${JSON.stringify(payload)}\n`);
  return 1;
}

function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => resolve({ code: -1, stdout: '', stderr: String(error) }));
    child.once('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function readBoundedJson(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch {
    throw new CliContractError('INPUT_UNREADABLE', `${label}を読めない: ${filePath}`);
  }
  // FIFO・symlink・deviceを拒否し、regular fileのbytesだけを受ける。
  if (!info.isFile()) {
    throw new CliContractError('INPUT_UNREADABLE', `${label}がregular fileではない: ${filePath}`);
  }
  if (info.size > MAX_INPUT_BYTES) {
    throw new CliContractError('INPUT_TOO_LARGE', `${label}が${MAX_INPUT_BYTES} bytesを超える`);
  }
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new CliContractError('INPUT_UNREADABLE', `${label}を読めない: ${filePath}`);
  }
  // stat→read間の増大（TOCTOU）を実bytesで再検査する。
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new CliContractError('INPUT_TOO_LARGE', `${label}が${MAX_INPUT_BYTES} bytesを超える`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new CliContractError('INVALID_JSON', `${label}がJSONとしてparseできない`);
  }
}

async function resolveRepoBinding(cwd, request) {
  const head = await runGit(['rev-parse', 'HEAD'], cwd);
  if (head.code !== 0) {
    throw new CliContractError('REPO_UNRESOLVED', `cwdのgit HEADを解決できない: ${head.stderr.trim()}`);
  }
  const headSha = head.stdout.trim();
  if (headSha !== request.repo.base_sha) {
    throw new CliContractError(
      'STALE_BASE',
      `repo HEAD(${headSha})がrequest base_sha(${request.repo.base_sha})と一致しない`,
    );
  }
}

async function resolveRepoRoot(cwd) {
  const root = await runGit(['rev-parse', '--show-toplevel'], cwd);
  if (root.code !== 0 || root.stdout.trim().length === 0) {
    throw new CliContractError('REPO_UNRESOLVED', `cwdのgit rootを解決できない: ${root.stderr.trim()}`);
  }
  return path.resolve(root.stdout.trim());
}

async function requireIgnoredRunStore(repoRoot) {
  const probe = '.lattice/runs/.lattice-ignore-probe';
  const ignored = await runGit(['check-ignore', '-q', '--', probe], repoRoot);
  if (ignored.code !== 0) {
    throw new CliContractError(
      'RUN_STORE_NOT_IGNORED',
      '.lattice/runs/ がgit ignore対象ではない',
      { guidance: '.gitignoreへ `.lattice/runs/` を追加してから再実行する' },
    );
  }
}

async function requireSafeRunAncestors(repoRoot) {
  for (const relative of ['.lattice', '.lattice/runs']) {
    try {
      const state = await lstat(path.join(repoRoot, relative));
      if (state.isSymbolicLink() || !state.isDirectory()) {
        throw new CliContractError('INVALID_RUN_STORE', `${relative}が安全なdirectoryではない`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function resolveRunStore(cwd, runRef) {
  const normalized = runRef.replaceAll('\\', '/');
  const match = RUN_REF.exec(normalized);
  if (match === null || path.isAbsolute(runRef)) {
    throw new CliContractError(
      'INVALID_RUN_REF',
      'run refは `.lattice/runs/<run-id>` のrepo相対形式でなければならない',
    );
  }
  const repoRoot = await resolveRepoRoot(cwd);
  await requireSafeRunAncestors(repoRoot);
  return { repoRoot, runDir: path.join(repoRoot, ...RUN_STORE_ROOT, match[1]), runRef: normalized };
}

function canonicalNow() {
  return new Date().toISOString();
}

async function loadRequest(requestPath) {
  const request = await readBoundedJson(requestPath, 'run request');
  if (!validateRunRequest(request)) {
    throw new CliContractError('INVALID_RUN_REQUEST', 'run_request.v1 contractを満たさない');
  }
  return request;
}

async function compileFromRepo({ request, cwd, planRef, planEpoch, predecessorRefs }) {
  const collected = await collectSensorEvidence({
    cwd,
    querySet: request.sensor_query_set,
  });
  // 観測中にHEADが動いた場合、観測とbase束縛が別snapshotになるためreject
  // （TOCTOU窓の閉鎖。base再確認は観測の後に行う）。
  await resolveRepoBinding(cwd, request);
  const sensorEvidence = evidenceFromCollectedOutcomes({
    querySet: request.sensor_query_set,
    collected,
  });
  return compileRuntimePlanV1({
    request,
    sensorEvidence,
    planRef,
    planEpoch,
    predecessorRefs,
  });
}

async function planCompile({ requestPath, cwd, stdout }) {
  const request = await loadRequest(requestPath);
  await resolveRepoBinding(cwd, request);
  const result = await compileFromRepo({
    request,
    cwd,
    planRef: `plan-${request.request_id}-e1`,
    planEpoch: 1,
    predecessorRefs: [],
  });
  if (result.outcome !== 'dispatchable') {
    throw new CliContractError(result.code, 'dispatchable planを発行できない', result.detail);
  }
  const artifact = {
    schema: COMPILE_RESULT_SCHEMA,
    request_digest: request.request_digest,
    plan: result.plan,
    manifests: result.manifests,
    schedule: result.schedule,
    graph_digest: result.graph_digest,
  };
  artifact.result_digest = digestArtifact(artifact);
  stdout.write(`${JSON.stringify(artifact)}\n`);
  return 0;
}

async function planVerify({ requestPath, planPath, cwd, stdout }) {
  const request = await loadRequest(requestPath);
  const artifact = await readBoundedJson(planPath, 'plan artifact');
  if (artifact === null
    || typeof artifact !== 'object'
    || Array.isArray(artifact)
    || artifact.schema !== COMPILE_RESULT_SCHEMA) {
    throw new CliContractError('INVALID_PLAN_ARTIFACT', `schemaが${COMPILE_RESULT_SCHEMA}ではない`);
  }
  const { result_digest: claimedDigest, ...body } = artifact;
  if (claimedDigest !== digestArtifact(body)) {
    throw new CliContractError('INVALID_PLAN_ARTIFACT', 'result_digestが再計算と一致しない');
  }
  if (artifact.request_digest !== request.request_digest) {
    throw new CliContractError('STALE_PLAN', 'plan artifactが別のrequestに属する');
  }
  await resolveRepoBinding(cwd, request);
  const plan = artifact.plan;
  // 保存plan本体をschema・自己digestごと検証する。digest field文字列との比較だけに
  // 依存すると、bodyを改竄しdigestを残した再封印planが通る（review P0採用）。
  if (!validateRuntimePlan(plan)) {
    throw new CliContractError('INVALID_PLAN_ARTIFACT', '保存planがruntime_plan.v1 contractを満たさない');
  }
  const planNodeIds = plan.nodes.map((node) => node.todo_id);
  if (artifact.manifests === null || typeof artifact.manifests !== 'object' || Array.isArray(artifact.manifests)
    || Object.keys(artifact.manifests).sort().join('\0') !== [...planNodeIds].sort().join('\0')) {
    throw new CliContractError('INVALID_PLAN_ARTIFACT', 'manifestsのkey集合がplan nodesと一致しない');
  }
  for (const todoId of planNodeIds) {
    const manifest = artifact.manifests[todoId];
    if (!validateRuntimeBoundaryManifest(manifest)
      || manifest.manifest_digest !== plan.manifest_digests[todoId]) {
      throw new CliContractError('INVALID_PLAN_ARTIFACT', `manifestがplanのdigestと一致しない: ${todoId}`);
    }
  }
  // 再コンパイルはcompileと同一の導出規則を使う（保存planのref/epochを鵜呑みに
  // すると、self-digestを再計算したrelabel改竄がdigest比較を素通りする）。
  const recompiled = await compileFromRepo({
    request,
    cwd,
    planRef: `plan-${request.request_id}-e1`,
    planEpoch: 1,
    predecessorRefs: [],
  });
  if (recompiled.outcome !== 'dispatchable') {
    throw new CliContractError(
      recompiled.code,
      'fresh観測からの再コンパイルがdispatchableにならない',
      recompiled.detail,
    );
  }
  // 再コンパイル結果と保存planの構造完全一致（digest fieldでなくbody全体）。
  if (digestArtifact(recompiled.plan) !== digestArtifact(plan)) {
    throw new CliContractError('PLAN_DIGEST_MISMATCH', '再コンパイルplanが保存plan本体と一致しない');
  }
  for (const todoId of planNodeIds) {
    if (digestArtifact(recompiled.manifests[todoId]) !== digestArtifact(artifact.manifests[todoId])) {
      throw new CliContractError('PLAN_DIGEST_MISMATCH', `再コンパイルmanifestが保存値と一致しない: ${todoId}`);
    }
  }
  if (recompiled.graph_digest !== artifact.graph_digest) {
    throw new CliContractError('PLAN_DIGEST_MISMATCH', '再コンパイルgraph digestが保存値と一致しない');
  }
  const verified = verifySchedulabilityPlanV2(recompiled.graph, artifact.schedule);
  if (verified.outcome !== 'verified') {
    throw new CliContractError('SCHEDULE_NOT_MINIMUM', `独立verifierがscheduleを棄却した: ${JSON.stringify(verified)}`);
  }
  const output = {
    schema: VERIFY_RESULT_SCHEMA,
    outcome: 'verified',
    request_digest: request.request_digest,
    plan_digest: plan.plan_digest,
    graph_digest: artifact.graph_digest,
    minimum_feasible_waves: verified.minimum_feasible_waves,
  };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}


function runStorePath(cwd, runId) {
  return path.join(cwd, ...RUN_STORE_ROOT, runId);
}

async function readRunStore(runDir) {
  let runState;
  try {
    runState = await lstat(runDir);
  } catch {
    throw new CliContractError('INVALID_RUN_STORE', 'run store directoryを読めない');
  }
  if (runState.isSymbolicLink() || !runState.isDirectory()) {
    throw new CliContractError('INVALID_RUN_STORE', 'run storeが安全なdirectoryではない');
  }
  const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
  if (!Array.isArray(events)) {
    throw new CliContractError('INVALID_RUN_STORE', 'events.jsonがarrayではない');
  }
  const meta = await readBoundedJson(path.join(runDir, 'run-meta.json'), 'run meta');
  const compileArtifact = await readBoundedJson(
    path.join(runDir, 'plan-compile-result.json'), 'plan compile result',
  );
  const request = await readBoundedJson(path.join(runDir, 'request.json'), 'run request');
  const compileKeys = ['schema', 'request_digest', 'plan', 'manifests', 'schedule', 'graph_digest', 'result_digest'];
  const metaKeys = ['schema', 'run_id', 'executor_adapter', 'plan_digest'];
  const { result_digest: claimedCompileDigest, ...compileBody } = compileArtifact ?? {};
  const legacyMetaValid = meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    && Object.keys(meta).sort().join('\0') === metaKeys.sort().join('\0')
    && meta.schema === 'lattice.run_meta.v1'
    && meta.run_id === request.request_id
    && KNOWN_ADAPTERS.includes(meta.executor_adapter)
    && compileArtifact?.plan?.plan_digest === meta.plan_digest;
  const managed = meta?.schema === 'lattice.run_meta.v2'
    ? await readCommittedEpochStore(runDir)
    : null;
  const managedMetaValid = managed !== null
    && managed.meta.run_id === request.request_id
    && KNOWN_ADAPTERS.includes(managed.meta.executor_adapter)
    && managed.meta.created_plan_digest === compileArtifact.plan.plan_digest;
  if (!validateRunRequest(request)
    || (!legacyMetaValid && !managedMetaValid)
    || compileArtifact === null || typeof compileArtifact !== 'object' || Array.isArray(compileArtifact)
    || Object.keys(compileArtifact).sort().join('\0') !== compileKeys.sort().join('\0')
    || compileArtifact.schema !== COMPILE_RESULT_SCHEMA
    || claimedCompileDigest !== digestArtifact(compileBody)
    || compileArtifact.request_digest !== request.request_digest
    || !validateRuntimePlan(compileArtifact?.plan)
    || !verifyRuntimePlanBinding({ plan: compileArtifact.plan, request })
    ) {
    throw new CliContractError('INVALID_RUN_STORE', 'run storeのartifact bindingが不正');
  }
  if (managed === null) return { events, meta, compileArtifact, request, managed: null };
  return {
    events,
    meta: {
      schema: 'lattice.run_meta.v1',
      run_id: managed.meta.run_id,
      executor_adapter: managed.meta.executor_adapter,
      plan_digest: managed.bundle.plan.plan_digest,
    },
    compileArtifact: {
      ...compileArtifact,
      request_digest: managed.bundle.request.request_digest,
      plan: managed.bundle.plan,
      manifests: managed.bundle.manifests,
    },
    request: managed.bundle.request,
    managed,
  };
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600, flag: 'wx' });
}

async function writeCanonicalJsonFile(filePath, value) {
  await writeFile(filePath, `${canonicalizeArtifact(value)}\n`, { mode: 0o600, flag: 'wx' });
}

async function replaceEventsAtomically(runDir, events) {
  const temporaryPath = path.join(runDir, `.events-${process.pid}-${Date.now()}.tmp`);
  await writeJsonFile(temporaryPath, events);
  await rename(temporaryPath, path.join(runDir, 'events.json'));
}

async function replaceNamedJsonAtomically(runDir, name, value) {
  await durableReplaceBytes(runDir, name, Buffer.from(`${JSON.stringify(value, null, 1)}\n`));
}

async function replaceCanonicalJsonAtomically(directory, name, value) {
  await durableReplaceBytes(directory, name, Buffer.from(`${canonicalizeArtifact(value)}\n`));
}

async function durableReplaceBytes(directory, name, bytes) {
  const temporaryPath = path.join(directory, `.${name}-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, path.join(directory, name));
    const directoryHandle = await open(directory, fsConstants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function withLifecycleLock(runDir, action) {
  // managed mutationの正本lockはdurable supervisorが所有する。これはunmanaged/launch CLI競合だけを塞ぐ。
  const lockPath = path.join(runDir, '.cli-lifecycle.lock');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new CliContractError('RUN_BUSY', 'run lifecycle操作が既に進行中');
    }
    throw error;
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function runStart({ requestPath, executorAdapter, cwd, stdout }) {
  // --executor省略時の暗黙fallbackは持たない（Decision 8）。未知adapterはtyped reject。
  if (!KNOWN_ADAPTERS.includes(executorAdapter)) {
    throw new CliContractError('UNKNOWN_ADAPTER', `未知のexecutor adapter: ${executorAdapter}`);
  }
  const request = await loadRequest(requestPath);
  if (!Array.isArray(request.executor_capability?.adapters)
    || !request.executor_capability.adapters.includes(executorAdapter)) {
    throw new CliContractError('UNKNOWN_ADAPTER', 'requestのexecutor_capabilityに含まれないadapter');
  }
  const repoRoot = await resolveRepoRoot(cwd);
  await requireSafeRunAncestors(repoRoot);
  await requireIgnoredRunStore(repoRoot);
  await resolveRepoBinding(repoRoot, request);
  const result = await compileFromRepo({
    request,
    cwd: repoRoot,
    planRef: `plan-${request.request_id}-e1`,
    planEpoch: 1,
    predecessorRefs: [],
  });
  if (result.outcome !== 'dispatchable') {
    throw new CliContractError(result.code, 'dispatchable planを発行できない', result.detail);
  }
  const compileArtifact = {
    schema: COMPILE_RESULT_SCHEMA,
    request_digest: request.request_digest,
    plan: result.plan,
    manifests: result.manifests,
    schedule: result.schedule,
    graph_digest: result.graph_digest,
  };
  compileArtifact.result_digest = digestArtifact(compileArtifact);
  const events = initializeRunEvents({
    runId: request.request_id,
    request,
    plan: result.plan,
    manifests: result.manifests,
    recordedAt: new Date().toISOString().replace(/\.\d+Z$/u, '.000Z'),
  });
  const runDir = runStorePath(repoRoot, request.request_id);
  await mkdir(path.dirname(runDir), { recursive: true });
  const temporaryDir = await mkdtemp(path.join(path.dirname(runDir), `.${request.request_id}.tmp-`));
  try {
    await lstat(runDir);
    await rm(temporaryDir, { recursive: true, force: true });
    throw new CliContractError('RUN_EXISTS', 'run storeが既に存在する');
  } catch (error) {
    if (error instanceof CliContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  const meta = {
    schema: 'lattice.run_meta.v1',
    run_id: request.request_id,
    executor_adapter: executorAdapter,
    plan_digest: result.plan.plan_digest,
  };
  try {
    await writeJsonFile(path.join(temporaryDir, 'request.json'), request);
    await writeJsonFile(path.join(temporaryDir, 'plan-compile-result.json'), compileArtifact);
    await writeJsonFile(path.join(temporaryDir, 'events.json'), events);
    await writeJsonFile(path.join(temporaryDir, 'run-meta.json'), meta);
    await rename(temporaryDir, runDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      throw new CliContractError('RUN_EXISTS', 'run storeが既に存在する');
    }
    throw error;
  }
  const output = {
    schema: 'lattice.run_start_result.v1',
    run_id: request.request_id,
    run_dir: path.relative(repoRoot, runDir),
    executor_adapter: executorAdapter,
    plan_digest: result.plan.plan_digest,
    events_digest: digestArtifact(events.map(({ event_digest: digest }) => digest)),
  };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

async function runObserve({ runDir, stdout }) {
  const { events } = await readRunStore(runDir);
  const chain = verifyRunEventChain({ events });
  if (!chain.valid) {
    throw new CliContractError('EVENT_CHAIN_INVALID', 'event chainが不正', { failed_conditions: chain.failed_conditions });
  }
  const state = projectRuntimeState({ events });
  const output = {
    schema: 'lattice.run_observation.v1',
    running: state.running,
    accepted: state.accepted,
    terminal: state.terminal,
    hold_count: state.holds.length,
    conflict_count: state.conflicts.length,
    freeze_active: state.freeze !== null,
    closed: state.closed,
    event_count: events.length,
    events_digest: digestArtifact(events.map(({ event_digest: digest }) => digest)),
  };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

async function runStatus({ runDir, stdout }) {
  const { events, meta, compileArtifact, managed } = await readRunStore(runDir);
  const chain = verifyRunEventChain({ events });
  if (!chain.valid) {
    throw new CliContractError('EVENT_CHAIN_INVALID', 'event chainが不正', { failed_conditions: chain.failed_conditions });
  }
  const state = projectRuntimeState({ events });
  const computedFrontier = computeReadyFrontier({ plan: compileArtifact.plan, events });
  const managedFrozen = managed === null ? false : await isManagedRunFrozen(runDir, events);
  const frontier = managedFrozen ? { dispatchable: [] } : computedFrontier;
  const output = {
    schema: 'lattice.run_status.v1',
    run_id: meta.run_id,
    executor_adapter: meta.executor_adapter,
    plan_digest: compileArtifact.plan.plan_digest,
    running: state.running,
    accepted: state.accepted,
    dispatchable: frontier.dispatchable,
    freeze_active: state.freeze !== null,
    closed: state.closed,
    event_count: events.length,
  };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

async function runList({ cwd, stdout }) {
  const repoRoot = await resolveRepoRoot(cwd);
  await requireSafeRunAncestors(repoRoot);
  const root = path.join(repoRoot, ...RUN_STORE_ROOT);
  let entries;
  try {
    const rootState = await lstat(root);
    if (rootState.isSymbolicLink() || !rootState.isDirectory()) {
      throw new CliContractError('INVALID_RUN_STORE', '.lattice/runsが安全なdirectoryではない');
    }
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') entries = [];
    else throw error;
  }
  const activeRuns = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !RUN_REF.test(`.lattice/runs/${entry.name}`)) {
      throw new CliContractError('INVALID_RUN_STORE', `不正なrun store entry: ${entry.name}`);
    }
    const runDir = path.join(root, entry.name);
    const { events, meta, request } = await readRunStore(runDir);
    requireValidEventChain(events);
    if (!projectRuntimeState({ events }).closed) {
      activeRuns.push({
        run_id: meta.run_id,
        run_ref: `.lattice/runs/${entry.name}`,
        base_sha: request.repo.base_sha,
        executor_adapter: meta.executor_adapter,
      });
    }
  }
  const output = { schema: 'lattice.run_list.v1', active_runs: activeRuns };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

function requireValidEventChain(events) {
  const chain = verifyRunEventChain({ events });
  if (!chain.valid) {
    throw new CliContractError('EVENT_CHAIN_INVALID', 'event chainが不正', { failed_conditions: chain.failed_conditions });
  }
}

async function runResume({ runDir, repoRoot, stdout }) {
  const { events, meta, compileArtifact, request, managed } = await readRunStore(runDir);
  requireValidEventChain(events);
  const state = projectRuntimeState({ events });
  if (state.closed) {
    throw new CliContractError('RUN_CLOSED', 'closed runはresumeできない');
  }
  await resolveRepoBinding(repoRoot, request);
  // managed write gateの完全検証とdispatchはsupervisorだけが所有する。read-only
  // resumeがCLIからleaseを再認可しないよう、managed runでは常に空frontierを返す。
  const managedFrozen = managed === null ? false : await isManagedRunFrozen(runDir, events);
  const frontier = managedFrozen
    ? { dispatchable: [] }
    : computeReadyFrontier({ plan: compileArtifact.plan, events });
  const output = {
    schema: 'lattice.run_resume_result.v1',
    outcome: 'resumable',
    run_id: meta.run_id,
    executor_adapter: meta.executor_adapter,
    dispatchable: frontier.dispatchable,
    running: state.running,
    accepted: state.accepted,
    event_count: events.length,
  };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

async function runClose({ runDir, repoRoot, stdout, requestId = null }) {
  return withLifecycleLock(runDir, async () => {
    const { events, meta, compileArtifact, request, managed } = await readRunStore(runDir);
    requireValidEventChain(events);
    const initialState = projectRuntimeState({ events });
    let next = events;
    let alreadyClosed = initialState.closed;
    const existingClose = events.findLast((event) => event.kind === 'run_closed');
    if (alreadyClosed && existingClose?.payload?.outcome === 'abandoned') {
      throw new CliContractError('RUN_ABANDONED', 'abandoned runは正常closeへ変更できない');
    }
    await resolveRepoBinding(repoRoot, request);
    if (!alreadyClosed) {
      const closed = closeRunIfComplete({
        runId: meta.run_id,
        plan: compileArtifact.plan,
        events,
        recordedAt: canonicalNow(),
      });
      if (!closed.closed) {
        throw new CliContractError(
          'RUN_NOT_COMPLETE',
          '全TODOのreceipt accepted前はrunを正常closeできない',
          { guidance: 'run statusで未完了TODOを確認するか、run abandonを明示実行する' },
        );
      }
      if (managed !== null) {
        await runManagedControl({ runDir, runRef: path.relative(repoRoot, runDir),
          operation: 'close', artifactDigest: null, stdout, shutdownReason: 'normal-close',
          emit: false, requestId });
        next = (await readRunStore(runDir)).events;
      } else {
        next = closed.events;
        await replaceEventsAtomically(runDir, next);
      }
    }
    const output = {
      schema: 'lattice.run_close_result.v1',
      outcome: 'closed',
      run_id: meta.run_id,
      already_closed: alreadyClosed,
      event_count: next.length,
      events_digest: digestArtifact(next.map(({ event_digest: digest }) => digest)),
    };
    output.result_digest = digestArtifact(output);
    stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  });
}

async function runAbandon({ runDir, runRef, reason, stdout, requestId = null }) {
  if (!ABANDON_REASON.test(reason)) {
    throw new CliContractError('INVALID_ABANDON_REASON', 'reasonは128文字以下の識別子でなければならない');
  }
  return withLifecycleLock(runDir, async () => {
    const current = await readRunStore(runDir);
    const { events, meta, compileArtifact } = current;
    requireValidEventChain(events);
    const state = projectRuntimeState({ events });
    if (state.closed) {
      const existing = events.findLast((event) => event.kind === 'run_closed');
      if (current.managed !== null && existing?.payload?.outcome === 'abandoned'
        && existing.payload.reason === reason) {
        const output = { schema: 'lattice.run_abandon_result.v1', outcome: 'abandoned', reason,
          run_id: meta.run_id, event_count: events.length,
          events_digest: digestArtifact(events.map(({ event_digest: value }) => value)) };
        output.result_digest = digestArtifact(output); stdout.write(`${JSON.stringify(output)}\n`); return 0;
      }
      throw new CliContractError('RUN_CLOSED', 'closed runはabandonできない');
    }
    let next = [...events];
    if (current.managed !== null) {
      await runManagedControl({ runDir, runRef, operation: 'abandon', artifactDigest: null,
        shutdownReason: reason, stdout, emit: false, requestId });
      next = (await readRunStore(runDir)).events;
    } else next.push(buildNextRunEvent({
      events: next,
      runId: meta.run_id,
      kind: 'run_closed',
      planEpoch: compileArtifact.plan.plan_epoch,
      subject: { kind: 'runtime_plan', ref: compileArtifact.plan.plan_ref },
      payload: { outcome: 'abandoned', reason, accepted: state.accepted },
      recordedAt: canonicalNow(),
    }));
    if (current.managed === null) await replaceEventsAtomically(runDir, next);
    const output = {
      schema: 'lattice.run_abandon_result.v1',
      outcome: 'abandoned',
      reason,
      run_id: meta.run_id,
      event_count: next.length,
      events_digest: digestArtifact(next.map(({ event_digest: digest }) => digest)),
    };
    output.result_digest = digestArtifact(output);
    stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  });
}

async function readManagedSession(runDir) {
  const supervisorDir = path.join(runDir, 'supervisor');
  const activePaths = await resolveActiveRuntimePaths({ runDir });
  const descriptorPath = activePaths.descriptorPath;
  const sessionPath = activePaths.sessionPath;
  const descriptor = await readBoundedJson(descriptorPath, 'runtime supervisor descriptor');
  const sessionInfo = await lstat(sessionPath).catch(() => null);
  const descriptorKeys = ['schema', 'run_id', 'pid', 'process_start_identity', 'socket_ref',
    'session_nonce_digest', 'protocol_version', 'activated_at', 'descriptor_digest'];
  const identityKeys = ['schema', 'platform', 'pid', 'started_identity', 'identity_digest'];
  const descriptorBody = { ...descriptor };
  delete descriptorBody.descriptor_digest;
  const identity = descriptor?.process_start_identity;
  const identityBody = { ...identity };
  delete identityBody.identity_digest;
  if (descriptor?.schema !== 'lattice.runtime_supervisor_descriptor.v1'
    || Object.keys(descriptor).sort().join('\0') !== descriptorKeys.sort().join('\0')
    || typeof descriptor.run_id !== 'string'
    || !Number.isSafeInteger(descriptor.pid) || descriptor.pid < 1
    || identity?.schema !== 'lattice.process_start_identity.v1'
    || Object.keys(identity).sort().join('\0') !== identityKeys.sort().join('\0')
    || identity.pid !== descriptor.pid
    || identity.identity_digest !== digestArtifact(identityBody)
    || descriptor.descriptor_digest !== digestArtifact(descriptorBody)
    || descriptor.socket_ref !== 'supervisor/control.sock'
    || sessionInfo === null || !sessionInfo.isFile() || sessionInfo.isSymbolicLink()
    || (sessionInfo.mode & 0o077) !== 0) {
    throw new CliContractError('RUN_NOT_MANAGED', 'live supervisor bindingが不正');
  }
  const sessionNonce = (await readFile(sessionPath, 'utf8')).trim();
  const nonceDigest = digestArtifact(sessionNonce);
  if (sessionNonce.length < 32 || nonceDigest !== descriptor.session_nonce_digest) {
    throw new CliContractError('RUN_NOT_MANAGED', 'supervisor sessionがdescriptorと一致しない');
  }
  if (activePaths.pointer !== null
    && (activePaths.pointer.descriptor_digest !== descriptor.descriptor_digest
      || activePaths.pointer.session_nonce_digest !== nonceDigest)) {
    throw new CliContractError('RUN_NOT_MANAGED', 'active runtime pointer bindingが不正');
  }
  const socketPath = path.join(supervisorDir, 'control.sock');
  const socketInfo = await lstat(socketPath).catch(() => null);
  if (socketInfo === null || !socketInfo.isSocket() || socketInfo.isSymbolicLink()) {
    throw new CliContractError('RUN_NOT_MANAGED', 'supervisor control socketがliveではない');
  }
  return { descriptor, sessionNonce, socketPath };
}

function controlOperationPayload({ operation, runRef, artifactDigest, expectedEpoch, expectedQueueDigest, shutdownReason = null }) {
  const value = {
    schema: 'lattice.runtime_control_operation.v1',
    operation,
    run_ref: runRef,
    artifact_digest: artifactDigest,
    expected_epoch: expectedEpoch,
    expected_queue_digest: expectedQueueDigest,
    shutdown_reason: shutdownReason,
  };
  value.operation_digest = digestArtifact(value);
  return value;
}

async function runManagedControl({ runDir, runRef, operation, artifactDigest, stdout,
  shutdownReason = null, emit = true, requestId = null }) {
  const committed = await readCommittedEpochStore(runDir);
  if (committed === null) throw new CliContractError('RUN_NOT_MANAGED', 'runがmanaged storeへactivateされていない');
  const { descriptor, sessionNonce, socketPath } = await readManagedSession(runDir);
  if (descriptor.run_id !== committed.meta.run_id) {
    throw new CliContractError('RUN_NOT_MANAGED', 'supervisor descriptorが別runに属する');
  }
  let expectedQueueDigest = null;
  try {
    const queue = await readBoundedJson(path.join(runDir, 'queued-events.json'), 'runtime queue');
    expectedQueueDigest = queue.queue_digest;
  } catch (error) {
    if (!(error instanceof CliContractError) || error.code !== 'INPUT_UNREADABLE') throw error;
  }
  const payload = controlOperationPayload({
    operation, runRef, artifactDigest, expectedEpoch: committed.pointer.plan_epoch,
    expectedQueueDigest, shutdownReason,
  });
  const request = createRuntimeControlRequest({
    requestId: requestId ?? randomUUID(), runId: committed.meta.run_id, operation,
    payload, sessionNonce,
  });
  let response;
  let ambiguous = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      response = await sendRuntimeControlRequest({ socketPath, request });
    } catch (error) {
      if (error?.code === 'RUN_OUTCOME_UNKNOWN') ambiguous = true;
      else if (!(ambiguous && error?.code === 'RUN_NOT_MANAGED')) throw error;
      if (attempt === 99) throw new CliContractError('RUN_OUTCOME_UNKNOWN',
        `managed ${operation}の結果が確定しない。同一request_id=${request.request_id}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    if (response.outcome !== 'unknown') break;
    if (attempt === 99) throw new CliContractError('RUN_OUTCOME_UNKNOWN',
      `managed ${operation}の結果が確定しない。同一request_id=${request.request_id}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (response.outcome !== 'completed') {
    const code = response.result?.unmet?.[0] ?? 'RUN_FROZEN';
    throw new CliContractError(code, `managed ${operation}が${response.outcome}で終了した: ${response.result?.unmet?.[1] ?? code}`);
  }
  const resultKeys = ['schema', 'operation', 'outcome', 'event_head_digest', 'control_head_digest',
    'active_epoch', 'staged_epoch', 'unmet', 'result_digest'];
  const resultBody = { ...response.result };
  delete resultBody.result_digest;
  if (response.result?.schema !== 'lattice.runtime_control_result.v1'
    || Object.keys(response.result).sort().join('\0') !== resultKeys.sort().join('\0')
    || response.result.operation !== operation
    || response.result.result_digest !== digestArtifact(resultBody)) {
    throw new CliContractError('RUN_NOT_MANAGED', 'managed control result bindingが不正');
  }
  if (emit) stdout.write(`${JSON.stringify(response.result)}\n`);
  return emit ? 0 : response.result;
}

function buildControlResult({ operation, outcome, eventHeadDigest, controlHeadDigest, activeEpoch, stagedEpoch = null, unmet = [] }) {
  const result = {
    schema: 'lattice.runtime_control_result.v1', operation, outcome,
    event_head_digest: eventHeadDigest, control_head_digest: controlHeadDigest,
    active_epoch: activeEpoch, staged_epoch: stagedEpoch, unmet,
  };
  result.result_digest = digestArtifact(result);
  return result;
}

function buildControlResponse(request, outcome, result, controlHeadDigest) {
  const response = {
    schema: 'lattice.runtime_control_response.v1', request_id: request.request_id,
    run_id: request.run_id, outcome, result, control_head_digest: controlHeadDigest,
  };
  response.response_digest = digestArtifact(response);
  return response;
}

function controlIntentDigest(request) {
  return selfDigest({ request_id: request.request_id, run_id: request.run_id,
    operation: request.operation, payload: request.payload, intent_digest: '' }, 'intent_digest');
}

export function reconstructHoldResultFromJournal({ journal, runId, requestId, intentDigest }) {
  if (!Array.isArray(journal)) return null;
  const preparedIndex = journal.findIndex((event) => event.kind === 'hold_prepared'
    && event.payload?.request_id === requestId
    && event.payload?.logical_intent_digest === intentDigest);
  const prepared = journal[preparedIndex];
  const barrierIndex = prepared === undefined ? -1 : journal.findIndex((event, index) => (
    index > preparedIndex && event.kind === 'barrier_requested'
    && event.payload?.barrier_id === prepared.payload.barrier_id));
  const barrier = journal[barrierIndex];
  if (prepared === undefined || barrier === undefined) return null;
  const acknowledgements = journal.slice(barrierIndex + 1)
    .filter((event) => event.kind === 'executor_quiesced'
      && event.payload?.barrier_id === prepared.payload.barrier_id
      && event.payload?.barrier_control_digest === barrier.event_digest);
  const acknowledgedTodos = acknowledgements.map((event) => event.payload.todo_id).sort();
  if (acknowledgements.length !== barrier.payload.running_count
    || new Set(acknowledgedTodos).size !== acknowledgedTodos.length
    || JSON.stringify(acknowledgedTodos) !== JSON.stringify(barrier.payload.running_todo_ids)) return null;
  const result = {
    schema: 'lattice.runtime_hold_result.v1', run_id: runId,
    finding_digest: prepared.payload.finding_digest, barrier_id: prepared.payload.barrier_id,
    quiescence_ack_digests: acknowledgements.map((event) => event.payload.ack_digest).sort(),
    outcome: 'held', recorded_at: prepared.payload.recorded_at, result_digest: '',
  };
  result.result_digest = selfDigest(result, 'result_digest');
  return result;
}

async function runActivate({ runDir, runRef, repoRoot, stdout, requestId = null }) {
  return withLifecycleLock(runDir, async () => {
  const { events, meta } = await readRunStore(runDir);
  if (!['lattice.run_meta.v1', 'lattice.run_meta.v2'].includes(meta.schema)) throw new CliContractError('RUN_NOT_MANAGED', 'run metaがactivate対象でない');
  if (projectRuntimeState({ events }).closed) throw new CliContractError('RUN_CLOSED', 'closed runは再activateできない');
  if (meta.schema === 'lattice.run_meta.v2' && requestId !== null) {
    try {
      return await runManagedControl({ runDir, runRef, operation: 'activate', artifactDigest: null,
        stdout, requestId });
    } catch (error) {
      if (error?.code !== 'RUN_NOT_MANAGED') throw error;
    }
  }
  if (meta.schema === 'lattice.run_meta.v2') await prepareManagedSupervisorRestart({ runDir });
  const launched = await launchDurableSupervisor({ runDir });
  const payload = controlOperationPayload({
    operation: 'activate', runRef, artifactDigest: null, expectedEpoch: 1, expectedQueueDigest: null,
  });
  const request = createRuntimeControlRequest({ requestId: requestId ?? randomUUID(), runId: meta.run_id,
    operation: 'activate', payload, sessionNonce: launched.sessionNonce });
  let response;
  let ambiguous = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      response = await sendRuntimeActivationRequest({
        socketPath: launched.socketPath, request, expectedPid: launched.pid,
        expectedProcessStartIdentity: launched.processStartIdentity,
      });
    } catch (error) {
      if (error?.code === 'RUN_OUTCOME_UNKNOWN') ambiguous = true;
      else if (!(ambiguous && error?.code === 'RUN_NOT_MANAGED')) throw error;
      if (attempt === 99) throw new CliContractError('RUN_OUTCOME_UNKNOWN',
        `managed activateの結果が確定しない。同一request_id=${request.request_id}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    if (response.outcome !== 'unknown') break;
    if (attempt === 99) throw new CliContractError('RUN_OUTCOME_UNKNOWN',
      `managed activateの結果が確定しない。同一request_id=${request.request_id}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (response.outcome !== 'completed') {
    const code = response.result?.unmet?.[0] ?? 'ADAPTER_CONTROLLER_UNAVAILABLE';
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try { await lstat(path.join(runDir, 'supervisor')); } catch (error) {
        if (error?.code === 'ENOENT') break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new CliContractError(code, `managed activateが${response.outcome}で終了した: ${response.result?.unmet?.[1] ?? code}`);
  }
  // daemonがpointerまでcommitしたことを再読してから成功を返す。
  const committed = await readCommittedEpochStore(runDir);
  if (committed?.pointer.plan_epoch !== 1
    || !events.some((event) => event.event_digest === committed.pointer.activation_run_event_digest)) {
    throw new CliContractError('RUN_NOT_MANAGED', 'activate commitを再検証できない');
  }
  stdout.write(`${JSON.stringify(response.result)}\n`);
  return 0;
  });
}

export async function runManagedSupervisorDaemon({
  runDir, sessionNonce, serveRuntimeControlSocket, activateController, onReady,
  registerDaemonCleanup = () => {}, crashInjector = null,
}) {
  const repoRoot = await realpath(path.resolve(runDir, '..', '..', '..'));
  const request = await readBoundedJson(path.join(runDir, 'request.json'), 'run request');
  const compileArtifact = await readBoundedJson(path.join(runDir, 'plan-compile-result.json'), 'plan compile result');
  const legacyMeta = await readBoundedJson(path.join(runDir, 'run-meta.json'), 'run meta');
  const supervisorDir = path.join(runDir, 'supervisor');
  await mkdir(supervisorDir, { recursive: true, mode: 0o700 });
  const socketPath = path.join(supervisorDir, 'control.sock');
  let managedSupervisor = null;
  let activation = null;
  let activationCommitted = false;
  let controlEvents = [];
  const restarting = legacyMeta.schema === 'lattice.run_meta.v2';
  let candidateDir = null;
  let candidateControllerDir = null;
  let recoveryRegistrationDigest = null;
  const requestStore = createRuntimeControlStore({ runDir, runId: request.request_id,
    clock: canonicalNow });
  let eventStore = requestStore;
  let server;

  const appendControl = async ({ run_id: runId, kind, session_nonce_digest: sessionDigest, payload }) => {
    const eventDigest = await eventStore.append({ run_id: runId, kind,
      session_nonce_digest: sessionDigest, payload });
    controlEvents = await eventStore.readEvents();
    return eventDigest;
  };
  const gateWriter = createRuntimeGateStore({
    runDir, runId: request.request_id, sessionNonceDigest: digestArtifact(sessionNonce),
  });
  const resolveObservationBinding = async ({ binding }) => {
    const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
    const dispatch = events.findLast((event) => event.kind === 'executor_dispatched'
      && event.subject?.kind === 'todo' && event.subject.ref === binding?.todo_id
      && event.payload?.executor_handle === binding?.executor_handle);
    const observation = dispatch?.payload?.direct_os_observation_binding;
    if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) {
      throw new ManagedRuntimeError('HOLD_ACKS_INCOMPLETE', `durable Direct OS binding不足: ${binding?.todo_id ?? 'unknown'}`);
    }
    return structuredClone(observation);
  };
  const resolveRunningBindings = async ({ runId }) => {
    const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
    const state = projectRuntimeState({ events });
    return state.running.map((todoId) => {
      const dispatch = events.findLast((event) => event.kind === 'executor_dispatched'
        && event.subject?.kind === 'todo' && event.subject.ref === todoId);
      const payload = dispatch?.payload ?? {};
      const binding = {
        todo_id: todoId, executor_handle: payload.executor_handle,
        worktree_id: payload.worktree_id, plan_epoch: dispatch?.plan_epoch,
        packet_digest: payload.packet_digest, write_lease_id: payload.write_lease_id,
        controller_registration_digest: recoveryRegistrationDigest
          ?? payload.controller_registration_digest,
      };
      if (Object.values(binding).some((value) => value === undefined)) {
        throw new ManagedRuntimeError('HOLD_ACKS_INCOMPLETE', `durable running binding不足: ${todoId}`);
      }
      return binding;
    });
  };

  const executeControl = async (controlRequest) => {
    if (controlRequest.run_id !== request.request_id || controlRequest.session_nonce !== sessionNonce) {
      throw new ManagedRuntimeError('RUN_NOT_MANAGED', 'daemon session binding不一致');
    }
    try {
      if (controlRequest.operation === 'activate') {
        if (activation !== null) throw new ManagedRuntimeError('RUN_BUSY', '既にactivate済み');
        if (restarting) {
          candidateDir = path.join(supervisorDir, 'restart-candidates', digestArtifact(sessionNonce));
          await mkdir(candidateDir, { recursive: true, mode: 0o700 });
          const priorActive = await resolveActiveRuntimePaths({ runDir });
          const priorControl = await readFile(priorActive.controlEventsPath).catch((error) => {
            if (error?.code === 'ENOENT') return Buffer.from('[]\n');
            throw error;
          });
          await durableReplaceBytes(candidateDir, 'control-events.json', priorControl);
          eventStore = createRuntimeControlStore({ runDir: candidateDir,
            runId: request.request_id, clock: canonicalNow });
        }
        activation = await activateController({ repoRoot, runId: request.request_id,
          adapterKind: legacyMeta.executor_adapter });
        if (restarting) recoveryRegistrationDigest = activation.registration.registration_digest;
        const activationControlDigest = await appendControl({ run_id: request.request_id,
          kind: 'supervisor_activated', session_nonce_digest: digestArtifact(sessionNonce),
          payload: activation.activationControlEvent.payload });
        if (restarting) {
          const recoveryEvents = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
          const runningTodos = projectRuntimeState({ events: recoveryEvents }).running;
          const oldRegistrations = [...new Set(runningTodos.map((todoId) => recoveryEvents.findLast((event) => (
            event.kind === 'executor_dispatched' && event.subject?.ref === todoId
          ))?.payload?.controller_registration_digest).filter(Boolean))].sort();
          await appendControl({ run_id: request.request_id, kind: 'controller_recovery_rebound',
            session_nonce_digest: digestArtifact(sessionNonce), payload: {
              old_registration_digests: oldRegistrations,
              new_registration_digest: activation.registration.registration_digest,
              running_todo_ids: [...runningTodos].sort(),
            } });
        }
        const controllerDir = path.join(runDir, 'controllers', activation.controllerDescriptor.controller_id);
        candidateControllerDir = controllerDir;
        await mkdir(controllerDir, { recursive: true, mode: 0o700 });
        await writeCanonicalJsonFile(path.join(controllerDir, 'descriptor.json'), activation.controllerDescriptor);
        await writeCanonicalJsonFile(path.join(controllerDir, 'registration.json'), activation.registration);
        if (restarting) {
          await replaceCanonicalJsonAtomically(candidateDir, 'descriptor.json', activation.supervisorDescriptor);
          await durableReplaceBytes(candidateDir, 'session', Buffer.from(`${sessionNonce}\n`));
        } else {
          await writeCanonicalJsonFile(path.join(supervisorDir, 'descriptor.json'), activation.supervisorDescriptor);
          await durableReplaceBytes(supervisorDir, 'session', Buffer.from(`${sessionNonce}\n`));
        }
        const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
        const committed = restarting
          ? await readCommittedEpochStore(runDir)
          : await activateEpochOneStore({ runDir, request, compileArtifact, legacyMeta,
            activationRunEventDigest: events.at(-1).event_digest,
            activationControlEventDigest: activationControlDigest });
        managedSupervisor = await activation.createManagedSupervisor({
          resolveObservationBinding, resolveRunningBindings,
          journal: { append: appendControl }, gateWriter,
        });
        if (restarting) {
          await managedSupervisor.recoveryBarrier({ barrierId: `recovery-${randomUUID()}`,
            frozenEventDigest: events.at(-1).event_digest });
          // recovery barrierのdurable receipt後、単一pointer renameをcommit pointにする。
          const candidateEvents = await eventStore.readEvents();
          const restartResult = buildControlResult({ operation: 'activate', outcome: 'activated',
            eventHeadDigest: events.at(-1).event_digest,
            controlHeadDigest: candidateEvents.at(-1).event_digest,
            activeEpoch: committed.pointer.plan_epoch });
          const restartResponse = buildControlResponse(controlRequest, 'completed', restartResult,
            candidateEvents.at(-1).event_digest);
          await replaceCanonicalJsonAtomically(candidateDir, 'activation-response.json', restartResponse);
          const activePointer = {
            schema: 'lattice.runtime_active_pointer.v1', run_id: request.request_id,
            candidate_ref: path.relative(runDir, candidateDir),
            activation_request_id: controlRequest.request_id,
            activation_request_digest: controlRequest.request_digest,
            activation_intent_digest: controlIntentDigest(controlRequest),
            activation_response_digest: restartResponse.response_digest,
            descriptor_digest: activation.supervisorDescriptor.descriptor_digest,
            session_nonce_digest: digestArtifact(sessionNonce),
            control_head_digest: candidateEvents.at(-1).event_digest,
            control_head_sequence: candidateEvents.at(-1).sequence,
            committed_at: canonicalNow(), pointer_digest: '',
          };
          activePointer.pointer_digest = selfDigest(activePointer, 'pointer_digest');
          await replaceCanonicalJsonAtomically(supervisorDir, 'active-runtime.json', activePointer);
          activationCommitted = true;
          return restartResponse;
        }
        if (!restarting) activationCommitted = true;
        const result = buildControlResult({ operation: 'activate', outcome: 'activated',
          eventHeadDigest: events.at(-1).event_digest, controlHeadDigest: controlEvents.at(-1).event_digest,
          activeEpoch: committed.pointer.plan_epoch });
        return buildControlResponse(controlRequest, 'completed', result, controlEvents.at(-1).event_digest);
      }
      if (managedSupervisor === null) throw new ManagedRuntimeError('RUN_NOT_MANAGED', 'activate未完了');
      if (controlRequest.operation === 'conflict') {
        const findingDigest = controlRequest.payload.artifact_digest;
        const finding = await readBoundedJson(path.join(runDir, 'findings', `${findingDigest}.json`), 'runtime finding');
        if (!validateRuntimeFindingRecord(finding)
          || finding.finding_digest !== findingDigest
          || finding.run_id !== request.request_id || finding.plan_epoch !== 1) {
          throw new ManagedRuntimeError('FINDING_UNRESOLVED', 'finding binding不正');
        }
        let events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
        const todoId = finding.finding?.todo_ids?.[0] ?? compileArtifact.plan.nodes[0].todo_id;
        events.push(buildNextRunEvent({ events, runId: request.request_id, kind: 'conflict_found', planEpoch: 1,
          subject: { kind: 'todo', ref: todoId }, payload: {
            ...finding.finding, finding_digest: findingDigest, reported_by: 'lattice-supervisor',
          }, recordedAt: canonicalNow() }));
        events.push(buildNextRunEvent({ events, runId: request.request_id, kind: 'intake_frozen', planEpoch: 1,
          subject: { kind: 'runtime_plan', ref: compileArtifact.plan.plan_ref },
          payload: { frozen_prefix_digest: digestArtifact(events.map(({ event_digest: value }) => value)), reason_kind: finding.finding.kind }, recordedAt: canonicalNow() }));
        await replaceEventsAtomically(runDir, events);
        const result = buildControlResult({ operation: 'conflict', outcome: 'frozen',
          eventHeadDigest: events.at(-1).event_digest, controlHeadDigest: controlEvents.at(-1).event_digest,
          activeEpoch: 1 });
        return buildControlResponse(controlRequest, 'completed', result, controlEvents.at(-1).event_digest);
      }
      if (controlRequest.operation === 'hold') {
        const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
        const conflict = events.findLast((event) => event.kind === 'conflict_found');
        if (!conflict) throw new ManagedRuntimeError('FINDING_UNRESOLVED', '保存済みconflictなし');
        const holdBarrierId = `barrier-${randomUUID()}`;
        const holdRecordedAt = canonicalNow();
        await appendControl({ run_id: request.request_id, kind: 'hold_prepared',
          session_nonce_digest: digestArtifact(sessionNonce), payload: {
            request_id: controlRequest.request_id,
            logical_intent_digest: controlIntentDigest(controlRequest),
            finding_digest: conflict.payload.finding_digest,
            barrier_id: holdBarrierId, recorded_at: holdRecordedAt,
          } });
        const held = await managedSupervisor.holdConflict({
          findingDigest: conflict.payload.finding_digest, frozenEventDigest: events.at(-1).event_digest,
          barrierId: holdBarrierId, reason: conflict.payload.kind,
          recordedAt: holdRecordedAt,
        });
        if (typeof crashInjector === 'function') await crashInjector('after_hold_effect', {
          request_id: controlRequest.request_id, hold_result_digest: held.result_digest,
        });
        await replaceNamedJsonAtomically(runDir, 'hold-result.json', held);
        const operationReceipt = {
          schema: 'lattice.runtime_control_operation_receipt.v1',
          request_id: controlRequest.request_id,
          logical_intent_digest: controlIntentDigest(controlRequest),
          operation: 'hold', outcome: 'held', effect_digest: held.result_digest,
          receipt_digest: '',
        };
        operationReceipt.receipt_digest = selfDigest(operationReceipt, 'receipt_digest');
        await replaceCanonicalJsonAtomically(runDir, 'hold-operation-receipt.json', operationReceipt);
        const result = buildControlResult({ operation: 'hold', outcome: 'held',
          eventHeadDigest: events.at(-1).event_digest, controlHeadDigest: controlEvents.at(-1).event_digest,
          activeEpoch: 1 });
        return buildControlResponse(controlRequest, 'completed', result, controlEvents.at(-1).event_digest);
      }
      if (['close', 'abandon'].includes(controlRequest.operation)) {
        let events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
        const state = projectRuntimeState({ events });
        const shutdownReason = controlRequest.payload.shutdown_reason;
        if (typeof shutdownReason !== 'string' || shutdownReason.length === 0) {
          throw new ManagedRuntimeError('MANAGED_SHUTDOWN_INCOMPLETE', 'shutdown reason不足');
        }
        let proposed;
        if (controlRequest.operation === 'close') {
          proposed = closeRunIfComplete({ runId: request.request_id, plan: compileArtifact.plan,
            events, recordedAt: canonicalNow() });
          if (!proposed.closed) throw new ManagedRuntimeError('RUN_NOT_COMPLETE', '全TODO完了前はcloseできない');
        }
        const shutdown = await managedSupervisor.shutdownManaged({ mode: controlRequest.operation,
          reason: shutdownReason, barrierId: `shutdown-${randomUUID()}`,
          frozenEventDigest: events.at(-1).event_digest, recordedAt: canonicalNow() });
        if (controlRequest.operation === 'close') events = proposed.events;
        else {
          events = [...events, buildNextRunEvent({ events, runId: request.request_id, kind: 'run_closed',
            planEpoch: 1, subject: { kind: 'runtime_plan', ref: compileArtifact.plan.plan_ref },
            payload: { outcome: 'abandoned', reason: shutdownReason, accepted: state.accepted },
            recordedAt: canonicalNow() })];
        }
        await replaceEventsAtomically(runDir, events);
        await appendControl({ run_id: request.request_id, kind: 'supervisor_stopped',
          session_nonce_digest: digestArtifact(sessionNonce),
          payload: { shutdown_result_digest: shutdown.result_digest } });
        const result = buildControlResult({ operation: controlRequest.operation,
          outcome: controlRequest.operation === 'close' ? 'closed' : 'abandoned',
          eventHeadDigest: events.at(-1).event_digest,
          controlHeadDigest: controlEvents.at(-1).event_digest, activeEpoch: 1 });
        setTimeout(() => {
          server?.close(() => {
            resolveActiveRuntimePaths({ runDir }).then((active) => Promise.all([
              rm(socketPath, { force: true }), rm(active.sessionPath, { force: true }),
              rm(path.join(supervisorDir, 'session'), { force: true }),
            ])).catch(() => {});
          });
        }, 200);
        return buildControlResponse(controlRequest, 'completed', result, controlEvents.at(-1).event_digest);
      }
      throw new ManagedRuntimeError('UNSUPPORTED_SUCCESSOR_SCHEMA', `${controlRequest.operation}はLPG028待ち`);
    } catch (error) {
      const code = error?.code ?? 'ADAPTER_CONTROLLER_UNAVAILABLE';
      const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events').catch(() => []);
      const result = buildControlResult({ operation: controlRequest.operation, outcome: 'rejected',
        eventHeadDigest: events.at(-1)?.event_digest ?? null,
        controlHeadDigest: controlEvents.at(-1)?.event_digest ?? null, activeEpoch: 1,
        unmet: [code, String(error?.message ?? error)] });
      if (controlRequest.operation === 'activate' && !activationCommitted) {
        setTimeout(() => {
          server?.close(() => {
            Promise.all([
              activation?.disposeController?.(),
              candidateDir ? rm(candidateDir, { recursive: true, force: true }) : Promise.resolve(),
              candidateControllerDir ? rm(candidateControllerDir, { recursive: true, force: true }) : Promise.resolve(),
              rm(socketPath, { force: true }),
              restarting ? Promise.resolve() : rm(path.join(runDir, 'control-request-ledger.json'), { force: true }),
              restarting ? Promise.resolve() : rm(supervisorDir, { recursive: true, force: true }),
            ]).catch(() => {});
          });
        }, 200);
      }
      return buildControlResponse(controlRequest, 'rejected', result, controlEvents.at(-1)?.event_digest ?? null);
    }
  };
  const handler = async (controlRequest) => {
    const known = await requestStore.readRequest(controlRequest);
    if (known?.state === 'completed') return known.response;
    const staleInProgress = known?.state === 'in_progress'
      && known.request_digest !== controlRequest.request_digest;
    if (controlRequest.run_id !== request.request_id
      || controlRequest.session_nonce !== sessionNonce || staleInProgress) {
      const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events').catch(() => []);
      const active = await resolveActiveRuntimePaths({ runDir }).catch(() => null);
      const journal = active === null ? []
        : await readBoundedJson(active.controlEventsPath, 'runtime control events').catch(() => []);
      let outcome = 'rejected';
      let operationOutcome = 'rejected';
      let unmet = ['RUN_RECOVERY_REQUIRED', '旧session requestはdurable side effectを導出できない'];
      if (['finding_record', 'recompile', 'reprocess'].includes(controlRequest.operation)) {
        operationOutcome = 'rejected';
        unmet = ['UNSUPPORTED_SUCCESSOR_SCHEMA', `${controlRequest.operation}はLPG028待ち`];
      }
      if (known?.state === 'in_progress') {
        let holdReceipt = controlRequest.operation === 'hold'
          ? await readBoundedJson(path.join(runDir, 'hold-operation-receipt.json'),
            'hold operation receipt').catch(() => null)
          : null;
        if (controlRequest.operation === 'hold' && holdReceipt === null) {
          const reconstructed = reconstructHoldResultFromJournal({ journal,
            runId: request.request_id, requestId: controlRequest.request_id,
            intentDigest: controlIntentDigest(controlRequest) });
          if (reconstructed !== null) {
            await replaceCanonicalJsonAtomically(runDir, 'hold-result.json', reconstructed);
            holdReceipt = {
              schema: 'lattice.runtime_control_operation_receipt.v1',
              request_id: controlRequest.request_id,
              logical_intent_digest: controlIntentDigest(controlRequest),
              operation: 'hold', outcome: 'held', effect_digest: reconstructed.result_digest,
              receipt_digest: '',
            };
            holdReceipt.receipt_digest = selfDigest(holdReceipt, 'receipt_digest');
            await replaceCanonicalJsonAtomically(runDir, 'hold-operation-receipt.json', holdReceipt);
          }
        }
        const held = holdReceipt?.schema === 'lattice.runtime_control_operation_receipt.v1'
          && holdReceipt.request_id === controlRequest.request_id
          && holdReceipt.logical_intent_digest === controlIntentDigest(controlRequest)
          && holdReceipt.operation === 'hold' && holdReceipt.outcome === 'held'
          && holdReceipt.receipt_digest === selfDigest(holdReceipt, 'receipt_digest');
        const found = controlRequest.operation === 'conflict'
          && events.some((event) => event.kind === 'conflict_found'
            && event.payload?.finding_digest === controlRequest.payload.artifact_digest);
        const closed = events.findLast((event) => event.kind === 'run_closed');
        const terminal = held || found
          || (controlRequest.operation === 'close' && closed?.payload?.outcome === 'completed')
          || (controlRequest.operation === 'abandon' && closed?.payload?.outcome === 'abandoned');
        if (terminal) {
          outcome = 'completed';
          operationOutcome = held ? 'held' : found ? 'frozen'
            : controlRequest.operation === 'close' ? 'closed' : 'abandoned';
          unmet = [];
        }
      }
      const result = buildControlResult({ operation: controlRequest.operation,
        outcome: operationOutcome, eventHeadDigest: events.at(-1)?.event_digest ?? null,
        controlHeadDigest: journal.at(-1)?.event_digest ?? null, activeEpoch: 1, unmet });
      const response = buildControlResponse(controlRequest, outcome, result,
        journal.at(-1)?.event_digest ?? null);
      return known?.state === 'in_progress'
        ? requestStore.completeRequest(controlRequest, response)
        : response;
    }
    if (known?.state === 'in_progress') {
      const active = await resolveActiveRuntimePaths({ runDir });
      if (active.pointer?.activation_request_id === controlRequest.request_id
        && active.pointer.activation_intent_digest === controlIntentDigest(controlRequest)) {
        const response = await readBoundedJson(path.join(path.dirname(active.descriptorPath),
          'activation-response.json'), 'activation response');
        if (!validateRuntimeControlResponse(response, controlRequest.operation)
          || response.response_digest !== active.pointer.activation_response_digest) {
          throw new ManagedRuntimeError('RUN_RECOVERY_REQUIRED', 'committed activation response binding不正');
        }
        return requestStore.completeRequest(controlRequest, response);
      }
      const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events').catch(() => []);
      const journal = await eventStore.readEvents();
      const result = buildControlResult({ operation: controlRequest.operation, outcome: 'unknown',
        eventHeadDigest: events.at(-1)?.event_digest ?? null,
        controlHeadDigest: journal.at(-1)?.event_digest ?? null, activeEpoch: 1,
        unmet: ['RUN_OUTCOME_UNKNOWN', '同一request_idの処理結果はまだ確定していない'] });
      return buildControlResponse(controlRequest, 'unknown', result,
        journal.at(-1)?.event_digest ?? null);
    }
    let lock;
    try {
      lock = await acquireRuntimeLifecycleLock({ runDir,
        sessionNonceDigest: digestArtifact(sessionNonce), operation: controlRequest.operation,
        requestId: controlRequest.request_id, timeoutMs: 0 });
    } catch (error) {
      const code = error?.code ?? 'RUN_BUSY';
      const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events').catch(() => []);
      const journal = await eventStore.readEvents().catch(() => []);
      const result = buildControlResult({ operation: controlRequest.operation, outcome: 'rejected',
        eventHeadDigest: events.at(-1)?.event_digest ?? null,
        controlHeadDigest: journal.at(-1)?.event_digest ?? null, activeEpoch: 1,
        unmet: [code, String(error?.message ?? error)] });
      return buildControlResponse(controlRequest, 'rejected', result,
        journal.at(-1)?.event_digest ?? null);
    }
    try {
      const begun = await requestStore.beginRequest(controlRequest);
      if (begun.disposition === 'completed') return begun.response;
      if (begun.disposition === 'in_progress') {
        throw new ManagedRuntimeError('RUN_OUTCOME_UNKNOWN', '同一request_idが処理中');
      }
      const response = await executeControl(controlRequest);
      return requestStore.completeRequest(controlRequest, response);
    } finally {
      await lock.release();
    }
  };
  server = await serveRuntimeControlSocket({ socketPath, handler });
  registerDaemonCleanup(async (signal) => {
    if (activationCommitted && activation !== null) {
      await appendControl({ run_id: request.request_id, kind: 'supervisor_stopped',
        session_nonce_digest: digestArtifact(sessionNonce), payload: { signal } });
    }
    await activation?.disposeController?.();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(socketPath, { force: true });
    const active = await resolveActiveRuntimePaths({ runDir }).catch(() => null);
    if (active !== null) await rm(active.sessionPath, { force: true });
    await rm(path.join(supervisorDir, 'session'), { force: true });
  });
  onReady(socketPath);
  await new Promise((resolve) => server.once('close', resolve));
}

async function eventVerify({ runDir, stdout }) {
  const { events, compileArtifact } = await readRunStore(runDir);
  const chain = verifyRunEventChain({ events });
  const checks = [...chain.checks.map(({ id, passed }) => ({ id: `chain:${id}`, passed }))];
  // dispatch replay（保存planのepochのdecisionのみ。多epoch runは各epoch planを要する）。
  events.forEach((event, index) => {
    if (event.kind !== 'dispatch_decided') return;
    if (event.plan_epoch !== compileArtifact.plan.plan_epoch) return;
    const recomputed = computeReadyFrontier({
      plan: compileArtifact.plan,
      events: events.slice(0, index),
    });
    checks.push({
      id: `dispatch_replay:seq${event.sequence}`,
      passed: JSON.stringify(event.payload.dispatchable) === JSON.stringify(recomputed.dispatchable),
    });
  });
  const receiptCheck = recomputeReceiptDecisions({ plan: compileArtifact.plan, events });
  const acceptedFromEvents = projectRuntimeState({ events }).accepted;
  checks.push({
    id: 'receipt_replay',
    passed: receiptCheck.decisions
      .filter(({ decision }) => decision === 'accepted')
      .every(({ todo_id: todoId }) => acceptedFromEvents.includes(todoId)),
  });
  const failed = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  const output = {
    schema: 'lattice.event_verification.v1',
    valid: failed.length === 0,
    checks_total: checks.length,
    failed_conditions: failed,
    events_digest: digestArtifact(events.map(({ event_digest: digest }) => digest)),
  };
  output.result_digest = digestArtifact(output);
  stdout.write(`${JSON.stringify(output)}\n`);
  if (failed.length > 0) {
    // ADR 0052 Decision 1: failed_conditionsはstdoutのevent_verification.v1が既に持つ＝detailで二重化しない。
    throw new CliContractError('EVENT_VERIFICATION_FAILED', 'event検証が失敗');
  }
  return 0;
}

/**
 * `--version`以外の全argvを受け、exit codeを返す（`doctor --json`はADR 0052で退役済み）。
 * exact argument contract: 位置・順序・件数の完全一致だけを受理する。
 */
export async function runRuntimeCli({ argv, cwd, stdout, stderr }) {
  if (!Array.isArray(argv) || typeof cwd !== 'string'
    || typeof stdout?.write !== 'function' || typeof stderr?.write !== 'function') {
    throw new TypeError('runRuntimeCli optionsが不正');
  }
  let requestIdOverride = null;
  if (argv.length >= 2 && argv.at(-2) === '--request-id') {
    if (!/^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u.test(argv.at(-1) ?? '')) {
      return typedFailure(stderr, 'INVALID_REQUEST_ID', 'request-idは128文字以下の識別子でなければならない');
    }
    requestIdOverride = argv.at(-1);
    argv = argv.slice(0, -2);
    if (argv[0] !== 'run' || !['activate', 'close', 'abandon', 'conflict', 'hold', 'reprocess'].includes(argv[1])) {
      return typedFailure(stderr, 'INVALID_REQUEST_ID', '--request-idはrun mutationだけで指定できる');
    }
  }
  let action = null;
  if (argv.length === 4
    && argv[0] === 'plan' && argv[1] === 'compile' && argv[2] === '--request'
    && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = () => planCompile({ requestPath: path.resolve(cwd, argv[3]), cwd, stdout });
  } else if (argv.length === 6
    && argv[0] === 'plan' && argv[1] === 'verify'
    && argv[2] === '--request' && typeof argv[3] === 'string' && argv[3].length > 0
    && argv[4] === '--plan' && typeof argv[5] === 'string' && argv[5].length > 0) {
    action = () => planVerify({
      requestPath: path.resolve(cwd, argv[3]),
      planPath: path.resolve(cwd, argv[5]),
      cwd,
      stdout,
    });
  } else if (argv.length === 6
    && argv[0] === 'run' && argv[1] === 'start'
    && argv[2] === '--request' && typeof argv[3] === 'string' && argv[3].length > 0
    && argv[4] === '--executor' && typeof argv[5] === 'string' && argv[5].length > 0) {
    action = () => runStart({
      requestPath: path.resolve(cwd, argv[3]),
      executorAdapter: argv[5],
      cwd,
      stdout,
    });
  } else if (argv.length === 4
    && argv[0] === 'run' && argv[1] === 'activate'
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = async () => {
      const { repoRoot, runDir, runRef } = await resolveRunStore(cwd, argv[3]);
      return runActivate({ runDir, runRef, repoRoot, stdout, requestId: requestIdOverride });
    };
  } else if (argv.length === 4
    && argv[0] === 'run' && ['observe', 'status', 'resume', 'close'].includes(argv[1])
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = async () => {
      const { repoRoot, runDir } = await resolveRunStore(cwd, argv[3]);
      if (argv[1] === 'observe') return runObserve({ runDir, stdout });
      if (argv[1] === 'status') return runStatus({ runDir, stdout });
      if (argv[1] === 'resume') return runResume({ runDir, repoRoot, stdout });
      return runClose({ runDir, repoRoot, stdout, requestId: requestIdOverride });
    };
  } else if (argv.length === 6
    && argv[0] === 'run' && argv[1] === 'abandon'
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0
    && argv[4] === '--reason' && typeof argv[5] === 'string' && argv[5].length > 0) {
    action = async () => {
      const { runDir } = await resolveRunStore(cwd, argv[3]);
      return runAbandon({ runDir, runRef: argv[3], reason: argv[5], stdout,
        requestId: requestIdOverride });
    };
  } else if (argv.length === 6
    && argv[0] === 'run' && argv[1] === 'conflict'
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0
    && argv[4] === '--finding' && /^[0-9a-f]{64}$/u.test(argv[5])) {
    action = async () => {
      const { runDir, runRef } = await resolveRunStore(cwd, argv[3]);
      return runManagedControl({
        runDir, runRef, operation: 'conflict', artifactDigest: argv[5], stdout,
        requestId: requestIdOverride,
      });
    };
  } else if (argv.length === 4
    && argv[0] === 'run' && ['hold', 'reprocess'].includes(argv[1])
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = async () => {
      const { runDir, runRef } = await resolveRunStore(cwd, argv[3]);
      return runManagedControl({
        runDir, runRef, operation: argv[1], artifactDigest: null, stdout,
        requestId: requestIdOverride,
      });
    };
  } else if (argv.length === 3
    && argv[0] === 'run' && argv[1] === 'list' && argv[2] === '--json') {
    action = () => runList({ cwd, stdout });
  } else if (argv.length === 4
    && argv[0] === 'event' && argv[1] === 'verify'
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = async () => {
      const { runDir } = await resolveRunStore(cwd, argv[3]);
      return eventVerify({ runDir, stdout });
    };
  }
  if (action === null) return usageFailure(stderr, argv);
  try {
    return await action();
  } catch (error) {
    if (error instanceof CliContractError) {
      return typedFailure(stderr, error.code, error.message, error.detail);
    }
    if (error instanceof TypeError) {
      return typedFailure(stderr, 'CONTRACT_VIOLATION', error.message);
    }
    if (error instanceof RuntimeEpochStoreError) {
      return typedFailure(stderr, error.code, error.message);
    }
    if (error instanceof ManagedRuntimeError) {
      return typedFailure(stderr, error.code, error.message);
    }
    throw error;
  }
}
