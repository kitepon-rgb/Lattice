import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { buildExecutorPackets } from '../src/runtime-engine.mjs';
import {
  RuntimeEpochStoreError,
  activateEpochOneStore,
  commitStagedSuccessorEpoch,
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

function successorBundle(active) {
  const migration = { schema: 'lattice.runtime_task_migration.v1', entries: [{
    predecessor_task_id: 'T1', disposition: 'stay', successor_task_ids: ['T1'],
    reason: 'intentional serial', evidence_digests: ['1'.repeat(64)],
  }], migration_digest: '' };
  migration.migration_digest = selfDigest(migration, 'migration_digest');
  const request = { ...active.bundle.request, schema: 'lattice.run_request.v2',
    predecessor_request_digest: active.bundle.request.request_digest,
    task_migration_digest: migration.migration_digest, request_digest: '' };
  request.request_digest = selfDigest(request, 'request_digest');
  const plan = { ...active.bundle.plan, plan_ref: 'plan-multi-epoch-fixture-e2', plan_epoch: 2,
    request_digest: request.request_digest, predecessor_refs: [active.bundle.plan.plan_ref],
    plan_digest: '' };
  plan.plan_digest = selfDigest(plan, 'plan_digest');
  const bundle = { schema: 'lattice.runtime_epoch_bundle.v1', run_id: active.bundle.run_id,
    plan_epoch: 2, request, plan, manifests: active.bundle.manifests,
    executor_packets: buildExecutorPackets({ plan, manifests: active.bundle.manifests }),
    rebind_packets: {}, plan_diff: {}, task_migration: migration,
    treatment: { schema: 'test.intentional_serial.v1' }, phase_revision_digest: null,
    phase_revision_commit_receipt: null, predecessor_bundle_digest: active.bundle.bundle_digest,
    bundle_digest: '' };
  bundle.bundle_digest = selfDigest(bundle, 'bundle_digest');
  return bundle;
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

test('successor directory rename後pointer前crashはsame transactionだけroll-forwardする', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const request = JSON.parse(await readFile(path.join(value.runDir, 'request.json')));
  const compileArtifact = JSON.parse(await readFile(path.join(value.runDir, 'plan-compile-result.json')));
  const legacyMeta = JSON.parse(await readFile(path.join(value.runDir, 'run-meta.json')));
  const evidence = await activationEvidence(value.runDir);
  const active = await activateEpochOneStore({ runDir: value.runDir, request, compileArtifact,
    legacyMeta, ...evidence });
  const bundle = successorBundle(active);
  await stageSuccessorEpoch({ runDir: value.runDir, transactionId: 'successor-2', bundle,
    validateSuccessor: () => true });
  await rename(path.join(value.runDir, 'staging', 'successor-2'),
    path.join(value.runDir, 'epochs', '00000002'));
  const committed = await commitStagedSuccessorEpoch({ runDir: value.runDir,
    transactionId: 'successor-2', ...evidence });
  assert.equal(committed.pointer.plan_epoch, 2);
  const retried = await commitStagedSuccessorEpoch({ runDir: value.runDir,
    transactionId: 'successor-2', ...evidence });
  assert.equal(retried.pointer.pointer_digest, committed.pointer.pointer_digest);
});

// 活性化はpointer→metaの順で書く。逆順だとmeta v2だけが見える窓ができ、並行する
// readerがINVALID_RUN_STORE（committed epoch pointerを読めない）で落ちる
// （2026-08-22 CI負荷下で実被弾: run observeのpolling中に落ちた）。この順での
// 途中crash盤面（pointerあり・metaはv1のまま）はlegacyへfallbackし、再活性化で回復する。
test('pointer書込み後meta書込み前のcrash盤面はlegacy fallbackし再活性化で回復する', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const request = JSON.parse(await readFile(path.join(value.runDir, 'request.json')));
  const compileArtifact = JSON.parse(await readFile(path.join(value.runDir, 'plan-compile-result.json')));
  const legacyMetaBytes = await readFile(path.join(value.runDir, 'run-meta.json'));
  const legacyMeta = JSON.parse(legacyMetaBytes);
  const evidence = await activationEvidence(value.runDir);
  const options = { runDir: value.runDir, request, compileArtifact, legacyMeta, ...evidence };
  const first = await activateEpochOneStore(options);
  // pointerだけが耐久化されmetaがv1のままの盤面（新しい書込み順の唯一の途中状態）を作る。
  await writeFile(path.join(value.runDir, 'run-meta.json'), legacyMetaBytes);
  assert.equal(await readCommittedEpochStore(value.runDir), null,
    'meta v1のままならmulti-epochとして読まずlegacyへfallbackする');
  const recovered = await activateEpochOneStore(options);
  assert.equal(recovered.pointer.pointer_digest, first.pointer.pointer_digest);
  assert.equal((await readCommittedEpochStore(value.runDir)).pointer.plan_epoch, 1);
});
