import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import nodeTest from 'node:test';

const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

import { runIsolatedTransform } from '../src/isolation-runner.mjs';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function makeRepo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-isolation-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  await writeFile(path.join(repoRoot, 'allowed.txt'), 'before\n');
  git(repoRoot, ['add', 'allowed.txt']);
  git(repoRoot, ['commit', '-m', 'initial']);
  return repoRoot;
}

test('許可パスの変更をbinary patchとして返し、observeはcleanup前に実行する', async (t) => {
  const repoRoot = await makeRepo(t);
  const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
  let observed = false;
  const result = await runIsolatedTransform({
    repoRoot,
    baseRef: 'HEAD',
    allowedPaths: ['allowed.txt', 'new.bin'],
    transform: async ({ worktreePath }) => {
      await writeFile(path.join(worktreePath, 'allowed.txt'), 'after\n');
      await writeFile(path.join(worktreePath, 'new.bin'), Buffer.from([0, 0xff, 1]));
    },
    verifyCommands: [{ command: process.execPath, args: ['--version'] }],
    observe: async ({ worktreePath, changedPaths }) => {
      observed = true;
      assert.deepEqual(changedPaths, ['allowed.txt', 'new.bin']);
      assert.equal(await readFile(path.join(worktreePath, 'allowed.txt'), 'utf8'), 'after\n');
    },
  });

  assert.equal(observed, true);
  assert.deepEqual(result.changedPaths, ['allowed.txt', 'new.bin']);
  assert.equal(Buffer.isBuffer(result.patch), true);
  assert.match(result.patch.toString('utf8'), /new\.bin/);
  assert.deepEqual(result.verifications, [{
    command: process.execPath,
    args: ['--version'],
    outcome: 'passed',
    exit_code: 0,
    stdout_digest: digest(`${process.version}\n`),
    stderr_digest: digest(''),
  }]);
  assert.equal(result.sourceInvariant.schema, 'lattice.source_invariant_receipt.v1');
  assert.equal(result.sourceInvariant.outcome, 'passed');
  assert.deepEqual(result.sourceInvariant.protected_paths, ['src', 'test']);
  assert.equal(result.sourceInvariant.protected_content.equal, true);
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), sourceHead);
  assert.equal(await readFile(path.join(repoRoot, 'allowed.txt'), 'utf8'), 'before\n');
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
});

test('許可範囲外の変更をrejectし、source repoを変更しない', async (t) => {
  const repoRoot = await makeRepo(t);
  const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: ({ worktreePath }) => writeFile(path.join(worktreePath, 'outside.txt'), 'nope\n'),
      verifyCommands: [],
    }),
    /allowed paths|outside\.txt/i,
  );
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), sourceHead);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(repoRoot, 'allowed.txt'), 'utf8'), 'before\n');
});

test('verifier失敗でも一時worktreeをcleanupし、source repoを変更しない', async (t) => {
  const repoRoot = await makeRepo(t);
  const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: ({ worktreePath }) => writeFile(path.join(worktreePath, 'allowed.txt'), 'after\n'),
      verifyCommands: [{ command: process.execPath, args: ['-e', 'process.exit(7)'] }],
    }),
    (error) => {
      assert.match(error.message, /verifier.*7/i);
      assert.deepEqual(error.transformEvidence.changedPaths, ['allowed.txt']);
      assert.equal(Buffer.isBuffer(error.transformEvidence.patch), true);
      assert.deepEqual(error.transformEvidence.verifications, [{
        command: process.execPath,
        args: ['-e', 'process.exit(7)'],
        outcome: 'failed',
        exit_code: 7,
        stdout_digest: digest(''),
        stderr_digest: digest(''),
      }]);
      return true;
    },
  );
  assert.equal(git(repoRoot, ['rev-parse', 'HEAD']), sourceHead);
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(repoRoot, 'allowed.txt'), 'utf8'), 'before\n');
  assert.equal(git(repoRoot, ['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
});

test('ignored fileへの許可範囲外writeをfail closedにする', async (t) => {
  const repoRoot = await makeRepo(t);
  await writeFile(path.join(repoRoot, '.gitignore'), 'ignored.txt\n');
  git(repoRoot, ['add', '.gitignore']);
  git(repoRoot, ['commit', '-m', 'ignore generated file']);

  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: ({ worktreePath }) => writeFile(path.join(worktreePath, 'ignored.txt'), 'hidden\n'),
      verifyCommands: [],
    }),
    /ignored|allowed paths/i,
  );
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
});

