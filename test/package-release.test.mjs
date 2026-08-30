import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('NPM pack前にsensorの公開生成物をsourceから再buildする', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts?.prepack, 'npm --prefix sensor run build');
  assert.ok(packageJson.files?.includes('sensor/dist'));
});

test('scripted adapter controllerをnpm binと配布filesへ含める', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.bin?.['lattice-scripted-adapter'],
    'bin/lattice-scripted-adapter.mjs',
  );
  assert.ok(packageJson.files?.includes('bin/lattice-scripted-adapter.mjs'));
});

test('release versionはpackage、lock、CHANGELOGで同期する', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const changelog = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.['']?.version, packageJson.version);
  assert.match(changelog, new RegExp(`^## ${packageJson.version} —`, 'mu'));
});
