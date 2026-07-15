import { isDeepStrictEqual } from 'node:util';

import {
  digestArtifact,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { verifyRc1V6BehaviorReceipt } from './rc1-v6-causal-binding.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const ENVELOPE_KEYS = [
  'schema',
  'base_sha',
  'oracle_digest',
  'runtime_identity_digest',
  'case_contract_digest',
  'pre_receipt_digest',
  'post_receipt_digest',
  'pre_surface_digest',
  'post_surface_digest',
  'transform_artifact_digest',
  'patch_digest',
  'output_snapshot_digest',
  'envelope_digest',
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
    schema: 'lattice.rc1.behavior_evidence_verification.v1',
    valid: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}

function digestWithout(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const { [field]: ignored, ...preimage } = value;
    return digestArtifact(preimage);
  } catch {
    return null;
  }
}

function validSurface(value) {
  if (!exactRecord(value, ['schema', 'files'])
    || value.schema !== 'lattice.rc1.behavior_surface_snapshot.v1'
    || !Array.isArray(value.files)
    || value.files.length === 0
    || value.files.length > 128) {
    return false;
  }
  return value.files.every((file, index) => (
    exactRecord(file, ['path', 'state', 'content_digest'])
      && repoPath(file.path)
      && (index === 0 || value.files[index - 1].path < file.path)
      && (file.state === 'present' || file.state === 'absent')
      && (file.state === 'present'
        ? typeof file.content_digest === 'string' && SHA256.test(file.content_digest)
        : file.content_digest === null)
  ));
}

function validAcceptedTransform(value) {
  return validateTransformArtifact(value)
    && value.status === 'accepted'
    && GIT_SHA1.test(value.source?.base_sha)
    && SHA256.test(value.source?.code_snapshot_digest)
    && SHA256.test(value.patch?.digest)
    && Array.isArray(value.scope?.allowed_paths)
    && value.scope.allowed_paths.length > 0
    && Array.isArray(value.output?.files)
    && value.output.files.length > 0
    && SHA256.test(value.output?.snapshot_digest)
    && value.output.snapshot_digest === digestArtifact({ files: value.output.files });
}

function surfacePaths(surface) {
  return validSurface(surface) ? surface.files.map(({ path }) => path) : [];
}

function outputProjection(surface) {
  if (!validSurface(surface) || surface.files.some(({ state }) => state !== 'present')) return null;
  return {
    files: surface.files.map(({ path, content_digest: contentDigest }) => ({
      path,
      content_digest: contentDigest,
    })),
  };
}

function envelopeValid(value) {
  return exactRecord(value, ENVELOPE_KEYS)
    && value.schema === 'lattice.rc1.behavior_evidence_envelope.v2'
    && GIT_SHA1.test(value.base_sha)
    && [
      value.oracle_digest,
      value.runtime_identity_digest,
      value.case_contract_digest,
      value.pre_receipt_digest,
      value.post_receipt_digest,
      value.pre_surface_digest,
      value.post_surface_digest,
      value.transform_artifact_digest,
      value.patch_digest,
      value.output_snapshot_digest,
      value.envelope_digest,
    ].every((entry) => typeof entry === 'string' && SHA256.test(entry))
    && value.envelope_digest === digestWithout(value, 'envelope_digest');
}

