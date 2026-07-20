import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  canonicalizeArtifact,
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
  validatePlanInput,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import {
  compileBoundaryCondition,
  RC1_BOUNDARY_COMPILER_CONTRACT,
} from './boundary-compiler.mjs';
import {
  recomputePortableAggregate,
  validateRc1EvidenceBundle,
  validateRc1EvidenceCampaign,
} from './rc1-evidence-bundle.mjs';
import { validateRc1BlackBoxOracle } from './rc1-black-box-oracle.mjs';
import {
  evaluateRc1V5Hypothesis,
  verifyRc1V5BehaviorArtifactSet,
} from './rc1-v5-behavior-evidence.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const INPUT_PATHS = Object.freeze({
  planInput: 'inputs/plan-input.json',
  candidateSpec: 'inputs/candidate-spec-v2.json',
  normalManualEvidence: 'inputs/manual-evidence.normal.json',
  negativeManualEvidence: 'inputs/manual-evidence.shared-state-negative.json',
  querySet: 'inputs/query-set-v2.json',
  oracle: 'inputs/behavior-oracle-v2.json',
});
const EVIDENCE_PATHS = Object.freeze([
  ['control', 'control-1'],
  ['control', 'control-2'],
  ['treatment', 'treatment-1'],
  ['treatment', 'treatment-2'],
]);
const INVALIDATED_CONTEXTS = Object.freeze([
  {
    kind: 'old_plan',
    ref: 'lattice-research-campaign-1-v4',
    reason: 'v4 machine support was rejected by ADR 0022 and cannot receive v5 topology updates',
  },
  {
    kind: 'agent_context',
    ref: 'lattice-research-campaign-1-v4-agent-context',
    reason: 'v4 agent context admits behavior evidence without full snapshot and patch identity',
  },
  {
    kind: 'partial_patch',
    ref: 'lattice-research-campaign-1-v4-partial-patch',
    reason: 'patches based on v4 behavior summaries cannot cross the v5 version barrier',
  },
  {
    kind: 'interface_assumption',
    ref: 'receipt-reuse-is-behavior-evidence',
    reason: 'pre and post receipts must be distinct and exact-snapshot-bound in v5',
  },
]);
const CHECK_IDS = Object.freeze([
  'behavior_artifact_set',
  'exact_artifact_set',
  'canonical_payloads',
  'input_identity',
  'evidence_campaign',
  'compiler_replay',
  'transform_binding',
  'plan_diff_binding',
  'comparison_binding',
  'hypothesis_evaluation',
  'execution_evidence',
  'result_binding',
]);

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
  ...EVIDENCE_PATHS.map(([, runId]) => `evidence/${runId}.json`),
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
].sort());

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

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function sameArtifact(left, right) {
  try {
    return digestArtifact(left) === digestArtifact(right);
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8').equals(bytes)
      ? value
      : null;
  } catch {
    return null;
  }
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

function exactArtifactSet(options) {
  if (!exactRecord(options, ['manifest', 'payloads'])) return false;
  const payloads = payloadMap(options.payloads);
  const manifestPaths = Array.isArray(options.manifest?.files)
    ? options.manifest.files.map(({ path }) => path).sort()
    : [];
  const payloadPaths = payloads ? [...payloads.keys()].sort() : [];
  return sameArray(manifestPaths, EXPECTED_PATHS)
    && sameArray(payloadPaths, EXPECTED_PATHS);
}

function artifactContext(options) {
  if (!exactArtifactSet(options)) return null;
  const payloads = payloadMap(options.payloads);
  const json = new Map();
  for (const relativePath of EXPECTED_PATHS) {
    if (!relativePath.endsWith('.json')) continue;
    const parsed = parseJson(payloads.get(relativePath));
    if (parsed === null) return null;
    json.set(relativePath, parsed);
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

function evidenceBundles(context) {
  return EVIDENCE_PATHS.map(([, runId]) => context.json.get(`evidence/${runId}.json`));
}

function decodeRawEvidence(bundle) {
  const receipt = bundle.raw;
  const bytes = Buffer.from(receipt.payload_base64, 'base64');
  if (bytes.toString('base64') !== receipt.payload_base64
    || bytes.byteLength !== receipt.canonical_bytes
    || sha256(bytes) !== receipt.payload_digest) {
    throw new TypeError('RC1 v5 raw evidence receipt bytes are invalid');
  }
  const value = JSON.parse(bytes.toString('utf8'));
  if (canonicalizeArtifact(value) !== bytes.toString('utf8')) {
    throw new TypeError('RC1 v5 raw evidence receipt is not canonical');
  }
  return value;
}

function inputIdentityValid(context) {
  const inputs = fixedInputs(context);
  for (const value of Object.values(inputs)) canonicalizeArtifact(value);
  if (!validatePlanInput(inputs.planInput)
    || !validateRc1BlackBoxOracle(inputs.oracle)) {
    return false;
  }
  const queryDigest = digestArtifact(inputs.querySet);
  const bundles = evidenceBundles(context);
  const execution = context.json.get('execution-evidence.json');
  return sameArtifact(execution.fixed_inputs, fixedInputIdentity(inputs))
    && bundles.every((bundle) => bundle.query_set_digest === queryDigest
      && sameArtifact(bundle.query_set, inputs.querySet));
}

function evidenceCampaignValid(context) {
  const inputs = fixedInputs(context);
  const bundles = evidenceBundles(context);
  return validateRc1EvidenceCampaign(bundles)
    && EVIDENCE_PATHS.every(([condition, runId], index) => {
      const bundle = bundles[index];
      return validateRc1EvidenceBundle(bundle)
        && bundle.condition === condition
        && bundle.run_id === runId
        && sameArtifact(bundle.query_set, inputs.querySet)
        && recomputePortableAggregate(bundle.portable) === bundle.portable.aggregate_digest;
    });
}

function storedCompilation(context, condition, variant) {
  const root = `compiled/${condition}-${variant}`;
  const boundaryManifest = context.json.get(`${root}/boundary-manifest.json`);
  const boundaryVerdict = context.json.get(`${root}/boundary-verdict.json`);
  const planGraph = context.json.get(`${root}/plan.json`);
  const manifestDigest = digestArtifact(boundaryManifest);
  const verdictDigest = digestArtifact(boundaryVerdict);
  const planDigest = digestArtifact(planGraph);
  if (!validateBoundaryManifest(boundaryManifest)
    || !validateBoundaryVerdict(boundaryVerdict)
    || !validatePlanGraph(planGraph)
    || boundaryVerdict.boundary_manifest_digest !== manifestDigest
    || planGraph.source_manifest_digest !== manifestDigest) {
    throw new TypeError(`RC1 v5 stored ${condition}/${variant} compilation is invalid`);
  }
  return {
    boundary_manifest: boundaryManifest,
    boundary_manifest_digest: manifestDigest,
    boundary_verdict: boundaryVerdict,
    boundary_verdict_digest: verdictDigest,
    plan_graph: planGraph,
    plan_graph_digest: planDigest,
  };
}

function storedCompilations(context) {
  return Object.fromEntries(['control', 'treatment'].map((condition) => [
    condition,
    Object.fromEntries(['normal', 'negative'].map((variant) => [
      variant,
      storedCompilation(context, condition, variant),
    ])),
  ]));
}

function compilerReplayValid(context) {
  const inputs = fixedInputs(context);
  const execution = context.json.get('execution-evidence.json');
  const stored = storedCompilations(context);
  for (const [condition, runId] of EVIDENCE_PATHS) {
    const bundle = context.json.get(`evidence/${runId}.json`);
    const run = execution.runs?.[condition]?.find(({ run_id: id }) => id === runId);
    if (!run || !SHA256.test(run.code_snapshot_digest)) return false;
    const rawEvidence = decodeRawEvidence(bundle);
    for (const variant of ['normal', 'negative']) {
      const replay = compileBoundaryCondition({
        planInput: inputs.planInput,
        candidateSpec: inputs.candidateSpec,
        manualEvidence: variant === 'normal'
          ? inputs.normalManualEvidence
          : inputs.negativeManualEvidence,
        querySet: inputs.querySet,
        sensorEvidence: rawEvidence,
        codeSnapshotDigest: run.code_snapshot_digest,
        planVersion: `rc1-v5-${condition}${variant === 'negative' ? '-negative' : ''}`,
      });
      const expected = stored[condition][variant];
      if (!sameArtifact(replay.boundary_manifest, expected.boundary_manifest)
        || !sameArtifact(replay.boundary_verdict, expected.boundary_verdict)
        || !sameArtifact(replay.plan_graph, expected.plan_graph)
        || replay.boundary_manifest_digest !== expected.boundary_manifest_digest
        || replay.boundary_verdict_digest !== expected.boundary_verdict_digest
        || replay.plan_graph_digest !== expected.plan_graph_digest
        || replay.candidate_spec_digest !== digestArtifact(inputs.candidateSpec)) {
        return false;
      }
    }
  }
  return true;
}

function behaviorEvidence(context) {
  return {
    pre_receipt: context.json.get('behavior/pre-receipt.json'),
    post_receipt: context.json.get('behavior/post-receipt.json'),
    envelope: context.json.get('behavior/evidence-envelope.json'),
    transform_artifact: context.json.get('transform/transform-artifact.json'),
    patch_digest: sha256(context.patch),
  };
}

function transformResult(context) {
  const artifact = context.json.get('transform/transform-artifact.json');
  const receipt = context.json.get('transform/transform-receipt.json');
  return {
    artifact,
    artifact_digest: digestArtifact(artifact),
    receipt,
    receipt_digest: receipt.receipt_digest,
    patch: context.patch,
    behavior_evidence: behaviorEvidence(context),
  };
}

function sourceBindings(compiled, querySet) {
  return {
    boundary_manifest_digest: compiled.boundary_manifest_digest,
    boundary_verdict_digest: compiled.boundary_verdict_digest,
    control_plan_digest: compiled.plan_graph_digest,
    query_set_digest: digestArtifact(querySet),
  };
}

function transformReceiptValid(transform, inputs) {
  const receipt = transform.receipt;
  if (!exactRecord(receipt, [
    'schema',
    'status',
    'transform_artifact_digest',
    'behavior_envelope_digest',
    'fixed_inputs_digest',
    'source_invariant',
    'receipt_digest',
  ])
    || receipt.schema !== 'lattice.rc1.seam_transform_receipt.v5'
    || receipt.status !== 'accepted'
    || receipt.source_invariant?.outcome !== 'passed') {
    return false;
  }
  const { receipt_digest: ignored, ...preimage } = receipt;
  const artifact = transform.artifact;
  const bindings = {
    boundary_manifest_digest: artifact.source.boundary_manifest_digest,
    boundary_verdict_digest: artifact.source.boundary_verdict_digest,
    control_plan_digest: artifact.source.control_plan_digest,
    query_set_digest: artifact.source.query_set_digest,
  };
  const verifiers = artifact.verification.receipts.map(({ id, command, args }) => ({
    id,
    command,
    args,
  }));
  const fixedDigest = digestArtifact({
    candidate_id: artifact.candidate_id,
    allowed_paths: artifact.scope.allowed_paths,
    verifiers,
    oracle_digest: digestArtifact(inputs.oracle),
    source_bindings: bindings,
  });
  return SHA256.test(receipt.receipt_digest)
    && receipt.receipt_digest === digestArtifact(preimage)
    && receipt.transform_artifact_digest === transform.artifact_digest
    && receipt.behavior_envelope_digest === transform.behavior_evidence.envelope.envelope_digest
    && receipt.fixed_inputs_digest === fixedDigest;
}

function transformBindingValid(context) {
  const inputs = fixedInputs(context);
  const stored = storedCompilations(context);
  const transform = transformResult(context);
  const artifact = transform.artifact;
  const behavior = transform.behavior_evidence;
  const execution = context.json.get('execution-evidence.json');
  const expectedBindings = sourceBindings(stored.control.normal, inputs.querySet);
  return validateTransformArtifact(artifact)
    && artifact.status === 'accepted'
    && Object.entries(expectedBindings).every(([key, digest]) => artifact.source[key] === digest)
    && artifact.source.base_sha === context.manifest.base_sha
    && artifact.source.code_snapshot_digest === behavior.pre_receipt.surface_digest
    && artifact.patch.digest === sha256(context.patch)
    && artifact.patch.bytes === context.patch.byteLength
    && transform.artifact_digest === behavior.envelope.transform_artifact_digest
    && transform.artifact_digest === digestArtifact(behavior.transform_artifact)
    && transformReceiptValid(transform, inputs)
    && execution.transform?.artifact_digest === transform.artifact_digest
    && execution.transform?.receipt_digest === transform.receipt_digest
    && execution.transform?.patch_digest === artifact.patch.digest
    && execution.transform?.source_invariant_digest
      === digestArtifact(transform.receipt.source_invariant);
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

function expectedPlanDiff(context) {
  const stored = storedCompilations(context);
  const transform = transformResult(context);
  const control = compilationSummary(stored.control.normal);
  const treatment = compilationSummary(stored.treatment.normal);
  return {
    schema: 'lattice.plan_diff.v2',
    old_plan: {
      version: stored.control.normal.plan_graph.plan_version,
      digest: stored.control.normal.plan_graph_digest,
    },
    new_plan: {
      version: stored.treatment.normal.plan_graph.plan_version,
      digest: stored.treatment.normal.plan_graph_digest,
    },
    causal_predecessor: {
      plan_version: 'lattice-research-campaign-1-v4',
      decision_ref: 'docs/adr/0022-rc1-v4-phase-gate-rejection.md',
      status: 'phase_rejected',
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
      changed: stored.control.normal.plan_graph.nodes.map(({ id }) => id),
    },
    edges: {
      added: stored.treatment.normal.plan_graph.edges.map(({ id }) => id),
      removed: stored.control.normal.plan_graph.edges.map(({ id }) => id),
    },
    invalidated_contexts: structuredClone(INVALIDATED_CONTEXTS),
    metrics: {
      write_conflicts_before: control.write_conflicts,
      write_conflicts_after: treatment.write_conflicts,
      test_write_conflicts_before: control.test_write_conflicts,
      test_write_conflicts_after: treatment.test_write_conflicts,
      hard_precedence_before: control.hard_precedence,
      hard_precedence_after: treatment.hard_precedence,
      minimum_feasible_waves_before: control.minimum_feasible_waves,
      minimum_feasible_waves_after: treatment.minimum_feasible_waves,
    },
  };
}

function planDiffBindingValid(context) {
  return sameArtifact(context.json.get('plan-diff.json'), expectedPlanDiff(context));
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
          === 'lattice.sensor_sanitization_manifest.v1'
    )),
  };
}

function transformReceiptSelfValid(transform) {
  const receipt = transform.receipt;
  if (!exactRecord(receipt, [
    'schema',
    'status',
    'transform_artifact_digest',
    'behavior_envelope_digest',
    'fixed_inputs_digest',
    'source_invariant',
    'receipt_digest',
  ])) return false;
  const { receipt_digest: ignored, ...preimage } = receipt;
  return receipt.schema === 'lattice.rc1.seam_transform_receipt.v5'
    && receipt.status === 'accepted'
    && receipt.receipt_digest === digestArtifact(preimage)
    && transform.receipt_digest === receipt.receipt_digest;
}

function fixedInputsBound(transform, bindings, baseSha) {
  const behavior = transform.behavior_evidence;
  return transform.artifact.status === 'accepted'
    && Object.entries(bindings).every(([key, digest]) => transform.artifact.source[key] === digest)
    && transform.artifact.source.base_sha === baseSha
    && transform.artifact.source.code_snapshot_digest === behavior.pre_receipt.surface_digest
    && transform.artifact_digest === digestArtifact(transform.artifact)
    && transform.receipt.transform_artifact_digest === transform.artifact_digest
    && transform.receipt.behavior_envelope_digest === behavior.envelope.envelope_digest
    && transform.artifact.patch.digest === behavior.patch_digest
    && digestArtifact(behavior.transform_artifact) === transform.artifact_digest
    && transformReceiptSelfValid(transform);
}

function sourceInvariantState(context) {
  const execution = context.json.get('execution-evidence.json');
  return {
    control: execution.runs.control.every(({ source_invariant: receipt }) => (
      receipt?.outcome === 'passed'
    )),
    treatment: context.json.get('transform/transform-receipt.json').source_invariant?.outcome
      === 'passed'
      && execution.runs.treatment.every(({ source_invariant: receipt }) => (
        receipt?.outcome === 'passed'
      )),
  };
}

function expectedComparison(context) {
  const inputs = fixedInputs(context);
  const stored = storedCompilations(context);
  const bundles = evidenceBundles(context);
  const transform = transformResult(context);
  const planDiff = expectedPlanDiff(context);
  const sourceInvariant = sourceInvariantState(context);
  const fixed = fixedInputIdentity(inputs);
  const bindings = sourceBindings(stored.control.normal, inputs.querySet);
  return {
    schema: 'lattice.rc1.control_treatment_comparison.v3',
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
        source_digest: CURRENT_COMPILER_SOURCE_DIGEST,
      },
      treatment: {
        export_name: RC1_BOUNDARY_COMPILER_CONTRACT.export_name,
        source_digest: CURRENT_COMPILER_SOURCE_DIGEST,
      },
    },
    control: compilationSummary(stored.control.normal),
    treatment: compilationSummary(stored.treatment.normal),
    negative_control: compilationSummary(stored.control.negative),
    negative_treatment: compilationSummary(stored.treatment.negative),
    behavior: {
      evidence_envelope_digest: transform.behavior_evidence.envelope.envelope_digest,
    },
    evidence: {
      control: evidenceSummary(bundles.filter(({ condition }) => condition === 'control'), inputs.querySet),
      treatment: evidenceSummary(
        bundles.filter(({ condition }) => condition === 'treatment'),
        inputs.querySet,
      ),
    },
    predecessor: {
      transform_status: transform.artifact.status,
      same_base: transform.artifact.source.base_sha === context.manifest.base_sha,
      fixed_inputs_bound: fixedInputsBound(transform, bindings, context.manifest.base_sha),
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

function comparisonBindingValid(context) {
  return sameArtifact(context.json.get('comparison.json'), expectedComparison(context));
}

function hypothesisEvaluationValid(context) {
  const actual = context.json.get('hypothesis-evaluation.json');
  const expected = evaluateRc1V5Hypothesis({
    comparison: context.json.get('comparison.json'),
    behaviorEvidence: behaviorEvidence(context),
  });
  return sameArtifact(actual, expected);
}

function compilationDigests(condition) {
  return Object.fromEntries(['normal', 'negative'].map((variant) => [variant, {
    boundary_manifest: condition[variant].boundary_manifest_digest,
    boundary_verdict: condition[variant].boundary_verdict_digest,
    plan_graph: condition[variant].plan_graph_digest,
  }]));
}

function bundleDescriptorDigest(bundle) {
  return digestArtifact({
    schema: bundle.schema,
    condition: bundle.condition,
    run_id: bundle.run_id,
    query_set_digest: bundle.query_set_digest,
    component_digests: bundle.component_digests,
  });
}

function nonNegativeMilliseconds(value) {
  return Number.isFinite(value) && value >= 0;
}

function runEvidenceValid(context, condition, run, bundle, transformPatchDigest) {
  return exactRecord(run, [
    'run_id',
    'condition',
    'index_elapsed_ms',
    'query_elapsed_ms',
    'code_snapshot_digest',
    'raw_digest',
    'diagnostic_digest',
    'portable_digest',
    'bundle_descriptor_digest',
    'patch_digest',
    'source_invariant',
    'source_invariant_digest',
  ])
    && run.run_id === bundle.run_id
    && run.condition === condition
    && nonNegativeMilliseconds(run.index_elapsed_ms)
    && nonNegativeMilliseconds(run.query_elapsed_ms)
    && SHA256.test(run.code_snapshot_digest)
    && run.raw_digest === bundle.raw.payload_digest
    && run.diagnostic_digest === bundle.diagnostic.payload_digest
    && run.portable_digest === bundle.portable.aggregate_digest
    && run.bundle_descriptor_digest === bundleDescriptorDigest(bundle)
    && run.patch_digest === (condition === 'treatment' ? transformPatchDigest : null)
    && run.source_invariant?.outcome === 'passed'
    && run.source_invariant_digest === digestArtifact(run.source_invariant);
}

function executionEvidenceValid(context) {
  const execution = context.json.get('execution-evidence.json');
  const inputs = fixedInputs(context);
  const bundles = evidenceBundles(context);
  const stored = storedCompilations(context);
  const transform = transformResult(context);
  const planDiff = context.json.get('plan-diff.json');
  const comparison = context.json.get('comparison.json');
  const evaluation = context.json.get('hypothesis-evaluation.json');
  if (!exactRecord(execution, [
    'schema',
    'base_sha',
    'elapsed_ms',
    'compiler',
    'fixed_inputs',
    'runs',
    'transform',
    'behavior',
    'compilations',
    'plan_diff_digest',
    'comparison_digest',
    'hypothesis_evaluation_digest',
    'observed_facts',
  ])
    || execution.schema !== 'lattice.rc1.corrected_campaign_execution_evidence.v5'
    || execution.base_sha !== context.manifest.base_sha
    || !nonNegativeMilliseconds(execution.elapsed_ms)
    || !exactRecord(execution.compiler, [
      'export_name',
      'source_digest',
      'campaign_runner_source_digest',
    ])
    || execution.compiler.export_name !== RC1_BOUNDARY_COMPILER_CONTRACT.export_name
    || execution.compiler.source_digest !== CURRENT_COMPILER_SOURCE_DIGEST
    || execution.compiler.campaign_runner_source_digest !== CURRENT_CAMPAIGN_SOURCE_DIGEST
    || !sameArtifact(execution.fixed_inputs, fixedInputIdentity(inputs))
    || !exactRecord(execution.runs, ['control', 'treatment'])) {
    return false;
  }
  for (const condition of ['control', 'treatment']) {
    const conditionBundles = bundles.filter((bundle) => bundle.condition === condition);
    if (!Array.isArray(execution.runs[condition])
      || execution.runs[condition].length !== 2
      || !execution.runs[condition].every((run, index) => runEvidenceValid(
        context,
        condition,
        run,
        conditionBundles[index],
        transform.artifact.patch.digest,
      ))) {
      return false;
    }
  }
  const behavior = transform.behavior_evidence;
  const expectedFacts = {
    evidence_campaign_valid: true,
    compiler_reused: true,
    exact_patch_replayed: true,
    full_behavior_evidence_bound: true,
    source_invariant_passed: true,
    hypothesis_supported: evaluation.supported,
  };
  return exactRecord(execution.transform, [
    'elapsed_ms',
    'artifact_digest',
    'receipt_digest',
    'patch_digest',
    'source_invariant_digest',
  ])
    && nonNegativeMilliseconds(execution.transform.elapsed_ms)
    && sameArtifact({
      artifact_digest: execution.transform.artifact_digest,
      receipt_digest: execution.transform.receipt_digest,
      patch_digest: execution.transform.patch_digest,
      source_invariant_digest: execution.transform.source_invariant_digest,
    }, {
      artifact_digest: transform.artifact_digest,
      receipt_digest: transform.receipt_digest,
      patch_digest: transform.artifact.patch.digest,
      source_invariant_digest: digestArtifact(transform.receipt.source_invariant),
    })
    && sameArtifact(execution.behavior, {
      pre_receipt_digest: behavior.pre_receipt.receipt_digest,
      post_receipt_digest: behavior.post_receipt.receipt_digest,
      pre_surface_digest: behavior.pre_receipt.surface_digest,
      post_surface_digest: behavior.post_receipt.surface_digest,
      envelope_digest: behavior.envelope.envelope_digest,
    })
    && sameArtifact(execution.compilations, {
      control: compilationDigests(stored.control),
      treatment: compilationDigests(stored.treatment),
    })
    && execution.plan_diff_digest === digestArtifact(planDiff)
    && execution.comparison_digest === digestArtifact(comparison)
    && execution.hypothesis_evaluation_digest === digestArtifact(evaluation)
    && sameArtifact(execution.observed_facts, expectedFacts);
}

function resultBindingValid(context) {
  const execution = context.json.get('execution-evidence.json');
  const transform = context.json.get('transform/transform-artifact.json');
  const pre = context.json.get('behavior/pre-receipt.json');
  const post = context.json.get('behavior/post-receipt.json');
  const envelope = context.json.get('behavior/evidence-envelope.json');
  return GIT_SHA1.test(context.manifest.base_sha)
    && context.manifest.base_sha === execution.base_sha
    && context.manifest.base_sha === transform.source.base_sha
    && context.manifest.base_sha === pre.base_sha
    && context.manifest.base_sha === post.base_sha
    && context.manifest.base_sha === envelope.base_sha
    && context.manifest.result_digest === envelope.envelope_digest;
}

function safeCheck(callback) {
  try {
    return callback() === true;
  } catch {
    return false;
  }
}

const CURRENT_COMPILER_SOURCE_DIGEST = sha256(
  readFileSync(new URL('./boundary-compiler.mjs', import.meta.url)),
);
const CURRENT_CAMPAIGN_SOURCE_DIGEST = sha256(
  readFileSync(new URL('./rc1-v5-campaign.mjs', import.meta.url)),
);

/** 保存済みv5 payloadだけからclosed-loopの全因果cross-bindingを再検証する。 */
export function verifyRc1V5CampaignArtifactSet(options = {}) {
  const behaviorVerification = verifyRc1V5BehaviorArtifactSet(options);
  const exactSet = safeCheck(() => exactArtifactSet(options));
  const context = exactSet ? artifactContext(options) : null;
  const values = [
    behaviorVerification.valid,
    exactSet,
    context !== null,
    context !== null && safeCheck(() => inputIdentityValid(context)),
    context !== null && safeCheck(() => evidenceCampaignValid(context)),
    context !== null && safeCheck(() => compilerReplayValid(context)),
    context !== null && safeCheck(() => transformBindingValid(context)),
    context !== null && safeCheck(() => planDiffBindingValid(context)),
    context !== null && safeCheck(() => comparisonBindingValid(context)),
    context !== null && safeCheck(() => hypothesisEvaluationValid(context)),
    context !== null && safeCheck(() => executionEvidenceValid(context)),
    context !== null && safeCheck(() => resultBindingValid(context)),
  ];
  const checks = CHECK_IDS.map((id, index) => ({ id, passed: values[index] }));
  const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    schema: 'lattice.rc1.campaign_artifact_verification.v1',
    valid: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}
