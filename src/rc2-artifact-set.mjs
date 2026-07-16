import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  canonicalizeArtifact,
  digestArtifact,
} from './artifact-contracts.mjs';
import { compileBoundaryCondition } from './boundary-compiler.mjs';
import { compileDeliveryPolicyBoundaryBundleV2 } from './rc2-delivery-policy-front-end.mjs';
import { expectedRc2DeliveryPolicyOracleReceipt } from './rc2-delivery-policy-oracle.mjs';
import { compileRc1TransferBundleV2 } from './rc2-rc1-transfer-front-end.mjs';
import {
  validateRc1EvidenceBundle,
} from './rc1-evidence-bundle.mjs';
import { compileSchedulabilityGraphV2 } from './schedulability-compiler-v2.mjs';
import { verifySchedulabilityPlanV2 } from './schedulability-verifier-v2.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const RAW_EVIDENCE_CHUNK_BYTES = 12_000;
const RC2_ORACLE_PATH = 'src/rc2-delivery-policy-oracle.mjs';
const RC2_ORACLE_IDENTITY_REF = 'identity/rc2-delivery-policy-oracle.mjs';
const RC2_TRANSFORM_PATH = 'src/rc2-delivery-policy-transform.mjs';
const RC2_TRANSFORM_IDENTITY_REF = 'identity/rc2-delivery-policy-transform.mjs';
const LEGACY_WITNESS = Object.freeze({
  epoch: 'delivery-policy-legacy-v1',
  candidateDigest: '30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5',
  oracleSourceDigest: 'c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe',
});
const SEMANTIC_WITNESS = Object.freeze({
  epoch: 'delivery-policy-semantic-v2',
  candidateDigest: '4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907',
  oracleSourceDigest: 'c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c',
});
const WITNESS_BY_VERSION = Object.freeze({
  v1: LEGACY_WITNESS,
  v2: LEGACY_WITNESS,
  v3: SEMANTIC_WITNESS,
  v4: SEMANTIC_WITNESS,
});

const PRIMARY_INPUT_PATHS = Object.freeze({
  planInput: 'inputs/primary/plan-input.json',
  candidateSpec: 'inputs/primary/candidate-spec-v1.json',
  normalManualEvidence: 'inputs/primary/manual-evidence.normal.json',
  partialManualEvidence: 'inputs/primary/manual-evidence.partial-state-negative.json',
  unknownManualEvidence: 'inputs/primary/manual-evidence.third-only-unknown.json',
  querySet: 'inputs/primary/query-set-v2.json',
});

const RC1_INPUT_PATHS = Object.freeze({
  planInput: 'inputs/rc1/plan-input.json',
  candidateSpec: 'inputs/rc1/candidate-spec-v2.json',
  normalManualEvidence: 'inputs/rc1/manual-evidence.normal.json',
  negativeManualEvidence: 'inputs/rc1/manual-evidence.shared-state-negative.json',
  querySet: 'inputs/rc1/query-set-v2.json',
  oracle: 'inputs/rc1/behavior-oracle-v2.json',
});

const CODEGRAPH_CONFIG_PATH = 'identity/codegraph-config.json';
// ratified config epochのallowlist。artifactのconfig bytesはこのいずれかと完全一致し、
// かつidentity.jsonのproject_config_digestと自己整合でなければreject（第三のbytesはfail closed）。
const CODEGRAPH_CONFIG_EPOCHS = Object.freeze([
  // ADR 0040 epoch（RC2 v2〜v4 canonical artifactが保存する当時のratified config）
  Buffer.from('{"exclude":["research/campaigns/**/artifacts/**/identity/"]}\n', 'utf8'),
  // ADR 0044 Decision 10.3 epoch（research/runs/ event store除外、RC3-B以降のfresh実行）
  Buffer.from(
    '{"exclude":["research/campaigns/**/artifacts/**/identity/","research/runs/"]}\n',
    'utf8',
  ),
]);

const V1_IDENTITY_PATHS = Object.freeze([
  'identity/codegraph-adapter.mjs',
  'identity/codegraph-executable',
  'identity/rc1-black-box-oracle.mjs',
  'identity/rc1-boundary-compiler.mjs',
  'identity/rc1-evidence-bundle.mjs',
  'identity/rc2-artifact-set.mjs',
  'identity/rc2-campaign.mjs',
  'identity/rc2-delivery-policy-front-end.mjs',
  'identity/rc2-delivery-policy-oracle.mjs',
  'identity/rc2-delivery-policy-transform.mjs',
  'identity/rc2-rc1-transfer-front-end.mjs',
  'identity/schedulability-compiler-v2.mjs',
  'identity/schedulability-verifier-v2.mjs',
]);

const V2_IDENTITY_PATHS = Object.freeze([
  ...V1_IDENTITY_PATHS,
  CODEGRAPH_CONFIG_PATH,
]);

const V3_IDENTITY_PATHS = V2_IDENTITY_PATHS;
const V4_IDENTITY_PATHS = V3_IDENTITY_PATHS;

const V1_PREDECESSOR_PATHS = Object.freeze([
  'predecessors/adr-0031.md',
  'predecessors/adr-0032.md',
  'predecessors/adr-0037.md',
  'predecessors/adr-0038.md',
  'predecessors/rc1-v6-artifact-manifest.json',
  'predecessors/rc1-v6-plan.md',
  'predecessors/rc1-v6-seam.patch',
  'predecessors/rc1-v6-transform-artifact.json',
  'predecessors/rc1-v6-transform-receipt.json',
]);

const V2_PREDECESSOR_PATHS = Object.freeze([
  ...V1_PREDECESSOR_PATHS,
  'predecessors/adr-0040.md',
  'predecessors/rc2-v1-artifact-manifest.json',
  'predecessors/rc2-v1-new-plan-version.json',
]);

const V3_PREDECESSOR_PATHS = Object.freeze([
  ...V2_PREDECESSOR_PATHS,
  'predecessors/adr-0041.md',
  'predecessors/rc2-semantic-reseal-characterization.md',
  'predecessors/rc2-v2-artifact-manifest.json',
  'predecessors/rc2-v2-new-plan-version.json',
]);

const V4_PREDECESSOR_PATHS = Object.freeze([
  ...V3_PREDECESSOR_PATHS,
  'predecessors/adr-0042.md',
  'predecessors/rc2-v3-version-downgrade-refutation.md',
  'predecessors/rc2-v3-artifact-manifest.json',
  'predecessors/rc2-v3-new-plan-version.json',
]);

const BYTE_PRESERVING_JSON_PATHS = new Set([
  'predecessors/rc1-v6-artifact-manifest.json',
  'predecessors/rc1-v6-transform-artifact.json',
  'predecessors/rc1-v6-transform-receipt.json',
  CODEGRAPH_CONFIG_PATH,
]);

const TRANSFORM_PATHS = Object.freeze([
  'transform/accepted-artifact.json',
  'transform/accepted-receipt.json',
  'transform/behavior-evidence.json',
  'transform/mutation-evidence.json',
  'transform/rejected-incomplete-artifact.json',
  'transform/rejected-incomplete-receipt.json',
  'transform/rejected-scope-artifact.json',
  'transform/rejected-scope-receipt.json',
  'transform/seam.patch',
]);

const RUN_IDS = Object.freeze([
  'primary-control-1',
  'primary-control-2',
  'primary-treatment-1',
  'primary-treatment-2',
  'rc1-transfer-control-1',
  'rc1-transfer-treatment-1',
]);

const COMPILED_PATHS = Object.freeze([
  'compiled/primary-control-1-normal.json',
  'compiled/primary-control-2-normal.json',
  'compiled/primary-treatment-1-normal.json',
  'compiled/primary-treatment-2-normal.json',
  'compiled/primary-treatment-capacity-2.json',
  'compiled/primary-treatment-partial-state.json',
  'compiled/primary-treatment-third-only-unknown.json',
  'compiled/rc1-transfer-control-negative.json',
  'compiled/rc1-transfer-control-normal.json',
  'compiled/rc1-transfer-treatment-negative.json',
  'compiled/rc1-transfer-treatment-normal.json',
]);

const SUMMARY_PATHS = Object.freeze([
  'comparison.json',
  'cost.json',
  'execution-evidence.json',
  'hypothesis-evaluation.json',
  'identity.json',
  'new-plan-version.json',
  'plan-diff.json',
]);

