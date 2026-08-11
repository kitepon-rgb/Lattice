import assert from 'node:assert/strict';
import test from 'node:test';

import { todoSelfDigest } from '../src/todo-contracts.mjs';
import { TODO_STRUCTURE_SET_SCHEMA } from '../src/todo-structure-contracts.mjs';
import { portableSensorOutcome } from '../src/sensor-adapter.mjs';
import {
  TODO_STRUCTURE_SOURCE_LIMITS,
  buildTodoStructureSensorQuerySet,
  collectTodoStructureSourceEvidence,
  projectTodoStructureSourceEvidence,
  todoStructurePortableEvidenceDigest,
} from '../src/todo-structure-source-adapter.mjs';

const DIGEST = (character) => character.repeat(64);
const SHA = (character) => character.repeat(40);

function contract() {
  return {
    shape_id: 'room-event',
    schema_ref: null,
    identity_fields: ['event_id'],
    lifecycle: 'event',
    cardinality: 'one',
    compatible_shape_ids: [],
  };
}

function transform(codeAnchors) {
  return {
    outcome: 'room eventを変換する',
    inputs: [{
      port_id: 'event-in',
      source: { kind: 'constant', constant_id: 'fixture-event', value: { event_id: 'evt-1' } },
      access: 'consume', contract: contract(),
    }],
    operations: [{
      operation_id: 'compile-event', input_port_ids: ['event-in'],
      output_port_ids: ['event-out'], summary: 'eventを変換する',
    }],
    outputs: [{
      port_id: 'event-out', data_id: 'compiled-event', contract: contract(),
      sinks: [{ kind: 'final_product', product_id: 'room-event-artifact' }],
    }],
    code_anchors: codeAnchors,
    failures: ['変換失敗'],
    first_live_e2e: '実eventを一件変換する',
    non_goals: ['transport変更'],
  };
}

function structureSet(anchors) {
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
      { task_id: 'task-1', applicability: 'graph', planned: transform(anchors) },
      { task_id: 'task-2', applicability: 'excluded', excluded_reason: '文書だけを変更する' },
    ],
    structure_set_digest: '',
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

function anchor(overrides = {}) {
  return {
    anchor_id: 'compiler', effect: 'modify', path: 'src/room-event.mjs',
    symbol: 'compileRoomEvent', expected_at: 'current', ...overrides,
  };
}

function readyStatus(id = 'structure-status') {
  return {
    id, operation: 'status', outcome: 'ready',
    data: {
      initialized: true, version: '1.4.1', projectPath: '/repo',
      indexPath: '/repo/.lattice/sensor', lastIndexed: '2026-08-11T00:00:00.000Z',
      dbSizeBytes: 1024, fileCount: 4,
    },
  };
}

function node(overrides = {}) {
  return {
    name: 'compileRoomEvent', qualifiedName: 'compileRoomEvent', kind: 'function',
    filePath: 'src/room-event.mjs', startLine: 10, endLine: 20, updatedAt: 99,
    ...overrides,
  };
}

function edge(name, overrides = {}) {
  return {
    name, kind: 'function', filePath: 'src/caller.mjs', startLine: 1,
    edgeKind: 'calls', valueRef: false, valueWrite: false, ...overrides,
  };
}

function collectedFor(set, overrides = {}) {
  const querySet = buildTodoStructureSensorQuerySet(set);
  const outcomes = querySet.queries.map((query) => {
    if (query.operation === 'status') return readyStatus(query.id);
    if (query.operation === 'affected') {
      return {
        id: query.id, operation: query.operation, outcome: 'empty',
        targets: [{
          target: query.target, outcome: 'empty',
          data: { changedFiles: [query.target], affectedTests: [], totalDependentsTraversed: 0 },
        }],
      };
    }
    if (query.operation === 'query') {
      return {
        id: query.id, operation: query.operation, target: query.target,
        outcome: 'ready', data: [{ node: node() }],
      };
    }
    const direction = query.operation === 'callers' ? 'callers' : 'callees';
    return {
      id: query.id, operation: query.operation, target: query.target, outcome: 'ready',
      data: {
        symbol: query.target, exactPath: query.exact_path, exactResolution: 'ready',
        [direction]: [edge(`${direction}-one`)],
      },
      resolution: [{ node: node() }],
    };
  });
  for (const [operation, replacement] of Object.entries(overrides)) {
    const index = querySet.queries.findIndex((query) => query.operation === operation);
    assert.notEqual(index, -1);
    outcomes[index] = typeof replacement === 'function'
      ? replacement(outcomes[index], querySet.queries[index]) : replacement;
  }
  return { cwd: '/repo', outcomes };
}

