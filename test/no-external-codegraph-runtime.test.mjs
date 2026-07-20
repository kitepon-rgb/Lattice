import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.join(ROOT, 'test', 'no-external-codegraph-runtime.test.mjs');

async function filesBelow(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(target));
    else if (entry.isFile() && /\.(?:mjs|js)$/u.test(entry.name)) output.push(target);
  }
  return output;
}

test('公開runtimeと正規testはPATH上の外部Codegraphを実行しない', async () => {
  const violations = [];
  const patterns = [
    /(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*['"]codegraph['"]/u,
    /\brun\s*\(\s*['"]codegraph['"]/u,
    /\bnpx\s+@colbymchenry\/codegraph\b/u,
  ];
  for (const root of ['src', 'bin', 'test', 'sensor/dist']) {
    for (const file of await filesBelow(path.join(ROOT, root))) {
      if (file === SELF) continue;
      const source = await readFile(file, 'utf8');
      if (patterns.some((pattern) => pattern.test(source))) {
        violations.push(path.relative(ROOT, file));
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('同梱sensorはprivateなLattice所有packageでpublic codegraph binを持たない', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'sensor', 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@quolu/lattice-sensor');
  assert.equal(manifest.private, true);
  assert.equal(Object.hasOwn(manifest, 'bin'), false);
  const rootLock = await readFile(path.join(ROOT, 'package-lock.json'), 'utf8');
  assert.equal(rootLock.includes('@colbymchenry/codegraph'), false);
  const sensorLock = await readFile(path.join(ROOT, 'sensor', 'package-lock.json'), 'utf8');
  assert.equal(sensorLock.includes('@colbymchenry/codegraph'), false);
  await assert.rejects(readdir(path.join(ROOT, 'sensor', 'dist', 'installer')));
  await assert.rejects(readdir(path.join(ROOT, 'sensor', 'dist', 'upgrade')));
  await assert.rejects(readFile(path.join(ROOT, 'sensor', 'dist', 'bin', 'uninstall.js')));
});
