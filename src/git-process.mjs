// Lattice の製品経路が git を起動する唯一の入口。
//
// Windows では、GUI 起点（デスクトップアプリのフック等）の process から spawn された
// console アプリが新しいコンソールセッションを作り、既定ターミナルが Windows Terminal だと
// 毎回可視ウィンドウが開く。blob ごとの cat-file 個別起動と重なると、ウィンドウが毎秒数枚
// 湧いてホストが操作不能になる（2026-08-10 オーナー実測: 40枚/分）。windowsHide を
// ここで全経路に焼き込み、呼び出し側での付け忘れを構造的に不可能にする。
//
// retired な rc* リサーチ資産（不変 replay）は対象外で、この入口を使わない。

import { execFileSync, spawn, spawnSync } from 'node:child_process';

/** execFileSync('git', ...) の置き換え。windowsHide を常に付ける。 */
export function gitSync(args, options = {}) {
  return execFileSync('git', args, { windowsHide: true, ...options });
}

/** spawnSync('git', ...) の置き換え。 */
export function gitSpawnSync(args, options = {}) {
  return spawnSync('git', args, { windowsHide: true, ...options });
}

/** spawn('git', ...) の置き換え。 */
export function gitSpawn(args, options = {}) {
  return spawn('git', args, { windowsHide: true, ...options });
}

/**
 * 複数 object を 1 回の `git cat-file --batch` で読む（object 1個 = spawn 1回 の雪崩防止）。
 *
 * 入力は object 名（oid または `<rev>:<path>`）の配列。返りは同じ順の配列で、各要素は
 * `{ type, bytes }`（存在時）または `{ missing: true }`。git の --batch 出力契約:
 * `<oid> SP <type> SP <size> LF <body> LF` ／ 見つからない時は `<name> SP missing LF`。
 *
 * maxBuffer は呼び出し側の想定 body 上限 × 件数 + ヘッダ余白で見積もる。
 */
export function gitCatFileBatch(objectNames, { cwd, maxBodyBytes }) {
  if (objectNames.length === 0) return [];
  const result = gitSpawnSync(['cat-file', '--batch'], {
    cwd,
    input: `${objectNames.join('\n')}\n`,
    maxBuffer: (maxBodyBytes + 256) * objectNames.length,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (result.status !== 0 || result.stdout === undefined || result.stdout === null) {
    throw new Error(`git cat-file --batch failed: status=${result.status ?? 'signal'}`);
  }
  const stdout = result.stdout;
  const entries = [];
  let offset = 0;
  for (const name of objectNames) {
    const headerEnd = stdout.indexOf(0x0a, offset);
    if (headerEnd === -1) throw new Error(`git cat-file --batch: truncated header for ${name}`);
    const header = stdout.subarray(offset, headerEnd).toString('utf8');
    offset = headerEnd + 1;
    const parts = header.split(' ');
    if (parts.length >= 2 && (parts[1] === 'missing' || parts[1] === 'ambiguous')) {
      entries.push({ missing: true });
      continue;
    }
    if (parts.length !== 3) throw new Error(`git cat-file --batch: unexpected header for ${name}: ${header}`);
    const size = Number(parts[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`git cat-file --batch: invalid size for ${name}: ${header}`);
    }
    const bytes = stdout.subarray(offset, offset + size);
    if (bytes.length !== size) throw new Error(`git cat-file --batch: truncated body for ${name}`);
    offset += size + 1;
    entries.push({ type: parts[1], bytes });
  }
  return entries;
}
