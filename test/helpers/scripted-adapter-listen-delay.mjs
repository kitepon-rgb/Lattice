// controller起動のbind→listen間preemptを決定論的に再現するwrapper。
// bootstrapを読んだ後、controller socket refへ「fileは在るがlistenerが居ない」盤面を
// 一定時間置いてから、本物のscripted adapter controllerを同一processで起動する。
// Nodeはserver.close()でsocket fileをunlinkしてしまうので、盤面はlisten直後に
// SIGKILLされる子process（unlinkを通らない）で作る。supervisorはfile出現を見て
// 接続しに来るので、この窓の接続はECONNREFUSEDになる。
//
// test runnerはtest/配下の全.mjsをtest fileとして直接実行するため、controllerとしての
// 起動は登録argvの明示flagだけで行う。flagなし（runnerの一括実行）ではno-opで終わる。
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

if (process.argv[2] === '--as-controller') {
  const { runScriptedAdapterController } = await import('../../src/runtime-scripted-adapter-controller.mjs');
  const bootstrap = JSON.parse(readFileSync(3, 'utf8'));
  const ref = bootstrap.controller_socket_ref;
  spawnSync(process.execPath, ['-e', [
    "const net = require('node:net');",
    'const server = net.createServer();',
    `server.listen(${JSON.stringify(ref)}, () => process.kill(process.pid, 'SIGKILL'));`,
  ].join('\n')], { cwd: process.cwd() });
  // supervisorのfile監視(20ms間隔)が確実にこの盤面へ接続する時間
  await new Promise((resolve) => setTimeout(resolve, 200));
  rmSync(ref, { force: true });
  await runScriptedAdapterController({ bootstrap });
}
