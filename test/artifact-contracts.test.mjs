import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalizeArtifact,
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanDiff,
  validatePlanGraph,
  validatePlanInput,
} from '../src/artifact-contracts.mjs';

const sha = (character) => character.repeat(64);

function clone(value) {
  return structuredClone(value);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function boundaryManifest() {
  const fixturePath = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';

  return {
    schema: 'lattice.boundary_manifest.v1',
    plan_input_digest: sha('a'),
    source: {
      code_snapshot_digest: sha('b'),
      query_set_digest: sha('c'),
      manual_evidence_digest: sha('d'),
      codegraph_version: '1.4.1',
    },
    graph_evidence: [
      {
        id: 'status',
        operation: 'status',
        status: 'ready',
        result_digest: sha('e'),
      },
      {
        id: 'query-build-dispatch-record',
        operation: 'query',
        status: 'ready',
        result_digest: sha('f'),
      },
    ],
    manual_evidence: [
      {
        id: 'manual-channel-policy',
        todo_id: 'channel-policy',
        result_digest: sha('1'),
      },
      {
        id: 'manual-label-policy',
        todo_id: 'label-policy',
        result_digest: sha('2'),
      },
    ],
    todos: [
      {
        id: 'channel-policy',
        owns: [
          { kind: 'symbol', target: 'buildDispatchRecord' },
          { kind: 'path', target: fixturePath },
        ],
        reads: [],
        writes: [
          { kind: 'symbol', target: 'buildDispatchRecord' },
          { kind: 'path', target: fixturePath },
        ],
        hard_needs: [],
        conflict_ids: ['shared-dispatch-boundary'],
        unknowns: [],
        tests: ['test/research-dispatch-record.test.mjs'],
        evidence_refs: ['query-build-dispatch-record', 'manual-channel-policy'],
      },
      {
        id: 'label-policy',
        owns: [
          { kind: 'symbol', target: 'buildDispatchRecord' },
          { kind: 'path', target: fixturePath },
        ],
        reads: [],
        writes: [
          { kind: 'symbol', target: 'buildDispatchRecord' },
          { kind: 'path', target: fixturePath },
        ],
        hard_needs: [],
        conflict_ids: ['shared-dispatch-boundary'],
        unknowns: [],
        tests: ['test/research-dispatch-record.test.mjs'],
        evidence_refs: ['query-build-dispatch-record', 'manual-label-policy'],
      },
    ],
    conflicts: [
      {
        id: 'shared-dispatch-boundary',
        kind: 'write_boundary',
        todo_ids: ['channel-policy', 'label-policy'],
        resource: { kind: 'symbol', target: 'buildDispatchRecord' },
        evidence_refs: ['query-build-dispatch-record'],
      },
    ],
    unknowns: [],
  };
}

function boundaryVerdict() {
  return {
    schema: 'lattice.boundary_verdict.v1',
    boundary_manifest_digest: sha('1'),
    verdicts: [
      {
        id: 'channel-label-verdict',
        todo_ids: ['channel-policy', 'label-policy'],
        verdict: 'seam_candidate',
        conflict_ids: ['shared-dispatch-boundary'],
        seam_candidate: {
          id: 'extract-dispatch-policies',
          proposed_owns: [
            {
              todo_id: 'channel-policy',
              resources: [
                { kind: 'symbol', target: 'selectDispatchChannel' },
                {
                  kind: 'path',
                  target: 'research/fixtures/dispatch-record/src/dispatch-channel.mjs',
                },
              ],
            },
            {
              todo_id: 'label-policy',
              resources: [
                { kind: 'symbol', target: 'formatDispatchLabel' },
                {
                  kind: 'path',
                  target: 'research/fixtures/dispatch-record/src/dispatch-label.mjs',
                },
              ],
            },
          ],
          preconditions: ['characterization verifier is green'],
        },
        reasons: ['the shared write boundary can be split without a hard need'],
        unknowns: [],
      },
    ],
  };
}

function planGraph() {
  return {
    schema: 'lattice.plan_graph.v1',
    plan_version: 'rc1-control-v1',
    source_manifest_digest: sha('2'),
    capacity: { writers: 2 },
    nodes: [
      {
        id: 'channel-policy',
        outcome: 'routine priority maps to the batch dispatch channel',
        owned_boundaries: [{ kind: 'symbol', target: 'buildDispatchRecord' }],
      },
      {
        id: 'label-policy',
        outcome: 'dispatch labels use a slash separator',
        owned_boundaries: [{ kind: 'symbol', target: 'buildDispatchRecord' }],
      },
    ],
    edges: [
      {
        id: 'shared-dispatch-boundary',
        from: 'channel-policy',
        to: 'label-policy',
        kind: 'write_conflict',
        evidence_refs: ['shared-dispatch-boundary'],
      },
    ],
    joins: [],
    waves: [
      { index: 0, todo_ids: ['channel-policy'] },
      { index: 1, todo_ids: ['label-policy'] },
    ],
    minimum_feasible_waves: 2,
  };
}

function planDiff() {
  return {
    schema: 'lattice.plan_diff.v1',
    old_plan: { version: 'rc1-control-v1', digest: sha('3') },
    new_plan: { version: 'rc1-treatment-v2', digest: sha('4') },
    transform: {
      status: 'accepted',
      artifact_digest: sha('5'),
      patch_digest: sha('6'),
      verification_digest: sha('7'),
      changed_paths: [
        'research/fixtures/dispatch-record/src/dispatch-record.mjs',
        'research/fixtures/dispatch-record/src/dispatch-channel.mjs',
        'research/fixtures/dispatch-record/src/dispatch-label.mjs',
      ],
    },
    query_set_digest: sha('8'),
    snapshots: { before_digest: sha('9'), after_digest: sha('a') },
    nodes: { added: [], removed: [], changed: ['channel-policy', 'label-policy'] },
    edges: { added: [], removed: ['shared-dispatch-boundary'] },
    invalidated_contexts: [
      {
        kind: 'old_plan',
        ref: 'rc1-control-v1',
        reason: 'an accepted transform changed the owned boundary topology',
      },
      {
        kind: 'agent_context',
        ref: 'rc1-control-agent-context',
        reason: 'the old symbol ownership assumptions no longer apply',
      },
    ],
    metrics: {
      write_conflicts_before: 1,
      write_conflicts_after: 0,
      hard_precedence_before: 0,
      hard_precedence_after: 0,
      minimum_feasible_waves_before: 2,
      minimum_feasible_waves_after: 1,
    },
  };
}

test('canonical serialization is byte-stable and digest-bound', () => {
  const value = {
    z: 3,
    a: { second: true, first: '値' },
    list: [{ b: 2, a: 1 }, null, 1.25],
  };
  const expected = '{"a":{"first":"値","second":true},"list":[{"a":1,"b":2},null,1.25],"z":3}';

  assert.equal(canonicalizeArtifact(value), expected);
  assert.equal(canonicalizeArtifact({ list: value.list, a: value.a, z: value.z }), expected);
  assert.equal(expected.endsWith('\n'), false);
  assert.equal(
    digestArtifact(value),
    createHash('sha256').update(Buffer.from(expected, 'utf8')).digest('hex'),
  );
  assert.match(digestArtifact(value), /^[0-9a-f]{64}$/);
});

test('canonical serialization rejects non-JSON, unsafe, and oversized values', () => {
  const sparse = [];
  sparse[1] = 'value';
  const cyclic = {};
  cyclic.self = cyclic;
  const accessor = {};
  let getterCalls = 0;
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'must not run';
    },
  });

  for (const value of [
    undefined,
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -0,
    Object.create(null),
    new Date(0),
    sparse,
    cyclic,
    accessor,
    'x'.repeat(16_385),
    Array.from({ length: 257 }, () => null),
  ]) {
    assert.throws(() => canonicalizeArtifact(value), { name: 'TypeError' });
  }
  assert.equal(getterCalls, 0);
});

