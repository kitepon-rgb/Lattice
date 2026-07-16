import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import packageJson from '../package.json' with { type: 'json' };
import { validateBootstrapDiagnostics } from '../src/bootstrap.mjs';

// RC3-B characterizationをRC3-DでADR 0044 Decision 8のexit契約へ意図的に更新した:
// `--version`と`doctor --json`の2挙動は不変のまま、それ以外の拒否は
// usage違反としてexit 2（stdout汚染なし・stderr 1行diagnostic）になる。
// `plan compile`／`plan verify`のexact引数付き実挙動はtest/integration/
// rc3-plan-cli.integration.mjsが検証する。引数を欠く形・未実装surfaceは
// 引き続きfail closedで拒否される。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

const REJECTED_SURFACE = Object.freeze([
  ['plan', 'compile'],
  ['plan', 'verify'],
  ['plan', 'compile', '--request'],
  ['plan', 'verify', '--request', 'req.json'],
  ['plan', 'compile', '--request', 'req.json', 'extra'],
  ['run', 'start'],
  ['run', 'observe'],
  ['run', 'status'],
  ['event', 'verify'],
]);

const MALFORMED_INPUTS = Object.freeze([
  [],
  ['frobnicate'],
  ['--version', 'extra'],
  ['doctor'],
  ['doctor', '--json', 'extra'],
  ['--json', 'doctor'],
]);

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.error, undefined);
  return result;
}

function assertRejected(args) {
  const result = runCli(args);
  const received = args.length === 0 ? '(none)' : args.join(' ');
  assert.equal(result.status, 2, received);
  assert.equal(result.stdout, '', received);
  assert.equal(result.stderr, `lattice: unsupported command or arguments: ${received}\n`);
}

test('--versionはpackage versionだけをstdoutへ返しexit 0で終わる', () => {
  const result = runCli(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, '');
});

test('doctor --jsonはbootstrap diagnosticsの1行JSONだけをstdoutへ返す', () => {
  const result = runCli(['doctor', '--json']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.endsWith('\n'));

  const diagnostics = JSON.parse(result.stdout);
  assert.equal(validateBootstrapDiagnostics(diagnostics), true);
  assert.equal(diagnostics.schema, 'lattice.bootstrap_diagnostics.v1');
  assert.equal(diagnostics.status, 'bootstrap_ready');
  assert.deepEqual(diagnostics.implementation, {
    boundary_compile: false,
    recompile: false,
    transform: false,
  });
});

test('引数を欠くplan surfaceと未実装surfaceはusage違反exit 2で拒否される', () => {
  for (const args of REJECTED_SURFACE) {
    assertRejected(args);
  }
});

test('引数なし・未知command・過剰引数・引数順不正はusage違反exit 2で拒否される', () => {
  for (const args of MALFORMED_INPUTS) {
    assertRejected(args);
  }
});
