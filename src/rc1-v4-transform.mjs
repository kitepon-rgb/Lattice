import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  digestArtifact,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';
import {
  runRc1BlackBoxOracle,
  validateRc1BlackBoxOracle,
} from './rc1-black-box-oracle.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const CANDIDATE_ID = 'extract-dispatch-production-and-test-policies';
const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const CHANNEL = 'research/fixtures/dispatch-record/src/dispatch-channel.mjs';
const LABEL = 'research/fixtures/dispatch-record/src/dispatch-label.mjs';
const CHANNEL_TEST = 'test/research-dispatch-channel.test.mjs';
const LABEL_TEST = 'test/research-dispatch-label.test.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const SOURCE_BINDING_KEYS = Object.freeze([
  'boundary_manifest_digest',
  'boundary_verdict_digest',
  'control_plan_digest',
  'query_set_digest',
  'code_snapshot_digest',
]);

export const RC1_V4_TRANSFORM_PATHS = Object.freeze([
  CHANNEL,
  LABEL,
  FIXTURE,
  CHANNEL_TEST,
  LABEL_TEST,
  SHARED_TEST,
].sort());

const VERIFIERS = Object.freeze([{
  id: 'production-test-seam',
  command: 'node',
  args: [
    '--test',
    '--test-reporter=dot',
    CHANNEL_TEST,
    LABEL_TEST,
    SHARED_TEST,
  ],
}]);

const CHANNEL_SOURCE = [
  'export function selectDispatchChannel(priority) {',
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
  '  if (!isPlainObject(value)) return false;',
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
  '  const channel = selectDispatchChannel(input.priority);',
  '  const label = formatDispatchLabel(input.recipient, input.title);',
  '  return Object.freeze({ channel, label });',
  '}',
  '',
].join('\n');

const CHANNEL_TEST_SOURCE = [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { selectDispatchChannel } from '../research/fixtures/dispatch-record/src/dispatch-channel.mjs';",
  '',
  'export function channelPolicyContract() {',
  "  assert.equal(selectDispatchChannel('urgent'), 'pager');",
  "  assert.equal(selectDispatchChannel('routine'), 'queue');",
  "  assert.throws(() => selectDispatchChannel('later'), {",
  "    name: 'TypeError',",
  '    message: /^priority must be urgent or routine$/,',
  '  });',
  '}',
  '',
  "test('dispatch channel policy contract', channelPolicyContract);",
  '',
].join('\n');

const LABEL_TEST_SOURCE = [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { formatDispatchLabel } from '../research/fixtures/dispatch-record/src/dispatch-label.mjs';",
  '',
  'export function labelPolicyContract() {',
  "  assert.equal(formatDispatchLabel(' ops ', ' Down '), 'ops:Down');",
  "  assert.throws(() => formatDispatchLabel(' ', 'x'), {",
  "    name: 'TypeError',",
  '    message: /^recipient must be a non-empty string$/,',
  '  });',
  "  assert.throws(() => formatDispatchLabel('ops', ''), {",
  "    name: 'TypeError',",
  '    message: /^title must be a non-empty string$/,',
  '  });',
  '}',
  '',
  "test('dispatch label policy contract', labelPolicyContract);",
  '',
].join('\n');

const SHARED_TEST_SOURCE = [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { buildDispatchRecord } from '../research/fixtures/dispatch-record/src/dispatch-record.mjs';",
  '',
  "test('dispatch composition keeps its stable public shape', () => {",
  '  const inputs = [',
  "    { priority: 'urgent', recipient: ' ops ', title: ' Database down ' },",
  "    { priority: 'routine', recipient: 'team-a', title: 'Weekly digest' },",
  '  ];',
  '  for (const input of inputs) {',
  '    const actual = buildDispatchRecord(input);',
  "    assert.deepEqual(Object.keys(actual).sort(), ['channel', 'label']);",
  "    assert.equal(typeof actual.channel, 'string');",
  "    assert.equal(typeof actual.label, 'string');",
  '    assert.equal(Object.isFrozen(actual), true);',
  '  }',
  '});',
  '',
].join('\n');

const OUTPUTS = Object.freeze(new Map([
  [CHANNEL, CHANNEL_SOURCE],
  [LABEL, LABEL_SOURCE],
  [FIXTURE, COMPOSITION_SOURCE],
  [CHANNEL_TEST, CHANNEL_TEST_SOURCE],
  [LABEL_TEST, LABEL_TEST_SOURCE],
  [SHARED_TEST, SHARED_TEST_SOURCE],
]));

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

