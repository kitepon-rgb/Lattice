#!/usr/bin/env node
//
// sensor/ を upstream (CodeGraph) の任意のrefへ3-way mergeで追従させる。
//
//   node scripts/upstream-sync.mjs                 # main との差分を一覧（適用しない）
//   node scripts/upstream-sync.mjs --ref <ref>     # 対象refを指定
//   node scripts/upstream-sync.mjs --apply         # 作業ツリーへ適用
//   node scripts/upstream-sync.mjs --apply --json  # 機械可読の結果
//   node scripts/upstream-sync.mjs --ref <ref> --mark-synced
//                                    # 手動解決の完了を宣言し、markerだけ進める
//
// 衝突が出たapplyの後の正しい手順は「解決 → commit → --mark-synced → commit」。
// markerを進めずに同じrefへ--applyを再実行してはならない——oursもtheirsも
// baseから動いているため全部が再衝突し、解決済みファイルへ衝突マーカーを
// 注入する（実際に起きた）。--mark-syncedがその再実行を不要にする。
//
// 3-way mergeのbaseは `sensor/UPSTREAM.json` の synced_at（前回同期点）である。Lattice側の
// 改名（LATTICE_SENSOR_* 等）はbaseからの通常のローカル変更として扱われるので、
// upstreamが同じ行を触らない限り衝突しない。置換規則は持たない——改名は選択的で、
// 規則では再現できない（UPSTREAM.json の notes を見よ）。
//
// 適用は「衝突ゼロで完走した時だけ synced_at を進める」。部分適用のまま印を進めると、
// 次回の実行がmergeされていないものを黙って飛ばす。

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// LATTICE_UPSTREAM_SYNC_ROOT はtest用のroot差し替えである。hermetic testは
// 一時repoを作ってそこで全経路を回す——実repoと実upstreamに対してしか動かない
// 作りでは、削除・巻き戻し・中断の経路を安全に検証できない。
const REPO_ROOT = process.env.LATTICE_UPSTREAM_SYNC_ROOT
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'sensor', 'UPSTREAM.json');
const CACHE_DIR = path.join(REPO_ROOT, '.lattice', 'upstream-cache');

class SyncError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function git(args, { cwd = REPO_ROOT, allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new SyncError('GIT_FAILED', `git ${args.slice(0, 2).join(' ')} failed`, {
      status: result.status, stderr: String(result.stderr).slice(0, 2000),
    });
  }
  return result;
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new SyncError('MANIFEST_MISSING', 'sensor/UPSTREAM.json not found');
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  for (const key of ['upstream', 'absorbed_at', 'synced_at', 'path_map', 'skip', 'lattice_only']) {
    if (manifest[key] === undefined) {
      throw new SyncError('MANIFEST_INVALID', `UPSTREAM.json missing "${key}"`);
    }
  }
  return manifest;
}

/** upstreamのbare cloneを用意して目的のrefを取り込む。二度目からはfetchだけ。 */
function ensureUpstream(repo, refs) {
  mkdirSync(path.dirname(CACHE_DIR), { recursive: true });
  if (!existsSync(CACHE_DIR)) {
    git(['clone', '--bare', '--filter=blob:none', repo, CACHE_DIR], { cwd: REPO_ROOT });
  }
  git(['fetch', '--quiet', 'origin', '+refs/heads/*:refs/heads/*', '--tags'], { cwd: CACHE_DIR });
  for (const ref of refs) {
    const probe = git(['cat-file', '-e', `${ref}^{commit}`], { cwd: CACHE_DIR, allowFail: true });
    if (probe.status !== 0) {
      throw new SyncError('REF_UNKNOWN', `upstream ref not found: ${ref}`, { ref });
    }
  }
}

const listTree = (ref, cwd) =>
  new Set(String(git(['ls-tree', '-r', '--name-only', ref], { cwd }).stdout).split('\n').filter(Boolean));

const blobAt = (ref, file, cwd) => {
  const result = git(['show', `${ref}:${file}`], { cwd, allowFail: true });
  return result.status === 0 ? result.stdout : null;
};

