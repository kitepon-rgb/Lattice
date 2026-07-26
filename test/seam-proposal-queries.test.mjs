import assert from 'node:assert/strict';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import {
  deriveSeamProposalId,
  SEAM_PROPOSAL_SCHEMA,
  validateSeamProposal,
} from '../src/seam-proposal-contracts.mjs';
import {
  buildSeamProposalQuerySet,
  collectSeamProposalEvidenceBundle,
  normalizeSeamProposalEvidence,
  SeamProposalQueryError,
} from '../src/seam-proposal-queries.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

const DIGEST = (character) => character.repeat(64);
const BASE_SHA = 'a'.repeat(40);

function exactNode(target, filePath = 'src/seam-proposal-queries.mjs') {
  return { node: { name: target, qualifiedName: target, filePath } };
}

function collectedFor(querySet, outcomeFor) {
  return {
    cwd: '/repo',
    outcomes: querySet.queries.map((query) => outcomeFor(query)),
  };
}

function readyOutcomes(querySet, {
  symbolPath = 'src/seam-proposal-queries.mjs',
  affectedTests = ['test/seam-proposal-queries.test.mjs'],
} = {}) {
  return collectedFor(querySet, (query) => {
    if (query.operation === 'status') {
      return {
        id: query.id,
        operation: query.operation,
        outcome: 'ready',
        data: { version: 'test', pendingChanges: { added: 0, modified: 0, removed: 0 } },
      };
    }
    if (query.operation === 'affected') {
      return {
        id: query.id,
        operation: query.operation,
        outcome: affectedTests.length === 0 ? 'empty' : 'ready',
        targets: [{
          target: query.target,
          outcome: affectedTests.length === 0 ? 'empty' : 'ready',
          data: { affectedTests },
        }],
      };
    }
    const resolution = [exactNode(query.target, symbolPath)];
    return {
      id: query.id,
      operation: query.operation,
      outcome: 'ready',
      ...(query.operation === 'query'
        ? { data: resolution }
        : { data: [], resolution }),
    };
  });
}

function sealArtifact(evidence) {
  const conflicts = [{
    resource_id: 'symbol-shared',
    kind: 'symbol',
    target: 'buildSeamProposalQuerySet',
    task_pairs: [['tip-001', 'tip-002']],
  }];
  const proposedSurfaces = [
    {
      kind: 'symbol',
      target: 'partAlpha',
      path: 'src/alpha.mjs',
      role: 'task_owned',
      owner_task_ids: ['tip-001'],
    },
    {
      kind: 'symbol',
      target: 'partBeta',
      path: 'src/beta.mjs',
      role: 'task_owned',
      owner_task_ids: ['tip-002'],
    },
  ];
  const candidate = {
    proposal_id: deriveSeamProposalId({
      conflicts,
      proposed_surfaces: proposedSurfaces,
    }),
    current_surfaces: [{
      kind: 'symbol',
      target: 'buildSeamProposalQuerySet',
      path: 'src/seam-proposal-queries.mjs',
      role: 'shared_symbol',
      owner_task_ids: ['tip-001', 'tip-002'],
    }],
    proposed_surfaces: proposedSurfaces,
    affected_tests: [],
    verification: {
      virtual_compile_input_digest: DIGEST('b'),
      virtual_compile_result_digest: DIGEST('c'),
      residual_conflicts: [],
    },
    evidence,
    limits: ['structural_only'],
    proposal_digest: '',
  };
  candidate.proposal_digest = todoSelfDigest(candidate, 'proposal_digest');
  const artifact = {
    schema: SEAM_PROPOSAL_SCHEMA,
    project_id: 'lattice',
    plan_key: 'seam-proposal',
    source_binding: {
      independence_schema: 'lattice.todo_independence.v3',
      independence_result_digest: DIGEST('d'),
      witness_set_digest: DIGEST('e'),
      plan_version: 'v1',
      topology_digest: DIGEST('f'),
      base_sha: BASE_SHA,
    },
    compiled_at: '2026-07-26T00:00:00.000Z',
    decisions: [{
      component_id: 'component-001',
      task_ids: ['tip-001', 'tip-002'],
      conflicts,
      verdict: 'seam_candidate',
      seam_candidate: candidate,
      reasons: [],
      unknowns: [],
    }],
    result_digest: '',
  };
  artifact.result_digest = todoSelfDigest(artifact, 'result_digest');
  return artifact;
}

