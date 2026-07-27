/**
 * 実行時競合の早期警報（ADR 0143）。
 *
 * 競合はこれまで、checkpointを撮った瞬間にしか見つからなかった。checkpointに周期は無く、
 * 実質workerが完了するまで誰も気づかない。holdで捨てる作業量の正体はこの窓である。
 *
 * **警報はfindingではない。** findingの契約はcheckpoint digestを必須にしており、それは
 * findingが「事後に再読して再導出できる主張」であることを担保している。fs eventは取りこぼすし
 * （FSEventsのcoalesce、inotifyのキュー溢れ）、事後再読もできない。よってここが出すのは
 * 「早くcheckpointを撮って確かめろ」という引き金だけであり、判定の正本はcheckpointのままである。
 *
 * この非対称が安全性の根拠になる。警報は**何かを抑制することが無く、早める方向にしか働かない**。
 * 取りこぼしても、今日と同じタイミング（完了時・hold時）で必ず捕まる——保証は一切緩まない。
 *
 * 判定述語はcheckpoint findingと同一（`coveredBy`を共有する）。worktreeとTODOは1対1なので、
 * 書き込みイベントのpathからworktree rootを剥がせばrepo相対pathになり、誰がやったかはrootが
 * 決める。プロセス帰属は要らない。
 */

import { watch } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { coveredBy } from './runtime-diff-observer.mjs';

/** 警報の種別。findingのkindとは別空間にする——findingへ昇格するのはprobeを通った後だけである。 */
export const IO_WARNING_KINDS = Object.freeze(['io_overlap_warning', 'io_scope_warning']);

/**
 * 監視から外すrepo相対prefix。
 *
 * `.git`と`.lattice`は道具自身の書き込みで、作業の成果ではない。`node_modules`は隔離実行が
 * 共有mountとして張る場所であり（`seam-apply.mjs`と同じ規律）、worktreeを跨いで同じ絶対pathを
 * 指しうるので、pathの一致を競合と読むと必ず誤る。
 */
export const DEFAULT_IO_EXCLUDES = Object.freeze(['.git/', '.lattice/', 'node_modules/']);

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** worktree rootを剥がしてrepo相対pathにする。rootの外を指すものはnull。 */
export function relativeToRoot(root, absolutePath) {
  if (typeof root !== 'string' || typeof absolutePath !== 'string') return null;
  const relative = path.relative(root, absolutePath);
  if (relative.length === 0) return null;
  if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) return null;
  return relative.split(path.sep).join('/');
}

/** 監視対象外か。prefix一致で見る。 */
export function isExcludedPath(relativePath, excludes = DEFAULT_IO_EXCLUDES) {
  return excludes.some((prefix) => relativePath === prefix.replace(/\/$/u, '')
    || relativePath.startsWith(prefix));
}

/**
 * 1件の書き込み観測を警報へ分類する。純関数。
 *
 * checkpoint findingの2述語をそのまま1 pathへ適用する:
 * - 他のrunning TODOの宣言scopeに入るpathへ書いた → `io_overlap_warning`
 * - 自分の宣言scopeの外へ書いた → `io_scope_warning`
 *
 * @returns {{warnings: Array<{kind: string, todo_ids: string[], path: string}>}}
 */
export function classifyIoObservation(options = {}) {
  const { todoId, relativePath, packets, runningTodoIds } = options;
  if (typeof todoId !== 'string' || typeof relativePath !== 'string'
    || !plainRecord(packets) || !Array.isArray(runningTodoIds)) {
    throw new TypeError('classifyIoObservation optionsが不正');
  }
  const packet = packets[todoId];
  // 宣言が無いTODOの観測は判定できない。分からないものを「競合なし」へ丸めない——
  // ただし警報は正本ではないので、ここでrunを止めることもしない。
  if (!plainRecord(packet) || !plainRecord(packet.scope) || !Array.isArray(packet.scope.writes)) {
    return { warnings: [] };
  }

  const warnings = [];
  if (!coveredBy(packet.scope.writes, relativePath)) {
    warnings.push({ kind: 'io_scope_warning', todo_ids: [todoId], path: relativePath });
  }
  for (const otherId of [...runningTodoIds].sort(compareText)) {
    if (otherId === todoId) continue;
    const other = packets[otherId];
    if (!plainRecord(other) || !plainRecord(other.scope) || !Array.isArray(other.scope.writes)) continue;
    if (coveredBy(other.scope.writes, relativePath)) {
      warnings.push({
        kind: 'io_overlap_warning',
        todo_ids: [todoId, otherId].sort(compareText),
        path: relativePath,
      });
    }
  }
  return { warnings };
}

