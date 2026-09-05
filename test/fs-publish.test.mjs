import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renamePublishedFile } from '../src/fs-publish.mjs';

test('Windowsの一時的なEPERMだけを同じrenameで待ち、恒久拒否は元のエラーで返す', async () => {
  const denied = Object.assign(new Error('拒否'), { code: 'EPERM' });
  let calls = 0;
  await renamePublishedFile('from', 'to', { platform: 'win32', wait: async () => {},
    renameFile: async () => { if (++calls === 1) throw denied; } });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(renamePublishedFile('from', 'to', { platform: 'win32', attempts: 2,
    wait: async () => {}, renameFile: async () => { calls++; throw denied; } }),
  (error) => error === denied);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(renamePublishedFile('from', 'to', { platform: 'linux',
    renameFile: async () => { calls++; throw denied; } }), (error) => error === denied);
  assert.equal(calls, 1);
});

test('実ファイルを並行読取中でも途中のbytesを公開せず差し替えを完了する', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lattice-publish-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'target'); const staged = path.join(root, 'staged');
  await writeFile(target, 'old');
  for (let index = 0; index < 50; index++) {
    await writeFile(staged, 'new');
    const reading = readFile(target, 'utf8');
    await renamePublishedFile(staged, target);
    assert.ok(['old', 'new'].includes(await reading));
    assert.equal(await readFile(target, 'utf8'), 'new');
  }
});
