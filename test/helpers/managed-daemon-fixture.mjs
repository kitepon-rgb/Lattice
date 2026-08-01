import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

/** argvがfixtureのtemp pathを指すprocessだけを列挙する。 */
export function daemonPidsUnder(temporary) {
  const listed = spawnSync('ps', ['-eo', 'pid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0 || typeof listed.stdout !== 'string') return [];
  return listed.stdout.split('\n')
    .filter((line) => line.includes(temporary))
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
}

// kill(pid, 0)は回収前のzombieにも通るので、生存判定にはpsの状態を使う。
function processAlive(pid) {
  const listed = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const state = (listed.stdout ?? '').trim();
  return state.length > 0 && !state.startsWith('Z');
}

/** fixture配下のdaemonをSIGTERMからSIGKILLへ上げ、残存pidを返す。 */
export async function reapDaemonsUnder(temporary, tracked = []) {
  const survivors = () => [...new Set([
    ...daemonPidsUnder(temporary),
    ...tracked.filter(processAlive),
  ])];
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (survivors().length === 0) return [];
    for (const pid of tracked) {
      try {
        process.kill(-pid, 'SIGCONT');
        process.kill(-pid, signal);
      } catch {
        // 既に停止済み。
      }
    }
    for (const pid of daemonPidsUnder(temporary)) {
      try {
        process.kill(pid, signal);
      } catch {
        // 既に停止済み。
      }
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && survivors().length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return survivors();
}

const liveFixtures = new Set();

// timeout等でafter hook自体が走らなかった時の同期的な最後の受け皿。
process.on('exit', () => {
  for (const temporary of liveFixtures) {
    for (const pid of daemonPidsUnder(temporary)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 既に停止済み。
      }
    }
  }
});

/** test終了時のdaemon停止・fixture削除・残存ゼロassertを一括登録する。 */
export function registerManagedDaemonFixture(t, temporary, { tracked = [] } = {}) {
  liveFixtures.add(temporary);
  t.after(async () => {
    const survivors = await reapDaemonsUnder(temporary, tracked);
    liveFixtures.delete(temporary);
    await rm(temporary, { recursive: true, force: true });
    assert.deepEqual(survivors, [], `fixtureのdaemonが停まらずに残った: ${survivors.join(', ')}`);
  });
}
