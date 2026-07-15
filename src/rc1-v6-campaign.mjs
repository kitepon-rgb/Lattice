import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { RC1_BOUNDARY_COMPILER_CONTRACT } from './boundary-compiler.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';
import {
  createRc1V6OracleRuntimeIdentity,
  runRc1V6BlackBoxOracle,
} from './rc1-black-box-oracle.mjs';
import {
  buildRc1V6PlanDiff,
  compileRc1V6Comparison,
  evaluateRc1V6Hypothesis,
  RC1_V6_ARTIFACT_PATHS,
  RC1_V6_PHASE_DECISION_REF,
  RC1_V6_REJECTED_PLAN_REF,
  rc1V6ArtifactMediaType,
  verifyRc1V6CampaignArtifactSet,
} from './rc1-v6-artifact-set.mjs';
import { compileRc1V6BehaviorEvidence } from './rc1-v6-behavior-evidence.mjs';
import { createRc1V6EvidenceBundleDescriptor } from './rc1-v6-causal-binding.mjs';
import { runRc1V5Campaign } from './rc1-v5-campaign.mjs';
import {
  bindRc1V6EvidenceBundle,
  captureRc1V6CodegraphExecutable,
  compileRc1V6BoundaryCondition,
  createRc1V6ConditionRun,
  sourceSnapshotFromRc1BehaviorSurface,
  sourceSnapshotFromRc1TransformOutput,
} from './rc1-v6-measurement.mjs';
import { RC1_V5_TRANSFORM_PATHS } from './rc1-v5-transform.mjs';

const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v6';
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const INPUT_KEYS = Object.freeze([
  'planInput',
  'candidateSpec',
  'normalManualEvidence',
  'negativeManualEvidence',
  'querySet',
  'oracle',
]);

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function roundedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 1_000) / 1_000;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function run(command, args, { cwd, input } = {}) {
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
      if (code === 0 && signal === null) resolve(result);
      else reject(Object.assign(
        new Error(`${command} failed (${signal ?? code}): ${result.stderr.toString('utf8').trim()}`),
        result,
      ));
    });
    child.stdin.end(input);
  });
}

function assertInputs(inputs) {
  if (!exactRecord(inputs, INPUT_KEYS)) {
    throw new TypeError('RC1 v6 campaign inputs must have the fixed exact shape');
  }
  for (const value of Object.values(inputs)) canonicalizeArtifact(value);
}

function legacySnapshotDigest(snapshot) {
  return digestArtifact({
    schema: 'lattice.rc1.fixed_surface_snapshot.v5',
    files: snapshot.files.map((file) => ({
      path: file.path,
      state: file.state === 'file' ? 'file' : 'missing',
      content_digest: file.content_digest,
    })),
  });
}

function compileCondition({ inputs, bundles, runs, expected, condition }) {
  const outputs = bundles.map((bundle, index) => {
    const common = {
      planInput: inputs.planInput,
      candidateSpec: inputs.candidateSpec,
      querySet: inputs.querySet,
      run: runs[index],
      bundle,
      expected,
    };
    return {
      normal: compileRc1V6BoundaryCondition({
        ...common,
        manualEvidence: inputs.normalManualEvidence,
        planVersion: `rc1-v6-${condition}`,
      }),
      negative: compileRc1V6BoundaryCondition({
        ...common,
        manualEvidence: inputs.negativeManualEvidence,
        planVersion: `rc1-v6-${condition}-negative`,
      }),
    };
  });
  if (outputs.length !== 2 || digestArtifact(outputs[0]) !== digestArtifact(outputs[1])) {
    throw new TypeError(`RC1 v6 ${condition} compilation is not reproducible`);
  }
  return outputs[0];
}

