import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
} from '../src/artifact-contracts.mjs';
import {
  compileBoundaryCondition,
  RC1_BOUNDARY_COMPILER_CONTRACT,
} from '../src/boundary-compiler.mjs';

const SNAPSHOT = 'c'.repeat(64);
const FIXTURE = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';
const SURFACE_PATHS = new Map([
  ['buildDispatchRecord', FIXTURE],
  ['selectDispatchChannel', 'research/fixtures/dispatch-record/src/dispatch-channel.mjs'],
  ['formatDispatchLabel', 'research/fixtures/dispatch-record/src/dispatch-label.mjs'],
  ['channelPolicyContract', 'test/research-dispatch-channel.test.mjs'],
  ['labelPolicyContract', 'test/research-dispatch-label.test.mjs'],
  [SHARED_TEST, SHARED_TEST],
]);
const PROPOSED = new Set([
  'selectDispatchChannel',
  'formatDispatchLabel',
  'channelPolicyContract',
  'labelPolicyContract',
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function nodeRecord(target) {
  const filePath = SURFACE_PATHS.get(target);
  const isFile = target.includes('/');
  return {
    node: {
      kind: isFile ? 'file' : 'function',
      name: isFile ? path.posix.basename(target) : target,
      qualifiedName: target,
      filePath,
    },
  };
}

function graphEvidence(querySet, { treatment = false } = {}) {
  return {
    cwd: '<repo-root>',
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
          outcome: treatment ? 'ready' : 'unresolved',
          targets: query.targets.map((target) => ({
            target,
            outcome: treatment || target === FIXTURE || target.endsWith('.test.mjs')
              ? 'ready'
              : 'empty',
            data: {
              changedFiles: [target],
              affectedTests: target.endsWith('.test.mjs') ? [target] : [SHARED_TEST],
              totalDependentsTraversed: target === FIXTURE ? 1 : 0,
            },
          })),
        };
      }
      const absent = PROPOSED.has(query.target) && !treatment;
      if (absent) {
        return {
          id: query.id,
          operation: query.operation,
          target: query.target,
          outcome: 'symbol_absent',
          ...(query.operation === 'query' ? { data: [] } : {}),
        };
      }
      const target = query.target;
      const record = nodeRecord(target);
      const outcome = {
        id: query.id,
        operation: query.operation,
        target,
        outcome: 'ready',
        data: query.operation === 'query' ? [record] : {},
        resolution: [record],
      };
      if (query.operation === 'callers') {
        outcome.data = {
          callers: PROPOSED.has(target)
            ? [{ name: 'buildDispatchRecord', filePath: FIXTURE }]
            : [{ name: 'research-dispatch-record.test.mjs', filePath: SHARED_TEST }],
        };
      } else if (query.operation === 'callees') {
        outcome.data = { callees: treatment ? [...PROPOSED].slice(0, 2) : [] };
      } else if (query.operation === 'impact') {
        outcome.data = { affected: [record.node] };
      }
      return outcome;
    }),
  };
}

async function fixedInputs() {
  const [planInput, candidateSpec, normal, negative, querySet] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/candidate-spec-v2.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson('research/campaigns/rc1/inputs/query-set-v2.json'),
  ]);
  return { planInput, candidateSpec, normal, negative, querySet };
}

function compile(inputs, manualEvidence, codegraphEvidence, planVersion) {
  return compileBoundaryCondition({
    planInput: inputs.planInput,
    candidateSpec: inputs.candidateSpec,
    manualEvidence,
    querySet: inputs.querySet,
    codegraphEvidence,
    codeSnapshotDigest: SNAPSHOT,
    planVersion,
  });
}

