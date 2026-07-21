import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  adjudicatePendingReceipts,
  buildExecutorPackets,
  classifyCheckpointObservation,
  dispatchReadyFrontier,
  initializeRunEvents,
  observeExecutor,
} from '../../src/runtime-engine.mjs';
import { detectCheckpointFindings } from '../../src/runtime-diff-observer.mjs';
import { createWorktreeExecutorAdapter } from '../../src/runtime-worktree-executor.mjs';
import {
  classifyObservedDiff,
  computeReadyFrontier,
  recomputeReceiptDecisions,
} from '../../src/runtime-decision-verifier.mjs';
import { verifyRunEventChain } from '../../src/runtime-event-store.mjs';
import { projectRuntimeState } from '../../src/runtime-projection.mjs';
import { selfDigest } from '../../src/runtime-contracts.mjs';

// RC3-F integration（ADR 0044 Decision 5・9、plan RC3-F）。
// 実disposable repo＋実git worktree＋実diffで、isolated executorのprovision／
// cleanup、checkpoint diffのbounded canonical化、scope violation／late conflictの
// cross-bind検出、receiptのcheckpoint binding裁定を検証する。

const RUN_ID = 'run-rc3f-01';
const AT = '2026-07-17T00:00:00.000Z';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' } });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

let temporaryRoot;
let repoRoot;
let baseSha;

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3f-'));
  repoRoot = path.join(temporaryRoot, 'repo');
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await writeFile(path.join(repoRoot, 'src', 'one.mjs'), 'export const one = 1;\n');
  await writeFile(path.join(repoRoot, 'src', 'two.mjs'), 'export const two = 2;\n');
  run('git', ['init', '--quiet', '--initial-branch=main'], repoRoot);
  run('git', ['-c', 'user.email=rc3f@example.invalid', '-c', 'user.name=rc3f', 'add', '.'], repoRoot);
  run('git', ['-c', 'user.email=rc3f@example.invalid', '-c', 'user.name=rc3f', 'commit', '--quiet', '-m', 'base'], repoRoot);
  baseSha = run('git', ['rev-parse', 'HEAD'], repoRoot).trim();
});

test.after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

function buildFixture({ todos, capacity }) {
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'req-rc3f-01',
    repo: { base_sha: baseSha, root_kind: 'git-worktree' },
    capacity: { executors: capacity },
    todos: todos.map(({ id }) => ({ todo_id: id })),
    manual_witness: Object.fromEntries(todos.map(({ id, writes }) => [id, {
      owns: writes.map((target) => ({ kind: 'path', target })),
      reads: [],
      writes,
      resources: [],
      state_effects: [],
      sensor_provenance: { queries: [] },
      affected_tests: [],
      unknowns: [],
    }])),
    sensor_query_set: { queries: [] },
    executor_capability: { adapters: ['isolated-worktree'] },
    claim_mode: 'exact_minimum',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const manifests = {};
  for (const { id, writes } of todos) {
    const manifest = {
      schema: 'lattice.boundary_manifest.v2',
      todo_id: id,
      owns: writes.map((target) => ({ kind: 'path', target })),
      reads: [],
      writes,
      resources: [],
      state_effects: [],
      unknowns: [],
      affected_tests: [],
      graph_evidence: [],
      witness_provenance: {},
    };
    manifest.manifest_digest = selfDigest(manifest, 'manifest_digest');
    manifests[id] = manifest;
  }
  const plan = {
    schema: 'lattice.runtime_plan.v1',
    plan_ref: 'plan-rc3f-v1',
    plan_epoch: 1,
    request_digest: request.request_digest,
    base_sha: baseSha,
    nodes: todos.map(({ id }) => ({ todo_id: id })),
    precedence: [],
    conflicts: [],
    capacity: { executors: capacity },
    manifest_digests: Object.fromEntries(todos.map(({ id }) => [id, manifests[id].manifest_digest])),
    claim: { mode: 'exact_minimum' },
    predecessor_refs: [],
  };
  plan.plan_digest = selfDigest(plan, 'plan_digest');
  return { request, plan, manifests };
}

