import { isDeepStrictEqual } from 'node:util';

import { digestArtifact } from './artifact-contracts.mjs';
import { validateRc1BlackBoxOracle } from './rc1-black-box-oracle.mjs';
import { validateRc1EvidenceBundle } from './rc1-evidence-bundle.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const RECEIPT_KEYS = [
  'schema',
  'role',
  'base_sha',
  'oracle_digest',
  'entrypoint',
  'export_name',
  'entrypoint_content_digest',
  'surface',
  'surface_digest',
  'observation',
  'outcome',
  'case_results',
  'case_contract_digest',
  'runtime_identity',
  'runtime_identity_digest',
  'receipt_digest',
];

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

function repoPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

function verification(checks) {
  const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    schema: 'lattice.rc1.causal_binding_verification.v1',
    valid: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}

function safeDigest(value) {
  try {
    return digestArtifact(value);
  } catch {
    return null;
  }
}

function digestWithout(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { [field]: ignored, ...preimage } = value;
  return safeDigest(preimage);
}

function validRuntimeIdentity(value) {
  if (!exactRecord(value, [
    'schema',
    'node_version',
    'exec_argv',
    'environment',
    'executor_source_digest',
  ])
    || value.schema !== 'lattice.rc1.oracle_runtime_identity.v1'
    || typeof value.node_version !== 'string'
    || value.node_version.length === 0
    || value.node_version.length > 128
    || !Array.isArray(value.exec_argv)
    || value.exec_argv.length > 32
    || !value.exec_argv.every((entry) => typeof entry === 'string' && entry.length <= 1024)
    || value.environment === null
    || typeof value.environment !== 'object'
    || Array.isArray(value.environment)
    || Object.getPrototypeOf(value.environment) !== Object.prototype
    || Object.keys(value.environment).length > 32
    || !Object.entries(value.environment).every(([key, entry]) => (
      /^[A-Z][A-Z0-9_]{0,127}$/.test(key)
      && typeof entry === 'string'
      && entry.length <= 4096
    ))
    || !SHA256.test(value.executor_source_digest)) {
    return false;
  }
  return safeDigest(value) !== null;
}

function validCaseResult(value) {
  return exactRecord(value, [
    'id',
    'outcome',
    'observed_kind',
    'expected_digest',
    'observed_digest',
  ])
    && typeof value.id === 'string'
    && IDENTIFIER.test(value.id)
    && (value.outcome === 'passed' || value.outcome === 'failed')
    && (value.observed_kind === 'return' || value.observed_kind === 'throw')
    && SHA256.test(value.expected_digest)
    && SHA256.test(value.observed_digest);
}

function expectedCaseContract(oracle) {
  return oracle.cases.map(({ id, expected }) => ({
    id,
    expected_kind: expected.kind,
    expected_digest: digestArtifact(expected),
  }));
}

function caseSemanticsValid(caseResults, oracle) {
  if (!Array.isArray(caseResults) || caseResults.length !== oracle.cases.length) return false;
  return caseResults.every((result, index) => {
    if (!validCaseResult(result)) return false;
    const oracleCase = oracle.cases[index];
    const expectedDigest = digestArtifact(oracleCase.expected);
    if (result.id !== oracleCase.id
      || result.expected_digest !== expectedDigest
      || (result.outcome === 'passed' && (
        result.observed_kind !== oracleCase.expected.kind
        || result.observed_digest !== expectedDigest
      ))) {
      return false;
    }
    return true;
  });
}

function receiptShapeValid(receipt) {
  return exactRecord(receipt, RECEIPT_KEYS)
    && receipt.schema === 'lattice.rc1.black_box_behavior_receipt.v4'
    && (receipt.role === 'pre_transform' || receipt.role === 'post_transform')
    && GIT_SHA1.test(receipt.base_sha)
    && SHA256.test(receipt.oracle_digest)
    && repoPath(receipt.entrypoint)
    && typeof receipt.export_name === 'string'
    && IDENTIFIER.test(receipt.export_name)
    && SHA256.test(receipt.entrypoint_content_digest)
    && SHA256.test(receipt.surface_digest)
    && (receipt.outcome === 'passed' || receipt.outcome === 'failed')
    && SHA256.test(receipt.case_contract_digest)
    && SHA256.test(receipt.runtime_identity_digest)
    && SHA256.test(receipt.receipt_digest);
}

