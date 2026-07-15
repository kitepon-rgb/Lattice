import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  canonicalizeArtifact,
  digestArtifact,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { evaluateRc1Hypothesis } from './rc1-comparison.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const REQUIRED_BEHAVIOR_PATHS = Object.freeze([
  'behavior/evidence-envelope.json',
  'behavior/post-receipt.json',
  'behavior/pre-receipt.json',
  'transform/seam.patch',
  'transform/transform-artifact.json',
].sort());
const RECEIPT_KEYS = Object.freeze([
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
  'receipt_digest',
]);
const ENVELOPE_KEYS = Object.freeze([
  'schema',
  'base_sha',
  'oracle_digest',
  'pre_receipt_digest',
  'post_receipt_digest',
  'pre_surface_digest',
  'post_surface_digest',
  'transform_artifact_digest',
  'patch_digest',
  'output_snapshot_digest',
  'envelope_digest',
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

function repoPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, 'utf8') <= 1_024
    && !CONTROL_CHARACTER.test(value)
    && !path.posix.isAbsolute(value)
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.includes('\\')
    && !/^[A-Za-z]:/.test(value)
    && value.split('/').every((segment) => (
      segment !== '' && segment !== '.' && segment !== '..'
    ));
}

function digest(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function uniqueSortedStrings(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  const sorted = [...values].sort();
  return values.every((value, index) => (
    typeof value === 'string'
      && value === sorted[index]
      && (index === 0 || value !== values[index - 1])
  ));
}

function artifactDigestWithout(value, digestKey) {
  const { [digestKey]: ignored, ...preimage } = value;
  return digestArtifact(preimage);
}

function validateSurface(value) {
  try {
    if (!exactRecord(value, ['schema', 'files'])
      || value.schema !== 'lattice.rc1.behavior_surface_snapshot.v1'
      || !Array.isArray(value.files)
      || value.files.length === 0
      || value.files.length > 128) {
      return false;
    }
    const paths = value.files.map(({ path: filePath }) => filePath);
    if (!uniqueSortedStrings(paths)) return false;
    for (const file of value.files) {
      if (!exactRecord(file, ['path', 'state', 'content_digest'])
        || !repoPath(file.path)
        || (file.state !== 'present' && file.state !== 'absent')
        || (file.state === 'present' && !digest(file.content_digest))
        || (file.state === 'absent' && file.content_digest !== null)) {
        return false;
      }
    }
    canonicalizeArtifact(value);
    return true;
  } catch {
    return false;
  }
}

function validateCaseResult(value) {
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
    && digest(value.expected_digest)
    && digest(value.observed_digest);
}

function validateReceipt(value) {
  if (!exactRecord(value, RECEIPT_KEYS)
    || value.schema !== 'lattice.rc1.black_box_behavior_receipt.v3'
    || (value.role !== 'pre' && value.role !== 'post')
    || !GIT_SHA1.test(value.base_sha)
    || !digest(value.oracle_digest)
    || !repoPath(value.entrypoint)
    || typeof value.export_name !== 'string'
    || !IDENTIFIER.test(value.export_name)
    || !digest(value.entrypoint_content_digest)
    || !validateSurface(value.surface)
    || !digest(value.surface_digest)
    || value.surface_digest !== digestArtifact(value.surface)
    || !exactRecord(value.observation, [
      'before_surface_digest',
      'after_surface_digest',
    ])
    || value.observation.before_surface_digest !== value.surface_digest
    || value.observation.after_surface_digest !== value.surface_digest
    || (value.outcome !== 'passed' && value.outcome !== 'failed')
    || !Array.isArray(value.case_results)
    || value.case_results.length === 0
    || value.case_results.length > 64
    || !value.case_results.every(validateCaseResult)
    || new Set(value.case_results.map(({ id }) => id)).size !== value.case_results.length
    || (value.outcome === 'passed') !== value.case_results.every(({ outcome }) => outcome === 'passed')
    || !digest(value.receipt_digest)
    || value.receipt_digest !== artifactDigestWithout(value, 'receipt_digest')) {
    return false;
  }
  const entrypoint = value.surface.files.find(({ path: filePath }) => filePath === value.entrypoint);
  return entrypoint?.state === 'present'
    && entrypoint.content_digest === value.entrypoint_content_digest;
}

/** @param {unknown} value @returns {boolean} */
export function validateRc1V5BehaviorSurface(value) {
  return validateSurface(value);
}

/** @param {unknown} value @returns {boolean} */
export function validateRc1V5BehaviorReceipt(value) {
  return validateReceipt(value);
}

function validateEnvelope(value) {
  return exactRecord(value, ENVELOPE_KEYS)
    && value.schema === 'lattice.rc1.behavior_evidence_envelope.v1'
    && GIT_SHA1.test(value.base_sha)
    && [
      value.oracle_digest,
      value.pre_receipt_digest,
      value.post_receipt_digest,
      value.pre_surface_digest,
      value.post_surface_digest,
      value.transform_artifact_digest,
      value.patch_digest,
      value.output_snapshot_digest,
      value.envelope_digest,
    ].every(digest)
    && value.envelope_digest === artifactDigestWithout(value, 'envelope_digest');
}

function surfacePaths(surface) {
  return validateSurface(surface) ? surface.files.map(({ path: filePath }) => filePath) : [];
}

function outputProjection(surface) {
  if (!validateSurface(surface) || surface.files.some(({ state }) => state !== 'present')) {
    return null;
  }
  return {
    files: surface.files.map(({ path: filePath, content_digest: contentDigest }) => ({
      path: filePath,
      content_digest: contentDigest,
    })),
  };
}

function validAcceptedTransform(value) {
  if (!validateTransformArtifact(value)
    || value.status !== 'accepted'
    || !GIT_SHA1.test(value.source?.base_sha)
    || !digest(value.patch?.digest)
    || !digest(value.output?.snapshot_digest)
    || !Array.isArray(value.output?.files)
    || value.output.files.length === 0) {
    return false;
  }
  const paths = value.output.files.map(({ path: filePath }) => filePath);
  return uniqueSortedStrings(paths)
    && value.output.files.every((file) => (
      exactRecord(file, ['path', 'content_digest'])
        && repoPath(file.path)
        && digest(file.content_digest)
    ))
    && value.output.snapshot_digest === digestArtifact({ files: value.output.files });
}

function behaviorBindingChecks(value) {
  const validInput = exactRecord(value, [
    'pre_receipt',
    'post_receipt',
    'envelope',
    'transform_artifact',
    'patch_digest',
  ]);
  const pre = validInput ? value.pre_receipt : null;
  const post = validInput ? value.post_receipt : null;
  const envelope = validInput ? value.envelope : null;
  const transform = validInput ? value.transform_artifact : null;
  const patchDigest = validInput ? value.patch_digest : null;
  const preValid = validateReceipt(pre);
  const postValid = validateReceipt(post);
  const envelopeValid = validateEnvelope(envelope);
  const transformValid = validAcceptedTransform(transform);
  const prePaths = preValid ? surfacePaths(pre.surface) : [];
  const postPaths = postValid ? surfacePaths(post.surface) : [];
  const projection = postValid ? outputProjection(post.surface) : null;
  const preSourceBound = preValid
    && transformValid
    && pre.surface_digest === transform.source.code_snapshot_digest;
  const outputBound = transformValid
    && projection !== null
    && sameArray(prePaths, postPaths)
    && sameArray(postPaths, transform.scope.allowed_paths)
    && digestArtifact(projection) === transform.output.snapshot_digest
    && digestArtifact(projection.files) === digestArtifact(transform.output.files);

  return [
    { id: 'receipt_schema', passed: preValid && postValid },
    {
      id: 'receipt_identity',
      passed: preValid && postValid
        && pre.role === 'pre'
        && post.role === 'post'
        && pre.receipt_digest !== post.receipt_digest,
    },
    {
      id: 'base_binding',
      passed: preValid && postValid && transformValid
        && pre.base_sha === post.base_sha
        && pre.base_sha === transform.source.base_sha,
    },
    { id: 'pre_source_binding', passed: preSourceBound },
    {
      id: 'oracle_binding',
      passed: preValid && postValid
        && pre.oracle_digest === post.oracle_digest
        && pre.entrypoint === post.entrypoint
        && pre.export_name === post.export_name,
    },
    {
      id: 'behavior_outcome',
      passed: preValid && postValid && pre.outcome === 'passed' && post.outcome === 'passed',
    },
    {
      id: 'surface_binding',
      passed: preValid && postValid && sameArray(prePaths, postPaths),
    },
    {
      id: 'transform_binding',
      passed: transformValid && envelopeValid
        && envelope.transform_artifact_digest === digestArtifact(transform),
    },
    {
      id: 'patch_binding',
      passed: transformValid && envelopeValid && digest(patchDigest)
        && patchDigest === transform.patch.digest
        && patchDigest === envelope.patch_digest,
    },
    { id: 'post_output_binding', passed: outputBound },
    {
      id: 'envelope_binding',
      passed: preValid && postValid && transformValid && envelopeValid && outputBound
        && envelope.base_sha === pre.base_sha
        && envelope.oracle_digest === pre.oracle_digest
        && envelope.pre_receipt_digest === pre.receipt_digest
        && envelope.post_receipt_digest === post.receipt_digest
        && envelope.pre_surface_digest === pre.surface_digest
        && envelope.post_surface_digest === post.surface_digest
        && envelope.output_snapshot_digest === transform.output.snapshot_digest,
    },
  ];
}

function fail(reason) {
  throw new TypeError(`RC1 v5 behavior evidence契約違反: ${reason}`);
}

/**
 * full pre／post receiptをaccepted transformとpatchへcross-bindする。
 */
export function compileRc1V5BehaviorEvidence(options = {}) {
  if (!exactRecord(options, [
    'preReceipt',
    'postReceipt',
    'transformArtifact',
    'patchDigest',
  ])) {
    fail('input shapeが不正');
  }
  const {
    preReceipt,
    postReceipt,
    transformArtifact,
    patchDigest,
  } = options;
  if (!validateReceipt(preReceipt) || !validateReceipt(postReceipt)) fail('full receiptが不正');
  if (!validAcceptedTransform(transformArtifact)) fail('accepted transform artifactが不正');
  if (!digest(patchDigest) || patchDigest !== transformArtifact.patch.digest) {
    fail('patch digestがaccepted transformと不一致');
  }
  const preimage = {
    schema: 'lattice.rc1.behavior_evidence_envelope.v1',
    base_sha: preReceipt.base_sha,
    oracle_digest: preReceipt.oracle_digest,
    pre_receipt_digest: preReceipt.receipt_digest,
    post_receipt_digest: postReceipt.receipt_digest,
    pre_surface_digest: preReceipt.surface_digest,
    post_surface_digest: postReceipt.surface_digest,
    transform_artifact_digest: digestArtifact(transformArtifact),
    patch_digest: patchDigest,
    output_snapshot_digest: transformArtifact.output.snapshot_digest,
  };
  const envelope = { ...preimage, envelope_digest: digestArtifact(preimage) };
  const checks = behaviorBindingChecks({
    pre_receipt: preReceipt,
    post_receipt: postReceipt,
    envelope,
    transform_artifact: transformArtifact,
    patch_digest: patchDigest,
  });
  const failed = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  if (failed.length > 0) fail(`cross-binding failed: ${failed.join(', ')}`);
  return envelope;
}

function failedEvaluation() {
  const checks = [
    'schema',
    'compiler_identity',
    'fixed_inputs',
    'control_conflict',
    'test_write_conflicts',
    'treatment_parallel',
    'unknowns',
    'hard_precedence',
    'negative_state',
    'behavior_binding',
    'portable_preimages',
    'sanitized_diagnostics',
    'predecessor',
    'version_barrier',
    'source_invariant',
  ].map((id) => ({ id, passed: false }));
  return {
    schema: 'lattice.rc1.hypothesis_evaluation.v3',
    supported: false,
    checks,
    failed_conditions: checks.map(({ id }) => id),
  };
}

/**
 * comparison summaryのbehavior自己申告を使わず、underlying artifactからv5仮説を再評価する。
 */
export function evaluateRc1V5Hypothesis(options = {}) {
  try {
    if (!exactRecord(options, ['comparison', 'behaviorEvidence'])
      || !isPlainObject(options.comparison)) {
      return failedEvaluation();
    }
    const { comparison, behaviorEvidence } = options;
    const behaviorChecks = behaviorBindingChecks(behaviorEvidence);
    const envelope = isPlainObject(behaviorEvidence) ? behaviorEvidence.envelope : null;
    const comparisonBound = comparison.schema === 'lattice.rc1.control_treatment_comparison.v3'
      && exactRecord(comparison.behavior, ['evidence_envelope_digest'])
      && validateEnvelope(envelope)
      && comparison.behavior.evidence_envelope_digest === envelope.envelope_digest;
    const behaviorPassed = comparisonBound && behaviorChecks.every(({ passed }) => passed);
    const projection = structuredClone(comparison);
    projection.schema = 'lattice.rc1.control_treatment_comparison.v2';
    projection.behavior = {
      control: {
        outcome: behaviorPassed ? 'passed' : 'failed',
        oracle_digest: behaviorEvidence?.pre_receipt?.oracle_digest ?? null,
      },
      treatment: {
        outcome: behaviorPassed ? 'passed' : 'failed',
        oracle_digest: behaviorEvidence?.post_receipt?.oracle_digest ?? null,
      },
    };
    const v4 = evaluateRc1Hypothesis(projection);
    const checks = v4.checks.map((check) => {
      if (check.id === 'schema') {
        return { id: 'schema', passed: comparison.schema === 'lattice.rc1.control_treatment_comparison.v3' };
      }
      if (check.id === 'behavior') return { id: 'behavior_binding', passed: behaviorPassed };
      return check;
    });
    const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
    return {
      schema: 'lattice.rc1.hypothesis_evaluation.v3',
      supported: failedConditions.length === 0,
      checks,
      failed_conditions: failedConditions,
    };
  } catch {
    return failedEvaluation();
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateManifest(value) {
  try {
    canonicalizeArtifact(value);
  } catch {
    return false;
  }
  if (!exactRecord(value, ['schema', 'base_sha', 'result_digest', 'files'])
      || value.schema !== 'lattice.rc1.artifact_manifest.v5'
      || !GIT_SHA1.test(value.base_sha)
      || !digest(value.result_digest)
      || !Array.isArray(value.files)
      || value.files.length === 0) {
    return false;
  }
  const paths = value.files.map(({ path: filePath }) => filePath);
  return uniqueSortedStrings(paths)
    && value.files.every((file) => (
      exactRecord(file, ['path', 'media_type', 'bytes', 'sha256'])
        && repoPath(file.path)
        && (file.media_type === 'application/json' || file.media_type === 'text/x-diff')
        && file.media_type === (file.path.endsWith('.json')
          ? 'application/json'
          : 'text/x-diff')
        && Number.isSafeInteger(file.bytes)
        && file.bytes >= 0
        && digest(file.sha256)
    ));
}

function payloadMap(payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return null;
  const map = new Map();
  for (const payload of payloads) {
    if (!exactRecord(payload, ['path', 'bytes'])
      || !repoPath(payload.path)
      || !Buffer.isBuffer(payload.bytes)
      || map.has(payload.path)) {
      return null;
    }
    map.set(payload.path, payload.bytes);
  }
  return map;
}

function parseJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    const serialized = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
    return serialized.equals(bytes) ? value : null;
  } catch {
    return null;
  }
}

/** manifestと保存bytesだけからrequired behavior artifactのhashとcross-bindingを検証する。 */
export function verifyRc1V5BehaviorArtifactSet(options = {}) {
  try {
    const manifest = exactRecord(options, ['manifest', 'payloads']) ? options.manifest : null;
    const payloads = exactRecord(options, ['manifest', 'payloads'])
      ? payloadMap(options.payloads)
      : null;
    const manifestValid = validateManifest(manifest);
    const manifestPaths = manifestValid ? manifest.files.map(({ path: filePath }) => filePath) : [];
    const payloadPaths = payloads ? [...payloads.keys()].sort() : [];
    const requiredPresent = REQUIRED_BEHAVIOR_PATHS.every((requiredPath) => (
      manifestPaths.includes(requiredPath) && payloadPaths.includes(requiredPath)
    ));
    const pathSetsMatch = manifestValid && payloads !== null
      && sameArray(manifestPaths, payloadPaths);
    const bytesMatch = pathSetsMatch && manifest.files.every((file) => {
      const bytes = payloads.get(file.path);
      return bytes.byteLength === file.bytes && sha256(bytes) === file.sha256;
    });
    const pre = bytesMatch ? parseJson(payloads.get('behavior/pre-receipt.json')) : null;
    const post = bytesMatch ? parseJson(payloads.get('behavior/post-receipt.json')) : null;
    const envelope = bytesMatch ? parseJson(payloads.get('behavior/evidence-envelope.json')) : null;
    const transform = bytesMatch ? parseJson(payloads.get('transform/transform-artifact.json')) : null;
    const patch = bytesMatch ? payloads.get('transform/seam.patch') : null;
    const parsed = [pre, post, envelope, transform].every((value) => value !== null)
      && Buffer.isBuffer(patch);
    const bindingChecks = parsed ? behaviorBindingChecks({
      pre_receipt: pre,
      post_receipt: post,
      envelope,
      transform_artifact: transform,
      patch_digest: sha256(patch),
    }) : [];
    const bindingPassed = parsed
      && bindingChecks.length > 0
      && bindingChecks.every(({ passed }) => passed);
    const resultBound = bindingPassed
      && manifest.base_sha === envelope.base_sha
      && manifest.result_digest === envelope.envelope_digest;
    const checks = [
      { id: 'manifest_schema', passed: manifestValid },
      { id: 'required_paths', passed: requiredPresent },
      { id: 'path_bijection', passed: pathSetsMatch },
      { id: 'byte_hashes', passed: bytesMatch },
      { id: 'payload_parsing', passed: parsed },
      { id: 'behavior_binding', passed: bindingPassed },
      { id: 'result_binding', passed: resultBound },
    ];
    const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
    return {
      schema: 'lattice.rc1.behavior_artifact_verification.v1',
      valid: failedConditions.length === 0,
      checks,
      failed_conditions: failedConditions,
    };
  } catch {
    const checks = [
      'manifest_schema',
      'required_paths',
      'path_bijection',
      'byte_hashes',
      'payload_parsing',
      'behavior_binding',
      'result_binding',
    ].map((id) => ({ id, passed: false }));
    return {
      schema: 'lattice.rc1.behavior_artifact_verification.v1',
      valid: false,
      checks,
      failed_conditions: checks.map(({ id }) => id),
    };
  }
}
