import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalizeArtifact,
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const CANDIDATE_ID = 'extract-dispatch-policies';
const FIXTURE_ENTRY = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const CHANNEL_PATH = 'research/fixtures/dispatch-record/src/dispatch-channel.mjs';
const LABEL_PATH = 'research/fixtures/dispatch-record/src/dispatch-label.mjs';
const ALLOWED_PATHS = Object.freeze([CHANNEL_PATH, LABEL_PATH, FIXTURE_ENTRY]);
const VERIFIERS = Object.freeze([{
  id: 'dispatch-characterization',
  command: 'node',
  args: ['--test', '--test-reporter=dot', 'test/research-dispatch-record.test.mjs'],
}]);

const CHANNEL_SOURCE = [
  "export function selectDispatchChannel(priority) {",
  "  if (priority !== 'urgent' && priority !== 'routine') {",
  "    throw new TypeError('priority must be urgent or routine');",
  '  }',
  '',
  "  return priority === 'urgent' ? 'pager' : 'queue';",
  '}',
  '',
].join('\n');

const LABEL_SOURCE = [
  'function nonEmptyString(value, field) {',
  "  if (typeof value !== 'string' || value.trim().length === 0) {",
  '    throw new TypeError(`${field} must be a non-empty string`);',
  '  }',
  '  return value.trim();',
  '}',
  '',
  'export function formatDispatchLabel(recipient, title) {',
  "  const normalizedRecipient = nonEmptyString(recipient, 'recipient');",
  "  const normalizedTitle = nonEmptyString(title, 'title');",
  '  return `${normalizedRecipient}:${normalizedTitle}`;',
  '}',
  '',
].join('\n');

const COMPOSITION_SOURCE = [
  "import { selectDispatchChannel } from './dispatch-channel.mjs';",
  "import { formatDispatchLabel } from './dispatch-label.mjs';",
  '',
  "const INPUT_KEYS = ['priority', 'recipient', 'title'];",
  '',
  'function isPlainObject(value) {',
  '  return value !== null',
  "    && typeof value === 'object'",
  '    && !Array.isArray(value)',
  '    && Object.getPrototypeOf(value) === Object.prototype;',
  '}',
  '',
  'function hasExactInputKeys(value) {',
  '  if (!isPlainObject(value)) {',
  '    return false;',
  '  }',
  '',
  '  const actual = Object.keys(value).sort();',
  '  return actual.length === INPUT_KEYS.length',
  '    && actual.every((key, index) => key === INPUT_KEYS[index]);',
  '}',
  '',
  'export function buildDispatchRecord(input) {',
  '  if (!hasExactInputKeys(input)) {',
  '    throw new TypeError(',
  "      'dispatch input must be a plain object with exact keys: priority, recipient, title',",
  '    );',
  '  }',
  '',
  '  const channel = selectDispatchChannel(input.priority);',
  '  const label = formatDispatchLabel(input.recipient, input.title);',
  '',
  '  return Object.freeze({ channel, label });',
  '}',
  '',
].join('\n');