test('plan input accepts the fixed RC1 fixture and rejects drift', async () => {
  const input = await readJson('research/campaigns/rc1/inputs/plan-input.json');

  assert.equal(validatePlanInput(input), true);

  const unknown = clone(input);
  unknown.project.extra = true;
  assert.equal(validatePlanInput(unknown), false);

  const duplicate = clone(input);
  duplicate.todos[1].id = duplicate.todos[0].id;
  assert.equal(validatePlanInput(duplicate), false);

  const escape = clone(input);
  escape.manual_evidence_ref = '../manual-evidence.json';
  assert.equal(validatePlanInput(escape), false);

  const absolute = clone(input);
  absolute.todos[0].anchor.path = '/tmp/fixture.mjs';
  assert.equal(validatePlanInput(absolute), false);

  const backslash = clone(input);
  backslash.query_set_ref = 'research\\query-set.json';
  assert.equal(validatePlanInput(backslash), false);

  const oversized = clone(input);
  oversized.todos[0].outcome = 'x'.repeat(4_097);
  assert.equal(validatePlanInput(oversized), false);
});

test('boundary manifest and verdict enforce exact typed evidence', () => {
  const manifest = boundaryManifest();
  const verdict = boundaryVerdict();

  assert.equal(validateBoundaryManifest(manifest), true);
  assert.equal(validateBoundaryVerdict(verdict), true);

  const absentStatus = clone(manifest);
  absentStatus.graph_evidence[0].status = 'absent';
  assert.equal(validateBoundaryManifest(absentStatus), true);

  const impossibleStatus = clone(manifest);
  impossibleStatus.graph_evidence[0].status = 'symbol_absent';
  assert.equal(validateBoundaryManifest(impossibleStatus), false);

  const unknownField = clone(manifest);
  unknownField.todos[0].independent = true;
  assert.equal(validateBoundaryManifest(unknownField), false);

  const duplicateEvidence = clone(manifest);
  duplicateEvidence.graph_evidence.push(clone(duplicateEvidence.graph_evidence[0]));
  assert.equal(validateBoundaryManifest(duplicateEvidence), false);

  const missingManualEvidence = clone(manifest);
  missingManualEvidence.manual_evidence.pop();
  assert.equal(validateBoundaryManifest(missingManualEvidence), false);

  const collidingEvidenceId = clone(manifest);
  collidingEvidenceId.manual_evidence[0].id = collidingEvidenceId.graph_evidence[0].id;
  assert.equal(validateBoundaryManifest(collidingEvidenceId), false);

  const missingEvidence = clone(manifest);
  missingEvidence.todos[0].evidence_refs = ['not-recorded'];
  assert.equal(validateBoundaryManifest(missingEvidence), false);

  const disconnectedConflict = clone(manifest);
  disconnectedConflict.conflicts[0].resource.target = 'notOwnedByEitherTodo';
  assert.equal(validateBoundaryManifest(disconnectedConflict), false);

  const stateConflict = clone(manifest);
  for (const todo of stateConflict.todos) {
    todo.writes.push({ kind: 'state', target: 'dispatch-registry' });
    todo.conflict_ids.push('shared-state-dispatch-registry');
  }
  stateConflict.conflicts.push({
    id: 'shared-state-dispatch-registry',
    kind: 'state',
    todo_ids: ['channel-policy', 'label-policy'],
    resource: { kind: 'state', target: 'dispatch-registry' },
    evidence_refs: ['manual-channel-policy', 'manual-label-policy'],
  });
  assert.equal(validateBoundaryManifest(stateConflict), true);

  const falseManualProvenance = clone(stateConflict);
  falseManualProvenance.conflicts[1].evidence_refs = ['query-build-dispatch-record'];
  assert.equal(validateBoundaryManifest(falseManualProvenance), false);

  const unsafeTest = clone(manifest);
  unsafeTest.todos[0].tests = ['../outside.test.mjs'];
  assert.equal(validateBoundaryManifest(unsafeTest), false);

  const wrongDigest = clone(manifest);
  wrongDigest.plan_input_digest = 'not-a-digest';
  assert.equal(validateBoundaryManifest(wrongDigest), false);

  const missingSeam = clone(verdict);
  missingSeam.verdicts[0].seam_candidate = null;
  assert.equal(validateBoundaryVerdict(missingSeam), false);

  const falseSeam = clone(verdict);
  falseSeam.verdicts[0].verdict = 'parallel_ready';
  assert.equal(validateBoundaryVerdict(falseSeam), false);

  const conflictClaimedParallel = clone(verdict);
  conflictClaimedParallel.verdicts[0].verdict = 'parallel_ready';
  conflictClaimedParallel.verdicts[0].seam_candidate = null;
  assert.equal(validateBoundaryVerdict(conflictClaimedParallel), false);

  const overlappingSeam = clone(verdict);
  overlappingSeam.verdicts[0].seam_candidate.proposed_owns[1].resources = clone(
    overlappingSeam.verdicts[0].seam_candidate.proposed_owns[0].resources,
  );
  assert.equal(validateBoundaryVerdict(overlappingSeam), false);

  const duplicateTodo = clone(verdict);
  duplicateTodo.verdicts[0].todo_ids[1] = duplicateTodo.verdicts[0].todo_ids[0];
  assert.equal(validateBoundaryVerdict(duplicateTodo), false);
});

