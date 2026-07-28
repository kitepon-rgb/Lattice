import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { digestArtifact } from '../../src/artifact-contracts.mjs';
import { selfDigest } from '../../src/runtime-contracts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'bin', 'lattice.mjs');
const CONTROLLER = path.join(ROOT, 'bin', 'lattice-scripted-adapter.mjs');

// 実daemonを起こす面はmacOSでのみ検証している（backlog「管理runtimeのLinux検証」）。
const managedDaemon = {
  skip: process.platform === 'darwin' ? false : 'managed runtime daemon is verified on macOS only',
};

function invoke(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1', LATTICE_DASHBOARD_AUTOSTART: '0' },
  });
  assert.equal(result.error, undefined);
  return result;
}

const cli = (args, cwd) => invoke(process.execPath, [CLI, ...args], cwd);

function ok(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return result;
}

function witness(symbol) {
  const writePath = `src/${symbol}.mjs`;
  return {
    owns: [{ kind: 'symbol', target: symbol }, { kind: 'path', target: writePath }],
    reads: [], writes: [writePath], resources: [], state_effects: [],
    sensor_provenance: { queries: [
      { query_id: `q-${symbol}`, expect: { kind: 'symbol', name: symbol, path: writePath } },
      { query_id: `q-${symbol}-affected`, expect: { kind: 'affected', path: writePath } },
    ] },
    affected_tests: [`test/${symbol}.test.mjs`], unknowns: [],
  };
}

