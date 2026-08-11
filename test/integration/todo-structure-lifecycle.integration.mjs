import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createTodoStructureE2eFixture,
  emptyTransform,
  parseStructureE2eJson,
  runStructureE2eCli,
  structureContract,
  structureE2eGit,
  structureSet,
  writeStructureE2eEvidence,
  writeStructureE2eJson,
} from '../helpers/todo-structure-e2e-fixture.mjs';
import { collectTodoStructureAuthoritativeObservation } from '../../src/todo-structure-authoritative-observation.mjs';

function ok(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  return parseStructureE2eJson(result.stdout);
}

function todo(root, args) {
  return runStructureE2eCli(root, ['todo', ...args]);
}

function sensor(root, args) {
  return runStructureE2eCli(root, ['sensor', ...args]);
}

function commitTodo(root, message) {
  structureE2eGit(root, ['add', '--', '.lattice/todo']);
  structureE2eGit(root, ['commit', '--quiet', '-m', message]);
}

async function installSource(fixture, set, label) {
  const ref = await writeStructureE2eJson(fixture.root, `${set.plan_key}-${label}.json`, set);
  ok(todo(fixture.root, [
    'structure', 'input', '--plan', set.plan_key, '--input', ref,
  ]), `${label} input`);
  commitTodo(fixture.root, `${label} source`);
}

function compile(root, planKey) {
  return todo(root, [
    'structure', 'compile', '--plan', planKey,
    '--input', `.lattice/todo/structure/${planKey}.json`,
  ]);
}

function producer(shapeId = 'shared-shape', sinks = [{ kind: 'task', task_id: 'B', port_id: 'in' }]) {
  return {
    ...emptyTransform('A'),
    inputs: [{
      port_id: 'seed', source: { kind: 'constant', constant_id: 'seed', value: 'one' },
      access: 'read', contract: structureContract('seed-shape'),
    }],
    operations: [{
      operation_id: 'produce', input_port_ids: ['seed'], output_port_ids: ['out'],
      summary: '共有dataを作る',
    }],
    outputs: [{
      port_id: 'out', data_id: 'shared-data', contract: structureContract(shapeId), sinks,
    }],
  };
}

function consumer(shapeId = 'shared-shape') {
  return {
    ...emptyTransform('B'),
    inputs: [{
      port_id: 'in', source: { kind: 'task_output', task_id: 'A', port_id: 'out' },
      access: 'consume', contract: structureContract(shapeId),
    }],
    operations: [],
  };
}

const graphTasks = (first, second) => [
  { task_id: 'A', applicability: 'graph', planned: first },
  { task_id: 'B', applicability: 'graph', planned: second },
];

