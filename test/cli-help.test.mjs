import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
  assert.equal(result.error, undefined);
  return result;
}

test('root helpは標準入口とnamespaceをstdoutへ表示する', () => {
  for (const args of [['--help'], ['-h'], ['help']]) {
    const result = runCli(args);
    assert.equal(result.status, 0, args.join(' '));
    assert.equal(result.stderr, '', args.join(' '));
    assert.match(result.stdout, /^Usage: lattice <command> \[options\]\n/u);
    assert.match(result.stdout, /todo <command>/u);
    assert.match(result.stdout, /--version/u);
  }
});

test('公開namespace helpは正規構文をstore非依存で表示する', () => {
  const expected = new Map([
    ['plan', /create --input <file>/u],
    ['run', /start --request <request\.json> --executor <adapter>/u],
    ['event', /event verify/u],
    ['todo', /--parallel-frontier/u],
    ['sensor', /sensor <init\|sync>/u],
    ['factory-diagnostics', /factory-diagnostics --json/u],
    ['runtime-errors', /snapshot \[--after-cursor <n>\]/u],
  ]);
  for (const [namespace, pattern] of expected) {
    for (const args of [[namespace, '--help'], [namespace, '-h'], ['help', namespace]]) {
      const result = runCli(args);
      assert.equal(result.status, 0, args.join(' '));
      assert.equal(result.stderr, '', args.join(' '));
      assert.match(result.stdout, pattern, args.join(' '));
    }
  }
});

test('未知namespace helpは従来どおりusage違反として拒否する', () => {
  const result = runCli(['help', 'unknown']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'lattice: unsupported command or arguments: help unknown\n');
});