function fail(reason) {
  throw new TypeError(`RC1 seam transform契約違反: ${reason}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameArray(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function assertCandidateInputs({ boundaryManifest, boundaryVerdict, controlPlan, querySet }) {
  for (const value of [boundaryManifest, boundaryVerdict, controlPlan, querySet]) {
    canonicalizeArtifact(value);
  }
  if (!validateBoundaryManifest(boundaryManifest)
    || !validateBoundaryVerdict(boundaryVerdict)
    || !validatePlanGraph(controlPlan)) {
    fail('control artifactがpublic contractを満たさない');
  }
  const manifestDigest = digestArtifact(boundaryManifest);
  const verdictDigest = digestArtifact(boundaryVerdict);
  const controlPlanDigest = digestArtifact(controlPlan);
  const querySetDigest = digestArtifact(querySet);
  if (boundaryVerdict.boundary_manifest_digest !== manifestDigest
    || controlPlan.source_manifest_digest !== manifestDigest
    || boundaryManifest.source.query_set_digest !== querySetDigest) {
    fail('control artifactとquery setのdigest chainが一致しない');
  }
  if (boundaryManifest.conflicts.length !== 1
    || boundaryManifest.conflicts[0].kind !== 'write_boundary'
    || boundaryManifest.todos.length !== 2
    || boundaryManifest.todos.some(({ unknowns }) => unknowns
      .some((entry) => !entry.startsWith('new_surface_unknown:')
        && !entry.startsWith('path_not_indexed_unknown:')))) {
    fail('RC1 normal control以外はseam interventionへ進めない');
  }
  if (controlPlan.plan_version !== 'rc1-control-v1'
    || controlPlan.capacity.writers !== 2
    || controlPlan.minimum_feasible_waves !== 2) {
    fail('RC1 control plan topologyまたはcapacityがdriftした');
  }
  if (boundaryVerdict.verdicts.length !== 1
    || boundaryVerdict.verdicts[0].verdict !== 'seam_candidate'
    || boundaryVerdict.verdicts[0].seam_candidate?.id !== CANDIDATE_ID) {
    fail('accepted seam candidateがexactly one存在しない');
  }
  const candidate = boundaryVerdict.verdicts[0].seam_candidate;
  const owns = new Map(candidate.proposed_owns.map((entry) => [entry.todo_id, entry.resources]));
  const expected = new Map([
    ['channel-policy', [
      { kind: 'symbol', target: 'selectDispatchChannel' },
      { kind: 'path', target: CHANNEL_PATH },
    ]],
    ['label-policy', [
      { kind: 'symbol', target: 'formatDispatchLabel' },
      { kind: 'path', target: LABEL_PATH },
    ]],
  ]);
  if (owns.size !== expected.size
    || [...expected].some(([todoId, resources]) => {
      const actual = owns.get(todoId);
      return JSON.stringify(actual) !== JSON.stringify(resources);
    })) {
    fail('seam candidate ownershipがfixed interventionと一致しない');
  }
  return {
    manifestDigest,
    verdictDigest,
    controlPlanDigest,
    querySetDigest,
    codeSnapshotDigest: boundaryManifest.source.code_snapshot_digest,
  };
}

function receiptsFromRunner(verifications) {
  if (!Array.isArray(verifications) || verifications.length > VERIFIERS.length) {
    fail('runner verification receipt数がfixed verifierと一致しない');
  }
  return verifications.map((receipt, index) => {
    const expected = VERIFIERS[index];
    if (receipt.command !== expected.command || !sameArray(receipt.args, expected.args)) {
      fail('runner receiptがfixed verifier commandと一致しない');
    }
    return {
      id: expected.id,
      command: receipt.command,
      args: receipt.args,
      outcome: receipt.outcome,
      exit_code: receipt.exit_code,
      stdout_digest: receipt.stdout_digest,
      stderr_digest: receipt.stderr_digest,
    };
  });
}

function verificationArtifact(status, receipts) {
  return {
    status,
    digest: digestArtifact({ status, receipts }),
    receipts,
  };
}

function sourceArtifact(baseSha, digests) {
  return {
    base_sha: baseSha,
    boundary_manifest_digest: digests.manifestDigest,
    boundary_verdict_digest: digests.verdictDigest,
    control_plan_digest: digests.controlPlanDigest,
    query_set_digest: digests.querySetDigest,
    code_snapshot_digest: digests.codeSnapshotDigest,
  };
}

async function observeOutput({ worktreePath, changedPaths }) {
  if (!sameArray(changedPaths, ALLOWED_PATHS)) {
    throw new Error('transform scope does not exactly match the accepted RC1 paths');
  }
  const files = await Promise.all(changedPaths.map(async (relativePath) => ({
    path: relativePath,
    content_digest: sha256(await readFile(path.join(worktreePath, relativePath))),
  })));
  return { snapshot_digest: digestArtifact({ files }), files };
}

function flattenErrors(error) {
  if (!(error instanceof AggregateError)) return [error];
  return error.errors.flatMap((entry) => flattenErrors(entry));
}

function portableReason(error, repoRoot) {
  return String(error?.message ?? error)
    .split(repoRoot).join('<repo-root>')
    .replace(/\S*lattice-isolated-transform-[^\s:]+/g, '<isolated-worktree>')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 4_096) || 'isolated transform failed without a message';
}

function rejectionKind(reasons) {
  const text = reasons.join(' ').toLowerCase();
  if (text.includes('source repository changed')) return 'source_invariant_violation';
  if (text.includes('cleanup failed')) return 'cleanup_failure';
  if (text.includes('outside allowed paths') || text.includes('transform scope')) return 'scope_violation';
  if (text.includes('mutated isolated snapshot')) return 'snapshot_mutation';
  if (text.includes('verifier failed')) return 'behavior_verification_failed';
  return 'execution_failure';
}

function rejectedArtifact({ error, repoRoot, digests }) {
  const errors = flattenErrors(error);
  const evidence = errors.map((entry) => entry.transformEvidence).find(Boolean);
  if (!evidence || typeof evidence.baseSha !== 'string') throw error;
  const reasons = [...new Set(errors.map((entry) => portableReason(entry, repoRoot)))];
  const kind = rejectionKind(reasons);
  const rejection = { kind, reasons };
  const receipts = receiptsFromRunner(evidence.verifications);
  const verificationStatus = receipts.length === 0 ? 'not_run' : 'failed';
  const patch = Buffer.isBuffer(evidence.patch) ? evidence.patch : null;
  const changedPaths = Array.isArray(evidence.changedPaths) ? [...evidence.changedPaths].sort() : [];
  const cleanupFailed = reasons.some((entry) => entry.toLowerCase().includes('cleanup failed'));
  const sourceChanged = reasons.some((entry) => entry.toLowerCase().includes('source repository changed'));
  const artifact = {
    schema: 'lattice.transform_artifact.v1',
    candidate_id: CANDIDATE_ID,
    status: 'rejected',
    source: sourceArtifact(evidence.baseSha, digests),
    scope: { allowed_paths: [...ALLOWED_PATHS], changed_paths: changedPaths },
    patch: {
      digest: patch ? sha256(patch) : null,
      bytes: patch ? patch.byteLength : 0,
    },
    verification: verificationArtifact(verificationStatus, receipts),
    output: { snapshot_digest: null, files: [] },
    cleanup: {
      status: cleanupFailed ? 'failed' : 'passed',
      source_status: sourceChanged ? 'changed' : 'unchanged',
    },
    rejection: { ...rejection, evidence_digest: digestArtifact(rejection) },
    unknowns: patch ? ['post-transform content snapshot unavailable after rejection'] : [
      'changed paths and post-transform snapshot unavailable after rejection',
    ],
  };
  if (!validateTransformArtifact(artifact)) {
    fail('生成したrejected transform artifactがpublic contractを満たさない');
  }
  return { artifact, artifact_digest: digestArtifact(artifact), patch: null };
}

export async function applyRc1SeamTransform({ worktreePath } = {}) {
  if (typeof worktreePath !== 'string' || worktreePath.length === 0) {
    throw new TypeError('worktreePath is required');
  }
  await Promise.all([
    writeFile(path.join(worktreePath, CHANNEL_PATH), CHANNEL_SOURCE),
    writeFile(path.join(worktreePath, LABEL_PATH), LABEL_SOURCE),
    writeFile(path.join(worktreePath, FIXTURE_ENTRY), COMPOSITION_SOURCE),
  ]);
}

/**
 * RC1のaccepted seam candidateをdisposable worktreeで実行し、typed artifactへ変換する。
 * @param {object} options
 * @returns {Promise<{artifact: object, artifact_digest: string, patch: Buffer | null}>}
 */
export async function runRc1SeamTreatment({
  repoRoot,
  baseRef = 'HEAD',
  boundaryManifest,
  boundaryVerdict,
  controlPlan,
  querySet,
  transform = applyRc1SeamTransform,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0
    || typeof transform !== 'function') {
    throw new TypeError('invalid RC1 seam treatment arguments');
  }
  const digests = assertCandidateInputs({
    boundaryManifest,
    boundaryVerdict,
    controlPlan,
    querySet,
  });
  let output;
  let isolated;
  try {
    isolated = await runIsolatedTransform({
      repoRoot,
      baseRef,
      allowedPaths: [...ALLOWED_PATHS],
      transform,
      verifyCommands: VERIFIERS.map(({ command, args }) => ({ command, args: [...args] })),
      observe: async (context) => {
        output = await observeOutput(context);
      },
    });
  } catch (error) {
    return rejectedArtifact({ error, repoRoot, digests });
  }
  if (!output || !Buffer.isBuffer(isolated.patch) || !sameArray(isolated.changedPaths, ALLOWED_PATHS)) {
    fail('accepted runner resultにpatch、scope、post snapshotが揃っていない');
  }
  const receipts = receiptsFromRunner(isolated.verifications);
  if (receipts.length !== VERIFIERS.length) {
    fail('accepted runner resultが全fixed verifier receiptを持たない');
  }
  const artifact = {
    schema: 'lattice.transform_artifact.v1',
    candidate_id: CANDIDATE_ID,
    status: 'accepted',
    source: sourceArtifact(isolated.baseSha, digests),
    scope: { allowed_paths: [...ALLOWED_PATHS], changed_paths: [...isolated.changedPaths] },
    patch: { digest: sha256(isolated.patch), bytes: isolated.patch.byteLength },
    verification: verificationArtifact('passed', receipts),
    output,
    cleanup: { status: 'passed', source_status: 'unchanged' },
    rejection: null,
    unknowns: [],
  };
  if (!validateTransformArtifact(artifact)) {
    fail('生成したaccepted transform artifactがpublic contractを満たさない');
  }
  if (!SHA256.test(artifact.patch.digest)) fail('patch digestがSHA-256でない');
  return {
    artifact,
    artifact_digest: digestArtifact(artifact),
    patch: Buffer.from(isolated.patch),
  };
}
