import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  observeWindowsWorkerProcess,
  parseWindowsCreationDate,
} from '../src/runtime-windows-process.mjs';

test('PowerShell /Date(ms)/ をISOへ戻す', () => {
  assert.equal(parseWindowsCreationDate('/Date(1787183412912)/'), new Date(1787183412912).toISOString());
  assert.throws(() => parseWindowsCreationDate('not-a-date'));
});

test('Windows attach観測は /bin/ps を使わず pid=pgid を返す', async (context) => {
  if (process.platform !== 'win32') {
    context.skip('win32 only');
    return;
  }
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  context.after(() => { try { process.kill(child.pid, 'SIGKILL'); } catch {} });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const observed = await observeWindowsWorkerProcess(child.pid);
  assert.equal(observed.pid, child.pid);
  assert.equal(observed.process_group_id, child.pid);
  assert.match(observed.started_identity, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.ok(observed.argv.includes('node') || observed.argv.includes('setInterval'));
  createHash('sha256').update(observed.argv, 'utf8').digest('hex');
});