const RC2_V1_ARTIFACT_PATHS = Object.freeze([
  ...Object.values(PRIMARY_INPUT_PATHS),
  ...Object.values(RC1_INPUT_PATHS),
  ...V1_IDENTITY_PATHS,
  ...V1_PREDECESSOR_PATHS,
  ...TRANSFORM_PATHS,
  ...RUN_IDS.map((runId) => `evidence/${runId}.json`),
  ...COMPILED_PATHS,
  ...SUMMARY_PATHS,
].sort());

const RC2_V2_ARTIFACT_PATHS = Object.freeze([
  ...Object.values(PRIMARY_INPUT_PATHS),
  ...Object.values(RC1_INPUT_PATHS),
  ...V2_IDENTITY_PATHS,
  ...V2_PREDECESSOR_PATHS,
  ...TRANSFORM_PATHS,
  ...RUN_IDS.map((runId) => `evidence/${runId}.json`),
  ...COMPILED_PATHS,
  ...SUMMARY_PATHS,
].sort());

const RC2_V3_ARTIFACT_PATHS = Object.freeze([
  ...Object.values(PRIMARY_INPUT_PATHS),
  ...Object.values(RC1_INPUT_PATHS),
  ...V3_IDENTITY_PATHS,
  ...V3_PREDECESSOR_PATHS,
  ...TRANSFORM_PATHS,
  ...RUN_IDS.map((runId) => `evidence/${runId}.json`),
  ...COMPILED_PATHS,
  ...SUMMARY_PATHS,
].sort());

export const RC2_ARTIFACT_PATHS = Object.freeze([
  ...Object.values(PRIMARY_INPUT_PATHS),
  ...Object.values(RC1_INPUT_PATHS),
  ...V4_IDENTITY_PATHS,
  ...V4_PREDECESSOR_PATHS,
  ...TRANSFORM_PATHS,
  ...RUN_IDS.map((runId) => `evidence/${runId}.json`),
  ...COMPILED_PATHS,
  ...SUMMARY_PATHS,
].sort());

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

function sameArtifact(left, right) {
  try {
    return digestArtifact(left) === digestArtifact(right);
  } catch {
    return false;
  }
}

function mediaType(relativePath) {
  if (relativePath.endsWith('.json')) return 'application/json';
  if (relativePath.endsWith('.mjs')) return 'application/javascript';
  if (relativePath.endsWith('.patch')) return 'text/x-diff';
  if (relativePath.endsWith('.md')) return 'text/markdown';
  return 'application/octet-stream';
}

function payloadMap(payloads) {
  if (!Array.isArray(payloads)) return null;
  const result = new Map();
  for (const payload of payloads) {
    if (!exactRecord(payload, ['path', 'bytes'])
      || typeof payload.path !== 'string'
      || !Buffer.isBuffer(payload.bytes)
      || result.has(payload.path)) {
      return null;
    }
    result.set(payload.path, payload.bytes);
  }
  return result;
}

function parseCanonicalJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    return jsonBytes(value).equals(bytes) ? value : null;
  } catch {
    return null;
  }
}

function parseOpaqueJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

function artifactContract(manifest) {
  if (manifest?.schema === 'lattice.rc2.artifact_manifest.v1') {
    return {
      artifactVersion: 'v1',
      artifactPaths: RC2_V1_ARTIFACT_PATHS,
      identityPaths: V1_IDENTITY_PATHS,
      predecessorPaths: V1_PREDECESSOR_PATHS,
      witness: WITNESS_BY_VERSION.v1,
    };
  }
  if (manifest?.schema === 'lattice.rc2.artifact_manifest.v2') {
    return {
      artifactVersion: 'v2',
      artifactPaths: RC2_V2_ARTIFACT_PATHS,
      identityPaths: V2_IDENTITY_PATHS,
      predecessorPaths: V2_PREDECESSOR_PATHS,
      witness: WITNESS_BY_VERSION.v2,
    };
  }
  if (manifest?.schema === 'lattice.rc2.artifact_manifest.v3') {
    return {
      artifactVersion: 'v3',
      artifactPaths: RC2_V3_ARTIFACT_PATHS,
      identityPaths: V3_IDENTITY_PATHS,
      predecessorPaths: V3_PREDECESSOR_PATHS,
      witness: WITNESS_BY_VERSION.v3,
    };
  }
  if (manifest?.schema === 'lattice.rc2.artifact_manifest.v4') {
    return {
      artifactVersion: 'v4',
      artifactPaths: RC2_ARTIFACT_PATHS,
      identityPaths: V4_IDENTITY_PATHS,
      predecessorPaths: V4_PREDECESSOR_PATHS,
      witness: WITNESS_BY_VERSION.v4,
    };
  }
  return null;
}

function artifactContext(options) {
  if (!exactRecord(options, ['manifest', 'payloads'])) return null;
  const payloads = payloadMap(options.payloads);
  const manifest = options.manifest;
  const contract = artifactContract(manifest);
  if (!payloads
    || contract === null
    || !exactRecord(manifest, ['schema', 'base_sha', 'result_digest', 'files'])
    || !GIT_SHA1.test(manifest.base_sha)
    || !SHA256.test(manifest.result_digest)
    || !Array.isArray(manifest.files)) {
    return null;
  }
  const manifestPaths = manifest.files.map(({ path: relativePath }) => relativePath).sort();
  if (!sameArtifact(manifestPaths, contract.artifactPaths)
    || !sameArtifact([...payloads.keys()].sort(), contract.artifactPaths)) {
    return null;
  }
  for (const entry of manifest.files) {
    const bytes = payloads.get(entry.path);
    if (!exactRecord(entry, ['path', 'media_type', 'bytes', 'sha256'])
      || !Buffer.isBuffer(bytes)
      || entry.media_type !== mediaType(entry.path)
      || entry.bytes !== bytes.byteLength
      || entry.sha256 !== sha256(bytes)) {
      return null;
    }
  }
  const json = new Map();
  for (const relativePath of contract.artifactPaths.filter((entry) => entry.endsWith('.json'))) {
    const parsed = BYTE_PRESERVING_JSON_PATHS.has(relativePath)
      ? parseOpaqueJson(payloads.get(relativePath))
      : parseCanonicalJson(payloads.get(relativePath));
    if (parsed === null) return null;
    json.set(relativePath, parsed);
  }
  return { manifest, payloads, json, ...contract };
}

function objectFromPaths(context, paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, relativePath]) => (
    [key, context.json.get(relativePath)]
  )));
}

function stripDigest(value, key) {
  if (!plainRecord(value) || !Object.hasOwn(value, key)) return null;
  const result = structuredClone(value);
  delete result[key];
  return result;
}

function verifyIdentity(context) {
  const identity = context.json.get('identity.json');
  const projectConfigBound = context.artifactVersion !== 'v1';
  const expectedIdentitySchema = `lattice.rc2.execution_identity.${context.artifactVersion}`;
  const expectedCodegraphSchema = projectConfigBound
    ? 'lattice.rc2.codegraph_identity.v2'
    : 'lattice.rc2.codegraph_identity.v1';
  const codegraphKeys = projectConfigBound
    ? [
      'schema',
      'version',
      'executable_ref',
      'executable_digest',
      'project_config_ref',
      'project_config_digest',
    ]
    : ['schema', 'version', 'executable_ref', 'executable_digest'];
  if (!exactRecord(identity, [
    'schema',
    'sources',
    'codegraph_identity',
    'codegraph_identity_digest',
    'before_digest',
    'after_digest',
  ])
    || identity.schema !== expectedIdentitySchema
    || !Array.isArray(identity.sources)
    || identity.sources.length !== V1_IDENTITY_PATHS.length - 1
    || !exactRecord(identity.codegraph_identity, codegraphKeys)
    || identity.codegraph_identity.schema !== expectedCodegraphSchema
    || !SHA256.test(identity.codegraph_identity.executable_digest)
    || identity.codegraph_identity.executable_digest
      !== sha256(context.payloads.get('identity/codegraph-executable'))
    || (projectConfigBound && (
      identity.codegraph_identity.project_config_ref !== CODEGRAPH_CONFIG_PATH
      || !SHA256.test(identity.codegraph_identity.project_config_digest)
      || identity.codegraph_identity.project_config_digest
        !== sha256(context.payloads.get(CODEGRAPH_CONFIG_PATH))
    ))
    || identity.codegraph_identity_digest !== digestArtifact(identity.codegraph_identity)) {
    return false;
  }
  const expectedSourceRefs = V1_IDENTITY_PATHS
    .filter((relativePath) => relativePath !== 'identity/codegraph-executable');
  const actualRefs = identity.sources.map(({ artifact_ref: ref }) => ref).sort();
  if (!sameArtifact(actualRefs, expectedSourceRefs)) return false;
  for (const source of identity.sources) {
    if (!exactRecord(source, ['runtime_path', 'artifact_ref', 'digest'])
      || typeof source.runtime_path !== 'string'
      || !expectedSourceRefs.includes(source.artifact_ref)
      || source.digest !== sha256(context.payloads.get(source.artifact_ref))) {
      return false;
    }
  }
  const snapshot = {
    sources: identity.sources.map(({ runtime_path: runtimePath, artifact_ref: artifactRef, digest }) => ({
      runtime_path: runtimePath,
      artifact_ref: artifactRef,
      digest,
    })),
    codegraph_identity: identity.codegraph_identity,
  };
  const digest = digestArtifact(snapshot);
  return identity.before_digest === digest && identity.after_digest === digest;
}

