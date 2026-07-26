#!/usr/bin/env node
// testが起動したまま取り残したdaemonを、安全な条件だけに絞って停める。
//
// 既定で停めるのは「argvが指すfixtureのtemp directoryが既に存在しない」ものだけとする。
// 存在するfixtureは実行中のtestのものかもしれず、同じ機械で並行作業している別のagentを
// 巻き込む。判定できないものは一切触らず、一覧へ理由付きで出す。
//
// fixtureが残ったまま死んだ実行もあるので、起動時刻での追加許可を別途用意する。これは
// 「このdaemonは数秒から数分で終わる」という前提に寄りかかるため、明示指定の時だけ効く。
//
//   node scripts/reap-orphan-test-daemons.mjs                      # 一覧だけ（既定・何も停めない）
//   node scripts/reap-orphan-test-daemons.mjs --reap               # fixture不在のものだけ停める
//   node scripts/reap-orphan-test-daemons.mjs --older-than-hours=6 # 6時間より古いものも候補に含める

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REAP = process.argv.includes('--reap');
const ageArgument = process.argv.find((value) => value.startsWith('--older-than-hours='));
const olderThanHours = ageArgument === undefined ? null : Number(ageArgument.split('=')[1]);
if (ageArgument !== undefined && !(Number.isFinite(olderThanHours) && olderThanHours > 0)) {
  process.stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2',
    code: 'USAGE', message: '--older-than-hours には正の数を渡す' })}\n`);
  process.exit(2);
}

function temporaryRoots() {
  const base = tmpdir();
  const roots = new Set([base]);
  try { roots.add(realpathSync(base)); } catch { /* 解決できなければbaseだけで見る */ }
  // macOSは /var/folders と /private/var/folders が同じ場所を指す。
  for (const root of [...roots]) {
    if (root.startsWith('/private/')) roots.add(root.slice('/private'.length));
    else roots.add(path.join('/private', root));
  }
  return [...roots];
}

// argvから「temp直下のfixture directory」を取り出す。mkdtempが作る1段目までを見る。
function fixtureDirectoryOf(commandLine, roots) {
  for (const root of roots) {
    let index = commandLine.indexOf(`${root}${path.sep}`);
    while (index !== -1) {
      const rest = commandLine.slice(index + root.length + 1);
      const name = rest.split(/[\s/]/u)[0];
      if (name.startsWith('lattice-')) return path.join(root, name);
      index = commandLine.indexOf(`${root}${path.sep}`, index + 1);
    }
  }
  return null;
}

const listed = spawnSync('ps', ['-eo', 'pid=,lstart=,command='],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (listed.status !== 0) {
  process.stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2',
    code: 'PROCESS_LIST_FAILED', message: listed.stderr?.trim() ?? 'ps failed' })}\n`);
  process.exit(1);
}

const roots = temporaryRoots();
const candidates = [];
for (const line of listed.stdout.split('\n')) {
  const match = /^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/u.exec(line);
  if (match === null) continue;
  const [, pidText, startedAt, command] = match;
  const pid = Number.parseInt(pidText, 10);
  if (pid === process.pid || !Number.isSafeInteger(pid)) continue;
  const fixture = fixtureDirectoryOf(command, roots);
  if (fixture === null) continue;
  const ageHours = (Date.now() - Date.parse(startedAt)) / 3_600_000;
  const missing = !existsSync(fixture);
  const aged = olderThanHours !== null && Number.isFinite(ageHours) && ageHours > olderThanHours;
  candidates.push({ pid, startedAt, fixture, command, ageHours, missing, aged });
}

const orphans = candidates.filter(({ missing, aged }) => missing || aged);
const inUse = candidates.filter(({ missing, aged }) => !missing && !aged);

for (const entry of inUse) {
  const age = Number.isFinite(entry.ageHours) ? `${entry.ageHours.toFixed(1)}時間前起動` : '起動時刻不明';
  process.stdout.write(`残す pid=${entry.pid} ${entry.startedAt}（${age}）— fixtureが存在する: ${entry.fixture}\n`);
}
for (const entry of orphans) {
  const reason = entry.missing ? `fixture不在: ${entry.fixture}`
    : `${entry.ageHours.toFixed(1)}時間前起動でfixtureは残存: ${entry.fixture}`;
  process.stdout.write(`${REAP ? '停める' : '停める候補'} pid=${entry.pid} ${entry.startedAt} — ${reason}\n`);
}

let reaped = 0;
if (REAP) {
  for (const entry of orphans) {
    try { process.kill(entry.pid, 'SIGTERM'); } catch { continue; }
    reaped += 1;
  }
  await new Promise((resolve) => { setTimeout(resolve, 2_000); });
  for (const entry of orphans) {
    try { process.kill(entry.pid, 0); } catch { continue; }
    try { process.kill(entry.pid, 'SIGKILL'); } catch { /* 既に終了 */ }
  }
}

const remaining = orphans.filter(({ pid }) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
});
process.stdout.write(`${JSON.stringify({
  schema: 'lattice.orphan_test_daemon_reap.v1',
  mode: REAP ? 'reap' : 'list',
  older_than_hours: olderThanHours,
  matched: candidates.length,
  kept: inUse.length,
  reapable: orphans.length,
  reapable_fixture_missing: orphans.filter(({ missing }) => missing).length,
  reapable_aged_only: orphans.filter(({ missing, aged }) => !missing && aged).length,
  signaled: reaped,
  still_alive: remaining.length,
})}\n`);
