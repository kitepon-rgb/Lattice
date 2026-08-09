import assert from 'node:assert/strict';
import test from 'node:test';

import { compileTodoIndependence } from '../src/todo-independence.mjs';
import { TODO_WITNESS_SET_SCHEMA } from '../src/todo-independence-contracts.mjs';
import { evidenceFromCollectedOutcomes } from '../src/runtime-front-end.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// s1: independence compileがtask別の宣言膨張を事実として記録する（scope_expanded）。
//
// **ここで固定するのは「装置が何を言うか」ではなく「何を言わないか」でもある。**
// 膨張の原因（上流の契約確定への追従・自分の変更の後始末・元から在った面の見落とし・
// 思いつきで盛った分）は機械には区別できない。装置は増減と回数と合流点だけを置き、
// 仕分けはAIがやる。だからこのtestは閾値も勧告も検査しない——存在しないのが正しい。

const BASE_SHA = 'a'.repeat(40);
const COMPILED_AT = '2026-08-09T00:00:00.000Z';

const plan = (overrides = {}) => ({
  project_id: 'lattice',
  plan_key: 'plan-a',
  plan_version: 'v1',
  topology_digest: 'c'.repeat(64),
  tasks: [{ task_id: 'tip-001' }, { task_id: 'tip-002' }, { task_id: 'tip-003' }],
  hard_dependencies: [],
  ...overrides,
});

function witness(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return {
    owns: list.map((path) => ({ kind: 'path', target: path })),
    reads: [],
    writes: [...list],
    resources: [],
    state_effects: [],
    sensor_provenance: {
      queries: list.map((path) => ({
        query_id: `q-${path.replace(/[^0-9a-z]/gu, '-')}`,
        expect: { kind: 'affected', path },
      })),
    },
    affected_tests: [],
    unknowns: [],
  };
}

function witnessSet(manualWitness) {
  const paths = [...new Set(Object.values(manualWitness).flatMap((entry) => entry.writes))].sort();
  const value = {
    schema: TODO_WITNESS_SET_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    capacity: { executors: 4 },
    sensor_query_set: {
      queries: [
        { id: 'q-status', operation: 'status' },
        ...paths.map((path) => ({
          id: `q-${path.replace(/[^0-9a-z]/gu, '-')}`, operation: 'affected', target: path,
        })),
      ],
    },
    manual_witness: manualWitness,
    witness_set_digest: '',
  };
  value.witness_set_digest = todoSelfDigest(value, 'witness_set_digest');
  return value;
}

function evidenceFor(set) {
  const paths = [...new Set(Object.values(set.manual_witness).flatMap((entry) => entry.writes))].sort();
  return evidenceFromCollectedOutcomes({
    querySet: set.sensor_query_set,
    collected: {
      cwd: '/repo',
      outcomes: [
        { id: 'q-status', operation: 'status', outcome: 'ready' },
        ...paths.map((path) => ({
          id: `q-${path.replace(/[^0-9a-z]/gu, '-')}`,
          operation: 'affected',
          outcome: 'ready',
          targets: [{
            target: path, outcome: 'ready', path_state: 'present',
            data: { changedFiles: [path], affectedTests: [] },
          }],
        })),
      ],
    },
  });
}

const compile = (set, { previousArtifact = null, planValue = plan() } = {}) => compileTodoIndependence({
  witnessSet: set,
  plan: planValue,
  baseSha: BASE_SHA,
  compiledAt: COMPILED_AT,
  sensorEvidence: evidenceFor(set),
  previousArtifact,
});

const entryOf = (artifact, taskId) => artifact.scope_expanded
  .find((entry) => entry.task_id === taskId);