test('verifierがsnapshotを変異させた場合はrejectする', async (t) => {
  const repoRoot = await makeRepo(t);
  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: ({ worktreePath }) => writeFile(path.join(worktreePath, 'allowed.txt'), 'bad\n'),
      verifyCommands: [{ command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('allowed.txt', 'passing\\n')"] }],
    }),
    /verifier mutated isolated snapshot/i,
  );
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
});

test('observeがsnapshotを変異させた場合はrejectする', async (t) => {
  const repoRoot = await makeRepo(t);
  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: ({ worktreePath }) => writeFile(path.join(worktreePath, 'allowed.txt'), 'before-observe\n'),
      verifyCommands: [],
      observe: ({ worktreePath }) => writeFile(path.join(worktreePath, 'allowed.txt'), 'after-observe\n'),
    }),
    /observe mutated isolated snapshot/i,
  );
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
});

test('verifier failureとsource invariant違反をともに返す', async (t) => {
  const repoRoot = await makeRepo(t);
  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: async ({ worktreePath }) => {
        await writeFile(path.join(worktreePath, 'allowed.txt'), 'isolated\n');
        await writeFile(path.join(repoRoot, 'canonical-leak.txt'), 'leaked\n');
      },
      verifyCommands: [{ command: process.execPath, args: ['-e', 'process.exit(7)'] }],
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(error.message, /source repository changed/i);
      assert.equal(error.errors.some((entry) => /verifier failed.*7/i.test(entry.message)), true);
      assert.equal(error.errors.some((entry) => /source repository changed/i.test(entry.message)), true);
      return true;
    },
  );
  assert.match(git(repoRoot, ['status', '--porcelain']), /canonical-leak\.txt/);
});

test('canonical repoへの新しいignored writeもsource invariant違反にする', async (t) => {
  const repoRoot = await makeRepo(t);
  await writeFile(path.join(repoRoot, '.gitignore'), 'ignored-leak.txt\n');
  git(repoRoot, ['add', '.gitignore']);
  git(repoRoot, ['commit', '-m', 'ignore canonical leak target']);

  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: async ({ worktreePath }) => {
        await writeFile(path.join(worktreePath, 'allowed.txt'), 'isolated\n');
        await writeFile(path.join(repoRoot, 'ignored-leak.txt'), 'hidden leak\n');
      },
      verifyCommands: [],
    }),
    /source repository changed/i,
  );
  assert.equal(git(repoRoot, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(repoRoot, 'ignored-leak.txt'), 'utf8'), 'hidden leak\n');
});

test('既存ignored protected fileのcontent-only driftをtyped fingerprintで検出する', async (t) => {
  const repoRoot = await makeRepo(t);
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await Promise.all([
    writeFile(path.join(repoRoot, '.gitignore'), 'test/protected.ignore\n'),
    writeFile(path.join(repoRoot, 'test/protected.ignore'), 'before\n'),
  ]);
  git(repoRoot, ['add', '.gitignore']);
  git(repoRoot, ['commit', '-m', 'protect ignored test input']);

  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['allowed.txt'],
      transform: async ({ worktreePath }) => {
        await Promise.all([
          writeFile(path.join(worktreePath, 'allowed.txt'), 'isolated\n'),
          writeFile(path.join(repoRoot, 'test/protected.ignore'), 'after\n'),
        ]);
      },
      verifyCommands: [],
    }),
    (error) => {
      assert.match(error.message, /source repository changed/i);
      assert.equal(error.transformEvidence.sourceInvariant.outcome, 'failed');
      assert.equal(error.transformEvidence.sourceInvariant.head.equal, true);
      assert.equal(error.transformEvidence.sourceInvariant.visible_status.equal, true);
      assert.equal(error.transformEvidence.sourceInvariant.ignored_paths.equal, true);
      assert.equal(error.transformEvidence.sourceInvariant.protected_content.equal, false);
      return true;
    },
  );
});
