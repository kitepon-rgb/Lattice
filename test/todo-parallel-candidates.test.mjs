// 並列候補の逐次判定（ob05・オーナー裁定C③）。理想の動きは
// 「AIがツリーから並列できそうな組を選ぶ→その組だけ宣言してcompile→機械が可否を返す→
//  否なら次の候補へ」で、判定機械（compile）と部分宣言の受理は既に在る。
// 足りなかったのは**候補の提示と導線**で、この欄がそれを持つ。
//
// 固定するのは3つ:
//  1. 未判定のreadyが候補として出る（記録が無いplanを飛ばさない＝沈黙を不在に見せない）
//  2. 判定が進むと候補が減り、判定結果（並列可・要直列）へ変わる
//  3. **どの段階でもdispatchは1バイトも動かない**（ADR 0063・ob04のProtected behavior）

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import { TODO_INDEPENDENCE_SCHEMA } from '../src/todo-independence-contracts.mjs';
import { readTodoParallelCandidatesForStatus } from '../src/todo-parallel-candidates.mjs';
import { projectTodoStatus } from '../src/todo-status.mjs';
import {
  createTodoStoreWriter, initializeTodoStore, readTodoStore, writeTodoIndependenceArtifact,
} from '../src/todo-store.mjs';

const NOW = '2026-07-26T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const BASE_SHA = 'a'.repeat(40);
const gitHead = () => BASE_SHA;

const task = (taskId) => ({ task_id: taskId, title: taskId, lane: 'main',
  narrative_ref: null, compile_binding: null });
const ref = (taskId) => ({ project_id: 'project-1', plan_key: 'main', task_id: taskId });

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-parallel-candidates-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        // T1・T2がready、T3はT1待ち。frontierが全件でも1件でもない形にする。
        tasks: [task('T1'), task('T2'), task('T3')],
        hard_dependencies: [{ from: ref('T1'), to: ref('T3') }], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  return { root, store, plan: store.members[0].plan };
}

function independenceArtifact(plan, overrides = {}) {
  const value = {
    schema: TODO_INDEPENDENCE_SCHEMA,
    project_id: plan.project_id, plan_key: plan.plan_key, plan_version: plan.plan_version,
    topology_digest: plan.topology_digest, base_sha: BASE_SHA,
    witness_set_digest: 'd'.repeat(64), compiled_at: NOW,
    task_ids: ['T1', 'T2', 'T3'],
    task_boundaries: [
      { task_id: 'T1', paths: ['src/t1.mjs'] },
      { task_id: 'T2', paths: ['src/t2.mjs'] },
      { task_id: 'T3', paths: ['src/t3.mjs'] },
    ],
    conflict_resources: [], conflicts: [], precedences: [], unknowns: [],
    wave_plan: { waves: [{ task_ids: ['T1', 'T2', 'T3'] }], minimum_feasible_waves: 1 },
    outcome: 'compiled', result_digest: '',
    ...overrides,
  };
  value.result_digest = todoSelfDigest(value, 'result_digest');
  return value;
}

const candidatesOf = (root, store) => readTodoParallelCandidatesForStatus({
  repoRoot: root, store, gitHead,
});

/** dispatchに面した部分だけを取り出す。ここがbyte一致し続けることが受入条件。 */
const dispatchFacing = (status) => JSON.stringify({
  active_set: status.active_set, next_ready: status.next_ready,
  blocked: status.blocked, dispatch_frontier: status.dispatch_frontier,
});

test('記録が無いplanは飛ばさず、readyが未判定の候補として出る', async (context) => {
  const { root, store } = await workspace(context);
  const candidates = await candidatesOf(root, store);

  assert.equal(candidates.length, 1);
  const [entry] = candidates;
  assert.equal(entry.plan_key, 'main');
  // 「競合が無い」ではなく「まだ判定していない」。
  assert.equal(entry.coverage, 'missing');
  assert.deepEqual(entry.unjudged_task_ids, ['T1', 'T2']);
  assert.deepEqual(entry.verified_parallel_groups, []);
  assert.deepEqual(entry.serialize_pairs, []);
  // 欄だけ置いて閉じない。次の一手を名指しする。
  assert.deepEqual(entry.next_commands,
    ['lattice todo independence compile --plan main --input <file>']);
});

test('判定が済むと候補は並列可の組へ変わり、次の一手も読み出しへ変わる', async (context) => {
  const { root, store, plan } = await workspace(context);
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact: independenceArtifact(plan), now: NOW });
  const [entry] = await candidatesOf(root, await readTodoStore({ repoRoot: root, now: NOW }));

  assert.equal(entry.coverage, 'verified');
  assert.deepEqual(entry.unjudged_task_ids, []);
  assert.deepEqual(entry.verified_parallel_groups, [{ task_ids: ['T1', 'T2'] }]);
  assert.deepEqual(entry.serialize_pairs, []);
  assert.deepEqual(entry.next_commands, ['lattice todo independence --plan main --json']);
});

test('競合が出た組は要直列として理由つきで出る', async (context) => {
  const { root, store, plan } = await workspace(context);
  await writeTodoIndependenceArtifact({ repoRoot: root, now: NOW,
    artifact: independenceArtifact(plan, {
      conflict_resources: [{ resource_id: 'src/shared.mjs', kind: 'path', target: 'src/shared.mjs' }],
      conflicts: [{ task_ids: ['T1', 'T2'], resource_id: 'src/shared.mjs' }],
      wave_plan: { waves: [{ task_ids: ['T1'] }, { task_ids: ['T2', 'T3'] }], minimum_feasible_waves: 2 },
    }) });
  const [entry] = await candidatesOf(root, await readTodoStore({ repoRoot: root, now: NOW }));

  assert.equal(entry.coverage, 'verified');
  assert.deepEqual(entry.unjudged_task_ids, []);
  // 競合した組は並列groupに入らない。
  assert.deepEqual(entry.verified_parallel_groups, []);
  assert.equal(entry.serialize_pairs.length, 1);
  assert.deepEqual(entry.serialize_pairs[0].task_ids, ['T1', 'T2']);
  assert.equal(typeof entry.serialize_pairs[0].detail, 'string');
});

test('候補の状態が変わってもdispatchは1バイトも動かない', async (context) => {
  const { root, store, plan } = await workspace(context);
  const before = projectTodoStatus(store, {
    planNotes: [], parallelCandidates: await candidatesOf(root, store),
  });
  assert.equal(before.parallel_candidates.length, 1);
  assert.deepEqual(before.parallel_candidates[0].unjudged_task_ids, ['T1', 'T2']);

  await writeTodoIndependenceArtifact({ repoRoot: root, artifact: independenceArtifact(plan), now: NOW });
  const judgedStore = await readTodoStore({ repoRoot: root, now: NOW });
  const after = projectTodoStatus(judgedStore, {
    planNotes: [], parallelCandidates: await candidatesOf(root, judgedStore),
  });

  // 候補欄は変わる。
  assert.deepEqual(after.parallel_candidates[0].unjudged_task_ids, []);
  assert.deepEqual(after.parallel_candidates[0].verified_parallel_groups, [{ task_ids: ['T1', 'T2'] }]);
  // dispatch面は変わらない。vacuous対策として、比較の前に対象が空でないことを固定する。
  assert.deepEqual(before.next_ready.map(({ task_id: id }) => id), ['T1', 'T2']);
  assert.equal(dispatchFacing(after), dispatchFacing(before));
  assert.equal(after.dispatch_frontier.frontier_digest, before.dispatch_frontier.frontier_digest);
});