test('初回compileは比較相手なしとして記録する（膨張ゼロと区別できる）', () => {
  const set = witnessSet({
    'tip-001': witness('src/alpha.mjs'),
    'tip-002': witness('src/beta.mjs'),
  });
  const artifact = compile(set);

  assert.equal(artifact.schema, 'lattice.todo_independence.v4');
  assert.deepEqual(artifact.scope_expanded.map((entry) => entry.task_id), ['tip-001', 'tip-002']);
  const first = entryOf(artifact, 'tip-001');
  // **compared_witness_digest が null なのが「まだ比べていない」の印である。**
  // ここを 0 件の added_paths だけで表すと、「比べて増えていない」と区別が付かない。
  assert.equal(first.compared_witness_digest, null);
  assert.equal(first.first_seen_path_count, 1);
  assert.equal(first.path_count, 1);
  assert.deepEqual(first.added_paths, []);
  assert.deepEqual(first.removed_paths, []);
  assert.equal(first.growth_events, 0);
});

test('宣言が増えると added_paths と growth_events が動き、初回の数は保たれる', () => {
  const before = witnessSet({
    'tip-001': witness('src/alpha.mjs'),
    'tip-002': witness('src/beta.mjs'),
  });
  const previous = compile(before);
  const after = witnessSet({
    'tip-001': witness(['src/alpha.mjs', 'src/alpha-2.mjs', 'src/alpha-3.mjs']),
    'tip-002': witness('src/beta.mjs'),
  });
  const artifact = compile(after, { previousArtifact: previous });

  const grown = entryOf(artifact, 'tip-001');
  assert.equal(grown.compared_witness_digest, previous.witness_set_digest);
  assert.equal(grown.first_seen_path_count, 1, '初回の宣言数は上書きしない');
  assert.equal(grown.path_count, 3);
  assert.deepEqual(grown.added_paths, ['src/alpha-2.mjs', 'src/alpha-3.mjs']);
  assert.deepEqual(grown.removed_paths, []);
  assert.equal(grown.growth_events, 1);

  // 負の対照: 宣言が変わっていない task には何も出ない
  const untouched = entryOf(artifact, 'tip-002');
  assert.deepEqual(untouched.added_paths, []);
  assert.deepEqual(untouched.removed_paths, []);
  assert.equal(untouched.growth_events, 0);
});

test('growth_events は膨張した回数だけ増える（同じ宣言を再compileしても増えない）', () => {
  const start = witnessSet({ 'tip-001': witness('src/alpha.mjs') });
  const first = compile(start);
  const grown = witnessSet({ 'tip-001': witness(['src/alpha.mjs', 'src/alpha-2.mjs']) });
  const second = compile(grown, { previousArtifact: first });
  assert.equal(entryOf(second, 'tip-001').growth_events, 1);

  // 同じ宣言でもう一度compileする——**回数は増えない**
  const third = compile(grown, { previousArtifact: second });
  assert.equal(entryOf(third, 'tip-001').growth_events, 1);
  assert.deepEqual(entryOf(third, 'tip-001').added_paths, []);

  // もう一段増やすと2回目として数える
  const grownMore = witnessSet({
    'tip-001': witness(['src/alpha.mjs', 'src/alpha-2.mjs', 'src/alpha-3.mjs']),
  });
  const fourth = compile(grownMore, { previousArtifact: third });
  assert.equal(entryOf(fourth, 'tip-001').growth_events, 2);
});

test('宣言が減ったら removed_paths に出て、growth_events は増えない', () => {
  const before = witnessSet({ 'tip-001': witness(['src/alpha.mjs', 'src/alpha-2.mjs']) });
  const previous = compile(before);
  const after = witnessSet({ 'tip-001': witness('src/alpha.mjs') });
  const artifact = compile(after, { previousArtifact: previous });

  const shrunk = entryOf(artifact, 'tip-001');
  // **増加だけを見ると「盛った」と「宣言をやり直した」が同じ顔になる。**
  assert.deepEqual(shrunk.removed_paths, ['src/alpha-2.mjs']);
  assert.deepEqual(shrunk.added_paths, []);
  assert.equal(shrunk.growth_events, 0);
  assert.equal(shrunk.path_count, 1);
  assert.equal(shrunk.first_seen_path_count, 2);
});

