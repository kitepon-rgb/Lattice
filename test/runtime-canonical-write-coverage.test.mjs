import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';

import { canonicalRepositoryFingerprint } from '../src/runtime-managed-supervisor.mjs';

// 請求項9。workerがworktreeの外——本repository——へ書いても、worktreeのdiffには映らない。
// 見ていないことを「変更が無かった」と読ませないための面。

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

async function repoFixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-canonical-fp-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'one.txt'), 'one\n');
  await writeFile(path.join(root, '.gitignore'), 'ignored/\n');
  run('git', ['init', '--quiet'], root);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root);
  run('git', ['config', 'user.name', 'fixture'], root);
  run('git', ['add', '-A'], root);
  run('git', ['commit', '--quiet', '-m', 'fixture'], root);
  return root;
}

test('同じ状態からは同じ指紋が出る', async (context) => {
  const root = await repoFixture(context);
  const first = await canonicalRepositoryFingerprint(root);
  const second = await canonicalRepositoryFingerprint(root);
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(first, second);
});

test('tracked・untracked・ignored・refのどれが動いても指紋が変わる', async (context) => {
  const root = await repoFixture(context);
  const base = await canonicalRepositoryFingerprint(root);

  // trackedへの書き込み。
  await writeFile(path.join(root, 'one.txt'), 'changed\n');
  const tracked = await canonicalRepositoryFingerprint(root);
  assert.notEqual(tracked, base);
  await writeFile(path.join(root, 'one.txt'), 'one\n');
  assert.equal(await canonicalRepositoryFingerprint(root), base);

  // untrackedの追加。
  await writeFile(path.join(root, 'two.txt'), 'two\n');
  assert.notEqual(await canonicalRepositoryFingerprint(root), base);
  await rm(path.join(root, 'two.txt'));

  // gitignore対象への書き込み。ここを見落とすとignore経由で外から触れてしまう。
  run('git', ['config', 'core.excludesFile', devNull], root);
  const ignoredDir = path.join(root, 'ignored');
  await mkdir(ignoredDir, { recursive: true });
  await writeFile(path.join(ignoredDir, 'artifact.bin'), 'x\n');
  assert.notEqual(await canonicalRepositoryFingerprint(root), base);
  await rm(ignoredDir, { recursive: true, force: true });

  // refの移動（commit・branch作成）。
  assert.equal(await canonicalRepositoryFingerprint(root), base);
  run('git', ['branch', 'side'], root);
  assert.notEqual(await canonicalRepositoryFingerprint(root), base);
});