function assertSourceBindings(value) {
  if (!exactRecord(value, SOURCE_BINDING_KEYS)
    || Object.values(value).some((digest) => typeof digest !== 'string' || !SHA256.test(digest))) {
    throw new TypeError('RC1 v4 source bindings are invalid');
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameArray(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function verificationArtifact(status, runnerReceipts) {
  const receipts = runnerReceipts.map((receipt, index) => ({
    id: VERIFIERS[index]?.id ?? `unexpected-${index}`,
    command: receipt.command,
    args: [...receipt.args],
    outcome: receipt.outcome,
    exit_code: receipt.exit_code,
    stdout_digest: receipt.stdout_digest,
    stderr_digest: receipt.stderr_digest,
  }));
  const value = { status, receipts };
  return { ...value, digest: digestArtifact(value) };
}

async function outputArtifact(worktreePath, changedPaths) {
  const files = await Promise.all(changedPaths.map(async (relativePath) => ({
    path: relativePath,
    content_digest: sha256(await readFile(path.join(worktreePath, relativePath))),
  })));
  return { snapshot_digest: digestArtifact({ files }), files };
}

function behaviorSummary(pre, post, oracleDigest) {
  const summarize = (receipt) => (receipt ? {
    outcome: receipt.outcome,
    receipt_digest: receipt.receipt_digest,
  } : null);
  return {
    oracle_digest: oracleDigest,
    pre: summarize(pre),
    post: summarize(post),
    equivalent: pre?.outcome === 'passed'
      && post?.outcome === 'passed'
      && pre.oracle_digest === oracleDigest
      && post.oracle_digest === oracleDigest,
  };
}

function makeReceipt(artifact, behavior, fixedInputsDigest) {
  const value = {
    schema: 'lattice.rc1.seam_transform_receipt.v4',
    status: artifact.status,
    transform_artifact_digest: digestArtifact(artifact),
    fixed_inputs_digest: fixedInputsDigest,
    behavior,
    cleanup: artifact.cleanup,
  };
  return { value, digest: digestArtifact(value) };
}

function flattenErrors(error) {
  if (error instanceof AggregateError) return error.errors.flatMap(flattenErrors);
  return [error];
}

function transformEvidence(error) {
  return flattenErrors(error).map((entry) => entry?.transformEvidence).find((entry) => (
    entry && typeof entry.baseSha === 'string'
  ));
}

function rejectionFacts(error) {
  const messages = flattenErrors(error).map((entry) => String(entry?.message ?? entry)).join('\n');
  if (/source repository changed/i.test(messages)) {
    return {
      kind: 'source_invariant_violation',
      reason: 'canonical source invariant changed during isolated transform',
    };
  }
  if (/cleanup failed/i.test(messages)) {
    return { kind: 'cleanup_failure', reason: 'disposable worktree cleanup failed' };
  }
  if (/outside allowed paths|symlink change|submodule change|special file change/i.test(messages)) {
    return { kind: 'scope_violation', reason: 'isolated transform changed a path outside the fixed v4 scope' };
  }
  if (/black-box oracle failed|verifier failed|production-test seam incomplete/i.test(messages)) {
    return {
      kind: 'behavior_verification_failed',
      reason: 'fixed black-box oracle or production-test seam verifier failed',
    };
  }
  if (/mutated isolated snapshot/i.test(messages)) {
    return { kind: 'snapshot_mutation', reason: 'verifier or observer mutated the isolated snapshot' };
  }
  return { kind: 'execution_failure', reason: 'isolated transform execution failed' };
}

function rejectedResult({ error, evidence, sourceBindings, oracle, pre, post, fixedInputsDigest }) {
  const facts = rejectionFacts(error);
  const runnerReceipts = Array.isArray(evidence.verifications) ? evidence.verifications : [];
  const verificationStatus = runnerReceipts.length === 0 ? 'not_run' : 'failed';
  const patch = Buffer.isBuffer(evidence.patch) ? evidence.patch : null;
  const changedPaths = Array.isArray(evidence.changedPaths) ? [...evidence.changedPaths].sort() : [];
  const messages = flattenErrors(error).map((entry) => String(entry?.message ?? entry));
  const rejection = { kind: facts.kind, reasons: [facts.reason] };
  const artifact = {
    schema: 'lattice.transform_artifact.v1',
    candidate_id: CANDIDATE_ID,
    status: 'rejected',
    source: { base_sha: evidence.baseSha, ...sourceBindings },
    scope: { allowed_paths: [...RC1_V4_TRANSFORM_PATHS], changed_paths: changedPaths },
    patch: { digest: patch ? sha256(patch) : null, bytes: patch?.byteLength ?? 0 },
    verification: verificationArtifact(verificationStatus, runnerReceipts),
    output: { snapshot_digest: null, files: [] },
    cleanup: {
      status: messages.some((message) => /cleanup failed/i.test(message)) ? 'failed' : 'passed',
      source_status: messages.some((message) => /source repository changed/i.test(message))
        ? 'changed'
        : 'unchanged',
    },
    rejection: { ...rejection, evidence_digest: digestArtifact(rejection) },
    unknowns: ['post-transform output was not admitted'],
  };
  if (!validateTransformArtifact(artifact)) {
    throw new TypeError('RC1 v4 rejected transform artifact is invalid');
  }
  const behavior = behaviorSummary(pre, post, digestArtifact(oracle));
  const receipt = makeReceipt(artifact, behavior, fixedInputsDigest);
  return {
    artifact,
    artifact_digest: digestArtifact(artifact),
    receipt: receipt.value,
    receipt_digest: receipt.digest,
    patch: patch ? Buffer.from(patch) : null,
  };
}

/** transform対象6 fileをproduction concern、TODO-owned test、stable composition testへ分ける。 */
export async function applyRc1V4Transform({ worktreePath } = {}) {
  if (typeof worktreePath !== 'string' || worktreePath.length === 0) {
    throw new TypeError('worktreePath is required');
  }
  await Promise.all([...OUTPUTS].map(async ([relativePath, content]) => {
    const target = path.join(worktreePath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }));
}

/**
 * fixed oracleをpre／postに適用し、production＋test seamをdisposable worktreeだけで実行する。
 */
export async function runRc1V4SeamTransform({
  repoRoot,
  baseRef,
  oracle,
  sourceBindings,
  transform = applyRc1V4Transform,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0
    || typeof transform !== 'function') {
    throw new TypeError('RC1 v4 seam transform arguments are invalid');
  }
  if (!validateRc1BlackBoxOracle(oracle)) {
    throw new TypeError('RC1 v4 oracle contract is invalid');
  }
  assertSourceBindings(sourceBindings);
  const fixedOracle = structuredClone(oracle);
  const fixedSourceBindings = structuredClone(sourceBindings);
  const oracleDigest = digestArtifact(fixedOracle);
  const fixedInputsDigest = digestArtifact({
    candidate_id: CANDIDATE_ID,
    allowed_paths: RC1_V4_TRANSFORM_PATHS,
    verifiers: VERIFIERS,
    oracle_digest: oracleDigest,
    source_bindings: fixedSourceBindings,
  });
  let pre;
  let post;
  let output;
  let isolated;
  try {
    isolated = await runIsolatedTransform({
      repoRoot,
      baseRef,
      allowedPaths: [...RC1_V4_TRANSFORM_PATHS],
      transform: async (context) => {
        pre = await runRc1BlackBoxOracle({ repoRoot: context.worktreePath, oracle: fixedOracle });
        if (pre.outcome !== 'passed') throw new Error('black-box oracle failed before transform');
        await transform(context);
        post = await runRc1BlackBoxOracle({ repoRoot: context.worktreePath, oracle: fixedOracle });
        if (post.outcome !== 'passed') throw new Error('black-box oracle failed after transform');
      },
      verifyCommands: VERIFIERS.map(({ command, args }) => ({ command, args: [...args] })),
      observe: async ({ worktreePath, changedPaths }) => {
        output = await outputArtifact(worktreePath, changedPaths);
      },
    });
  } catch (error) {
    const evidence = transformEvidence(error);
    if (!evidence) throw error;
    return rejectedResult({
      error,
      evidence,
      sourceBindings: fixedSourceBindings,
      oracle: fixedOracle,
      pre,
      post,
      fixedInputsDigest,
    });
  }

  if (!pre || !post || !output
    || pre.outcome !== 'passed' || post.outcome !== 'passed'
    || pre.oracle_digest !== oracleDigest || post.oracle_digest !== oracleDigest
    || !sameArray(isolated.changedPaths, RC1_V4_TRANSFORM_PATHS)
    || !Buffer.isBuffer(isolated.patch)
    || isolated.verifications.length !== VERIFIERS.length) {
    return rejectedResult({
      error: new Error('production-test seam incomplete'),
      evidence: isolated,
      sourceBindings: fixedSourceBindings,
      oracle: fixedOracle,
      pre,
      post,
      fixedInputsDigest,
    });
  }
  const verification = verificationArtifact('passed', isolated.verifications);
  const artifact = {
    schema: 'lattice.transform_artifact.v1',
    candidate_id: CANDIDATE_ID,
    status: 'accepted',
    source: { base_sha: isolated.baseSha, ...fixedSourceBindings },
    scope: {
      allowed_paths: [...RC1_V4_TRANSFORM_PATHS],
      changed_paths: [...isolated.changedPaths],
    },
    patch: { digest: sha256(isolated.patch), bytes: isolated.patch.byteLength },
    verification,
    output,
    cleanup: { status: 'passed', source_status: 'unchanged' },
    rejection: null,
    unknowns: [],
  };
  if (!validateTransformArtifact(artifact)) {
    throw new TypeError('RC1 v4 accepted transform artifact is invalid');
  }
  const behavior = behaviorSummary(pre, post, oracleDigest);
  if (!behavior.equivalent) throw new TypeError('RC1 v4 behavior evidence is not equivalent');
  const receipt = makeReceipt(artifact, behavior, fixedInputsDigest);
  return {
    artifact,
    artifact_digest: digestArtifact(artifact),
    receipt: receipt.value,
    receipt_digest: receipt.digest,
    patch: Buffer.from(isolated.patch),
  };
}