test('worktree executorは実diffをcheckpoint化しcleanupまで完遂する', async () => {
  const fixture = buildFixture({
    todos: [{ id: 'W1', writes: ['src/one.mjs'] }],
    capacity: 1,
  });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot,
    work: {
      W1: async ({ worktreePath }) => {
        await writeFile(path.join(worktreePath, 'src', 'one.mjs'), 'export const one = 100;\n');
      },
    },
  });
  const { request, plan, manifests } = fixture;
  const packets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  const dispatched = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
  events = dispatched.events;
  assert.deepEqual(dispatched.dispatched, ['W1']);

  const checkpointObserved = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'W1', recordedAt: AT });
  events = checkpointObserved.events;
  assert.equal(checkpointObserved.observation.state, 'checkpoint_ready');
  const checkpointEvent = events.find((e) => e.kind === 'checkpoint_observed');
  assert.deepEqual(
    checkpointEvent.payload.diff.entries.map(({ path: p, change }) => [p, change]),
    [['src/one.mjs', 'modified']],
  );

  // scope内なのでfindingなし・freezeなし。
  const classified = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets, todoId: 'W1', detect: detectCheckpointFindings, recordedAt: AT,
  });
  events = classified.events;
  assert.deepEqual(classified.findings, []);

  const terminal = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'W1', recordedAt: AT });
  events = terminal.events;
  assert.equal(terminal.observation.state, 'terminal');
  const terminalEvent = events.find((e) => e.kind === 'executor_terminal');
  assert.equal(terminalEvent.payload.cleanup.cleanup_ok, true);

  const adjudicated = adjudicatePendingReceipts({ runId: RUN_ID, plan, events, recordedAt: AT });
  events = adjudicated.events;
  assert.equal(adjudicated.decisions[0].decision, 'accepted');
  const chain = verifyRunEventChain({ events });
  assert.equal(chain.valid, true, JSON.stringify(chain.failed_conditions));

  // worktreeはcleanup済み（git worktree listにdisposable treeが残らない）。
  const worktrees = run('git', ['worktree', 'list', '--porcelain'], repoRoot);
  assert.equal(worktrees.split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
});

test('宣言scope外writeはscope_violationとして検出されintakeがfreezeする', async () => {
  const fixture = buildFixture({
    todos: [{ id: 'V1', writes: ['src/one.mjs'] }],
    capacity: 1,
  });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot,
    work: {
      V1: async ({ worktreePath }) => {
        await writeFile(path.join(worktreePath, 'src', 'one.mjs'), 'export const one = 11;\n');
        await writeFile(path.join(worktreePath, 'src', 'rogue.mjs'), 'export const rogue = true;\n');
      },
    },
  });
  const { request, plan, manifests } = fixture;
  const packets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  const dispatched = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
  events = dispatched.events;
  const observed = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'V1', recordedAt: AT });
  events = observed.events;
  const classified = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets, todoId: 'V1', detect: detectCheckpointFindings, recordedAt: AT,
  });
  events = classified.events;

  assert.equal(classified.findings.length, 1);
  assert.equal(classified.findings[0].kind, 'scope_violation');
  assert.equal(classified.findings[0].path, 'src/rogue.mjs');

  // 再分類はidempotent（同一findingを重複記録しない）。
  const reclassified = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets, todoId: 'V1', detect: detectCheckpointFindings, recordedAt: AT,
  });
  assert.deepEqual(reclassified.findings, []);
  assert.equal(reclassified.events.length, events.length);
  const state = projectRuntimeState({ events });
  assert.notEqual(state.freeze, null, '競合発見後はintakeがfreezeされる');

  // freeze中のdispatchは0件（engine/verifier一致）。
  const frontier = computeReadyFrontier({ plan, events });
  assert.deepEqual(frontier.dispatchable, []);

  // 独立verifierのclassifyObservedDiffも同じ正解集合を返す（成功条件10/16）。
  const checkpointEvent = events.find((e) => e.kind === 'checkpoint_observed');
  const recomputed = classifyObservedDiff({
    plan,
    manifests,
    observations: [{
      todo_id: 'V1',
      paths: checkpointEvent.payload.diff.entries.map(({ path: p }) => p),
    }],
  });
  assert.ok(recomputed.findings.some((finding) => finding.kind === 'scope_violation'));
});