function updatedTransformArtifact(v5Artifact, control, controlSnapshot, querySet) {
  const artifact = structuredClone(v5Artifact);
  artifact.source = {
    base_sha: v5Artifact.source.base_sha,
    boundary_manifest_digest: control.normal.boundary_manifest_digest,
    boundary_verdict_digest: control.normal.boundary_verdict_digest,
    control_plan_digest: control.normal.plan_graph_digest,
    query_set_digest: digestArtifact(querySet),
    code_snapshot_digest: digestArtifact(controlSnapshot),
  };
  if (!validateTransformArtifact(artifact) || artifact.status !== 'accepted') {
    throw new TypeError('RC1 v6 updated transform artifact is invalid');
  }
  return artifact;
}

async function applyPatch(worktreePath, patch) {
  await run('git', ['apply', '--check', '--binary', '-'], { cwd: worktreePath, input: patch });
  await run('git', ['apply', '--binary', '-'], { cwd: worktreePath, input: patch });
}

async function bindV6Behavior({
  repoRoot,
  baseSha,
  oracle,
  runtimeIdentity,
  artifact,
  patch,
}) {
  const surfacePaths = [...artifact.scope.allowed_paths];
  const preReceipt = await runRc1V6BlackBoxOracle({
    repoRoot,
    oracle,
    role: 'pre_transform',
    baseSha,
    surfacePaths,
    runtimeIdentity,
  });
  let postReceipt;
  const isolated = await runIsolatedTransform({
    repoRoot,
    baseRef: baseSha,
    allowedPaths: surfacePaths,
    transform: async ({ worktreePath }) => {
      await applyPatch(worktreePath, patch);
      postReceipt = await runRc1V6BlackBoxOracle({
        repoRoot: worktreePath,
        oracle,
        role: 'post_transform',
        baseSha,
        surfacePaths,
        runtimeIdentity,
      });
    },
    verifyCommands: [],
  });
  if (!Buffer.isBuffer(isolated.patch)
    || !isolated.patch.equals(patch)
    || isolated.sourceInvariant?.outcome !== 'passed'
    || postReceipt?.outcome !== 'passed') {
    throw new TypeError('RC1 v6 behavior observation did not preserve accepted patch identity');
  }
  const patchDigest = sha256(patch);
  const envelope = compileRc1V6BehaviorEvidence({
    oracle,
    runtimeIdentity,
    preReceipt,
    postReceipt,
    transformArtifact: artifact,
    patchDigest,
  });
  return {
    pre_receipt: preReceipt,
    post_receipt: postReceipt,
    envelope,
    transform_artifact: artifact,
    patch_digest: patchDigest,
    source_invariant: isolated.sourceInvariant,
  };
}

function v6Transform(v5Transform, artifact, behaviorEvidence, runtimeIdentity) {
  const artifactDigest = digestArtifact(artifact);
  const preimage = {
    schema: 'lattice.rc1.seam_transform_receipt.v6',
    status: 'accepted',
    transform_artifact_digest: artifactDigest,
    behavior_envelope_digest: behaviorEvidence.envelope.envelope_digest,
    fixed_inputs_digest: digestArtifact(artifact.source),
    runtime_identity_digest: digestArtifact(runtimeIdentity),
    source_invariant: behaviorEvidence.source_invariant,
  };
  const receipt = { ...preimage, receipt_digest: digestArtifact(preimage) };
  return {
    artifact,
    artifact_digest: artifactDigest,
    receipt,
    receipt_digest: receipt.receipt_digest,
    patch: Buffer.from(v5Transform.patch),
    behavior_evidence: {
      pre_receipt: behaviorEvidence.pre_receipt,
      post_receipt: behaviorEvidence.post_receipt,
      envelope: behaviorEvidence.envelope,
      transform_artifact: artifact,
      patch_digest: behaviorEvidence.patch_digest,
    },
  };
}

function conditionRunRecords(v5Runs, runs) {
  return v5Runs.map((record, index) => ({
    run: runs[index],
    patch_digest: record.patch_digest,
    index_elapsed_ms: record.index_elapsed_ms,
    query_elapsed_ms: record.query_elapsed_ms,
    source_invariant: record.source_invariant,
    source_invariant_digest: record.source_invariant_digest,
  }));
}

