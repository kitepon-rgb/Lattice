import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestArtifact } from '../../src/artifact-contracts.mjs';
import { captureWorktreeDiff } from '../../src/runtime-diff-observer.mjs';
import { buildNextRunEvent } from '../../src/runtime-engine.mjs';
import {
  activateEpochOneStore, recordRuntimeFinding,
} from '../../src/runtime-multi-epoch-store.mjs';
import { selfDigest } from '../../src/runtime-contracts.mjs';
import { invokeSensorCli } from '../../src/sensor-runtime.mjs';
import { todoSelfDigest } from '../../src/todo-contracts.mjs';

// 請求項8を製品の入口から通す。事前宣言されたtreatmentが**無い**競合を、実CLIが実際に
// 変換して解消し、再開できるbaseを返すところまでを、実git repositoryと実sensorで確かめる。
//
// これが通らない間、変換の中身は動くのに実運転からそこへ行く道が無かった。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const RUN_ID = 'seam-resolve-01';

const SOURCE = [
  "const CSS = 'body { color: red; }';",
  '',
  'function renderLeft(value) {',
  '  return `<div>${String(value)}</div>`;',
  '}',
  '',
  'export function renderPage(value) {',
  '  return `<style>${CSS}</style>${renderLeft(value)}`;',
  '}',
  '',
].join('\n');

const PAGE_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { renderPage } from '../src/page.mjs';",
  "test('render', () => { assert.match(renderPage('a'), /<div>a<\\/div>/); });",
  '',
].join('\n');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

function witness() {
  return {
    owns: [{ kind: 'path', target: 'src/page.mjs' }],
    reads: [],
    writes: ['src/page.mjs'],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: [{ query_id: 'q-page-aff', expect: { kind: 'affected', path: 'src/page.mjs' } }],
    },
    affected_tests: ['test/page.test.mjs'],
    unknowns: [],
  };
}

