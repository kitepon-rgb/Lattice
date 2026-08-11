import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TODO_STRUCTURE_BINDING_SCHEMA,
  TODO_STRUCTURE_CONTRACT_ERROR,
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  TODO_STRUCTURE_SET_SCHEMA,
  digestTodoStructureTransform,
  explainTodoStructureBinding,
  explainTodoStructureRealization,
  explainTodoStructureSet,
  validateTodoStructureBinding,
  validateTodoStructureRealization,
  validateTodoStructureSet,
} from '../src/todo-structure-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

const DIGEST = (character) => character.repeat(64);
const SHA = (character) => character.repeat(40);
const ACTOR = { host: 'MS-A2', session: 'codex-1', agent: 'bell' };

function contract(shapeId = 'room-event') {
  return {
    shape_id: shapeId,
    schema_ref: { path: 'docs/schemas/room-event.json', symbol: null, json_pointer: '' },
    identity_fields: ['event_id'],
    lifecycle: 'event',
    cardinality: 'one',
    compatible_shape_ids: [],
  };
}

function planned(overrides = {}) {
  return {
    outcome: '入力eventを公開artifactへ変換する',
    inputs: [{
      port_id: 'event-in',
      source: { kind: 'constant', constant_id: 'fixture-event', value: { event_id: 'evt-1' } },
      access: 'consume',
      contract: contract(),
    }],
    operations: [{
      operation_id: 'compile-event',
      input_port_ids: ['event-in'],
      output_port_ids: ['event-out'],
      summary: 'eventをcanonicalな公開形へ揃える',
    }],
    outputs: [{
      port_id: 'event-out',
      data_id: 'compiled-event',
      contract: contract(),
      sinks: [{ kind: 'final_product', product_id: 'room-event-artifact' }],
    }],
    code_anchors: [{
      anchor_id: 'compiler', effect: 'modify', path: 'src/room-event.mjs',
      symbol: 'compileRoomEvent', expected_at: 'current',
    }],
    failures: ['入力eventが不正', '出力artifactが非canonical'],
    first_live_e2e: '実eventを一件変換し同じidentityで公開する',
    non_goals: ['room transportを変更する'],
    ...overrides,
  };
}

