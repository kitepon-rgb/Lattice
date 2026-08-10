import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTodoStoreCache } from '../src/todo-store-cache.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-store-cache-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.lattice', 'todo'), { recursive: true });
  return root;
}

async function writeManifest(root, body, { mtime } = {}) {
  const ref = path.join(root, '.lattice', 'todo', 'manifest.json');
  await writeFile(ref, body);
  if (mtime !== undefined) await utimes(ref, mtime, mtime);
}

function countingReader(store) {
  let calls = 0;
  return { calls: () => calls, readStable: async () => { calls += 1; return store; } };
}

test('manifestが変わらなければreadStableを呼ばずcacheを返す', async (context) => {
  const root = await fixture(context);
  await writeManifest(root, '{"a":1}');
  const counter = countingReader({ marker: 'store-1' });
  const cache = createTodoStoreCache({ readStable: counter.readStable });
  const first = await cache.read(root);
  const second = await cache.read(root);
  assert.equal(first.marker, 'store-1');
  assert.equal(second, first);
  assert.equal(counter.calls(), 1);
});

test('manifestのbyteが変われば、stat(mtime/size)が同じでもcacheを無効化する', async (context) => {
  const root = await fixture(context);
  const sameMtime = new Date('2026-08-10T00:00:00.000Z');
  // 旧実装はdev/ino/size/mtimeMs/ctimeMsのstat fingerprintでcache鍵を作っていた。
  // 同じmtimeかつ同じbyte長の異なる内容は、その旧実装ではcache hitと誤判定される
  // ——これがroom 2488の「gantt serve固着」の原因候補だった。ここでは同じ長さ・
  // 同じmtimeの異なるbyte列を用意し、content digest方式が正しく別物と見分けることを固定する。
  await writeManifest(root, '{"digest":"aaaa"}', { mtime: sameMtime });
  const first = { marker: 'store-old' };
  const second = { marker: 'store-new' };
  let call = 0;
  const cache = createTodoStoreCache({
    readStable: async () => { call += 1; return call === 1 ? first : second; },
  });
  const firstRead = await cache.read(root);
  assert.equal(firstRead.marker, 'store-old');

  await writeManifest(root, '{"digest":"bbbb"}', { mtime: sameMtime });
  const secondRead = await cache.read(root);
  assert.equal(secondRead.marker, 'store-new', '同じstatでも内容が変わればcacheを再取得しなければならない');
  assert.equal(call, 2);
});

test('readStableが失敗した読み取りはcacheへ書き込まれず、次回も再取得する', async (context) => {
  const root = await fixture(context);
  await writeManifest(root, '{"a":1}');
  let call = 0;
  const cache = createTodoStoreCache({
    readStable: async () => {
      call += 1;
      if (call === 1) throw new Error('store broken');
      return { marker: 'store-recovered' };
    },
  });
  await assert.rejects(cache.read(root), /store broken/u);
  const recovered = await cache.read(root);
  assert.equal(recovered.marker, 'store-recovered');
  assert.equal(call, 2, '失敗した1回目はcacheへ書かれず、2回目もreadStableが呼ばれる');
});

test('異なるrepoRootは別々にcacheされる', async (context) => {
  const rootA = await fixture(context);
  const rootB = await fixture(context);
  await writeManifest(rootA, '{"a":1}');
  await writeManifest(rootB, '{"a":1}');
  let call = 0;
  const cache = createTodoStoreCache({
    readStable: async ({ repoRoot }) => { call += 1; return { marker: repoRoot }; },
  });
  const a = await cache.read(rootA);
  const b = await cache.read(rootB);
  assert.equal(a.marker, rootA);
  assert.equal(b.marker, rootB);
  assert.equal(call, 2);
});
