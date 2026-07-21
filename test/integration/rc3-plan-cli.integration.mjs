import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selfDigest } from '../../src/runtime-contracts.mjs';

// RC3-D integration（ADR 0044 Decision 8・10.4）。
// disposable git repo＋実LatticeSensor＋実CLI processで、plan compile／verifyの
// exit契約（0=成功JSON、1=typed error JSON、2=usage）とfail closed経路を検証する。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

import { invokeSensorCli } from '../../src/sensor-runtime.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' } });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
}

const MODULE_A = `export function computeAlpha(value) {
  return value + 1;
}
`;
const MODULE_B = `export function computeBeta(value) {
  return value * 2;
}
`;
const TEST_A = `import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAlpha } from '../src/alpha.mjs';

test('alpha', () => {
  assert.equal(computeAlpha(1), 2);
});
`;
const TEST_B = `import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBeta } from '../src/beta.mjs';

test('beta', () => {
  assert.equal(computeBeta(2), 4);
});
`;

async function scaffoldRepo(root) {
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src', 'alpha.mjs'), MODULE_A);
  await writeFile(path.join(root, 'src', 'beta.mjs'), MODULE_B);
  await writeFile(path.join(root, 'test', 'alpha.test.mjs'), TEST_A);
  await writeFile(path.join(root, 'test', 'beta.test.mjs'), TEST_B);
  run('git', ['init', '--quiet', '--initial-branch=main'], root);
  run('git', ['-c', 'user.email=rc3@example.invalid', '-c', 'user.name=rc3', 'add', '.'], root);
  run('git', [
    '-c', 'user.email=rc3@example.invalid', '-c', 'user.name=rc3',
    'commit', '--quiet', '-m', 'rc3 plan cli fixture',
  ], root);
  invokeSensorCli(run, ['init', '.'], root);
  return run('git', ['rev-parse', 'HEAD'], root).trim();
}

function buildRequest(baseSha) {
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'cli-int-01',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'T1' }, { todo_id: 'T2' }],
    manual_witness: {
      T1: {
        owns: [
          { kind: 'symbol', target: 'computeAlpha' },
          { kind: 'path', target: 'src/alpha.mjs' },
        ],
        reads: [],
        writes: ['src/alpha.mjs'],
        resources: [],
        state_effects: [],
        sensor_provenance: {
          queries: [
            { query_id: 'q-alpha', expect: { kind: 'symbol', name: 'computeAlpha', path: 'src/alpha.mjs' } },
            { query_id: 'q-alpha-aff', expect: { kind: 'affected', path: 'src/alpha.mjs' } },
          ],
        },
        affected_tests: ['test/alpha.test.mjs'],
        unknowns: [],
      },
      T2: {
        owns: [
          { kind: 'symbol', target: 'computeBeta' },
          { kind: 'path', target: 'src/beta.mjs' },
        ],
        reads: [],
        writes: ['src/beta.mjs'],
        resources: [],
        state_effects: [],
        sensor_provenance: {
          queries: [
            { query_id: 'q-beta', expect: { kind: 'symbol', name: 'computeBeta', path: 'src/beta.mjs' } },
            { query_id: 'q-beta-aff', expect: { kind: 'affected', path: 'src/beta.mjs' } },
          ],
        },
        affected_tests: ['test/beta.test.mjs'],
        unknowns: [],
      },
    },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        { id: 'q-alpha', operation: 'query', target: 'computeAlpha' },
        { id: 'q-alpha-aff', operation: 'affected', target: 'src/alpha.mjs' },
        { id: 'q-beta', operation: 'query', target: 'computeBeta' },
        { id: 'q-beta-aff', operation: 'affected', target: 'src/beta.mjs' },
      ],
    },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  return request;
}

let temporaryRoot;
let repoRoot;
let baseSha;
let requestPath;
let planPath;

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3-plan-cli-'));
  repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(repoRoot, { recursive: true });
  baseSha = await scaffoldRepo(repoRoot);
  requestPath = path.join(temporaryRoot, 'run-request.json');
  planPath = path.join(temporaryRoot, 'plan-compile-result.json');
  await writeFile(requestPath, `${JSON.stringify(buildRequest(baseSha))}\n`);
});

