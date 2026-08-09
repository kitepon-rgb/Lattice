import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExecutorPackets,
  buildNextRunEvent,
  classifyCheckpointObservation,
  initializeRunEvents,
} from '../../src/runtime-engine.mjs';
import {
  compileRuntimePlanV1,
} from '../../src/runtime-front-end.mjs';
import {
  recomputeHoldDecision,
} from '../../src/runtime-decision-verifier.mjs';
import { detectCheckpointFindings } from '../../src/runtime-diff-observer.mjs';
import { compileTodoIndependence } from '../../src/todo-independence.mjs';
import { synthesizeWitnessRunRequest } from '../../src/todo-independence-contracts.mjs';
import { todoSelfDigest } from '../../src/todo-contracts.mjs';
import {
  selfDigest,
  validateRuntimeBoundaryManifest,
} from '../../src/runtime-contracts.mjs';

const BASE_SHA = 'c'.repeat(40);
const CHECKPOINT_DIGEST = 'd'.repeat(64);
const CONTENT_DIGEST = 'e'.repeat(64);
const AT = '2026-08-09T00:00:00.000Z';
const RUN_ID = 'run-line-resource-integration';
const LINE_ID = 'runtime-protocol--event-kind';
const ANCHOR = 'src/runtime-protocol.mjs';
const TODOS = [
  { id: 'PRODUCER', symbol: 'produceEvent', path: 'src/producer.mjs' },
  { id: 'CONSUMER', symbol: 'consumeEvent', path: 'src/consumer.mjs' },
];

function statusRaw() {
  return {
    operation: 'status',
    data: {
      initialized: true,
      version: '1.4.1',
      projectPath: '/tmp/line-resource',
      indexPath: '/tmp/line-resource/.lattice/sensor',
      lastIndexed: '2026-08-09T00:00:00.000Z',
      dbSizeBytes: 1,
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      worktreeMismatch: null,
      index: {
        builtWithVersion: '1.4.1',
        builtWithExtractionVersion: 24,
        currentExtractionVersion: 24,
        reindexRecommended: false,
        engineBehindIndexFiles: 0,
        state: 'complete',
        pendingRefs: 0,
      },
    },
  };
}

function symbolRaw(todo) {
  return {
    operation: 'query',
    data: [{ node: { name: todo.symbol, filePath: todo.path } }],
  };
}

function affectedRaw(todo) {
  return {
    operation: 'affected',
    data: {
      changedFiles: [todo.path],
      affectedTests: [],
      totalDependentsTraversed: 1,
    },
  };
}

function line(role, lineId = LINE_ID) {
  return {
    line_id: lineId,
    role,
    anchors: [{ kind: 'symbol', name: 'eventKind', path: ANCHOR }],
  };
}

