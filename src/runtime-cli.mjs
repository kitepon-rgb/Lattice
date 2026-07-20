import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';
import { collectCodegraphEvidence } from './codegraph-adapter.mjs';
import {
  compileRuntimePlanV1,
  evidenceFromCollectedOutcomes,
} from './runtime-front-end.mjs';
import {
  validateRunRequest,
  validateRuntimeBoundaryManifest,
  validateRuntimePlan,
  verifyRuntimePlanBinding,
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
 * plan verifyは保存planを信用せず、requestとfresh Codegraph観測からplanを
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
  const collected = await collectCodegraphEvidence({
    cwd,
    querySet: request.codegraph_query_set,
  });
  // 観測中にHEADが動いた場合、観測とbase束縛が別snapshotになるためreject
  // （TOCTOU窓の閉鎖。base再確認は観測の後に行う）。
  await resolveRepoBinding(cwd, request);
  const codegraphEvidence = evidenceFromCollectedOutcomes({
    querySet: request.codegraph_query_set,
    collected,
  });
  return compileRuntimePlanV1({
    request,
    codegraphEvidence,
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
    || Object.keys(artifact.manifests).sort().join(' ') !== [...planNodeIds].sort().join(' ')) {
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
  if (!validateRunRequest(request)
    || meta === null || typeof meta !== 'object' || Array.isArray(meta)
    || Object.keys(meta).sort().join('\0') !== metaKeys.sort().join('\0')
    || meta.schema !== 'lattice.run_meta.v1'
    || meta.run_id !== request.request_id
    || !KNOWN_ADAPTERS.includes(meta.executor_adapter)
    || compileArtifact === null || typeof compileArtifact !== 'object' || Array.isArray(compileArtifact)
    || Object.keys(compileArtifact).sort().join('\0') !== compileKeys.sort().join('\0')
    || compileArtifact.schema !== COMPILE_RESULT_SCHEMA
    || claimedCompileDigest !== digestArtifact(compileBody)
    || compileArtifact.request_digest !== request.request_digest
    || !validateRuntimePlan(compileArtifact?.plan)
    || !verifyRuntimePlanBinding({ plan: compileArtifact.plan, request })
    || compileArtifact.plan.plan_digest !== meta.plan_digest) {
    throw new CliContractError('INVALID_RUN_STORE', 'run storeのartifact bindingが不正');
  }
  return { events, meta, compileArtifact, request };
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600, flag: 'wx' });
}

async function replaceEventsAtomically(runDir, events) {
  const temporaryPath = path.join(runDir, `.events-${process.pid}-${Date.now()}.tmp`);
  await writeJsonFile(temporaryPath, events);
  await rename(temporaryPath, path.join(runDir, 'events.json'));
}

async function withLifecycleLock(runDir, action) {
  const lockPath = path.join(runDir, '.lifecycle.lock');
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
  const { events, meta, compileArtifact } = await readRunStore(runDir);
  const chain = verifyRunEventChain({ events });
  if (!chain.valid) {
    throw new CliContractError('EVENT_CHAIN_INVALID', 'event chainが不正', { failed_conditions: chain.failed_conditions });
  }
  const state = projectRuntimeState({ events });
  const frontier = computeReadyFrontier({ plan: compileArtifact.plan, events });
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
  const { events, meta, compileArtifact, request } = await readRunStore(runDir);
  requireValidEventChain(events);
  const state = projectRuntimeState({ events });
  if (state.closed) {
    throw new CliContractError('RUN_CLOSED', 'closed runはresumeできない');
  }
  await resolveRepoBinding(repoRoot, request);
  const frontier = computeReadyFrontier({ plan: compileArtifact.plan, events });
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

async function runClose({ runDir, repoRoot, stdout }) {
  return withLifecycleLock(runDir, async () => {
    const { events, meta, compileArtifact, request } = await readRunStore(runDir);
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
      next = closed.events;
      await replaceEventsAtomically(runDir, next);
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

async function runAbandon({ runDir, reason, stdout }) {
  if (!ABANDON_REASON.test(reason)) {
    throw new CliContractError('INVALID_ABANDON_REASON', 'reasonは128文字以下の識別子でなければならない');
  }
  return withLifecycleLock(runDir, async () => {
    const { events, meta, compileArtifact } = await readRunStore(runDir);
    requireValidEventChain(events);
    const state = projectRuntimeState({ events });
    if (state.closed) {
      throw new CliContractError('RUN_CLOSED', 'closed runはabandonできない');
    }
    const next = [...events];
    next.push(buildNextRunEvent({
      events: next,
      runId: meta.run_id,
      kind: 'run_closed',
      planEpoch: compileArtifact.plan.plan_epoch,
      subject: { kind: 'runtime_plan', ref: compileArtifact.plan.plan_ref },
      payload: { outcome: 'abandoned', reason, accepted: state.accepted },
      recordedAt: canonicalNow(),
    }));
    await replaceEventsAtomically(runDir, next);
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
    && argv[0] === 'run' && ['observe', 'status', 'resume', 'close'].includes(argv[1])
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = async () => {
      const { repoRoot, runDir } = await resolveRunStore(cwd, argv[3]);
      if (argv[1] === 'observe') return runObserve({ runDir, stdout });
      if (argv[1] === 'status') return runStatus({ runDir, stdout });
      if (argv[1] === 'resume') return runResume({ runDir, repoRoot, stdout });
      return runClose({ runDir, repoRoot, stdout });
    };
  } else if (argv.length === 6
    && argv[0] === 'run' && argv[1] === 'abandon'
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0
    && argv[4] === '--reason' && typeof argv[5] === 'string' && argv[5].length > 0) {
    action = async () => {
      const { runDir } = await resolveRunStore(cwd, argv[3]);
      return runAbandon({ runDir, reason: argv[5], stdout });
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
    throw error;
  }
}
