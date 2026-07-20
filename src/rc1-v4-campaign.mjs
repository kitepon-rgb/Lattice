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

import {
  canonicalizeArtifact,
  digestArtifact,
} from './artifact-contracts.mjs';
import {
  compileBoundaryCondition,
  RC1_BOUNDARY_COMPILER_CONTRACT,
} from './boundary-compiler.mjs';
import { collectCodegraphEvidence } from './codegraph-adapter.mjs';
import { invokeSensorCli } from './sensor-runtime.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';
import { evaluateRc1Hypothesis } from './rc1-comparison.mjs';
import {
  createRc1EvidenceBundle,
  recomputePortableAggregate,
  validateRc1EvidenceBundle,
  validateRc1EvidenceCampaign,
} from './rc1-evidence-bundle.mjs';
import {
  RC1_V4_TRANSFORM_PATHS,
  runRc1V4SeamTransform,
} from './rc1-v4-transform.mjs';

const ARTIFACT_ROOT = 'research/campaigns/rc1/artifacts/v4';
const INPUT_KEYS = Object.freeze([
  'planInput',
  'candidateSpec',
  'normalManualEvidence',
  'negativeManualEvidence',
  'querySet',
  'oracle',
]);
const INVALIDATED_CONTEXTS = Object.freeze([
  {
    kind: 'old_plan',
    ref: 'lattice-research-campaign-1-v3',
    reason: 'v3 causal plan was rejected by ADR 0016 and cannot receive v4 topology updates',
  },
  {
    kind: 'agent_context',
    ref: 'lattice-research-campaign-1-v3-agent-context',
    reason: 'condition-specific compiler and shared-test assumptions are invalid after v4 recompile',
  },
  {
    kind: 'partial_patch',
    ref: 'lattice-research-campaign-1-v3-partial-patch',
    reason: 'patches based on production-only ownership cannot cross the v4 version barrier',
  },
  {
    kind: 'interface_assumption',
    ref: 'shared-test-is-run-only',
    reason: 'future TODO-owned test writes are part of the schedulability boundary',
  },
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function roundedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 1_000) / 1_000;
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

async function fixedSnapshot(repoRoot) {
  const files = [];
  for (const relativePath of RC1_V4_TRANSFORM_PATHS) {
    const absolutePath = path.join(repoRoot, relativePath);
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile()) throw new TypeError(`RC1 v4 snapshot path is not a file: ${relativePath}`);
      files.push({
        path: relativePath,
        state: 'file',
        content_digest: sha256(await readFile(absolutePath)),
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files.push({ path: relativePath, state: 'missing', content_digest: null });
    }
  }
  const value = { schema: 'lattice.rc1.fixed_surface_snapshot.v4', files };
  return { ...value, digest: digestArtifact(value) };
}

async function applyAcceptedPatch(worktreePath, patch) {
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

async function observeFreshIndex({
  repoRoot,
  baseRef,
  condition,
  runId,
  querySet,
  patch,
}) {
  let rawEvidence;
  let snapshot;
  let indexElapsedMs;
  let queryElapsedMs;
  const isolated = await runIsolatedTransform({
    repoRoot,
    baseRef,
    allowedPaths: condition === 'treatment' ? [...RC1_V4_TRANSFORM_PATHS] : [],
    transform: async ({ worktreePath }) => {
      if (condition === 'treatment') await applyAcceptedPatch(worktreePath, patch);
      snapshot = await fixedSnapshot(worktreePath);
      const codegraphBootstrap = await captureCodegraphBootstrap(worktreePath);
      try {
        const indexStartedAt = performance.now();
        await invokeSensorCli(run, ['init', '.'], { cwd: worktreePath });
        indexElapsedMs = roundedMilliseconds(indexStartedAt);
        const queryStartedAt = performance.now();
        rawEvidence = await collectCodegraphEvidence({ cwd: worktreePath, querySet });
        queryElapsedMs = roundedMilliseconds(queryStartedAt);
      } finally {
        await restoreCodegraphBootstrap(worktreePath, codegraphBootstrap);
      }
    },
    verifyCommands: [],
  });
  if (!rawEvidence || !snapshot || isolated.sourceInvariant?.outcome !== 'passed') {
    throw new TypeError(`RC1 v4 ${runId} fresh index did not produce complete evidence`);
  }
  if (condition === 'treatment'
    && (!Buffer.isBuffer(patch) || !isolated.patch.equals(patch))) {
    throw new TypeError(`RC1 v4 ${runId} did not replay the accepted patch bytes exactly`);
  }
  const bundle = createRc1EvidenceBundle({ condition, runId, querySet, rawEvidence });
  const patchDigest = condition === 'treatment' ? sha256(isolated.patch) : null;
  return {
    runId,
    condition,
    rawEvidence,
    bundle,
    codeSnapshotDigest: snapshot.digest,
    sourceInvariant: isolated.sourceInvariant,
    patchDigest,
    indexElapsedMs,
    queryElapsedMs,
  };
}

function compileOne({ inputs, observation, manualEvidence, planVersion }) {
  return compileBoundaryCondition({
    planInput: inputs.planInput,
    candidateSpec: inputs.candidateSpec,
    manualEvidence,
    querySet: inputs.querySet,
    codegraphEvidence: observation.rawEvidence,
    codeSnapshotDigest: observation.codeSnapshotDigest,
    planVersion,
  });
}

function compileCondition(inputs, observations, condition) {
  const planVersion = `rc1-v4-${condition}`;
  const compiled = observations.map((observation) => ({
    normal: compileOne({
      inputs,
      observation,
      manualEvidence: inputs.normalManualEvidence,
      planVersion,
    }),
    negative: compileOne({
      inputs,
      observation,
      manualEvidence: inputs.negativeManualEvidence,
      planVersion: `${planVersion}-negative`,
    }),
  }));
  for (const key of ['normal', 'negative']) {
    if (digestArtifact(compiled[0][key]) !== digestArtifact(compiled[1][key])) {
      throw new TypeError(`RC1 v4 ${condition} ${key} compilation is not reproducible`);
    }
  }
  return compiled[0];
}

function sourceBindings(control, querySet) {
  return {
    boundary_manifest_digest: control.boundary_manifest_digest,
    boundary_verdict_digest: control.boundary_verdict_digest,
    control_plan_digest: control.plan_graph_digest,
    query_set_digest: digestArtifact(querySet),
    code_snapshot_digest: control.boundary_manifest.source.code_snapshot_digest,
  };
}

function compilationSummary(compiled) {
  const conflicts = compiled.boundary_manifest.conflicts;
  return {
    boundary_manifest_digest: compiled.boundary_manifest_digest,
    boundary_verdict_digest: compiled.boundary_verdict_digest,
    plan_graph_digest: compiled.plan_graph_digest,
    verdict: compiled.boundary_verdict.verdicts[0].verdict,
    write_conflicts: conflicts.filter(({ kind }) => kind === 'write_boundary').length,
    test_write_conflicts: conflicts.filter(({ kind, resource }) => (
      kind === 'write_boundary'
        && resource.kind === 'path'
        && resource.target.startsWith('test/')
    )).length,
    state_conflicts: conflicts.filter(({ kind }) => kind === 'state').length,
    hard_precedence: compiled.boundary_manifest.todos
      .reduce((count, todo) => count + todo.hard_needs.length, 0),
    unknowns: compiled.boundary_manifest.unknowns.length,
    minimum_feasible_waves: compiled.plan_graph.minimum_feasible_waves,
  };
}

function fixedInputIdentity(inputs) {
  return {
    plan_input: digestArtifact(inputs.planInput),
    candidate_spec: digestArtifact(inputs.candidateSpec),
    normal_manual_evidence: digestArtifact(inputs.normalManualEvidence),
    negative_manual_evidence: digestArtifact(inputs.negativeManualEvidence),
    query_set: digestArtifact(inputs.querySet),
    capacity_writers: inputs.planInput.capacity.writers,
    behavior_oracle: digestArtifact(inputs.oracle),
  };
}

function evidenceSummary(bundles, querySet) {
  return {
    portable_preimages_complete: bundles.length === 2 && bundles.every((bundle) => (
      validateRc1EvidenceBundle(bundle)
        && bundle.portable.outcomes.length === querySet.queries.length
        && bundle.portable.per_query.length === querySet.queries.length
    )),
    digests_recomputed: bundles.every((bundle) => (
      recomputePortableAggregate(bundle.portable) === bundle.portable.aggregate_digest
    )),
    diagnostics_sanitized: bundles.every((bundle) => (
      validateRc1EvidenceBundle(bundle)
        && bundle.diagnostic.payload.cwd === '<repo-root>'
        && bundle.diagnostic.sanitization_manifest.schema
          === 'lattice.codegraph_sanitization_manifest.v1'
    )),
  };
}

function buildPlanDiff(control, treatment, transform) {
  const before = compilationSummary(control);
  const after = compilationSummary(treatment);
  return {
    schema: 'lattice.plan_diff.v2',
    old_plan: { version: control.plan_graph.plan_version, digest: control.plan_graph_digest },
    new_plan: { version: treatment.plan_graph.plan_version, digest: treatment.plan_graph_digest },
    causal_predecessor: {
      plan_version: 'lattice-research-campaign-1-v3',
      decision_ref: 'docs/adr/0016-rc1-v3-phase-gate-rejection.md',
      status: 'rejected',
    },
    transform: {
      status: transform.artifact.status,
      artifact_digest: transform.artifact_digest,
      receipt_digest: transform.receipt_digest,
      patch_digest: transform.artifact.patch.digest,
      changed_paths: [...transform.artifact.scope.changed_paths],
    },
    nodes: {
      added: [],
      removed: [],
      changed: control.plan_graph.nodes.map(({ id }) => id),
    },
    edges: {
      added: treatment.plan_graph.edges.map(({ id }) => id),
      removed: control.plan_graph.edges.map(({ id }) => id),
    },
    invalidated_contexts: structuredClone(INVALIDATED_CONTEXTS),
    metrics: {
      write_conflicts_before: before.write_conflicts,
      write_conflicts_after: after.write_conflicts,
      test_write_conflicts_before: before.test_write_conflicts,
      test_write_conflicts_after: after.test_write_conflicts,
      hard_precedence_before: before.hard_precedence,
      hard_precedence_after: after.hard_precedence,
      minimum_feasible_waves_before: before.minimum_feasible_waves,
      minimum_feasible_waves_after: after.minimum_feasible_waves,
    },
  };
}

function fixedInputsBound(transform, bindings) {
  return Object.entries(bindings).every(([key, digest]) => transform.artifact.source[key] === digest)
    && transform.artifact_digest === digestArtifact(transform.artifact)
    && transform.receipt_digest === digestArtifact(transform.receipt)
    && transform.receipt.transform_artifact_digest === transform.artifact_digest
    && /^[0-9a-f]{64}$/.test(transform.receipt.fixed_inputs_digest);
}

function makeComparison({
  inputs,
  compilerSourceDigest,
  control,
  treatment,
  controlBundles,
  treatmentBundles,
  transform,
  baseSha,
  planDiff,
  sourceInvariant,
}) {
  const fixed = fixedInputIdentity(inputs);
  const oracleDigest = digestArtifact(inputs.oracle);
  const bindings = sourceBindings(control.normal, inputs.querySet);
  return {
    schema: 'lattice.rc1.control_treatment_comparison.v2',
    fixed_inputs: { control: fixed, treatment: structuredClone(fixed) },
    independent_variable: {
      kind: 'accepted_production_and_test_seam',
      transform_artifact_digest: transform.artifact_digest,
      transform_receipt_digest: transform.receipt_digest,
      patch_digest: transform.artifact.patch.digest,
    },
    compiler: {
      condition_selector: RC1_BOUNDARY_COMPILER_CONTRACT.condition_selector,
      control: {
        export_name: RC1_BOUNDARY_COMPILER_CONTRACT.export_name,
        source_digest: compilerSourceDigest,
      },
      treatment: {
        export_name: RC1_BOUNDARY_COMPILER_CONTRACT.export_name,
        source_digest: compilerSourceDigest,
      },
    },
    control: compilationSummary(control.normal),
    treatment: compilationSummary(treatment.normal),
    negative_control: compilationSummary(control.negative),
    negative_treatment: compilationSummary(treatment.negative),
    behavior: {
      control: { outcome: transform.receipt.behavior.pre.outcome, oracle_digest: oracleDigest },
      treatment: { outcome: transform.receipt.behavior.post.outcome, oracle_digest: oracleDigest },
    },
    evidence: {
      control: evidenceSummary(controlBundles, inputs.querySet),
      treatment: evidenceSummary(treatmentBundles, inputs.querySet),
    },
    predecessor: {
      transform_status: transform.artifact.status,
      same_base: transform.artifact.source.base_sha === baseSha,
      fixed_inputs_bound: fixedInputsBound(transform, bindings),
    },
    version_barrier: {
      old_plan: planDiff.old_plan,
      new_plan: planDiff.new_plan,
      plan_diff_digest: digestArtifact(planDiff),
      invalidated_contexts: planDiff.invalidated_contexts.map(({ kind, ref }) => ({ kind, ref })),
    },
    source_invariant: {
      control: sourceInvariant.control ? 'passed' : 'failed',
      treatment: sourceInvariant.treatment ? 'passed' : 'failed',
    },
  };
}

function runRecord(observation) {
  return {
    run_id: observation.runId,
    condition: observation.condition,
    index_elapsed_ms: observation.indexElapsedMs,
    query_elapsed_ms: observation.queryElapsedMs,
    code_snapshot_digest: observation.codeSnapshotDigest,
    raw_digest: observation.bundle.raw.payload_digest,
    diagnostic_digest: observation.bundle.diagnostic.payload_digest,
    portable_digest: observation.bundle.portable.aggregate_digest,
    bundle_descriptor_digest: digestArtifact({
      schema: observation.bundle.schema,
      condition: observation.bundle.condition,
      run_id: observation.bundle.run_id,
      query_set_digest: observation.bundle.query_set_digest,
      component_digests: observation.bundle.component_digests,
    }),
    patch_digest: observation.patchDigest,
    source_invariant: observation.sourceInvariant,
    source_invariant_digest: digestArtifact(observation.sourceInvariant),
  };
}

function compilationDigests(condition) {
  return Object.fromEntries(['normal', 'negative'].map((key) => [key, {
    boundary_manifest: condition[key].boundary_manifest_digest,
    boundary_verdict: condition[key].boundary_verdict_digest,
    plan_graph: condition[key].plan_graph_digest,
  }]));
}

function assertInputs(inputs) {
  if (!exactRecord(inputs, INPUT_KEYS)) {
    throw new TypeError('RC1 v4 campaign inputs must have the fixed exact shape');
  }
  for (const value of Object.values(inputs)) canonicalizeArtifact(value);
}

/** fixed RC1 v4 fixtureをcontrol観測からtreatment再compileまで閉ループで実行する。 */
export async function runRc1V4Campaign(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'baseRef', 'inputs'])) {
    throw new TypeError('RC1 v4 campaign options must have the fixed exact shape');
  }
  const { repoRoot, baseRef, inputs } = options;
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0) {
    throw new TypeError('RC1 v4 campaign repoRoot and baseRef are required');
  }
  assertInputs(inputs);
  const fixedInputs = structuredClone(inputs);
  const baseSha = (await run('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: repoRoot }))
    .stdout.toString('utf8').trim();
  const compilerSourceDigest = sha256(await readFile(new URL('./boundary-compiler.mjs', import.meta.url)));
  const campaignSourceDigest = sha256(await readFile(new URL('./rc1-v4-campaign.mjs', import.meta.url)));
  const startedAt = performance.now();

  const controlObservations = [];
  for (const runId of ['control-1', 'control-2']) {
    controlObservations.push(await observeFreshIndex({
      repoRoot,
      baseRef: baseSha,
      condition: 'control',
      runId,
      querySet: fixedInputs.querySet,
    }));
  }
  const control = compileCondition(fixedInputs, controlObservations, 'control');
  const bindings = sourceBindings(control.normal, fixedInputs.querySet);
  const transform = await runRc1V4SeamTransform({
    repoRoot,
    baseRef: baseSha,
    oracle: fixedInputs.oracle,
    sourceBindings: bindings,
  });
  if (transform.artifact.status !== 'accepted'
    || transform.receipt.source_invariant?.outcome !== 'passed'
    || !Buffer.isBuffer(transform.patch)) {
    const error = new Error('RC1 v4 accepted transform predecessor was not produced');
    error.transform = transform;
    throw error;
  }

  const treatmentObservations = [];
  for (const runId of ['treatment-1', 'treatment-2']) {
    const observation = await observeFreshIndex({
      repoRoot,
      baseRef: baseSha,
      condition: 'treatment',
      runId,
      querySet: fixedInputs.querySet,
      patch: transform.patch,
    });
    if (observation.patchDigest !== transform.artifact.patch.digest) {
      throw new TypeError(`${runId} did not apply the exact accepted patch`);
    }
    treatmentObservations.push(observation);
  }
  const treatment = compileCondition(fixedInputs, treatmentObservations, 'treatment');
  const evidenceBundles = [
    ...controlObservations.map(({ bundle }) => bundle),
    ...treatmentObservations.map(({ bundle }) => bundle),
  ];
  if (!validateRc1EvidenceCampaign(evidenceBundles)) {
    throw new TypeError('RC1 v4 2+2 evidence campaign is not reproducible');
  }

  const sourceInvariant = {
    control: controlObservations.every(({ sourceInvariant: receipt }) => receipt.outcome === 'passed'),
    treatment: transform.receipt.source_invariant.outcome === 'passed'
      && treatmentObservations.every(({ sourceInvariant: receipt }) => receipt.outcome === 'passed'),
  };
  const planDiff = buildPlanDiff(control.normal, treatment.normal, transform);
  const comparison = makeComparison({
    inputs: fixedInputs,
    compilerSourceDigest,
    control,
    treatment,
    controlBundles: evidenceBundles.filter(({ condition }) => condition === 'control'),
    treatmentBundles: evidenceBundles.filter(({ condition }) => condition === 'treatment'),
    transform,
    baseSha,
    planDiff,
    sourceInvariant,
  });
  const hypothesisEvaluation = evaluateRc1Hypothesis(comparison);
  const conditionRuns = {
    control: controlObservations.map(runRecord),
    treatment: treatmentObservations.map(runRecord),
  };
  const executionEvidence = {
    schema: 'lattice.rc1.corrected_campaign_execution_evidence.v4',
    base_sha: baseSha,
    elapsed_ms: roundedMilliseconds(startedAt),
    compiler: {
      export_name: RC1_BOUNDARY_COMPILER_CONTRACT.export_name,
      source_digest: compilerSourceDigest,
      campaign_runner_source_digest: campaignSourceDigest,
    },
    fixed_inputs: fixedInputIdentity(fixedInputs),
    runs: conditionRuns,
    transform: {
      artifact_digest: transform.artifact_digest,
      receipt_digest: transform.receipt_digest,
      patch_digest: transform.artifact.patch.digest,
      source_invariant_digest: digestArtifact(transform.receipt.source_invariant),
    },
    compilations: {
      control: compilationDigests(control),
      treatment: compilationDigests(treatment),
    },
    plan_diff_digest: digestArtifact(planDiff),
    comparison_digest: digestArtifact(comparison),
    hypothesis_evaluation_digest: digestArtifact(hypothesisEvaluation),
    observed_facts: {
      evidence_campaign_valid: true,
      compiler_reused: true,
      exact_patch_replayed: true,
      source_invariant_passed: sourceInvariant.control && sourceInvariant.treatment,
      hypothesis_supported: hypothesisEvaluation.supported,
    },
  };
  return {
    schema: 'lattice.rc1.corrected_campaign_result.v4',
    base_sha: baseSha,
    evidence_bundles: evidenceBundles,
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

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function artifactFiles(result) {
  const files = new Map();
  for (const bundle of result.evidence_bundles) {
    files.set(`evidence/${bundle.run_id}.json`, jsonBytes(bundle));
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
  files.set('transform/transform-artifact.json', jsonBytes(result.transform.artifact));
  files.set('transform/transform-receipt.json', jsonBytes(result.transform.receipt));
  files.set('transform/seam.patch', Buffer.from(result.transform.patch));
  files.set('plan-diff.json', jsonBytes(result.plan_diff));
  files.set('comparison.json', jsonBytes(result.comparison));
  files.set('hypothesis-evaluation.json', jsonBytes(result.hypothesis_evaluation));
  files.set('execution-evidence.json', jsonBytes(result.execution_evidence));
  return files;
}

/** RC1 v4 machine artifactsを既存treeへ上書きせずatomicに保存する。 */
export async function writeRc1V4Artifacts(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'result'])) {
    throw new TypeError('RC1 v4 artifact writer options must have the fixed exact shape');
  }
  const { repoRoot, result } = options;
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || !exactRecord(result, [
      'schema',
      'base_sha',
      'evidence_bundles',
      'condition_runs',
      'control',
      'treatment',
      'transform',
      'plan_diff',
      'comparison',
      'hypothesis_evaluation',
      'execution_evidence',
    ])
    || result.schema !== 'lattice.rc1.corrected_campaign_result.v4'
    || !validateRc1EvidenceCampaign(result.evidence_bundles)
    || !Buffer.isBuffer(result.transform?.patch)
    || result.transform?.artifact?.status !== 'accepted'
    || sha256(result.transform.patch) !== result.transform.artifact.patch?.digest) {
    throw new TypeError('RC1 v4 artifact writer arguments are invalid');
  }
  const artifactRoot = path.join(repoRoot, ARTIFACT_ROOT);
  try {
    await lstat(artifactRoot);
    throw new Error('RC1 v4 artifact root already exists; immutable evidence is not overwritten');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const files = artifactFiles(result);
  const manifest = {
    schema: 'lattice.rc1.artifact_manifest.v4',
    base_sha: result.base_sha,
    result_digest: digestArtifact({
      execution_evidence: result.execution_evidence,
      hypothesis_evaluation: result.hypothesis_evaluation,
    }),
    files: [...files].map(([relativePath, bytes]) => ({
      path: relativePath,
      media_type: relativePath.endsWith('.json') ? 'application/json' : 'text/x-diff',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
  const parent = path.dirname(artifactRoot);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(parent, '.v4-write-'));
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