test.after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('plan compileはdisposable repoからdispatchable planをexit 0で発行する', async () => {
  const result = runCli(['plan', 'compile', '--request', requestPath], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const artifact = JSON.parse(result.stdout);
  assert.equal(artifact.schema, 'lattice.plan_compile_result.v1');
  assert.equal(artifact.plan.schema, 'lattice.runtime_plan.v1');
  assert.equal(artifact.plan.base_sha, baseSha);
  assert.deepEqual(artifact.plan.conflicts, []);
  assert.equal(artifact.schedule.minimum_feasible_waves, 1);
  assert.match(artifact.result_digest, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(artifact.manifests).length, 2);
  await writeFile(planPath, result.stdout);
});

test('plan verifyは保存artifactをfresh観測から再検証しexit 0で返す', () => {
  const result = runCli(['plan', 'verify', '--request', requestPath, '--plan', planPath], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  const verified = JSON.parse(result.stdout);
  assert.equal(verified.schema, 'lattice.plan_verify_result.v1');
  assert.equal(verified.outcome, 'verified');
  assert.equal(verified.minimum_feasible_waves, 1);
});

test('base sha不一致はSTALE_BASEのtyped errorでexit 1になる', async () => {
  const staleRequest = buildRequest('d'.repeat(40));
  const stalePath = path.join(temporaryRoot, 'stale-request.json');
  await writeFile(stalePath, `${JSON.stringify(staleRequest)}\n`);
  const result = runCli(['plan', 'compile', '--request', stalePath], repoRoot);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.schema, 'lattice.cli_error.v2');
  assert.equal(error.code, 'STALE_BASE');
});

test('witness unknownはBOUNDARY_UNKNOWNのtyped errorでexit 1になり planを発行しない', async () => {
  const request = buildRequest(baseSha);
  request.manual_witness.T1.unknowns = [{ kind: 'semantic_probe', ref: 'shared invariant?' }];
  request.request_digest = selfDigest(request, 'request_digest');
  const unknownPath = path.join(temporaryRoot, 'unknown-request.json');
  await writeFile(unknownPath, `${JSON.stringify(request)}\n`);
  const result = runCli(['plan', 'compile', '--request', unknownPath], repoRoot);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.schema, 'lattice.cli_error.v2');
  assert.equal(error.code, 'BOUNDARY_UNKNOWN');
  // ADR 0052 Decision 1: typed失敗はthrow側のdetail（unknown内訳）をv2 envelopeで運ぶ。
  assert.ok(error.detail !== undefined && typeof error.detail === 'object');
  assert.ok(Array.isArray(error.detail.unknowns) && error.detail.unknowns.length > 0);
  assert.equal(error.detail.unknowns[0].todo_id, 'T1');
});

test('改竄planと別request planはtyped errorでexit 1になる', async () => {
  const tamperedPath = path.join(temporaryRoot, 'tampered-plan.json');
  const artifact = JSON.parse(run('cat', [planPath], temporaryRoot));
  artifact.schedule.minimum_feasible_waves = 2;
  await writeFile(tamperedPath, `${JSON.stringify(artifact)}\n`);
  const result = runCli(['plan', 'verify', '--request', requestPath, '--plan', tamperedPath], repoRoot);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, 'INVALID_PLAN_ARTIFACT');
});

test('result_digest再封印つきのplan本体改竄もtyped rejectされる', async () => {
  const artifactBytes = await import('node:fs/promises').then(({ readFile }) => readFile(planPath, 'utf8'));
  const { selfDigest: rederive } = await import('../../src/runtime-contracts.mjs');
  const { digestArtifact } = await import('../../src/artifact-contracts.mjs');

  // 1) plan bodyを改竄しplan_digestは旧値のまま、result_digestだけ再封印。
  const resealed = JSON.parse(artifactBytes);
  resealed.plan.capacity = { executors: 99 };
  {
    const { result_digest: _dropped, ...body } = resealed;
    resealed.result_digest = digestArtifact(body);
  }
  const resealedPath = path.join(temporaryRoot, 'resealed-plan.json');
  await writeFile(resealedPath, `${JSON.stringify(resealed)}\n`);
  const resealedResult = runCli(['plan', 'verify', '--request', requestPath, '--plan', resealedPath], repoRoot);
  assert.equal(resealedResult.status, 1);
  assert.equal(JSON.parse(resealedResult.stderr).code, 'INVALID_PLAN_ARTIFACT');

  // 2) plan_epoch relabel＋plan_digest再計算＋result_digest再封印でも、
  //    verify側の固定導出との構造一致で落ちる。
  const relabeled = JSON.parse(artifactBytes);
  relabeled.plan.plan_epoch = 2;
  relabeled.plan.plan_digest = rederive(relabeled.plan, 'plan_digest');
  {
    const { result_digest: _dropped, ...body } = relabeled;
    relabeled.result_digest = digestArtifact(body);
  }
  const relabeledPath = path.join(temporaryRoot, 'relabeled-plan.json');
  await writeFile(relabeledPath, `${JSON.stringify(relabeled)}\n`);
  const relabeledResult = runCli(['plan', 'verify', '--request', requestPath, '--plan', relabeledPath], repoRoot);
  assert.equal(relabeledResult.status, 1);
  assert.equal(JSON.parse(relabeledResult.stderr).code, 'PLAN_DIGEST_MISMATCH');
});

test('request digest改竄はINVALID_RUN_REQUESTでexit 1になる', async () => {
  const request = buildRequest(baseSha);
  request.request_digest = 'f'.repeat(64);
  const invalidPath = path.join(temporaryRoot, 'invalid-request.json');
  await writeFile(invalidPath, `${JSON.stringify(request)}\n`);
  const result = runCli(['plan', 'compile', '--request', invalidPath], repoRoot);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, 'INVALID_RUN_REQUEST');
});
