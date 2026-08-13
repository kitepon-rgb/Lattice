import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyReleaseCommit } from '../scripts/verify-release-commit.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A clone whose HEAD is landed on origin/main, with a clean tree. */
async function landedClone(context) {
  const base = await mkdtemp(path.join(tmpdir(), 'lattice-release-gate-'));
  context.after(() => rm(base, { recursive: true, force: true }));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(base, 'clone', '--quiet', origin, work);
  git(work, 'config', 'user.email', 'fixture@example.invalid');
  git(work, 'config', 'user.name', 'Fixture');
  await writeFile(path.join(work, 'tracked.txt'), 'tracked\n');
  await writeFile(path.join(work, '.gitignore'), 'ignored/\n');
  git(work, 'add', 'tracked.txt', '.gitignore');
  git(work, 'commit', '--quiet', '-m', 'initial');
  git(work, 'push', '--quiet', 'origin', 'main');
  git(work, 'fetch', '--quiet', 'origin');
  return work;
}

test('着地済みでcleanなtreeは通る', async (t) => {
  const work = await landedClone(t);
  assert.match(verifyReleaseCommit(work), /is landed on origin\/main\./u);
});

test('untrackedなファイルはpayloadへ混入するので拒否する', async (t) => {
  const work = await landedClone(t);
  await writeFile(path.join(work, 'stray.mjs'), 'export const stray = true;\n');
  assert.throws(() => verifyReleaseCommit(work), (error) => {
    assert.match(error.message, /commitされていない内容があります/u);
    assert.match(error.message, /stray\.mjs/u);
    return true;
  });
});

test('ignore済みのファイルは従来どおり通す', async (t) => {
  const work = await landedClone(t);
  await writeFile(path.join(work, '.gitignore'), 'ignored/\n');
  await mkdir(path.join(work, 'ignored'), { recursive: true });
  await writeFile(path.join(work, 'ignored', 'build.js'), 'built\n');
  assert.match(verifyReleaseCommit(work), /is landed on origin\/main\./u);
});

test('trackedな未commit変更は従来どおり拒否する', async (t) => {
  const work = await landedClone(t);
  await writeFile(path.join(work, 'tracked.txt'), 'changed\n');
  assert.throws(() => verifyReleaseCommit(work), /commitされていない内容があります/u);
});

test('既定ブランチへ着地していないcommitは拒否する', async (t) => {
  const work = await landedClone(t);
  await writeFile(path.join(work, 'tracked.txt'), 'ahead\n');
  git(work, 'commit', '--quiet', '-am', 'unpushed');
  assert.throws(() => verifyReleaseCommit(work), /祖先ではありません/u);
});
