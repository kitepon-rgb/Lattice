/**
 * unix domain socketの所有関係をOS非依存に観測する。
 *
 * 管理runtimeは「そのPIDが本当にそのcontrol socketを持っているか」を確かめてから接続する。
 * この検査は成りすましたsocketへ繋がないための要であり、緩めない。
 *
 * 実装は`/usr/sbin/lsof`をhard-codeしていた。**これはmacOS専用のpathで、Linuxでは管理runtime
 * が丸ごと動かなかった**（CIで実測：実daemonを起動するtestが軒並み`socket owner観測失敗`で
 * 落ちていた）。移植性の欠陥であってtestの都合ではない。
 *
 * Linuxには`/proc`という一次情報があるので、外部commandを介さずに同じことが分かる。
 * `/proc/<pid>/fd/*`のsymlinkが`socket:[inode]`を指し、`/proc/net/unix`がinodeとpathを結ぶ。
 * lsofを持たない最小構成のcontainerでも動くので、Linuxでは`/proc`を優先する。
 *
 * どちらの手段でも観測できない環境では、**観測できたことにしない**。呼び出し側がfail closed
 * するために、例外を投げるか空を返す（「所有していない」ではなく「分からない」を返さない設計に
 * するため、判定は必ず呼び出し側の`some(...)`で行う）。
 */

import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** lsofの絶対path候補。PATHは引かない——探索経路を広げるとsocket検査の前提が緩む。 */
const LSOF_PATHS = Object.freeze(['/usr/sbin/lsof', '/usr/bin/lsof', '/bin/lsof']);

const SOCKET_INODE = /^socket:\[(\d+)\]$/u;

async function runLsof(args) {
  let lastError = new Error('lsof not found');
  for (const binary of LSOF_PATHS) {
    try {
      const { stdout } = await execFileAsync(binary, args, { encoding: 'utf8' });
      return stdout;
    } catch (error) {
      // ENOENTは「その場所に無い」だけなので次の候補へ。
      if (error?.code === 'ENOENT') { lastError = error; continue; }
      // lsofは該当が無いとexit 1を返す。これは観測の失敗ではなく「所有者なし」である。
      // ここを潰すと、誰も掴んでいないstale socketが観測失敗として扱われ、正常な後片付けが
      // 止まる（元の呼び出し側も同じ区別をしていた）。
      if (error?.code === 1 && String(error?.stdout ?? '').trim() === '') return '';
      throw error;
    }
  }
  throw lastError;
}

/** `/proc/<pid>/fd`からunix socketのinodeを集める。Linux専用。 */
async function procSocketInodes(pid) {
  const entries = await readdir(`/proc/${pid}/fd`);
  const inodes = new Set();
  for (const entry of entries) {
    let target;
    try { target = await readlink(`/proc/${pid}/fd/${entry}`); } catch { continue; }
    const matched = SOCKET_INODE.exec(target);
    if (matched !== null) inodes.add(matched[1]);
  }
  return inodes;
}

/** `/proc/net/unix`を読み、inode -> pathの対応を返す。 */
async function procUnixSocketPaths() {
  const text = await readFile('/proc/net/unix', 'utf8');
  const byInode = new Map();
  for (const line of text.split('\n').slice(1)) {
    // Num RefCount Protocol Flags Type St Inode Path
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 8) continue;
    const inode = fields[6];
    const socketPath = fields.slice(7).join(' ');
    if (socketPath.length === 0) continue;
    if (!byInode.has(inode)) byInode.set(inode, []);
    byInode.get(inode).push(socketPath);
  }
  return byInode;
}

/**
 * 指定PIDが開いているunix socketのpath一覧を返す。
 *
 * @returns {Promise<string[]>} 観測できたpath。観測手段が無ければthrowする。
 */
export async function socketPathsOwnedByPid(pid) {
  if (process.platform === 'linux') {
    const inodes = await procSocketInodes(pid);
    if (inodes.size === 0) return [];
    const byInode = await procUnixSocketPaths();
    return [...inodes].flatMap((inode) => byInode.get(inode) ?? []);
  }
  const stdout = await runLsof(['-a', '-p', String(pid), '-U', '-F', 'fn']);
  return stdout.split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));
}

/**
 * 指定socket pathを開いているPID一覧を返す。
 *
 * @returns {Promise<number[]>} 観測できたPID。観測手段が無ければthrowする。
 */
export async function pidsOwningSocketPath(socketPath) {
  if (process.platform === 'linux') {
    const byInode = await procUnixSocketPaths();
    const wanted = new Set();
    for (const [inode, paths] of byInode) {
      if (paths.includes(socketPath)) wanted.add(inode);
    }
    if (wanted.size === 0) return [];
    const pids = new Set();
    for (const entry of await readdir('/proc')) {
      if (!/^\d+$/u.test(entry)) continue;
      let inodes;
      // 他ユーザーのprocessは読めない。読めないものを「所有していない」へ丸めるが、
      // これはlsofが権限不足で黙るのと同じ性質であり、判定は所有を**肯定**する側でのみ使う。
      try { inodes = await procSocketInodes(entry); } catch { continue; }
      if ([...wanted].some((inode) => inodes.has(inode))) pids.add(Number(entry));
    }
    return [...pids];
  }
  const stdout = await runLsof(['-t', socketPath]);
  return stdout.split('\n').map((line) => line.trim())
    .filter((line) => /^\d+$/u.test(line)).map(Number);
}
