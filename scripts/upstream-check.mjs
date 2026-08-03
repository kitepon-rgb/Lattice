#!/usr/bin/env node
//
// upstream (CodeGraph) が synced_at からどれだけ進んだかを報告する。
//
//   node scripts/upstream-check.mjs           # 人が読む形
//   node scripts/upstream-check.mjs --json    # 機械可読
//
// 今回54コミット・201ファイル分を溜めたのは、進んだことに気づく契機が無かったからで
// ある（吸収点は散文にしか無く、誰も見ていなかった）。この面は定期実行して溜める前に
// 気づくためだけに在り、何も書き換えない。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'sensor', 'UPSTREAM.json');
const CACHE_DIR = path.join(REPO_ROOT, '.lattice', 'upstream-cache');

/** 抽出・言語解釈に関わる面。ここが動いた時だけ追従の優先度が上がる。 */
const EXTRACTION_PREFIXES = ['src/extraction/', 'src/types.ts', 'codegraph-kernel/'];

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${JSON.stringify({ code: 'GIT_FAILED', args: args.slice(0, 2), stderr: result.stderr.slice(0, 1000) })}\n`);
    process.exit(2);
  }
  return result.stdout;
}

const json = process.argv.includes('--json');
if (!existsSync(MANIFEST_PATH)) {
  process.stderr.write(`${JSON.stringify({ code: 'MANIFEST_MISSING', path: 'sensor/UPSTREAM.json' })}\n`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const synced = manifest.synced_at.commit;

mkdirSync(path.dirname(CACHE_DIR), { recursive: true });
if (!existsSync(CACHE_DIR)) {
  git(['clone', '--bare', '--filter=blob:none', manifest.upstream.repo, CACHE_DIR], REPO_ROOT);
}
git(['fetch', '--quiet', 'origin', '+refs/heads/*:refs/heads/*', '--tags'], CACHE_DIR);

const head = git(['rev-parse', 'main'], CACHE_DIR).trim();
const behind = Number(git(['rev-list', '--count', `${synced}..${head}`], CACHE_DIR).trim());
const files = behind === 0 ? [] : git(['diff', '--name-only', `${synced}..${head}`], CACHE_DIR).split('\n').filter(Boolean);
const extraction = files.filter((f) => EXTRACTION_PREFIXES.some((p) => f === p || f.startsWith(p)));

const report = {
  schema: 'lattice.sensor_upstream_check_result.v1',
  synced_at: synced,
  upstream_head: head,
  behind_commits: behind,
  changed_files: files.length,
  extraction_files: extraction.length,
  next_action: behind === 0 ? null : 'node scripts/upstream-sync.mjs --ref main',
};

if (json) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else if (behind === 0) {
  process.stdout.write(`upstream is level with synced_at (${synced.slice(0, 12)}).\n`);
} else {
  process.stdout.write([
    `synced_at      ${synced.slice(0, 12)}`,
    `upstream head  ${head.slice(0, 12)}`,
    '',
    `behind by ${behind} commit(s), ${files.length} file(s).`,
    `of those, ${extraction.length} touch extraction / language interpretation.`,
    '',
    `next: ${report.next_action}`,
  ].join('\n') + '\n');
}
process.exitCode = 0;