test('gate_shape は依存の合流点（入次数2以上）だけ true', () => {
  const set = witnessSet({
    'tip-001': witness('src/alpha.mjs'),
    'tip-002': witness('src/beta.mjs'),
    'tip-003': witness('src/gamma.mjs'),
  });
  const artifact = compile(set, {
    planValue: plan({
      hard_dependencies: [
        { from: { task_id: 'tip-001' }, to: { task_id: 'tip-003' } },
        { from: { task_id: 'tip-002' }, to: { task_id: 'tip-003' } },
      ],
    }),
  });
  assert.equal(entryOf(artifact, 'tip-003').gate_shape, true, '2本入る合流点');
  assert.equal(entryOf(artifact, 'tip-001').gate_shape, false);
  assert.equal(entryOf(artifact, 'tip-002').gate_shape, false);
});

test('前回artifactが比較不能なら、比較相手なしとして扱う（膨張ゼロへ化かさない）', () => {
  const before = witnessSet({ 'tip-001': witness(['src/alpha.mjs', 'src/alpha-2.mjs']) });
  const previous = compile(before);
  const after = witnessSet({ 'tip-001': witness('src/alpha.mjs') });

  // ① plan version が違う記録
  const otherVersion = { ...previous, plan_version: 'v2' };
  const fromOtherVersion = compile(after, { previousArtifact: otherVersion });
  assert.equal(entryOf(fromOtherVersion, 'tip-001').compared_witness_digest, null);
  assert.deepEqual(entryOf(fromOtherVersion, 'tip-001').removed_paths, []);
  // **初回として置き直す**——前回の first_seen を継がない（継ぐと嘘の比率になる）
  assert.equal(entryOf(fromOtherVersion, 'tip-001').first_seen_path_count, 1);

  // ② topology が違う記録
  const otherTopology = { ...previous, topology_digest: 'd'.repeat(64) };
  assert.equal(entryOf(compile(after, { previousArtifact: otherTopology }), 'tip-001')
    .compared_witness_digest, null);

  // ③ 旧schemaの記録
  const legacy = { ...previous, schema: 'lattice.todo_independence.v3' };
  assert.equal(entryOf(compile(after, { previousArtifact: legacy }), 'tip-001')
    .compared_witness_digest, null);
});

test('subset入替で履歴が消える時は「初回」へ偽装せず null で分からないと言う', () => {
  // witness は wave 単位の subset で書き出せるので、A→B→A と入れ替わると
  // 直前 artifact に A が居ない。そこで今回を初回と置くと**本当の初回と膨張回数が消える**。
  const onlyA = witnessSet({ 'tip-001': witness('src/alpha.mjs') });
  const first = compile(onlyA);
  assert.equal(entryOf(first, 'tip-001').first_seen_path_count, 1);

  const onlyB = witnessSet({ 'tip-002': witness('src/beta.mjs') });
  const second = compile(onlyB, { previousArtifact: first });

  const backToA = witnessSet({ 'tip-001': witness(['src/alpha.mjs', 'src/alpha-2.mjs']) });
  const third = compile(backToA, { previousArtifact: second });

  const gap = entryOf(third, 'tip-001');
  // **比較相手はある**（だから digest は載る）が、**その中に A が居ない**
  assert.equal(gap.compared_witness_digest, second.witness_set_digest);
  assert.equal(gap.first_seen_path_count, null, '初回宣言数を今回の数で埋めない');
  assert.equal(gap.growth_events, null, '膨張回数を0へ戻さない');
  assert.equal(gap.path_count, 2);
  assert.deepEqual(gap.added_paths, []);
  assert.deepEqual(gap.removed_paths, []);

  // 初回（比較相手そのものが無い）とは区別できる
  const brandNew = entryOf(compile(onlyA), 'tip-001');
  assert.equal(brandNew.compared_witness_digest, null);
  assert.equal(brandNew.first_seen_path_count, 1);
  assert.equal(brandNew.growth_events, 0);
});