function buildInput({ schema = 'lattice.run_request.v5', producerLine = null,
  consumerLine = null } = {}) {
  const queries = [{ id: 'q-status', operation: 'status' }];
  const outcomes = [{
    query_id: 'q-status', operation: 'status', status: 'ready', raw: statusRaw(),
  }];
  const manualWitness = {};
  for (const todo of TODOS) {
    const symbolQuery = `q-symbol-${todo.id}`;
    const affectedQuery = `q-affected-${todo.id}`;
    queries.push({ id: symbolQuery, operation: 'query', target: todo.symbol });
    queries.push({ id: affectedQuery, operation: 'affected', target: todo.path });
    outcomes.push({
      query_id: symbolQuery, operation: 'query', status: 'ready', raw: symbolRaw(todo),
    });
    outcomes.push({
      query_id: affectedQuery, operation: 'affected', status: 'ready', raw: affectedRaw(todo),
    });
    const declaredLine = todo.id === 'PRODUCER' ? producerLine : consumerLine;
    manualWitness[todo.id] = {
      owns: [
        { kind: 'symbol', target: todo.symbol },
        { kind: 'path', target: todo.path },
      ],
      reads: [],
      writes: [todo.path],
      resources: [],
      state_effects: [],
      sensor_provenance: { queries: [
        { query_id: symbolQuery, expect: { kind: 'symbol', name: todo.symbol, path: todo.path } },
        { query_id: affectedQuery, expect: { kind: 'affected', path: todo.path } },
      ] },
      affected_tests: [],
      unknowns: [],
      ...(declaredLine === null ? {} : { lines: [declaredLine] }),
    };
  }
  const request = {
    schema,
    request_id: `request-${schema.split('.').at(-1)}`,
    repo: { base_sha: BASE_SHA, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: TODOS.map(({ id }) => ({ todo_id: id })),
    manual_witness: manualWitness,
    sensor_query_set: { queries },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
    request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  return { request, sensorEvidence: { outcomes } };
}

function compile(input, suffix) {
  return compileRuntimePlanV1({
    request: input.request,
    sensorEvidence: input.sensorEvidence,
    planRef: `plan-line-${suffix}`,
    planEpoch: 1,
    predecessorRefs: [],
  });
}

function appendDispatches(events, packets) {
  for (const todoId of ['CONSUMER', 'PRODUCER']) {
    events.push(buildNextRunEvent({
      events,
      runId: RUN_ID,
      kind: 'executor_dispatched',
      planEpoch: 1,
      subject: { kind: 'todo', ref: todoId },
      payload: {
        executor_handle: `executor-${todoId.toLowerCase()}`,
        worktree_id: `worktree-${todoId.toLowerCase()}`,
        packet_digest: packets[todoId].packet_digest,
      },
      recordedAt: AT,
    }));
  }
}

test('線資源は計画時conflictと実行時findingの両経路でconsumerを直列化する', () => {
  // 摩擦1: pathは非交差。それでも同一line_idのwriter×readerは計画時に見つかる。
  const declared = buildInput({ producerLine: line('writes'), consumerLine: line('reads') });
  const planned = compile(declared, 'declared');
  assert.equal(planned.outcome, 'dispatchable');
  assert.equal(planned.resources.filter(({ kind }) => kind === 'line').length, 1);
  assert.equal(planned.plan.conflicts.length, 1);
  assert.deepEqual(planned.plan.conflicts[0].todo_ids, ['CONSUMER', 'PRODUCER']);
  assert.equal(planned.schedule.minimum_feasible_waves, 2);
  assert.deepEqual(planned.manifests.PRODUCER.writes, ['src/producer.mjs']);
  assert.deepEqual(planned.manifests.CONSUMER.writes, ['src/consumer.mjs']);

  // 摩擦2: producerの線宣言だけを外すと、path非交差の計画は1 waveになる。
  const runtimeOnly = buildInput({ consumerLine: line('reads') });
  const compiled = compile(runtimeOnly, 'runtime');
  assert.equal(compiled.outcome, 'dispatchable');
  assert.deepEqual(compiled.plan.conflicts, []);
  assert.equal(compiled.schedule.minimum_feasible_waves, 1);
  assert.equal(validateRuntimeBoundaryManifest(compiled.manifests.CONSUMER), true);

  // 摩擦3〜5: 実diffがconsumerの線anchorへ触れ、resource finding→freeze→consumer hold。
  const packets = buildExecutorPackets({ plan: compiled.plan, manifests: compiled.manifests });
  let events = initializeRunEvents({
    runId: RUN_ID,
    request: runtimeOnly.request,
    plan: compiled.plan,
    manifests: compiled.manifests,
    recordedAt: AT,
  });
  appendDispatches(events, packets);
  const checkpoint = {
    checkpoint_digest: CHECKPOINT_DIGEST,
    diff: {
      entries: [{ path: ANCHOR, change: 'modified', content_digest: CONTENT_DIGEST }],
    },
  };
  events.push(buildNextRunEvent({
    events,
    runId: RUN_ID,
    kind: 'checkpoint_observed',
    planEpoch: 1,
    subject: { kind: 'todo', ref: 'PRODUCER' },
    payload: checkpoint,
    recordedAt: AT,
  }));
  const classified = classifyCheckpointObservation({
    runId: RUN_ID,
    plan: compiled.plan,
    events,
    packets,
    manifests: compiled.manifests,
    todoId: 'PRODUCER',
    detect: detectCheckpointFindings,
    recordedAt: AT,
  });
  assert.deepEqual(classified.findings, [{
    kind: 'observed_line_change',
    todo_ids: ['CONSUMER', 'PRODUCER'],
    resource_id: LINE_ID,
  }]);
  assert.deepEqual(classified.observations, [{
    kind: 'prediction_excess', todo_ids: ['PRODUCER'], path: ANCHOR,
  }]);
  const held = recomputeHoldDecision({
    plan: compiled.plan,
    events: classified.events,
    manifests: compiled.manifests,
  });
  assert.deepEqual(held.hold_set, ['CONSUMER', 'PRODUCER']);
  assert.equal(held.reasons.CONSUMER, 'affected_closure');
});

test('linesを持たないwitness set v1〜v4は従来どおりcompileされる', () => {
  const legacy = buildInput();
  const expectedRunSchemas = new Map([
    ['lattice.todo_witness_set.v1', 'lattice.run_request.v3'],
    ['lattice.todo_witness_set.v2', 'lattice.run_request.v3'],
    ['lattice.todo_witness_set.v3', 'lattice.run_request.v3'],
    ['lattice.todo_witness_set.v4', 'lattice.run_request.v4'],
  ]);
  const plan = {
    project_id: 'line-resource',
    plan_key: 'legacy-witness',
    plan_version: 'v1',
    topology_digest: 'f'.repeat(64),
    tasks: TODOS.map(({ id }) => ({ task_id: id })),
  };

  for (const [schema, expectedRunSchema] of expectedRunSchemas) {
    const witnessSet = {
      schema,
      project_id: plan.project_id,
      plan_key: plan.plan_key,
      capacity: legacy.request.capacity,
      sensor_query_set: legacy.request.sensor_query_set,
      manual_witness: legacy.request.manual_witness,
      witness_set_digest: '',
    };
    witnessSet.witness_set_digest = todoSelfDigest(witnessSet, 'witness_set_digest');

    const synthesized = synthesizeWitnessRunRequest(witnessSet, {
      baseSha: BASE_SHA,
      requestId: `legacy-${schema.at(-1)}`,
    });
    assert.equal(synthesized.schema, expectedRunSchema);
    assert.deepEqual(synthesized.manual_witness, witnessSet.manual_witness);
    assert.equal(Object.hasOwn(synthesized.manual_witness.PRODUCER, 'lines'), false);
    assert.equal(Object.hasOwn(synthesized.manual_witness.CONSUMER, 'lines'), false);

    const artifact = compileTodoIndependence({
      witnessSet,
      plan,
      baseSha: BASE_SHA,
      compiledAt: AT,
      sensorEvidence: legacy.sensorEvidence,
    });
    assert.equal(artifact.outcome, 'compiled');
    assert.deepEqual(artifact.conflicts, []);
    assert.equal(artifact.wave_plan.minimum_feasible_waves, 1);
  }
});
