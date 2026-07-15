import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  digestArtifact,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { runIsolatedTransform } from './isolation-runner.mjs';
import {
  runRc1V5BlackBoxOracle,
  validateRc1BlackBoxOracle,
} from './rc1-black-box-oracle.mjs';
import {
  applyRc1V4Transform,
  RC1_V4_TRANSFORM_PATHS,
} from './rc1-v4-transform.mjs';
import { compileRc1V5BehaviorEvidence } from './rc1-v5-behavior-evidence.mjs';

const execFileAsync = promisify(execFile);
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const CANDIDATE_ID = 'extract-dispatch-production-and-test-policies';
const SOURCE_BINDING_KEYS = Object.freeze([
  'boundary_manifest_digest',
  'boundary_verdict_digest',
  'control_plan_digest',
  'query_set_digest',
]);

export const RC1_V5_TRANSFORM_PATHS = Object.freeze([...RC1_V4_TRANSFORM_PATHS]);

const VERIFIERS = Object.freeze([{
  id: 'production-test-seam',
  command: 'node',
  args: [
    '--test',
    '--test-reporter=dot',
    'test/research-dispatch-channel.test.mjs',
    'test/research-dispatch-label.test.mjs',
    'test/research-dispatch-record.test.mjs',
  ],
}]);

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
    throw new TypeError('RC1 v5 source bindings are invalid');
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

async function resolveBaseSha(repoRoot, baseRef) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--verify', `${baseRef}^{commit}`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 },
    );
    const baseSha = stdout.trim();
    if (!GIT_SHA1.test(baseSha)) throw new TypeError('base SHA is not SHA-1');
    return baseSha;
  } catch (error) {
    throw new TypeError(`RC1 v5 base refを解決できない: ${String(error?.code ?? error?.name ?? 'error')}`);
  }
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
  const errors = flattenErrors(error);
  const messages = errors.map((entry) => String(entry?.message ?? entry)).join('\n');
  const codes = new Set(errors.map((entry) => entry?.code).filter(Boolean));
  if (/source repository changed/i.test(messages) || codes.has('LATTICE_RC1_V5_BASE_DRIFT')) {
    return {
      kind: 'source_invariant_violation',
      reason: 'canonical source or observed Git base changed during isolated transform',
    };
  }
  if (/cleanup failed/i.test(messages)) {
    return { kind: 'cleanup_failure', reason: 'disposable worktree cleanup failed' };
  }
  if (/outside allowed paths|symlink change|submodule change|special file change/i.test(messages)
    || codes.has('LATTICE_RC1_V5_SCOPE_VIOLATION')
    || codes.has('LATTICE_RC1_V5_SURFACE_INVALID')) {
    return {
      kind: 'scope_violation',
      reason: 'isolated transform or fixed surface violated the accepted path scope',
    };
  }
  if (/black-box oracle failed|verifier failed|production-test seam incomplete/i.test(messages)) {
    return {
      kind: 'behavior_verification_failed',
      reason: 'fixed black-box oracle or production-test seam verifier failed',
    };
  }
  if (/mutated isolated snapshot/i.test(messages)
    || codes.has('LATTICE_RC1_V5_SURFACE_DRIFT')) {
    return {
      kind: 'snapshot_mutation',
      reason: 'oracle、verifier、observerの実行中にisolated snapshotが変化した',
    };
  }
  return { kind: 'execution_failure', reason: 'isolated transform or behavior binding failed' };
}

function sourceSnapshotDigest(pre, baseSha) {
  return pre?.surface_digest ?? digestArtifact({
    schema: 'lattice.rc1.unobserved_behavior_surface.v1',
    base_sha: baseSha,
    allowed_paths: RC1_V5_TRANSFORM_PATHS,
  });
}

function makeReceipt({ status, artifactDigest, envelopeDigest, fixedInputsDigest, sourceInvariant }) {
  const value = {
    schema: 'lattice.rc1.seam_transform_receipt.v5',
    status,
    transform_artifact_digest: artifactDigest,
    behavior_envelope_digest: envelopeDigest,
    fixed_inputs_digest: fixedInputsDigest,
    source_invariant: sourceInvariant ?? null,
  };
  return { ...value, receipt_digest: digestArtifact(value) };
}

