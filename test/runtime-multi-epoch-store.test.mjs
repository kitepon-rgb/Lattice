import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import {
  RuntimeEpochStoreError,
  activateEpochOneStore,
  readCommittedEpochStore,
  stageSuccessorEpoch,
} from '../src/runtime-multi-epoch-store.mjs';
import { invokeSensorCli } from '../src/sensor-runtime.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

function command(commandName, args, cwd) {
  const result = spawnSync(commandName, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${commandName}: ${result.stderr}`);
  return result.stdout;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-multi-epoch-'));
  const repo = path.join(root, 'repo');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, '.gitignore'), '.lattice/runs/\n');
  await writeFile(path.join(repo, 'src', 'alpha.mjs'), 'export const alpha = 1;\n');
  await writeFile(path.join(repo, 'test', 'alpha.test.mjs'), [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { alpha } from '../src/alpha.mjs';",
    "test('alpha', () => assert.equal(alpha, 1));",
    '',
  ].join('\n'));
  command('git', ['init', '--quiet', '--initial-branch=main'], repo);
  command('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'add', '.'], repo);
  command('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test',
    'commit', '--quiet', '-m', 'base'], repo);
  const baseSha = command('git', ['rev-parse', 'HEAD'], repo).trim();
  invokeSensorCli(command, ['init', '.'], repo);
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'multi-epoch-fixture',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 1 },
    todos: [{ todo_id: 'T1' }],
    manual_witness: { T1: {
      owns: [{ kind: 'symbol', target: 'alpha' }, { kind: 'path', target: 'src/alpha.mjs' }],
      reads: [], writes: ['src/alpha.mjs'], resources: [], state_effects: [],
      sensor_provenance: { queries: [
        { query_id: 'q-alpha', expect: { kind: 'symbol', name: 'alpha', path: 'src/alpha.mjs' } },
        { query_id: 'q-affected', expect: { kind: 'affected', path: 'src/alpha.mjs' } },
      ] },
      affected_tests: ['test/alpha.test.mjs'], unknowns: [],
    } },
    sensor_query_set: { queries: [
      { id: 'q-status', operation: 'status' },
      { id: 'q-alpha', operation: 'query', target: 'alpha' },
      { id: 'q-affected', operation: 'affected', target: 'src/alpha.mjs' },
    ] },
    executor_capability: { adapters: ['scripted'] }, claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(root, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  command(process.execPath, [CLI, 'run', 'start', '--request', requestPath,
    '--executor', 'scripted'], repo);
  return { root, repo, runDir: path.join(repo, '.lattice', 'runs', request.request_id) };
}

async function activationEvidence(runDir) {
  const runEvents = JSON.parse(await readFile(path.join(runDir, 'events.json')));
  const control = {
    schema: 'lattice.runtime_control_event.v1', run_id: 'multi-epoch-fixture', sequence: 0,
    previous_digest: null, kind: 'supervisor_activated', session_nonce_digest: 'c'.repeat(64),
    payload: {}, recorded_at: '2026-07-21T00:00:00.000Z',
  };
  control.event_digest = digestArtifact(control);
  await writeFile(path.join(runDir, 'control-events.json'), `${JSON.stringify([control])}\n`);
  return {
    activationRunEventDigest: runEvents.at(-1).event_digest,
    activationControlEventDigest: control.event_digest,
  };
}

test('v1 alias bytesを変えずepoch 1 bundleとpointerを最後にcommitする', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const requestPath = path.join(value.runDir, 'request.json');
  const compilePath = path.join(value.runDir, 'plan-compile-result.json');
  const requestBytes = await readFile(requestPath);
  const compileBytes = await readFile(compilePath);
  const request = JSON.parse(requestBytes);
  const compileArtifact = JSON.parse(compileBytes);
  const legacyMeta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const evidence = await activationEvidence(value.runDir);
  const activated = await activateEpochOneStore({
    runDir: value.runDir, request, compileArtifact, legacyMeta,
    ...evidence,
  });
  assert.equal(activated.bundle.plan_epoch, 1);
  assert.equal(activated.pointer.bundle_digest, activated.bundle.bundle_digest);
  assert.deepEqual(await readFile(requestPath), requestBytes);
  assert.deepEqual(await readFile(compilePath), compileBytes);
  const reopened = await readCommittedEpochStore(value.runDir);
  assert.equal(reopened.pointer.plan_epoch, 1);
  assert.equal(reopened.meta.schema, 'lattice.run_meta.v2');
});

test('同digest activation retryはv2 metaから回復し、directory最大値を採用しない', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const request = JSON.parse(await readFile(path.join(value.runDir, 'request.json')));
  const compileArtifact = JSON.parse(await readFile(path.join(value.runDir, 'plan-compile-result.json')));
  let meta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const evidence = await activationEvidence(value.runDir);
  const options = { runDir: value.runDir, request, compileArtifact, legacyMeta: meta,
    ...evidence };
  const first = await activateEpochOneStore(options);
  meta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const second = await activateEpochOneStore({ ...options, legacyMeta: meta });
  assert.equal(second.pointer.pointer_digest, first.pointer.pointer_digest);
  await mkdir(path.join(value.runDir, 'epochs', '99999999'));
  await writeFile(path.join(value.runDir, 'epochs', '99999999', 'epoch-bundle.json'), '{}\n');
  assert.equal((await readCommittedEpochStore(value.runDir)).pointer.plan_epoch, 1);
});

test('pointerとbundleの不一致はfallbackせずfail closedにする', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const request = JSON.parse(await readFile(path.join(value.runDir, 'request.json')));
  const compileArtifact = JSON.parse(await readFile(path.join(value.runDir, 'plan-compile-result.json')));
  const legacyMeta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const evidence = await activationEvidence(value.runDir);
  await activateEpochOneStore({ runDir: value.runDir, request, compileArtifact, legacyMeta,
    ...evidence });
  const pointerPath = path.join(value.runDir, 'committed-epoch.json');
  const pointer = JSON.parse(await readFile(pointerPath));
  pointer.bundle_digest = 'f'.repeat(64);
  await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
  await assert.rejects(readCommittedEpochStore(value.runDir), (error) => (
    error instanceof RuntimeEpochStoreError && error.code === 'INVALID_RUN_STORE'
  ));
});

test('run_request.v2 verifier未指定のsuccessorはstore無変更で拒否する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const request = JSON.parse(await readFile(path.join(value.runDir, 'request.json')));
  const compileArtifact = JSON.parse(await readFile(path.join(value.runDir, 'plan-compile-result.json')));
  const legacyMeta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const evidence = await activationEvidence(value.runDir);
  const active = await activateEpochOneStore({ runDir: value.runDir, request, compileArtifact, legacyMeta, ...evidence });
  await assert.rejects(stageSuccessorEpoch({
    runDir: value.runDir,
    transactionId: 'successor-2',
    bundle: { ...active.bundle, plan_epoch: 2 },
  }), (error) => error.code === 'UNSUPPORTED_SUCCESSOR_SCHEMA');
  await assert.rejects(readFile(path.join(value.runDir, 'staging', 'successor-2', 'epoch-bundle.json')),
    (error) => error.code === 'ENOENT');
});

test('epoch bundle/meta後pointer前crashはsame activation digestだけroll-forwardする', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const request = JSON.parse(await readFile(path.join(value.runDir, 'request.json')));
  const compileArtifact = JSON.parse(await readFile(path.join(value.runDir, 'plan-compile-result.json')));
  const legacyMeta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const evidence = await activationEvidence(value.runDir);
  const first = await activateEpochOneStore({ runDir: value.runDir, request, compileArtifact, legacyMeta, ...evidence });
  await unlink(path.join(value.runDir, 'committed-epoch.json'));
  const v2Meta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const recovered = await activateEpochOneStore({ runDir: value.runDir, request, compileArtifact,
    legacyMeta: v2Meta, ...evidence });
  assert.equal(recovered.pointer.pointer_digest, first.pointer.pointer_digest);
  assert.equal((await readCommittedEpochStore(value.runDir)).pointer.pointer_digest, first.pointer.pointer_digest);
  await unlink(path.join(value.runDir, 'committed-epoch.json'));
  await assert.rejects(activateEpochOneStore({ runDir: value.runDir, request, compileArtifact,
    legacyMeta: v2Meta, ...evidence, activationControlEventDigest: 'f'.repeat(64) }),
  (error) => error.code === 'INVALID_RUN_STORE');
  await assert.rejects(readFile(path.join(value.runDir, 'committed-epoch.json')),
    (error) => error.code === 'ENOENT');
});