function structureSet(overrides = {}) {
  const value = {
    schema: TODO_STRUCTURE_SET_SCHEMA,
    project_id: 'lattice',
    plan_key: 'structure-plan',
    plan_version: 'v1',
    topology_digest: DIGEST('a'),
    profile: 'code-dataflow',
    baseline_sha: SHA('b'),
    external_contracts: [],
    tasks: [
      { task_id: 'task-1', applicability: 'graph', planned: planned() },
      { task_id: 'task-2', applicability: 'excluded', excluded_reason: '文書校正だけを行うため' },
    ],
    structure_set_digest: '',
    ...overrides,
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

function realization(set, overrides = {}) {
  const task = set.tasks.find(({ task_id: id }) => id === 'task-1');
  const value = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: set.project_id,
    plan_key: set.plan_key,
    plan_version: set.plan_version,
    task_id: task.task_id,
    sequence: 1,
    previous_digest: null,
    structure_set_digest: set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(task.planned),
    head_sha: SHA('c'),
    commit_oids: [SHA('c')],
    realized: structuredClone(task.planned),
    supersedes: null,
    actor: ACTOR,
    recorded_at: '2026-08-11T14:00:00.000Z',
    realization_digest: '',
    ...overrides,
  };
  value.realization_digest = todoSelfDigest(value, 'realization_digest');
  return value;
}

function binding(set, overrides = {}) {
  const value = {
    schema: TODO_STRUCTURE_BINDING_SCHEMA,
    project_id: set.project_id,
    plan_key: set.plan_key,
    plan_version: set.plan_version,
    topology_digest: set.topology_digest,
    profile: set.profile,
    baseline_sha: set.baseline_sha,
    structure_set_digest: set.structure_set_digest,
    compiled_head_sha: SHA('c'),
    compile_artifact_digest: DIGEST('d'),
    activated_at: '2026-08-11T14:00:00.000Z',
    actor: ACTOR,
    binding_digest: '',
    ...overrides,
  };
  value.binding_digest = todoSelfDigest(value, 'binding_digest');
  return value;
}

test('structure setはexact key・self digest・canonical collectionを要求する', () => {
  assert.equal(validateTodoStructureSet(structureSet()), true);

  const extra = structureSet(); extra.unexpected = true;
  assert.deepEqual(explainTodoStructureSet(extra), {
    valid: false, code: TODO_STRUCTURE_CONTRACT_ERROR,
    reason: 'unexpected_or_missing_keys', path: '',
  });

  const tampered = structureSet(); tampered.plan_key = 'other-plan';
  assert.equal(explainTodoStructureSet(tampered).reason, 'structure_set_digest_mismatch');
  assert.equal(explainTodoStructureSet(tampered).path, '/structure_set_digest');

  const unsorted = structureSet();
  unsorted.tasks[0].planned.failures.reverse();
  unsorted.structure_set_digest = todoSelfDigest(unsorted, 'structure_set_digest');
  assert.equal(explainTodoStructureSet(unsorted).reason, 'unsorted_or_duplicate_collection');
  assert.equal(explainTodoStructureSet(unsorted).path, '/tasks/0/planned/failures');
});

test('malformed・過大・絶対path・task重複をpointer付きで拒否する', () => {
  const malformed = structureSet();
  malformed.tasks[0].planned.inputs[0].source.value = new Map();
  malformed.structure_set_digest = DIGEST('0');
  assert.equal(explainTodoStructureSet(malformed).reason, 'invalid_json_tree');

  const tooLarge = structureSet({
    tasks: Array.from({ length: 513 }, (_, index) => ({
      task_id: `task-${String(index).padStart(3, '0')}`,
      applicability: 'excluded', excluded_reason: 'fixture',
    })),
  });
  assert.equal(explainTodoStructureSet(tooLarge).reason, 'bounded_collection_violation');
  assert.equal(explainTodoStructureSet(tooLarge).path, '/tasks');

  const absolute = structureSet();
  absolute.tasks[0].planned.code_anchors[0].path = '/tmp/escape.mjs';
  absolute.structure_set_digest = todoSelfDigest(absolute, 'structure_set_digest');
  assert.equal(explainTodoStructureSet(absolute).reason, 'invalid_repo_relative_path');
  assert.equal(explainTodoStructureSet(absolute).path, '/tasks/0/planned/code_anchors/0/path');

  const duplicate = structureSet();
  duplicate.tasks[1].task_id = 'task-1';
  duplicate.structure_set_digest = todoSelfDigest(duplicate, 'structure_set_digest');
  assert.equal(explainTodoStructureSet(duplicate).reason, 'unsorted_or_duplicate_collection');
  assert.equal(explainTodoStructureSet(duplicate).path, '/tasks');
});

test('task別上限を足し合わせたplan全体のanchor総数もboundedにする', () => {
  const anchors = (prefix, count) => Array.from({ length: count }, (_, index) => ({
    anchor_id: `${prefix}-${String(index).padStart(3, '0')}`,
    effect: 'read', path: `src/${prefix}-${String(index).padStart(3, '0')}.mjs`,
    symbol: null, expected_at: 'current',
  }));
  const value = structureSet({
    tasks: [
      { task_id: 'task-1', applicability: 'graph', planned: planned({ code_anchors: anchors('a', 256) }) },
      { task_id: 'task-2', applicability: 'graph', planned: planned({ code_anchors: anchors('b', 256) }) },
      { task_id: 'task-3', applicability: 'graph', planned: planned({ code_anchors: anchors('c', 1) }) },
    ],
  });
  const explained = explainTodoStructureSet(value);
  assert.equal(explained.reason, 'bounded_total_collection_violation');
  assert.equal(explained.path, '/tasks');
  assert.deepEqual(explained.detail, { collection: 'anchors', limit: 512, actual: 513 });
});

test('graph／excludedの全task coverageをplan task集合とexact照合する', () => {
  const set = structureSet();
  assert.equal(validateTodoStructureSet(set, { expectedTaskIds: ['task-2', 'task-1'] }), true);

  const missing = explainTodoStructureSet(set, { expectedTaskIds: ['task-1', 'task-2', 'task-3'] });
  assert.equal(missing.reason, 'coverage_missing');
  assert.equal(missing.path, '/tasks');
  assert.deepEqual(missing.detail.task_ids, ['task-3']);

  const extra = explainTodoStructureSet(set, { expectedTaskIds: ['task-1'] });
  assert.equal(extra.reason, 'coverage_extra');
  assert.deepEqual(extra.detail.task_ids, ['task-2']);
});

test('port・operation・anchor・external参照はcontract内で参照完全にする', () => {
  const missingOutput = structureSet();
  missingOutput.tasks[0].planned.operations[0].output_port_ids = ['missing'];
  missingOutput.structure_set_digest = todoSelfDigest(missingOutput, 'structure_set_digest');
  assert.equal(explainTodoStructureSet(missingOutput).reason, 'output_port_reference_missing');
  assert.equal(explainTodoStructureSet(missingOutput).path, '/tasks/0/planned/operations/0/output_port_ids');

  const missingAnchor = structureSet();
  missingAnchor.tasks[0].planned.inputs[0].source = { kind: 'code', anchor_id: 'absent' };
  missingAnchor.structure_set_digest = todoSelfDigest(missingAnchor, 'structure_set_digest');
  assert.equal(explainTodoStructureSet(missingAnchor).reason, 'code_anchor_reference_missing');
  assert.equal(explainTodoStructureSet(missingAnchor).path, '/tasks/0/planned/inputs/0/source');

  const missingExternal = structureSet();
  missingExternal.tasks[0].planned.inputs[0].source = { kind: 'external', contract_id: 'room-api' };
  missingExternal.structure_set_digest = todoSelfDigest(missingExternal, 'structure_set_digest');
  assert.equal(explainTodoStructureSet(missingExternal).reason, 'external_contract_reference_missing');
});

test('realizationはplanned identity・commit・append-only chain・supersedesへ束縛する', () => {
  const set = structureSet();
  const first = realization(set);
  assert.equal(validateTodoStructureRealization(first, { structureSet: set }), true);

  const second = realization(set, {
    sequence: 2,
    previous_digest: first.realization_digest,
    supersedes: first.realization_digest,
    recorded_at: '2026-08-11T14:10:00.000Z',
  });
  assert.equal(validateTodoStructureRealization(second, {
    structureSet: set, previous: first, priorDigests: new Set([first.realization_digest]),
  }), true);

  const wrongPlanned = realization(set, { planned_digest: DIGEST('f') });
  assert.equal(explainTodoStructureRealization(wrongPlanned, { structureSet: set }).reason,
    'planned_digest_mismatch');
  assert.equal(explainTodoStructureRealization(wrongPlanned, { structureSet: set }).path,
    '/planned_digest');

  const brokenChain = realization(set, { sequence: 2, previous_digest: DIGEST('e') });
  assert.equal(explainTodoStructureRealization(brokenChain, { previous: first }).reason,
    'chain_previous_digest_mismatch');

  const absentSupersedes = realization(set, { supersedes: DIGEST('e') });
  assert.equal(explainTodoStructureRealization(absentSupersedes, {
    priorDigests: new Set([first.realization_digest]),
  }).reason, 'supersedes_target_missing');
});

test('realizationはunknown field・非canonical commit列・digest改竄を拒否する', () => {
  const set = structureSet();
  const extra = realization(set); extra.unexpected = true;
  assert.equal(explainTodoStructureRealization(extra).reason, 'unexpected_or_missing_keys');

  const commits = realization(set, { commit_oids: [SHA('d'), SHA('c')] });
  assert.equal(explainTodoStructureRealization(commits).reason, 'unsorted_or_duplicate_collection');
  assert.equal(explainTodoStructureRealization(commits).path, '/commit_oids');

  const tampered = realization(set); tampered.head_sha = SHA('d');
  assert.equal(explainTodoStructureRealization(tampered).reason, 'realization_digest_mismatch');
});

test('immutable activation bindingはplan・input・artifact・actorのexact identityを持つ', () => {
  const set = structureSet();
  assert.equal(validateTodoStructureBinding(binding(set)), true);

  const extra = binding(set); extra.unexpected = true;
  assert.equal(explainTodoStructureBinding(extra).reason, 'unexpected_or_missing_keys');

  const tampered = binding(set); tampered.compile_artifact_digest = DIGEST('e');
  assert.equal(explainTodoStructureBinding(tampered).reason, 'binding_digest_mismatch');
  assert.equal(explainTodoStructureBinding(tampered).path, '/binding_digest');

  const actor = binding(set, { actor: { host: 'MS-A2', session: 'codex-1', agent: '' } });
  assert.equal(explainTodoStructureBinding(actor).reason, 'invalid_actor');
  assert.equal(explainTodoStructureBinding(actor).path, '/actor');
});

test('配布JSON Schemaはruntime contract三面とpackage filesへ載る', async () => {
  const names = [
    'lattice.todo_structure_set.v1.schema.json',
    'lattice.todo_structure_realization.v1.schema.json',
    'lattice.todo_structure_binding.v1.schema.json',
  ];
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await readFile(
    new URL(`../docs/schemas/${name}`, import.meta.url), 'utf8',
  ))));
  assert.equal(schemas[0].properties.schema.const, TODO_STRUCTURE_SET_SCHEMA);
  assert.equal(schemas[0].$defs.transform.additionalProperties, false);
  assert.equal(schemas[1].properties.schema.const, TODO_STRUCTURE_REALIZATION_SCHEMA);
  assert.equal(schemas[1].properties.realized.$ref,
    'lattice.todo_structure_set.v1.schema.json#/$defs/transform');
  assert.equal(schemas[2].properties.schema.const, TODO_STRUCTURE_BINDING_SCHEMA);

  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of names) assert.equal(packageJson.files.includes(`docs/schemas/${name}`), true);
});

test('公開文書はopt-in・三値・realization gate・独立dashboard面を同時に案内する', async () => {
  const [english, japanese, contract] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../README.ja.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/00_product-contract.md', import.meta.url), 'utf8'),
  ]);
  for (const document of [english, japanese, contract]) {
    assert.match(document, /structure --schema --json/u);
    assert.match(document, /consistent.*inconsistent.*unknown/us);
    assert.match(document, /structure realize --plan <key> --task <id> --input/u);
    assert.match(document, /structure finalize --plan <key> --json/u);
  }
  assert.match(english, /separate \*\*Structure inspection\*\* pane/u);
  assert.match(japanese, /工程依存図とは別の面/u);
  assert.match(contract, /findingから問題node／edgeへ/u);
});
