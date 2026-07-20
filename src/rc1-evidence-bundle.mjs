import { createHash } from 'node:crypto';

import {
  canonicalizeArtifact,
  digestArtifact,
} from './artifact-contracts.mjs';
import { portableCodegraphOutcome } from './sensor-adapter.mjs';

const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONDITIONS = new Set(['control', 'treatment']);
const OPERATIONS = new Set(['status', 'query', 'callers', 'callees', 'impact', 'affected']);
const PROJECTION = 'lattice.codegraph_portable_outcome.v1';
const SANITIZER = 'lattice.codegraph_diagnostic_sanitizer.v1';
const STATUS_REMOVALS = Object.freeze([
  'projectPath',
  'indexPath',
  'lastIndexed',
  'dbSizeBytes',
]);
const SANITIZATION_RULES = Object.freeze([
  { selector: '/cwd', action: 'replace', replacement: '<repo-root>' },
  ...STATUS_REMOVALS.map((field) => ({
    selector: `/outcomes/*[operation=status]/data/${field}`,
    action: 'remove',
    replacement: null,
  })),
  { selector: '/outcomes/**/node/updatedAt', action: 'remove', replacement: null },
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

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function fail(reason) {
  throw new TypeError(`RC1 v4 evidence bundle契約違反: ${reason}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function sameArtifact(left, right) {
  try {
    return digestArtifact(left) === digestArtifact(right);
  } catch {
    return false;
  }
}

function validateQuerySet(querySet) {
  if (!exactRecord(querySet, ['schema', 'queries'])
    || querySet.schema !== 'lattice.codegraph_query_set.v2'
    || !Array.isArray(querySet.queries)
    || querySet.queries.length === 0
    || querySet.queries.length > 256) {
    return false;
  }
  const ids = new Set();
  for (const query of querySet.queries) {
    if (!isPlainObject(query) || !identifier(query.id) || ids.has(query.id)
      || !OPERATIONS.has(query.operation)) {
      return false;
    }
    ids.add(query.id);
    if (query.operation === 'status') {
      if (!exactRecord(query, ['id', 'operation'])) return false;
    } else if (query.operation === 'affected') {
      if (!exactRecord(query, ['id', 'operation', 'targets'])
        || !Array.isArray(query.targets)
        || query.targets.length === 0
        || query.targets.some((target) => typeof target !== 'string' || target.length === 0)) {
        return false;
      }
    } else if (!exactRecord(query, ['id', 'operation', 'target'])
      || typeof query.target !== 'string'
      || query.target.length === 0) {
      return false;
    }
  }
  return true;
}

function validateRawEvidence(rawEvidence, querySet) {
  if (!exactRecord(rawEvidence, ['cwd', 'outcomes'])
    || typeof rawEvidence.cwd !== 'string'
    || rawEvidence.cwd.length === 0
    || !Array.isArray(rawEvidence.outcomes)
    || rawEvidence.outcomes.length !== querySet.queries.length) {
    return false;
  }
  for (let index = 0; index < querySet.queries.length; index += 1) {
    const query = querySet.queries[index];
    const outcome = rawEvidence.outcomes[index];
    if (!isPlainObject(outcome)
      || outcome.id !== query.id
      || outcome.operation !== query.operation
      || typeof outcome.outcome !== 'string'
      || outcome.outcome.length === 0) {
      return false;
    }
    if (query.operation !== 'status' && query.operation !== 'affected'
      && outcome.target !== query.target) {
      return false;
    }
    if (query.operation === 'affected'
      && (!Array.isArray(outcome.targets)
        || outcome.targets.length !== query.targets.length
        || outcome.targets.some((entry, targetIndex) => (
          !isPlainObject(entry) || entry.target !== query.targets[targetIndex]
        )))) {
      return false;
    }
  }
  canonicalizeArtifact(rawEvidence);
  return true;
}

function scrubNodeTelemetry(value, pointer, operations, parentKey = null) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scrubNodeTelemetry(
      entry,
      `${pointer}/${index}`,
      operations,
      parentKey,
    ));
    return;
  }
  if (!isPlainObject(value)) return;
  if (parentKey === 'node' && Object.hasOwn(value, 'updatedAt')) {
    delete value.updatedAt;
    operations.push({ path: `${pointer}/updatedAt`, action: 'remove', replacement: null });
  }
  for (const [key, entry] of Object.entries(value)) {
    scrubNodeTelemetry(entry, `${pointer}/${escapePointer(key)}`, operations, key);
  }
}

function sanitizeDiagnostic(rawEvidence) {
  const payload = structuredClone(rawEvidence);
  const operations = [{ path: '/cwd', action: 'replace', replacement: '<repo-root>' }];
  payload.cwd = '<repo-root>';
  payload.outcomes.forEach((outcome, index) => {
    if (outcome.operation === 'status' && isPlainObject(outcome.data)) {
      for (const field of STATUS_REMOVALS) {
        if (Object.hasOwn(outcome.data, field)) {
          delete outcome.data[field];
          operations.push({
            path: `/outcomes/${index}/data/${escapePointer(field)}`,
            action: 'remove',
            replacement: null,
          });
        }
      }
    }
    scrubNodeTelemetry(outcome, `/outcomes/${index}`, operations);
  });
  return { payload, operations };
}

function stringHasAbsolutePath(value) {
  return /\bfile:\/\/\//i.test(value)
    || /(?:^|[\s("'=:\[])\/(?!\/)[^\s"')\]]+/.test(value)
    || /(?:^|[\s("'=:\[])[A-Za-z]:[\\/][^\s"')\]]*/.test(value);
}

function containsAbsolutePath(value) {
  if (typeof value === 'string') return stringHasAbsolutePath(value);
  if (Array.isArray(value)) return value.some(containsAbsolutePath);
  if (isPlainObject(value)) return Object.values(value).some(containsAbsolutePath);
  return false;
}

function rawReceipt(rawEvidence) {
  const canonical = canonicalizeArtifact(rawEvidence);
  const bytes = Buffer.from(canonical, 'utf8');
  return {
    schema: 'lattice.codegraph_raw_opaque_receipt.v1',
    media_type: 'application/vnd.lattice.codegraph-evidence+json',
    encoding: 'canonical-json-base64',
    payload_base64: bytes.toString('base64'),
    payload_digest: sha256(bytes),
    canonical_bytes: bytes.byteLength,
  };
}

function diagnosticArtifact(rawEvidence, sourceRawDigest) {
  const { payload, operations } = sanitizeDiagnostic(rawEvidence);
  if (containsAbsolutePath(payload)) fail('sanitized diagnosticに絶対pathが残る');
  const manifest = {
    schema: 'lattice.codegraph_sanitization_manifest.v1',
    sanitizer: SANITIZER,
    rules_digest: digestArtifact(SANITIZATION_RULES),
    operations,
  };
  return {
    schema: 'lattice.codegraph_sanitized_diagnostic.v1',
    source_raw_digest: sourceRawDigest,
    sanitization_manifest: manifest,
    sanitization_manifest_digest: digestArtifact(manifest),
    payload,
    payload_digest: digestArtifact(payload),
  };
}

function buildPortable(querySet, rawEvidence) {
  const querySetDigest = digestArtifact(querySet);
  const outcomes = rawEvidence.outcomes.map((outcome) => portableCodegraphOutcome(outcome));
  if (containsAbsolutePath(outcomes)) fail('portable outcomeに絶対pathが残る');
  const perQuery = outcomes.map((outcome, index) => ({
    id: querySet.queries[index].id,
    operation: querySet.queries[index].operation,
    outcome: outcome.outcome,
    result_digest: digestArtifact(outcome),
  }));
  const portable = {
    schema: 'lattice.codegraph_portable_preimage.v1',
    projection: PROJECTION,
    query_set_digest: querySetDigest,
    outcomes,
    per_query: perQuery,
    aggregate_digest: '',
  };
  portable.aggregate_digest = recomputePortableAggregate(portable);
  return portable;
}

/** full portable payloadだけからaggregate digestを再計算する。 */
export function recomputePortableAggregate(portable) {
  if (!isPlainObject(portable)
    || portable.schema !== 'lattice.codegraph_portable_preimage.v1'
    || portable.projection !== PROJECTION
    || typeof portable.query_set_digest !== 'string'
    || !SHA256.test(portable.query_set_digest)
    || !Array.isArray(portable.outcomes)) {
    fail('portable preimageが再計算可能なshapeでない');
  }
  return digestArtifact({
    projection: portable.projection,
    query_set_digest: portable.query_set_digest,
    outcomes: portable.outcomes,
  });
}

function decodeRawReceipt(receipt) {
  if (!exactRecord(receipt, [
    'schema',
    'media_type',
    'encoding',
    'payload_base64',
    'payload_digest',
    'canonical_bytes',
  ])
    || receipt.schema !== 'lattice.codegraph_raw_opaque_receipt.v1'
    || receipt.media_type !== 'application/vnd.lattice.codegraph-evidence+json'
    || receipt.encoding !== 'canonical-json-base64'
    || typeof receipt.payload_base64 !== 'string'
    || typeof receipt.payload_digest !== 'string'
    || !SHA256.test(receipt.payload_digest)
    || !Number.isSafeInteger(receipt.canonical_bytes)
    || receipt.canonical_bytes <= 0) {
    fail('raw opaque receiptが不正');
  }
  const bytes = Buffer.from(receipt.payload_base64, 'base64');
  if (bytes.toString('base64') !== receipt.payload_base64
    || bytes.byteLength !== receipt.canonical_bytes
    || sha256(bytes) !== receipt.payload_digest) {
    fail('raw opaque receiptのbytes／digestが一致しない');
  }
  const payload = JSON.parse(bytes.toString('utf8'));
  if (canonicalizeArtifact(payload) !== bytes.toString('utf8')) {
    fail('raw opaque payloadがcanonical JSONでない');
  }
  return payload;
}

function validatePortable(portable, querySet, rawEvidence) {
  if (!exactRecord(portable, [
    'schema',
    'projection',
    'query_set_digest',
    'outcomes',
    'per_query',
    'aggregate_digest',
  ])
    || portable.schema !== 'lattice.codegraph_portable_preimage.v1'
    || portable.projection !== PROJECTION
    || portable.query_set_digest !== digestArtifact(querySet)
    || !Array.isArray(portable.outcomes)
    || portable.outcomes.length !== querySet.queries.length
    || !Array.isArray(portable.per_query)
    || portable.per_query.length !== portable.outcomes.length
    || typeof portable.aggregate_digest !== 'string'
    || !SHA256.test(portable.aggregate_digest)
    || containsAbsolutePath(portable.outcomes)) {
    return false;
  }
  for (let index = 0; index < portable.outcomes.length; index += 1) {
    const record = portable.per_query[index];
    if (!exactRecord(record, ['id', 'operation', 'outcome', 'result_digest'])
      || record.id !== querySet.queries[index].id
      || record.operation !== querySet.queries[index].operation
      || record.outcome !== portable.outcomes[index].outcome
      || record.result_digest !== digestArtifact(portable.outcomes[index])) {
      return false;
    }
  }
  return portable.aggregate_digest === recomputePortableAggregate(portable)
    && sameArtifact(portable, buildPortable(querySet, rawEvidence));
}

function validateDiagnostic(diagnostic, rawEvidence, rawDigest) {
  if (!exactRecord(diagnostic, [
    'schema',
    'source_raw_digest',
    'sanitization_manifest',
    'sanitization_manifest_digest',
    'payload',
    'payload_digest',
  ])
    || diagnostic.schema !== 'lattice.codegraph_sanitized_diagnostic.v1'
    || diagnostic.source_raw_digest !== rawDigest
    || diagnostic.sanitization_manifest_digest
      !== digestArtifact(diagnostic.sanitization_manifest)
    || diagnostic.payload_digest !== digestArtifact(diagnostic.payload)
    || containsAbsolutePath(diagnostic.payload)) {
    return false;
  }
  return sameArtifact(diagnostic, diagnosticArtifact(rawEvidence, rawDigest));
}

/**
 * 1 fresh Codegraph runをraw／diagnostic／portableの独立componentへcompileする。
 */
export function createRc1EvidenceBundle({
  condition,
  runId,
  querySet,
  rawEvidence,
} = {}) {
  if (!CONDITIONS.has(condition) || !identifier(runId)
    || !validateQuerySet(querySet) || !validateRawEvidence(rawEvidence, querySet)) {
    fail('bundle inputが不正');
  }
  const fixedQuerySet = structuredClone(querySet);
  const fixedRaw = structuredClone(rawEvidence);
  const raw = rawReceipt(fixedRaw);
  const diagnostic = diagnosticArtifact(fixedRaw, raw.payload_digest);
  const portable = buildPortable(fixedQuerySet, fixedRaw);
  const componentDigests = {
    raw: raw.payload_digest,
    diagnostic_payload: diagnostic.payload_digest,
    sanitization_manifest: diagnostic.sanitization_manifest_digest,
    portable: portable.aggregate_digest,
  };
  return {
    schema: 'lattice.rc1.evidence_bundle.v1',
    condition,
    run_id: runId,
    query_set: fixedQuerySet,
    query_set_digest: digestArtifact(fixedQuerySet),
    raw,
    diagnostic,
    portable,
    component_digests: componentDigests,
  };
}

function validateBundle(value) {
  if (!exactRecord(value, [
    'schema',
    'condition',
    'run_id',
    'query_set',
    'query_set_digest',
    'raw',
    'diagnostic',
    'portable',
    'component_digests',
  ])
    || value.schema !== 'lattice.rc1.evidence_bundle.v1'
    || !CONDITIONS.has(value.condition)
    || !identifier(value.run_id)
    || !validateQuerySet(value.query_set)
    || value.query_set_digest !== digestArtifact(value.query_set)
    || !exactRecord(value.component_digests, [
      'raw',
      'diagnostic_payload',
      'sanitization_manifest',
      'portable',
    ])) {
    return false;
  }
  const rawEvidence = decodeRawReceipt(value.raw);
  if (!validateRawEvidence(rawEvidence, value.query_set)
    || !validateDiagnostic(value.diagnostic, rawEvidence, value.raw.payload_digest)
    || !validatePortable(value.portable, value.query_set, rawEvidence)) {
    return false;
  }
  return value.component_digests.raw === value.raw.payload_digest
    && value.component_digests.diagnostic_payload === value.diagnostic.payload_digest
    && value.component_digests.sanitization_manifest
      === value.diagnostic.sanitization_manifest_digest
    && value.component_digests.portable === value.portable.aggregate_digest;
}

/** @param {unknown} value @returns {boolean} */
export function validateRc1EvidenceBundle(value) {
  try {
    return validateBundle(value);
  } catch {
    return false;
  }
}

/** control／treatment各2 fresh runのportable／diagnostic再現性を検証する。 */
export function validateRc1EvidenceCampaign(value) {
  try {
    if (!Array.isArray(value) || value.length !== 4
      || value.some((bundle) => !validateBundle(bundle))
      || new Set(value.map(({ run_id: runId }) => runId)).size !== value.length
      || new Set(value.map(({ query_set_digest: digest }) => digest)).size !== 1) {
      return false;
    }
    for (const condition of CONDITIONS) {
      const runs = value.filter((bundle) => bundle.condition === condition);
      if (runs.length !== 2
        || runs[0].portable.aggregate_digest !== runs[1].portable.aggregate_digest
        || runs[0].diagnostic.payload_digest !== runs[1].diagnostic.payload_digest) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