function verifyCodegraphConfig(context) {
  if (context.artifactVersion === 'v1') return false;
  const bytes = context.payloads.get(CODEGRAPH_CONFIG_PATH);
  const identity = context.json.get('identity.json');
  return Buffer.isBuffer(bytes)
    && CODEGRAPH_CONFIG_EPOCHS.some((epochBytes) => bytes.equals(epochBytes))
    && identity?.codegraph_identity?.project_config_ref === CODEGRAPH_CONFIG_PATH
    && identity.codegraph_identity.project_config_digest === sha256(bytes);
}

function verifySurfaceSnapshot(snapshot, expectedPaths, expectedPresentPaths) {
  if (!exactRecord(snapshot, ['schema', 'files', 'digest'])
    || snapshot.schema !== 'lattice.rc2.delivery_policy_surface_snapshot.v1'
    || !Array.isArray(snapshot.files)
    || !isDeepStrictEqual(snapshot.files.map(({ path: relativePath }) => relativePath), expectedPaths)
    || snapshot.files.some((file) => (
      !exactRecord(file, ['path', 'state', 'content_digest'])
      || (expectedPresentPaths.has(file.path)
        ? file.state !== 'present' || !SHA256.test(file.content_digest)
        : file.state !== 'absent' || file.content_digest !== null)
    ))) {
    return false;
  }
  return snapshot.digest === digestArtifact({ schema: snapshot.schema, files: snapshot.files });
}

function expectedMutationContract(candidate) {
  if (!plainRecord(candidate)
    || candidate.schema !== 'lattice.rc2.boundary_candidate_spec.v1'
    || typeof candidate.candidate_id !== 'string'
    || !plainRecord(candidate.fixed_oracle)
    || candidate.fixed_oracle.path !== RC2_ORACLE_PATH
    || !SHA256.test(candidate.fixed_oracle.source_digest)
    || !Array.isArray(candidate.fixed_oracle.case_ids)
    || !Array.isArray(candidate.todos)
    || candidate.todos.length !== 3
    || !Array.isArray(candidate.stable_surfaces)) {
    return null;
  }
  const compositionSurfaces = candidate.stable_surfaces.filter(({ role }) => (
    role === 'composition-test'
  ));
  if (compositionSurfaces.length !== 1) return null;
  const composition = compositionSurfaces[0];
  if (typeof composition.target !== 'string' || typeof composition.path !== 'string') return null;

  const contracts = [];
  const rows = [];
  const surfacePaths = new Set([candidate.fixed_oracle.path]);
  const controlPaths = new Set([candidate.fixed_oracle.path]);
  for (const todo of candidate.todos) {
    if (!plainRecord(todo)
      || typeof todo.todo_id !== 'string'
      || !Array.isArray(todo.case_ids)
      || todo.case_ids.length !== 2
      || !plainRecord(todo.current)
      || !plainRecord(todo.proposed)
      || !plainRecord(todo.current.production)
      || !plainRecord(todo.proposed.production)
      || !Array.isArray(todo.current.tests)
      || !Array.isArray(todo.proposed.tests)
      || todo.proposed.tests.length !== 1) {
      return null;
    }
    const production = todo.proposed.production;
    const test = todo.proposed.tests[0];
    if (typeof production.symbol !== 'string'
      || typeof production.path !== 'string'
      || typeof test.symbol !== 'string'
      || typeof test.path !== 'string'
      || todo.case_ids.some((caseId) => typeof caseId !== 'string')) {
      return null;
    }
    contracts.push({ testId: test.symbol, path: test.path });
    rows.push(...todo.case_ids.map((caseId) => ({
      caseId,
      todoId: todo.todo_id,
      resolver: production.symbol,
      productionPath: production.path,
      ownerTestId: test.symbol,
    })));
    for (const mode of [todo.current, todo.proposed]) {
      if (typeof mode.production?.path !== 'string'
        || mode.tests.some(({ path: testPath }) => typeof testPath !== 'string')) {
        return null;
      }
      surfacePaths.add(mode.production.path);
      mode.tests.forEach(({ path: testPath }) => surfacePaths.add(testPath));
    }
    controlPaths.add(todo.current.production.path);
    todo.current.tests.forEach(({ path: testPath }) => controlPaths.add(testPath));
  }
  contracts.push({ testId: composition.target, path: composition.path });
  if (new Set(contracts.map(({ testId }) => testId)).size !== contracts.length
    || new Set(contracts.map(({ path: testPath }) => testPath)).size !== contracts.length
    || !isDeepStrictEqual(rows.map(({ caseId }) => caseId), candidate.fixed_oracle.case_ids)
    || new Set(candidate.fixed_oracle.case_ids).size !== candidate.fixed_oracle.case_ids.length) {
    return null;
  }
  return {
    contracts,
    rows,
    surfacePaths: [...surfacePaths].sort(),
    controlPaths,
  };
}

function verifyMutationEvidence(mutation, expected, outputDigest, candidateDigest, caseSetDigest) {
  if (!exactRecord(mutation, [
    'schema',
    'candidate_digest',
    'case_set_digest',
    'rows',
    'matrix_digest',
    'evidence_digest',
  ])
    || mutation.schema !== 'lattice.rc2.delivery_policy_mutation_evidence.v1'
    || mutation.candidate_digest !== candidateDigest
    || mutation.case_set_digest !== caseSetDigest
    || !Array.isArray(mutation.rows)
    || mutation.rows.length !== expected.rows.length) {
    return false;
  }
  for (let rowIndex = 0; rowIndex < expected.rows.length; rowIndex += 1) {
    const row = mutation.rows[rowIndex];
    const expectedRow = expected.rows[rowIndex];
    if (!exactRecord(row, [
      'case_id',
      'owner_todo_id',
      'resolver_symbol',
      'mutated_path',
      'oracle_mismatch_id',
      'cells',
      'restore_digest',
    ])
      || row.case_id !== expectedRow.caseId
      || row.owner_todo_id !== expectedRow.todoId
      || row.resolver_symbol !== expectedRow.resolver
      || row.mutated_path !== expectedRow.productionPath
      || row.oracle_mismatch_id !== expectedRow.caseId
      || row.restore_digest !== outputDigest
      || !Array.isArray(row.cells)
      || row.cells.length !== expected.contracts.length) {
      return false;
    }
    for (let cellIndex = 0; cellIndex < expected.contracts.length; cellIndex += 1) {
      const cell = row.cells[cellIndex];
      const contract = expected.contracts[cellIndex];
      const owner = contract.testId === expectedRow.ownerTestId;
      if (!exactRecord(cell, [
        'test_id', 'path', 'outcome', 'exit_code', 'stdout_digest', 'stderr_digest',
      ])
        || cell.test_id !== contract.testId
        || cell.path !== contract.path
        || !Number.isSafeInteger(cell.exit_code)
        || cell.exit_code < 0
        || !SHA256.test(cell.stdout_digest)
        || !SHA256.test(cell.stderr_digest)
        || (owner
          ? cell.outcome !== 'failed' || cell.exit_code === 0
          : cell.outcome !== 'passed' || cell.exit_code !== 0)) {
        return false;
      }
    }
  }
  const mutationBase = stripDigest(mutation, 'evidence_digest');
  return mutation.matrix_digest === digestArtifact({ rows: mutation.rows })
    && mutationBase !== null
    && mutation.evidence_digest === digestArtifact(mutationBase);
}