/**
 * 保存oracleと独立runtime期待値から、v6 behavior receiptのcase意味論を再計算する。
 */
export function verifyRc1V6BehaviorReceipt(options) {
  if (!exactRecord(options, [
    'receipt',
    'oracle',
    'expectedRole',
    'expectedRuntimeIdentity',
  ])) {
    return verification([{ id: 'input_contract', passed: false }]);
  }
  const {
    receipt,
    oracle,
    expectedRole,
    expectedRuntimeIdentity,
  } = options;
  const oracleValid = validateRc1BlackBoxOracle(oracle);
  const runtimeValid = validRuntimeIdentity(expectedRuntimeIdentity);
  const shapeValid = receiptShapeValid(receipt);
  const caseContract = oracleValid ? expectedCaseContract(oracle) : null;
  const caseSemantics = shapeValid && oracleValid
    ? caseSemanticsValid(receipt.case_results, oracle)
    : false;
  const recomputedOutcome = caseSemantics
    ? (receipt.case_results.every(({ outcome }) => outcome === 'passed') ? 'passed' : 'failed')
    : null;

  return verification([
    { id: 'oracle_contract', passed: oracleValid },
    { id: 'runtime_contract', passed: runtimeValid },
    { id: 'receipt_shape', passed: shapeValid },
    {
      id: 'receipt_role',
      passed: shapeValid
        && (expectedRole === 'pre_transform' || expectedRole === 'post_transform')
        && receipt.role === expectedRole,
    },
    {
      id: 'oracle_identity',
      passed: shapeValid && oracleValid
        && receipt.oracle_digest === safeDigest(oracle)
        && receipt.entrypoint === oracle.entrypoint
        && receipt.export_name === oracle.export_name,
    },
    {
      id: 'case_contract',
      passed: shapeValid && caseContract !== null
        && receipt.case_contract_digest === safeDigest(caseContract),
    },
    { id: 'case_semantics', passed: caseSemantics },
    {
      id: 'overall_outcome',
      passed: recomputedOutcome !== null && receipt.outcome === recomputedOutcome,
    },
    {
      id: 'runtime_identity',
      passed: shapeValid && runtimeValid
        && validRuntimeIdentity(receipt.runtime_identity)
        && receipt.runtime_identity_digest === safeDigest(receipt.runtime_identity)
        && isDeepStrictEqual(receipt.runtime_identity, expectedRuntimeIdentity),
    },
    {
      id: 'surface_identity',
      passed: shapeValid
        && receipt.surface_digest === safeDigest(receipt.surface)
        && exactRecord(receipt.observation, ['before_surface_digest', 'after_surface_digest'])
        && receipt.observation.before_surface_digest === receipt.surface_digest
        && receipt.observation.after_surface_digest === receipt.surface_digest,
    },
    {
      id: 'receipt_digest',
      passed: shapeValid && receipt.receipt_digest === digestWithout(receipt, 'receipt_digest'),
    },
  ]);
}

function validSourceSnapshot(value) {
  if (!exactRecord(value, ['schema', 'files'])
    || value.schema !== 'lattice.rc1.source_snapshot.v1'
    || !Array.isArray(value.files)
    || value.files.length === 0
    || value.files.length > 256) {
    return false;
  }
  const paths = new Set();
  for (const entry of value.files) {
    if (!exactRecord(entry, ['path', 'state', 'content_digest'])
      || !repoPath(entry.path)
      || paths.has(entry.path)
      || !['file', 'present', 'absent'].includes(entry.state)
      || (entry.state === 'absent'
        ? entry.content_digest !== null
        : typeof entry.content_digest !== 'string' || !SHA256.test(entry.content_digest))) {
      return false;
    }
    paths.add(entry.path);
  }
  return value.files.every(({ path }, index) => index === 0 || value.files[index - 1].path < path);
}