function behaviorChecks(options) {
  const inputValid = exactRecord(options, [
    'oracle',
    'runtimeIdentity',
    'preReceipt',
    'postReceipt',
    'transformArtifact',
    'patchDigest',
    'envelope',
  ]);
  const oracle = inputValid ? options.oracle : null;
  const runtimeIdentity = inputValid ? options.runtimeIdentity : null;
  const pre = inputValid ? options.preReceipt : null;
  const post = inputValid ? options.postReceipt : null;
  const transform = inputValid ? options.transformArtifact : null;
  const patchDigest = inputValid ? options.patchDigest : null;
  const envelope = inputValid ? options.envelope : null;
  const preVerification = inputValid ? verifyRc1V6BehaviorReceipt({
    receipt: pre,
    oracle,
    expectedRole: 'pre_transform',
    expectedRuntimeIdentity: runtimeIdentity,
  }) : { valid: false };
  const postVerification = inputValid ? verifyRc1V6BehaviorReceipt({
    receipt: post,
    oracle,
    expectedRole: 'post_transform',
    expectedRuntimeIdentity: runtimeIdentity,
  }) : { valid: false };
  const receiptsValid = preVerification.valid && postVerification.valid;
  const transformValid = inputValid && validAcceptedTransform(transform);
  const validEnvelope = inputValid && envelopeValid(envelope);
  const preSurfaceValid = receiptsValid && validSurface(pre.surface);
  const postSurfaceValid = receiptsValid && validSurface(post.surface);
  const prePaths = preSurfaceValid ? surfacePaths(pre.surface) : [];
  const postPaths = postSurfaceValid ? surfacePaths(post.surface) : [];
  const projection = postSurfaceValid ? outputProjection(post.surface) : null;
  const outputBound = transformValid
    && projection !== null
    && isDeepStrictEqual(prePaths, postPaths)
    && isDeepStrictEqual(postPaths, transform.scope.allowed_paths)
    && digestArtifact(projection) === transform.output.snapshot_digest
    && digestArtifact(projection.files) === digestArtifact(transform.output.files);

  return [
    { id: 'input_contract', passed: inputValid },
    { id: 'pre_receipt', passed: preVerification.valid },
    { id: 'post_receipt', passed: postVerification.valid },
    { id: 'envelope_contract', passed: validEnvelope },
    { id: 'transform_contract', passed: transformValid },
    {
      id: 'base_binding',
      passed: receiptsValid && transformValid
        && pre.base_sha === post.base_sha
        && pre.base_sha === transform.source.base_sha,
    },
    {
      id: 'oracle_runtime_binding',
      passed: receiptsValid
        && pre.oracle_digest === post.oracle_digest
        && pre.runtime_identity_digest === post.runtime_identity_digest
        && pre.case_contract_digest === post.case_contract_digest,
    },
    {
      id: 'behavior_outcome',
      passed: receiptsValid && pre.outcome === 'passed' && post.outcome === 'passed',
    },
    {
      id: 'pre_source_binding',
      passed: preSurfaceValid && transformValid
        && pre.surface_digest === transform.source.code_snapshot_digest,
    },
    { id: 'post_output_binding', passed: outputBound },
    {
      id: 'patch_binding',
      passed: transformValid
        && typeof patchDigest === 'string'
        && SHA256.test(patchDigest)
        && patchDigest === transform.patch.digest,
    },
    {
      id: 'envelope_binding',
      passed: receiptsValid && transformValid && validEnvelope && outputBound
        && envelope.base_sha === pre.base_sha
        && envelope.oracle_digest === pre.oracle_digest
        && envelope.runtime_identity_digest === pre.runtime_identity_digest
        && envelope.case_contract_digest === pre.case_contract_digest
        && envelope.pre_receipt_digest === pre.receipt_digest
        && envelope.post_receipt_digest === post.receipt_digest
        && envelope.pre_surface_digest === pre.surface_digest
        && envelope.post_surface_digest === post.surface_digest
        && envelope.transform_artifact_digest === digestArtifact(transform)
        && envelope.patch_digest === patchDigest
        && envelope.output_snapshot_digest === transform.output.snapshot_digest,
    },
  ];
}

/** v6 full receiptsをsaved oracle、runtime、accepted transformへcross-bindする。 */
export function compileRc1V6BehaviorEvidence(options = {}) {
  if (!exactRecord(options, [
    'oracle',
    'runtimeIdentity',
    'preReceipt',
    'postReceipt',
    'transformArtifact',
    'patchDigest',
  ])) {
    throw new TypeError('RC1 v6 behavior evidence契約違反: input shapeが不正');
  }
  const preimage = {
    schema: 'lattice.rc1.behavior_evidence_envelope.v2',
    base_sha: options.preReceipt?.base_sha,
    oracle_digest: options.preReceipt?.oracle_digest,
    runtime_identity_digest: options.preReceipt?.runtime_identity_digest,
    case_contract_digest: options.preReceipt?.case_contract_digest,
    pre_receipt_digest: options.preReceipt?.receipt_digest,
    post_receipt_digest: options.postReceipt?.receipt_digest,
    pre_surface_digest: options.preReceipt?.surface_digest,
    post_surface_digest: options.postReceipt?.surface_digest,
    transform_artifact_digest: digestArtifact(options.transformArtifact),
    patch_digest: options.patchDigest,
    output_snapshot_digest: options.transformArtifact?.output?.snapshot_digest,
  };
  const envelope = { ...preimage, envelope_digest: digestArtifact(preimage) };
  const result = verifyRc1V6BehaviorEvidence({ ...options, envelope });
  if (!result.valid) {
    throw new TypeError(
      `RC1 v6 behavior evidence契約違反: cross-binding failed: ${result.failed_conditions.join(', ')}`,
    );
  }
  return envelope;
}

/** 保存artifactだけからv6 behavior evidenceの全cross-bindingを再計算する。 */
export function verifyRc1V6BehaviorEvidence(options = {}) {
  return verification(behaviorChecks(options));
}
