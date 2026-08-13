import assert from 'node:assert/strict';
import nodeTest from 'node:test';

const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { pidsOwningSocketPath, socketPathsOwnedByPid } from '../src/runtime-socket-owner.mjs';

// 管理runtimeは「そのPIDが本当にそのcontrol socketを持っているか」を確かめてから接続する。
// 実装が`/usr/sbin/lsof`をhard-codeしていたため、Linuxでは管理runtimeが丸ごと動かなかった。
// ここはその移植を、実socketを立てて両方向から確かめる。

async function listeningSocket(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-sockowner-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const socketPath = path.join(root, 'control.sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return socketPath;
}

test('自prosessが開いているsocketを、そのPIDの所有として観測できる', async (context) => {
  const socketPath = await listeningSocket(context);
  const owned = await socketPathsOwnedByPid(process.pid);
  assert.equal(owned.includes(socketPath), true,
    `観測できたsocket: ${JSON.stringify(owned.slice(0, 10))}`);
});

test('socket pathから所有PIDを引ける', async (context) => {
  const socketPath = await listeningSocket(context);
  const pids = await pidsOwningSocketPath(socketPath);
  assert.equal(pids.includes(process.pid), true, `観測できたPID: ${JSON.stringify(pids)}`);
});

test('誰も開いていないpathは、観測失敗ではなく所有者なしを返す', async (context) => {
  // lsofは該当なしでexit 1を返す。ここを観測失敗へ丸めると、誰も掴んでいないstale socketの
  // 後片付けが止まる。「分からない」と「居ない」を区別する。
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-sockowner-none-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await pidsOwningSocketPath(path.join(root, 'absent.sock')), []);
});

test('存在しないPIDの観測は所有ゼロとして閉じる', async () => {
  // 実在しないPIDでthrowすると、呼び出し側が「観測できない」と「持っていない」を混ぜる。
  const owned = await socketPathsOwnedByPid(2 ** 22).catch(() => []);
  assert.deepEqual(owned, []);
});
