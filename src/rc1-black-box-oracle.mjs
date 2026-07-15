import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  open,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads';

import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';

const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const EXECUTOR_REF = 'src/rc1-black-box-oracle.mjs';
const ORACLE_INPUT_REF = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';
const REQUIRED_EXCLUDED_PATHS = Object.freeze([ORACLE_INPUT_REF, EXECUTOR_REF].sort());
const V5_WORKER_REQUEST = 'lattice.rc1.oracle_worker_request.v1';
const V5_WORKER_RESULT = 'lattice.rc1.oracle_worker_result.v1';
const V5_WORKER_FAILURE = 'lattice.rc1.oracle_worker_failure.v1';
const execFileAsync = promisify(execFile);

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

export class Rc1V5OracleRejection extends Error {
  constructor(code, reason, evidence = {}) {
    super('RC1 v5 black-box oracle rejection: ' + reason);
    this.name = 'Rc1V5OracleRejection';
    this.code = code;
    this.evidence = Object.freeze(structuredClone(evidence));
  }
}

function v5Rejection(code, reason, evidence = {}) {
  return new Rc1V5OracleRejection(code, reason, evidence);
}

function v5RepoPath(value) {
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

function sortedSurfacePaths(value) {
  try {
    canonicalizeArtifact(value);
  } catch {
    return false;
  }
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 128
    && value.every((entry, index) => (
      v5RepoPath(entry)
        && (index === 0 || value[index - 1] < entry)
    ));
}

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative);
}

function boundedText(value, maximum = 4_096) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function repoPath(value) {
  return boundedText(value, 1_024)
    && !value.includes('\0')
    && !path.posix.isAbsolute(value)
    && value === path.posix.normalize(value)
    && !value.split('/').includes('..');
}

function validExpected(value) {
  if (!isPlainObject(value)) return false;
  if (value.kind === 'return') {
    return exactRecord(value, ['kind', 'value', 'frozen'])
      && typeof value.frozen === 'boolean';
  }
  return value.kind === 'throw'
    && exactRecord(value, ['kind', 'name', 'message'])
    && boundedText(value.name, 256)
    && boundedText(value.message);
}

function validateOracle(value) {
  if (!exactRecord(value, [
    'schema',
    'entrypoint',
    'export_name',
    'executor_ref',
    'transform_scope_contract',
    'cases',
  ])
    || value.schema !== 'lattice.rc1.black_box_behavior_oracle.v2'
    || !repoPath(value.entrypoint)
    || typeof value.export_name !== 'string'
    || !IDENTIFIER.test(value.export_name)
    || value.executor_ref !== EXECUTOR_REF
    || !exactRecord(value.transform_scope_contract, [
      'oracle_input_writable',
      'executor_writable',
      'excluded_paths',
    ])
    || value.transform_scope_contract.oracle_input_writable !== false
    || value.transform_scope_contract.executor_writable !== false
    || !Array.isArray(value.transform_scope_contract.excluded_paths)
    || value.transform_scope_contract.excluded_paths.length !== REQUIRED_EXCLUDED_PATHS.length
    || !value.transform_scope_contract.excluded_paths.every(repoPath)
    || !value.transform_scope_contract.excluded_paths
      .slice().sort().every((entry, index) => entry === REQUIRED_EXCLUDED_PATHS[index])
    || !Array.isArray(value.cases)
    || value.cases.length === 0
    || value.cases.length > 64) {
    return false;
  }

  const ids = new Set();
  for (const oracleCase of value.cases) {
    if (!exactRecord(oracleCase, ['id', 'input', 'expected'])
      || typeof oracleCase.id !== 'string'
      || !IDENTIFIER.test(oracleCase.id)
      || ids.has(oracleCase.id)
      || !validExpected(oracleCase.expected)) {
      return false;
    }
    ids.add(oracleCase.id);
    canonicalizeArtifact(oracleCase.input);
    canonicalizeArtifact(oracleCase.expected);
  }
  canonicalizeArtifact(value);
  return true;
}

/** @param {unknown} value @returns {boolean} */
export function validateRc1BlackBoxOracle(value) {
  try {
    return validateOracle(value);
  } catch {
    return false;
  }
}