test('anchorを既存status／affected／exact query／traversalへ決定的に変換する', () => {
  const set = structureSet([
    anchor(),
    anchor({ anchor_id: 'path-only', effect: 'read', symbol: null }),
  ]);
  const first = buildTodoStructureSensorQuerySet(set);
  const second = buildTodoStructureSensorQuerySet(structuredClone(set));
  assert.deepEqual(first, second);
  assert.deepEqual(first.queries.map(({ operation }) => operation), [
    'status', 'affected', 'query', 'callers', 'callees',
  ]);
  assert.equal(first.queries.filter(({ operation }) => operation === 'affected').length, 1);
});

test('exact symbolと自然キーedgeだけを投影しportable evidence identityを共有する', () => {
  const set = structureSet([anchor()]);
  const collected = collectedFor(set);
  const projection = projectTodoStructureSourceEvidence({ structureSet: set, collected });
  const result = projection.anchors[0];

  assert.equal(result.verdict, 'consistent');
  assert.equal(result.coverage, 'exact_symbol');
  assert.deepEqual(result.node, {
    kind: 'function', path: 'src/room-event.mjs', name: 'compileRoomEvent',
    qualified_name: 'compileRoomEvent', start_line: 10, end_line: 20,
  });
  assert.equal('updatedAt' in result.node, false);
  assert.equal(result.edges.incoming[0].name, 'callers-one');
  assert.equal(result.edges.outgoing[0].name, 'callees-one');
  assert.equal(projection.summary.excluded_tasks, 1);
  assert.equal(projection.summary.omitted_anchors, 0);

  const querySet = buildTodoStructureSensorQuerySet(set);
  const symbolIndex = querySet.queries.findIndex(({ operation }) => operation === 'query');
  const query = querySet.queries[symbolIndex];
  const outcome = collected.outcomes[symbolIndex];
  assert.equal(result.evidence.symbol.portable_digest,
    todoStructurePortableEvidenceDigest(query, outcome));
  assert.equal(result.evidence.symbol.portable_digest, todoSelfDigest({
    query_id: query.id,
    operation: query.operation,
    status: outcome.outcome,
    portable: portableSensorOutcome(outcome),
    portable_digest: '',
  }, 'portable_digest'));
});

test('fuzzy不在・複数候補・宣言path外のexact候補を検証済みにしない', () => {
  const set = structureSet([anchor()]);
  const fuzzy = collectedFor(set, {
    query: (outcome) => ({ ...outcome, outcome: 'symbol_absent', data: [] }),
    callers: (outcome) => ({
      id: outcome.id, operation: outcome.operation, target: outcome.target,
      outcome: 'symbol_absent',
    }),
    callees: (outcome) => ({
      id: outcome.id, operation: outcome.operation, target: outcome.target, outcome: 'symbol_absent',
    }),
  });
  const absent = projectTodoStructureSourceEvidence({ structureSet: set, collected: fuzzy }).anchors[0];
  assert.equal(absent.verdict, 'inconsistent');
  assert.equal(absent.reason, 'STRUCTURE_CODE_ANCHOR_ABSENT');
  assert.equal(absent.coverage, 'observed_absence');

  const ambiguous = collectedFor(set, {
    query: (outcome) => ({ ...outcome, data: [{ node: node() }, { node: node({ startLine: 30 }) }] }),
  });
  const ambiguousAnchor = projectTodoStructureSourceEvidence({
    structureSet: set, collected: ambiguous,
  }).anchors[0];
  assert.equal(ambiguousAnchor.verdict, 'unknown');
  assert.equal(ambiguousAnchor.reason, 'STRUCTURE_CODE_ANCHOR_AMBIGUOUS');

  const elsewhere = collectedFor(set, {
    query: (outcome) => ({ ...outcome, data: [{ node: node({ filePath: 'src/other.mjs' }) }] }),
  });
  const elsewhereAnchor = projectTodoStructureSourceEvidence({
    structureSet: set, collected: elsewhere,
  }).anchors[0];
  assert.equal(elsewhereAnchor.verdict, 'inconsistent');
  assert.equal(elsewhereAnchor.reason, 'STRUCTURE_CODE_ANCHOR_ABSENT');
});