function validCodegraphIdentity(value) {
  return exactRecord(value, [
    'schema',
    'version',
    'executable_ref',
    'executable_digest',
  ])
    && value.schema === 'lattice.rc1.codegraph_identity.v1'
    && typeof value.version === 'string'
    && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value.version)
    // `codegraph` is accepted only as an immutable pre-cutover artifact value.
    // New captures always emit `lattice-sensor`.
    && (value.executable_ref === 'lattice-sensor' || value.executable_ref === 'codegraph')
    && SHA256.test(value.executable_digest);
}

function baseEvidenceBundle(bundle) {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) return null;
  const { measurement: ignoredMeasurement, measurement_digest: ignoredDigest, ...base } = bundle;
  return { ...base, schema: 'lattice.rc1.evidence_bundle.v1' };
}

export function createRc1V6EvidenceBundleDescriptor(bundle) {
  return {
    schema: 'lattice.rc1.evidence_bundle_descriptor.v1',
    condition: bundle.condition,
    run_id: bundle.run_id,
    query_set_digest: bundle.query_set_digest,
    raw_digest: bundle.raw.payload_digest,
    diagnostic_payload_digest: bundle.diagnostic.payload_digest,
    sanitization_manifest_digest: bundle.diagnostic.sanitization_manifest_digest,
    portable_digest: bundle.portable.aggregate_digest,
    measurement_digest: bundle.measurement_digest,
  };
}

/**
 * v6 Codegraph runを、独立したsource／tool期待値と保存raw evidenceへcross-bindする。
 */
export function verifyRc1V6RunEvidence(options) {
  if (!exactRecord(options, ['run', 'bundle', 'expected'])) {
    return verification([{ id: 'input_contract', passed: false }]);
  }
  const { run, bundle, expected } = options;
  const runValid = exactRecord(run, [
    'schema',
    'condition',
    'run_id',
    'evidence_bundle_descriptor_digest',
    'measurement_digest',
  ])
    && run.schema === 'lattice.rc1.condition_run.v2'
    && (run.condition === 'control' || run.condition === 'treatment')
    && typeof run.run_id === 'string'
    && IDENTIFIER.test(run.run_id)
    && SHA256.test(run.evidence_bundle_descriptor_digest)
    && SHA256.test(run.measurement_digest);
  const bundleValid = exactRecord(bundle, [
    'schema',
    'condition',
    'run_id',
    'query_set',
    'query_set_digest',
    'raw',
    'diagnostic',
    'portable',
    'component_digests',
    'measurement',
    'measurement_digest',
  ])
    && bundle.schema === 'lattice.rc1.evidence_bundle.v2'
    && validateRc1EvidenceBundle(baseEvidenceBundle(bundle));
  const expectedValid = exactRecord(expected, [
    'base_sha',
    'patch_digest',
    'snapshot',
    'codegraph_identity',
    'query_set_digest',
  ])
    && GIT_SHA1.test(expected.base_sha)
    && (expected.patch_digest === null
      || (typeof expected.patch_digest === 'string' && SHA256.test(expected.patch_digest)))
    && validSourceSnapshot(expected.snapshot)
    && validCodegraphIdentity(expected.codegraph_identity)
    && SHA256.test(expected.query_set_digest);
  const measurement = bundleValid ? bundle.measurement : null;
  const measurementValid = exactRecord(measurement, [
    'schema',
    'base_sha',
    'patch_digest',
    'snapshot',
    'snapshot_digest',
    'codegraph_identity',
    'codegraph_identity_digest',
    'query_set_digest',
    'raw_evidence_digest',
  ])
    && measurement.schema === 'lattice.rc1.codegraph_measurement.v1'
    && GIT_SHA1.test(measurement.base_sha)
    && (measurement.patch_digest === null
      || (typeof measurement.patch_digest === 'string' && SHA256.test(measurement.patch_digest)))
    && validSourceSnapshot(measurement.snapshot)
    && SHA256.test(measurement.snapshot_digest)
    && validCodegraphIdentity(measurement.codegraph_identity)
    && SHA256.test(measurement.codegraph_identity_digest)
    && SHA256.test(measurement.query_set_digest)
    && SHA256.test(measurement.raw_evidence_digest);

  return verification([
    { id: 'run_contract', passed: runValid },
    { id: 'bundle_contract', passed: bundleValid },
    { id: 'expected_contract', passed: expectedValid },
    { id: 'measurement_contract', passed: measurementValid },
    {
      id: 'run_bundle_identity',
      passed: runValid && bundleValid
        && run.condition === bundle.condition
        && run.run_id === bundle.run_id
        && run.evidence_bundle_descriptor_digest
          === safeDigest(createRc1V6EvidenceBundleDescriptor(bundle))
        && run.measurement_digest === bundle.measurement_digest,
    },
    {
      id: 'measurement_digest',
      passed: bundleValid && measurementValid
        && bundle.measurement_digest === safeDigest(measurement),
    },
    {
      id: 'snapshot_identity',
      passed: measurementValid && expectedValid
        && measurement.snapshot_digest === safeDigest(measurement.snapshot)
        && isDeepStrictEqual(measurement.snapshot, expected.snapshot),
    },
    {
      id: 'codegraph_identity',
      passed: measurementValid && expectedValid
        && measurement.codegraph_identity_digest === safeDigest(measurement.codegraph_identity)
        && isDeepStrictEqual(measurement.codegraph_identity, expected.codegraph_identity),
    },
    {
      id: 'source_projection',
      passed: measurementValid && expectedValid
        && measurement.base_sha === expected.base_sha
        && measurement.patch_digest === expected.patch_digest,
    },
    {
      id: 'query_identity',
      passed: measurementValid && expectedValid && bundleValid
        && measurement.query_set_digest === bundle.query_set_digest
        && measurement.query_set_digest === expected.query_set_digest,
    },
    {
      id: 'raw_evidence_identity',
      passed: measurementValid && bundleValid
        && measurement.raw_evidence_digest === bundle.raw.payload_digest,
    },
  ]);
}