function verifyTransformSemantics(context, accepted, behavior, mutation) {
  try {
    const candidate = context.json.get(PRIMARY_INPUT_PATHS.candidateSpec);
    const expected = expectedMutationContract(candidate);
    const oracleReceipt = expectedRc2DeliveryPolicyOracleReceipt();
    const candidateDigest = digestArtifact(candidate);
    const oracleIdentityBytes = context.payloads.get(RC2_ORACLE_IDENTITY_REF);
    const transformIdentityBytes = context.payloads.get(RC2_TRANSFORM_IDENTITY_REF);
    if (expected === null
      || !Buffer.isBuffer(oracleIdentityBytes)
      || !Buffer.isBuffer(transformIdentityBytes)
      || !exactRecord(behavior, [
        'schema',
        'candidate_digest',
        'adapter_source_digest',
        'control_snapshot',
        'output_snapshot',
        'fixed_oracle',
        'pre_oracle',
        'post_oracle',
        'case_set_digest',
        'equivalent',
        'evidence_digest',
      ])
      || behavior.schema !== 'lattice.rc2.delivery_policy_behavior_evidence.v1'
      || !exactRecord(behavior.fixed_oracle, ['path', 'source_base64', 'source_digest'])
      || behavior.fixed_oracle.path !== RC2_ORACLE_PATH
      || typeof behavior.fixed_oracle.source_base64 !== 'string') {
      return false;
    }
    const oracleBytes = Buffer.from(behavior.fixed_oracle.source_base64, 'base64');
    if (oracleBytes.toString('base64') !== behavior.fixed_oracle.source_base64
      || !oracleBytes.equals(oracleIdentityBytes)
      || sha256(oracleBytes) !== behavior.fixed_oracle.source_digest
      || behavior.fixed_oracle.source_digest !== candidate.fixed_oracle.source_digest
      || behavior.fixed_oracle.source_digest !== accepted?.source?.fixed_oracle?.source_digest
      || accepted.source.fixed_oracle.path !== RC2_ORACLE_PATH
      || candidateDigest !== context.witness.candidateDigest
      || behavior.fixed_oracle.source_digest !== context.witness.oracleSourceDigest
      || behavior.candidate_digest !== candidateDigest
      || mutation?.candidate_digest !== candidateDigest
      || accepted?.candidate?.candidate_id !== candidate.candidate_id
      || accepted.candidate.digest !== candidateDigest
      || behavior.adapter_source_digest !== sha256(transformIdentityBytes)
      || accepted?.source?.adapter?.path !== RC2_TRANSFORM_PATH
      || accepted.source.adapter.digest !== behavior.adapter_source_digest
      || !isDeepStrictEqual(behavior.pre_oracle, oracleReceipt)
      || !isDeepStrictEqual(behavior.post_oracle, oracleReceipt)) {
      return false;
    }
    const expectedCaseSetDigest = digestArtifact({
      case_results: oracleReceipt.case_results.map(({ id, output_digest: outputDigest }) => ({
        id,
        output_digest: outputDigest,
      })),
    });
    const outputPaths = new Set(expected.surfacePaths);
    if (behavior.case_set_digest !== expectedCaseSetDigest
      || mutation.case_set_digest !== expectedCaseSetDigest
      || accepted.behavior?.case_set_digest !== expectedCaseSetDigest
      || accepted.behavior?.pre_oracle_digest !== digestArtifact(oracleReceipt)
      || accepted.behavior?.post_oracle_digest !== digestArtifact(oracleReceipt)
      || accepted.behavior?.equivalent !== true
      || behavior.equivalent !== true
      || !verifySurfaceSnapshot(behavior.control_snapshot, expected.surfacePaths, expected.controlPaths)
      || !verifySurfaceSnapshot(behavior.output_snapshot, expected.surfacePaths, outputPaths)
      || !isDeepStrictEqual(accepted.output?.files, behavior.output_snapshot.files)
      || accepted.output.snapshot_digest !== behavior.output_snapshot.digest
      || accepted.source.control_snapshot_digest !== behavior.control_snapshot.digest
      || behavior.control_snapshot.files.find(({ path: relativePath }) => (
        relativePath === RC2_ORACLE_PATH
      ))?.content_digest !== behavior.fixed_oracle.source_digest
      || behavior.output_snapshot.files.find(({ path: relativePath }) => (
        relativePath === RC2_ORACLE_PATH
      ))?.content_digest !== behavior.fixed_oracle.source_digest) {
      return false;
    }
    const behaviorBase = stripDigest(behavior, 'evidence_digest');
    if (behaviorBase === null
      || behavior.evidence_digest !== digestArtifact(behaviorBase)
      || accepted.behavior.evidence_digest !== behavior.evidence_digest
      || !verifyMutationEvidence(
        mutation,
        expected,
        behavior.output_snapshot.digest,
        candidateDigest,
        expectedCaseSetDigest,
      )) {
      return false;
    }
    return accepted.mutation?.evidence_digest === mutation.evidence_digest
      && accepted.mutation.matrix_digest === mutation.matrix_digest
      && accepted.mutation.row_count === expected.rows.length
      && accepted.mutation.cell_count === expected.rows.length * expected.contracts.length;
  } catch {
    return false;
  }
}

function verifyTransform(context) {
  const accepted = context.json.get('transform/accepted-artifact.json');
  const acceptedReceipt = context.json.get('transform/accepted-receipt.json');
  const behavior = context.json.get('transform/behavior-evidence.json');
  const mutation = context.json.get('transform/mutation-evidence.json');
  const incomplete = context.json.get('transform/rejected-incomplete-artifact.json');
  const incompleteReceipt = context.json.get('transform/rejected-incomplete-receipt.json');
  const scope = context.json.get('transform/rejected-scope-artifact.json');
  const scopeReceipt = context.json.get('transform/rejected-scope-receipt.json');
  const patch = context.payloads.get('transform/seam.patch');
  const behaviorBase = stripDigest(behavior, 'evidence_digest');
  const mutationBase = stripDigest(mutation, 'evidence_digest');
  const acceptedReceiptBase = stripDigest(acceptedReceipt, 'receipt_digest');
  const incompleteReceiptBase = stripDigest(incompleteReceipt, 'receipt_digest');
  const scopeReceiptBase = stripDigest(scopeReceipt, 'receipt_digest');
  return accepted?.schema === 'lattice.rc2.delivery_policy_transform_artifact.v1'
    && accepted.status === 'accepted'
    && exactRecord(accepted.candidate, ['candidate_id', 'digest'])
    && accepted.candidate.digest === context.witness.candidateDigest
    && exactRecord(accepted.source, [
      'adapter',
      'base_sha',
      'control_snapshot_digest',
      'fixed_oracle',
    ])
    && exactRecord(accepted.source.adapter, ['path', 'digest'])
    && exactRecord(accepted.source.fixed_oracle, ['path', 'source_digest'])
    && accepted.source.base_sha === context.manifest.base_sha
    && accepted.source.fixed_oracle.source_digest === context.witness.oracleSourceDigest
    && accepted.patch?.digest === sha256(patch)
    && accepted.patch?.bytes === patch.byteLength
    && accepted.output?.snapshot_digest === behavior?.output_snapshot?.digest
    && accepted.source?.control_snapshot_digest === behavior?.control_snapshot?.digest
    && accepted.source?.fixed_oracle?.source_digest === behavior?.fixed_oracle?.source_digest
    && accepted.behavior?.evidence_digest === behavior?.evidence_digest
    && behaviorBase !== null
    && behavior.evidence_digest === digestArtifact(behaviorBase)
    && accepted.mutation?.evidence_digest === mutation?.evidence_digest
    && mutationBase !== null
    && mutation.evidence_digest === digestArtifact(mutationBase)
    && acceptedReceipt?.status === 'accepted'
    && acceptedReceipt.transform_artifact_digest === digestArtifact(accepted)
    && acceptedReceipt.behavior_evidence_digest === behavior.evidence_digest
    && acceptedReceipt.mutation_evidence_digest === mutation.evidence_digest
    && acceptedReceiptBase !== null
    && acceptedReceipt.receipt_digest === digestArtifact(acceptedReceiptBase)
    && incomplete?.status === 'rejected'
    && incomplete?.rejection?.kind === 'incomplete_transform'
    && incomplete.output === null
    && sameArtifact(incomplete.candidate, accepted.candidate)
    && sameArtifact(incomplete.source, accepted.source)
    && incompleteReceipt?.status === 'rejected'
    && incompleteReceipt.transform_artifact_digest === digestArtifact(incomplete)
    && incompleteReceiptBase !== null
    && incompleteReceipt.receipt_digest === digestArtifact(incompleteReceiptBase)
    && scope?.status === 'rejected'
    && scope?.rejection?.kind === 'scope_violation'
    && scope.output === null
    && sameArtifact(scope.candidate, accepted.candidate)
    && sameArtifact(scope.source, accepted.source)
    && scopeReceipt?.status === 'rejected'
    && scopeReceipt.transform_artifact_digest === digestArtifact(scope)
    && scopeReceiptBase !== null
    && scopeReceipt.receipt_digest === digestArtifact(scopeReceiptBase)
    && verifyTransformSemantics(context, accepted, behavior, mutation);
}

