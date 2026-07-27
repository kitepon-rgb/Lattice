/**
 * 管理runtimeのworker worktree配置（ADR 0143 / io-sentinel st-004）。
 *
 * **なぜ配置を契約にするのか。** supervisor daemonとscripted controllerは別プロセスであり、
 * 両者が同じ木を指す必要がある。daemonは「どこを監視し、どこのdiffを撮るか」を知らなければ
 * ならず、controllerは「どこへ書くか」を知らなければならない。dispatch応答は`worktree_id`しか
 * 運ばないので、pathを応答へ足すか、配置そのものを契約にするかの二択になる。ここでは後者を採る
 * ——**daemonが監視を張れるのはdispatchの前**であり、応答を待っていては書き込みを取り逃すからである。
 *
 * これが無かった頃、全TODOのbindingは同じrepo rootを指していた。sentinelの帰属はrootだけで
 * 決まるので、共有rootでは誰が書いたかを言えず、早期警報は成立しなかった。checkpoint判定も
 * 同じ理由で帰属を決められない。**worktreeとTODOの1対1は、装置の前提であって最適化ではない。**
 */

import { spawn } from 'node:child_process';
import { mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

const GIT_SHA1 = /^[0-9a-f]{40}$/u;

function fail(reason) {
  throw new TypeError(`scripted worktree契約違反: ${reason}`);
}

function run(command, args, cwd, { allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (allowExitCodes.includes(code) && signal === null) {
        resolve(Object.assign(Buffer.concat(stdout), { code }));
      } else {
        reject(new TypeError(
          `${command} ${args[0]} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ));
      }
    });
  });
}

/** worktreeの名前。packet digestへ縛るので、同じpacketには必ず同じ木が対応する。 */
export function scriptedWorktreeId(packet) {
  const digest = packet?.packet_digest;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    fail('packet_digestが不正');
  }
  return `scripted-wt-${digest.slice(0, 24)}`;
}

/** run store配下のworktree path。runの寿命と一致するので、後片付けもrunに閉じる。 */
export function scriptedWorktreePath({ runDir, packet } = {}) {
  if (typeof runDir !== 'string' || runDir.length === 0) fail('runDirが不正');
  return path.join(runDir, 'worktrees', scriptedWorktreeId(packet), 'tree');
}

/**
 * packetのbase shaでworktreeを用意する。既に在るなら作り直さない。
 *
 * run storeはgitignore済みなので（`requireIgnoredRunStore`）、ここに木を切っても
 * canonical repoの`git status`は汚れない。
 */
export async function ensureScriptedWorktree({ repoRoot, runDir, packet } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) fail('repoRootが不正');
  if (!GIT_SHA1.test(packet?.base_sha ?? '')) fail('packet.base_shaが不正');
  const worktreePath = scriptedWorktreePath({ runDir, packet });
  try {
    return await realpath(worktreePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(worktreePath), { recursive: true, mode: 0o700 });
  await run('git', ['worktree', 'add', '--detach', worktreePath, packet.base_sha], repoRoot);
  return realpath(worktreePath);
}

/**
 * runが持つworktreeを全て畳む。
 *
 * 取り残すと`git worktree list`へ積み上がり、次のrunがprune前提の状態を引き継ぐ。
 * 失敗は握り潰さず、畳めなかったpathを添えて返す——呼び出し側が記録できる形にしておく。
 */
export async function removeScriptedWorktrees({ repoRoot, runDir } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) fail('repoRootが不正');
  if (typeof runDir !== 'string' || runDir.length === 0) fail('runDirが不正');
  const root = path.join(runDir, 'worktrees');
  const listed = await run('git', ['worktree', 'list', '--porcelain'], repoRoot);
  const residual = [];
  for (const line of listed.toString('utf8').split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const target = line.slice('worktree '.length);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    try {
      await run('git', ['worktree', 'remove', '--force', target], repoRoot);
    } catch {
      residual.push(target);
    }
  }
  if (residual.length === 0) await rm(root, { recursive: true, force: true });
  return { removed_root: root, residual_paths: residual };
}