test('one compiler derives shared production and test writes in control', async () => {
  const inputs = await fixedInputs();
  const evidence = graphEvidence(inputs.querySet);
  const first = compile(inputs, inputs.normal, evidence, 'rc1-v4-control');
  const second = compile(inputs, inputs.normal, structuredClone(evidence), 'rc1-v4-control');

  assert.deepEqual(second, first);
  assert.deepEqual(first.compiler, RC1_BOUNDARY_COMPILER_CONTRACT);
  assert.equal(first.surface_mode, 'current');
  assert.equal(validateBoundaryManifest(first.boundary_manifest), true);
  assert.equal(validateBoundaryVerdict(first.boundary_verdict), true);
  assert.equal(validatePlanGraph(first.plan_graph), true);
  assert.deepEqual(
    first.boundary_manifest.conflicts.map(({ resource }) => resource),
    [
      { kind: 'path', target: FIXTURE },
      { kind: 'path', target: SHARED_TEST },
      { kind: 'symbol', target: 'buildDispatchRecord' },
    ],
  );
  for (const todo of first.boundary_manifest.todos) {
    assert.ok(todo.writes.some(({ kind, target }) => kind === 'path' && target === SHARED_TEST));
  }
  assert.equal(first.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
  assert.equal(first.plan_graph.minimum_feasible_waves, 2);
});

test('the same compiler activates exact proposed production and test surfaces', async () => {
  const inputs = await fixedInputs();
  const compiled = compile(
    inputs,
    inputs.normal,
    graphEvidence(inputs.querySet, { treatment: true }),
    'rc1-v4-treatment',
  );

  assert.equal(compiled.surface_mode, 'proposed');
  assert.deepEqual(compiled.boundary_manifest.conflicts, []);
  assert.deepEqual(compiled.boundary_manifest.unknowns, []);
  assert.equal(compiled.boundary_verdict.verdicts[0].verdict, 'parallel_ready');
  assert.equal(compiled.plan_graph.minimum_feasible_waves, 1);
  assert.deepEqual(
    compiled.boundary_manifest.todos.map(({ owns }) => owns.map(({ target }) => target)),
    [
      [
        'research/fixtures/dispatch-record/src/dispatch-channel.mjs',
        'test/research-dispatch-channel.test.mjs',
        'channelPolicyContract',
        'selectDispatchChannel',
      ],
      [
        'research/fixtures/dispatch-record/src/dispatch-label.mjs',
        'test/research-dispatch-label.test.mjs',
        'formatDispatchLabel',
        'labelPolicyContract',
      ],
    ],
  );
  assert.ok(compiled.boundary_manifest.todos.every(({ tests }) => tests.includes(SHARED_TEST)));
});

test('shared manual state remains serial under the same proposed graph', async () => {
  const inputs = await fixedInputs();
  const compiled = compile(
    inputs,
    inputs.negative,
    graphEvidence(inputs.querySet, { treatment: true }),
    'rc1-v4-treatment-negative',
  );

  assert.deepEqual(compiled.boundary_manifest.conflicts.map(({ kind }) => kind), ['state']);
  assert.equal(compiled.boundary_verdict.verdicts[0].verdict, 'intentional_serial');
  assert.equal(compiled.plan_graph.minimum_feasible_waves, 2);
});

test('partial or fuzzy proposed resolution becomes typed unknown and stays serial', async () => {
  const inputs = await fixedInputs();
  const partial = graphEvidence(inputs.querySet);
  const query = partial.outcomes.find(({ id }) => id === 'query-select-dispatch-channel');
  query.outcome = 'ready';
  query.data = [{ node: { name: 'notSelectDispatchChannel', filePath: SURFACE_PATHS.get('selectDispatchChannel') } }];
  const compiled = compile(inputs, inputs.normal, partial, 'rc1-v4-unknown');

  assert.equal(compiled.surface_mode, 'current');
  assert.equal(compiled.boundary_manifest.unknowns.length, 1);
  assert.ok(compiled.boundary_manifest.conflicts.some(({ kind }) => kind === 'dynamic_unknown'));
  assert.equal(compiled.boundary_verdict.verdicts[0].verdict, 'unknown_requires_evidence');
  assert.equal(compiled.plan_graph.minimum_feasible_waves, 2);
});

test('condition selector and fixed-input drift fail closed', async () => {
  const inputs = await fixedInputs();
  assert.throws(() => compileBoundaryCondition({ condition: 'treatment' }), /condition selector/i);

  const driftedCandidate = structuredClone(inputs.candidateSpec);
  driftedCandidate.todos[0].outcome = 'different outcome';
  assert.throws(() => compileBoundaryCondition({
    planInput: inputs.planInput,
    candidateSpec: driftedCandidate,
    manualEvidence: inputs.normal,
    querySet: inputs.querySet,
    codegraphEvidence: graphEvidence(inputs.querySet),
    codeSnapshotDigest: SNAPSHOT,
    planVersion: 'rc1-v4-control',
  }), /candidate TODO/i);

  const stale = graphEvidence(inputs.querySet);
  stale.outcomes[0].outcome = 'stale';
  assert.throws(() => compile(inputs, inputs.normal, stale, 'rc1-v4-control'), /status.*ready/i);
});

test('query receipts cannot be relabeled to a different target', async () => {
  const inputs = await fixedInputs();
  const relabeled = graphEvidence(inputs.querySet);
  relabeled.outcomes.find(({ id }) => id === 'query-build-dispatch-record').target = 'otherSymbol';
  assert.throws(
    () => compile(inputs, inputs.normal, relabeled, 'rc1-v4-control'),
    /target.*query set/i,
  );

  const reordered = graphEvidence(inputs.querySet);
  reordered.outcomes.find(({ id }) => id === 'affected-rc1-production-and-tests')
    .targets.reverse();
  assert.throws(
    () => compile(inputs, inputs.normal, reordered, 'rc1-v4-control'),
    /affected target.*query set/i,
  );
});