test('plan graph binds nodes, edges, waves, and capacity', () => {
  const graph = planGraph();

  assert.equal(validatePlanGraph(graph), true);

  const unknownNode = clone(graph);
  unknownNode.edges[0].to = 'missing-todo';
  assert.equal(validatePlanGraph(unknownNode), false);

  const duplicateNode = clone(graph);
  duplicateNode.nodes[1].id = duplicateNode.nodes[0].id;
  assert.equal(validatePlanGraph(duplicateNode), false);

  const duplicateWaveMember = clone(graph);
  duplicateWaveMember.waves[1].todo_ids = ['channel-policy'];
  assert.equal(validatePlanGraph(duplicateWaveMember), false);

  const wrongWaveCount = clone(graph);
  wrongWaveCount.minimum_feasible_waves = 1;
  assert.equal(validatePlanGraph(wrongWaveCount), false);

  const reversedDependency = clone(graph);
  reversedDependency.waves[0].todo_ids = ['label-policy'];
  reversedDependency.waves[1].todo_ids = ['channel-policy'];
  assert.equal(validatePlanGraph(reversedDependency), false);

  const unsourcedOverlap = clone(graph);
  unsourcedOverlap.edges = [];
  assert.equal(validatePlanGraph(unsourcedOverlap), false);

  const unknownField = clone(graph);
  unknownField.capacity.readers = 1;
  assert.equal(validatePlanGraph(unknownField), false);
});

