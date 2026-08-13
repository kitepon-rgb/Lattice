import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// scripts/upstream-sync.mjs のhermetic test。
//
// 実upstream(GitHub)には触れない。一時ディレクトリに「偽のupstream repo」と
// 「偽のLattice repo」を作り、全経路をローカルgitだけで回す。この仕組みの穴は
// 全部「実際に動かして初めて」見つかった——リネーム復活も、base=absorbed_at固定の
// 再衝突も。だからテストは実行経路そのものを踏む。

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/upstream-sync.mjs');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** 偽upstream: base commit → 変更commit を作り、各SHAを返す。 */
async function makeUpstream(root, { baseFiles, headFiles }) {
  const up = path.join(root, 'upstream');
  await mkdir(up, { recursive: true });
  git(up, 'init', '-q', '-b', 'main');
  git(up, 'config', 'user.email', 't@t');
  git(up, 'config', 'user.name', 't');
  for (const [rel, body] of Object.entries(baseFiles)) {
    const p = path.join(up, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  git(up, 'add', '-A');
  git(up, 'commit', '-qm', 'base');
  const base = git(up, 'rev-parse', 'HEAD');
  for (const [rel, body] of Object.entries(headFiles)) {
    const p = path.join(up, rel);
    if (body === null) {
      await rm(p, { force: true });
    } else {
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
    }
  }
  git(up, 'add', '-A');
  git(up, 'commit', '-qm', 'head');
  const head = git(up, 'rev-parse', 'HEAD');
  return { up, base, head };
}

/** 偽Lattice repo: sensor/ とmanifestを作ってcommitする。 */
async function makeLocal(root, { upstreamRepo, syncedAt, files, manifest = {} }) {
  const repo = path.join(root, 'local');
  await mkdir(path.join(repo, 'sensor'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(repo, 'sensor', rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  const base = {
    schema: 'lattice.sensor_upstream_manifest.v1',
    upstream: { repo: upstreamRepo, license: 'MIT', notice: 'NOTICE' },
    absorbed_at: { commit: syncedAt, date: '2026-01-01', method: 'test' },
    synced_at: { commit: syncedAt, date: '2026-01-01' },
    path_map: {},
    skip: [],
    lattice_only: ['UPSTREAM.json'],
    accepted_deletions: [],
    conflict_policy: [],
    ...manifest,
  };
  await writeFile(path.join(repo, 'sensor', 'UPSTREAM.json'), `${JSON.stringify(base, null, 2)}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'local');
  return repo;
}

function runSync(repo, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, LATTICE_UPSTREAM_SYNC_ROOT: repo },
  });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* エラー経路はstderrを見る */ }
  return { status: r.status, report, stderr: r.stderr };
}

const readManifest = async (repo) =>
  JSON.parse(await readFile(path.join(repo, 'sensor', 'UPSTREAM.json'), 'utf8'));

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'upstream-sync-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('cleanなsyncはsynced_atを進め、同じrefの再実行は空振りになる', async (t) => {
  const root = await workspace(t);
  // 改名(1行目)と追記(末尾)を離す——隣接行の変更は正当な衝突なので、
  // ここでは「離れた行はcleanにmergeされる」ことだけを固定する。
  const spacer = 'export const s1 = 0;\nexport const s2 = 0;\nexport const s3 = 0;\n';
  const { up, base, head } = await makeUpstream(root, {
    baseFiles: { 'a.ts': `const CODEGRAPH = 1;\n${spacer}export const tail = 1;\n` },
    headFiles: { 'a.ts': `const CODEGRAPH = 1;\n${spacer}export const tail = 1;\nexport const added = 2;\n` },
  });
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base,
    files: { 'a.ts': `const LATTICE_SENSOR = 1;\n${spacer}export const tail = 1;\n` },
  });

  const first = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.report.synced_at_advanced, true);
  const merged = await readFile(path.join(repo, 'sensor', 'a.ts'), 'utf8');
  assert.match(merged, /LATTICE_SENSOR = 1/u);
  assert.match(merged, /added = 2/u);
  assert.equal((await readManifest(repo)).synced_at.commit, head);

  // 2回目: baseとtargetが同一になり、変更ゼロで完走する（冪等）。
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'sync1');
  const second = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.report.merged.length + second.report.added.length
    + second.report.conflicted.length, 0);
});

test('手で解決した衝突は、synced_atが進んだ後のsyncで再衝突しない', async (t) => {
  const root = await workspace(t);
  const { up, base } = await makeUpstream(root, {
    baseFiles: { 'v.ts': 'export const V = 1;\n' },
    headFiles: { 'v.ts': 'export const V = 2; // upstream\n' },
  });
  // ローカルも同じ行を変更している → 衝突する
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base,
    files: { 'v.ts': 'export const V = 10; // lattice\n' },
  });

  const first = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(first.status, 1);
  assert.equal(first.report.synced_at_advanced, false);
  assert.equal(first.report.conflicted.length, 1);

  // 人が解決してsynced_atを手で進める（manual解決の完了protocol）。
  await writeFile(path.join(repo, 'sensor', 'v.ts'), 'export const V = 12; // resolved\n');
  const manifest = await readManifest(repo);
  manifest.synced_at.commit = git(path.join(root, 'upstream'), 'rev-parse', 'main');
  await writeFile(path.join(repo, 'sensor', 'UPSTREAM.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'resolve');

  // base=synced_atなので、解決済み箇所はもう衝突しない。
  const second = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(second.status, 0, JSON.stringify(second.report?.conflicted));
  assert.equal(second.report.conflicted.length, 0);
  const body = await readFile(path.join(repo, 'sensor', 'v.ts'), 'utf8');
  assert.match(body, /V = 12/u);
});

test('baseに在りローカルで改名したファイルは、写像が無ければ復活せず止まる', async (t) => {
  const root = await workspace(t);
  const { up, base } = await makeUpstream(root, {
    baseFiles: { 'bin/old-name.ts': 'export const x = 1;\n' },
    headFiles: { 'bin/old-name.ts': 'export const x = 2;\n' },
  });
  // ローカルはリネーム済み（old-nameは存在しない）
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base,
    files: { 'bin/new-name.ts': 'export const x = 1;\n' },
  });

  const result = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(result.status, 1);
  assert.deepEqual(result.report.rename_unmapped, ['sensor/bin/old-name.ts']);
  assert.equal(result.report.synced_at_advanced, false);
  // 旧名は復活していない
  assert.equal(existsSync(path.join(repo, 'sensor', 'bin', 'old-name.ts')), false);

  // path_mapへ写像を書けば、リネーム先へmergeされて完走する。
  const manifest = await readManifest(repo);
  manifest.path_map['bin/old-name.ts'] = 'bin/new-name.ts';
  await writeFile(path.join(repo, 'sensor', 'UPSTREAM.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'map');
  const second = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(second.status, 0, JSON.stringify(second.report));
  const body = await readFile(path.join(repo, 'sensor', 'bin', 'new-name.ts'), 'utf8');
  assert.match(body, /x = 2/u);
});

test('upstreamの削除は自動削除せず、承認されるまでsynced_atを止める', async (t) => {
  const root = await workspace(t);
  const { up, base } = await makeUpstream(root, {
    baseFiles: { 'keep.ts': 'export const k = 1;\n', 'gone.ts': 'export const g = 1;\n' },
    headFiles: { 'gone.ts': null },
  });
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base,
    files: { 'keep.ts': 'export const k = 1;\n', 'gone.ts': 'export const g = 1;\n' },
  });

  const first = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(first.status, 1);
  assert.deepEqual(first.report.upstream_deleted, ['sensor/gone.ts']);
  // ファイルは消えていない（削除は取り込みより取り返しがつかない）
  assert.equal(existsSync(path.join(repo, 'sensor', 'gone.ts')), true);
  assert.equal(first.report.synced_at_advanced, false);

  // 削除を承認すれば完走する。ファイルの物理削除は人の作業のまま。
  const manifest = await readManifest(repo);
  manifest.accepted_deletions = ['gone.ts'];
  await writeFile(path.join(repo, 'sensor', 'UPSTREAM.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'accept');
  const second = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(second.status, 0, JSON.stringify(second.report));
  assert.equal(second.report.synced_at_advanced, true);
});

test('synced_atの祖先へ向かうsyncは拒否される（markerの巻き戻し防止）', async (t) => {
  const root = await workspace(t);
  const { up, base, head } = await makeUpstream(root, {
    baseFiles: { 'a.ts': 'export const a = 1;\n' },
    headFiles: { 'a.ts': 'export const a = 2;\n' },
  });
  // 既にheadまで同期済みの状態を作る
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: head,
    files: { 'a.ts': 'export const a = 2;\n' },
  });

  const result = runSync(repo, '--ref', base, '--apply');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REF_NOT_DESCENDANT/u);
});

test('sensor/が汚れていると適用は拒否される', async (t) => {
  const root = await workspace(t);
  const { up, base } = await makeUpstream(root, {
    baseFiles: { 'a.ts': 'export const a = 1;\n' },
    headFiles: { 'a.ts': 'export const a = 2;\n' },
  });
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base,
    files: { 'a.ts': 'export const a = 1;\n' },
  });
  await writeFile(path.join(repo, 'sensor', 'a.ts'), 'uncommitted local edit\n');

  const result = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /WORKTREE_DIRTY/u);
});

test('conflict_policyのoursは自動決着し、捨てたupstream変更が報告される', async (t) => {
  const root = await workspace(t);
  const { up, base } = await makeUpstream(root, {
    baseFiles: { 'README.md': '# upstream readme\n' },
    headFiles: { 'README.md': '# upstream readme v2\n' },
  });
  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base,
    files: { 'README.md': '# lattice readme\n' },
    manifest: {
      conflict_policy: [{ path: 'README.md', resolution: 'ours', why: 'ours describes lattice' }],
    },
  });

  const result = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(result.status, 0, JSON.stringify(result.report?.conflicted));
  assert.equal(result.report.policy_applied.length, 1);
  assert.equal(result.report.policy_applied[0].discarded_upstream_change, true);
  // oursが残っている
  const body = await readFile(path.join(repo, 'sensor', 'README.md'), 'utf8');
  assert.match(body, /lattice readme/u);
  assert.equal(result.report.synced_at_advanced, true);
});

test('binaryの両側変更は衝突として報告され、作業ツリーへ書かれない', async (t) => {
  const root = await workspace(t);
  const bin = (...bytes) => Buffer.from(bytes);
  const up = path.join(root, 'upstream');
  await mkdir(up, { recursive: true });
  git(up, 'init', '-q', '-b', 'main');
  git(up, 'config', 'user.email', 't@t'); git(up, 'config', 'user.name', 't');
  await writeFile(path.join(up, 'blob.bin'), bin(0, 1, 2, 3));
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'base');
  const base = git(up, 'rev-parse', 'HEAD');
  await writeFile(path.join(up, 'blob.bin'), bin(0, 9, 9, 3));
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'head');

  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base, files: {},
  });
  await writeFile(path.join(repo, 'sensor', 'blob.bin'), bin(0, 1, 7, 3));
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'local-edit');

  const result = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(result.status, 1);
  const entry = result.report.conflicted.find((c) => c.path === 'sensor/blob.bin');
  assert.ok(entry, JSON.stringify(result.report.conflicted));
  assert.equal(entry.binary, true);
  // binaryはマーカーを書けないので、ローカルの中身が無傷で残る。
  const kept = await readFile(path.join(repo, 'sensor', 'blob.bin'));
  assert.deepEqual([...kept], [0, 1, 7, 3]);
});

test('upstreamの実行bitは新規追加時に保存される', async (t) => {
  const root = await workspace(t);
  const up = path.join(root, 'upstream');
  await mkdir(up, { recursive: true });
  git(up, 'init', '-q', '-b', 'main');
  git(up, 'config', 'user.email', 't@t'); git(up, 'config', 'user.name', 't');
  await writeFile(path.join(up, 'seed.txt'), 'seed\n');
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'base');
  const base = git(up, 'rev-parse', 'HEAD');
  await writeFile(path.join(up, 'tool.sh'), '#!/bin/sh\necho hi\n');
  const { chmodSync } = await import('node:fs');
  chmodSync(path.join(up, 'tool.sh'), 0o755);
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'add tool');

  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base, files: { 'seed.txt': 'seed\n' },
  });
  const result = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(result.status, 0, result.stderr);
  if (process.platform !== 'win32') {
    const { statSync } = await import('node:fs');
    const mode = statSync(path.join(repo, 'sensor', 'tool.sh')).mode & 0o111;
    assert.notEqual(mode, 0, 'executable bit was dropped');
  }
});

test('upstreamでadd→deleteされたファイルはこちらに無ければ何も起きない', async (t) => {
  const root = await workspace(t);
  const up = path.join(root, 'upstream');
  await mkdir(up, { recursive: true });
  git(up, 'init', '-q', '-b', 'main');
  git(up, 'config', 'user.email', 't@t'); git(up, 'config', 'user.name', 't');
  await writeFile(path.join(up, 'seed.txt'), 'seed\n');
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'base');
  const base = git(up, 'rev-parse', 'HEAD');
  await writeFile(path.join(up, 'ephemeral.ts'), 'export const x = 1;\n');
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'add');
  await rm(path.join(up, 'ephemeral.ts'));
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'delete');

  const repo = await makeLocal(root, {
    upstreamRepo: up, syncedAt: base, files: { 'seed.txt': 'seed\n' },
  });
  const result = runSync(repo, '--ref', 'main', '--apply');
  assert.equal(result.status, 0, JSON.stringify(result.report));
  assert.equal(existsSync(path.join(repo, 'sensor', 'ephemeral.ts')), false);
  assert.deepEqual(result.report.upstream_deleted, []);
});
