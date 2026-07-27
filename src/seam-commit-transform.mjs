import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GIT_SHA1, execFileAsync, git, safeRelative } from './seam-commit-shared.mjs';
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
  // 同じcandidateへ2回目の変換が来た時、黙って上書きすると1回目の証跡が消える。
  // 連鎖は「前の変換を含むbaseの上で次を確定する」形でしか正しくならないので、
  // 既存refが今回のbaseの祖先を指していなければ拒む（ADR 0142 / ADR 0141 OQ2）。
  const existing = await git(['for-each-ref', '--format=%(objectname)', ref], repoRoot)
    .then((stdout) => stdout.trim())
    .catch(() => '');
  if (GIT_SHA1.test(existing) && existing !== commitSha) {
    const chained = await execFileAsync('git', ['merge-base', '--is-ancestor', existing, baseSha], {
      cwd: repoRoot, encoding: 'utf8',
    }).then(() => true).catch(() => false);
    if (!chained) {
      throw new Error(`seam ref ${ref} は既に ${existing} を指しており、今回のbaseはその子孫でない`
        + '。前の変換を含むbaseの上で確定するか、別のcandidate idを使う');
    }
  }
  await git(['update-ref', ref, commitSha], repoRoot);
  return { commitSha, ref };
}