test('事前宣言なしの競合を、実CLIが変換して解消し再開できるbaseを返す', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-seam-resolve-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, 'src/page.mjs'), SOURCE);
  await writeFile(path.join(repoRoot, 'test/page.test.mjs'), PAGE_TEST);
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/\nnode_modules/\n');
  run('git', ['init', '--quiet', '--initial-branch=main'], repoRoot);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], repoRoot);
  run('git', ['config', 'user.name', 'fixture'], repoRoot);
  run('git', ['add', '.'], repoRoot);
  run('git', ['commit', '--quiet', '-m', 'base'], repoRoot);
  const baseSha = run('git', ['rev-parse', 'HEAD'], repoRoot).trim();
  invokeSensorCli(run, ['init', '.'], repoRoot);

  // --- 同じfileを書く2 TODO。plan時点では直列にしかできない。
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: RUN_ID,
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'T1' }, { todo_id: 'T2' }],
    manual_witness: { T1: witness(), T2: witness() },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-page-aff', operation: 'affected', target: 'src/page.mjs' },
      ],
    },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(root, 'run-request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);

  const started = runCli(['run', 'start', '--request', requestPath, '--executor', 'scripted'], repoRoot);
  assert.equal(started.status, 0, started.stderr);
  const runDir = path.join(repoRoot, '.lattice', 'runs', RUN_ID);
  const runRef = `.lattice/runs/${RUN_ID}`;

  // --- managed epochへactivateする（storeの正規経路）。
  const runEvents = JSON.parse(await readFile(path.join(runDir, 'events.json'), 'utf8'));
  const control = {
    schema: 'lattice.runtime_control_event.v1', run_id: RUN_ID, sequence: 0,
    previous_digest: null, kind: 'supervisor_activated', session_nonce_digest: 'c'.repeat(64),
    payload: {}, recorded_at: '2026-07-27T00:00:00.000Z',
  };
  control.event_digest = digestArtifact(control);
  await writeFile(path.join(runDir, 'control-events.json'), `${JSON.stringify([control])}\n`);
  await activateEpochOneStore({
    runDir,
    request: JSON.parse(await readFile(path.join(runDir, 'request.json'), 'utf8')),
    compileArtifact: JSON.parse(await readFile(path.join(runDir, 'plan-compile-result.json'), 'utf8')),
    legacyMeta: JSON.parse(await readFile(path.join(runDir, 'run-meta.json'), 'utf8')),
    activationRunEventDigest: runEvents.at(-1).event_digest,
    activationControlEventDigest: control.event_digest,
  });

  // --- 実行時の観測: T2がT1のscope内であるpathへ書いた。
  const workerRoot = path.join(root, 'worker');
  run('git', ['worktree', 'add', '--detach', '--quiet', workerRoot, baseSha], repoRoot);
  context.after(() => spawnSync('git', ['worktree', 'remove', '--force', workerRoot], { cwd: repoRoot }));
  await writeFile(path.join(workerRoot, 'src/page.mjs'), `${SOURCE}\n// touched by T2\n`);
  const checkpoint = await captureWorktreeDiff({ worktreePath: workerRoot, baseSha });

  let events = [...runEvents];
  events.push(buildNextRunEvent({
    events, runId: RUN_ID, kind: 'checkpoint_observed', planEpoch: 1,
    subject: { kind: 'todo', ref: 'T2' }, payload: structuredClone(checkpoint),
    recordedAt: '2026-07-27T00:00:01.000Z',
  }));
  await writeFile(path.join(runDir, 'events.json'), `${JSON.stringify(events)}\n`);

  const candidate = {
    schema: 'lattice.runtime_finding_candidate.v1',
    proposed_kind: 'observed_write_conflict',
    todo_ids: ['T1', 'T2'],
    path: 'src/page.mjs',
    resource_id: null,
    evidence_digests: [checkpoint.checkpoint_digest],
    candidate_digest: '',
  };
  candidate.candidate_digest = selfDigest(candidate, 'candidate_digest');
  const observer = { schema: 'lattice.runtime_observer_identity.v1', kind: 'supervisor',
    controller_registration_digest: 'd'.repeat(64), executor_handle: null, identity_digest: '' };
  observer.identity_digest = selfDigest(observer, 'identity_digest');
  const findingRecord = await recordRuntimeFinding({
    runDir, candidate, checkpointDigest: checkpoint.checkpoint_digest,
    observedEventDigest: events.at(-1).event_digest, recordedBy: observer,
  });

  // --- 宣言: 係争fileの中で各TODOが触るsymbolと、新しい面の名前だけ。
  const migration = { schema: 'lattice.runtime_task_migration.v1', entries: [], migration_digest: '' };
  migration.migration_digest = selfDigest(migration, 'migration_digest');
  const declaration = {
    schema: 'lattice.runtime_seam_request.v1',
    run_id: RUN_ID,
    finding_digest: findingRecord.finding_digest,
    concern_symbols: { T1: ['renderLeft'], T2: ['CSS'] },
    path_names: {
      T1: 'src/page-left.mjs', T2: 'src/page-style.mjs', shared: 'src/page-shared.mjs',
    },
    task_migration_digest: migration.migration_digest,
    request_digest: '',
  };
  declaration.request_digest = todoSelfDigest(declaration, 'request_digest');
  const declarationPath = path.join(root, 'seam-request.json');
  await writeFile(declarationPath, `${JSON.stringify(declaration)}\n`);

  // --- 製品の入口をそのまま叩く。
  const resolved = runCli(
    ['run', 'seam', 'resolve', '--run', runRef, '--finding', findingRecord.finding_digest,
      '--input', declarationPath],
    repoRoot,
  );
  assert.equal(resolved.status, 0, `${resolved.stdout}\n${resolved.stderr}`);
  const resolution = JSON.parse(resolved.stdout);
  assert.equal(resolution.schema, 'lattice.runtime_seam_resolution.v1');
  assert.equal(resolution.lane, 'seam_transform', JSON.stringify(resolution.reasons));
  assert.deepEqual(resolution.split.predecessor_task_ids, ['T1', 'T2']);
  assert.deepEqual(resolution.split.edge_diff.removed,
    [{ from_todo_id: 'T1', to_todo_id: 'T2', kind: 'conflict' }]);

  // --- 再開: 返ってきたbaseへworktreeを張ると、所有を宣言した新pathが実在する。
  assert.match(resolution.successor_base_sha, /^[0-9a-f]{40}$/u);
  assert.equal(spawnSync('git',
    ['merge-base', '--is-ancestor', baseSha, resolution.successor_base_sha],
    { cwd: repoRoot }).status, 0);
  const resumed = path.join(root, 'resumed');
  run('git', ['worktree', 'add', '--detach', '--quiet', resumed, resolution.successor_base_sha], repoRoot);
  context.after(() => spawnSync('git', ['worktree', 'remove', '--force', resumed], { cwd: repoRoot }));
  for (const owned of ['src/page-left.mjs', 'src/page-style.mjs']) {
    assert.equal(spawnSync('test', ['-f', path.join(resumed, owned)]).status, 0, owned);
  }

  // --- branchは動いていない。着地させるかは呼び出し側が決める。
  assert.equal(run('git', ['rev-parse', 'HEAD'], repoRoot).trim(), baseSha);
  assert.equal(run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).trim(), 'main');
  assert.equal(spawnSync('test', ['-f', path.join(repoRoot, 'src/page-left.mjs')]).status !== 0, true);
});
