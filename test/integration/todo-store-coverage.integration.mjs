import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// ADR 0053 Decision 3: TODO storeはtrackedだがCodegraph coverageから除外し、
// generated projectionはgitignoredかつcoverageから除外する。両rootにはindex対象の
// .mjs probeを置き、拡張子の非対応へ依存せずcoverage分離を検証する。
const REPO_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const STORE_PROBE_PATH = '.lattice/todo/it-store-probe.mjs';
const GENERATED_PROBE_PATH = '.lattice/generated/it-generated-probe.mjs';
const CONTROL_PROBE_PATH = 'test/fixtures/todo-store-coverage-control.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

function status(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  }).status;
}

async function writeProbe(repoRoot, relativePath, contents) {
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

test('TODO storeとgenerated projectionをCodegraph coverageから分離する', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-todo-store-coverage-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = path.join(temporaryRoot, 'repo');
  run('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, repoRoot], REPO_ROOT);

  // commit済みHEADでなく、現在のworking treeのcoverage設定を検証対象にする。
  await copyFile(path.join(REPO_ROOT, '.gitignore'), path.join(repoRoot, '.gitignore'));
  await copyFile(path.join(REPO_ROOT, 'codegraph.json'), path.join(repoRoot, 'codegraph.json'));
  await writeProbe(repoRoot, STORE_PROBE_PATH, [
    'export function todoStoreProbe() {',
    "  return 'tracked-but-excluded';",
    '}',
    '',
  ].join('\n'));
  await writeProbe(repoRoot, GENERATED_PROBE_PATH, [
    'export function todoGeneratedProbe() {',
    "  return 'ignored-and-excluded';",
    '}',
    '',
  ].join('\n'));
  await writeProbe(repoRoot, CONTROL_PROBE_PATH, [
    'export function todoStoreCoverageControlProbe() {',
    "  return 'indexed';",
    '}',
    '',
  ].join('\n'));

  assert.equal(status('git', ['check-ignore', '--no-index', '-q', STORE_PROBE_PATH], repoRoot), 1);
  assert.equal(status('git', ['check-ignore', '--no-index', '-q', GENERATED_PROBE_PATH], repoRoot), 0);

  // generated probeはignoreされたまま残し、tracked storeとcontrolだけをindex対象にする。
  run('git', ['add', STORE_PROBE_PATH, CONTROL_PROBE_PATH], repoRoot);
  run('git', [
    '-c', 'user.name=lattice-todo-store-coverage',
    '-c', 'user.email=lattice-todo-store-coverage@invalid',
    'commit', '--quiet', '-m', 'TODO store coverage probes',
  ], repoRoot);

  const configuration = JSON.parse(await readFile(
    path.join(repoRoot, 'codegraph.json'),
    'utf8',
  ));
  assert.equal(configuration.exclude.includes('.lattice/todo/'), true);
  assert.equal(configuration.exclude.includes('.lattice/generated/'), true);

  run('codegraph', ['init', '.'], repoRoot);
  const files = JSON.parse(run('codegraph', ['files', '--path', '.', '--json'], repoRoot));
  const indexedPaths = files.map(({ path: relativePath }) => relativePath);
  assert.deepEqual(indexedPaths.filter((relativePath) => relativePath.startsWith('.lattice/todo/')), []);
  assert.deepEqual(indexedPaths.filter((relativePath) => relativePath.startsWith('.lattice/generated/')), []);
  assert.equal(indexedPaths.includes(CONTROL_PROBE_PATH), true);
});