test('実Git・sensorで正負compile、realize、finalize、未適用互換を一周する', async (t) => {
  const fixture = await createTodoStructureE2eFixture(t);
  const { root } = fixture;

  // 未適用planは構造入力なしの従来lifecycleだけで完走する。
  ok(todo(root, ['start', '--plan', 'plain', '--task', 'P1', '--parallel-frontier']), 'plain start');
  const plainEvidence = await writeStructureE2eEvidence(root, 'P1');
  ok(todo(root, ['done', '--plan', 'plain', '--task', 'P1', '--evidence', plainEvidence]), 'plain done');
  ok(todo(root, [
    'phase', 'close-unaudited', '--plan', 'plain', '--phase', 'terminal-audit',
    '--reason', 'structure未適用互換fixture',
  ]), 'plain terminal');

  const lifecycleAnchor = {
    anchor_id: 'implementation', effect: 'modify', path: 'src/lifecycle.mjs',
    symbol: 'runLifecycle', expected_at: 'current',
  };
  const lifecycleSet = structureSet(fixture, 'lifecycle', [
    { task_id: 'L1', applicability: 'graph',
      planned: emptyTransform('L1', { codeAnchors: [lifecycleAnchor] }) },
    { task_id: 'L2', applicability: 'excluded', excluded_reason: '構造を変えない受入工程' },
  ]);
  const unknownSet = structureSet(fixture, 'negative', graphTasks(
    emptyTransform('A', { codeAnchors: [{
      anchor_id: 'future-file', effect: 'create', path: 'src/future.mjs',
      symbol: null, expected_at: 'baseline',
    }] }),
    emptyTransform('B'),
  ));
  await installSource(fixture, lifecycleSet, 'lifecycle-planned');
  await installSource(fixture, unknownSet, 'unknown');

  // authoritative observationは管理木のsensor有無に依存せずfresh indexを作る。
  // それでもafter_task anchorはまだ観測不能なのでunknownを維持する。
  const unknown = ok(compile(root, 'negative'), 'unknown compile');
  assert.equal(unknown.verdict, 'unknown');
  assert.equal(unknown.enabled, false);
  commitTodo(root, 'unknown compile artifact');
  ok(sensor(root, ['init', '.', '--json']), 'sensor init');

  const scenarios = [
    {
      id: 'dependency-missing', code: 'STRUCTURE_DEPENDENCY_MISSING',
      tasks: graphTasks(producer(), consumer()),
    },
    {
      id: 'shape-mismatch', code: 'STRUCTURE_CONTRACT_MISMATCH',
      tasks: graphTasks(producer(), consumer('other-shape')),
    },
    {
      id: 'orphan', code: 'STRUCTURE_OUTPUT_ORPHANED',
      tasks: graphTasks(producer('shared-shape', []), emptyTransform('B')),
    },
    {
      id: 'anchor-absent', code: 'STRUCTURE_CODE_ANCHOR_ABSENT',
      tasks: graphTasks(emptyTransform('A', { codeAnchors: [{
        anchor_id: 'missing', effect: 'read', path: 'src/missing.mjs',
        symbol: null, expected_at: 'current',
      }] }), emptyTransform('B')),
    },
  ];
  for (const scenario of scenarios) {
    const set = structureSet(fixture, 'negative', scenario.tasks);
    await installSource(fixture, set, scenario.id);
    ok(sensor(root, ['sync', '.', '--json']), `${scenario.id} sensor sync`);
    const result = ok(compile(root, 'negative'), `${scenario.id} compile`);
    assert.equal(result.verdict, 'inconsistent');
    assert.equal(result.enabled, false);
    assert.equal(result.findings.some(({ code }) => code === scenario.code), true, scenario.id);
    commitTodo(root, `${scenario.id} compile artifact`);
  }

  // 管理木がdirtyでもauthoritative observationはcurrent HEADだけを見る。
  // planned anchorと同名の未コミットfileを置き、誤って観測すればfindingが消える形で固定する。
  const worktreesBeforeDirtyCompile = structureE2eGit(root, ['worktree', 'list', '--porcelain']);
  await writeFile(path.join(root, 'README.md'), 'dirty structure e2e\n');
  await writeFile(path.join(root, 'src/missing.mjs'), 'export const uncommittedOnly = true;\n');
  const dirty = ok(compile(root, 'negative'), 'dirty management tree compile');
  assert.equal(dirty.verdict, 'inconsistent');
  assert.equal(dirty.findings.some(({ code }) => code === 'STRUCTURE_CODE_ANCHOR_ABSENT'), true);
  assert.equal(dirty.current_head_sha, structureE2eGit(root, ['rev-parse', 'HEAD']));
  assert.equal(structureE2eGit(root, ['worktree', 'list', '--porcelain']), worktreesBeforeDirtyCompile);
  await writeFile(path.join(root, 'README.md'), 'structure e2e\n');
  await rm(path.join(root, 'src/missing.mjs'));
  commitTodo(root, 'dirty management tree compile artifact');
  assert.equal(structureE2eGit(root, ['status', '--porcelain']), '');

  // consistentだけがimmutable bindingを作り、後続HEADでstaleへ戻る。
  const consistentSet = structureSet(fixture, 'negative', graphTasks(
    emptyTransform('A'), emptyTransform('B'),
  ));
  await installSource(fixture, consistentSet, 'consistent');
  ok(sensor(root, ['sync', '.', '--json']), 'consistent sensor sync');
  const consistent = ok(compile(root, 'negative'), 'consistent compile');
  assert.equal(consistent.verdict, 'consistent');
  assert.equal(consistent.enabled, true);
  assert.equal(ok(todo(root, ['structure', '--plan', 'negative', '--json']),
    'fresh structure read').freshness, 'fresh');
  commitTodo(root, 'activate negative structure');
  const stale = ok(todo(root, ['structure', '--plan', 'negative', '--json']), 'stale read');
  assert.equal(stale.coverage, 'stale');
  assert.deepEqual(stale.stale_reasons, ['current_head_sha']);

  // lifecycle planはpending→in-progress→doneと実装commitを通して終端まで進む。
  ok(sensor(root, ['sync', '.', '--json']), 'lifecycle sensor sync');
  const lifecycleCompile = ok(compile(root, 'lifecycle'), 'lifecycle compile');
  assert.equal(lifecycleCompile.verdict, 'consistent');
  commitTodo(root, 'activate lifecycle structure');
  const pending = ok(todo(root, ['status']), 'pending status');
  assert.equal(pending.next_ready.some(({ plan_key: planKey, task_id: taskId }) =>
    planKey === 'lifecycle' && taskId === 'L1'), true);
  ok(todo(root, ['start', '--plan', 'lifecycle', '--task', 'L1', '--parallel-frontier']), 'L1 start');
  ok(todo(root, ['start', '--plan', 'lifecycle', '--task', 'L2']), 'L2 start');
  assert.equal(ok(todo(root, ['show', '--plan', 'lifecycle', '--task', 'L1', '--json']),
    'in-progress show').state.status, 'in-progress');
  await writeFile(path.join(root, 'src/lifecycle.mjs'),
    'export function runLifecycle(value) { return { value, realized: true }; }\n');
  structureE2eGit(root, ['add', '--', 'src/lifecycle.mjs', '.lattice/todo']);
  structureE2eGit(root, ['commit', '--quiet', '-m', 'implement lifecycle task']);
  ok(todo(root, [
    'structure', 'realize', '--plan', 'lifecycle', '--task', 'L1', '--planned',
  ]), 'L1 realize');
  const l1Evidence = await writeStructureE2eEvidence(root, 'L1');
  ok(todo(root, ['done', '--plan', 'lifecycle', '--task', 'L1', '--evidence', l1Evidence]), 'L1 done');
  const l2Evidence = await writeStructureE2eEvidence(root, 'L2');
  ok(todo(root, ['done', '--plan', 'lifecycle', '--task', 'L2', '--evidence', l2Evidence]), 'L2 done');
  assert.equal(ok(todo(root, ['show', '--plan', 'lifecycle', '--task', 'L1', '--json']),
    'done show').state.status, 'done');
  commitTodo(root, 'complete lifecycle tasks');
  ok(sensor(root, ['sync', '.', '--json']), 'final sensor sync');
  const finalized = ok(todo(root, [
    'structure', 'finalize', '--plan', 'lifecycle', '--json',
  ]), 'lifecycle finalize');
  assert.equal(finalized.verdict, 'consistent');
  assert.equal(finalized.finalized, true);
  ok(todo(root, [
    'phase', 'close-unaudited', '--plan', 'lifecycle', '--phase', 'terminal-audit',
    '--reason', 'structure lifecycle e2e complete',
  ]), 'lifecycle terminal');
  const finalStatus = ok(todo(root, ['status']), 'final status');
  assert.deepEqual(finalStatus.structure_finalization_pending, []);
});

test('authoritative observationはsensor失敗でも一時worktreeを回収する', async (t) => {
  const fixture = await createTodoStructureE2eFixture(t);
  const set = structureSet(fixture, 'negative', graphTasks(
    emptyTransform('A'), emptyTransform('B'),
  ));
  const worktreesBefore = structureE2eGit(fixture.root, ['worktree', 'list', '--porcelain']);
  await assert.rejects(collectTodoStructureAuthoritativeObservation({
    repoRoot: fixture.root,
    structureSet: set,
    initializeSensor: async () => {
      const error = new Error('fixture_sensor_failure');
      error.code = 'FIXTURE_SENSOR_FAILURE';
      throw error;
    },
  }), (error) => error?.code === 'FIXTURE_SENSOR_FAILURE');
  assert.equal(structureE2eGit(fixture.root, ['worktree', 'list', '--porcelain']), worktreesBefore);
});