test('checkpoint観測と食い違うreceiptはcheckpoint_mismatchでrejectされる', async () => {
  const fixture = buildFixture({
    todos: [{ id: 'C1', writes: ['src/two.mjs'] }],
    capacity: 1,
  });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot,
    work: {
      C1: async ({ worktreePath }) => {
        await writeFile(path.join(worktreePath, 'src', 'two.mjs'), 'export const two = 22;\n');
      },
    },
  });
  const { request, plan, manifests } = fixture;
  const packets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  const dispatched = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
  events = dispatched.events;
  const observed = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'C1', recordedAt: AT });
  events = observed.events;
  const terminal = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'C1', recordedAt: AT });
  // terminal receiptのcheckpoint_digestを改竄して再digestする（自己整合は保つ）。
  const forged = { ...terminal.events[terminal.events.length - 2].payload };
  assert.equal(forged.schema, 'lattice.executor_receipt.v1');
  forged.checkpoint_digest = 'e'.repeat(64);
  delete forged.receipt_digest;
  forged.receipt_digest = selfDigest(forged, 'receipt_digest');
  // 改竄receiptを直接event列へ差すのではなく、engineの裁定関数がrejectすることを
  // 正規のreceipt_recorded経路で検査する（forged receiptで再構成したevent列を使う）。
  const receiptEventIndex = terminal.events.findIndex((e) => e.kind === 'receipt_recorded');
  const prefix = terminal.events.slice(0, receiptEventIndex);
  const { buildNextRunEvent } = await import('../../src/runtime-engine.mjs');
  let forgedEvents = [...prefix];
  forgedEvents.push(buildNextRunEvent({
    events: forgedEvents,
    runId: RUN_ID,
    kind: 'receipt_recorded',
    planEpoch: forged.plan_epoch,
    subject: { kind: 'todo', ref: 'C1' },
    payload: forged,
    recordedAt: AT,
  }));
  const adjudicated = adjudicatePendingReceipts({ runId: RUN_ID, plan, events: forgedEvents, recordedAt: AT });
  assert.equal(adjudicated.decisions[0].decision, 'rejected');
  assert.equal(adjudicated.decisions[0].detail, 'checkpoint_mismatch');
  const recomputed = recomputeReceiptDecisions({ plan, events: forgedEvents });
  assert.equal(recomputed.decisions[0].decision, 'rejected');
  assert.equal(recomputed.decisions[0].detail, 'checkpoint_mismatch');
});

test('gitignore済みpathへのwriteもdiff sensorが検出しscope violationになる', async () => {
  // baseへ.gitignoreをcommitしたrepoを別に作る（既存fixtureを汚さない）。
  const ignRoot = path.join(temporaryRoot, 'repo-ignored');
  await mkdir(path.join(ignRoot, 'src'), { recursive: true });
  await writeFile(path.join(ignRoot, 'src', 'one.mjs'), 'export const one = 1;\n');
  await writeFile(path.join(ignRoot, '.gitignore'), 'ignored/\n');
  run('git', ['init', '--quiet', '--initial-branch=main'], ignRoot);
  run('git', ['-c', 'user.email=i@example.invalid', '-c', 'user.name=i', 'add', '.'], ignRoot);
  run('git', ['-c', 'user.email=i@example.invalid', '-c', 'user.name=i', 'commit', '--quiet', '-m', 'base'], ignRoot);
  const ignBase = run('git', ['rev-parse', 'HEAD'], ignRoot).trim();

  const adapter = createWorktreeExecutorAdapter({
    repoRoot: ignRoot,
    work: {
      G1: async ({ worktreePath }) => {
        await mkdir(path.join(worktreePath, 'ignored'), { recursive: true });
        await writeFile(path.join(worktreePath, 'ignored', 'rogue.txt'), 'sneaky\n');
      },
    },
  });
  const saved = baseSha;
  baseSha = ignBase;
  try {
    const { request, plan, manifests } = buildFixture({
      todos: [{ id: 'G1', writes: ['src/one.mjs'] }],
      capacity: 1,
    });
    const packets = buildExecutorPackets({ plan, manifests });
    let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
    const dispatched = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
    events = dispatched.events;
    const observed = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'G1', recordedAt: AT });
    events = observed.events;
    const classified = classifyCheckpointObservation({
      runId: RUN_ID, plan, events, packets, todoId: 'G1', detect: detectCheckpointFindings, recordedAt: AT,
    });
    assert.ok(classified.findings.some((finding) => (
      finding.kind === 'scope_violation' && finding.path === 'ignored/rogue.txt'
    )), JSON.stringify(classified.findings));
  } finally {
    baseSha = saved;
  }
});

