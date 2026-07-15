import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';

import {
  canonicalizeArtifact,
  digestArtifact,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import {
  collectCodegraphEvidence,
  portableCodegraphOutcome,
} from './codegraph-adapter.mjs';
import { compileTreatmentArtifacts } from './treatment-compiler.mjs';

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const INDEX_DIRECTORY = '.codegraph-rc1-treatment';
const PORTABLE_PROJECTION = 'lattice.codegraph_portable_outcome.v1';
const VERIFIER = Object.freeze({
  id: 'dispatch-characterization',
  command: 'node',
  args: ['--test', '--test-reporter=dot', 'test/research-dispatch-record.test.mjs'],
});

function fail(reason) {
  throw new TypeError(`treatment recompile契約違反: ${reason}`);
}

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, { cwd, env, input, allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
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

function codegraphEnvironment() {
  const env = {
    ...process.env,
    CODEGRAPH_DIR: INDEX_DIRECTORY,
    CODEGRAPH_NO_DAEMON: '1',
    CODEGRAPH_NO_WATCH: '1',
    CODEGRAPH_NO_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
    NO_COLOR: '1',
  };
  delete env.FORCE_COLOR;
  return env;
}

function executeCodegraph({ args, cwd }) {
  return new Promise((resolve) => {
    const child = spawn('codegraph', args, {
      cwd,
      env: codegraphEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function artifactMeta(value) {
  return exactRecord(value, ['digest', 'canonical_bytes'])
    && typeof value.digest === 'string'
    && SHA256.test(value.digest)
    && Number.isSafeInteger(value.canonical_bytes)
    && value.canonical_bytes > 0;
}

function artifactSet(value) {
  return exactRecord(value, ['boundary_manifest', 'boundary_verdict', 'plan_graph'])
    && Object.values(value).every(artifactMeta);
}

function assertPortableControlEvidence(evidence) {
  if (!exactRecord(evidence, [
    'schema',
    'observed_at',
    'head',
    'executor_head',
    'graph_digest_projection',
    'input_digests',
    'codegraph',
    'artifacts',
    'observed_facts',
    'presentation_note',
  ])
    || evidence.schema !== 'lattice.rc1.control_compilation_evidence.v2'
    || evidence.graph_digest_projection !== PORTABLE_PROJECTION) {
    fail('portable control evidence v2だけがrecompileへ進める');
  }
  if (typeof evidence.head !== 'string'
    || !SHA1.test(evidence.head)
    || typeof evidence.executor_head !== 'string'
    || !SHA1.test(evidence.executor_head)
    || !exactRecord(evidence.input_digests, [
      'plan_input',
      'query_set',
      'manual_normal',
      'manual_shared_state_negative',
      'code_snapshot',
    ])
    || Object.values(evidence.input_digests).some((digest) => (
      typeof digest !== 'string' || !SHA256.test(digest)
    ))
    || !exactRecord(evidence.artifacts, ['control', 'shared_state_negative'])
    || !artifactSet(evidence.artifacts.control)
    || !artifactSet(evidence.artifacts.shared_state_negative)
    || !exactRecord(evidence.codegraph, [
      'version',
      'file_count',
      'node_count',
      'edge_count',
      'pending_changes',
      'pending_refs',
      'worktree_mismatch',
      'fresh_index_repetitions',
      'raw_outcomes_digests',
      'raw_outcomes_equal',
      'portable_outcomes_digest',
      'portable_outcomes_equal',
      'outcomes',
    ])
    || evidence.codegraph.fresh_index_repetitions !== 2
    || !Array.isArray(evidence.codegraph.raw_outcomes_digests)
    || evidence.codegraph.raw_outcomes_digests.length !== 2
    || evidence.codegraph.raw_outcomes_digests.some((digest) => (
      typeof digest !== 'string' || !SHA256.test(digest)
    ))
    || new Set(evidence.codegraph.raw_outcomes_digests).size !== 2
    || evidence.codegraph.raw_outcomes_equal !== false
    || typeof evidence.codegraph.portable_outcomes_digest !== 'string'
    || !SHA256.test(evidence.codegraph.portable_outcomes_digest)
    || evidence.codegraph.portable_outcomes_equal !== true
    || !Array.isArray(evidence.codegraph.outcomes)
    || evidence.codegraph.outcomes.length === 0) {
    fail('portable control evidence v2のdigest metadataが不正');
  }
}

function assertTransformExecutionEvidence(evidence, {
  transformArtifact,
  transformPatch,
  controlCompilationEvidence,
  querySetDigest,
  normal,
}) {
  if (!exactRecord(evidence, [
    'schema',
    'observed_at',
    'executor_head',
    'experiment_base_sha',
    'control_compilation_evidence_schema',
    'graph_digest_projection',
    'input_digests',
    'runs',
    'artifacts',
    'observed_facts',
    'presentation_note',
  ])
    || evidence.schema !== 'lattice.rc1.seam_transform_execution_evidence.v2'
    || typeof evidence.executor_head !== 'string'
    || !SHA1.test(evidence.executor_head)
    || evidence.experiment_base_sha !== transformArtifact.source.base_sha
    || evidence.control_compilation_evidence_schema !== controlCompilationEvidence.schema
    || evidence.graph_digest_projection !== PORTABLE_PROJECTION
    || !exactRecord(evidence.input_digests, [
      'boundary_manifest',
      'boundary_verdict',
      'control_plan',
      'query_set',
      'control_compilation_evidence',
    ])
    || !exactRecord(evidence.runs, [
      'accepted_primary',
      'accepted_repeat',
      'scope_rejection',
      'behavior_rejection',
    ])
    || !exactRecord(evidence.artifacts, [
      'transform',
      'scope_rejection',
      'behavior_rejection',
      'patch',
    ])
    || !artifactMeta(evidence.artifacts.transform)
    || !artifactMeta(evidence.artifacts.scope_rejection)
    || !artifactMeta(evidence.artifacts.behavior_rejection)
    || !exactRecord(evidence.artifacts.patch, ['digest', 'bytes'])) {
    fail('transform execution evidence v2が不正');
  }
  const transformArtifactDigest = digestArtifact(transformArtifact);
  const transformCanonicalBytes = Buffer.byteLength(canonicalizeArtifact(transformArtifact));
  if (evidence.input_digests.boundary_manifest !== normal.boundary_manifest
    || evidence.input_digests.boundary_verdict !== normal.boundary_verdict
    || evidence.input_digests.control_plan !== normal.plan_graph
    || evidence.input_digests.query_set !== querySetDigest
    || evidence.input_digests.control_compilation_evidence
      !== digestArtifact(controlCompilationEvidence)
    || evidence.runs.accepted_primary?.artifact_digest !== transformArtifactDigest
    || evidence.runs.accepted_repeat?.artifact_digest !== transformArtifactDigest
    || evidence.artifacts.transform.digest !== transformArtifactDigest
    || evidence.artifacts.transform.canonical_bytes !== transformCanonicalBytes
    || evidence.artifacts.patch.digest !== sha256(transformPatch)
    || evidence.artifacts.patch.bytes !== transformPatch.byteLength
    || evidence.observed_facts?.deterministic_repeat !== true
    || evidence.observed_facts?.same_control_base !== true
    || evidence.observed_facts?.portable_control_chain !== true
    || evidence.observed_facts?.characterization_passed !== true
    || evidence.observed_facts?.git_apply_check !== 'passed'
    || evidence.observed_facts?.source_unchanged !== true
    || evidence.observed_facts?.cleanup !== 'passed') {
    fail('transform execution evidenceのpredecessor chainが一致しない');
  }
  return digestArtifact(evidence);
}

function bundleDigests(bundle) {
  if (!exactRecord(bundle, ['boundary_manifest', 'boundary_verdict', 'plan_graph'])) {
    fail('control artifact setが不正');
  }
  return {
    boundary_manifest: digestArtifact(bundle.boundary_manifest),
    boundary_verdict: digestArtifact(bundle.boundary_verdict),
    plan_graph: digestArtifact(bundle.plan_graph),
  };
}

function assertAdmission({
  planInput,
  manualNormal,
  manualNegative,
  querySet,
  transformArtifact,
  transformExecutionEvidence,
  transformPatch,
  controlCompilationEvidence,
  control,
}) {
  for (const value of [
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    transformExecutionEvidence,
    controlCompilationEvidence,
    control,
  ]) {
    canonicalizeArtifact(value);
  }
  if (!validateTransformArtifact(transformArtifact) || transformArtifact.status !== 'accepted') {
    fail('accepted transform artifactが必要');
  }
  if (!Buffer.isBuffer(transformPatch)
    || sha256(transformPatch) !== transformArtifact.patch.digest
    || transformPatch.byteLength !== transformArtifact.patch.bytes) {
    fail('transform patch digestまたはpatch bytesがartifactと一致しない');
  }
  assertPortableControlEvidence(controlCompilationEvidence);
  if (!exactRecord(control, ['normal', 'negative'])) fail('control artifact setが不正');
  const normal = bundleDigests(control.normal);
  const negative = bundleDigests(control.negative);
  const evidence = controlCompilationEvidence;
  if (evidence.head !== transformArtifact.source.base_sha
    || evidence.input_digests.plan_input !== digestArtifact(planInput)
    || evidence.input_digests.query_set !== digestArtifact(querySet)
    || evidence.input_digests.manual_normal !== digestArtifact(manualNormal)
    || evidence.input_digests.manual_shared_state_negative !== digestArtifact(manualNegative)
    || evidence.input_digests.code_snapshot !== transformArtifact.source.code_snapshot_digest
    || evidence.artifacts.control.boundary_manifest.digest !== normal.boundary_manifest
    || evidence.artifacts.control.boundary_verdict.digest !== normal.boundary_verdict
    || evidence.artifacts.control.plan_graph.digest !== normal.plan_graph
    || evidence.artifacts.shared_state_negative.boundary_manifest.digest
      !== negative.boundary_manifest
    || evidence.artifacts.shared_state_negative.boundary_verdict.digest
      !== negative.boundary_verdict
    || evidence.artifacts.shared_state_negative.plan_graph.digest !== negative.plan_graph
    || transformArtifact.source.boundary_manifest_digest !== normal.boundary_manifest
    || transformArtifact.source.boundary_verdict_digest !== normal.boundary_verdict
    || transformArtifact.source.control_plan_digest !== normal.plan_graph
    || transformArtifact.source.query_set_digest !== digestArtifact(querySet)) {
    fail('query setまたはcontrol artifact digest chainがportable predecessorと一致しない');
  }
  if (evidence.codegraph.outcomes.length !== querySet.queries.length
    || evidence.codegraph.outcomes.some((outcome, index) => (
      outcome.id !== querySet.queries[index]?.id
      || outcome.operation !== querySet.queries[index]?.operation
      || typeof outcome.result_digest !== 'string'
      || !SHA256.test(outcome.result_digest)
    ))
    || JSON.stringify(evidence.codegraph.outcomes.map((outcome) => ({
      id: outcome.id,
      operation: outcome.operation,
      status: outcome.outcome,
      result_digest: outcome.result_digest,
    }))) !== JSON.stringify(control.normal.boundary_manifest.graph_evidence)) {
    fail('portable control evidenceがquery set／control graph evidenceと一致しない');
  }
  const transformExecutionEvidenceDigest = assertTransformExecutionEvidence(
    transformExecutionEvidence,
    {
      transformArtifact,
      transformPatch,
      controlCompilationEvidence,
      querySetDigest: digestArtifact(querySet),
      normal,
    },
  );
  const receipt = transformArtifact.verification.receipts[0];
  if (transformArtifact.verification.receipts.length !== 1
    || receipt.id !== VERIFIER.id
    || receipt.command !== VERIFIER.command
    || JSON.stringify(receipt.args) !== JSON.stringify(VERIFIER.args)) {
    fail('accepted transform verifierがRC1 fixed verifierと一致しない');
  }
  return {
    baseSha: transformArtifact.source.base_sha,
    transformArtifactDigest: digestArtifact(transformArtifact),
    transformExecutionEvidenceDigest,
    controlCompilationEvidenceDigest: digestArtifact(controlCompilationEvidence),
  };
}

function statusPaths(status) {
  const fields = status.toString('utf8').split('\0');
  const paths = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (code[0] === 'R' || code[0] === 'C') paths.push(fields[++index]);
  }
  return [...new Set(paths)].sort();
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function assertPatchScope(worktreePath, expectedPaths, { allowSensor = false } = {}) {
  const status = await run('git', [
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ], { cwd: worktreePath });
  const actual = statusPaths(status.stdout);
  const sensorPrefix = `${INDEX_DIRECTORY}/`;
  const sensorPaths = actual.filter((entry) => entry.startsWith(sensorPrefix));
  const sourcePaths = actual.filter((entry) => !entry.startsWith(sensorPrefix));
  if (!sameArray(sourcePaths, expectedPaths) || (!allowSensor && sensorPaths.length > 0)) {
    fail(`isolated treatment changed unexpected paths: ${actual.join(',')}`);
  }
}

async function observeSnapshot(worktreePath, transformArtifact) {
  const files = await Promise.all(transformArtifact.output.files.map(async (expected) => {
    const content = await readFile(path.join(worktreePath, expected.path));
    const contentDigest = sha256(content);
    if (contentDigest !== expected.content_digest) {
      fail(`post-transform file digest drift: ${expected.path}`);
    }
    return { path: expected.path, content_digest: contentDigest };
  }));
  const snapshotDigest = digestArtifact({ files });
  if (snapshotDigest !== transformArtifact.output.snapshot_digest) {
    fail('post-transform snapshot digestがaccepted artifactと一致しない');
  }
  return snapshotDigest;
}

function verifierEnvironment() {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  return env;
}

async function runVerifier(worktreePath) {
  const result = await run(VERIFIER.command, VERIFIER.args, {
    cwd: worktreePath,
    env: verifierEnvironment(),
  });
  return {
    id: VERIFIER.id,
    command: VERIFIER.command,
    args: [...VERIFIER.args],
    outcome: 'passed',
    exit_code: result.code,
    stdout_digest: sha256(result.stdout),
    stderr_digest: sha256(result.stderr),
  };
}

function portableStatusSummary(outcome) {
  const portable = portableCodegraphOutcome(outcome);
  const status = portable?.data;
  if (!status || typeof status !== 'object') fail('portable Codegraph statusがない');
  return {
    version: status.version,
    file_count: status.fileCount,
    node_count: status.nodeCount,
    edge_count: status.edgeCount,
    pending_changes: status.pendingChanges,
    pending_refs: status.index?.pendingRefs,
    worktree_mismatch: status.worktreeMismatch,
  };
}

async function assertSourceUnchanged(repoRoot, expected) {
  const [head, status, ignoredStatus, worktrees] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    run('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot }),
    run('git', [
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
    ], { cwd: repoRoot }),
    run('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot }),
  ]);
  if (head.stdout.toString('utf8').trim() !== expected.head
    || !status.stdout.equals(expected.status)
    || !ignoredStatus.stdout.equals(expected.ignoredStatus)
    || !worktrees.stdout.equals(expected.worktrees)) {
    throw new Error('source repository changed during treatment recompile');
  }
}

/**
 * accepted seam patchをdisposable worktreeへ適用し、fresh Codegraph indexからRC1 plan v2をcompileする。
 * @param {object} options
 * @returns {Promise<{compiled: object, execution: object}>}
 */
export async function runRc1TreatmentRecompile({
  repoRoot,
  planInput,
  manualNormal,
  manualNegative,
  querySet,
  transformArtifact,
  transformExecutionEvidence,
  transformPatch,
  controlCompilationEvidence,
  control,
  execute = executeCodegraph,
} = {}) {
  const admission = assertAdmission({
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    transformExecutionEvidence,
    transformPatch,
    controlCompilationEvidence,
    control,
  });
  if (typeof repoRoot !== 'string' || repoRoot.length === 0 || typeof execute !== 'function') {
    throw new TypeError('invalid treatment recompile arguments');
  }

  const [sourceHead, sourceStatus, sourceIgnoredStatus, sourceWorktrees] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    run('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot }),
    run('git', [
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
    ], { cwd: repoRoot }),
    run('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot }),
  ]);
  if (sourceStatus.stdout.length > 0) fail('source repository must be clean');
  const sourceInvariant = {
    head: sourceHead.stdout.toString('utf8').trim(),
    status: sourceStatus.stdout,
    ignoredStatus: sourceIgnoredStatus.stdout,
    worktrees: sourceWorktrees.stdout,
  };
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-treatment-recompile-'));
  const worktreePath = path.join(tempRoot, 'worktree');
  const totalStarted = performance.now();
  let added = false;
  let primaryError;
  let compiled;
  let verifierReceipt;
  let rawOutcomesDigest;
  let portableOutcomesDigest;
  let codegraphSummary;
  let applyVerifyMs;
  let indexMs;
  let compileMs;
  let sensorCleanup = 'unresolved';
  let worktreeCleanup = 'unresolved';
  try {
    await run('git', ['worktree', 'add', '--detach', worktreePath, admission.baseSha], {
      cwd: repoRoot,
    });
    added = true;
    const applyStarted = performance.now();
    await run('git', ['apply', '--check', '--whitespace=error-all', '-'], {
      cwd: worktreePath,
      input: transformPatch,
    });
    await run('git', ['apply', '--whitespace=error-all', '-'], {
      cwd: worktreePath,
      input: transformPatch,
    });
    await assertPatchScope(worktreePath, transformArtifact.scope.changed_paths);
    const codeSnapshotDigest = await observeSnapshot(worktreePath, transformArtifact);
    verifierReceipt = await runVerifier(worktreePath);
    await assertPatchScope(worktreePath, transformArtifact.scope.changed_paths);
    applyVerifyMs = Number((performance.now() - applyStarted).toFixed(3));

    const indexStarted = performance.now();
    const initialized = await execute({ args: ['init', '.'], cwd: worktreePath });
    if (initialized?.code !== 0) {
      throw new Error(`Codegraph init failed (${initialized?.code ?? 'unknown'}): ${initialized?.stderr ?? ''}`);
    }
    const codegraphEvidence = await collectCodegraphEvidence({
      cwd: worktreePath,
      querySet,
      execute,
    });
    indexMs = Number((performance.now() - indexStarted).toFixed(3));
    rawOutcomesDigest = digestArtifact(codegraphEvidence.outcomes);
    portableOutcomesDigest = digestArtifact(
      codegraphEvidence.outcomes.map(portableCodegraphOutcome),
    );
    codegraphSummary = portableStatusSummary(codegraphEvidence.outcomes[0]);
    await assertPatchScope(worktreePath, transformArtifact.scope.changed_paths, {
      allowSensor: true,
    });
    await observeSnapshot(worktreePath, transformArtifact);

    const compileStarted = performance.now();
    compiled = compileTreatmentArtifacts({
      planInput,
      manualNormal,
      manualNegative,
      querySet,
      codegraphEvidence,
      codeSnapshotDigest,
      transformArtifact,
      control,
    });
    compileMs = Number((performance.now() - compileStarted).toFixed(3));

    await rm(path.join(worktreePath, INDEX_DIRECTORY), { recursive: true, force: true });
    try {
      await access(path.join(worktreePath, INDEX_DIRECTORY));
      throw new Error('Codegraph sensor state cleanup failed');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    sensorCleanup = 'passed';
    await assertPatchScope(worktreePath, transformArtifact.scope.changed_paths);
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  try {
    if (added) {
      await run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    }
    await rm(tempRoot, { recursive: true, force: true });
    worktreeCleanup = 'passed';
  } catch (error) {
    cleanupError = new Error(`treatment worktree cleanup failed: ${error.message}`);
  }
  let sourceError;
  try {
    await assertSourceUnchanged(repoRoot, sourceInvariant);
  } catch (error) {
    sourceError = error;
  }
  const errors = [primaryError, cleanupError, sourceError].filter(Boolean);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'treatment recompile failed and cleanup or source invariant also failed');

  return {
    compiled,
    execution: {
      schema: 'lattice.rc1.treatment_recompile_run.v1',
      base_sha: admission.baseSha,
      transform_artifact_digest: admission.transformArtifactDigest,
      transform_execution_evidence_digest: admission.transformExecutionEvidenceDigest,
      control_compilation_evidence_digest: admission.controlCompilationEvidenceDigest,
      patch_digest: transformArtifact.patch.digest,
      query_set_digest: digestArtifact(querySet),
      code_snapshot_digest: transformArtifact.output.snapshot_digest,
      graph_digest_projection: PORTABLE_PROJECTION,
      raw_outcomes_digest: rawOutcomesDigest,
      portable_outcomes_digest: portableOutcomesDigest,
      codegraph: codegraphSummary,
      verifier: verifierReceipt,
      timings_ms: {
        apply_and_verify: applyVerifyMs,
        fresh_index_and_query: indexMs,
        compile: compileMs,
        total: Number((performance.now() - totalStarted).toFixed(3)),
      },
      sensor_directory: INDEX_DIRECTORY,
      sensor_cleanup: sensorCleanup,
      worktree_cleanup: worktreeCleanup,
      source_unchanged: true,
    },
  };
}