function validPredecessor(value) {
  return exactRecord(value, ['kind', 'ref', 'digest'])
    && [
      'rejected_plan_archive',
      'phase_decision',
      'accepted_transform',
      'behavior_envelope',
      'evidence_bundle',
    ].includes(value.kind)
    && repoPath(value.ref)
    && SHA256.test(value.digest);
}

/**
 * v6 plan diffが持つcausal predecessorを、呼出側が実bytesから導出した完全列へ照合する。
 */
export function verifyRc1V6PlanPredecessors(options) {
  if (!exactRecord(options, ['planDiff', 'expectedPredecessors'])) {
    return verification([{ id: 'input_contract', passed: false }]);
  }
  const { planDiff, expectedPredecessors } = options;
  const expectedValid = Array.isArray(expectedPredecessors)
    && expectedPredecessors.length === 8
    && expectedPredecessors.every(validPredecessor)
    && new Set(expectedPredecessors.map(({ kind, ref }) => `${kind}:${ref}`)).size === 8
    && expectedPredecessors.filter(({ kind }) => kind === 'rejected_plan_archive').length === 1
    && expectedPredecessors.filter(({ kind }) => kind === 'phase_decision').length === 1
    && expectedPredecessors.filter(({ kind }) => kind === 'accepted_transform').length === 1
    && expectedPredecessors.filter(({ kind }) => kind === 'behavior_envelope').length === 1
    && expectedPredecessors.filter(({ kind }) => kind === 'evidence_bundle').length === 4;
  const planValid = planDiff !== null
    && typeof planDiff === 'object'
    && !Array.isArray(planDiff)
    && Object.getPrototypeOf(planDiff) === Object.prototype
    && planDiff.schema === 'lattice.plan_diff.v3'
    && !Object.hasOwn(planDiff, 'causal_predecessor')
    && Array.isArray(planDiff.causal_predecessors)
    && planDiff.causal_predecessors.length === 8
    && planDiff.causal_predecessors.every(validPredecessor);

  return verification([
    { id: 'expected_predecessor_contract', passed: expectedValid },
    { id: 'plan_diff_contract', passed: planValid },
    {
      id: 'exact_predecessor_set',
      passed: expectedValid && planValid
        && isDeepStrictEqual(planDiff.causal_predecessors, expectedPredecessors),
    },
  ]);
}
