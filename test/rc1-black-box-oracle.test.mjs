import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  runRc1BlackBoxOracle,
  validateRc1BlackBoxOracle,
} from '../src/rc1-black-box-oracle.mjs';
import { validateRc1V5BehaviorReceipt } from '../src/rc1-v5-behavior-evidence.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SURFACE_PATHS = Object.freeze([
  'research/fixtures/dispatch-record/src/dispatch-channel.mjs',
  'research/fixtures/dispatch-record/src/dispatch-label.mjs',
  FIXTURE,
  'test/research-dispatch-channel.test.mjs',
  'test/research-dispatch-label.test.mjs',
  'test/research-dispatch-record.test.mjs',
].sort());

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function temporaryGitRepo(t, files) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc1-v5-oracle-'));
  t.after(async () => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const target = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }));
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['config', 'user.email', 'lattice-test@example.invalid']);
  git(repoRoot, ['add', '--all']);
  git(repoRoot, ['commit', '-q', '-m', 'fixture']);
  return { repoRoot, baseSha: git(repoRoot, ['rev-parse', 'HEAD']) };
}

async function oracleInput() {
  return JSON.parse(await readFile(new URL(
    '../research/campaigns/rc1/inputs/behavior-oracle-v2.json',
    import.meta.url,
  ), 'utf8'));
}

async function fixtureOracle({ entrypoint, exportName, cases }) {
  const oracle = await oracleInput();
  oracle.entrypoint = entrypoint;
  oracle.export_name = exportName;
  oracle.cases = cases;
  return oracle;
}

test('fixed transform-external oracle passes all current behavior cases deterministically', async () => {
  const oracle = await oracleInput();
  const before = structuredClone(oracle);
  const first = await runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle });
  const second = await runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: structuredClone(oracle) });

  assert.equal(validateRc1BlackBoxOracle(oracle), true);
  assert.deepEqual(oracle, before);
  assert.equal(first.schema, 'lattice.rc1.black_box_behavior_receipt.v2');
  assert.equal(first.outcome, 'passed');
  assert.deepEqual(first.case_results.map(({ outcome }) => outcome), Array(8).fill('passed'));
  assert.equal(first.oracle_digest.length, 64);
  assert.equal(first.receipt_digest.length, 64);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(first).includes(REPO_ROOT), false);
});

test('oracle divergence is a typed failed receipt and does not rewrite the expectation', async () => {
  const oracle = await oracleInput();
  const drifted = structuredClone(oracle);
  drifted.cases.find(({ id }) => id === 'routine-record').expected.value.channel = 'wrong';
  const before = structuredClone(drifted);
  const receipt = await runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: drifted });

  assert.deepEqual(drifted, before);
  assert.equal(receipt.outcome, 'failed');
  assert.deepEqual(
    receipt.case_results.filter(({ outcome }) => outcome === 'failed').map(({ id }) => id),
    ['routine-record'],
  );
  assert.ok(receipt.case_results.every(({ expected_digest, observed_digest }) => (
    expected_digest.length === 64 && observed_digest.length === 64
  )));
});

test('oracle schema and transform-external scope fail closed', async () => {
  const oracle = await oracleInput();
  const traversal = structuredClone(oracle);
  traversal.entrypoint = '../outside.mjs';
  assert.equal(validateRc1BlackBoxOracle(traversal), false);
  await assert.rejects(
    runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: traversal }),
    /oracle.*contract|entrypoint/i,
  );

  const writableExecutor = structuredClone(oracle);
  writableExecutor.transform_scope_contract.executor_writable = true;
  assert.equal(validateRc1BlackBoxOracle(writableExecutor), false);
  await assert.rejects(
    runRc1BlackBoxOracle({ repoRoot: REPO_ROOT, oracle: writableExecutor }),
    /oracle.*contract|scope/i,
  );
});

