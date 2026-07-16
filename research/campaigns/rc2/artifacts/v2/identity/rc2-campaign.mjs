import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import {
  canonicalizeArtifact,
  digestArtifact,
} from './artifact-contracts.mjs';
import { compileBoundaryCondition } from './boundary-compiler.mjs';
import { collectCodegraphEvidence } from './codegraph-adapter.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';
import { runRc1BlackBoxOracle } from './rc1-black-box-oracle.mjs';
import { createRc1EvidenceBundle } from './rc1-evidence-bundle.mjs';
import {
  RC2_ARTIFACT_PATHS,
  verifyRc2CampaignArtifactSet,
} from './rc2-artifact-set.mjs';
import { compileDeliveryPolicyBoundaryBundleV2 } from './rc2-delivery-policy-front-end.mjs';
import { runRc2DeliveryPolicyOracle } from './rc2-delivery-policy-oracle.mjs';
import {
  applyRc2DeliveryPolicyTransform,
  RC2_DELIVERY_POLICY_TRANSFORM_PATHS,
  runRc2DeliveryPolicySeamTransform,
} from './rc2-delivery-policy-transform.mjs';
import { compileRc1TransferBundleV2 } from './rc2-rc1-transfer-front-end.mjs';
import { compileSchedulabilityGraphV2 } from './schedulability-compiler-v2.mjs';
import { verifySchedulabilityPlanV2 } from './schedulability-verifier-v2.mjs';

const ARTIFACT_VERSION = 'v2';
const ARTIFACT_ROOTS = Object.freeze({
  v1: 'research/campaigns/rc2/artifacts/v1',
  v2: 'research/campaigns/rc2/artifacts/v2',
});
const CODEGRAPH_CONFIG_REPO_PATH = 'codegraph.json';
const CODEGRAPH_CONFIG_ARTIFACT_PATH = 'identity/codegraph-config.json';
const CODEGRAPH_CONFIG_BYTES = Buffer.from(
  '{"exclude":["research/campaigns/**/artifacts/**/identity/"]}\n',
  'utf8',
);
const V2_ONLY_ARTIFACT_PATHS = Object.freeze([
  CODEGRAPH_CONFIG_ARTIFACT_PATH,
  'predecessors/adr-0040.md',
  'predecessors/rc2-v1-artifact-manifest.json',
  'predecessors/rc2-v1-new-plan-version.json',
]);
const RC2_V1_ARTIFACT_PATHS = Object.freeze(RC2_ARTIFACT_PATHS.filter((relativePath) => (
  !V2_ONLY_ARTIFACT_PATHS.includes(relativePath)
)));
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const RAW_EVIDENCE_CHUNK_BYTES = 12_000;

const PRIMARY_INPUT_FILES = Object.freeze({
  planInput: 'research/campaigns/rc2/inputs/plan-input.json',
  candidateSpec: 'research/campaigns/rc2/inputs/candidate-spec-v1.json',
  normalManualEvidence: 'research/campaigns/rc2/inputs/manual-evidence.normal.json',
  partialManualEvidence: 'research/campaigns/rc2/inputs/manual-evidence.partial-state-negative.json',
  unknownManualEvidence: 'research/campaigns/rc2/inputs/manual-evidence.third-only-unknown.json',
  querySet: 'research/campaigns/rc2/inputs/query-set-v2.json',
});

const RC1_ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v6';
const RC1_INPUT_FILES = Object.freeze({
  planInput: `${RC1_ARTIFACT_ROOT}/inputs/plan-input.json`,
  candidateSpec: `${RC1_ARTIFACT_ROOT}/inputs/candidate-spec-v2.json`,
  normalManualEvidence: `${RC1_ARTIFACT_ROOT}/inputs/manual-evidence.normal.json`,
  negativeManualEvidence: `${RC1_ARTIFACT_ROOT}/inputs/manual-evidence.shared-state-negative.json`,
  querySet: `${RC1_ARTIFACT_ROOT}/inputs/query-set-v2.json`,
  oracle: `${RC1_ARTIFACT_ROOT}/inputs/behavior-oracle-v2.json`,
});

const PRIMARY_ARTIFACT_INPUTS = Object.freeze({
  planInput: 'inputs/primary/plan-input.json',
  candidateSpec: 'inputs/primary/candidate-spec-v1.json',
  normalManualEvidence: 'inputs/primary/manual-evidence.normal.json',
  partialManualEvidence: 'inputs/primary/manual-evidence.partial-state-negative.json',
  unknownManualEvidence: 'inputs/primary/manual-evidence.third-only-unknown.json',
  querySet: 'inputs/primary/query-set-v2.json',
});

const RC1_ARTIFACT_INPUTS = Object.freeze({
  planInput: 'inputs/rc1/plan-input.json',
  candidateSpec: 'inputs/rc1/candidate-spec-v2.json',
  normalManualEvidence: 'inputs/rc1/manual-evidence.normal.json',
  negativeManualEvidence: 'inputs/rc1/manual-evidence.shared-state-negative.json',
  querySet: 'inputs/rc1/query-set-v2.json',
  oracle: 'inputs/rc1/behavior-oracle-v2.json',
});

const SOURCE_IDENTITIES = Object.freeze([
  ['src/codegraph-adapter.mjs', 'identity/codegraph-adapter.mjs', new URL('./codegraph-adapter.mjs', import.meta.url)],
  ['src/rc1-black-box-oracle.mjs', 'identity/rc1-black-box-oracle.mjs', new URL('./rc1-black-box-oracle.mjs', import.meta.url)],
  ['src/boundary-compiler.mjs', 'identity/rc1-boundary-compiler.mjs', new URL('./boundary-compiler.mjs', import.meta.url)],
  ['src/rc1-evidence-bundle.mjs', 'identity/rc1-evidence-bundle.mjs', new URL('./rc1-evidence-bundle.mjs', import.meta.url)],
  ['src/rc2-artifact-set.mjs', 'identity/rc2-artifact-set.mjs', new URL('./rc2-artifact-set.mjs', import.meta.url)],
  ['src/rc2-campaign.mjs', 'identity/rc2-campaign.mjs', new URL(import.meta.url)],
  ['src/rc2-delivery-policy-front-end.mjs', 'identity/rc2-delivery-policy-front-end.mjs', new URL('./rc2-delivery-policy-front-end.mjs', import.meta.url)],
  ['src/rc2-delivery-policy-oracle.mjs', 'identity/rc2-delivery-policy-oracle.mjs', new URL('./rc2-delivery-policy-oracle.mjs', import.meta.url)],
  ['src/rc2-delivery-policy-transform.mjs', 'identity/rc2-delivery-policy-transform.mjs', new URL('./rc2-delivery-policy-transform.mjs', import.meta.url)],
  ['src/rc2-rc1-transfer-front-end.mjs', 'identity/rc2-rc1-transfer-front-end.mjs', new URL('./rc2-rc1-transfer-front-end.mjs', import.meta.url)],
  ['src/schedulability-compiler-v2.mjs', 'identity/schedulability-compiler-v2.mjs', new URL('./schedulability-compiler-v2.mjs', import.meta.url)],
  ['src/schedulability-verifier-v2.mjs', 'identity/schedulability-verifier-v2.mjs', new URL('./schedulability-verifier-v2.mjs', import.meta.url)],
]);