test('work関数の例外はworktreeを残さずtyped failureになりretry可能である', async () => {
  const fixture = buildFixture({
    todos: [{ id: 'E1', writes: ['src/one.mjs'] }],
    capacity: 1,
  });
  let attempts = 0;
  const adapter = createWorktreeExecutorAdapter({
    repoRoot,
    work: {
      E1: async ({ worktreePath }) => {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        await writeFile(path.join(worktreePath, 'src', 'one.mjs'), 'export const one = 12;\n');
      },
    },
  });
  const { request, plan, manifests } = fixture;
  const packets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  const countWorktrees = () => run('git', ['worktree', 'list', '--porcelain'], repoRoot)
    .split('\n').filter((line) => line.startsWith('worktree ')).length;
  const before = countWorktrees();
  const failed = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
  assert.equal(failed.failure.todo_id, 'E1');
  assert.match(failed.failure.message, /boom/u);
  // 失敗経路で新しいworktreeを残さない（前後差分ゼロ）。
  assert.equal(countWorktrees(), before);
  // 同一adapterでretryできる（dispatch予約が解放されている）。
  const retried = await dispatchReadyFrontier({ runId: RUN_ID, plan, events: failed.events, packets, manifests, adapter, recordedAt: AT });
  assert.deepEqual(retried.dispatched, ['E1']);
});

test('work関数によるcanonical repoへのwriteとref作成は検出されrejectされる', async () => {
  for (const [label, work] of [
    ['canonical file write', async () => {
      await writeFile(path.join(repoRoot, 'canonical-leak.txt'), 'x\n');
    }],
    ['branch作成', async ({ worktreePath }) => {
      run('git', ['branch', 'forbidden-branch'], worktreePath);
    }],
  ]) {
    const fixture = buildFixture({
      todos: [{ id: 'K1', writes: ['src/one.mjs'] }],
      capacity: 1,
    });
    const adapter = createWorktreeExecutorAdapter({
      repoRoot,
      work: { K1: work },
    });
    const { request, plan, manifests } = fixture;
    const packets = buildExecutorPackets({ plan, manifests });
    const events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
    const result = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
    assert.equal(result.failure?.todo_id, 'K1', label);
    assert.match(result.failure.message, /canonical repoまたは共有refs/u, label);
    // 後始末（次ケースへ影響させない）。
    await rm(path.join(repoRoot, 'canonical-leak.txt'), { force: true });
    const branches = run('git', ['branch', '--list', 'forbidden-branch'], repoRoot).trim();
    if (branches) run('git', ['branch', '-D', 'forbidden-branch'], repoRoot);
  }
});

test('git mvはrename分解（added＋deleted）としてcanonical recordになる', async () => {
  const fixture = buildFixture({
    todos: [{ id: 'R1', writes: ['src/'] }],
    capacity: 1,
  });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot,
    work: {
      R1: async ({ worktreePath }) => {
        run('git', ['mv', 'src/one.mjs', 'src/renamed.mjs'], worktreePath);
      },
    },
  });
  const { request, plan, manifests } = fixture;
  const packets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  const dispatched = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
  events = dispatched.events;
  const observed = await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'R1', recordedAt: AT });
  events = observed.events;
  const checkpointEvent = events.findLast((e) => e.kind === 'checkpoint_observed');
  assert.deepEqual(
    checkpointEvent.payload.diff.entries.map(({ path: p, change }) => [p, change]),
    [['src/one.mjs', 'deleted'], ['src/renamed.mjs', 'added']],
  );
  // terminal報告でworktreeを回収する（後続testへの残存防止）。
  await observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'R1', recordedAt: AT });
});

test('work関数がcommitする禁止操作はHEAD driftとしてfail loudする', async () => {
  const fixture = buildFixture({
    todos: [{ id: 'X1', writes: ['src/one.mjs'] }],
    capacity: 1,
  });
  const adapter = createWorktreeExecutorAdapter({
    repoRoot,
    work: {
      X1: async ({ worktreePath }) => {
        await writeFile(path.join(worktreePath, 'src', 'one.mjs'), 'export const one = 111;\n');
        run('git', ['-c', 'user.email=x@example.invalid', '-c', 'user.name=x', 'add', '.'], worktreePath);
        run('git', ['-c', 'user.email=x@example.invalid', '-c', 'user.name=x', 'commit', '--quiet', '-m', 'forbidden'], worktreePath);
      },
    },
  });
  const { request, plan, manifests } = fixture;
  const packets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  const dispatched = await dispatchReadyFrontier({ runId: RUN_ID, plan, events, packets, manifests, adapter, recordedAt: AT });
  events = dispatched.events;
  await assert.rejects(
    observeExecutor({ runId: RUN_ID, plan, events, adapter, todoId: 'X1', recordedAt: AT }),
    /HEADがbaseから動いている/u,
  );
});