function makeResult({ artifact, patch, behaviorEvidence, fixedInputsDigest, sourceInvariant }) {
  const artifactDigest = digestArtifact(artifact);
  const receipt = makeReceipt({
    status: artifact.status,
    artifactDigest,
    envelopeDigest: behaviorEvidence?.envelope?.envelope_digest ?? null,
    fixedInputsDigest,
    sourceInvariant,
  });
  return {
    schema: 'lattice.rc1.seam_transform_result.v5',
    artifact,
    artifact_digest: artifactDigest,
    receipt,
    receipt_digest: receipt.receipt_digest,
    patch: Buffer.isBuffer(patch) ? Buffer.from(patch) : null,
    behavior_evidence: behaviorEvidence ? structuredClone(behaviorEvidence) : null,
  };
}

function rejectedResult({
  error,
  evidence,
  sourceBindings,
  pre,
  output,
  fixedInputsDigest,
}) {
  const facts = rejectionFacts(error);
  const runnerReceipts = Array.isArray(evidence.verifications) ? evidence.verifications : [];
  const patch = Buffer.isBuffer(evidence.patch) ? evidence.patch : null;
  const outputAdmitted = output
    && Array.isArray(evidence.changedPaths)
    && sameArray(output.files.map(({ path: relativePath }) => relativePath), evidence.changedPaths);
  const changedPaths = outputAdmitted ? [...evidence.changedPaths] : [];
  const messages = flattenErrors(error).map((entry) => String(entry?.message ?? entry));
  const verificationStatus = runnerReceipts.length === 0 ? 'not_run' : 'failed';
  const rejection = { kind: facts.kind, reasons: [facts.reason] };
  const artifact = {
    schema: 'lattice.transform_artifact.v1',
    candidate_id: CANDIDATE_ID,
    status: 'rejected',
    source: {
      base_sha: evidence.baseSha,
      ...sourceBindings,
      code_snapshot_digest: sourceSnapshotDigest(pre, evidence.baseSha),
    },
    scope: {
      allowed_paths: [...RC1_V5_TRANSFORM_PATHS],
      changed_paths: changedPaths,
    },
    patch: { digest: patch ? sha256(patch) : null, bytes: patch?.byteLength ?? 0 },
    verification: verificationArtifact(verificationStatus, runnerReceipts),
    output: outputAdmitted ? structuredClone(output) : { snapshot_digest: null, files: [] },
    cleanup: {
      status: messages.some((message) => /cleanup failed/i.test(message)) ? 'failed' : 'passed',
      source_status: messages.some((message) => /source repository changed/i.test(message))
        ? 'changed'
        : 'unchanged',
    },
    rejection: { ...rejection, evidence_digest: digestArtifact(rejection) },
    unknowns: ['behavior evidence was not admitted'],
  };
  if (!validateTransformArtifact(artifact)) {
    throw new TypeError('RC1 v5 rejected transform artifact is invalid');
  }
  return makeResult({
    artifact,
    patch,
    behaviorEvidence: null,
    fixedInputsDigest,
    sourceInvariant: evidence.sourceInvariant,
  });
}

/** v4で固定済みの決定的production＋test seam writerをv5 isolationへ適用する。 */
export async function applyRc1V5Transform(context = {}) {
  return applyRc1V4Transform(context);
}

/**
 * 一つのdisposable worktreeでpre観測、seam変換、post観測を順序固定し、accepted artifactだけをenvelopeへbindする。
 */