/** upstream相対path -> Lattice repo相対path。path_mapは接頭辞一致で適用する。 */
function mapPath(upstreamPath, pathMap) {
  for (const [from, to] of Object.entries(pathMap)) {
    if (upstreamPath === from) return path.posix.join('sensor', to);
    if (upstreamPath.startsWith(`${from}/`)) {
      return path.posix.join('sensor', to, upstreamPath.slice(from.length + 1));
    }
  }
  return path.posix.join('sensor', upstreamPath);
}

const matchesAny = (candidate, patterns) =>
  patterns.some((p) => (p.endsWith('/') ? candidate.startsWith(p) : candidate === p));

function policyFor(localPath, policies) {
  const relative = localPath.startsWith('sensor/') ? localPath.slice('sensor/'.length) : localPath;
  return policies.find((entry) => entry.path === relative) ?? null;
}

/**
 * 記録済みの決着を実際に適用する。
 *
 * policyを表示するだけにすると、決めた意味が無い——次のsyncで同じ衝突をまた手で
 * 解くことになる。`ours`/`theirs`は決着として自動適用し、`manual`と未登録だけが
 * 人を止める。ただし`ours`で捨てたupstream変更は必ず報告する（黙って捨てない）。
 */
const AUTO_RESOLUTIONS = new Set(['ours', 'theirs']);

