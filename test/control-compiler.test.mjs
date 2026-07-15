import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
} from '../src/artifact-contracts.mjs';
import { compileControlArtifacts } from '../src/control-compiler.mjs';

const sha = (character) => character.repeat(64);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function graphEvidence(querySet) {
  return {
    cwd: '/repo',
    outcomes: querySet.queries.map((query) => {
      if (query.operation === 'status') {
        return {
          id: query.id,
          operation: query.operation,
          outcome: 'ready',
          data: { version: '1.4.1' },
        };
      }
      if (query.operation === 'affected') {
        return {
          id: query.id,
          operation: query.operation,
          outcome: 'unresolved',
          targets: query.targets.map((target, index) => ({
            target,
            outcome: index === 0 ? 'ready' : 'empty',
            data: {
              changedFiles: [target],
              affectedTests: index === 0 ? ['test/research-dispatch-record.test.mjs'] : [],
              totalDependentsTraversed: index === 0 ? 1 : 0,
            },
          })),
        };
      }
      const proposedSurface = query.target === 'selectDispatchChannel'
        || query.target === 'formatDispatchLabel';
      return {
        id: query.id,
        operation: query.operation,
        target: query.target,
        outcome: proposedSurface ? 'symbol_absent' : 'ready',
        ...(query.operation === 'query' ? { data: proposedSurface ? [] : [{ node: { name: query.target } }] } : {}),
      };
    }),
  };
}

async function inputs() {
  const [planInput, manualNormal, manualNegative, querySet] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson('research/campaigns/rc1/inputs/query-set.json'),
  ]);
  return {
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    codegraphEvidence: graphEvidence(querySet),
    codeSnapshotDigest: sha('c'),
  };
}

test('normal control compiles one write conflict, seam candidate, and two waves deterministically', async () => {
  const value = await inputs();
  const options = {
    planInput: value.planInput,
    manualEvidence: value.manualNormal,
    querySet: value.querySet,
    codegraphEvidence: value.codegraphEvidence,
    codeSnapshotDigest: value.codeSnapshotDigest,
  };
  const before = structuredClone(options);
  const first = compileControlArtifacts(options);
  const second = compileControlArtifacts(structuredClone(options));

  assert.deepEqual(options, before);
  assert.deepEqual(first, second);
  assert.equal(validateBoundaryManifest(first.boundary_manifest), true);
  assert.equal(validateBoundaryVerdict(first.boundary_verdict), true);
  assert.equal(validatePlanGraph(first.plan_graph), true);
  assert.equal(first.boundary_manifest_digest, digestArtifact(first.boundary_manifest));
  assert.equal(first.boundary_verdict_digest, digestArtifact(first.boundary_verdict));
  assert.equal(first.plan_graph_digest, digestArtifact(first.plan_graph));

  assert.equal(first.boundary_manifest.manual_evidence.length, 2);
  assert.deepEqual(first.boundary_manifest.conflicts.map(({ kind }) => kind), ['write_boundary']);
  assert.equal(first.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
  assert.deepEqual(
    first.boundary_verdict.verdicts[0].seam_candidate.proposed_owns
      .map(({ resources }) => resources.map(({ target }) => target)),
    [
      ['selectDispatchChannel', 'research/fixtures/dispatch-record/src/dispatch-channel.mjs'],
      ['formatDispatchLabel', 'research/fixtures/dispatch-record/src/dispatch-label.mjs'],
    ],
  );
  assert.deepEqual(first.plan_graph.edges.map(({ kind }) => kind), ['write_conflict']);
  assert.deepEqual(first.plan_graph.waves.map(({ todo_ids: ids }) => ids), [
    ['channel-policy'],
    ['label-policy'],
  ]);
  assert.equal(first.plan_graph.minimum_feasible_waves, 2);
});

test('shared-state negative control preserves manual provenance and refuses false parallel', async () => {
  const value = await inputs();
  const compiled = compileControlArtifacts({
    planInput: value.planInput,
    manualEvidence: value.manualNegative,
    querySet: value.querySet,
    codegraphEvidence: value.codegraphEvidence,
    codeSnapshotDigest: value.codeSnapshotDigest,
  });

  assert.equal(validateBoundaryManifest(compiled.boundary_manifest), true);
  assert.deepEqual(compiled.boundary_manifest.conflicts.map(({ kind }) => kind), [
    'write_boundary',
    'state',
  ]);
  const stateConflict = compiled.boundary_manifest.conflicts[1];
  assert.deepEqual(stateConflict.evidence_refs, [
    'manual-channel-policy',
    'manual-label-policy',
  ]);
  assert.equal(compiled.boundary_verdict.verdicts[0].verdict, 'intentional_serial');
  assert.equal(compiled.boundary_verdict.verdicts[0].seam_candidate, null);
  assert.notEqual(compiled.boundary_verdict.verdicts[0].verdict, 'parallel_ready');
  assert.deepEqual(compiled.plan_graph.edges.map(({ kind }) => kind), [
    'write_conflict',
    'state_conflict',
  ]);
  assert.equal(compiled.plan_graph.minimum_feasible_waves, 2);
});

test('compiler fails closed on graph, manual, query, and affected-test drift', async () => {
  const value = await inputs();
  const base = {
    planInput: value.planInput,
    manualEvidence: value.manualNormal,
    querySet: value.querySet,
    codegraphEvidence: value.codegraphEvidence,
    codeSnapshotDigest: value.codeSnapshotDigest,
  };

  const missingGraph = structuredClone(base);
  missingGraph.codegraphEvidence.outcomes.pop();
  assert.throws(() => compileControlArtifacts(missingGraph), /Codegraph evidence/i);

  const manualMismatch = structuredClone(base);
  manualMismatch.manualEvidence.evidence[0].todo_id = 'not-a-plan-todo';
  assert.throws(() => compileControlArtifacts(manualMismatch), /manual evidence/i);

  const queryDrift = structuredClone(base);
  queryDrift.querySet.queries.find(({ id }) => id === 'query-select-dispatch-channel').target = 'otherSurface';
  assert.throws(() => compileControlArtifacts(queryDrift), /query set/i);

  const capacityDrift = structuredClone(base);
  capacityDrift.planInput.capacity.writers = 3;
  assert.throws(() => compileControlArtifacts(capacityDrift), /capacity/i);

  const noAffectedTest = structuredClone(base);
  const affected = noAffectedTest.codegraphEvidence.outcomes
    .find(({ operation }) => operation === 'affected');
  affected.targets[0].data.affectedTests = [];
  affected.targets[0].outcome = 'empty';
  assert.throws(() => compileControlArtifacts(noAffectedTest), /affected test/i);
});
