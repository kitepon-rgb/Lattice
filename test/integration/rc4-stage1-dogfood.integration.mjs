import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  closeStage1Run,
  dispatchStage1NextWave,
  initStage1Run,
  observeStage1Checkpoint,
  publishStage1Artifact,
  recordProviderObservation,
  terminalStage1Receipt,
  verifyStage1ArtifactOnDisk,
} from '../../src/rc4-stage1-dogfood.mjs';
import { digestArtifact } from '../../src/artifact-contracts.mjs';
import { selfDigest } from '../../src/runtime-contracts.mjs';
import { projectRuntimeState } from '../../src/runtime-projection.mjs';

// RC4 Stage 1 integration（plan `docs/plan_lattice_rc4_dotagents_dogfood.md`
// 「Stage 1」節、契約はADR 0046）。
//
// 実agentを使わず、scripted executor（worktreeへ決め打ちdiffを書くだけの関数）で
// driver機構を閉ループで実証する: tmp配下のミニfixture repo（dotagents disposable
// cloneの代替）へ、write intersectionを持つ2 TODOのrun requestを与え、
// dispatch → observe → receipt → close → artifact発行 → on-disk再検証まで
// 1本で通す。conflict pairの自然serializationだけで閉じ、known conflict注入
// （rogue write）は行わない。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

import { invokeSensorCli } from '../../src/sensor-runtime.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

// owns/writesの構造的裏付けには`query`操作（symbol解決）を使う。`affected`操作は
// 依存test 0件のfileに対してsensor自身が`empty`を返し（AGENTS.md「fuzzy解決・
// 空結果はunknownへ」規律の帰結）、covering queryとしてはBOUNDARY_UNKNOWNになる
// ため使えない（実測確認済み・rc3のENTRY等は依存testを持つ実fileだったため
// 顕在化していなかった差分）。
function witness({ target }) {
  return {
    owns: [{ kind: 'path', target }],
    reads: [],
    writes: [target],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: `q-path-${target}`, expect: { kind: 'path', path: target } }],
    },
    affected_tests: [],
    unknowns: [],
  };
}