/** 同じ事実を何度も報告しない。1 epochで`(kind, todo集合, path)`ごとに1回に畳む。 */
function warningKey(warning) {
  return `${warning.kind}\0${warning.todo_ids.join(',')}\0${warning.path}`;
}

/**
 * running bindingのworktreeを監視し、警報を`onWarning`へ渡す。
 *
 * `fs.watch(root, {recursive: true})`だけを使う。Node 22の標準機能で、macOSとLinuxの双方で
 * 動き、新しいruntime依存を持ち込まない。取りこぼしは仕様である——正本はcheckpointであり、
 * ここは早めるためだけに在る。
 *
 * @param {object} options
 * @param {Function} options.onWarning 警報1件ごとに呼ばれる。非同期でよい。
 * @param {Function} [options.watchFactory] test用の差し替え口。既定は`fs.watch`。
 */
export function createIoSentinel(options = {}) {
  const {
    packets = {}, onWarning, excludes = DEFAULT_IO_EXCLUDES, watchFactory = watch,
  } = options;
  if (typeof onWarning !== 'function') throw new TypeError('onWarningが不正');

  /** todo_id -> { root, watcher } */
  const watched = new Map();
  const reported = new Set();
  let closed = false;

  const deliver = async (todoId, relativePath, absolutePath) => {
    if (closed) return;
    // 実測（macOS）では、監視callbackはdirectoryイベントと、監視対象自身の名前を持つ
    // 実在しないentryまで配ってくる。どちらもcheckpoint diffのentryにはならないので、
    // そのまま警報にすると「警報は出たがcheckpointでは競合にならない」ずれが生まれる。
    // 判定述語をcheckpointと揃えるために、**いま実在する通常file**だけを観測として扱う。
    //
    // 削除は早期警報の対象から外れる。checkpointは削除をentryとして持つので取り逃しでは
    // なく、早く気づけないだけである——警報は早めるためだけに在るという原則どおり。
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile()) return;
    } catch {
      return;
    }
    const { warnings } = classifyIoObservation({
      todoId, relativePath, packets, runningTodoIds: [...watched.keys()],
    });
    for (const warning of warnings) {
      const key = warningKey(warning);
      if (reported.has(key)) continue;
      reported.add(key);
      await onWarning(structuredClone(warning));
    }
  };

  return {
    /** 監視を開始する。既に同じtodoを見ているなら張り替える。 */
    watchBinding({ todoId, worktreePath }) {
      if (closed) return false;
      if (typeof todoId !== 'string' || typeof worktreePath !== 'string') return false;
      this.unwatchBinding(todoId);
      let watcher;
      try {
        watcher = watchFactory(worktreePath, { recursive: true }, (_event, filename) => {
          if (filename === null || filename === undefined) return;
          const absolute = path.resolve(worktreePath, String(filename));
          const relative = relativeToRoot(worktreePath, absolute);
          if (relative === null || isExcludedPath(relative, excludes)) return;
          // 監視callbackは同期契約なので、配送の失敗をここで投げない。
          // 警報が落ちてもcheckpointが正本なので、runの判定は壊れない。
          void Promise.resolve(deliver(todoId, relative, absolute)).catch(() => {});
        });
      } catch {
        // 監視を張れない環境（platform制約、権限、root不在）でrunを止めない。
        return false;
      }
      if (typeof watcher?.on === 'function') watcher.on('error', () => {});
      watched.set(todoId, { root: worktreePath, watcher });
      return true;
    },

    unwatchBinding(todoId) {
      const entry = watched.get(todoId);
      if (entry === undefined) return false;
      try { entry.watcher.close(); } catch { /* 既に閉じている */ }
      watched.delete(todoId);
      return true;
    },

    /** epochを跨いだら減衰の記憶を捨てる。新しい版では同じpathでも改めて報告する。 */
    resetEpoch() {
      reported.clear();
    },

    watchedTodoIds() {
      return [...watched.keys()].sort(compareText);
    },

    close() {
      closed = true;
      for (const todoId of [...watched.keys()]) this.unwatchBinding(todoId);
      reported.clear();
    },
  };
}
