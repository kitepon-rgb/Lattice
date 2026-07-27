import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GIT_SHA1, git, safeRelative } from './seam-commit-shared.mjs';
import { seamRefFor } from './seam-ref.mjs';

/**
 * 採用された変換をcommitへ確定し、そのshaを返す。
 *
 * 本repositoryの作業ツリーは触らない。使い捨てworktreeをbaseへ張り、変換後のfileを書き、
 * detached HEADでcommitし、refへ繋いでからworktreeを畳む。commit objectはobject DBを共有する
 * ので、worktreeを消してもshaは生き残る——refはそれをGCから守るためである。
 *
 * @param {object} options
 * @param {string} options.repoRoot 本repository
 * @param {string} options.baseSha 変換前のbase
 * @param {object} options.files pathごとの変換後text
 * @param {string} options.candidateId ref名に使う識別子
 * @param {string} options.message commit message
 * @returns {Promise<{commitSha: string, ref: string}>}
 */
export async function commitSeamTransform({
  repoRoot, baseSha, files, candidateId, message,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new TypeError('repoRootが不正');
  if (!GIT_SHA1.test(baseSha ?? '')) throw new TypeError('baseShaが不正');
  if (files === null || typeof files !== 'object' || Array.isArray(files)
    || Object.keys(files).length === 0) throw new TypeError('filesが不正');
  const targets = Object.keys(files);
  if (!targets.every(safeRelative)) throw new TypeError('変換後pathがrepo相対規律を満たさない');
  if (typeof candidateId !== 'string' || !/^[0-9A-Za-z][\w.-]{0,127}$/u.test(candidateId)) {
    throw new TypeError('candidateIdが不正');
  }

  const worktreeRoot = await mkdtemp(path.join(tmpdir(), 'lattice-seam-commit-'));
  const worktreePath = path.join(worktreeRoot, 'tree');
  let commitSha;
  try {
    await git(['worktree', 'add', '--detach', '--quiet', worktreePath, baseSha], repoRoot);
    for (const [target, text] of Object.entries(files)) {
      const absolute = path.join(worktreePath, target);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, text);
    }
    await git(['add', '--', ...targets], worktreePath);
    // 変換で1 byteも変わらなかったなら、確定すべき成果が無い。空commitで
    // 「進んだ」ように見せない。
    const staged = await git(['diff', '--cached', '--name-only'], worktreePath);
    if (staged.trim() === '') throw new TypeError('変換後の差分が無い');
    await git([
      '-c', 'user.email=lattice@localhost', '-c', 'user.name=lattice',
      'commit', '--quiet', '-m', message ?? `seam transform ${candidateId}`,
    ], worktreePath);
    commitSha = (await git(['rev-parse', 'HEAD'], worktreePath)).trim();
    if (!GIT_SHA1.test(commitSha)) throw new TypeError('commit shaが不正');
  } finally {
    await git(['worktree', 'remove', '--force', worktreePath], repoRoot).catch(() => {});
    await rm(worktreeRoot, { recursive: true, force: true });
  }

  // worktreeを畳んだ後にrefを張る。object DBは共有なのでshaは生きているが、
  // refが無いとGCの対象になる。
  const ref = seamRefFor(candidateId);
  await git(['update-ref', ref, commitSha], repoRoot);
  return { commitSha, ref };
}