const unitTest = (symbol) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n`
  + `import { ${symbol} } from '../src/${symbol}.mjs';\ntest('${symbol}', () => assert.ok(${symbol}));\n`;

// **予測超過は競合ではない。** 1つの書き込みが2つの観測を生む——T1の領分と重なった事実
// （`observed_write_conflict`）と、T2の予測が狭かった事実（`undeclared_write`）である。
// 前者は処置へ運べるが、後者は1者しか名指していないので運べない。
//
// 運べてしまうと抜け道が無い。処置は2つとも2者を要求する——直列化は`todo_ids.length >= 2`、
// seam変換は2つの面へ切る——ので、legalなrecompileを作れないままrunが止まる。記録は残し、
// 次のcompileで宣言を実態へ合わせるのが正しい応答である。
//
// 区別しているのは書き込みの善し悪しではなく**当事者の数**である。同じ1つの書き込みから
// 出た2つのfindingが、別々に扱われることでそれが見える。
test('同じ書き込みでも、1者しか名指さない観測はfreezeへ運べない', managedDaemon, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-prediction-excess-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'test'), { recursive: true });
  await writeFile(path.join(repoRoot, '.gitignore'), '.lattice/\n');
  for (const symbol of ['alpha', 'beta']) {
    await writeFile(path.join(repoRoot, 'src', `${symbol}.mjs`), `export const ${symbol} = 1;\n`);
    await writeFile(path.join(repoRoot, 'test', `${symbol}.test.mjs`), unitTest(symbol));
  }
  // T2が宣言外の`src/alpha.mjs`——T1の領分——へ書く。この1つの書き込みが2つの観測を生む。
  await writeFile(path.join(repoRoot, 'adapter-config.json'),
    `${JSON.stringify({ mode: 'deterministic', hold_ms: 10_000, extra_writes: ['src/alpha.mjs'] })}\n`);

  const git = (...args) => ok(invoke('git', ['-c', 'user.email=a@example.invalid',
    '-c', 'user.name=a', ...args], repoRoot), `git ${args[0]}`);
  ok(invoke('git', ['init', '--quiet', '--initial-branch=main'], repoRoot), 'git init');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  const baseSha = ok(invoke('git', ['rev-parse', 'HEAD'], repoRoot), 'rev-parse').stdout.trim();
  ok(cli(['sensor', 'init', '.', '--json'], repoRoot), 'sensor init');

  const queries = (symbol) => [
    { id: `q-${symbol}`, operation: 'query', target: symbol },
    { id: `q-${symbol}-affected`, operation: 'affected', target: `src/${symbol}.mjs` },
  ];
  const request = {
    schema: 'lattice.run_request.v1', request_id: 'prediction-excess-live',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: [{ todo_id: 'T1' }, { todo_id: 'T2' }],
    manual_witness: { T1: witness('alpha'), T2: witness('beta') },
    sensor_query_set: { queries: [{ id: 'q-status', operation: 'status' },
      ...queries('alpha'), ...queries('beta')] },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum', request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const requestPath = path.join(temporaryRoot, 'request.json');
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  ok(cli(['plan', 'compile', '--request', requestPath], repoRoot), 'plan compile');
  const runRef = JSON.parse(ok(cli(['run', 'start', '--request', requestPath,
    '--executor', 'scripted'], repoRoot), 'run start').stdout).run_dir;
  await writeFile(path.join(temporaryRoot, 'adapter.json'), `${JSON.stringify({
    schema: 'lattice.runtime_adapter_registration_input.v1',
    adapter_kind: 'scripted', launch_kind: 'host_binary', binary_path: process.execPath,
    argv: [CONTROLLER], config_ref: 'adapter-config.json',
  })}\n`);
  ok(cli(['run', 'adapter', 'register', '--input', path.join(temporaryRoot, 'adapter.json')],
    repoRoot), 'adapter register');
  ok(cli(['run', 'activate', '--run', runRef], repoRoot), 'run activate');

  const runDir = path.join(repoRoot, ...runRef.split('/'));
  const runEvents = JSON.parse(await readFile(path.join(runDir, 'events.json'), 'utf8'));

  // 重なりの方は処置へ運ばれている。装置が書き込みを見逃したのではない。
  const conflict = runEvents.findLast((event) => event.kind === 'conflict_found');
  assert.notEqual(conflict, undefined, runEvents.map((e) => e.kind).join(','));
  assert.equal(conflict.payload.kind, 'observed_write_conflict', JSON.stringify(conflict.payload));
  assert.deepEqual([...conflict.payload.todo_ids].sort(), ['T1', 'T2']);
  assert.notEqual(runEvents.find((event) => event.kind === 'intake_frozen'), undefined);

  const checkpoint = runEvents.findLast((event) => event.kind === 'checkpoint_observed'
    && event.subject?.ref === 'T2');
  assert.notEqual(checkpoint, undefined, runEvents.map((e) => e.kind).join(','));

  // --- 予測超過そのものも観測として記録できる。予測が外れた事実を捨てない。
  const candidate = {
    schema: 'lattice.runtime_finding_candidate.v1',
    proposed_kind: 'undeclared_write',
    todo_ids: ['T2'],
    path: 'src/alpha.mjs',
    resource_id: null,
    evidence_digests: [checkpoint.payload.checkpoint_digest],
    candidate_digest: '',
  };
  candidate.candidate_digest = selfDigest(candidate, 'candidate_digest');
  const candidatePath = path.join(temporaryRoot, 'candidate.json');
  await writeFile(candidatePath, `${JSON.stringify(candidate)}\n`);
  const recorded = ok(cli(['run', 'finding', 'record', '--run', runRef,
    '--checkpoint', checkpoint.payload.checkpoint_digest, '--input', candidatePath],
  repoRoot), 'finding record');
  const findingDigest = JSON.parse(recorded.stdout).finding_digest;
  assert.match(findingDigest, /^[0-9a-f]{64}$/u);
  assert.equal(digestArtifact(JSON.parse(
    await readFile(path.join(runDir, 'findings', `${findingDigest}.json`), 'utf8'),
  )).length, 64, '記録されたfindingを読めない');

  // --- だがfreezeへは運べない。1者しか名指していないものは競合ではない。
  const refused = cli(['run', 'conflict', '--run', runRef, '--finding', findingDigest], repoRoot);
  assert.notEqual(refused.status, 0, `freezeへ運べてしまった: ${refused.stdout}`);
  const error = JSON.parse(refused.stderr);
  assert.equal(error.code, 'FINDING_NOT_A_CONFLICT', refused.stderr);
  // 拒否は理由と次の一手まで届く。「拒否された」だけでは操作するAIが何をすべきか分からない。
  // 構造化detailはmanaged controlの投影で落ちるので、messageが唯一の運搬路である
  //（backlog「managed control拒否のdetailが落ちる」）。
  assert.match(error.message, /予測超過は競合ではない/u, refused.stderr);
  assert.match(error.message, /宣言を観測へ合わせる/u, refused.stderr);

  // --- 拒否は記録を増やさない。予測超過は競合として数えられない。
  const afterEvents = JSON.parse(await readFile(path.join(runDir, 'events.json'), 'utf8'));
  assert.equal(
    afterEvents.filter((event) => event.kind === 'conflict_found').length,
    runEvents.filter((event) => event.kind === 'conflict_found').length,
    '拒否したのにconflictが記録されている',
  );

  ok(cli(['run', 'abandon', '--run', runRef, '--reason', 'acceptance'], repoRoot), 'run abandon');
});
