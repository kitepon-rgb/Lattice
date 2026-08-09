// ob04: 「未判定はdispatchを塞がない」をProtected behaviorとして固定する。
//
// 未判定（witness未宣言＝`coverage: missing`）は「競合が無い」ではなく「まだ調べていない」である。
// だからといってdispatchを止めると、ToDoツリー上は並列できるものが多数あるのに工程が止まる。
// 現行実装は既に塞いでいない（advisoryだけを返す）が、それは**実装の現状であって契約ではない**。
// 将来の変更が善意でここを壊さないよう、実行可能な形でanchorする。
//
// 本testが固定するのは:
// 1. independence記録が無いplanでも、ready frontierは通常どおり出る（未判定は「不可」ではない）
// 2. 記録を書いても`next_ready`／`dispatch_frontier`／`frontier_digest`は1バイトも動かない
// 3. **競合を宣言した記録**でも動かない——判定結果が「競合あり」でもdispatchは塞がらない
//    （ADR 0062のPhase監査順とToDo schedulingの分離、ADR 0063の並列既定を継承）
// 4. vacuousにならないよう、記録の有無が実際に切り替わっていることを両側で確かめる
//
// ob06で同じ不変を全操作へ広げた。「dispatchが動かない条件」を探す人はここと
// `test/todo-obligations-e2e.test.mjs` の (d) を一緒に読む——こちらがprojection層で
// 記録の有無と競合宣言を、あちらが実CLIでplan note書込・調整方式の宣言・判定記録を見る。
// 欄を足す人は両方へ足す。片方だけだと「その欄はdispatchを動かさない」が半分しか固定されない。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { TODO_INDEPENDENCE_SCHEMA } from '../src/todo-independence-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  createTodoStoreWriter, initializeTodoStore, readTodoIndependenceArtifact, readTodoStore,
  writeTodoIndependenceArtifact,
} from '../src/todo-store.mjs';
import { computeReadyFrontier, projectTodoStatus } from '../src/todo-status.mjs';

const NOW = '2026-07-26T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const BASE_SHA = 'a'.repeat(40);
const task = (taskId) => ({ task_id: taskId, title: taskId, lane: 'main',
  narrative_ref: null, compile_binding: null });
const ref = (taskId) => ({ project_id: 'project-1', plan_key: 'main', task_id: taskId });

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-dispatch-unjudged-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        // T1・T2は並列ready、T3はT1待ち。frontierが1件でも全件でもない形にして、
        // 「たまたま同じ」ではなく「同じ集合が同じ順で出る」ことを見る。
        tasks: [task('T1'), task('T2'), task('T3')],
        hard_dependencies: [{ from: ref('T1'), to: ref('T3') }], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  return { root, plan: store.members[0].plan };
}

/** 実際にcompileされた記録と同じ形。conflictsを差し替えて「判定済みで競合あり」も作れる。 */
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
  // v4: scope_expanded は task_ids と1:1でなければ validator が落とす。
  // fixture の既定は「膨張ゼロ・比較相手なし」で、膨張そのものを測る test は overrides で上書きする
  value.scope_expanded = value.scope_expanded ?? (value.task_ids ?? []).map((taskId) => ({
    task_id: taskId, compared_witness_digest: null, first_seen_path_count: 0,
    path_count: 0, added_paths: [], removed_paths: [], growth_events: 0, gate_shape: false,
  }));
  value.result_digest = todoSelfDigest(value, 'result_digest');
  return value;
}

const dispatchFacing = (status) => JSON.stringify({
  active_set: status.active_set, next_ready: status.next_ready,
  blocked: status.blocked, dispatch_frontier: status.dispatch_frontier,
});

test('independence記録が無くてもready frontierは通常どおり出る', async (context) => {
  const { root } = await workspace(context);
  const store = await readTodoStore({ repoRoot: root, now: NOW });

  // 前提の確認: この時点で記録は存在しない（＝未判定）。
  assert.equal(await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }), null);

  const status = projectTodoStatus(store, { parallelCandidates: [], planNotes: [] });
  // 未判定は「不可」ではない。T1・T2は並列readyのまま出る。
  assert.deepEqual(status.next_ready.map(({ task_id: id }) => id), ['T1', 'T2']);
  assert.equal(status.dispatch_frontier.recommended_parallelism, 2);
  assert.equal(status.dispatch_frontier.subset_requires_reason, true);
  assert.deepEqual(computeReadyFrontier(store), status.next_ready);
});

test('independence記録を書いてもdispatch面は1バイトも動かない', async (context) => {
  const { root, plan } = await workspace(context);
  const before = projectTodoStatus(await readTodoStore({ repoRoot: root, now: NOW }), { parallelCandidates: [], planNotes: [] });

  const artifact = independenceArtifact(plan);
  const { ref: artifactRef } = await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });
  assert.equal(artifactRef, '.lattice/todo/plans/main/v1/independence.json');
  // vacuous対策: 記録が実際に立ったことを確かめてから比較する。立っていなければ
  // 「変わらない」は当たり前になり、何も固定していないことになる。
  assert.deepEqual(await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }), artifact);

  const after = projectTodoStatus(await readTodoStore({ repoRoot: root, now: NOW }), { parallelCandidates: [], planNotes: [] });
  assert.equal(dispatchFacing(after), dispatchFacing(before));
  assert.equal(after.dispatch_frontier.frontier_digest, before.dispatch_frontier.frontier_digest);
  // リテラルでも固定する。両側が同時に壊れた時に通ってしまう形を避ける。
  assert.deepEqual(after.next_ready.map(({ task_id: id }) => id), ['T1', 'T2']);
});

test('競合を宣言した記録でもdispatchは塞がらない', async (context) => {
  const { root, plan } = await workspace(context);
  const before = projectTodoStatus(await readTodoStore({ repoRoot: root, now: NOW }), { parallelCandidates: [], planNotes: [] });

  // 判定結果が「T1とT2は同じ資源で競合する」でも、dispatchの可否は変えない。
  // 競合はstartのadvisoryが伝える助言であって、frontierからの除外ではない（ADR 0128）。
  const artifact = independenceArtifact(plan, {
    conflict_resources: [{ resource_id: 'src/shared.mjs', kind: 'path', target: 'src/shared.mjs' }],
    conflicts: [{ task_ids: ['T1', 'T2'], resource_id: 'src/shared.mjs' }],
    wave_plan: { waves: [{ task_ids: ['T1'] }, { task_ids: ['T2', 'T3'] }], minimum_feasible_waves: 2 },
  });
  await writeTodoIndependenceArtifact({ repoRoot: root, artifact, now: NOW });
  assert.deepEqual(await readTodoIndependenceArtifact({ repoRoot: root, planKey: 'main', now: NOW }), artifact);

  const after = projectTodoStatus(await readTodoStore({ repoRoot: root, now: NOW }), { parallelCandidates: [], planNotes: [] });
  assert.equal(dispatchFacing(after), dispatchFacing(before));
  assert.equal(after.dispatch_frontier.frontier_digest, before.dispatch_frontier.frontier_digest);
  assert.deepEqual(after.next_ready.map(({ task_id: id }) => id), ['T1', 'T2']);
  // 競合宣言はwave_planを2波にしているが、それも並列開始宣言の既定を変えない。
  assert.equal(after.dispatch_frontier.recommended_parallelism, 2);
  assert.equal(after.dispatch_frontier.subset_requires_reason, true);
});