test('v5 receipt binds role, git base, entrypoint content, and the full fixed surface', async () => {
  const { runRc1V5BlackBoxOracle } = await import('../src/rc1-black-box-oracle.mjs');
  const oracle = await oracleInput();
  const baseSha = git(REPO_ROOT, ['rev-parse', 'HEAD']);
  const pre = await runRc1V5BlackBoxOracle({
    repoRoot: REPO_ROOT,
    oracle,
    role: 'pre',
    baseSha,
    surfacePaths: [...SURFACE_PATHS],
  });
  const post = await runRc1V5BlackBoxOracle({
    repoRoot: REPO_ROOT,
    oracle: structuredClone(oracle),
    role: 'post',
    baseSha,
    surfacePaths: [...SURFACE_PATHS],
  });

  assert.equal(pre.schema, 'lattice.rc1.black_box_behavior_receipt.v3');
  assert.equal(validateRc1V5BehaviorReceipt(pre), true);
  assert.equal(validateRc1V5BehaviorReceipt(post), true);
  assert.equal(pre.role, 'pre');
  assert.equal(post.role, 'post');
  assert.equal(pre.base_sha, baseSha);
  assert.equal(post.base_sha, baseSha);
  assert.equal(pre.outcome, 'passed');
  assert.equal(post.outcome, 'passed');
  assert.deepEqual(pre.surface.files.map(({ path: surfacePath }) => surfacePath), SURFACE_PATHS);
  assert.equal(pre.surface_digest, post.surface_digest);
  assert.notEqual(pre.receipt_digest, post.receipt_digest);
  assert.equal(
    pre.surface.files.find(({ path: surfacePath }) => surfacePath === FIXTURE).content_digest,
    pre.entrypoint_content_digest,
  );
  assert.equal(pre.observation.before_surface_digest, pre.surface_digest);
  assert.equal(pre.observation.after_surface_digest, pre.surface_digest);
  assert.equal(JSON.stringify(pre).includes(REPO_ROOT), false);
});

test('v5 oracle rejects a false base identity and transform-writable oracle scope', async () => {
  const { runRc1V5BlackBoxOracle } = await import('../src/rc1-black-box-oracle.mjs');
  const oracle = await oracleInput();
  const baseSha = git(REPO_ROOT, ['rev-parse', 'HEAD']);
  await assert.rejects(
    runRc1V5BlackBoxOracle({
      repoRoot: REPO_ROOT,
      oracle,
      role: 'pre',
      baseSha: 'f'.repeat(40),
      surfacePaths: [...SURFACE_PATHS],
    }),
    (error) => error?.code === 'LATTICE_RC1_V5_BASE_MISMATCH',
  );
  await assert.rejects(
    runRc1V5BlackBoxOracle({
      repoRoot: REPO_ROOT,
      oracle,
      role: 'pre',
      baseSha,
      surfacePaths: [...SURFACE_PATHS, 'src/rc1-black-box-oracle.mjs'].sort(),
    }),
    (error) => error?.code === 'LATTICE_RC1_V5_SCOPE_VIOLATION',
  );
});

test('v4 in-process module cache can miss dependency-only behavior drift', async (t) => {
  const entrypoint = 'src/entry.mjs';
  const dependency = 'src/dependency.mjs';
  const { repoRoot } = await temporaryGitRepo(t, {
    [entrypoint]: [
      "import { readValue } from './dependency.mjs';",
      'export function observe() {',
      '  return Object.freeze({ value: readValue() });',
      '}',
      '',
    ].join('\n'),
    [dependency]: [
      'export function readValue() {',
      "  return 'before';",
      '}',
      '',
    ].join('\n'),
  });
  const oracle = await fixtureOracle({
    entrypoint,
    exportName: 'observe',
    cases: [{
      id: 'dependency-value',
      input: null,
      expected: {
        kind: 'return',
        value: { value: 'before' },
        frozen: true,
      },
    }],
  });
  const pre = await runRc1BlackBoxOracle({ repoRoot, oracle });
  await writeFile(path.join(repoRoot, dependency), [
    'export function readValue() {',
    "  return 'after';",
    '}',
    '',
  ].join('\n'));
  const post = await runRc1BlackBoxOracle({ repoRoot, oracle });

  assert.equal(pre.outcome, 'passed');
  assert.equal(post.outcome, 'passed');
  assert.deepEqual(post, pre);
});