/** v5のfresh機構を観測器として再利用し、全結果をv6 causal chainへ再compileする。 */
export async function runRc1V6Campaign(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'baseRef', 'inputs'])) {
    throw new TypeError('RC1 v6 campaign options must have the fixed exact shape');
  }
  const { repoRoot, baseRef, inputs } = options;
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0) {
    throw new TypeError('RC1 v6 campaign repoRoot and baseRef are required');
  }
  assertInputs(inputs);
  const fixedInputs = structuredClone(inputs);
  const baseSha = (await run('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: repoRoot }))
    .stdout.toString('utf8').trim();
  if (!GIT_SHA1.test(baseSha)) throw new TypeError('RC1 v6 campaign base SHA is invalid');
  const startedAt = performance.now();
  const [codegraphCapture, compilerSourceBytes, oracleExecutorBytes] = await Promise.all([
    captureRc1V6CodegraphExecutable(),
    readFile(new URL('./boundary-compiler.mjs', import.meta.url)),
    readFile(new URL('./rc1-black-box-oracle.mjs', import.meta.url)),
  ]);
  const codegraphIdentity = codegraphCapture.identity;
  const runtimeIdentity = await createRc1V6OracleRuntimeIdentity();
  if (runtimeIdentity.executor_source_digest !== sha256(oracleExecutorBytes)) {
    throw new TypeError('RC1 v6 oracle runtime identityが保存executor bytesと一致しない');
  }
  const v5 = await runRc1V5Campaign({ repoRoot, baseRef: baseSha, inputs: fixedInputs });
  const [finalCodegraphCapture, finalCompilerSourceBytes, finalOracleExecutorBytes] =
    await Promise.all([
      captureRc1V6CodegraphExecutable(),
      readFile(new URL('./boundary-compiler.mjs', import.meta.url)),
      readFile(new URL('./rc1-black-box-oracle.mjs', import.meta.url)),
    ]);
  if (!isDeepStrictEqual(codegraphCapture, finalCodegraphCapture)
    || !compilerSourceBytes.equals(finalCompilerSourceBytes)
    || !oracleExecutorBytes.equals(finalOracleExecutorBytes)) {
    throw new TypeError('RC1 v6実行主体のidentityがcampaign中にdriftした');
  }

  const controlSnapshot = sourceSnapshotFromRc1BehaviorSurface(
    v5.transform.behavior_evidence.pre_receipt.surface,
  );
  const treatmentSnapshot = sourceSnapshotFromRc1TransformOutput(v5.transform.artifact);
  const postSnapshot = sourceSnapshotFromRc1BehaviorSurface(
    v5.transform.behavior_evidence.post_receipt.surface,
  );
  if (!isDeepStrictEqual(treatmentSnapshot, postSnapshot)) {
    throw new TypeError('RC1 v6 treatment snapshot does not equal accepted transform output');
  }
  for (const record of v5.condition_runs.control) {
    if (record.code_snapshot_digest !== legacySnapshotDigest(controlSnapshot)) {
      throw new TypeError(`${record.run_id} hidden v5 snapshot does not match typed control preimage`);
    }
  }
  for (const record of v5.condition_runs.treatment) {
    if (record.code_snapshot_digest !== legacySnapshotDigest(treatmentSnapshot)) {
      throw new TypeError(`${record.run_id} hidden v5 snapshot does not match typed treatment preimage`);
    }
  }

  const evidenceBundles = v5.evidence_bundles.map((bundle) => bindRc1V6EvidenceBundle({
    bundle,
    base_sha: baseSha,
    patch_digest: bundle.condition === 'treatment' ? v5.transform.artifact.patch.digest : null,
    snapshot: bundle.condition === 'treatment' ? treatmentSnapshot : controlSnapshot,
    codegraph_identity: codegraphIdentity,
    query_set_digest: digestArtifact(fixedInputs.querySet),
  }));
  const runs = evidenceBundles.map(createRc1V6ConditionRun);
  const controlBundles = evidenceBundles.filter(({ condition }) => condition === 'control');
  const treatmentBundles = evidenceBundles.filter(({ condition }) => condition === 'treatment');
  const controlRuns = runs.filter(({ condition }) => condition === 'control');
  const treatmentRuns = runs.filter(({ condition }) => condition === 'treatment');
  const controlExpected = {
    base_sha: baseSha,
    patch_digest: null,
    snapshot: controlSnapshot,
    codegraph_identity: codegraphIdentity,
    query_set_digest: digestArtifact(fixedInputs.querySet),
  };
  const treatmentExpected = {
    base_sha: baseSha,
    patch_digest: v5.transform.artifact.patch.digest,
    snapshot: treatmentSnapshot,
    codegraph_identity: codegraphIdentity,
    query_set_digest: digestArtifact(fixedInputs.querySet),
  };
  const control = compileCondition({
    inputs: fixedInputs,
    bundles: controlBundles,
    runs: controlRuns,
    expected: controlExpected,
    condition: 'control',
  });
  const treatment = compileCondition({
    inputs: fixedInputs,
    bundles: treatmentBundles,
    runs: treatmentRuns,
    expected: treatmentExpected,
    condition: 'treatment',
  });

  const artifact = updatedTransformArtifact(
    v5.transform.artifact,
    control,
    controlSnapshot,
    fixedInputs.querySet,
  );
  const behaviorEvidence = await bindV6Behavior({
    repoRoot,
    baseSha,
    oracle: fixedInputs.oracle,
    runtimeIdentity,
    artifact,
    patch: v5.transform.patch,
  });
  const transform = v6Transform(v5.transform, artifact, behaviorEvidence, runtimeIdentity);
  const rejectedPlanBytes = await readFile(path.join(repoRoot, RC1_V6_REJECTED_PLAN_REF));
  const phaseDecisionBytes = await readFile(path.join(repoRoot, RC1_V6_PHASE_DECISION_REF));
  const planDiff = buildRc1V6PlanDiff({
    control,
    treatment,
    transform,
    evidenceBundles,
    rejectedPlanBytes,
    phaseDecisionBytes,
  });
  const sourceInvariant = {
    control: v5.condition_runs.control.every(({ source_invariant: receipt }) => (
      receipt.outcome === 'passed'
    )),
    treatment: behaviorEvidence.source_invariant.outcome === 'passed'
      && v5.condition_runs.treatment.every(({ source_invariant: receipt }) => (
        receipt.outcome === 'passed'
      )),
  };
  const compilerSourceDigest = sha256(compilerSourceBytes);
  const comparison = compileRc1V6Comparison({
    baseSha,
    inputs: fixedInputs,
    runtimeIdentity,
    codegraphIdentity,
    compilerSourceDigest,
    control,
    treatment,
    evidenceBundles,
    transform,
    planDiff,
    sourceInvariant,
  });
  const hypothesisEvaluation = evaluateRc1V6Hypothesis(comparison);
  if (!hypothesisEvaluation.supported) {
    throw new TypeError(
      `RC1 v6 hypothesis is not supported: ${hypothesisEvaluation.failed_conditions.join(', ')}`,
    );
  }
  const conditionRuns = {
    control: conditionRunRecords(v5.condition_runs.control, controlRuns),
    treatment: conditionRunRecords(v5.condition_runs.treatment, treatmentRuns),
  };
  const executionEvidence = {
    schema: 'lattice.rc1.corrected_campaign_execution_evidence.v6',
    base_sha: baseSha,
    elapsed_ms: roundedMilliseconds(startedAt),
    compiler_source_digest: compilerSourceDigest,
    codegraph_identity_digest: digestArtifact(codegraphIdentity),
    runtime_identity_digest: digestArtifact(runtimeIdentity),
    run_descriptor_digests: runs.map(({ evidence_bundle_descriptor_digest: digest }) => digest),
    transform_artifact_digest: transform.artifact_digest,
    behavior_envelope_digest: transform.behavior_evidence.envelope.envelope_digest,
    plan_diff_digest: digestArtifact(planDiff),
    comparison_digest: digestArtifact(comparison),
    hypothesis_evaluation_digest: digestArtifact(hypothesisEvaluation),
    source_invariant: sourceInvariant,
  };
  return {
    schema: 'lattice.rc1.corrected_campaign_result.v6',
    base_sha: baseSha,
    inputs: fixedInputs,
    runtime_identity: runtimeIdentity,
    codegraph_identity: codegraphIdentity,
    identity_sources: {
      compiler: compilerSourceBytes,
      oracle_executor: oracleExecutorBytes,
      codegraph_executable: codegraphCapture.executable_bytes,
    },
    evidence_bundles: evidenceBundles,
    runs,
    condition_runs: conditionRuns,
    control,
    treatment,
    transform,
    plan_diff: planDiff,
    comparison,
    hypothesis_evaluation: hypothesisEvaluation,
    execution_evidence: executionEvidence,
  };
}

function artifactFiles(result, rejectedPlanBytes, phaseDecisionBytes) {
  const files = new Map();
  for (const [key, relativePath] of [
    ['planInput', 'inputs/plan-input.json'],
    ['candidateSpec', 'inputs/candidate-spec-v2.json'],
    ['normalManualEvidence', 'inputs/manual-evidence.normal.json'],
    ['negativeManualEvidence', 'inputs/manual-evidence.shared-state-negative.json'],
    ['querySet', 'inputs/query-set-v2.json'],
    ['oracle', 'inputs/behavior-oracle-v2.json'],
  ]) {
    files.set(relativePath, jsonBytes(result.inputs[key]));
  }
  files.set('inputs/oracle-runtime-identity.json', jsonBytes(result.runtime_identity));
  files.set('inputs/codegraph-identity.json', jsonBytes(result.codegraph_identity));
  files.set('identity/boundary-compiler.mjs', Buffer.from(result.identity_sources.compiler));
  files.set('identity/black-box-oracle.mjs', Buffer.from(result.identity_sources.oracle_executor));
  files.set('identity/codegraph-executable', Buffer.from(result.identity_sources.codegraph_executable));
  for (const bundle of result.evidence_bundles) {
    files.set(`evidence/${bundle.run_id}.json`, jsonBytes(bundle));
  }
  for (const runValue of result.runs) {
    files.set(`runs/${runValue.run_id}.json`, jsonBytes(runValue));
  }
  for (const [conditionName, condition] of [
    ['control', result.control],
    ['treatment', result.treatment],
  ]) {
    for (const [variantName, compiled] of [
      ['normal', condition.normal],
      ['negative', condition.negative],
    ]) {
      const root = `compiled/${conditionName}-${variantName}`;
      files.set(`${root}/boundary-manifest.json`, jsonBytes(compiled.boundary_manifest));
      files.set(`${root}/boundary-verdict.json`, jsonBytes(compiled.boundary_verdict));
      files.set(`${root}/plan.json`, jsonBytes(compiled.plan_graph));
    }
  }
  files.set('behavior/pre-receipt.json', jsonBytes(result.transform.behavior_evidence.pre_receipt));
  files.set('behavior/post-receipt.json', jsonBytes(result.transform.behavior_evidence.post_receipt));
  files.set('behavior/evidence-envelope.json', jsonBytes(result.transform.behavior_evidence.envelope));
  files.set('transform/transform-artifact.json', jsonBytes(result.transform.artifact));
  files.set('transform/transform-receipt.json', jsonBytes(result.transform.receipt));
  files.set('transform/seam.patch', Buffer.from(result.transform.patch));
  files.set('plan-diff.json', jsonBytes(result.plan_diff));
  files.set('comparison.json', jsonBytes(result.comparison));
  files.set('hypothesis-evaluation.json', jsonBytes(result.hypothesis_evaluation));
  files.set('execution-evidence.json', jsonBytes(result.execution_evidence));
  files.set(`predecessor/${RC1_V6_REJECTED_PLAN_REF}`, Buffer.from(rejectedPlanBytes));
  files.set(`predecessor/${RC1_V6_PHASE_DECISION_REF}`, Buffer.from(phaseDecisionBytes));
  return files;
}

/** RC1 v6 causal artifactを既存treeへ上書きせずatomicに保存する。 */
export async function writeRc1V6Artifacts(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'result'])
    || typeof options.repoRoot !== 'string'
    || options.repoRoot.length === 0
    || options.result?.schema !== 'lattice.rc1.corrected_campaign_result.v6') {
    throw new TypeError('RC1 v6 artifact writer options are invalid');
  }
  const { repoRoot, result } = options;
  const artifactRoot = path.join(repoRoot, ARTIFACT_ROOT);
  try {
    await lstat(artifactRoot);
    throw new Error('RC1 v6 artifact root already exists; immutable evidence is not overwritten');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const rejectedPlanBytes = await readFile(path.join(repoRoot, RC1_V6_REJECTED_PLAN_REF));
  const phaseDecisionBytes = await readFile(path.join(repoRoot, RC1_V6_PHASE_DECISION_REF));
  const files = artifactFiles(result, rejectedPlanBytes, phaseDecisionBytes);
  const manifest = {
    schema: 'lattice.rc1.artifact_manifest.v6',
    base_sha: result.base_sha,
    result_digest: digestArtifact(result.hypothesis_evaluation),
    files: [...files].map(([relativePath, bytes]) => ({
      path: relativePath,
      media_type: rc1V6ArtifactMediaType(relativePath),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
  const verification = verifyRc1V6CampaignArtifactSet({
    manifest,
    payloads: [...files].map(([relativePath, bytes]) => ({ path: relativePath, bytes })),
  });
  if (!verification.valid) {
    throw new TypeError(
      `RC1 v6 campaign artifact set is invalid: ${verification.failed_conditions.join(', ')}`,
    );
  }

  const parent = path.dirname(artifactRoot);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(parent, '.v6-write-'));
  try {
    for (const [relativePath, bytes] of files) {
      const target = path.join(temporaryRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await writeFile(path.join(temporaryRoot, 'artifact-manifest.json'), jsonBytes(manifest));
    await rename(temporaryRoot, artifactRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

/** immutable directoryをexact path setで再読込し、pure verifierへ渡す。 */
export async function verifyRc1V6ArtifactsOnDisk(options = {}) {
  if (!exactRecord(options, ['repoRoot'])
    || typeof options.repoRoot !== 'string'
    || options.repoRoot.length === 0) {
    throw new TypeError('RC1 v6 disk verifier options are invalid');
  }
  const artifactRoot = path.join(options.repoRoot, ARTIFACT_ROOT);
  const manifestBytes = await readFile(path.join(artifactRoot, 'artifact-manifest.json'));
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    return {
      schema: 'lattice.rc1.artifact_set_verification.v6',
      valid: false,
      checks: [{ id: 'manifest_canonical', passed: false }],
      failed_conditions: ['manifest_canonical'],
    };
  }
  if (!jsonBytes(manifest).equals(manifestBytes)) {
    return {
      schema: 'lattice.rc1.artifact_set_verification.v6',
      valid: false,
      checks: [{ id: 'manifest_canonical', passed: false }],
      failed_conditions: ['manifest_canonical'],
    };
  }
  const payloads = await Promise.all(RC1_V6_ARTIFACT_PATHS.map(async (relativePath) => ({
    path: relativePath,
    bytes: await readFile(path.join(artifactRoot, relativePath)),
  })));
  return verifyRc1V6CampaignArtifactSet({ manifest, payloads });
}
