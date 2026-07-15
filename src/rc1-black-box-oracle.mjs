import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';

const IDENTIFIER = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;
const EXECUTOR_REF = 'src/rc1-black-box-oracle.mjs';
const ORACLE_INPUT_REF = 'research/campaigns/rc1/inputs/behavior-oracle-v2.json';
const REQUIRED_EXCLUDED_PATHS = Object.freeze([ORACLE_INPUT_REF, EXECUTOR_REF].sort());

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
