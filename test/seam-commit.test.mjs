import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { commitSeamTransform, seamRefFor } from '../src/seam-commit.mjs';

// ADR 0141。再開先は実在するbaseを要る。canonical branchへは出さず、detached commitとして確定する。

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-seam-commit-fixture-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'page.mjs'), 'export const page = 1;\n');
  run('git', ['init', '--quiet'], root);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root);
  run('git', ['config', 'user.name', 'fixture'], root);
  run('git', ['add', '-A'], root);
  run('git', ['commit', '--quiet', '-m', 'base'], root);
  return { root, baseSha: run('git', ['rev-parse', 'HEAD'], root).trim() };
}

test('変換をcommitへ確定し、branchを動かさずrefで守る', async (context) => {
  const { root, baseSha } = await fixture(context);
  const branchesBefore = run('git', ['branch', '--list'], root);
  const headBefore = run('git', ['rev-parse', 'HEAD'], root).trim();

  const { commitSha, ref } = await commitSeamTransform({
    repoRoot: root,
    baseSha,
    files: { 'page.mjs': 'export const page = 2;\n', 'page-left.mjs': 'export const left = 1;\n' },
    candidateId: 'seam-runtime-abc',
    message: 'seam transform',
  });

  assert.match(commitSha, /^[0-9a-f]{40}$/u);
  assert.equal(ref, seamRefFor('seam-runtime-abc'));
  // baseの子孫であること。進んだのであって、別の位置へ移ったのではない。
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', baseSha, commitSha], { cwd: root }).status, 0);

  // canonical branchもHEADも動かない。外部へ効果を出さない。
  assert.equal(run('git', ['branch', '--list'], root), branchesBefore);
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), headBefore);
  // 本repositoryの作業ツリーも触らない。
  assert.equal(run('git', ['status', '--porcelain=v1'], root).trim(), '');

  // そのcommitには変換後の内容が載っている。再開先はここへworktreeを張れる。
  assert.equal(run('git', ['show', `${commitSha}:page.mjs`], root), 'export const page = 2;\n');
  assert.equal(run('git', ['show', `${commitSha}:page-left.mjs`], root), 'export const left = 1;\n');
  assert.equal(run('git', ['rev-parse', ref], root).trim(), commitSha);
});

test('変換で何も変わらないなら確定しない', async (context) => {
  const { root, baseSha } = await fixture(context);
  await assert.rejects(commitSeamTransform({
    repoRoot: root,
    baseSha,
    files: { 'page.mjs': 'export const page = 1;\n' },
    candidateId: 'seam-runtime-noop',
  }), /変換後の差分が無い/u);
  // 空commitで「進んだ」ように見せない。refも張らない。
  assert.equal(spawnSync('git', ['rev-parse', '--verify', seamRefFor('seam-runtime-noop')], { cwd: root }).status !== 0, true);
});

test('repo相対規律を満たさないpathを確定しない', async (context) => {
  const { root, baseSha } = await fixture(context);
  for (const target of ['/etc/passwd', '../escape.mjs', 'a/../../b.mjs']) {
    await assert.rejects(commitSeamTransform({
      repoRoot: root, baseSha, files: { [target]: 'x\n' }, candidateId: 'seam-runtime-bad',
    }), /変換後pathがrepo相対規律を満たさない/u);
  }
});