test('path-onlyとcreate不在を区別し、baseline／after_taskは後段へ保留する', () => {
  const currentCreate = structureSet([anchor({ effect: 'create', symbol: null })]);
  const absent = collectedFor(currentCreate, {
    affected: (outcome) => ({
      ...outcome,
      targets: [{
        ...outcome.targets[0], path_state: 'absent',
      }],
    }),
  });
  const created = projectTodoStructureSourceEvidence({
    structureSet: currentCreate, collected: absent,
  }).anchors[0];
  assert.equal(created.verdict, 'consistent');
  assert.equal(created.coverage, 'expected_absence');
  assert.equal(created.edges.state, 'not_applicable');

  const currentRead = structureSet([anchor({ effect: 'read', symbol: null })]);
  const missingRead = projectTodoStructureSourceEvidence({
    structureSet: currentRead, collected: collectedFor(currentRead, {
      affected: (outcome) => ({ ...outcome, targets: [{ ...outcome.targets[0], path_state: 'absent' }] }),
    }),
  }).anchors[0];
  assert.equal(missingRead.verdict, 'inconsistent');
  assert.equal(missingRead.coverage, 'observed_absence');

  for (const expectedAt of ['baseline', 'after_task']) {
    const deferred = structureSet([anchor({ expected_at: expectedAt })]);
    const result = projectTodoStructureSourceEvidence({
      structureSet: deferred, collected: collectedFor(deferred),
    }).anchors[0];
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.reason, 'STRUCTURE_CODE_ANCHOR_TIME_DEFERRED');
  }
});

test('sensor非readyとedge欠損をunknownにし、edge上限とomitted件数を保持する', () => {
  const set = structureSet([anchor()]);
  for (const outcome of ['absent', 'stale', 'unsupported', 'unresolved']) {
    const unavailable = collectedFor(set, {
      status: (status) => ({ ...status, outcome }),
    });
    const result = projectTodoStructureSourceEvidence({
      structureSet: set, collected: unavailable,
    }).anchors[0];
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.reason, 'STRUCTURE_SENSOR_NOT_READY');
  }

  const edgeFailure = collectedFor(set, {
    callers: (outcome) => ({ ...outcome, outcome: 'command_failure', exitCode: 2 }),
  });
  const unresolved = projectTodoStructureSourceEvidence({
    structureSet: set, collected: edgeFailure,
  }).anchors[0];
  assert.equal(unresolved.verdict, 'unknown');
  assert.equal(unresolved.edges.state, 'unknown');

  const observed = TODO_STRUCTURE_SOURCE_LIMITS.sensorTraversalLimit;
  const bounded = collectedFor(set, {
    callers: (outcome) => ({
      ...outcome,
      data: {
        ...outcome.data,
        callers: Array.from({ length: observed }, (_, index) => (
          edge(`caller-${String(index).padStart(3, '0')}`)
        )),
      },
    }),
  });
  const projection = projectTodoStructureSourceEvidence({ structureSet: set, collected: bounded });
  assert.equal(projection.anchors[0].edges.incoming.length,
    TODO_STRUCTURE_SOURCE_LIMITS.edgesPerDirection);
  assert.equal(projection.anchors[0].edges.incoming_omitted,
    observed - TODO_STRUCTURE_SOURCE_LIMITS.edgesPerDirection);
  assert.equal(projection.anchors[0].edges.incoming_source_limit_reached, true);
  assert.equal(projection.summary.incoming_edges_omitted,
    observed - TODO_STRUCTURE_SOURCE_LIMITS.edgesPerDirection);
});

test('実収集入口もcollectSensorEvidenceのquery契約をそのまま使う', async () => {
  const set = structureSet([anchor({ symbol: null })]);
  const commands = [];
  const result = await collectTodoStructureSourceEvidence({
    cwd: '/repo',
    structureSet: set,
    inspectAffectedPath: async () => 'file',
    execute: async (command) => {
      commands.push(command);
      if (command.operation === 'status') {
        return {
          code: 0, stderr: '', stdout: JSON.stringify({
            initialized: true, version: '1.4.1',
            pendingChanges: { added: 0, modified: 0, removed: 0 },
            worktreeMismatch: null,
            index: {
              builtWithVersion: '1.4.1', builtWithExtractionVersion: 7,
              currentExtractionVersion: 7, reindexRecommended: false,
              engineBehindIndexFiles: 0, state: 'complete', pendingRefs: 0,
            },
          }),
        };
      }
      return {
        code: 0, stderr: '', stdout: JSON.stringify({
          changedFiles: [command.target], affectedTests: [], totalDependentsTraversed: 0,
        }),
      };
    },
  });
  assert.deepEqual(commands.map(({ operation }) => operation), ['status', 'affected']);
  assert.deepEqual(result.query_set, buildTodoStructureSensorQuerySet(set));
  assert.equal(result.projection.anchors[0].verdict, 'consistent');
});
