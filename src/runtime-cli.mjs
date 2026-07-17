import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
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
} from './runtime-contracts.mjs';
import { initializeRunEvents } from './runtime-engine.mjs';
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
 *   lattice run observe  --run <run-directory>
 *   lattice run status   --run <run-directory>
 *   lattice event verify --run <run-directory>
 *
 * - stdout: versioned JSON 1行のみ。診断はstderr。
 * - exit 0: 成功（artifact refとdigestを含むversioned JSON）。
 * - exit 1: typed契約失敗。stderrへ`lattice.cli_error.v1` JSON 1行。
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
// run event storeはDecision 10.1のLattice-owned root配下に置く。
const RUN_STORE_ROOT = ['research', 'runs', 'rc3'];
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
  const events = await readBoundedJson(path.join(runDir, 'events.json'), 'run events');
  if (!Array.isArray(events)) {
    throw new CliContractError('INVALID_RUN_STORE', 'events.jsonがarrayではない');
  }
  const meta = await readBoundedJson(path.join(runDir, 'run-meta.json'), 'run meta');
  const compileArtifact = await readBoundedJson(
    path.join(runDir, 'plan-compile-result.json'), 'plan compile result',
  );
  return { events, meta, compileArtifact };
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
  const runDir = runStorePath(cwd, request.request_id);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.dirname(runDir), { recursive: true });
  try {
    await mkdir(runDir);
  } catch (error) {
    throw new CliContractError('RUN_EXISTS', `run storeが既に存在する: ${String(error?.code ?? error)}`);
  }
  const meta = {
    schema: 'lattice.run_meta.v1',
    run_id: request.request_id,
    executor_adapter: executorAdapter,
    plan_digest: result.plan.plan_digest,
  };
  await writeFile(path.join(runDir, 'request.json'), `${JSON.stringify(request, null, 1)}\n`);
  await writeFile(path.join(runDir, 'plan-compile-result.json'), `${JSON.stringify(compileArtifact, null, 1)}\n`);
  await writeFile(path.join(runDir, 'events.json'), `${JSON.stringify(events, null, 1)}\n`);
  await writeFile(path.join(runDir, 'run-meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
  const output = {
    schema: 'lattice.run_start_result.v1',
    run_id: request.request_id,
    run_dir: path.relative(cwd, runDir),
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
    && argv[0] === 'run' && (argv[1] === 'observe' || argv[1] === 'status')
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    const runDir = path.resolve(cwd, argv[3]);
    action = argv[1] === 'observe'
      ? () => runObserve({ runDir, stdout })
      : () => runStatus({ runDir, stdout });
  } else if (argv.length === 4
    && argv[0] === 'event' && argv[1] === 'verify'
    && argv[2] === '--run' && typeof argv[3] === 'string' && argv[3].length > 0) {
    action = () => eventVerify({ runDir: path.resolve(cwd, argv[3]), stdout });
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
