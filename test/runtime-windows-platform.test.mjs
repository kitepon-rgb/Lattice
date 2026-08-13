import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { observeManagedProcessStartIdentity } from '../src/runtime-managed-supervisor.mjs';

const ENTRY = fileURLToPath(new URL('../bin/lattice.mjs', import.meta.url));

test('Windows nativeはprocess start identityを安定して観測する',
  { skip: process.platform !== 'win32' }, async () => {
    const first = await observeManagedProcessStartIdentity(process.pid);
    const second = await observeManagedProcessStartIdentity(process.pid);
    assert.equal(first.platform, 'win32');
    assert.match(first.started_identity, /^\d+$/u);
    assert.equal(second.identity_digest, first.identity_digest);
  });

test('Windows nativeはmanaged runtimeをtypedに拒否しWSL2を案内する',
  { skip: process.platform !== 'win32' }, () => {
    const result = spawnSync(process.execPath, [ENTRY, 'run', 'list', '--json'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), {
      schema: 'lattice.cli_error.v2',
      code: 'PLATFORM_UNSUPPORTED',
      message: 'Lattice managed runtime v1 is POSIX-only; use WSL2 on Windows',
    });
  });