let temporaryRoot;
let cloneRoot;
let baseSha;
let stateDir;
let requestPath;
let artifactRoot;

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc4s1-'));
  cloneRoot = path.join(temporaryRoot, 'clone');
  await mkdir(path.join(cloneRoot, 'src'), { recursive: true });
  await writeFile(path.join(cloneRoot, 'src', 'a.mjs'), 'export const a = 1;\n');
  await writeFile(path.join(cloneRoot, 'shared.mjs'), 'export const shared = 0;\n');
  await writeFile(path.join(cloneRoot, 'notes.md'), '# notes\n');
  run('git', ['init', '--quiet', '--initial-branch=main'], cloneRoot);
  run('git', ['-c', 'user.email=rc4s1@example.invalid', '-c', 'user.name=rc4s1', 'add', '.'], cloneRoot);
  run('git', ['-c', 'user.email=rc4s1@example.invalid', '-c', 'user.name=rc4s1', 'commit', '--quiet', '-m', 'base'], cloneRoot);
  baseSha = run('git', ['rev-parse', 'HEAD'], cloneRoot).trim();
  invokeSensorCli(run, ['init', '.'], cloneRoot);

  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'rc4s1-req-01',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'T1' }, { todo_id: 'T2' }],
    manual_witness: {
      T1: witness({ target: 'shared.mjs' }),
      T2: witness({ target: 'shared.mjs' }),
    },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-path-shared.mjs', operation: 'query', target: 'shared.mjs' },
      ],
    },
    executor_capability: { adapters: ['actual-agent'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');

  requestPath = path.join(temporaryRoot, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request, null, 1)}\n`);

  stateDir = path.join(temporaryRoot, 'state');
  artifactRoot = path.join(temporaryRoot, 'artifact', 'v3');
});

test.after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('RC4 Stage 1 dogfood driverはconflict pairの自然serializationを閉ループで完遂しartifact v3を発行する', async () => {
  const initResult = await initStage1Run({ latticeRoot: REPO_ROOT, cloneRoot, requestPath, stateDir });
  // T1・T2はshared.mjsを共にowns/writesするため、同一frontier waveでは1件しか
  // dispatchされない（conflictの自然serialization。rogue write注入は行わない）。
  assert.deepEqual(initResult.dispatched, ['T1']);
  assert.equal(initResult.worktrees.T1.packet.isolation_contract.isolated_home, true);
  assert.deepEqual(
    initResult.worktrees.T1.packet.isolation_contract.forbidden_commands,
    ['install.sh', 'spotter install', 'apply-codex-config', 'claude mcp add', 'codex mcp add'],
  );

  // scripted executor: T1のworktreeへ決め打ちdiffを書くだけ。
  await writeFile(path.join(initResult.worktrees.T1.path, 'shared.mjs'), 'export const shared = 1;\n');
  await recordProviderObservation({
    stateDir,
    observation: { todo_id: 'T1', executor_handle: initResult.worktrees.T1.handle, state: 'terminal_reported', duration_ms: 42 },
  });

  const observedT1 = await observeStage1Checkpoint({ stateDir, todoId: 'T1' });
  assert.deepEqual(observedT1.findings, [], 'scope内writeなのでfindingは無いはず');

  const terminalT1 = await terminalStage1Receipt({ stateDir, todoId: 'T1', planKey: 'plan' });
  assert.equal(terminalT1.decisions[0].decision, 'accepted');

  // T1受理によりconflictが解消し、T2が同一epoch内で次waveへdispatchされる。
  const nextWave = await dispatchStage1NextWave({ stateDir });
  assert.deepEqual(nextWave.dispatched, ['T2']);
  assert.equal(nextWave.worktrees.T2.packet.isolation_contract.no_git_mutations, true);

  await writeFile(path.join(nextWave.worktrees.T2.path, 'shared.mjs'), 'export const shared = 2;\n');
  await recordProviderObservation({
    stateDir,
    observation: { todo_id: 'T2', executor_handle: nextWave.worktrees.T2.handle, state: 'terminal_reported', duration_ms: 37 },
  });

  const observedT2 = await observeStage1Checkpoint({ stateDir, todoId: 'T2' });
  assert.deepEqual(observedT2.findings, []);

  const terminalT2 = await terminalStage1Receipt({ stateDir, todoId: 'T2', planKey: 'plan' });
  assert.equal(terminalT2.decisions[0].decision, 'accepted');

  const closed = await closeStage1Run({ stateDir });
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.residual, []);

  const { manifest } = await publishStage1Artifact({ stateDir, artifactRoot });
  assert.equal(manifest.schema, 'lattice.rc4.stage1_dogfood_manifest.v1');

  const verification = await verifyStage1ArtifactOnDisk({ artifactRoot });
  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
  assert.ok(verification.checks.some((check) => check.id === 'isolation_contract_complete' && check.passed));
  assert.ok(verification.checks.some((check) => check.id === 'patches_bound_to_accepted_receipts' && check.passed));

  // Stage 2着地素材: 受理receiptごとにpatch本文が保存され、pathがreceiptとbindされている。
  const patches = JSON.parse(await readFile(path.join(artifactRoot, 'patches.json'), 'utf8'));
  for (const receiptId of ['T1-a1-r1', 'T2-a1-r1']) {
    assert.equal(patches[receiptId].todo_id, receiptId.slice(0, 2));
    assert.deepEqual(patches[receiptId].paths, ['shared.mjs']);
    assert.match(patches[receiptId].patch, /shared = [12]/);
  }

  const events = JSON.parse(await readFile(path.join(artifactRoot, 'events.json'), 'utf8'));
  const state = projectRuntimeState({ events });
  assert.deepEqual(state.accepted.sort(), ['T1', 'T2']);
  assert.equal(state.closed, true);

  // 二重発行禁止（no-overwrite）。
  await assert.rejects(publishStage1Artifact({ stateDir, artifactRoot }));
});

test('patch bind強化（ADR 0051 Decision 4）: checkpoint改竄・本文改竄・digest欠落はfail closedする', async () => {
  const patchesPath = path.join(artifactRoot, 'patches.json');
  const manifestPath = path.join(artifactRoot, 'dogfood-manifest.json');
  const originalPatches = await readFile(patchesPath, 'utf8');
  const originalManifest = await readFile(manifestPath, 'utf8');

  // manifest digestを整合させて書き換える＝digest検査を通過させ、bind検査そのものを直撃する。
  const tamperWith = async (mutate) => {
    const patches = JSON.parse(originalPatches);
    mutate(patches);
    const manifest = JSON.parse(originalManifest);
    manifest.document_digests['patches.json'] = digestArtifact(patches);
    await writeFile(patchesPath, `${JSON.stringify(patches, null, 1)}\n`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
    const verification = await verifyStage1ArtifactOnDisk({ artifactRoot });
    const bind = verification.checks.find((check) => check.id === 'patches_bound_to_accepted_receipts');
    assert.equal(bind.passed, false);
    assert.equal(verification.valid, false);
    await writeFile(patchesPath, originalPatches);
    await writeFile(manifestPath, originalManifest);
  };

  await tamperWith((patches) => { patches['T1-a1-r1'].checkpoint_digest = 'f'.repeat(64); });
  await tamperWith((patches) => { patches['T1-a1-r1'].patch = patches['T1-a1-r1'].patch.replace('shared = 1', 'shared = 9'); });
  await tamperWith((patches) => { delete patches['T1-a1-r1'].patch_sha256; });

  // 復元後はgreenへ戻る（tamper検査自体が壊していないことの確認）。
  const restored = await verifyStage1ArtifactOnDisk({ artifactRoot });
  assert.equal(restored.valid, true, JSON.stringify(restored.failed_conditions));
});