const PREDECESSOR_FILES = Object.freeze({
  'predecessors/adr-0031.md': 'docs/adr/0031-rc1-v6-phase-gate-support.md',
  'predecessors/adr-0032.md': 'docs/adr/0032-rc2-bounded-graph-compiler-and-three-way-seam.md',
  'predecessors/adr-0037.md': 'docs/adr/0037-rc2-delivery-policy-transform-transaction.md',
  'predecessors/adr-0038.md': 'docs/adr/0038-rc2-closed-loop-version-and-artifact-contract.md',
  'predecessors/rc1-v6-artifact-manifest.json': `${RC1_ARTIFACT_ROOT}/artifact-manifest.json`,
  'predecessors/rc1-v6-plan.md': 'docs/archive/2026-07-16-plan-lattice-research-campaign-1-v6-phase-supported.md',
  'predecessors/rc1-v6-seam.patch': `${RC1_ARTIFACT_ROOT}/transform/seam.patch`,
  'predecessors/rc1-v6-transform-artifact.json': `${RC1_ARTIFACT_ROOT}/transform/transform-artifact.json`,
  'predecessors/rc1-v6-transform-receipt.json': `${RC1_ARTIFACT_ROOT}/transform/transform-receipt.json`,
  'predecessors/adr-0040.md': 'docs/adr/0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md',
  'predecessors/rc2-v1-artifact-manifest.json': `${ARTIFACT_ROOTS.v1}/artifact-manifest.json`,
  'predecessors/rc2-v1-new-plan-version.json': `${ARTIFACT_ROOTS.v1}/new-plan-version.json`,
});

const RUN_IDS = Object.freeze([
  'primary-control-1',
  'primary-control-2',
  'primary-treatment-1',
  'primary-treatment-2',
  'rc1-transfer-control-1',
  'rc1-transfer-treatment-1',
]);

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(canonicalizeArtifact(value), 'utf8');
}

function roundedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 1_000) / 1_000;
}

function run(command, args, { cwd, input, allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (allowExitCodes.includes(code) && signal === null) resolve(result);
      else reject(Object.assign(
        new Error(`${command} failed (${signal ?? code}): ${result.stderr.toString('utf8').trim()}`),
        result,
      ));
    });
    child.stdin.end(input);
  });
}

async function resolveExecutable(command) {
  const entries = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const directory of entries) {
    const candidate = path.join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      const resolved = await realpath(candidate);
      const stat = await lstat(resolved);
      if (stat.isFile()) return resolved;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') throw error;
    }
  }
  throw new TypeError(`${command} executableをPATHから解決できない`);
}

async function captureExecutionIdentity(repoRoot) {
  const sources = [];
  const payloads = new Map();
  for (const [runtimePath, artifactRef, sourceUrl] of SOURCE_IDENTITIES) {
    const bytes = await readFile(sourceUrl);
    payloads.set(artifactRef, bytes);
    sources.push({ runtime_path: runtimePath, artifact_ref: artifactRef, digest: sha256(bytes) });
  }
  const executablePath = await resolveExecutable('codegraph');
  const executableBytes = await readFile(executablePath);
  const version = (await run(executablePath, ['--version'])).stdout.toString('utf8').trim();
  if (!SEMVER.test(version)) throw new TypeError('Codegraph versionがsemverではない');
  const projectConfigBytes = await readFile(path.join(repoRoot, CODEGRAPH_CONFIG_REPO_PATH));
  if (!projectConfigBytes.equals(CODEGRAPH_CONFIG_BYTES)) {
    throw new TypeError('Codegraph project config bytesがRC2 v2 contractと一致しない');
  }
  const codegraphIdentity = {
    schema: 'lattice.rc2.codegraph_identity.v2',
    version,
    executable_ref: 'codegraph',
    executable_digest: sha256(executableBytes),
    project_config_ref: CODEGRAPH_CONFIG_ARTIFACT_PATH,
    project_config_digest: sha256(projectConfigBytes),
  };
  payloads.set('identity/codegraph-executable', executableBytes);
  payloads.set(CODEGRAPH_CONFIG_ARTIFACT_PATH, projectConfigBytes);
  const snapshot = { sources, codegraph_identity: codegraphIdentity };
  return { snapshot, digest: digestArtifact(snapshot), payloads };
}

async function readJson(repoRoot, relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function loadInputs(repoRoot) {
  const primary = {};
  const rc1 = {};
  for (const [key, relativePath] of Object.entries(PRIMARY_INPUT_FILES)) {
    primary[key] = await readJson(repoRoot, relativePath);
  }
  for (const [key, relativePath] of Object.entries(RC1_INPUT_FILES)) {
    rc1[key] = await readJson(repoRoot, relativePath);
  }
  return { primary, rc1 };
}

async function loadPredecessors(repoRoot) {
  const payloads = new Map();
  for (const [artifactPath, repoPath] of Object.entries(PREDECESSOR_FILES)) {
    payloads.set(artifactPath, await readFile(path.join(repoRoot, repoPath)));
  }
  return payloads;
}

function loadV1PlanPredecessor(payloads) {
  const manifestBytes = payloads.get('predecessors/rc2-v1-artifact-manifest.json');
  const planBytes = payloads.get('predecessors/rc2-v1-new-plan-version.json');
  let manifest;
  let plan;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    plan = JSON.parse(planBytes.toString('utf8'));
  } catch {
    throw new TypeError('RC2 v1 predecessor JSONをparseできない');
  }
  const paths = Array.isArray(manifest?.files)
    ? manifest.files.map(({ path: relativePath }) => relativePath).sort()
    : [];
  const entry = manifest?.files?.find(({ path: relativePath }) => (
    relativePath === 'new-plan-version.json'
  ));
  if (!jsonBytes(manifest).equals(manifestBytes)
    || !jsonBytes(plan).equals(planBytes)
    || manifest.schema !== 'lattice.rc2.artifact_manifest.v1'
    || !isDeepStrictEqual(paths, [...RC2_V1_ARTIFACT_PATHS])
    || !exactRecord(entry, ['path', 'media_type', 'bytes', 'sha256'])
    || entry.media_type !== 'application/json'
    || entry.bytes !== planBytes.byteLength
    || entry.sha256 !== sha256(planBytes)
    || plan.schema !== 'lattice.rc2.plan_version.v1'
    || plan.version !== 'rc2-delivery-policy-v2'
    || plan.plan_digest !== digestArtifact(plan.plan)) {
    throw new TypeError('RC2 v1 predecessor manifest／plan bindingが不正');
  }
  return plan;
}

async function resolveRepository(repoRoot, baseRef) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0) {
    throw new TypeError('repoRoot and baseRef are required');
  }
  const root = await realpath(repoRoot);
  const status = await run('git', ['status', '--porcelain=v1', '-z'], { cwd: root });
  if (status.stdout.length > 0) throw new TypeError('RC2 campaign source repository must be clean');
  const head = (await run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root }))
    .stdout.toString('utf8').trim();
  const baseSha = (await run('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: root }))
    .stdout.toString('utf8').trim();
  if (!GIT_SHA1.test(head) || !GIT_SHA1.test(baseSha) || head !== baseSha) {
    throw new TypeError('RC2 campaign requires clean HEAD === baseRef');
  }
  return { root, baseSha };
}

function surfacePaths(candidateSpec) {
  const result = new Set();
  if (candidateSpec.fixed_oracle?.path) result.add(candidateSpec.fixed_oracle.path);
  for (const todo of candidateSpec.todos) {
    for (const mode of ['current', 'proposed']) {
      result.add(todo[mode].production.path);
      todo[mode].tests.forEach(({ path: testPath }) => result.add(testPath));
    }
  }
  return [...result].sort();
}

async function captureSourceSnapshot(repoRoot, paths) {
  const files = [];
  for (const relativePath of paths) {
    const absolutePath = path.join(repoRoot, relativePath);
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new TypeError(`snapshot pathが通常fileではない: ${relativePath}`);
      }
      files.push({ path: relativePath, state: 'file', content_digest: sha256(await readFile(absolutePath)) });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files.push({ path: relativePath, state: 'absent', content_digest: null });
    }
  }
  return { schema_version: 'lattice.rc2.source_snapshot.v1', files };
}

