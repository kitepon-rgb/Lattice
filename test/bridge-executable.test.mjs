import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bridgeDevelopmentTreeWarning, stableNodePath,
} from '../src/bridge-executable.mjs';

// symlinkはWindowsでは既定で特権を要る。ここで検証しているのは「版付き実体を
// 指す安定aliasを見つける」規則そのもので、規則はplatform非依存である。
const symlinkable = { skip: process.platform === 'win32' ? 'symlink needs privilege on Windows' : false };

/** homebrew相当の版付き実体＋安定alias。`resolved`は常にrealpath済みで渡す。 */
async function nodeTree(context, { version = '26.7.0' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-executable-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cellar = path.join(root, 'Cellar', 'node', version, 'bin');
  const stable = path.join(root, 'bin');
  await mkdir(cellar, { recursive: true });
  await mkdir(stable, { recursive: true });
  await writeFile(path.join(cellar, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await symlink(path.join(cellar, 'node'), path.join(stable, 'node'));
  return { root, stable, resolved: await realpath(path.join(cellar, 'node')) };
}

test('版付き実体と同一binaryを指す安定aliasがPATH上にあればそれを焼く', symlinkable, async (context) => {
  const tree = await nodeTree(context);
  const baked = await stableNodePath({ resolved: tree.resolved,
    env: { PATH: tree.stable }, platform: 'darwin' });
  assert.equal(baked, path.join(tree.stable, 'node'),
    'brew upgradeで消えるCellar pathではなく、残り続けるalias側を焼かなければならない');
});

test('安定aliasを検証できない環境では解決済みpathのまま黙って別物を焼かない', symlinkable,
  async (context) => {
    const tree = await nodeTree(context);
    const empty = path.join(tree.root, 'empty');
    await mkdir(empty, { recursive: true });
    assert.equal(await stableNodePath({ resolved: tree.resolved, env: { PATH: empty }, platform: 'darwin' }),
      tree.resolved, '候補が無ければfallbackはあくまで実体path');

    // asdf/voltaのshimのように「nodeという名前だが別実体」は一致しない。
    // 検証できないものを焼くくらいなら版付きpathのままの方が正しい。
    const shimDirectory = path.join(tree.root, 'shim');
    await mkdir(shimDirectory, { recursive: true });
    await writeFile(path.join(shimDirectory, 'node'), '#!/bin/sh\nexec real-node "$@"\n', { mode: 0o755 });
    assert.equal(await stableNodePath({ resolved: tree.resolved,
      env: { PATH: shimDirectory }, platform: 'darwin' }), tree.resolved);
  });

test('PATH未設定でも既知の安定ディレクトリを探し、候補が実体自身なら採らない', symlinkable, async (context) => {
  const tree = await nodeTree(context);
  // 実体そのものがPATHに載っているだけでは何も得られない（同じpathを焼くだけ）。
  assert.equal(await stableNodePath({ resolved: tree.resolved,
    env: { PATH: path.dirname(tree.resolved) }, platform: 'darwin' }), tree.resolved);
  // PATHが無い環境でも落ちず、既知ディレクトリだけで判定して実体へ戻る。
  assert.equal(await stableNodePath({ resolved: tree.resolved, env: {}, platform: 'darwin' }),
    tree.resolved);
});

test('win32ではnode.exeを`;`区切りのPathから探し、大文字小文字を同一視する', symlinkable, async (context) => {
  // nvm-windowsは`C:\Program Files\nodejs`のjunctionの先を版ごと差し替えるので、
  // homebrewのCellarと同じ問題が同じ形で起きる。ここで確かめるのは名前と区切りの
  // 分岐であり、junction自体はPOSIX hostでは作れないのでsymlinkで代替している。
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-bridge-executable-win-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const versioned = path.join(root, 'v26.7.0');
  const stable = path.join(root, 'nodejs');
  await mkdir(versioned, { recursive: true });
  await mkdir(stable, { recursive: true });
  await writeFile(path.join(versioned, 'node.exe'), 'binary', { mode: 0o755 });
  await symlink(path.join(versioned, 'node.exe'), path.join(stable, 'node.exe'));
  const resolved = await realpath(path.join(versioned, 'node.exe'));
  assert.equal(await stableNodePath({ resolved, env: { Path: stable }, platform: 'win32' }),
    path.join(stable, 'node.exe'));
  assert.equal(await stableNodePath({ resolved: resolved.toUpperCase(),
    env: { Path: stable }, platform: 'win32' }), path.join(stable, 'node.exe'));
});

test('node_modules配下でない常駐化はdevelopment tree警告になる', () => {
  assert.equal(bridgeDevelopmentTreeWarning(
    '/usr/local/lib/node_modules/@quolu/lattice/bin/lattice-bridge.mjs'), null);
  assert.equal(bridgeDevelopmentTreeWarning(
    'C:\\Users\\kite\\AppData\\Roaming\\npm\\node_modules\\@quolu\\lattice\\bin\\lattice-bridge.mjs'), null);
  const warning = bridgeDevelopmentTreeWarning('/Users/kite/Developer/Lattice/bin/lattice-bridge.mjs');
  assert.equal(warning.code, 'BRIDGE_PERSISTED_FROM_DEVELOPMENT_TREE');
  assert.match(warning.message, /development tree/u);
});