test('plan diff binds accepted transform, invalidation, topology delta, and metrics', () => {
  const diff = planDiff();

  assert.equal(validatePlanDiff(diff), true);

  const unchangedVersion = clone(diff);
  unchangedVersion.new_plan.version = unchangedVersion.old_plan.version;
  assert.equal(validatePlanDiff(unchangedVersion), false);

  const rejectedTransform = clone(diff);
  rejectedTransform.transform.status = 'rejected';
  assert.equal(validatePlanDiff(rejectedTransform), false);

  const unsafePath = clone(diff);
  unsafePath.transform.changed_paths.push('../outside.mjs');
  assert.equal(validatePlanDiff(unsafePath), false);

  const duplicateInvalidation = clone(diff);
  duplicateInvalidation.invalidated_contexts.push(clone(diff.invalidated_contexts[0]));
  assert.equal(validatePlanDiff(duplicateInvalidation), false);

  const wrongOldPlanInvalidation = clone(diff);
  wrongOldPlanInvalidation.invalidated_contexts[0].ref = 'some-other-plan';
  assert.equal(validatePlanDiff(wrongOldPlanInvalidation), false);

  const unknownField = clone(diff);
  unknownField.metrics.speedup = 2;
  assert.equal(validatePlanDiff(unknownField), false);
});