test('conflict resource集合からrun_request query setを決定的に構成する', () => {
  const resources = [
    { resource_id: 'state-z', kind: 'state', target: 'registry' },
    { resource_id: 'path-a', kind: 'path', target: 'src/shared.mjs' },
    { resource_id: 'effect-a', kind: 'effect', target: 'network-send' },
    { resource_id: 'symbol-a', kind: 'symbol', target: 'selectAll' },
  ];
  const forward = buildSeamProposalQuerySet({ conflictResources: resources });
  const reverse = buildSeamProposalQuerySet({ conflictResources: [...resources].reverse() });

  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
  assert.deepEqual(Object.keys(forward.query_set), ['queries']);
  assert.equal('schema' in forward.query_set, false);
  assert.deepEqual(
    forward.query_set.queries.map(({ operation }) => operation).sort(),
    ['affected', 'callees', 'callers', 'impact', 'query', 'status'],
  );
  assert.deepEqual(
    forward.query_set.queries.filter(({ target }) => target === 'selectAll')
      .map(({ operation }) => operation).sort(),
    ['callees', 'callers', 'impact', 'query'],
  );
  assert.deepEqual(
    forward.query_set.queries.filter(({ target }) => target === 'src/shared.mjs')
      .map(({ operation }) => operation),
    ['affected'],
  );
  assert.deepEqual(forward.excluded_resources, [
    {
      resource_id: 'effect-a',
      kind: 'effect',
      target: 'network-send',
      reason: 'non_code_conflict',
    },
    {
      resource_id: 'state-z',
      kind: 'state',
      target: 'registry',
      reason: 'non_code_conflict',
    },
  ]);
  assert.equal(
    forward.query_set.queries.some(({ target }) => ['network-send', 'registry'].includes(target)),
    false,
  );
  const ids = forward.query_set.queries.map(({ id }) => id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test('exact symbol/path evidenceを正規化しquery set bindingと自己digestを分離する', () => {
  const { query_set: querySet } = buildSeamProposalQuerySet({ conflictResources: [
    {
      resource_id: 'symbol-shared',
      kind: 'symbol',
      target: 'buildSeamProposalQuerySet',
    },
    {
      resource_id: 'path-shared',
      kind: 'path',
      target: 'src/seam-proposal-queries.mjs',
    },
  ] });
  const evidence = normalizeSeamProposalEvidence({
    querySet,
    collected: readyOutcomes(querySet),
  });

  assert.equal(evidence.query_set_digest, digestArtifact(querySet));
  assert.equal(
    evidence.evidence_digest,
    todoSelfDigest(evidence, 'evidence_digest'),
  );
  assert.deepEqual(
    evidence.queries.map(({ query_id: queryId }) => queryId),
    [...evidence.queries.map(({ query_id: queryId }) => queryId)].sort(),
  );
  for (const query of evidence.queries.filter(({ operation }) => (
    ['query', 'callers', 'callees', 'impact'].includes(operation)
  ))) {
    assert.equal(query.outcome, 'resolved');
    assert.equal(query.resolved_name, 'buildSeamProposalQuerySet');
    assert.equal(query.resolved_path, 'src/seam-proposal-queries.mjs');
  }
  const affected = evidence.queries.find(({ operation }) => operation === 'affected');
  assert.equal(affected.outcome, 'resolved');
  assert.equal(affected.resolved_name, null);
  assert.equal(affected.resolved_path, 'src/seam-proposal-queries.mjs');
  assert.equal(validateSeamProposal(sealArtifact(evidence)), true);
});

test('fuzzy symbol解決をresolved evidenceへ採用しない', () => {
  const target = 'buildSeamProposalQuerySet';
  const { query_set: querySet } = buildSeamProposalQuerySet({ conflictResources: [{
    resource_id: 'symbol-shared',
    kind: 'symbol',
    target,
  }] });
  const fuzzy = exactNode('buildSeamProposalQueries');
  const collected = collectedFor(querySet, (query) => {
    if (query.operation === 'status') {
      return { id: query.id, operation: query.operation, outcome: 'ready', data: {} };
    }
    return {
      id: query.id,
      operation: query.operation,
      outcome: 'ready',
      ...(query.operation === 'query'
        ? { data: [fuzzy] }
        : { data: [], resolution: [fuzzy] }),
    };
  });
  const evidence = normalizeSeamProposalEvidence({ querySet, collected });
  const symbolQueries = evidence.queries.filter(({ operation }) => operation !== 'status');

  assert.equal(symbolQueries.every(({ outcome }) => outcome === 'absent'), true);
  assert.equal(symbolQueries.every(({ resolved_name: name }) => name === null), true);
  assert.equal(symbolQueries.every(({ resolved_path: path }) => path === null), true);
});

test('同名symbolの複数path解決とcross-operation path不一致をunknownにする', () => {
  const target = 'selectAll';
  const { query_set: querySet } = buildSeamProposalQuerySet({ conflictResources: [{
    resource_id: 'symbol-shared',
    kind: 'symbol',
    target,
  }] });
  const collected = collectedFor(querySet, (query) => {
    if (query.operation === 'status') {
      return { id: query.id, operation: query.operation, outcome: 'ready', data: {} };
    }
    if (query.operation === 'query') {
      return {
        id: query.id,
        operation: query.operation,
        outcome: 'ready',
        data: [exactNode(target, 'src/a.mjs')],
      };
    }
    return {
      id: query.id,
      operation: query.operation,
      outcome: 'ready',
      data: [],
      resolution: [exactNode(target, 'src/b.mjs')],
    };
  });
  const evidence = normalizeSeamProposalEvidence({ querySet, collected });

  assert.equal(evidence.queries.find(({ operation }) => operation === 'query').outcome, 'resolved');
  assert.equal(
    evidence.queries.filter(({ operation }) => !['status', 'query'].includes(operation))
      .every(({ outcome, resolved_path: path }) => outcome === 'unknown' && path === null),
    true,
  );
});

test('stale statusとsensor command failureをtyped failにする', () => {
  const { query_set: querySet } = buildSeamProposalQuerySet({ conflictResources: [{
    resource_id: 'symbol-shared',
    kind: 'symbol',
    target: 'selectAll',
  }] });
  const stale = readyOutcomes(querySet);
  stale.outcomes.find(({ operation }) => operation === 'status').outcome = 'stale';
  assert.throws(
    () => normalizeSeamProposalEvidence({ querySet, collected: stale }),
    (error) => error instanceof SeamProposalQueryError
      && error.code === 'SEAM_SENSOR_QUERY_FAILED',
  );

  const failure = readyOutcomes(querySet);
  failure.outcomes.find(({ operation }) => operation === 'impact').outcome = 'command_failure';
  assert.throws(
    () => normalizeSeamProposalEvidence({ querySet, collected: failure }),
    (error) => error instanceof SeamProposalQueryError
      && error.code === 'SEAM_SENSOR_QUERY_FAILED',
  );
});

test('collectorはcollectSensorEvidence経路を使いfixture executorを注入できる', async () => {
  const target = 'buildSeamProposalQuerySet';
  const { query_set: querySet } = buildSeamProposalQuerySet({ conflictResources: [{
    resource_id: 'symbol-shared',
    kind: 'symbol',
    target,
  }] });
  const executed = [];
  const execute = async ({ operation, target: commandTarget }) => {
    executed.push(`${operation}:${commandTarget ?? ''}`);
    if (operation === 'status') {
      return {
        code: 0,
        stdout: JSON.stringify({
          initialized: true,
          version: 'test',
          pendingChanges: { added: 0, modified: 0, removed: 0 },
          worktreeMismatch: null,
          index: {
            builtWithVersion: 'test',
            builtWithExtractionVersion: 1,
            currentExtractionVersion: 1,
            reindexRecommended: false,
            state: 'complete',
            pendingRefs: 0,
          },
        }),
        stderr: '',
      };
    }
    if (operation === 'query') {
      return {
        code: 0,
        stdout: JSON.stringify([exactNode(target)]),
        stderr: '',
      };
    }
    return { code: 0, stdout: '[]', stderr: '' };
  };
  const bundle = await collectSeamProposalEvidenceBundle({
    cwd: '/repo',
    querySet,
    execute,
  });
  const evidence = bundle.evidence;

  assert.equal(evidence.queries.every(({ outcome }) => outcome === 'resolved'), true);
  assert.deepEqual(Object.keys(evidence).sort(), [
    'evidence_digest',
    'queries',
    'query_set_digest',
  ]);
  assert.equal(bundle.raw_collected.outcomes.length, querySet.queries.length);
  assert.ok(bundle.raw_collected.outcomes.some(({ operation }) => operation === 'callees'));
  assert.equal(bundle.raw_collected.graph_closure.complete, true);
  assert.deepEqual(bundle.raw_collected.graph_closure.expansions, []);
  assert.equal(executed.filter((entry) => entry === `query:${target}`).length, 4);
  assert.equal(executed.includes('status:'), true);
});
