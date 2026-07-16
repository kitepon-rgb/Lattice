import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import packageJson from '../package.json' with { type: 'json' };
import { validateBootstrapDiagnostics } from '../src/bootstrap.mjs';

// RC3-B characterization（ADR 0044 Decision 8の前提となる現挙動の固定）:
// 現CLIは`--version`と`doctor --json`のexact引数だけを受理し、それ以外は
// stdoutを汚さずstderrの1行diagnosticとexit 1でfail closedに拒否する。
// RC3のCLI surface実装（RC3-D以降）は、この2挙動を変更せずに加算しなければならない。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

const PLANNED_RC3_SURFACE = Object.freeze([
  ['plan', 'compile'],
  ['plan', 'verify'],
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
  assert.equal(result.status, 1, received);
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

test('RC3予定のCLI surfaceは未実装としてfail closedで拒否される', () => {
  for (const args of PLANNED_RC3_SURFACE) {
    assertRejected(args);
  }
});

test('引数なし・未知command・過剰引数・引数順不正はfail closedで拒否される', () => {
  for (const args of MALFORMED_INPUTS) {
    assertRejected(args);
  }
});
