import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { captureWorktreeDiff } from './runtime-diff-observer.mjs';
import { selfDigest, validateExecutorPacket } from './runtime-contracts.mjs';

/**
 * RC3-F isolated worktree executor adapter（ADR 0044 Decision 9、plan RC3-F）。
 *
 * disposable repoのbase_shaからdetached worktreeをtmpdir配下へprovisionし、
 * caller提供のwork関数（TODOごとのfile変更）を実行して、実diffだけを
 * checkpoint／receiptとして報告する。canonical worktreeへは書かない。
 *
 * - adapter契約はscripted executorと同一（dispatch／observe）。
 * - commit・branch切替等の禁止操作はdiff observerのHEAD drift検査でfail loud。
 * - terminal時にworktreeをcleanupし、失敗を成功へ丸めず観測結果
 *   （cleanup_ok・residual_paths）としてterminal observationへ載せる。
 * - 同一TODOの重複dispatchはtyped reject（Decision 9.4）。
 */

function fail(reason) {
  throw new TypeError(`worktree executor契約違反: ${reason}`);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolve(Buffer.concat(stdout).toString('utf8'));
      else {
        reject(new TypeError(
          `${command} ${args[0]} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ));
      }
    });
  });
}

/**
 * disposable repoに対するworktree executor adapterを作る。
 * work: { [todoId]: async ({ worktreePath }) => void }
 */
export function createWorktreeExecutorAdapter(options = {}) {
  if (!plainRecord(options)
    || typeof options.repoRoot !== 'string' || options.repoRoot.length === 0
    || !plainRecord(options.work)) {
    fail('createWorktreeExecutorAdapter optionsが不正');
  }
  const { repoRoot, work } = options;
  const active = new Map();
  const dispatchedTodoIds = new Set();
  let handleCounter = 0;

  // canonical repo（disposable repoの本体worktreeと共有refs）への書込・ref作成を
  // 協調前提の検出guardとして観測する（Decision 9.2。malicious executorはNon-goal）。
  async function canonicalFingerprint() {
    const head = await run('git', ['rev-parse', 'HEAD'], repoRoot);
    const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'], repoRoot);
    const refs = await run('git', ['for-each-ref', '--format=%(refname) %(objectname)'], repoRoot);
    return `${head.trim()}\n${status}\n${refs}`;
  }

  async function cleanupWorktree(worktreePath, worktreeRoot) {
    try {
      await run('git', ['worktree', 'remove', '--force', worktreePath], repoRoot);
      await rm(worktreeRoot, { recursive: true, force: true });
      return { cleanup_ok: true, residual_paths: [] };
    } catch (error) {
      return {
        cleanup_ok: false,
        residual_paths: [worktreeRoot],
        recovery: `git worktree remove --force ${worktreePath} を手動再実行する`,
        message: String(error?.message ?? error),
      };
    }
  }

  return {
    kind: 'isolated-worktree',

    async dispatch({ packet } = {}) {
      if (!validateExecutorPacket(packet)) fail('dispatchにはexecutor_packet.v1が必要');
      const workFn = work[packet.todo_id];
      if (typeof workFn !== 'function') fail(`work関数が未定義のTODO: ${packet.todo_id}`);
      if (dispatchedTodoIds.has(packet.todo_id)) {
        fail(`同一TODOの重複dispatchを拒否する: ${packet.todo_id}`);
      }
      dispatchedTodoIds.add(packet.todo_id);

      handleCounter += 1;
      const executorHandle = `worktree-${packet.todo_id}-h${handleCounter}`;
      const worktreeId = `wt-${packet.todo_id}-${handleCounter}`;
      const worktreeRoot = await mkdtemp(path.join(tmpdir(), `lattice-rc3-wt-${packet.todo_id}-`));
      const worktreePath = path.join(worktreeRoot, 'tree');
      const fingerprintBefore = await canonicalFingerprint();
      try {
        await run('git', ['worktree', 'add', '--detach', worktreePath, packet.base_sha], repoRoot);
        await workFn({ worktreePath });
        const fingerprintAfter = await canonicalFingerprint();
        if (fingerprintAfter !== fingerprintBefore) {
          fail(`work関数がcanonical repoまたは共有refsを変更した: ${packet.todo_id}`);
        }
      } catch (error) {
        // 失敗経路でもworktreeを孤立させない。cleanup失敗は失敗messageへ載せて
        // fail loudし、retryできるようdispatch予約を解放する。
        const cleanup = await cleanupWorktree(worktreePath, worktreeRoot);
        dispatchedTodoIds.delete(packet.todo_id);
        const residual = cleanup.cleanup_ok ? '' : `（cleanup失敗、残存path: ${cleanup.residual_paths.join(', ')}）`;
        throw new TypeError(`dispatch失敗: ${String(error?.message ?? error)}${residual}`);
      }

      active.set(executorHandle, {
        packet: structuredClone(packet),
        executorHandle,
        worktreeId,
        worktreeRoot,
        worktreePath,
        checkpoint: null,
        terminalReported: false,
      });
      return { executor_handle: executorHandle, worktree_id: worktreeId };
    },

    async observe({ executor_handle: executorHandle } = {}) {
      const handleState = active.get(executorHandle);
      if (handleState === undefined) fail(`未知のhandleを観測できない: ${String(executorHandle)}`);
      if (handleState.terminalReported) fail(`terminal報告済みhandleの再観測: ${executorHandle}`);
      const { packet } = handleState;

      if (handleState.checkpoint === null) {
        // 1回目: 実diffをbounded canonical recordへ変換してcheckpoint報告。
        // 観測失敗（HEAD drift等の禁止操作検出を含む）時はworktreeを回収してから
        // fail loudする（無証拠の恒久leakを残さない）。
        let checkpoint;
        try {
          checkpoint = await captureWorktreeDiff({
            worktreePath: handleState.worktreePath,
            baseSha: packet.base_sha,
          });
        } catch (error) {
          handleState.terminalReported = true;
          const cleanup = await cleanupWorktree(handleState.worktreePath, handleState.worktreeRoot);
          const residual = cleanup.cleanup_ok ? '' : `（cleanup失敗、残存path: ${cleanup.residual_paths.join(', ')}）`;
          throw new TypeError(`${String(error?.message ?? error)}${residual}`);
        }
        handleState.checkpoint = checkpoint;
        return { state: 'checkpoint_ready', checkpoint: structuredClone(checkpoint) };
      }

      // 2回目: terminal receipt＋worktree cleanup（失敗を丸めず観測へ載せる）。
      handleState.terminalReported = true;
      const receipt = {
        schema: 'lattice.executor_receipt.v1',
        receipt_id: `${packet.todo_id}-r1`,
        executor_handle: handleState.executorHandle,
        worktree_id: handleState.worktreeId,
        base_sha: packet.base_sha,
        plan_epoch: packet.plan_epoch,
        packet_digest: packet.packet_digest,
        todo_id: packet.todo_id,
        checkpoint_digest: handleState.checkpoint.checkpoint_digest,
        observed_diff: handleState.checkpoint.diff.entries.map((entry) => ({
          path: entry.path,
          change: entry.change,
        })),
      };
      receipt.receipt_digest = selfDigest(receipt, 'receipt_digest');

      const cleanup = await cleanupWorktree(handleState.worktreePath, handleState.worktreeRoot);
      return { state: 'terminal', receipt, cleanup };
    },
  };
}