async function applyPatch(worktreePath, patch) {
  if (!Buffer.isBuffer(patch) || patch.length === 0) throw new TypeError('accepted patch bytes are required');
  await run('git', ['apply', '--check', '--binary', '-'], { cwd: worktreePath, input: patch });
  await run('git', ['apply', '--binary', '-'], { cwd: worktreePath, input: patch });
}

async function captureCodegraphBootstrap(worktreePath) {
  try {
    return await readFile(path.join(worktreePath, '.codegraph', '.gitignore'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreCodegraphBootstrap(worktreePath, bootstrap) {
  const codegraphPath = path.join(worktreePath, '.codegraph');
  await rm(codegraphPath, { recursive: true, force: true });
  if (bootstrap === null) return;
  await mkdir(codegraphPath, { recursive: true });
  await writeFile(path.join(codegraphPath, '.gitignore'), bootstrap);
}

async function worktreeCount(repoRoot) {
  const output = (await run('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot }))
    .stdout.toString('utf8');
  return output.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

function measured(elapsedMs) {
  return { state: 'measured', elapsed_ms: elapsedMs };
}

async function observeFreshIndex({
  repoRoot,
  baseSha,
  family,
  condition,
  runId,
  querySet,
  paths,
  patch,
  allowedPaths,
  codegraphIdentity,
  oracle,
  rc1Inputs,
  costMeasurements,
}) {
  const beforeCount = await worktreeCount(repoRoot);
  let rawEvidence;
  let snapshot;
  let oracleReceipt;
  let isolationInstanceDigest;
  let indexElapsedMs;
  let queryElapsedMs;
  let oracleElapsedMs;
  const isolated = await runIsolatedTransform({
    repoRoot,
    baseRef: baseSha,
    allowedPaths,
    transform: async ({ worktreePath }) => {
      if (condition === 'treatment') await applyPatch(worktreePath, patch);
    },
    verifyCommands: [],
    observe: async ({ worktreePath }) => {
      isolationInstanceDigest = sha256(Buffer.from(worktreePath, 'utf8'));
      snapshot = await captureSourceSnapshot(worktreePath, paths);
      const oracleStarted = performance.now();
      oracleReceipt = family === 'primary'
        ? await runRc2DeliveryPolicyOracle({ repoRoot: worktreePath })
        : await runRc1BlackBoxOracle({ repoRoot: worktreePath, oracle });
      oracleElapsedMs = roundedMilliseconds(oracleStarted);
      if (oracleReceipt.outcome !== 'passed') throw new TypeError(`${runId} oracle failed`);
      const bootstrap = await captureCodegraphBootstrap(worktreePath);
      try {
        const indexStarted = performance.now();
        await run('codegraph', ['init', '.'], { cwd: worktreePath });
        indexElapsedMs = roundedMilliseconds(indexStarted);
        const queryStarted = performance.now();
        rawEvidence = await collectCodegraphEvidence({ cwd: worktreePath, querySet });
        queryElapsedMs = roundedMilliseconds(queryStarted);
      } finally {
        await restoreCodegraphBootstrap(worktreePath, bootstrap);
      }
    },
  });
  const afterCount = await worktreeCount(repoRoot);
  if (!rawEvidence || !snapshot || !oracleReceipt || !isolationInstanceDigest
    || isolated.sourceInvariant?.outcome !== 'passed'
    || beforeCount !== afterCount) {
    throw new TypeError(`${runId} fresh observation is incomplete`);
  }
  if (condition === 'treatment' && !isolated.patch.equals(patch)) {
    throw new TypeError(`${runId} did not replay the accepted patch exactly`);
  }
  if (condition === 'control' && isolated.patch.length !== 0) {
    throw new TypeError(`${runId} control unexpectedly changed source`);
  }
  const evidence = createRc1EvidenceBundle({ condition, runId, querySet, rawEvidence });
  const patchDigest = condition === 'treatment' ? sha256(isolated.patch) : null;
  const measurement = {
    schema: 'lattice.rc2.codegraph_measurement.v1',
    base_sha: baseSha,
    patch_digest: patchDigest,
    snapshot,
    snapshot_digest: digestArtifact(snapshot),
    codegraph_identity: structuredClone(codegraphIdentity),
    codegraph_identity_digest: digestArtifact(codegraphIdentity),
    query_set_digest: digestArtifact(querySet),
    raw_evidence_digest: evidence.raw.payload_digest,
  };
  const cost = {
    index: measured(indexElapsedMs),
    query: measured(queryElapsedMs),
    oracle: measured(oracleElapsedMs),
  };
  for (const [stage, value] of Object.entries(cost)) {
    costMeasurements.push({
      stage: `run.${runId}.${stage}`,
      state: value.state,
      elapsed_ms: value.elapsed_ms,
    });
  }
  const runRecord = {
    schema: 'lattice.rc2.fresh_codegraph_run.v1',
    family,
    condition,
    run_id: runId,
    fresh_index: true,
    isolation_instance_digest: isolationInstanceDigest,
    evidence,
    measurement,
    oracle_receipt: oracleReceipt,
    legacy_boundary_manifests: null,
    source_invariant: isolated.sourceInvariant,
    cleanup: {
      schema: 'lattice.rc2.worktree_cleanup_receipt.v1',
      outcome: 'passed',
      worktree_count_before: beforeCount,
      worktree_count_after: afterCount,
    },
    cost,
  };
  if (family === 'rc1_transfer') {
    const raw = JSON.parse(Buffer.from(evidence.raw.payload_base64, 'base64').toString('utf8'));
    const compileLegacy = (manualEvidence, label) => compileBoundaryCondition({
      planInput: rc1Inputs.planInput,
      candidateSpec: rc1Inputs.candidateSpec,
      manualEvidence,
      querySet: rc1Inputs.querySet,
      codegraphEvidence: raw,
      codeSnapshotDigest: measurement.snapshot_digest,
      planVersion: `rc2-${condition}-transfer-${label}`,
    });
    runRecord.legacy_boundary_manifests = {
      normal: compileLegacy(rc1Inputs.normalManualEvidence, 'normal').boundary_manifest,
      negative: compileLegacy(rc1Inputs.negativeManualEvidence, 'negative').boundary_manifest,
    };
  }
  return runRecord;
}

function verdictFor(bundle, compiled) {
  return {
    schema_version: 'lattice.boundary_verdict.v2',
    normalized_graph_digest: bundle.graph_digest,
    verdicts: compiled.pairwise_verdicts,
  };
}

function timedSync(stage, costMeasurements, execute) {
  const startedAt = performance.now();
  const value = execute();
  costMeasurements.push({ stage, state: 'measured', elapsed_ms: roundedMilliseconds(startedAt) });
  return value;
}

function compiledRecord({ condition, runId, bundle, costMeasurements }) {
  const compiled = timedSync(`compile.${condition}.${runId}`, costMeasurements, () => (
    compileSchedulabilityGraphV2(bundle.graph)
  ));
  if (compiled.outcome !== 'compiled') throw new TypeError(`${condition} did not compile`);
  const verdict = verdictFor(bundle, compiled);
  const verification = timedSync(`verify.${condition}.${runId}`, costMeasurements, () => (
    verifySchedulabilityPlanV2(bundle.graph, compiled.plan)
  ));
  if (verification.outcome !== 'verified') throw new TypeError(`${condition} minimum is unverified`);
  const stable = { bundle, verdict, plan: compiled.plan, verification };
  return {
    schema: 'lattice.rc2.compiled_condition.v1',
    condition,
    run_id: runId,
    outcome: 'compiled',
    ...stable,
    artifact_digest: digestArtifact(stable),
  };
}

function compilePrimary({ runRecord, inputs, manualEvidence, planInput, condition, costMeasurements }) {
  const bundle = timedSync(`front-end.${condition}.${runRecord.run_id}`, costMeasurements, () => (
    compileDeliveryPolicyBoundaryBundleV2({
      planInput,
      candidateSpec: inputs.candidateSpec,
      manualEvidence,
      querySet: inputs.querySet,
      sourceSnapshot: runRecord.measurement.snapshot,
      codegraphEvidence: runRecord.evidence.portable,
    })
  ));
  return compiledRecord({ condition, runId: runRecord.run_id, bundle, costMeasurements });
}

function compileUnknown({ runRecord, inputs, costMeasurements }) {
  const condition = 'primary-treatment-third-only-unknown';
  const bundle = timedSync(`front-end.${condition}.${runRecord.run_id}`, costMeasurements, () => (
    compileDeliveryPolicyBoundaryBundleV2({
      planInput: inputs.planInput,
      candidateSpec: inputs.candidateSpec,
      manualEvidence: inputs.unknownManualEvidence,
      querySet: inputs.querySet,
      sourceSnapshot: runRecord.measurement.snapshot,
      codegraphEvidence: runRecord.evidence.portable,
    })
  ));
  const outcome = timedSync(`compile.${condition}.${runRecord.run_id}`, costMeasurements, () => (
    compileSchedulabilityGraphV2(bundle.graph)
  ));
  const verification = timedSync(`verify.${condition}.${runRecord.run_id}`, costMeasurements, () => (
    verifySchedulabilityPlanV2(bundle.graph, {
      schema_version: 'lattice.plan_graph.v2',
      waves: [],
      minimum_feasible_waves: 0,
    })
  ));
  if (outcome.outcome !== 'unknown' || verification.outcome !== 'unknown') {
    throw new TypeError('third-only unknown became dispatchable');
  }
  return {
    schema: 'lattice.rc2.non_dispatchable_condition.v1',
    condition,
    run_id: runRecord.run_id,
    bundle,
    outcome,
    verification,
  };
}

function compileTransfer({ runRecord, inputs, manualEvidence, label, costMeasurements }) {
  const condition = `rc1-transfer-${runRecord.condition}-${label}`;
  const transferred = timedSync(`front-end.${condition}.${runRecord.run_id}`, costMeasurements, () => (
    compileRc1TransferBundleV2({
      planInput: inputs.planInput,
      candidateSpec: inputs.candidateSpec,
      manualEvidence,
      querySet: inputs.querySet,
      boundaryManifest: runRecord.legacy_boundary_manifests[label],
    })
  ));
  const verification = timedSync(`verify.${condition}.${runRecord.run_id}`, costMeasurements, () => (
    verifySchedulabilityPlanV2(transferred.bundle.graph, transferred.plan)
  ));
  if (verification.outcome !== 'verified') throw new TypeError(`${condition} minimum is unverified`);
  const stable = {
    bundle: transferred.bundle,
    verdict: transferred.verdict,
    plan: transferred.plan,
    verification,
  };
  return {
    schema: 'lattice.rc2.compiled_condition.v1',
    condition,
    run_id: runRecord.run_id,
    outcome: 'compiled',
    ...stable,
    artifact_digest: digestArtifact(stable),
  };
}

function compileAllConditions({ runs, inputs, costMeasurements }) {
  const primaryControl = runs.primary.control.map((runRecord) => compilePrimary({
    runRecord,
    inputs: inputs.primary,
    manualEvidence: inputs.primary.normalManualEvidence,
    planInput: inputs.primary.planInput,
    condition: 'primary-control-normal',
    costMeasurements,
  }));
  const primaryTreatment = runs.primary.treatment.map((runRecord) => compilePrimary({
    runRecord,
    inputs: inputs.primary,
    manualEvidence: inputs.primary.normalManualEvidence,
    planInput: inputs.primary.planInput,
    condition: 'primary-treatment-normal',
    costMeasurements,
  }));
  if (new Set(primaryControl.map(({ artifact_digest: digest }) => digest)).size !== 1
    || new Set(primaryTreatment.map(({ artifact_digest: digest }) => digest)).size !== 1) {
    throw new TypeError('primary repeated compilation is not structurally reproducible');
  }
  const treatmentRun = runs.primary.treatment[0];
  const capacityPlan = structuredClone(inputs.primary.planInput);
  capacityPlan.capacity.writers = 2;
  const partialState = compilePrimary({
    runRecord: treatmentRun,
    inputs: inputs.primary,
    manualEvidence: inputs.primary.partialManualEvidence,
    planInput: inputs.primary.planInput,
    condition: 'primary-treatment-partial-state',
    costMeasurements,
  });
  const capacity2 = compilePrimary({
    runRecord: treatmentRun,
    inputs: inputs.primary,
    manualEvidence: inputs.primary.normalManualEvidence,
    planInput: capacityPlan,
    condition: 'primary-treatment-capacity-2',
    costMeasurements,
  });
  const unknown = compileUnknown({ runRecord: treatmentRun, inputs: inputs.primary, costMeasurements });
  const transferControl = runs.rc1_transfer.control[0];
  const transferTreatment = runs.rc1_transfer.treatment[0];
  return {
    primary: {
      control: primaryControl,
      treatment: primaryTreatment,
      partial_state: partialState,
      capacity_2: capacity2,
      third_only_unknown: unknown,
    },
    rc1_transfer: {
      control: {
        normal: compileTransfer({
          runRecord: transferControl,
          inputs: inputs.rc1,
          manualEvidence: inputs.rc1.normalManualEvidence,
          label: 'normal',
          costMeasurements,
        }),
        negative: compileTransfer({
          runRecord: transferControl,
          inputs: inputs.rc1,
          manualEvidence: inputs.rc1.negativeManualEvidence,
          label: 'negative',
          costMeasurements,
        }),
      },
      treatment: {
        normal: compileTransfer({
          runRecord: transferTreatment,
          inputs: inputs.rc1,
          manualEvidence: inputs.rc1.normalManualEvidence,
          label: 'normal',
          costMeasurements,
        }),
        negative: compileTransfer({
          runRecord: transferTreatment,
          inputs: inputs.rc1,
          manualEvidence: inputs.rc1.negativeManualEvidence,
          label: 'negative',
          costMeasurements,
        }),
      },
    },
  };
}

function compiledPayloads(compiled) {
  return new Map([
    ['compiled/primary-control-1-normal.json', jsonBytes(compiled.primary.control[0])],
    ['compiled/primary-control-2-normal.json', jsonBytes(compiled.primary.control[1])],
    ['compiled/primary-treatment-1-normal.json', jsonBytes(compiled.primary.treatment[0])],
    ['compiled/primary-treatment-2-normal.json', jsonBytes(compiled.primary.treatment[1])],
    ['compiled/primary-treatment-partial-state.json', jsonBytes(compiled.primary.partial_state)],
    ['compiled/primary-treatment-capacity-2.json', jsonBytes(compiled.primary.capacity_2)],
    ['compiled/primary-treatment-third-only-unknown.json', jsonBytes(compiled.primary.third_only_unknown)],
    ['compiled/rc1-transfer-control-normal.json', jsonBytes(compiled.rc1_transfer.control.normal)],
    ['compiled/rc1-transfer-control-negative.json', jsonBytes(compiled.rc1_transfer.control.negative)],
    ['compiled/rc1-transfer-treatment-normal.json', jsonBytes(compiled.rc1_transfer.treatment.normal)],
    ['compiled/rc1-transfer-treatment-negative.json', jsonBytes(compiled.rc1_transfer.treatment.negative)],
  ]);
}

function inputPayloads(inputs) {
  const result = new Map();
  for (const [key, relativePath] of Object.entries(PRIMARY_ARTIFACT_INPUTS)) {
    result.set(relativePath, jsonBytes(inputs.primary[key]));
  }
  for (const [key, relativePath] of Object.entries(RC1_ARTIFACT_INPUTS)) {
    result.set(relativePath, jsonBytes(inputs.rc1[key]));
  }
  return result;
}

function transformPayloads(transform) {
  return new Map([
    ['transform/accepted-artifact.json', jsonBytes(transform.accepted.artifact)],
    ['transform/accepted-receipt.json', jsonBytes(transform.accepted.receipt)],
    ['transform/behavior-evidence.json', jsonBytes(transform.accepted.behavior_evidence)],
    ['transform/mutation-evidence.json', jsonBytes(transform.accepted.mutation_evidence)],
    ['transform/rejected-incomplete-artifact.json', jsonBytes(transform.rejected.incomplete.artifact)],
    ['transform/rejected-incomplete-receipt.json', jsonBytes(transform.rejected.incomplete.receipt)],
    ['transform/rejected-scope-artifact.json', jsonBytes(transform.rejected.scope.artifact)],
    ['transform/rejected-scope-receipt.json', jsonBytes(transform.rejected.scope.receipt)],
    ['transform/seam.patch', Buffer.from(transform.accepted.patch)],
  ]);
}

function storedEvidence(evidence) {
  const raw = evidence?.raw;
  if (!exactRecord(raw, [
    'schema',
    'media_type',
    'encoding',
    'canonical_bytes',
    'payload_digest',
    'payload_base64',
  ])
    || raw.schema !== 'lattice.codegraph_raw_opaque_receipt.v1'
    || raw.encoding !== 'canonical-json-base64'
    || typeof raw.payload_base64 !== 'string') {
    throw new TypeError('run raw evidence receipt is invalid');
  }
  const payload = Buffer.from(raw.payload_base64, 'base64');
  if (payload.toString('base64') !== raw.payload_base64
    || payload.byteLength !== raw.canonical_bytes
    || sha256(payload) !== raw.payload_digest) {
    throw new TypeError('run raw evidence payload binding is invalid');
  }
  const payloadBase64Chunks = [];
  for (let offset = 0; offset < raw.payload_base64.length; offset += RAW_EVIDENCE_CHUNK_BYTES) {
    payloadBase64Chunks.push(raw.payload_base64.slice(
      offset,
      offset + RAW_EVIDENCE_CHUNK_BYTES,
    ));
  }
  if (payloadBase64Chunks.length === 0
    || payloadBase64Chunks.slice(0, -1).some((chunk) => (
      Buffer.byteLength(chunk, 'utf8') !== RAW_EVIDENCE_CHUNK_BYTES
    ))
    || Buffer.byteLength(payloadBase64Chunks.at(-1), 'utf8') > RAW_EVIDENCE_CHUNK_BYTES) {
    throw new TypeError('run raw evidence chunks are invalid');
  }
  return {
    ...structuredClone(evidence),
    raw: {
      schema: 'lattice.rc2.chunked_codegraph_raw_receipt.v1',
      source_schema: raw.schema,
      media_type: raw.media_type,
      source_encoding: raw.encoding,
      storage_encoding: 'ordered-base64-chunks',
      canonical_bytes: raw.canonical_bytes,
      payload_digest: raw.payload_digest,
      payload_base64_chunks: payloadBase64Chunks,
    },
  };
}

function storedRunRecord(runRecord) {
  return {
    ...structuredClone(runRecord),
    evidence: storedEvidence(runRecord.evidence),
  };
}

function runPayloads(runs) {
  const records = [
    ...runs.primary.control,
    ...runs.primary.treatment,
    ...runs.rc1_transfer.control,
    ...runs.rc1_transfer.treatment,
  ];
  return new Map(records.map((runRecord) => [
    `evidence/${runRecord.run_id}.json`,
    jsonBytes(storedRunRecord(runRecord)),
  ]));
}

function mergePayloads(...maps) {
  const result = new Map();
  for (const map of maps) {
    for (const [relativePath, bytes] of map) {
      if (result.has(relativePath)) throw new TypeError(`duplicate artifact payload: ${relativePath}`);
      result.set(relativePath, Buffer.from(bytes));
    }
  }
  return result;
}

function predecessorDescriptors(payloads) {
  const descriptors = [];
  const add = (kind, ref) => descriptors.push({ kind, ref, digest: sha256(payloads.get(ref)) });
  for (const ref of Object.keys(PREDECESSOR_FILES).sort()) {
    add(ref === 'predecessors/rc1-v6-plan.md' ? 'rc1_v6_phase_archive' : 'immutable_predecessor', ref);
  }
  add('accepted_transform', 'transform/accepted-artifact.json');
  add('behavior_envelope', 'transform/behavior-evidence.json');
  add('mutation_evidence', 'transform/mutation-evidence.json');
  for (const runId of RUN_IDS) add('evidence_bundle', `evidence/${runId}.json`);
  for (const ref of Object.values(PRIMARY_ARTIFACT_INPUTS).sort()) add('fixed_input', ref);
  add('execution_identity', 'identity.json');
  add('compiler_identity', 'identity/schedulability-compiler-v2.mjs');
  add('verifier_identity', 'identity/schedulability-verifier-v2.mjs');
  add('codegraph_project_config', CODEGRAPH_CONFIG_ARTIFACT_PATH);
  return descriptors;
}

function buildVersionBarrier({ inputs, compiled, predecessors, predecessorPlan }) {
  const treatment = compiled.primary.treatment[0];
  const affectedTodos = inputs.primary.planInput.todos.map(({ id }) => id);
  const newPlanVersion = {
    schema: 'lattice.rc2.plan_version.v1',
    version: 'rc2-delivery-policy-v3',
    predecessor_version: predecessorPlan.version,
    plan: treatment.plan,
    plan_digest: digestArtifact(treatment.plan),
    bundle_digest: digestArtifact(treatment.bundle),
    verdict_digest: digestArtifact(treatment.verdict),
    affected_todos: affectedTodos,
    causal_predecessors: predecessors,
  };
  const planDiff = {
    schema: 'lattice.rc2.plan_diff.v1',
    old_plan: {
      version: predecessorPlan.version,
      digest: digestArtifact(predecessorPlan),
    },
    new_plan: {
      version: newPlanVersion.version,
      digest: digestArtifact(newPlanVersion),
    },
    causal_predecessors: predecessors,
    affected_todos: affectedTodos,
    invalidated_contexts: [
      { kind: 'old_plan', ref: predecessorPlan.version,
        reason: 'the v2 sensor scope and evidence cannot receive v3 bindings by append' },
      { kind: 'agent_context', ref: `${predecessorPlan.version}-agent-context`,
        reason: 'v2 agent context does not bind the post-publication sensor identity' },
      { kind: 'partial_patch', ref: `${predecessorPlan.version}-partial-patch`,
        reason: 'patches compiled before the corrected sensor identity cannot cross the barrier' },
      { kind: 'interface_assumption', ref: `${predecessorPlan.version}-interface-assumption`,
        reason: 'v2 interface evidence is not bound to the corrected sensor identity' },
      { kind: 'boundary_evidence', ref: `${predecessorPlan.version}-boundary-evidence`,
        reason: 'only fresh post-publication treatment evidence is valid for plan v3' },
    ],
  };
  return { newPlanVersion, planDiff };
}

function distinctConflictPairs(record) {
  return new Set(record.bundle.graph.conflicts.map(({ todo_ids: todoIds }) => (
    [...todoIds].sort().join('\u0000')
  ))).size;
}

function conditionMetrics(record) {
  return {
    conflict_records: record.bundle.graph.conflicts.length,
    distinct_conflict_pairs: distinctConflictPairs(record),
    minimum_feasible_waves: record.plan.minimum_feasible_waves,
  };
}

function buildComparison({ baseSha, identity, transform, compiled, newPlanVersion, planDiff }) {
  return {
    schema: 'lattice.rc2.control_treatment_comparison.v1',
    base_sha: baseSha,
    identity_digest: digestArtifact(identity),
    independent_variable: {
      kind: 'accepted_registry_shard_patch',
      transform_artifact_digest: digestArtifact(transform.accepted.artifact),
      patch_digest: transform.accepted.artifact.patch.digest,
    },
    condition_artifact_digests: {
      primary_control: compiled.primary.control.map(({ artifact_digest: digest }) => digest),
      primary_treatment: compiled.primary.treatment.map(({ artifact_digest: digest }) => digest),
      primary_partial_state: compiled.primary.partial_state.artifact_digest,
      primary_capacity_2: compiled.primary.capacity_2.artifact_digest,
      primary_unknown: digestArtifact(compiled.primary.third_only_unknown),
      rc1_transfer_control_normal: compiled.rc1_transfer.control.normal.artifact_digest,
      rc1_transfer_control_negative: compiled.rc1_transfer.control.negative.artifact_digest,
      rc1_transfer_treatment_normal: compiled.rc1_transfer.treatment.normal.artifact_digest,
      rc1_transfer_treatment_negative: compiled.rc1_transfer.treatment.negative.artifact_digest,
    },
    metrics: {
      primary_control: conditionMetrics(compiled.primary.control[0]),
      primary_treatment: conditionMetrics(compiled.primary.treatment[0]),
      primary_partial_state: conditionMetrics(compiled.primary.partial_state),
      primary_capacity_2: conditionMetrics(compiled.primary.capacity_2),
      rc1_transfer_control_normal: conditionMetrics(compiled.rc1_transfer.control.normal),
      rc1_transfer_control_negative: conditionMetrics(compiled.rc1_transfer.control.negative),
      rc1_transfer_treatment_normal: conditionMetrics(compiled.rc1_transfer.treatment.normal),
      rc1_transfer_treatment_negative: conditionMetrics(compiled.rc1_transfer.treatment.negative),
    },
    version_barrier: {
      new_plan_version_digest: digestArtifact(newPlanVersion),
      plan_diff_digest: digestArtifact(planDiff),
      causal_predecessors_digest: digestArtifact(planDiff.causal_predecessors),
    },
  };
}

function evaluateHypothesis(comparison, compiled, transform) {
  const checks = [
    { id: 'accepted_transform_only', passed: transform.accepted.status === 'accepted' },
    {
      id: 'primary_repeat_reproducible',
      passed: new Set(compiled.primary.control.map(({ artifact_digest: digest }) => digest)).size === 1
        && new Set(compiled.primary.treatment.map(({ artifact_digest: digest }) => digest)).size === 1,
    },
    {
      id: 'primary_conflicts_removed',
      passed: comparison.metrics.primary_control.conflict_records === 12
        && comparison.metrics.primary_control.distinct_conflict_pairs === 3
        && comparison.metrics.primary_treatment.conflict_records === 0,
    },
    {
      id: 'primary_waves_reduced',
      passed: comparison.metrics.primary_control.minimum_feasible_waves === 3
        && comparison.metrics.primary_treatment.minimum_feasible_waves === 1,
    },
    {
      id: 'partial_state_preserved',
      passed: comparison.metrics.primary_partial_state.conflict_records === 1
        && comparison.metrics.primary_partial_state.minimum_feasible_waves === 2,
    },
    {
      id: 'capacity_control_preserved',
      passed: comparison.metrics.primary_capacity_2.conflict_records === 0
        && comparison.metrics.primary_capacity_2.minimum_feasible_waves === 2,
    },
    {
      id: 'third_only_unknown_closed',
      passed: compiled.primary.third_only_unknown.outcome.outcome === 'unknown'
        && compiled.primary.third_only_unknown.verification.outcome === 'unknown',
    },
    {
      id: 'rc1_transfer_isomorphic',
      passed: comparison.metrics.rc1_transfer_control_normal.conflict_records === 3
        && comparison.metrics.rc1_transfer_control_normal.minimum_feasible_waves === 2
        && comparison.metrics.rc1_transfer_treatment_normal.conflict_records === 0
        && comparison.metrics.rc1_transfer_treatment_normal.minimum_feasible_waves === 1
        && comparison.metrics.rc1_transfer_control_negative.minimum_feasible_waves === 2
        && comparison.metrics.rc1_transfer_treatment_negative.minimum_feasible_waves === 2,
    },
    {
      id: 'all_minimum_verified',
      passed: [
        ...compiled.primary.control,
        ...compiled.primary.treatment,
        compiled.primary.partial_state,
        compiled.primary.capacity_2,
        compiled.rc1_transfer.control.normal,
        compiled.rc1_transfer.control.negative,
        compiled.rc1_transfer.treatment.normal,
        compiled.rc1_transfer.treatment.negative,
      ].every(({ verification }) => verification.outcome === 'verified'),
    },
  ];
  return {
    schema: 'lattice.rc2.hypothesis_evaluation.v1',
    checks,
    supported: checks.every(({ passed }) => passed),
    failed_conditions: checks.filter(({ passed }) => !passed).map(({ id }) => id),
  };
}

function patchReviewLines(patch) {
  return patch.toString('utf8').split('\n').filter((line) => (
    (line.startsWith('+') && !line.startsWith('+++'))
    || (line.startsWith('-') && !line.startsWith('---'))
  )).length;
}

function buildCost(costMeasurements, transform) {
  const elapsed = Math.round(costMeasurements
    .reduce((sum, measurement) => sum + measurement.elapsed_ms, 0) * 1_000) / 1_000;
  return {
    schema: 'lattice.rc2.stage_cost.v1',
    measurements: costMeasurements,
    aggregate: {
      measured_count: costMeasurements.length,
      not_measured_count: 0,
      elapsed_ms: elapsed,
    },
    intervention: {
      patch_bytes: transform.accepted.patch.byteLength,
      files: transform.accepted.artifact.scope.changed_paths.length,
      review_lines: patchReviewLines(transform.accepted.patch),
    },
    rework: { rejected_attempts: 2, retries: 0, rollbacks: 0 },
    unverified: [
      'actual multi-agent wall-clock improvement',
      'elapsed measurement attestation beyond saved arithmetic binding',
      'arbitrary-repository seam success rate',
    ],
  };
}

function allCompiledRecords(compiled) {
  return [
    ...compiled.primary.control,
    ...compiled.primary.treatment,
    compiled.primary.partial_state,
    compiled.primary.capacity_2,
    compiled.primary.third_only_unknown,
    compiled.rc1_transfer.control.normal,
    compiled.rc1_transfer.control.negative,
    compiled.rc1_transfer.treatment.normal,
    compiled.rc1_transfer.treatment.negative,
  ];
}

function buildExecutionEvidence({
  baseSha,
  identity,
  transform,
  runs,
  compiled,
  newPlanVersion,
  planDiff,
  comparison,
  hypothesis,
  cost,
}) {
  const runRecords = [
    ...runs.primary.control,
    ...runs.primary.treatment,
    ...runs.rc1_transfer.control,
    ...runs.rc1_transfer.treatment,
  ];
  return {
    schema: 'lattice.rc2.campaign_execution_evidence.v1',
    base_sha: baseSha,
    identity_digest: digestArtifact(identity),
    transform_artifact_digest: digestArtifact(transform.accepted.artifact),
    run_digests: runRecords.map((runRecord) => digestArtifact(storedRunRecord(runRecord))),
    compiled_condition_digests: allCompiledRecords(compiled).map(digestArtifact),
    new_plan_version_digest: digestArtifact(newPlanVersion),
    plan_diff_digest: digestArtifact(planDiff),
    comparison_digest: digestArtifact(comparison),
    hypothesis_evaluation_digest: digestArtifact(hypothesis),
    cost_digest: digestArtifact(cost),
  };
}

async function timedAsync(stage, costMeasurements, execute) {
  const startedAt = performance.now();
  const value = await execute();
  costMeasurements.push({ stage, state: 'measured', elapsed_ms: roundedMilliseconds(startedAt) });
  return value;
}

async function runTransforms({ root, baseSha, candidateSpec, costMeasurements }) {
  const accepted = await timedAsync('transform.accepted', costMeasurements, () => (
    runRc2DeliveryPolicySeamTransform({ repoRoot: root, baseRef: baseSha, candidateSpec })
  ));
  if (accepted.status !== 'accepted' || !Buffer.isBuffer(accepted.patch)) {
    throw new TypeError('default RC2 transform was not accepted');
  }
  const incomplete = await timedAsync('transform.rejected.incomplete', costMeasurements, () => (
    runRc2DeliveryPolicySeamTransform({
      repoRoot: root,
      baseRef: baseSha,
      candidateSpec,
      transform: async ({ worktreePath }) => {
        await applyRc2DeliveryPolicyTransform({ worktreePath });
        await rm(path.join(worktreePath, 'test/rc2-delivery-policy-sms.test.mjs'));
      },
    })
  ));
  const scope = await timedAsync('transform.rejected.scope', costMeasurements, () => (
    runRc2DeliveryPolicySeamTransform({
      repoRoot: root,
      baseRef: baseSha,
      candidateSpec,
      transform: async ({ worktreePath }) => {
        await applyRc2DeliveryPolicyTransform({ worktreePath });
        await writeFile(path.join(worktreePath, 'rc2-scope-violation.tmp'), 'forbidden\n');
      },
    })
  ));
  if (incomplete.status !== 'rejected'
    || incomplete.artifact.rejection.kind !== 'incomplete_transform'
    || scope.status !== 'rejected'
    || scope.artifact.rejection.kind !== 'scope_violation') {
    throw new TypeError('RC2 rejected transform controls did not preserve typed outcomes');
  }
  return { accepted, rejected: { incomplete, scope } };
}

/** accepted seamを独立変数にfresh sensor→v2 compile→new planまで実行する。 */
export async function runRc2Campaign(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'baseRef', 'artifactVersion'])
    || options.artifactVersion !== ARTIFACT_VERSION) {
    throw new TypeError('runRc2Campaign options must select exact artifactVersion v2');
  }
  const { root, baseSha } = await resolveRepository(options.repoRoot, options.baseRef);
  const [inputs, predecessors, identityBefore] = await Promise.all([
    loadInputs(root),
    loadPredecessors(root),
    captureExecutionIdentity(root),
  ]);
  const predecessorPlan = loadV1PlanPredecessor(predecessors);
  const costMeasurements = [];
  const transform = await runTransforms({
    root,
    baseSha,
    candidateSpec: inputs.primary.candidateSpec,
    costMeasurements,
  });
  const primaryPaths = surfacePaths(inputs.primary.candidateSpec);
  const rc1Paths = surfacePaths(inputs.rc1.candidateSpec);
  if (primaryPaths.length !== 9 || rc1Paths.length !== 6) {
    throw new TypeError('campaign fixed surface cardinality is invalid');
  }
  const rc1TransformArtifact = JSON.parse(
    predecessors.get('predecessors/rc1-v6-transform-artifact.json').toString('utf8'),
  );
  const rc1Patch = predecessors.get('predecessors/rc1-v6-seam.patch');
  if (rc1TransformArtifact.patch.digest !== sha256(rc1Patch)) {
    throw new TypeError('RC1 v6 predecessor patch binding is invalid');
  }
  const common = {
    repoRoot: root,
    baseSha,
    codegraphIdentity: identityBefore.snapshot.codegraph_identity,
    costMeasurements,
  };
  const primaryControl = [];
  const primaryTreatment = [];
  for (let index = 1; index <= 2; index += 1) {
    primaryControl.push(await observeFreshIndex({
      ...common,
      family: 'primary',
      condition: 'control',
      runId: `primary-control-${index}`,
      querySet: inputs.primary.querySet,
      paths: primaryPaths,
      patch: null,
      allowedPaths: [],
      oracle: null,
      rc1Inputs: null,
    }));
  }
  for (let index = 1; index <= 2; index += 1) {
    primaryTreatment.push(await observeFreshIndex({
      ...common,
      family: 'primary',
      condition: 'treatment',
      runId: `primary-treatment-${index}`,
      querySet: inputs.primary.querySet,
      paths: primaryPaths,
      patch: transform.accepted.patch,
      allowedPaths: [...RC2_DELIVERY_POLICY_TRANSFORM_PATHS],
      oracle: null,
      rc1Inputs: null,
    }));
  }
  const transferControl = await observeFreshIndex({
    ...common,
    family: 'rc1_transfer',
    condition: 'control',
    runId: 'rc1-transfer-control-1',
    querySet: inputs.rc1.querySet,
    paths: rc1Paths,
    patch: null,
    allowedPaths: [],
    oracle: inputs.rc1.oracle,
    rc1Inputs: inputs.rc1,
  });
  const transferTreatment = await observeFreshIndex({
    ...common,
    family: 'rc1_transfer',
    condition: 'treatment',
    runId: 'rc1-transfer-treatment-1',
    querySet: inputs.rc1.querySet,
    paths: rc1Paths,
    patch: rc1Patch,
    allowedPaths: [...rc1TransformArtifact.scope.allowed_paths],
    oracle: inputs.rc1.oracle,
    rc1Inputs: inputs.rc1,
  });
  const runs = {
    primary: { control: primaryControl, treatment: primaryTreatment },
    rc1_transfer: { control: [transferControl], treatment: [transferTreatment] },
  };
  const compiled = compileAllConditions({ runs, inputs, costMeasurements });

  const identityAfter = await captureExecutionIdentity(root);
  if (!isDeepStrictEqual(identityBefore.snapshot, identityAfter.snapshot)
    || identityBefore.payloads.size !== identityAfter.payloads.size
    || [...identityBefore.payloads].some(([relativePath, bytes]) => (
      !identityAfter.payloads.get(relativePath)?.equals(bytes)
    ))) {
    throw new TypeError('RC2 execution identity drifted during campaign');
  }
  const identity = {
    schema: 'lattice.rc2.execution_identity.v2',
    sources: identityBefore.snapshot.sources,
    codegraph_identity: identityBefore.snapshot.codegraph_identity,
    codegraph_identity_digest: digestArtifact(identityBefore.snapshot.codegraph_identity),
    before_digest: identityBefore.digest,
    after_digest: identityAfter.digest,
  };

  const preliminaryPayloads = mergePayloads(
    inputPayloads(inputs),
    identityBefore.payloads,
    predecessors,
    transformPayloads(transform),
    runPayloads(runs),
    new Map([['identity.json', jsonBytes(identity)]]),
  );
  const causalPredecessors = predecessorDescriptors(preliminaryPayloads);
  const { newPlanVersion, planDiff } = buildVersionBarrier({
    inputs,
    compiled,
    predecessors: causalPredecessors,
    predecessorPlan,
  });
  const comparison = buildComparison({
    baseSha,
    identity,
    transform,
    compiled,
    newPlanVersion,
    planDiff,
  });
  const hypothesisEvaluation = evaluateHypothesis(comparison, compiled, transform);
  if (!hypothesisEvaluation.supported) {
    throw new TypeError(
      `RC2 hypothesis is not supported: ${hypothesisEvaluation.failed_conditions.join(', ')}`,
    );
  }
  const cost = buildCost(costMeasurements, transform);
  const executionEvidence = buildExecutionEvidence({
    baseSha,
    identity,
    transform,
    runs,
    compiled,
    newPlanVersion,
    planDiff,
    comparison,
    hypothesis: hypothesisEvaluation,
    cost,
  });
  return {
    schema: 'lattice.rc2.campaign_result.v2',
    artifact_version: ARTIFACT_VERSION,
    base_sha: baseSha,
    fixed_inputs: inputs,
    identity,
    identity_payloads: identityBefore.payloads,
    predecessor_payloads: predecessors,
    transform,
    runs,
    compiled,
    new_plan_version: newPlanVersion,
    plan_diff: planDiff,
    comparison,
    hypothesis_evaluation: hypothesisEvaluation,
    cost,
    execution_evidence: executionEvidence,
  };
}

function artifactFiles(result) {
  const files = mergePayloads(
    inputPayloads(result.fixed_inputs),
    result.identity_payloads,
    result.predecessor_payloads,
    transformPayloads(result.transform),
    runPayloads(result.runs),
    compiledPayloads(result.compiled),
    new Map([
      ['identity.json', jsonBytes(result.identity)],
      ['new-plan-version.json', jsonBytes(result.new_plan_version)],
      ['plan-diff.json', jsonBytes(result.plan_diff)],
      ['comparison.json', jsonBytes(result.comparison)],
      ['hypothesis-evaluation.json', jsonBytes(result.hypothesis_evaluation)],
      ['cost.json', jsonBytes(result.cost)],
      ['execution-evidence.json', jsonBytes(result.execution_evidence)],
    ]),
  );
  if (!isDeepStrictEqual([...files.keys()].sort(), [...RC2_ARTIFACT_PATHS])) {
    throw new TypeError('RC2 artifact payload set differs from the exact contract');
  }
  return files;
}

function artifactMediaType(relativePath) {
  if (relativePath.endsWith('.json')) return 'application/json';
  if (relativePath.endsWith('.mjs')) return 'application/javascript';
  if (relativePath.endsWith('.patch')) return 'text/x-diff';
  if (relativePath.endsWith('.md')) return 'text/markdown';
  return 'application/octet-stream';
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableFile(target, bytes) {
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncArtifactDirectories(root, relativePaths) {
  const directories = new Set([root]);
  for (const relativePath of relativePaths) {
    let current = path.dirname(path.join(root, relativePath));
    while (current.startsWith(root)) {
      directories.add(current);
      if (current === root) break;
      current = path.dirname(current);
    }
  }
  const ordered = [...directories].sort((left, right) => right.length - left.length);
  for (const directory of ordered) await syncDirectory(directory);
}

/** verified exact artifact setを既存rootへ上書きせずatomicに発行する。 */
export async function writeRc2CampaignArtifacts(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'result'])
    || typeof options.repoRoot !== 'string'
    || options.repoRoot.length === 0
    || options.result?.schema !== 'lattice.rc2.campaign_result.v2'
    || options.result?.artifact_version !== ARTIFACT_VERSION) {
    throw new TypeError('writeRc2CampaignArtifacts options are invalid');
  }
  const root = await realpath(options.repoRoot);
  const artifactRoot = path.join(root, ARTIFACT_ROOTS.v2);
  try {
    await lstat(artifactRoot);
    throw new Error('RC2 artifact root already exists; immutable evidence is not overwritten');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const files = artifactFiles(options.result);
  const manifest = {
    schema: 'lattice.rc2.artifact_manifest.v2',
    base_sha: options.result.base_sha,
    result_digest: digestArtifact(options.result.hypothesis_evaluation),
    files: [...files].map(([relativePath, bytes]) => ({
      path: relativePath,
      media_type: artifactMediaType(relativePath),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
  const payloads = [...files].map(([relativePath, bytes]) => ({ path: relativePath, bytes }));
  const verification = verifyRc2CampaignArtifactSet({ manifest, payloads });
  if (!verification.valid) {
    throw new TypeError(
      `RC2 artifact set is invalid: ${verification.failed_conditions.join(', ')}`,
    );
  }
  const parent = path.dirname(artifactRoot);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(parent, '.v2-write-'));
  try {
    for (const [relativePath, bytes] of files) {
      await writeDurableFile(path.join(temporaryRoot, relativePath), bytes);
    }
    await writeDurableFile(path.join(temporaryRoot, 'artifact-manifest.json'), jsonBytes(manifest));
    await syncArtifactDirectories(temporaryRoot, [
      ...RC2_ARTIFACT_PATHS,
      'artifact-manifest.json',
    ]);
    await rename(temporaryRoot, artifactRoot);
    await syncDirectory(parent);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

function artifactPathsForVersion(artifactVersion) {
  if (artifactVersion === 'v1') return RC2_V1_ARTIFACT_PATHS;
  if (artifactVersion === 'v2') return RC2_ARTIFACT_PATHS;
  return null;
}

function invalidDiskReceipt(condition) {
  return {
    schema: 'lattice.rc2.artifact_set_verification.v1',
    valid: false,
    checks: [{ id: condition, passed: false }],
    failed_conditions: [condition],
  };
}

/** immutable rootを再読し、in-memory resultなしでpure verifierへ渡す。 */
export async function verifyRc2CampaignArtifactsOnDisk(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'artifactVersion'])
    || typeof options.repoRoot !== 'string'
    || options.repoRoot.length === 0
    || artifactPathsForVersion(options.artifactVersion) === null) {
    throw new TypeError('verifyRc2CampaignArtifactsOnDisk options are invalid');
  }
  const artifactRoot = path.join(options.repoRoot, ARTIFACT_ROOTS[options.artifactVersion]);
  const artifactPaths = artifactPathsForVersion(options.artifactVersion);
  let manifestBytes;
  let manifest;
  try {
    manifestBytes = await readFile(path.join(artifactRoot, 'artifact-manifest.json'));
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    return invalidDiskReceipt('manifest_canonical');
  }
  if (!jsonBytes(manifest).equals(manifestBytes)) {
    return invalidDiskReceipt('manifest_canonical');
  }
  let payloads;
  try {
    payloads = await Promise.all(artifactPaths.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(artifactRoot, relativePath)),
    })));
  } catch {
    return invalidDiskReceipt('exact_artifact_set');
  }
  return verifyRc2CampaignArtifactSet({ manifest, payloads });
}