export async function runRc1V5SeamTransform(options = {}) {
  if (!exactRecord(options, [
    'repoRoot',
    'baseRef',
    'oracle',
    'sourceBindings',
  ]) && !exactRecord(options, [
    'repoRoot',
    'baseRef',
    'oracle',
    'sourceBindings',
    'transform',
  ])) {
    throw new TypeError('RC1 v5 seam transform options must have the fixed exact shape');
  }
  const {
    repoRoot,
    baseRef,
    oracle,
    sourceBindings,
    transform = applyRc1V5Transform,
  } = options;
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || typeof baseRef !== 'string' || baseRef.length === 0
    || typeof transform !== 'function'
    || !validateRc1BlackBoxOracle(oracle)) {
    throw new TypeError('RC1 v5 seam transform arguments are invalid');
  }
  assertSourceBindings(sourceBindings);

  const fixedOracle = structuredClone(oracle);
  const fixedSourceBindings = structuredClone(sourceBindings);
  const oracleDigest = digestArtifact(fixedOracle);
  const fixedInputsDigest = digestArtifact({
    candidate_id: CANDIDATE_ID,
    allowed_paths: RC1_V5_TRANSFORM_PATHS,
    verifiers: VERIFIERS,
    oracle_digest: oracleDigest,
    source_bindings: fixedSourceBindings,
  });
  const baseSha = await resolveBaseSha(repoRoot, baseRef);
  let pre;
  let post;
  let output;
  let isolated;
  try {
    isolated = await runIsolatedTransform({
      repoRoot,
      baseRef: baseSha,
      allowedPaths: [...RC1_V5_TRANSFORM_PATHS],
      transform: async (context) => {
        pre = await runRc1V5BlackBoxOracle({
          repoRoot: context.worktreePath,
          oracle: fixedOracle,
          role: 'pre',
          baseSha,
          surfacePaths: [...RC1_V5_TRANSFORM_PATHS],
        });
        if (pre.outcome !== 'passed') throw new Error('black-box oracle failed before transform');
        await transform(context);
        post = await runRc1V5BlackBoxOracle({
          repoRoot: context.worktreePath,
          oracle: fixedOracle,
          role: 'post',
          baseSha,
          surfacePaths: [...RC1_V5_TRANSFORM_PATHS],
        });
        if (post.outcome !== 'passed') throw new Error('black-box oracle failed after transform');
      },
      verifyCommands: VERIFIERS.map(({ command, args }) => ({ command, args: [...args] })),
      observe: async ({ worktreePath, changedPaths }) => {
        output = await outputArtifact(worktreePath, changedPaths);
      },
    });

    const postProjection = post?.surface?.files?.map((file) => (
      file.state === 'present'
        ? { path: file.path, content_digest: file.content_digest }
        : null
    ));
    if (!pre || !post || !output
      || pre.outcome !== 'passed' || post.outcome !== 'passed'
      || pre.oracle_digest !== oracleDigest || post.oracle_digest !== oracleDigest
      || pre.base_sha !== baseSha || post.base_sha !== baseSha
      || !sameArray(
        pre.surface.files.map(({ path: relativePath }) => relativePath),
        RC1_V5_TRANSFORM_PATHS,
      )
      || !Array.isArray(postProjection) || postProjection.some((file) => file === null)
      || !sameArray(isolated.changedPaths, RC1_V5_TRANSFORM_PATHS)
      || !Buffer.isBuffer(isolated.patch)
      || isolated.verifications.length !== VERIFIERS.length
      || isolated.sourceInvariant?.outcome !== 'passed'
      || digestArtifact({ files: postProjection }) !== output.snapshot_digest
      || digestArtifact(postProjection) !== digestArtifact(output.files)) {
      throw new Error('production-test seam incomplete');
    }

    const artifact = {
      schema: 'lattice.transform_artifact.v1',
      candidate_id: CANDIDATE_ID,
      status: 'accepted',
      source: {
        base_sha: isolated.baseSha,
        ...fixedSourceBindings,
        code_snapshot_digest: pre.surface_digest,
      },
      scope: {
        allowed_paths: [...RC1_V5_TRANSFORM_PATHS],
        changed_paths: [...isolated.changedPaths],
      },
      patch: { digest: sha256(isolated.patch), bytes: isolated.patch.byteLength },
      verification: verificationArtifact('passed', isolated.verifications),
      output,
      cleanup: { status: 'passed', source_status: 'unchanged' },
      rejection: null,
      unknowns: [],
    };
    if (!validateTransformArtifact(artifact)) {
      throw new TypeError('RC1 v5 accepted transform artifact is invalid');
    }
    const envelope = compileRc1V5BehaviorEvidence({
      preReceipt: pre,
      postReceipt: post,
      transformArtifact: artifact,
      patchDigest: artifact.patch.digest,
    });
    const behaviorEvidence = {
      pre_receipt: pre,
      post_receipt: post,
      envelope,
      transform_artifact: artifact,
      patch_digest: artifact.patch.digest,
    };
    return makeResult({
      artifact,
      patch: isolated.patch,
      behaviorEvidence,
      fixedInputsDigest,
      sourceInvariant: isolated.sourceInvariant,
    });
  } catch (error) {
    const evidence = transformEvidence(error) ?? isolated;
    if (!evidence || typeof evidence.baseSha !== 'string') throw error;
    return rejectedResult({
      error,
      evidence,
      sourceBindings: fixedSourceBindings,
      pre,
      output,
      fixedInputsDigest,
    });
  }
}