test('v5 oracle uses a fresh module graph and detects dependency-only behavior drift', async (t) => {
  const { runRc1V5BlackBoxOracle } = await import('../src/rc1-black-box-oracle.mjs');
  const entrypoint = 'src/entry.mjs';
  const dependency = 'src/dependency.mjs';
  const { repoRoot, baseSha } = await temporaryGitRepo(t, {
    [entrypoint]: [
      "import { readValue } from './dependency.mjs';",
      'export function observe() {',
      '  return Object.freeze({ value: readValue() });',
      '}',
      '',
    ].join('\n'),
    [dependency]: [
      'export function readValue() {',
      "  return 'before';",
      '}',
      '',
    ].join('\n'),
  });
  const oracle = await fixtureOracle({
    entrypoint,
    exportName: 'observe',
    cases: [{
      id: 'dependency-value',
      input: null,
      expected: {
        kind: 'return',
        value: { value: 'before' },
        frozen: true,
      },
    }],
  });
  const surfacePaths = [dependency, entrypoint].sort();
  const pre = await runRc1V5BlackBoxOracle({
    repoRoot,
    oracle,
    role: 'pre',
    baseSha,
    surfacePaths,
  });
  await writeFile(path.join(repoRoot, dependency), [
    'export function readValue() {',
    "  return 'after';",
    '}',
    '',
  ].join('\n'));
  const post = await runRc1V5BlackBoxOracle({
    repoRoot,
    oracle,
    role: 'post',
    baseSha,
    surfacePaths,
  });

  assert.equal(pre.outcome, 'passed');
  assert.equal(post.outcome, 'failed');
  assert.equal(post.case_results[0].outcome, 'failed');
  assert.notEqual(pre.surface_digest, post.surface_digest);
  assert.equal(validateRc1V5BehaviorReceipt(pre), true);
  assert.equal(validateRc1V5BehaviorReceipt(post), true);
});

test('v5 oracle rejects surface mutation during observation with typed drift evidence', async (t) => {
  const { runRc1V5BlackBoxOracle } = await import('../src/rc1-black-box-oracle.mjs');
  const entrypoint = 'src/entry.mjs';
  const watched = 'src/watched.txt';
  const { repoRoot, baseSha } = await temporaryGitRepo(t, {
    [entrypoint]: [
      "import { writeFile } from 'node:fs/promises';",
      'export async function mutate() {',
      "  await writeFile(new URL('./watched.txt', import.meta.url), 'changed\\n');",
      "  return Object.freeze({ status: 'ok' });",
      '}',
      '',
    ].join('\n'),
    [watched]: 'stable\n',
  });
  const oracle = await fixtureOracle({
    entrypoint,
    exportName: 'mutate',
    cases: [{
      id: 'mutating-call',
      input: null,
      expected: {
        kind: 'return',
        value: { status: 'ok' },
        frozen: true,
      },
    }],
  });

  await assert.rejects(
    runRc1V5BlackBoxOracle({
      repoRoot,
      oracle,
      role: 'pre',
      baseSha,
      surfacePaths: [entrypoint, watched].sort(),
    }),
    (error) => error?.code === 'LATTICE_RC1_V5_SURFACE_DRIFT'
      && typeof error?.evidence?.before_surface_digest === 'string'
      && typeof error?.evidence?.after_surface_digest === 'string'
      && error.evidence.before_surface_digest !== error.evidence.after_surface_digest,
  );
});
