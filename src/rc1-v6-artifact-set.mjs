import { createHash } from 'node:crypto';

import {
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
  validatePlanInput,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { RC1_BOUNDARY_COMPILER_CONTRACT } from './boundary-compiler.mjs';
import { validateRc1BlackBoxOracle } from './rc1-black-box-oracle.mjs';
import { verifyRc1V6BehaviorEvidence } from './rc1-v6-behavior-evidence.mjs';
import {
  createRc1V6EvidenceBundleDescriptor,
  verifyRc1V6PlanPredecessors,
  verifyRc1V6RunEvidence,
} from './rc1-v6-causal-binding.mjs';
import {
  compileRc1V6BoundaryCondition,
  sourceSnapshotFromRc1BehaviorSurface,
  sourceSnapshotFromRc1TransformOutput,
} from './rc1-v6-measurement.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const REJECTED_PLAN_REF =
  'docs/archive/2026-07-16-plan-lattice-research-campaign-1-v5-phase-rejected.md';
const PHASE_DECISION_REF = 'docs/adr/0028-rc1-v5-phase-gate-rejection.md';
const INPUT_PATHS = Object.freeze({
  planInput: 'inputs/plan-input.json',
  candidateSpec: 'inputs/candidate-spec-v2.json',
  normalManualEvidence: 'inputs/manual-evidence.normal.json',
  negativeManualEvidence: 'inputs/manual-evidence.shared-state-negative.json',
  querySet: 'inputs/query-set-v2.json',
  oracle: 'inputs/behavior-oracle-v2.json',
  runtimeIdentity: 'inputs/oracle-runtime-identity.json',
  codegraphIdentity: 'inputs/codegraph-identity.json',
});
const RUN_IDS = Object.freeze(['control-1', 'control-2', 'treatment-1', 'treatment-2']);
const IDENTITY_PATHS = Object.freeze({
  compiler: 'identity/boundary-compiler.mjs',
  oracleExecutor: 'identity/black-box-oracle.mjs',
  codegraphExecutable: 'identity/codegraph-executable',
});
const INVALIDATED_CONTEXTS = Object.freeze([
  {
    kind: 'old_plan',
    ref: 'lattice-research-campaign-1-v5',
    reason: 'v5 Phase support was rejected by ADR 0028 and cannot receive v6 topology updates',
  },
  {
    kind: 'agent_context',
    ref: 'lattice-research-campaign-1-v5-agent-context',
    reason: 'v5 context does not bind saved oracle semantics, runtime, or snapshot preimages',
  },
  {
    kind: 'partial_patch',
    ref: 'lattice-research-campaign-1-v5-partial-patch',
    reason: 'patches compiled from unbound v5 measurement identity cannot cross the v6 barrier',
  },
  {
    kind: 'interface_assumption',
    ref: 'self-reported-digest-is-causal-identity',
    reason: 'v6 requires typed preimages and exact predecessor descriptors',
  },
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

function sameArtifact(left, right) {
  try {
    return digestArtifact(left) === digestArtifact(right);
  } catch {
    return false;
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    return jsonBytes(value).equals(bytes) ? value : null;
  } catch {
    return null;
  }
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

function fixedInputIdentity(inputs, runtimeIdentity, codegraphIdentity) {
  return {
    plan_input: digestArtifact(inputs.planInput),
    candidate_spec: digestArtifact(inputs.candidateSpec),
    normal_manual_evidence: digestArtifact(inputs.normalManualEvidence),
    negative_manual_evidence: digestArtifact(inputs.negativeManualEvidence),
    query_set: digestArtifact(inputs.querySet),
    behavior_oracle: digestArtifact(inputs.oracle),
    oracle_runtime: digestArtifact(runtimeIdentity),
    codegraph_identity: digestArtifact(codegraphIdentity),
    capacity_writers: inputs.planInput.capacity.writers,
  };
}

function compiledConditionSummary(condition, bundles) {
  return {
    normal: compilationSummary(condition.normal),
    negative: compilationSummary(condition.negative),
    snapshot_digest: bundles[0].measurement.snapshot_digest,
    evidence_bundle_descriptor_digests: bundles.map((bundle) => (
      digestArtifact(createRc1V6EvidenceBundleDescriptor(bundle))
    )),
  };
}

export function buildRc1V6PlanDiff({
  control,
  treatment,
  transform,
  evidenceBundles,
  rejectedPlanBytes,
  phaseDecisionBytes,
} = {}) {
  const before = compilationSummary(control.normal);
  const after = compilationSummary(treatment.normal);
  const predecessors = [
    {
      kind: 'rejected_plan_archive',
      ref: REJECTED_PLAN_REF,
      digest: sha256(rejectedPlanBytes),
    },
    {
      kind: 'phase_decision',
      ref: PHASE_DECISION_REF,
      digest: sha256(phaseDecisionBytes),
    },
    {
      kind: 'accepted_transform',
      ref: 'transform/transform-artifact.json',
      digest: digestArtifact(transform.artifact),
    },
    {
      kind: 'behavior_envelope',
      ref: 'behavior/evidence-envelope.json',
      digest: transform.behavior_evidence.envelope.envelope_digest,
    },
    ...evidenceBundles.map((bundle) => ({
      kind: 'evidence_bundle',
      ref: `evidence/${bundle.run_id}.json`,
      digest: digestArtifact(createRc1V6EvidenceBundleDescriptor(bundle)),
    })),
  ];
  return {
    schema: 'lattice.plan_diff.v3',
    old_plan: {
      version: control.normal.plan_graph.plan_version,
      digest: control.normal.plan_graph_digest,
    },
    new_plan: {
      version: treatment.normal.plan_graph.plan_version,
      digest: treatment.normal.plan_graph_digest,
    },
    causal_predecessors: predecessors,
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
      changed: control.normal.plan_graph.nodes.map(({ id }) => id),
    },
    edges: {
      added: treatment.normal.plan_graph.edges.map(({ id }) => id),
      removed: control.normal.plan_graph.edges.map(({ id }) => id),
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

export function compileRc1V6Comparison({
  baseSha,
  inputs,
  runtimeIdentity,
  codegraphIdentity,
  compilerSourceDigest,
  control,
  treatment,
  evidenceBundles,
  transform,
  planDiff,
  sourceInvariant,
} = {}) {
  const controlBundles = evidenceBundles.filter(({ condition }) => condition === 'control');
  const treatmentBundles = evidenceBundles.filter(({ condition }) => condition === 'treatment');
  return {
    schema: 'lattice.rc1.control_treatment_comparison.v4',
    base_sha: baseSha,
    fixed_inputs: fixedInputIdentity(inputs, runtimeIdentity, codegraphIdentity),
    independent_variable: {
      kind: 'accepted_production_and_test_seam',
      transform_artifact_digest: transform.artifact_digest,
      transform_receipt_digest: transform.receipt_digest,
      patch_digest: transform.artifact.patch.digest,
    },
    compiler: {
      export_name: RC1_BOUNDARY_COMPILER_CONTRACT.export_name,
      source_digest: compilerSourceDigest,
      condition_selector: RC1_BOUNDARY_COMPILER_CONTRACT.condition_selector,
    },
    codegraph_identity: structuredClone(codegraphIdentity),
    oracle_runtime_identity: structuredClone(runtimeIdentity),
    conditions: {
      control: compiledConditionSummary(control, controlBundles),
      treatment: compiledConditionSummary(treatment, treatmentBundles),
    },
    behavior: {
      evidence_envelope_digest: transform.behavior_evidence.envelope.envelope_digest,
    },
    source_invariant: structuredClone(sourceInvariant),
    version_barrier: {
      plan_diff_digest: digestArtifact(planDiff),
      causal_predecessors_digest: digestArtifact(planDiff.causal_predecessors),
    },
  };
}

export function evaluateRc1V6Hypothesis(comparison) {
  const control = comparison?.conditions?.control;
  const treatment = comparison?.conditions?.treatment;
  const checks = [
    {
      id: 'compiler_fixed',
      passed: comparison?.compiler?.condition_selector === 'forbidden'
        && SHA256.test(comparison?.compiler?.source_digest),
    },
    {
      id: 'codegraph_identity_fixed',
      passed: comparison?.codegraph_identity?.schema === 'lattice.rc1.codegraph_identity.v1',
    },
    {
      id: 'runtime_identity_fixed',
      passed: comparison?.oracle_runtime_identity?.schema
        === 'lattice.rc1.oracle_runtime_identity.v1',
    },
    {
      id: 'control_conflict_observed',
      passed: control?.normal?.write_conflicts > 0
        && control?.normal?.test_write_conflicts > 0
        && control?.normal?.minimum_feasible_waves >= 2,
    },
    {
      id: 'treatment_conflict_removed',
      passed: treatment?.normal?.write_conflicts === 0
        && treatment?.normal?.test_write_conflicts === 0,
    },
    { id: 'treatment_unknowns_closed', passed: treatment?.normal?.unknowns === 0 },
    { id: 'treatment_one_wave', passed: treatment?.normal?.minimum_feasible_waves === 1 },
    {
      id: 'hard_precedence_not_increased',
      passed: treatment?.normal?.hard_precedence <= control?.normal?.hard_precedence,
    },
    {
      id: 'negative_state_serial_preserved',
      passed: control?.negative?.state_conflicts > 0
        && treatment?.negative?.state_conflicts > 0
        && treatment?.negative?.minimum_feasible_waves >= 2,
    },
    {
      id: 'two_fresh_runs_per_condition',
      passed: control?.evidence_bundle_descriptor_digests?.length === 2
        && treatment?.evidence_bundle_descriptor_digests?.length === 2,
    },
    {
      id: 'snapshot_changed_only_by_intervention',
      passed: SHA256.test(control?.snapshot_digest)
        && SHA256.test(treatment?.snapshot_digest)
        && control.snapshot_digest !== treatment.snapshot_digest,
    },
    {
      id: 'behavior_bound',
      passed: SHA256.test(comparison?.behavior?.evidence_envelope_digest),
    },
    {
      id: 'source_invariant',
      passed: comparison?.source_invariant?.control === true
        && comparison?.source_invariant?.treatment === true,
    },
    {
      id: 'version_barrier',
      passed: SHA256.test(comparison?.version_barrier?.plan_diff_digest)
        && SHA256.test(comparison?.version_barrier?.causal_predecessors_digest),
    },
  ];
  const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    schema: 'lattice.rc1.hypothesis_evaluation.v4',
    hypothesis_id: 'H1-v6',
    supported: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}

function compiledPaths() {
  const paths = [];
  for (const condition of ['control', 'treatment']) {
    for (const variant of ['normal', 'negative']) {
      const root = `compiled/${condition}-${variant}`;
      paths.push(
        `${root}/boundary-manifest.json`,
        `${root}/boundary-verdict.json`,
        `${root}/plan.json`,
      );
    }
  }
  return paths;
}

const EXPECTED_PATHS = Object.freeze([
  ...Object.values(INPUT_PATHS),
  ...Object.values(IDENTITY_PATHS),
  ...RUN_IDS.map((runId) => `evidence/${runId}.json`),
  ...RUN_IDS.map((runId) => `runs/${runId}.json`),
  ...compiledPaths(),
  'behavior/pre-receipt.json',
  'behavior/post-receipt.json',
  'behavior/evidence-envelope.json',
  'transform/transform-artifact.json',
  'transform/transform-receipt.json',
  'transform/seam.patch',
  'plan-diff.json',
  'comparison.json',
  'hypothesis-evaluation.json',
  'execution-evidence.json',
  `predecessor/${REJECTED_PLAN_REF}`,
  `predecessor/${PHASE_DECISION_REF}`,
].sort());

/** v6 exact path setに対応する唯一のmedia type契約。 */
export function rc1V6ArtifactMediaType(relativePath) {
  if (!EXPECTED_PATHS.includes(relativePath)) {
    throw new TypeError(`RC1 v6 artifact pathがexact setに存在しない: ${relativePath}`);
  }
  if (relativePath.endsWith('.json')) return 'application/json';
  if (relativePath.endsWith('.mjs') || relativePath === IDENTITY_PATHS.codegraphExecutable) {
    return 'application/javascript';
  }
  if (relativePath.endsWith('.patch')) return 'text/x-diff';
  return 'text/markdown';
}

function payloadMap(payloads) {
  if (!Array.isArray(payloads)) return null;
  const map = new Map();
  for (const payload of payloads) {
    if (!exactRecord(payload, ['path', 'bytes'])
      || typeof payload.path !== 'string'
      || !Buffer.isBuffer(payload.bytes)
      || map.has(payload.path)) {
      return null;
    }
    map.set(payload.path, payload.bytes);
  }
  return map;
}

function artifactContext(options) {
  if (!exactRecord(options, ['manifest', 'payloads'])) return null;
  const payloads = payloadMap(options.payloads);
  if (!payloads
    || !exactRecord(options.manifest, ['schema', 'base_sha', 'result_digest', 'files'])
    || options.manifest.schema !== 'lattice.rc1.artifact_manifest.v6'
    || !GIT_SHA1.test(options.manifest.base_sha)
    || !SHA256.test(options.manifest.result_digest)
    || !Array.isArray(options.manifest.files)) {
    return null;
  }
  const manifestPaths = options.manifest.files.map(({ path }) => path).sort();
  if (!sameArtifact(manifestPaths, EXPECTED_PATHS)
    || !sameArtifact([...payloads.keys()].sort(), EXPECTED_PATHS)) {
    return null;
  }
  for (const entry of options.manifest.files) {
    const bytes = payloads.get(entry.path);
    if (!exactRecord(entry, ['path', 'media_type', 'bytes', 'sha256'])
      || !Buffer.isBuffer(bytes)
      || entry.media_type !== rc1V6ArtifactMediaType(entry.path)
      || entry.bytes !== bytes.byteLength
      || entry.sha256 !== sha256(bytes)) {
      return null;
    }
  }
  const json = new Map();
  for (const relativePath of EXPECTED_PATHS.filter((entry) => entry.endsWith('.json'))) {
    const value = parseJson(payloads.get(relativePath));
    if (value === null) return null;
    json.set(relativePath, value);
  }
  const patch = payloads.get('transform/seam.patch');
  if (!Buffer.isBuffer(patch) || patch.byteLength === 0) return null;
  return { manifest: options.manifest, payloads, json, patch };
}

function fixedInputs(context) {
  return Object.fromEntries(Object.entries(INPUT_PATHS).map(([key, relativePath]) => (
    [key, context.json.get(relativePath)]
  )));
}

function compiledFromContext(context, condition, variant) {
  const root = `compiled/${condition}-${variant}`;
  return {
    boundary_manifest: context.json.get(`${root}/boundary-manifest.json`),
    boundary_verdict: context.json.get(`${root}/boundary-verdict.json`),
    plan_graph: context.json.get(`${root}/plan.json`),
    boundary_manifest_digest: digestArtifact(context.json.get(`${root}/boundary-manifest.json`)),
    boundary_verdict_digest: digestArtifact(context.json.get(`${root}/boundary-verdict.json`)),
    plan_graph_digest: digestArtifact(context.json.get(`${root}/plan.json`)),
  };
}

function savedCompilationMatchesReplay(saved, replayed) {
  return sameArtifact(saved.boundary_manifest, replayed.boundary_manifest)
    && sameArtifact(saved.boundary_verdict, replayed.boundary_verdict)
    && sameArtifact(saved.plan_graph, replayed.plan_graph)
    && saved.boundary_manifest_digest === replayed.boundary_manifest_digest
    && saved.boundary_verdict_digest === replayed.boundary_verdict_digest
    && saved.plan_graph_digest === replayed.plan_graph_digest;
}

function compilerReplay(context, inputs, bundles, runs, expectations) {
  const conditions = {};
  for (const condition of ['control', 'treatment']) {
    const conditionBundles = bundles.filter((bundle) => bundle.condition === condition);
    const conditionRuns = runs.filter((run) => run.condition === condition);
    if (conditionBundles.length !== 2 || conditionRuns.length !== 2) return null;
    const outputs = [];
    for (let index = 0; index < 2; index += 1) {
      const common = {
        planInput: inputs.planInput,
        candidateSpec: inputs.candidateSpec,
        querySet: inputs.querySet,
        run: conditionRuns[index],
        bundle: conditionBundles[index],
        expected: expectations[condition],
      };
      outputs.push({
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
      });
    }
    if (!sameArtifact(outputs[0], outputs[1])) return null;
    conditions[condition] = outputs[0];
  }
  return conditions;
}

function transformValid(context, control, treatment, behaviorEvidence, runtimeIdentity) {
  const artifact = context.json.get('transform/transform-artifact.json');
  const receipt = context.json.get('transform/transform-receipt.json');
  if (!validateTransformArtifact(artifact)
    || artifact.status !== 'accepted'
    || sha256(context.patch) !== artifact.patch.digest
    || digestArtifact(artifact) !== receipt?.transform_artifact_digest
    || !exactRecord(receipt, [
      'schema',
      'status',
      'transform_artifact_digest',
      'behavior_envelope_digest',
      'fixed_inputs_digest',
      'runtime_identity_digest',
      'source_invariant',
      'receipt_digest',
    ])
    || receipt.schema !== 'lattice.rc1.seam_transform_receipt.v6'
    || receipt.status !== 'accepted'
    || receipt.behavior_envelope_digest !== behaviorEvidence.envelope.envelope_digest
    || receipt.fixed_inputs_digest !== digestArtifact(artifact.source)
    || receipt.runtime_identity_digest !== digestArtifact(runtimeIdentity)
    || receipt.source_invariant?.outcome !== 'passed') {
    return null;
  }
  const { receipt_digest: ignored, ...preimage } = receipt;
  if (receipt.receipt_digest !== digestArtifact(preimage)
    || artifact.source.boundary_manifest_digest !== control.normal.boundary_manifest_digest
    || artifact.source.boundary_verdict_digest !== control.normal.boundary_verdict_digest
    || artifact.source.control_plan_digest !== control.normal.plan_graph_digest
    || artifact.source.code_snapshot_digest
      !== control.normal.boundary_manifest.source.code_snapshot_digest
    || !sameArtifact(
      sourceSnapshotFromRc1TransformOutput(artifact),
      sourceSnapshotFromRc1BehaviorSurface(behaviorEvidence.post_receipt.surface),
    )
    || treatment.normal.boundary_manifest.source.code_snapshot_digest
      !== digestArtifact(sourceSnapshotFromRc1TransformOutput(artifact))) {
    return null;
  }
  return {
    artifact,
    artifact_digest: digestArtifact(artifact),
    receipt,
    receipt_digest: receipt.receipt_digest,
    patch: context.patch,
    behavior_evidence: behaviorEvidence,
  };
}

function executionValid(value, expected) {
  return exactRecord(value, [
    'schema',
    'base_sha',
    'elapsed_ms',
    'compiler_source_digest',
    'codegraph_identity_digest',
    'runtime_identity_digest',
    'run_descriptor_digests',
    'transform_artifact_digest',
    'behavior_envelope_digest',
    'plan_diff_digest',
    'comparison_digest',
    'hypothesis_evaluation_digest',
    'source_invariant',
  ])
    && value.schema === 'lattice.rc1.corrected_campaign_execution_evidence.v6'
    && value.base_sha === expected.baseSha
    && Number.isFinite(value.elapsed_ms)
    && value.elapsed_ms >= 0
    && value.compiler_source_digest === expected.compilerSourceDigest
    && value.codegraph_identity_digest === digestArtifact(expected.codegraphIdentity)
    && value.runtime_identity_digest === digestArtifact(expected.runtimeIdentity)
    && sameArtifact(value.run_descriptor_digests, expected.runDescriptorDigests)
    && value.transform_artifact_digest === expected.transformArtifactDigest
    && value.behavior_envelope_digest === expected.behaviorEnvelopeDigest
    && value.plan_diff_digest === expected.planDiffDigest
    && value.comparison_digest === expected.comparisonDigest
    && value.hypothesis_evaluation_digest === expected.hypothesisEvaluationDigest
    && sameArtifact(value.source_invariant, expected.sourceInvariant);
}

/** v6 manifestと保存payloadだけから全causal relationを再計算する。 */
export function verifyRc1V6CampaignArtifactSet(options) {
  const checks = [];
  const check = (id, passed) => checks.push({ id, passed: passed === true });
  let context;
  try {
    context = artifactContext(options);
  } catch {
    context = null;
  }
  check('exact_artifact_set', context !== null);
  if (context === null) {
    return {
      schema: 'lattice.rc1.artifact_set_verification.v6',
      valid: false,
      checks,
      failed_conditions: ['exact_artifact_set'],
    };
  }

  try {
    const inputs = fixedInputs(context);
    const compilerSourceDigest = sha256(context.payloads.get(IDENTITY_PATHS.compiler));
    const identitySourceBinding = sha256(context.payloads.get(IDENTITY_PATHS.oracleExecutor))
        === inputs.runtimeIdentity?.executor_source_digest
      && sha256(context.payloads.get(IDENTITY_PATHS.codegraphExecutable))
        === inputs.codegraphIdentity?.executable_digest;
    check('identity_source_binding', identitySourceBinding);
    const baseInputsValid = validatePlanInput(inputs.planInput)
      && validateRc1BlackBoxOracle(inputs.oracle)
      && digestArtifact(inputs.querySet) === context.json.get('evidence/control-1.json').query_set_digest;
    check('input_identity', baseInputsValid);

    const behaviorEvidence = {
      pre_receipt: context.json.get('behavior/pre-receipt.json'),
      post_receipt: context.json.get('behavior/post-receipt.json'),
      envelope: context.json.get('behavior/evidence-envelope.json'),
      transform_artifact: context.json.get('transform/transform-artifact.json'),
      patch_digest: sha256(context.patch),
    };
    const behaviorVerification = verifyRc1V6BehaviorEvidence({
      oracle: inputs.oracle,
      runtimeIdentity: inputs.runtimeIdentity,
      preReceipt: behaviorEvidence.pre_receipt,
      postReceipt: behaviorEvidence.post_receipt,
      transformArtifact: behaviorEvidence.transform_artifact,
      patchDigest: behaviorEvidence.patch_digest,
      envelope: behaviorEvidence.envelope,
    });
    check('behavior_artifact_set', behaviorVerification.valid);

    const controlSnapshot = sourceSnapshotFromRc1BehaviorSurface(
      behaviorEvidence.pre_receipt.surface,
    );
    const treatmentSnapshot = sourceSnapshotFromRc1TransformOutput(
      behaviorEvidence.transform_artifact,
    );
    const expectations = {
      control: {
        base_sha: context.manifest.base_sha,
        patch_digest: null,
        snapshot: controlSnapshot,
        codegraph_identity: inputs.codegraphIdentity,
        query_set_digest: digestArtifact(inputs.querySet),
      },
      treatment: {
        base_sha: context.manifest.base_sha,
        patch_digest: behaviorEvidence.patch_digest,
        snapshot: treatmentSnapshot,
        codegraph_identity: inputs.codegraphIdentity,
        query_set_digest: digestArtifact(inputs.querySet),
      },
    };
    const bundles = RUN_IDS.map((runId) => context.json.get(`evidence/${runId}.json`));
    const runs = RUN_IDS.map((runId) => context.json.get(`runs/${runId}.json`));
    const runEvidenceValid = bundles.every((bundle, index) => (
      verifyRc1V6RunEvidence({
        run: runs[index],
        bundle,
        expected: expectations[bundle.condition],
      }).valid
    ))
      && bundles.filter(({ condition }) => condition === 'control').length === 2
      && bundles.filter(({ condition }) => condition === 'treatment').length === 2
      && bundles[0].portable.aggregate_digest === bundles[1].portable.aggregate_digest
      && bundles[2].portable.aggregate_digest === bundles[3].portable.aggregate_digest;
    check('evidence_campaign', runEvidenceValid);

    const replay = runEvidenceValid
      ? compilerReplay(context, inputs, bundles, runs, expectations)
      : null;
    const savedControl = {
      normal: compiledFromContext(context, 'control', 'normal'),
      negative: compiledFromContext(context, 'control', 'negative'),
    };
    const savedTreatment = {
      normal: compiledFromContext(context, 'treatment', 'normal'),
      negative: compiledFromContext(context, 'treatment', 'negative'),
    };
    const savedCompiledValid = [savedControl.normal, savedControl.negative,
      savedTreatment.normal, savedTreatment.negative].every((compiled) => (
      validateBoundaryManifest(compiled.boundary_manifest)
      && validateBoundaryVerdict(compiled.boundary_verdict)
      && validatePlanGraph(compiled.plan_graph)
    ));
    check('compiler_replay', replay !== null && savedCompiledValid
      && savedCompilationMatchesReplay(savedControl.normal, replay.control.normal)
      && savedCompilationMatchesReplay(savedControl.negative, replay.control.negative)
      && savedCompilationMatchesReplay(savedTreatment.normal, replay.treatment.normal)
      && savedCompilationMatchesReplay(savedTreatment.negative, replay.treatment.negative));

    const transform = replay === null ? null : transformValid(
      context,
      savedControl,
      savedTreatment,
      behaviorEvidence,
      inputs.runtimeIdentity,
    );
    check('transform_binding', transform !== null);

    const rejectedPlanBytes = context.payloads.get(`predecessor/${REJECTED_PLAN_REF}`);
    const phaseDecisionBytes = context.payloads.get(`predecessor/${PHASE_DECISION_REF}`);
    const expectedPlanDiff = transform === null ? null : buildRc1V6PlanDiff({
      control: savedControl,
      treatment: savedTreatment,
      transform,
      evidenceBundles: bundles,
      rejectedPlanBytes,
      phaseDecisionBytes,
    });
    const savedPlanDiff = context.json.get('plan-diff.json');
    const predecessorVerification = expectedPlanDiff === null
      ? { valid: false }
      : verifyRc1V6PlanPredecessors({
        planDiff: savedPlanDiff,
        expectedPredecessors: expectedPlanDiff.causal_predecessors,
      });
    check('plan_diff_binding', expectedPlanDiff !== null
      && sameArtifact(savedPlanDiff, expectedPlanDiff)
      && predecessorVerification.valid);

    const sourceInvariant = context.json.get('execution-evidence.json')?.source_invariant;
    const expectedComparison = transform === null ? null : compileRc1V6Comparison({
      baseSha: context.manifest.base_sha,
      inputs,
      runtimeIdentity: inputs.runtimeIdentity,
      codegraphIdentity: inputs.codegraphIdentity,
      compilerSourceDigest,
      control: savedControl,
      treatment: savedTreatment,
      evidenceBundles: bundles,
      transform,
      planDiff: savedPlanDiff,
      sourceInvariant,
    });
    const savedComparison = context.json.get('comparison.json');
    check('comparison_binding', expectedComparison !== null
      && sameArtifact(savedComparison, expectedComparison));

    const expectedEvaluation = expectedComparison === null
      ? null
      : evaluateRc1V6Hypothesis(expectedComparison);
    const savedEvaluation = context.json.get('hypothesis-evaluation.json');
    check('hypothesis_evaluation', expectedEvaluation !== null
      && sameArtifact(savedEvaluation, expectedEvaluation)
      && savedEvaluation.supported === true);

    const execution = context.json.get('execution-evidence.json');
    check('execution_evidence', transform !== null && executionValid(execution, {
      baseSha: context.manifest.base_sha,
      compilerSourceDigest,
      codegraphIdentity: inputs.codegraphIdentity,
      runtimeIdentity: inputs.runtimeIdentity,
      runDescriptorDigests: runs.map(({ evidence_bundle_descriptor_digest: digest }) => digest),
      transformArtifactDigest: transform.artifact_digest,
      behaviorEnvelopeDigest: behaviorEvidence.envelope.envelope_digest,
      planDiffDigest: digestArtifact(savedPlanDiff),
      comparisonDigest: digestArtifact(savedComparison),
      hypothesisEvaluationDigest: digestArtifact(savedEvaluation),
      sourceInvariant,
    }));
    check('result_binding', context.manifest.result_digest === digestArtifact(savedEvaluation));
  } catch {
    for (const id of [
      'input_identity',
      'identity_source_binding',
      'behavior_artifact_set',
      'evidence_campaign',
      'compiler_replay',
      'transform_binding',
      'plan_diff_binding',
      'comparison_binding',
      'hypothesis_evaluation',
      'execution_evidence',
      'result_binding',
    ]) {
      if (!checks.some((entry) => entry.id === id)) check(id, false);
    }
  }
  const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    schema: 'lattice.rc1.artifact_set_verification.v6',
    valid: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}

export const RC1_V6_ARTIFACT_PATHS = EXPECTED_PATHS;
export const RC1_V6_REJECTED_PLAN_REF = REJECTED_PLAN_REF;
export const RC1_V6_PHASE_DECISION_REF = PHASE_DECISION_REF;