function fail(reason) {
  throw new TypeError(`RC1 v4 black-box oracle契約違反: ${reason}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function expectedObservation(expected) {
  if (expected.kind === 'return') {
    return { kind: 'return', value: expected.value, frozen: expected.frozen };
  }
  return { kind: 'throw', name: expected.name, message: expected.message };
}

function thrownObservation(error) {
  return {
    kind: 'throw',
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
  };
}

function observationDigest(value) {
  try {
    return digestArtifact(value);
  } catch {
    return digestArtifact({ kind: 'unserializable' });
  }
}

function validV5CaseResult(value) {
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
    && typeof value.expected_digest === 'string'
    && SHA256.test(value.expected_digest)
    && typeof value.observed_digest === 'string'
    && SHA256.test(value.observed_digest);
}

async function executeV5WorkerRequest(request) {
  if (!exactRecord(request, ['schema', 'entrypoint_url', 'export_name', 'cases'])
    || request.schema !== V5_WORKER_REQUEST
    || typeof request.entrypoint_url !== 'string'
    || typeof request.export_name !== 'string'
    || !IDENTIFIER.test(request.export_name)
    || !Array.isArray(request.cases)
    || request.cases.length === 0
    || request.cases.length > 64) {
    throw new TypeError('worker request contract is invalid');
  }
  const targetModule = await import(request.entrypoint_url);
  const target = targetModule[request.export_name];
  if (typeof target !== 'function') throw new TypeError('entrypoint export is not a function');

  const caseResults = [];
  for (const oracleCase of request.cases) {
    const expected = expectedObservation(oracleCase.expected);
    let observed;
    try {
      const value = await target(structuredClone(oracleCase.input));
      observed = { kind: 'return', value, frozen: Object.isFrozen(value) };
    } catch (error) {
      observed = thrownObservation(error);
    }
    caseResults.push({
      id: oracleCase.id,
      outcome: isDeepStrictEqual(observed, expected) ? 'passed' : 'failed',
      observed_kind: observed.kind,
      expected_digest: digestArtifact(expected),
      observed_digest: observationDigest(observed),
    });
  }
  return { schema: V5_WORKER_RESULT, case_results: caseResults };
}

function freshWorkerCaseResults({ entrypointUrl, exportName, cases }) {
  const request = {
    schema: V5_WORKER_REQUEST,
    entrypoint_url: entrypointUrl,
    export_name: exportName,
    cases: structuredClone(cases),
  };
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL(import.meta.url), { workerData: request });
    } catch (error) {
      reject(v5Rejection(
        'LATTICE_RC1_V5_EXECUTION_FAILED',
        'fresh workerを起動できない',
        { error_digest: sha256(String(error?.message ?? error)) },
      ));
      return;
    }
    let settled = false;
    const rejectOnce = (reason, evidence) => {
      if (settled) return;
      settled = true;
      reject(v5Rejection('LATTICE_RC1_V5_EXECUTION_FAILED', reason, evidence));
    };
    worker.once('message', (message) => {
      if (settled) return;
      if (exactRecord(message, ['schema', 'case_results'])
        && message.schema === V5_WORKER_RESULT
        && Array.isArray(message.case_results)
        && message.case_results.length === cases.length
        && message.case_results.every(validV5CaseResult)
        && message.case_results.every(({ id }, index) => id === cases[index].id)) {
        settled = true;
        resolve(structuredClone(message.case_results));
        return;
      }
      if (exactRecord(message, ['schema', 'error_digest'])
        && message.schema === V5_WORKER_FAILURE
        && typeof message.error_digest === 'string'
        && SHA256.test(message.error_digest)) {
        rejectOnce('fresh worker内のoracle実行が失敗した', {
          error_digest: message.error_digest,
        });
        return;
      }
      rejectOnce('fresh worker response contractが不正', {
        response_digest: observationDigest(message),
      });
    });
    worker.once('error', (error) => {
      rejectOnce('fresh workerがerrorを返した', {
        error_digest: sha256(String(error?.message ?? error)),
      });
    });
    worker.once('exit', (exitCode) => {
      if (!settled) {
        rejectOnce('fresh workerがreceiptなしで終了した', {
          exit_code: Number.isSafeInteger(exitCode) ? exitCode : -1,
        });
      }
    });
  });
}

async function resolveV5RepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw v5Rejection('LATTICE_RC1_V5_INPUT_INVALID', 'repoRootが不正');
  }
  try {
    const root = await realpath(repoRoot);
    const stat = await lstat(root);
    if (!stat.isDirectory()) throw new TypeError('not a directory');
    return root;
  } catch (error) {
    if (error instanceof Rc1V5OracleRejection) throw error;
    throw v5Rejection('LATTICE_RC1_V5_REPO_INVALID', 'repoRootを実在repoとして解決できない', {
      error_digest: sha256(String(error?.code ?? error?.name ?? 'error')),
    });
  }
}

async function currentGitHead(repoRoot) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 },
    );
    const head = stdout.trim();
    if (!GIT_SHA1.test(head)) throw new TypeError('HEAD is not SHA-1');
    return head;
  } catch (error) {
    throw v5Rejection('LATTICE_RC1_V5_REPO_INVALID', 'Git HEADを解決できない', {
      error_digest: sha256(String(error?.code ?? error?.name ?? 'error')),
    });
  }
}

async function assertSafeSurfaceAncestors(root, target, relativePath) {
  let current = path.dirname(target);
  while (current !== root) {
    if (!pathInside(root, current)) {
      throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface pathがrepo root外を指す', {
        path: relativePath,
      });
    }
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface ancestorが安全なdirectoryでない', {
          path: relativePath,
        });
      }
      const resolved = await realpath(current);
      if (resolved !== current || !pathInside(root, resolved)) {
        throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface ancestorがsymlinkを含む', {
          path: relativePath,
        });
      }
    } catch (error) {
      if (error instanceof Rc1V5OracleRejection) throw error;
      if (error?.code !== 'ENOENT') {
        throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface ancestorを観測できない', {
          path: relativePath,
          error_digest: sha256(String(error?.code ?? error?.name ?? 'error')),
        });
      }
    }
    current = path.dirname(current);
  }
}

async function captureV5Surface(root, surfacePaths) {
  const files = [];
  for (const relativePath of surfacePaths) {
    const target = path.resolve(root, relativePath);
    if (!pathInside(root, target)) {
      throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface pathがrepo root外を指す', {
        path: relativePath,
      });
    }
    await assertSafeSurfaceAncestors(root, target, relativePath);
    let stat;
    try {
      stat = await lstat(target);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        files.push({ path: relativePath, state: 'absent', content_digest: null });
        continue;
      }
      throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface pathを観測できない', {
        path: relativePath,
        error_digest: sha256(String(error?.code ?? error?.name ?? 'error')),
      });
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface pathがregular fileでない', {
        path: relativePath,
      });
    }
    const resolved = await realpath(target);
    if (resolved !== target || !pathInside(root, resolved)) {
      throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface pathがsymlinkを含む', {
        path: relativePath,
      });
    }
    let handle;
    try {
      const noFollow = fsConstants.O_NOFOLLOW ?? 0;
      handle = await open(target, fsConstants.O_RDONLY | noFollow);
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) {
        throw new TypeError('opened surface is not a regular file');
      }
      files.push({
        path: relativePath,
        state: 'present',
        content_digest: sha256(await handle.readFile()),
      });
    } catch (error) {
      throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'surface fileを安定して読めない', {
        path: relativePath,
        error_digest: sha256(String(error?.code ?? error?.name ?? 'error')),
      });
    } finally {
      await handle?.close();
    }
  }
  const surface = {
    schema: 'lattice.rc1.behavior_surface_snapshot.v1',
    files,
  };
  return { surface, digest: digestArtifact(surface) };
}

async function resolveEntrypoint(repoRoot, entrypoint) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) fail('repoRootが不正');
  const root = await realpath(repoRoot);
  const target = await realpath(path.resolve(root, entrypoint));
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('entrypointがrepo root外を指す');
  }
  return target;
}

/**
 * transform scope外の固定oracleからfixture entrypointを実行し、portable receiptを返す。
 * @param {{repoRoot: string, oracle: unknown}} options
 */
export async function runRc1BlackBoxOracle({ repoRoot, oracle } = {}) {
  if (!validateRc1BlackBoxOracle(oracle)) fail('oracle input contractが不正');
  const entrypoint = await resolveEntrypoint(repoRoot, oracle.entrypoint);
  const contentDigest = sha256(await readFile(entrypoint));
  const moduleUrl = pathToFileURL(entrypoint);
  moduleUrl.searchParams.set('lattice-oracle', contentDigest);
  const targetModule = await import(moduleUrl.href);
  const target = targetModule[oracle.export_name];
  if (typeof target !== 'function') fail('entrypoint exportがfunctionでない');

  const caseResults = [];
  for (const oracleCase of oracle.cases) {
    const expected = expectedObservation(oracleCase.expected);
    let observed;
    try {
      const value = await target(structuredClone(oracleCase.input));
      observed = { kind: 'return', value, frozen: Object.isFrozen(value) };
    } catch (error) {
      observed = thrownObservation(error);
    }
    caseResults.push({
      id: oracleCase.id,
      outcome: isDeepStrictEqual(observed, expected) ? 'passed' : 'failed',
      observed_kind: observed.kind,
      expected_digest: digestArtifact(expected),
      observed_digest: observationDigest(observed),
    });
  }

  const receipt = {
    schema: 'lattice.rc1.black_box_behavior_receipt.v2',
    oracle_digest: digestArtifact(oracle),
    entrypoint: oracle.entrypoint,
    export_name: oracle.export_name,
    outcome: caseResults.every(({ outcome }) => outcome === 'passed') ? 'passed' : 'failed',
    case_results: caseResults,
  };
  return { ...receipt, receipt_digest: digestArtifact(receipt) };
}

/**
 * role／Git base／fixed surfaceへbindしたreceipt v3をfresh module graphから生成する。
 */
export async function runRc1V5BlackBoxOracle(options = {}) {
  if (!exactRecord(options, ['repoRoot', 'oracle', 'role', 'baseSha', 'surfacePaths'])
    || !validateRc1BlackBoxOracle(options.oracle)
    || (options.role !== 'pre' && options.role !== 'post')
    || typeof options.baseSha !== 'string'
    || !GIT_SHA1.test(options.baseSha)
    || !sortedSurfacePaths(options.surfacePaths)
    || !options.surfacePaths.includes(options.oracle.entrypoint)) {
    throw v5Rejection('LATTICE_RC1_V5_INPUT_INVALID', 'v5 oracle input contractが不正');
  }
  const { repoRoot, role, baseSha } = options;
  const oracle = structuredClone(options.oracle);
  const surfacePaths = [...options.surfacePaths];
  const scopeConflicts = surfacePaths.filter((surfacePath) => (
    oracle.transform_scope_contract.excluded_paths.includes(surfacePath)
  ));
  if (scopeConflicts.length > 0) {
    throw v5Rejection(
      'LATTICE_RC1_V5_SCOPE_VIOLATION',
      'oracle inputまたはexecutorがtransform surfaceに含まれる',
      { conflicting_paths: scopeConflicts },
    );
  }

  const root = await resolveV5RepoRoot(repoRoot);
  const actualHead = await currentGitHead(root);
  if (actualHead !== baseSha) {
    throw v5Rejection('LATTICE_RC1_V5_BASE_MISMATCH', 'base SHAが実Git HEADと一致しない', {
      expected_base_sha: baseSha,
      observed_base_sha: actualHead,
    });
  }

  const before = await captureV5Surface(root, surfacePaths);
  const entrypointFile = before.surface.files.find(({ path: surfacePath }) => (
    surfacePath === oracle.entrypoint
  ));
  if (entrypointFile?.state !== 'present') {
    throw v5Rejection('LATTICE_RC1_V5_SURFACE_INVALID', 'entrypointがfixed surfaceに存在しない', {
      path: oracle.entrypoint,
    });
  }
  const moduleUrl = pathToFileURL(path.resolve(root, oracle.entrypoint));
  moduleUrl.searchParams.set('lattice-oracle-v5', entrypointFile.content_digest);
  const caseResults = await freshWorkerCaseResults({
    entrypointUrl: moduleUrl.href,
    exportName: oracle.export_name,
    cases: oracle.cases,
  });
  const after = await captureV5Surface(root, surfacePaths);
  if (before.digest !== after.digest) {
    throw v5Rejection(
      'LATTICE_RC1_V5_SURFACE_DRIFT',
      'oracle観測中にfixed surfaceが変化した',
      {
        before_surface_digest: before.digest,
        after_surface_digest: after.digest,
      },
    );
  }
  const afterHead = await currentGitHead(root);
  if (afterHead !== actualHead) {
    throw v5Rejection('LATTICE_RC1_V5_BASE_DRIFT', 'oracle観測中にGit HEADが変化した', {
      before_base_sha: actualHead,
      after_base_sha: afterHead,
    });
  }

  const receipt = {
    schema: 'lattice.rc1.black_box_behavior_receipt.v3',
    role,
    base_sha: actualHead,
    oracle_digest: digestArtifact(oracle),
    entrypoint: oracle.entrypoint,
    export_name: oracle.export_name,
    entrypoint_content_digest: entrypointFile.content_digest,
    surface: before.surface,
    surface_digest: before.digest,
    observation: {
      before_surface_digest: before.digest,
      after_surface_digest: after.digest,
    },
    outcome: caseResults.every(({ outcome }) => outcome === 'passed') ? 'passed' : 'failed',
    case_results: caseResults,
  };
  return { ...receipt, receipt_digest: digestArtifact(receipt) };
}

if (!isMainThread && workerData?.schema === V5_WORKER_REQUEST && parentPort !== null) {
  let response;
  try {
    response = await executeV5WorkerRequest(workerData);
  } catch (error) {
    response = {
      schema: V5_WORKER_FAILURE,
      error_digest: sha256(String(error?.message ?? error)),
    };
  }
  parentPort.postMessage(response);
}
