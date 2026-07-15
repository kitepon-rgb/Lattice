import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildBootstrapDiagnostics,
  validateBootstrapDiagnostics,
} from '../src/bootstrap.mjs';

const cli = new URL('../bin/lattice.mjs', import.meta.url);

function runCli(...args) {
  return spawnSync(process.execPath, [cli.pathname, ...args], {
    encoding: 'utf8',
  });
}

test('version returns the package version only', () => {
  const result = runCli('--version');

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '0.1.0\n');
  assert.equal(result.stderr, '');
});

test('doctor emits the canonical bootstrap diagnostics JSON', () => {
  const result = runCli('doctor', '--json');

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const diagnostics = JSON.parse(result.stdout);
  assert.deepEqual(diagnostics, buildBootstrapDiagnostics());
  assert.equal(validateBootstrapDiagnostics(diagnostics), true);
});

test('unknown commands fail without stdout output', () => {
  const result = runCli('compile');

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^lattice: unsupported command or arguments: compile\n$/);
});

test('validator rejects missing, unknown, and changed values', () => {
  const diagnostics = buildBootstrapDiagnostics({ nodeVersion: 'v22.13.0' });

  assert.equal(validateBootstrapDiagnostics({ ...diagnostics, extra: true }), false);
  assert.equal(validateBootstrapDiagnostics({ ...diagnostics, status: 'ready' }), false);
  assert.equal(validateBootstrapDiagnostics({
    ...diagnostics,
    references: { contract: 'docs/00_product-contract.md' },
  }), false);
  assert.equal(validateBootstrapDiagnostics({
    ...diagnostics,
    implementation: { ...diagnostics.implementation, transform: true },
  }), false);
  assert.equal(validateBootstrapDiagnostics({
    ...diagnostics,
    runtime: { node_version: 'not-a-node-version' },
  }), false);
});