function parseArgs(argv) {
  const options = { ref: 'main', apply: false, json: false, force: false, markSynced: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--mark-synced') options.markSynced = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--ref') {
      options.ref = argv[i + 1];
      i += 1;
      if (!options.ref) throw new SyncError('ARGS_INVALID', '--ref requires a value');
    } else throw new SyncError('ARGS_INVALID', `unknown argument: ${arg}`);
  }
  return options;
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest();
  // 3-way mergeのbaseは前回同期点である。absorbed_atで固定すると、前回manualで
  // 解決した箇所がbase→ours と base→theirs の両方で変化した扱いになり、同期の
  // たびに必ず再衝突する——解決が成功状態へ遷移する手段が無くなる。
  const base = manifest.synced_at.commit;
  ensureUpstream(manifest.upstream.repo, [base, options.ref]);

  const target = String(git(['rev-parse', options.ref], { cwd: CACHE_DIR }).stdout).trim();

  // 単調前進の強制。古いrefを指定すればmarkerを巻き戻せてしまい、treeは新しい
  // まま marker だけ古いという不整合が残る。targetはbaseの子孫でなければならない。
  if (target !== base) {
    const descendant = git(['merge-base', '--is-ancestor', base, target],
      { cwd: CACHE_DIR, allowFail: true });
    if (descendant.status !== 0) {
      throw new SyncError('REF_NOT_DESCENDANT',
        'target ref is not a descendant of synced_at; syncing to it would move the marker backwards',
        { synced_at: base, target, ref: options.ref });
    }
  }
  // 手動解決の完了宣言。3-way mergeはせず、markerをtargetへ進めるだけ。
  // 衝突解決がcommit済みであることを要求する（dirtyなtreeで進めると、
  // 何を解決としてmarkしたのか後から特定できない）。
  if (options.markSynced) {
    const dirty = String(git(['status', '--porcelain', '--', 'sensor']).stdout).trim();
    if (dirty !== '') {
      throw new SyncError('WORKTREE_DIRTY',
        'commit the resolved tree before --mark-synced', {});
    }
    const markers = spawnSync('git', ['grep', '-l', '^<<<<<<< lattice', '--', 'sensor'],
      { cwd: REPO_ROOT, encoding: 'utf8' });
    if (markers.status === 0 && markers.stdout.trim() !== '') {
      throw new SyncError('CONFLICT_MARKERS_REMAIN',
        'conflict markers are still committed in sensor/ — resolve them first',
        { files: markers.stdout.trim().split('\n').slice(0, 10) });
    }
    manifest.synced_at = { commit: target, date: new Date().toISOString().slice(0, 10) };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`synced_at advanced to ${target.slice(0, 12)} (manual resolution declared).\n`);
    return 0;
  }

  const baseTree = listTree(base, CACHE_DIR);
  const targetTree = listTree(target, CACHE_DIR);

  // 汚れた作業ツリーへ書くと、自分の未commit変更とupstream由来が混ざって切り分け
  // られなくなる。適用は必ずcleanなsensor/から始める。
  if (options.apply && !options.force) {
    const dirty = String(git(['status', '--porcelain', '--', 'sensor']).stdout).trim();
    if (dirty !== '') {
      throw new SyncError('WORKTREE_DIRTY',
        'sensor/ has uncommitted changes; commit or stash first (or pass --force)',
        { entries: dirty.split('\n').slice(0, 10) });
    }
  }

  const report = {
    schema: 'lattice.sensor_upstream_sync_result.v2',
    base,
    target,
    ref: options.ref,
    applied: options.apply,
    merged: [],
    added: [],
    conflicted: [],
    policy_applied: [],
    rename_unmapped: [],
    upstream_deleted: [],
    skipped: 0,
    unchanged: 0,
  };

  // 適用は走査と分ける。走査中に書くと、後半で落ちた時に前半の書換えだけが
  // 作業ツリーへ残り、どこまで進んだか分からない中途半端な状態になる。
  const writes = [];
  const scratch = mkdtempSync(path.join(tmpdir(), 'lattice-upstream-'));
  try {
    for (const upstreamPath of new Set([...baseTree, ...targetTree])) {
      if (matchesAny(upstreamPath, manifest.skip)) {
        report.skipped += 1;
        continue;
      }
      const localPath = mapPath(upstreamPath, manifest.path_map);
      const relative = localPath.slice('sensor/'.length);
      if (matchesAny(relative, manifest.lattice_only)) {
        report.skipped += 1;
        continue;
      }

      const theirs = blobAt(target, upstreamPath, CACHE_DIR);
      const baseBlob = blobAt(base, upstreamPath, CACHE_DIR);
      const absolute = path.join(REPO_ROOT, localPath);

      // upstreamが消したファイルは自動削除しない。Latticeが使っている可能性があり、
      // 削除は取り込みより取り返しがつかない。報告だけして人へ渡す。
      if (theirs === null) {
        if (!existsSync(absolute)) continue;
        // 承認済みの削除は再提示しない。未承認は人を止める（後述）。
        if (!matchesAny(relative, manifest.accepted_deletions ?? [])) {
          report.upstream_deleted.push(localPath);
        }
        continue;
      }

      // upstreamの新規ファイル。Lattice側に無ければそのまま置ける。
      //
      // ただしbaseに在ってoursに無いなら、それは「upstreamの新規」ではなく
      // 「Latticeがリネーム/削除した」ものである。path_mapへ写像を書かずに追加
      // すると、リネーム前の名前が復活して両方が並ぶ（実際に src/bin/codegraph.ts
      // で起きた）。baseに在るものは新規として置かず、写像漏れとして報告する。
      if (!existsSync(absolute)) {
        if (baseBlob !== null) {
          report.rename_unmapped.push(localPath);
          continue;
        }
        report.added.push(localPath);
        writes.push({ absolute, data: theirs });
        continue;
      }

      const ours = readFileSync(absolute);
      if (baseBlob !== null && ours.equals(theirs)) {
        report.unchanged += 1;
        continue;
      }

      // baseに無い＝upstreamの新規だがLattice側にも同名がある。共通祖先を空として
      // 3-wayに持ち込むと全行衝突になるので、実態どおり空baseで解かせる。
      const files = {
        ours: path.join(scratch, 'ours'),
        base: path.join(scratch, 'base'),
        theirs: path.join(scratch, 'theirs'),
      };
      writeFileSync(files.ours, ours);
      writeFileSync(files.base, baseBlob ?? Buffer.alloc(0));
      writeFileSync(files.theirs, theirs);

      const merge = git(['merge-file', '-p', '-L', 'lattice', '-L', 'upstream-base', '-L', 'upstream',
        files.ours, files.base, files.theirs], { allowFail: true });

      if (merge.status === 0) {
        // 改名などローカル変更だけの差はmerge結果がoursと一致する。書く必要が
        // 無いものをmergedへ数えると、毎回のsyncが偽の作業量を報告し続ける。
        if (merge.stdout.equals(ours)) {
          report.unchanged += 1;
          continue;
        }
        report.merged.push(localPath);
        writes.push({ absolute, data: merge.stdout });
        continue;
      }

      // 127以上は「mergeできなかった」(binary等)。衝突数とは区別する。
      const binary = merge.status >= 127;
      const policy = policyFor(localPath, manifest.conflict_policy ?? []);

      // 決着済みはここで閉じる。人を止めるのは manual と未登録だけ。
      if (policy && AUTO_RESOLUTIONS.has(policy.resolution)) {
        report.policy_applied.push({
          path: localPath,
          resolution: policy.resolution,
          // ours は upstream の変更を意図的に捨てている。捨てた事実を毎回可視化する。
          discarded_upstream_change: policy.resolution === 'ours',
        });
        if (policy.resolution === 'theirs') writes.push({ absolute, data: theirs });
        continue;
      }

      report.conflicted.push({
        path: localPath,
        hunks: binary ? null : merge.status,
        binary,
        policy: policy?.resolution ?? null,
        why: policy?.why ?? null,
      });
      if (!binary) writes.push({ absolute, data: merge.stdout });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // 全件の結果が揃ってから初めて作業ツリーへ触る。
  if (options.apply) {
    for (const { absolute, data } of writes) {
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, data);
    }
  }

  report.conflicted.sort((a, b) => a.path.localeCompare(b.path));
  report.merged.sort();
  report.added.sort();

  // 未処理が1つでも残るなら印を進めない。進めれば次回がここを飛ばす。
  // upstreamの削除も未処理に数える——「消えたことに気づかないまま印だけ進む」のが
  // まさに今回54コミット溜めた形である。承認するなら accepted_deletions へ書く。
  const clean = report.conflicted.length === 0 && report.upstream_deleted.length === 0
    && report.rename_unmapped.length === 0;
  if (options.apply && clean) {
    manifest.synced_at = { commit: target, date: new Date().toISOString().slice(0, 10) };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    report.synced_at_advanced = true;
  } else {
    report.synced_at_advanced = false;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return clean ? 0 : 1;
  }

  const lines = [
    `base   ${report.base.slice(0, 12)}  (synced_at — the merge base)`,
    `target ${report.target.slice(0, 12)}  (${report.ref})`,
    '',
    `auto-merged ${report.merged.length}   added ${report.added.length}   unchanged ${report.unchanged}   skipped ${report.skipped}`,
    `settled by recorded policy ${report.policy_applied.length}`,
    `conflicts   ${report.conflicted.length}`,
  ];
  const discarded = report.policy_applied.filter((entry) => entry.discarded_upstream_change);
  if (discarded.length > 0) {
    lines.push('', `upstream changes deliberately discarded (policy=ours): ${discarded.length}`);
    for (const entry of discarded) lines.push(`  ${entry.path}`);
  }
  for (const entry of report.conflicted) {
    const decided = entry.policy ? `policy=${entry.policy}` : 'UNDECIDED — record it in UPSTREAM.json';
    lines.push(`  ${entry.binary ? 'binary' : `${entry.hunks} hunk(s)`.padEnd(10)} ${entry.path}  [${decided}]`);
    if (entry.why) lines.push(`      ${entry.why}`);
  }
  if (report.rename_unmapped.length > 0) {
    lines.push('', `RENAME NOT MAPPED — present in base, absent locally: ${report.rename_unmapped.length}`);
    lines.push('  Lattice renamed or deleted these. Add the mapping to path_map, or the old name comes back.');
    for (const p of report.rename_unmapped) lines.push(`  ${p}`);
  }
  if (report.upstream_deleted.length > 0) {
    lines.push('', `upstream deleted (kept locally — decide by hand): ${report.upstream_deleted.length}`);
    for (const p of report.upstream_deleted.slice(0, 20)) lines.push(`  ${p}`);
  }
  if (!options.apply) lines.push('', 'dry run — pass --apply to write.');
  else if (clean) lines.push('', `synced_at advanced to ${report.target.slice(0, 12)}.`);
  else lines.push('', 'conflicts remain — synced_at NOT advanced. Resolve, record the policy, rerun.');
  process.stdout.write(`${lines.join('\n')}\n`);
  return clean ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  if (error instanceof SyncError) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message, ...error.detail })}\n`);
    process.exitCode = 2;
  } else throw error;
}