function decodeRawEvidence(evidence) {
  try {
    return JSON.parse(Buffer.from(evidence.raw.payload_base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function rehydrateStoredEvidence(evidence) {
  if (!plainRecord(evidence)) return null;
  const raw = evidence.raw;
  if (!exactRecord(raw, [
    'schema',
    'source_schema',
    'media_type',
    'source_encoding',
    'storage_encoding',
    'canonical_bytes',
    'payload_digest',
    'payload_base64_chunks',
  ])
    || raw.schema !== 'lattice.rc2.chunked_codegraph_raw_receipt.v1'
    || raw.source_schema !== 'lattice.codegraph_raw_opaque_receipt.v1'
    || raw.source_encoding !== 'canonical-json-base64'
    || raw.storage_encoding !== 'ordered-base64-chunks'
    || !Number.isSafeInteger(raw.canonical_bytes)
    || raw.canonical_bytes < 0
    || !SHA256.test(raw.payload_digest)
    || !Array.isArray(raw.payload_base64_chunks)
    || raw.payload_base64_chunks.length === 0
    || raw.payload_base64_chunks.some((chunk) => (
      typeof chunk !== 'string'
      || chunk.length === 0
      || Buffer.byteLength(chunk, 'utf8') > RAW_EVIDENCE_CHUNK_BYTES
    ))
    || raw.payload_base64_chunks.slice(0, -1).some((chunk) => (
      Buffer.byteLength(chunk, 'utf8') !== RAW_EVIDENCE_CHUNK_BYTES
    ))) {
    return null;
  }
  const payloadBase64 = raw.payload_base64_chunks.join('');
  const payload = Buffer.from(payloadBase64, 'base64');
  if (payload.toString('base64') !== payloadBase64
    || payload.byteLength !== raw.canonical_bytes
    || sha256(payload) !== raw.payload_digest) {
    return null;
  }
  const restored = {
    ...structuredClone(evidence),
    raw: {
      schema: raw.source_schema,
      media_type: raw.media_type,
      encoding: raw.source_encoding,
      canonical_bytes: raw.canonical_bytes,
      payload_digest: raw.payload_digest,
      payload_base64: payloadBase64,
    },
  };
  return validateRc1EvidenceBundle(restored) ? restored : null;
}

function rehydrateStoredRun(run) {
  if (!plainRecord(run)) return null;
  const evidence = rehydrateStoredEvidence(run.evidence);
  if (evidence === null) return null;
  return { ...structuredClone(run), evidence };
}

function runMap(context) {
  return new Map(RUN_IDS.map((runId) => [
    runId,
    rehydrateStoredRun(context.json.get(`evidence/${runId}.json`)),
  ]));
}

function expectedRunFamily(runId) {
  return runId.startsWith('primary-') ? 'primary' : 'rc1_transfer';
}

function expectedRunCondition(runId) {
  return runId.includes('-treatment-') ? 'treatment' : 'control';
}

function verifyRuns(context) {
  const runs = runMap(context);
  const primaryInputs = objectFromPaths(context, PRIMARY_INPUT_PATHS);
  const rc1Inputs = objectFromPaths(context, RC1_INPUT_PATHS);
  const identity = context.json.get('identity.json');
  const accepted = context.json.get('transform/accepted-artifact.json');
  const rc1Transform = context.json.get('predecessors/rc1-v6-transform-artifact.json');
  const isolationDigests = new Set();
  for (const [runId, run] of runs) {
    const family = expectedRunFamily(runId);
    const condition = expectedRunCondition(runId);
    const inputs = family === 'primary' ? primaryInputs : rc1Inputs;
    const expectedPatch = condition === 'control'
      ? null
      : (family === 'primary' ? accepted?.patch?.digest : rc1Transform?.patch?.digest);
    if (!plainRecord(run)
      || run.schema !== 'lattice.rc2.fresh_codegraph_run.v1'
      || run.run_id !== runId
      || run.family !== family
      || run.condition !== condition
      || run.fresh_index !== true
      || !SHA256.test(run.isolation_instance_digest)
      || isolationDigests.has(run.isolation_instance_digest)
      || !validateRc1EvidenceBundle(run.evidence)
      || run.evidence.run_id !== runId
      || run.evidence.condition !== condition
      || run.evidence.query_set_digest !== digestArtifact(inputs.querySet)
      || run.measurement?.schema !== 'lattice.rc2.codegraph_measurement.v1'
      || run.measurement.base_sha !== context.manifest.base_sha
      || run.measurement.patch_digest !== expectedPatch
      || run.measurement.snapshot_digest !== digestArtifact(run.measurement.snapshot)
      || run.measurement.codegraph_identity_digest !== identity.codegraph_identity_digest
      || !sameArtifact(run.measurement.codegraph_identity, identity.codegraph_identity)
      || run.measurement.query_set_digest !== digestArtifact(inputs.querySet)
      || run.measurement.raw_evidence_digest !== run.evidence.raw.payload_digest
      || run.source_invariant?.outcome !== 'passed'
      || run.cleanup?.outcome !== 'passed'
      || run.oracle_receipt?.outcome !== 'passed'
      || run.cost?.index?.state !== 'measured'
      || run.cost?.query?.state !== 'measured'
      || run.cost?.oracle?.state !== 'measured') {
      return false;
    }
    isolationDigests.add(run.isolation_instance_digest);
  }
  return isolationDigests.size === RUN_IDS.length;
}

function verdictFor(bundle, compiled) {
  return {
    schema_version: 'lattice.boundary_verdict.v2',
    normalized_graph_digest: bundle.graph_digest,
    verdicts: compiled.pairwise_verdicts,
  };
}

function compiledRecord({ condition, runId, bundle, compiled }) {
  if (compiled.outcome !== 'compiled') throw new TypeError(`${condition} did not compile`);
  const verdict = verdictFor(bundle, compiled);
  const verification = verifySchedulabilityPlanV2(bundle.graph, compiled.plan);
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

function compilePrimaryRecord({ run, inputs, manualEvidence, planInput, condition }) {
  const bundle = compileDeliveryPolicyBoundaryBundleV2({
    planInput,
    candidateSpec: inputs.candidateSpec,
    manualEvidence,
    querySet: inputs.querySet,
    sourceSnapshot: run.measurement.snapshot,
    codegraphEvidence: run.evidence.portable,
  });
  return compiledRecord({
    condition,
    runId: run.run_id,
    bundle,
    compiled: compileSchedulabilityGraphV2(bundle.graph),
  });
}

function compileUnknownRecord({ run, inputs }) {
  const bundle = compileDeliveryPolicyBoundaryBundleV2({
    planInput: inputs.planInput,
    candidateSpec: inputs.candidateSpec,
    manualEvidence: inputs.unknownManualEvidence,
    querySet: inputs.querySet,
    sourceSnapshot: run.measurement.snapshot,
    codegraphEvidence: run.evidence.portable,
  });
  const outcome = compileSchedulabilityGraphV2(bundle.graph);
  const verification = verifySchedulabilityPlanV2(bundle.graph, {
    schema_version: 'lattice.plan_graph.v2',
    waves: [],
    minimum_feasible_waves: 0,
  });
  return {
    schema: 'lattice.rc2.non_dispatchable_condition.v1',
    condition: 'primary-treatment-third-only-unknown',
    run_id: run.run_id,
    bundle,
    outcome,
    verification,
  };
}

function recompileLegacy(run, inputs, manualEvidence, label) {
  const rawEvidence = decodeRawEvidence(run.evidence);
  if (rawEvidence === null) throw new TypeError('RC1 raw evidence is not decodable');
  return compileBoundaryCondition({
    planInput: inputs.planInput,
    candidateSpec: inputs.candidateSpec,
    manualEvidence,
    querySet: inputs.querySet,
    codegraphEvidence: rawEvidence,
    codeSnapshotDigest: run.measurement.snapshot_digest,
    planVersion: `rc2-${run.condition}-transfer-${label}`,
  });
}

function compileTransferRecord({ run, inputs, manualEvidence, label }) {
  const legacy = recompileLegacy(run, inputs, manualEvidence, label);
  if (!sameArtifact(legacy.boundary_manifest, run.legacy_boundary_manifests?.[label])) {
    throw new TypeError(`RC1 ${run.condition} ${label} fresh manifest mismatch`);
  }
  const transferred = compileRc1TransferBundleV2({
    planInput: inputs.planInput,
    candidateSpec: inputs.candidateSpec,
    manualEvidence,
    querySet: inputs.querySet,
    boundaryManifest: legacy.boundary_manifest,
  });
  const verification = verifySchedulabilityPlanV2(transferred.bundle.graph, transferred.plan);
  const stable = {
    bundle: transferred.bundle,
    verdict: transferred.verdict,
    plan: transferred.plan,
    verification,
  };
  return {
    schema: 'lattice.rc2.compiled_condition.v1',
    condition: `rc1-transfer-${run.condition}-${label}`,
    run_id: run.run_id,
    outcome: 'compiled',
    ...stable,
    artifact_digest: digestArtifact(stable),
  };
}

function recomputeConditions(context) {
  const runs = runMap(context);
  const primaryInputs = objectFromPaths(context, PRIMARY_INPUT_PATHS);
  const rc1Inputs = objectFromPaths(context, RC1_INPUT_PATHS);
  const control = [1, 2].map((index) => compilePrimaryRecord({
    run: runs.get(`primary-control-${index}`),
    inputs: primaryInputs,
    manualEvidence: primaryInputs.normalManualEvidence,
    planInput: primaryInputs.planInput,
    condition: 'primary-control-normal',
  }));
  const treatment = [1, 2].map((index) => compilePrimaryRecord({
    run: runs.get(`primary-treatment-${index}`),
    inputs: primaryInputs,
    manualEvidence: primaryInputs.normalManualEvidence,
    planInput: primaryInputs.planInput,
    condition: 'primary-treatment-normal',
  }));
  const treatmentRun = runs.get('primary-treatment-1');
  const capacityPlan = structuredClone(primaryInputs.planInput);
  capacityPlan.capacity.writers = 2;
  const partialState = compilePrimaryRecord({
    run: treatmentRun,
    inputs: primaryInputs,
    manualEvidence: primaryInputs.partialManualEvidence,
    planInput: primaryInputs.planInput,
    condition: 'primary-treatment-partial-state',
  });
  const capacity2 = compilePrimaryRecord({
    run: treatmentRun,
    inputs: primaryInputs,
    manualEvidence: primaryInputs.normalManualEvidence,
    planInput: capacityPlan,
    condition: 'primary-treatment-capacity-2',
  });
  const unknown = compileUnknownRecord({ run: treatmentRun, inputs: primaryInputs });
  const transferControlRun = runs.get('rc1-transfer-control-1');
  const transferTreatmentRun = runs.get('rc1-transfer-treatment-1');
  const transfer = {
    control: {
      normal: compileTransferRecord({
        run: transferControlRun,
        inputs: rc1Inputs,
        manualEvidence: rc1Inputs.normalManualEvidence,
        label: 'normal',
      }),
      negative: compileTransferRecord({
        run: transferControlRun,
        inputs: rc1Inputs,
        manualEvidence: rc1Inputs.negativeManualEvidence,
        label: 'negative',
      }),
    },
    treatment: {
      normal: compileTransferRecord({
        run: transferTreatmentRun,
        inputs: rc1Inputs,
        manualEvidence: rc1Inputs.normalManualEvidence,
        label: 'normal',
      }),
      negative: compileTransferRecord({
        run: transferTreatmentRun,
        inputs: rc1Inputs,
        manualEvidence: rc1Inputs.negativeManualEvidence,
        label: 'negative',
      }),
    },
  };
  return {
    primary: { control, treatment, partial_state: partialState, capacity_2: capacity2,
      third_only_unknown: unknown },
    rc1_transfer: transfer,
  };
}

const COMPILED_RECORD_PATHS = Object.freeze({
  'compiled/primary-control-1-normal.json': ['primary', 'control', 0],
  'compiled/primary-control-2-normal.json': ['primary', 'control', 1],
  'compiled/primary-treatment-1-normal.json': ['primary', 'treatment', 0],
  'compiled/primary-treatment-2-normal.json': ['primary', 'treatment', 1],
  'compiled/primary-treatment-partial-state.json': ['primary', 'partial_state'],
  'compiled/primary-treatment-capacity-2.json': ['primary', 'capacity_2'],
  'compiled/primary-treatment-third-only-unknown.json': ['primary', 'third_only_unknown'],
  'compiled/rc1-transfer-control-normal.json': ['rc1_transfer', 'control', 'normal'],
  'compiled/rc1-transfer-control-negative.json': ['rc1_transfer', 'control', 'negative'],
  'compiled/rc1-transfer-treatment-normal.json': ['rc1_transfer', 'treatment', 'normal'],
  'compiled/rc1-transfer-treatment-negative.json': ['rc1_transfer', 'treatment', 'negative'],
});

function nestedValue(value, keys) {
  return keys.reduce((current, key) => current?.[key], value);
}

function verifyCompiledConditions(context, recomputed) {
  return Object.entries(COMPILED_RECORD_PATHS).every(([relativePath, keys]) => (
    sameArtifact(context.json.get(relativePath), nestedValue(recomputed, keys))
  ));
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

function expectedComparison(context, recomputed) {
  const identity = context.json.get('identity.json');
  const transform = context.json.get('transform/accepted-artifact.json');
  const newPlan = context.json.get('new-plan-version.json');
  const planDiff = context.json.get('plan-diff.json');
  return {
    schema: 'lattice.rc2.control_treatment_comparison.v1',
    base_sha: context.manifest.base_sha,
    identity_digest: digestArtifact(identity),
    independent_variable: {
      kind: 'accepted_registry_shard_patch',
      transform_artifact_digest: digestArtifact(transform),
      patch_digest: transform.patch.digest,
    },
    condition_artifact_digests: {
      primary_control: recomputed.primary.control.map(({ artifact_digest: digest }) => digest),
      primary_treatment: recomputed.primary.treatment.map(({ artifact_digest: digest }) => digest),
      primary_partial_state: recomputed.primary.partial_state.artifact_digest,
      primary_capacity_2: recomputed.primary.capacity_2.artifact_digest,
      primary_unknown: digestArtifact(recomputed.primary.third_only_unknown),
      rc1_transfer_control_normal: recomputed.rc1_transfer.control.normal.artifact_digest,
      rc1_transfer_control_negative: recomputed.rc1_transfer.control.negative.artifact_digest,
      rc1_transfer_treatment_normal: recomputed.rc1_transfer.treatment.normal.artifact_digest,
      rc1_transfer_treatment_negative: recomputed.rc1_transfer.treatment.negative.artifact_digest,
    },
    metrics: {
      primary_control: conditionMetrics(recomputed.primary.control[0]),
      primary_treatment: conditionMetrics(recomputed.primary.treatment[0]),
      primary_partial_state: conditionMetrics(recomputed.primary.partial_state),
      primary_capacity_2: conditionMetrics(recomputed.primary.capacity_2),
      rc1_transfer_control_normal: conditionMetrics(recomputed.rc1_transfer.control.normal),
      rc1_transfer_control_negative: conditionMetrics(recomputed.rc1_transfer.control.negative),
      rc1_transfer_treatment_normal: conditionMetrics(recomputed.rc1_transfer.treatment.normal),
      rc1_transfer_treatment_negative: conditionMetrics(recomputed.rc1_transfer.treatment.negative),
    },
    version_barrier: {
      new_plan_version_digest: digestArtifact(newPlan),
      plan_diff_digest: digestArtifact(planDiff),
      causal_predecessors_digest: digestArtifact(planDiff.causal_predecessors),
    },
  };
}

function expectedHypothesis(comparison, recomputed, transform) {
  const checks = [
    { id: 'accepted_transform_only', passed: transform.status === 'accepted' },
    {
      id: 'primary_repeat_reproducible',
      passed: new Set(recomputed.primary.control.map(({ artifact_digest: digest }) => digest)).size === 1
        && new Set(recomputed.primary.treatment.map(({ artifact_digest: digest }) => digest)).size === 1,
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
      passed: recomputed.primary.third_only_unknown.outcome.outcome === 'unknown'
        && recomputed.primary.third_only_unknown.verification.outcome === 'unknown',
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
      passed: Object.values(COMPILED_RECORD_PATHS).every((keys) => {
        const record = nestedValue(recomputed, keys);
        return record.outcome !== 'compiled' || record.verification.outcome === 'verified';
      }),
    },
  ];
  return {
    schema: 'lattice.rc2.hypothesis_evaluation.v1',
    checks,
    supported: checks.every(({ passed }) => passed),
    failed_conditions: checks.filter(({ passed }) => !passed).map(({ id }) => id),
  };
}

function expectedPredecessorKinds(context) {
  const expected = new Map();
  for (const ref of context.predecessorPaths) {
    expected.set(
      ref,
      ref === 'predecessors/rc1-v6-plan.md'
        ? 'rc1_v6_phase_archive'
        : 'immutable_predecessor',
    );
  }
  expected.set('transform/accepted-artifact.json', 'accepted_transform');
  expected.set('transform/behavior-evidence.json', 'behavior_envelope');
  expected.set('transform/mutation-evidence.json', 'mutation_evidence');
  for (const runId of RUN_IDS) expected.set(`evidence/${runId}.json`, 'evidence_bundle');
  for (const ref of Object.values(PRIMARY_INPUT_PATHS)) expected.set(ref, 'fixed_input');
  expected.set('identity.json', 'execution_identity');
  expected.set('identity/schedulability-compiler-v2.mjs', 'compiler_identity');
  expected.set('identity/schedulability-verifier-v2.mjs', 'verifier_identity');
  if (context.artifactVersion !== 'v1') {
    expected.set(CODEGRAPH_CONFIG_PATH, 'codegraph_project_config');
  }
  return expected;
}

function verifyV1PredecessorPair(context) {
  if (context.artifactVersion === 'v1') return true;
  const manifest = context.json.get('predecessors/rc2-v1-artifact-manifest.json');
  const plan = context.json.get('predecessors/rc2-v1-new-plan-version.json');
  if (!exactRecord(manifest, ['schema', 'base_sha', 'result_digest', 'files'])
    || manifest.schema !== 'lattice.rc2.artifact_manifest.v1'
    || !GIT_SHA1.test(manifest.base_sha)
    || !SHA256.test(manifest.result_digest)
    || !Array.isArray(manifest.files)
    || !sameArtifact(
      manifest.files.map(({ path: relativePath }) => relativePath).sort(),
      RC2_V1_ARTIFACT_PATHS,
    )
    || new Set(manifest.files.map(({ path: relativePath }) => relativePath)).size
      !== RC2_V1_ARTIFACT_PATHS.length
    || plan?.schema !== 'lattice.rc2.plan_version.v1'
    || plan.version !== 'rc2-delivery-policy-v2') {
    return false;
  }
  const planBytes = context.payloads.get('predecessors/rc2-v1-new-plan-version.json');
  const entry = manifest.files.find(({ path: relativePath }) => (
    relativePath === 'new-plan-version.json'
  ));
  return exactRecord(entry, ['path', 'media_type', 'bytes', 'sha256'])
    && entry.media_type === 'application/json'
    && entry.bytes === planBytes.byteLength
    && entry.sha256 === sha256(planBytes);
}

function verifyV2PredecessorPair(context) {
  if (!['v3', 'v4'].includes(context.artifactVersion)) return true;
  const manifest = context.json.get('predecessors/rc2-v2-artifact-manifest.json');
  const plan = context.json.get('predecessors/rc2-v2-new-plan-version.json');
  if (!exactRecord(manifest, ['schema', 'base_sha', 'result_digest', 'files'])
    || manifest.schema !== 'lattice.rc2.artifact_manifest.v2'
    || !GIT_SHA1.test(manifest.base_sha)
    || !SHA256.test(manifest.result_digest)
    || !Array.isArray(manifest.files)
    || !sameArtifact(
      manifest.files.map(({ path: relativePath }) => relativePath).sort(),
      RC2_V2_ARTIFACT_PATHS,
    )
    || new Set(manifest.files.map(({ path: relativePath }) => relativePath)).size
      !== RC2_V2_ARTIFACT_PATHS.length
    || plan?.schema !== 'lattice.rc2.plan_version.v1'
    || plan.version !== 'rc2-delivery-policy-v3') {
    return false;
  }
  const planBytes = context.payloads.get('predecessors/rc2-v2-new-plan-version.json');
  const entry = manifest.files.find(({ path: relativePath }) => (
    relativePath === 'new-plan-version.json'
  ));
  return exactRecord(entry, ['path', 'media_type', 'bytes', 'sha256'])
    && entry.media_type === 'application/json'
    && entry.bytes === planBytes.byteLength
    && entry.sha256 === sha256(planBytes);
}

function verifyV3PredecessorPair(context) {
  if (context.artifactVersion !== 'v4') return true;
  const manifest = context.json.get('predecessors/rc2-v3-artifact-manifest.json');
  const plan = context.json.get('predecessors/rc2-v3-new-plan-version.json');
  if (!exactRecord(manifest, ['schema', 'base_sha', 'result_digest', 'files'])
    || manifest.schema !== 'lattice.rc2.artifact_manifest.v3'
    || !GIT_SHA1.test(manifest.base_sha)
    || !SHA256.test(manifest.result_digest)
    || !Array.isArray(manifest.files)
    || !sameArtifact(
      manifest.files.map(({ path: relativePath }) => relativePath).sort(),
      RC2_V3_ARTIFACT_PATHS,
    )
    || new Set(manifest.files.map(({ path: relativePath }) => relativePath)).size
      !== RC2_V3_ARTIFACT_PATHS.length
    || plan?.schema !== 'lattice.rc2.plan_version.v1'
    || plan.version !== 'rc2-delivery-policy-v4') {
    return false;
  }
  const planBytes = context.payloads.get('predecessors/rc2-v3-new-plan-version.json');
  const entry = manifest.files.find(({ path: relativePath }) => (
    relativePath === 'new-plan-version.json'
  ));
  return exactRecord(entry, ['path', 'media_type', 'bytes', 'sha256'])
    && entry.media_type === 'application/json'
    && entry.bytes === planBytes.byteLength
    && entry.sha256 === sha256(planBytes);
}

function verifyPredecessors(context) {
  const planDiff = context.json.get('plan-diff.json');
  const newPlan = context.json.get('new-plan-version.json');
  const expected = expectedPredecessorKinds(context);
  if (!Array.isArray(planDiff?.causal_predecessors)
    || !sameArtifact(planDiff.causal_predecessors, newPlan?.causal_predecessors)
    || planDiff.causal_predecessors.length !== expected.size) {
    return false;
  }
  const refs = new Set();
  for (const predecessor of planDiff.causal_predecessors) {
    if (!exactRecord(predecessor, ['kind', 'ref', 'digest'])
      || predecessor.kind !== expected.get(predecessor.ref)
      || !context.artifactPaths.includes(predecessor.ref)
      || refs.has(predecessor.ref)
      || predecessor.digest !== sha256(context.payloads.get(predecessor.ref))) {
      return false;
    }
    refs.add(predecessor.ref);
  }
  return refs.size === expected.size
    && [...expected.keys()].every((relativePath) => refs.has(relativePath))
    && verifyV1PredecessorPair(context)
    && verifyV2PredecessorPair(context)
    && verifyV3PredecessorPair(context);
}

function verifyVersionBarrier(context, recomputed) {
  const primaryInputs = objectFromPaths(context, PRIMARY_INPUT_PATHS);
  const newPlan = context.json.get('new-plan-version.json');
  const planDiff = context.json.get('plan-diff.json');
  const control = recomputed.primary.control[0];
  const treatment = recomputed.primary.treatment[0];
  const expectedInvalidations = [
    'old_plan',
    'agent_context',
    'partial_patch',
    'interface_assumption',
    'boundary_evidence',
  ];
  const predecessorPath = {
    v1: null,
    v2: 'predecessors/rc2-v1-new-plan-version.json',
    v3: 'predecessors/rc2-v2-new-plan-version.json',
    v4: 'predecessors/rc2-v3-new-plan-version.json',
  }[context.artifactVersion];
  const predecessorPlan = predecessorPath === null ? null : context.json.get(predecessorPath);
  const versionedPredecessor = predecessorPlan !== null;
  const predecessorVersion = versionedPredecessor
    ? predecessorPlan?.version
    : primaryInputs.planInput.plan_version;
  const expectedVersion = {
    v1: 'rc2-delivery-policy-v2',
    v2: 'rc2-delivery-policy-v3',
    v3: 'rc2-delivery-policy-v4',
    v4: 'rc2-delivery-policy-v5',
  }[context.artifactVersion];
  const expectedOldDigest = versionedPredecessor
    ? digestArtifact(predecessorPlan)
    : digestArtifact(control.plan);
  return newPlan?.schema === 'lattice.rc2.plan_version.v1'
    && newPlan.version === expectedVersion
    && newPlan.predecessor_version === predecessorVersion
    && sameArtifact(newPlan.plan, treatment.plan)
    && newPlan.plan_digest === digestArtifact(treatment.plan)
    && newPlan.bundle_digest === digestArtifact(treatment.bundle)
    && newPlan.verdict_digest === digestArtifact(treatment.verdict)
    && sameArtifact(
      [...newPlan.affected_todos].sort(),
      primaryInputs.planInput.todos.map(({ id }) => id).sort(),
    )
    && planDiff?.schema === 'lattice.rc2.plan_diff.v1'
    && planDiff.old_plan?.version === predecessorVersion
    && planDiff.old_plan?.digest === expectedOldDigest
    && planDiff.new_plan?.version === newPlan.version
    && planDiff.new_plan?.digest === digestArtifact(newPlan)
    && sameArtifact(planDiff.affected_todos, newPlan.affected_todos)
    && planDiff.invalidated_contexts?.map(({ kind }) => kind)
      .every((kind, index) => kind === expectedInvalidations[index])
    && planDiff.invalidated_contexts.length === expectedInvalidations.length
    && (!versionedPredecessor || (
      predecessorPlan?.plan_digest === digestArtifact(predecessorPlan.plan)
      && sameArtifact(predecessorPlan.plan, treatment.plan)
      && planDiff.invalidated_contexts.find(({ kind }) => kind === 'interface_assumption')?.ref
        === `${predecessorVersion}-interface-assumption`
      && planDiff.invalidated_contexts.find(({ kind }) => kind === 'boundary_evidence')?.ref
        === `${predecessorVersion}-boundary-evidence`
    ));
}

function verifyCost(context) {
  const cost = context.json.get('cost.json');
  if (cost?.schema !== 'lattice.rc2.stage_cost.v1'
    || !Array.isArray(cost.measurements)
    || cost.measurements.length < 20
    || cost.measurements.some((measurement) => (
      !exactRecord(measurement, ['stage', 'state', 'elapsed_ms'])
      || typeof measurement.stage !== 'string'
      || measurement.state !== 'measured'
      || typeof measurement.elapsed_ms !== 'number'
      || !Number.isFinite(measurement.elapsed_ms)
      || measurement.elapsed_ms < 0
    ))
    || cost.aggregate?.measured_count !== cost.measurements.length
    || cost.aggregate?.not_measured_count !== 0) {
    return false;
  }
  const elapsed = Math.round(cost.measurements
    .reduce((sum, measurement) => sum + measurement.elapsed_ms, 0) * 1_000) / 1_000;
  const transform = context.json.get('transform/accepted-artifact.json');
  return cost.aggregate.elapsed_ms === elapsed
    && cost.intervention?.patch_bytes === transform.patch.bytes
    && cost.intervention?.files === transform.scope.changed_paths.length
    && Number.isSafeInteger(cost.intervention?.review_lines)
    && cost.intervention.review_lines > 0
    && cost.rework?.rejected_attempts === 2
    && cost.rework?.retries === 0
    && cost.rework?.rollbacks === 0
    && Array.isArray(cost.unverified)
    && cost.unverified.length > 0;
}

function expectedExecutionEvidence(context, recomputed, comparison, hypothesis) {
  const identity = context.json.get('identity.json');
  const transform = context.json.get('transform/accepted-artifact.json');
  const newPlan = context.json.get('new-plan-version.json');
  const planDiff = context.json.get('plan-diff.json');
  const cost = context.json.get('cost.json');
  return {
    schema: 'lattice.rc2.campaign_execution_evidence.v1',
    base_sha: context.manifest.base_sha,
    identity_digest: digestArtifact(identity),
    transform_artifact_digest: digestArtifact(transform),
    run_digests: RUN_IDS.map((runId) => digestArtifact(
      context.json.get(`evidence/${runId}.json`),
    )),
    compiled_condition_digests: Object.values(COMPILED_RECORD_PATHS).map((keys) => (
      digestArtifact(nestedValue(recomputed, keys))
    )),
    new_plan_version_digest: digestArtifact(newPlan),
    plan_diff_digest: digestArtifact(planDiff),
    comparison_digest: digestArtifact(comparison),
    hypothesis_evaluation_digest: digestArtifact(hypothesis),
    cost_digest: digestArtifact(cost),
  };
}

/** 保存payloadだけからRC2のcausal relationとschedule minimumを再計算する。 */
export function verifyRc2CampaignArtifactSet(options = {}) {
  const checks = [];
  const check = (id, passed) => checks.push({ id, passed: passed === true });
  const context = artifactContext(options);
  check('exact_artifact_set', context !== null);
  if (context === null) {
    return {
      schema: 'lattice.rc2.artifact_set_verification.v1',
      valid: false,
      checks,
      failed_conditions: ['exact_artifact_set'],
    };
  }

  check('identity_binding', verifyIdentity(context));
  if (context.artifactVersion !== 'v1') {
    check('codegraph_config_binding', verifyCodegraphConfig(context));
  }
  check('transform_binding', verifyTransform(context));
  check('fresh_run_binding', verifyRuns(context));

  let recomputed;
  try {
    recomputed = recomputeConditions(context);
  } catch {
    recomputed = null;
  }
  check('compiled_conditions', recomputed !== null
    && verifyCompiledConditions(context, recomputed));
  check('minimum_verification', recomputed !== null
    && Object.values(COMPILED_RECORD_PATHS).every((keys) => {
      const record = nestedValue(recomputed, keys);
      return record.outcome !== 'compiled' || record.verification.outcome === 'verified';
    }));
  check('repeat_reproducibility', recomputed !== null
    && new Set(recomputed.primary.control.map(({ artifact_digest: digest }) => digest)).size === 1
    && new Set(recomputed.primary.treatment.map(({ artifact_digest: digest }) => digest)).size === 1);
  check('rc1_transfer_binding', recomputed !== null
    && recomputed.rc1_transfer.control.normal.bundle.graph.conflicts.length === 3
    && recomputed.rc1_transfer.treatment.normal.bundle.graph.conflicts.length === 0);
  check('predecessor_binding', verifyPredecessors(context));
  check('version_barrier', recomputed !== null && verifyVersionBarrier(context, recomputed));
  check('cost_arithmetic', verifyCost(context));

  let comparison;
  let hypothesis;
  if (recomputed !== null) {
    comparison = expectedComparison(context, recomputed);
    hypothesis = expectedHypothesis(
      comparison,
      recomputed,
      context.json.get('transform/accepted-artifact.json'),
    );
  }
  check('comparison_recalculation', recomputed !== null
    && sameArtifact(comparison, context.json.get('comparison.json')));
  check('hypothesis_recalculation', recomputed !== null
    && hypothesis.supported
    && sameArtifact(hypothesis, context.json.get('hypothesis-evaluation.json'))
    && context.manifest.result_digest === digestArtifact(hypothesis));
  check('execution_binding', recomputed !== null
    && sameArtifact(
      expectedExecutionEvidence(context, recomputed, comparison, hypothesis),
      context.json.get('execution-evidence.json'),
    ));

  return {
    schema: 'lattice.rc2.artifact_set_verification.v1',
    valid: checks.every(({ passed }) => passed),
    checks,
    failed_conditions: checks.filter(({ passed }) => !passed).map(({ id }) => id),
  };
}
