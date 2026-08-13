import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { commitSeamTransform } from '../../src/seam-commit.mjs';

// ADR 0141。請求項8は「競合の解消後に二つの作業を再開させる」まで述べる。再開先が変換を
// 含まないbaseだと、splitが所有を宣言した新pathがworktreeに存在せず、再開が成立しない。

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

test('確定した変換のbaseへworktreeを張ると、所有を宣言した新pathが実在する', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-resume-base-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'page.mjs'), [
    "const CSS = 'red';",
    'function renderLeft() { return 1; }',
    'export function renderPage() { return CSS + renderLeft(); }',
    '',
  ].join('\n'));
  run('git', ['init', '--quiet'], root);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root);
  run('git', ['config', 'user.name', 'fixture'], root);
  run('git', ['add', '-A'], root);
  run('git', ['commit', '--quiet', '-m', 'base'], root);
  const baseSha = run('git', ['rev-parse', 'HEAD'], root).trim();

  // 変換の成果（三面分割の結果に相当）を確定する。
  const { commitSha } = await commitSeamTransform({
    repoRoot: root,
    baseSha,
    files: {
      'page.mjs': [
        "import { CSS } from './page-style.mjs';",
        "import { renderLeft } from './page-left.mjs';",
        'export function renderPage() { return CSS + renderLeft(); }',
        '',
      ].join('\n'),
      'page-style.mjs': "export const CSS = 'red';\n",
      'page-left.mjs': 'export function renderLeft() { return 1; }\n',
    },
    candidateId: 'seam-runtime-resume',
  });

  // 旧base——今までの再開先——には新pathが無い。これが直す前の姿である。
  const stale = path.join(root, 'stale-worktree');
  run('git', ['worktree', 'add', '--detach', '--quiet', stale, baseSha], root);
  context.after(() => spawnSync('git', ['worktree', 'remove', '--force', stale], { cwd: root }));
  await assert.rejects(access(path.join(stale, 'page-left.mjs')));

  // 前進させたbaseには実在する。再開したworkerが所有を宣言したfileを触れる。
  const resumed = path.join(root, 'resumed-worktree');
  run('git', ['worktree', 'add', '--detach', '--quiet', resumed, commitSha], root);
  context.after(() => spawnSync('git', ['worktree', 'remove', '--force', resumed], { cwd: root }));
  await access(path.join(resumed, 'page-left.mjs'));
  await access(path.join(resumed, 'page-style.mjs'));
  assert.match(await readFile(path.join(resumed, 'page.mjs'), 'utf8'), /from '\.\/page-left\.mjs'/u);

  // 再開先はbaseの子孫である。別の位置へ移ったのではない。
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', baseSha, commitSha], { cwd: root }).status, 0);
  // canonical branchは動いていない。
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), baseSha);
});
