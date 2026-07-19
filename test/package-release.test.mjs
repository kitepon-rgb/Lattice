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
