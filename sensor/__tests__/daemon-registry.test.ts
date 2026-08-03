import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getRegistryDir,
  isProcessAlive,
  registerDaemon,
  deregisterDaemon,
  listDaemons,
  type DaemonRecord,
} from '../src/mcp/daemon-registry';

/** A pid that's guaranteed dead: spawn a trivial process, let it exit, reap it. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const pid = child.pid!;
  await new Promise<void>((r) => child.on('exit', () => r()));
  await new Promise((r) => setTimeout(r, 50)); // let the OS reap it
  return pid;
}

function rec(root: string, pid: number, startedAt = Date.now()): DaemonRecord {
  return { root, pid, version: '1.0.0', socketPath: `${root}/.lattice/sensor/daemon.sock`, startedAt };
}

/**
 * 死んだ記録をregisterDaemonを通さずに置く。本番で記録が死ぬのは登録の「後」——
 * daemonがSIGKILLされた、あるいは一時repoごと消えた時——なので、登録時の掃除に
 * 巻き込まれない形で作る必要がある。
 */
function plantDeadRecord(root: string, pid: number): void {
  const dir = getRegistryDir();
  fs.mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(dir, `${hash}.json`), `${JSON.stringify(rec(root, pid), null, 2)}\n`, { mode: 0o600 });
}

describe('daemon-registry', () => {
  let tmpHome: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-home-'));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome; // os.homedir() honors HOME (POSIX) ...
    process.env.USERPROFILE = tmpHome; // ... and USERPROFILE (Windows)
    // Sanity: the registry must resolve under our temp home, or the test would
    // pollute the real ~/.lattice.
    expect(getRegistryDir().startsWith(tmpHome)).toBe(true);
    // ADR 0049 Decision 3(b): the registry is Lattice-specific
    // (`~/.lattice/sensor/daemons`), NOT the shared upstream
    // `~/.lattice/sensor/daemons` — pin the exact suffix so a regression back to
    // the shared path (re-enabling cross-product `stop --all`) fails loudly.
    expect(getRegistryDir()).toBe(path.join(tmpHome, '.lattice', 'sensor', 'daemons'));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('isProcessAlive', () => {
    it('is true for our own process and false for junk/dead pids', async () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(NaN)).toBe(false);
      expect(isProcessAlive(await deadPid())).toBe(false);
    });
  });

  it('listDaemons returns [] when nothing is registered (no dir yet)', () => {
    expect(listDaemons()).toEqual([]);
  });

  it('register → list shows a live daemon; deregister removes it', () => {
    registerDaemon(rec('/proj/a', process.pid));
    const live = listDaemons();
    expect(live).toHaveLength(1);
    expect(live[0].root).toBe('/proj/a');
    expect(live[0].pid).toBe(process.pid);

    deregisterDaemon('/proj/a');
    expect(listDaemons()).toEqual([]);
  });

  it('prunes records whose process is dead', async () => {
    const dead = await deadPid();
    registerDaemon(rec('/proj/dead', dead));
    registerDaemon(rec('/proj/live', process.pid));

    const live = listDaemons();
    expect(live).toHaveLength(1);
    expect(live[0].root).toBe('/proj/live');

    // The dead record's file was deleted as a side effect.
    const remaining = fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(1);
  });

  it('peeking with prune:false leaves dead records on disk', async () => {
    // 記録を直接置く。registerDaemon経由にすると、登録時の掃除がその場で消してしまう
    // ——本番で死ぬのは登録の「後」なので、こちらが実態に忠実である。
    plantDeadRecord('/proj/dead', await deadPid());
    expect(listDaemons({ prune: false })).toEqual([]); // dead is filtered from results
    // ...but the file survives for the caller to inspect.
    expect(fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  /**
   * 登録は掃除の機会でもある。これが無いと、掃除は人が`daemon list`を叩いた時にしか
   * 走らず、記録はproject rootごとに永久に積み上がる（integration testの一時repoは
   * それぞれ別rootなので、test 1回ごとに死んだ記録が増える）。実測で978件・うち死亡967件・
   * 最古17日前まで育っていた。
   */
  it('登録のたびに死んだ記録を掃除するので、登録簿が無限に育たない', async () => {
    const dead = await deadPid();
    for (let i = 0; i < 5; i += 1) plantDeadRecord(`/tmp/vanished-test-repo-${i}`, dead);
    expect(fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'))).toHaveLength(5);

    registerDaemon(rec('/proj/live', process.pid));

    // 生きている自分の記録だけが残る。
    const remaining = fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(1);
    expect(listDaemons().map((d) => d.root)).toEqual(['/proj/live']);
  });

  it('lists multiple live daemons newest-first', () => {
    registerDaemon(rec('/proj/old', process.pid, 1000));
    registerDaemon(rec('/proj/new', process.pid, 2000));
    const live = listDaemons();
    expect(live.map((d) => d.root)).toEqual(['/proj/new', '/proj/old']);
  });
});
