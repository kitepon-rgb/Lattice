import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runIsolatedTransform } from '../src/isolation-runner.mjs';

const SHA256_C = 'c'.repeat(64);
const SHARED_TEST = 'test/research-dispatch-record.test.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function exactNode(target, filePath, kind = 'function') {
  return {
    node: {
      kind,
      name: kind === 'file' ? path.posix.basename(target) : target,
      qualifiedName: target,
      filePath,
    },
  };
}

function controlGraphEvidence(querySet) {
  const fixtureEntry = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
  const proposedSymbols = new Set([
    'selectDispatchChannel',
    'formatDispatchLabel',
    'channelPolicyContract',
    'labelPolicyContract',
  ]);

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
          outcome: 'ready',
          targets: query.targets.map((target) => ({
            target,
            outcome: target === fixtureEntry || target.endsWith('.test.mjs') ? 'ready' : 'empty',
            data: {
              changedFiles: [target],
              affectedTests: target === fixtureEntry ? [SHARED_TEST]
                : target.endsWith('.test.mjs') ? [target] : [],
              totalDependentsTraversed: target === fixtureEntry ? 1 : 0,
            },
          })),
        };
      }
      if (proposedSymbols.has(query.target)) {
        return {
          id: query.id,
          operation: query.operation,
          target: query.target,
          outcome: 'symbol_absent',
          ...(query.operation === 'query' ? { data: [] } : {}),
        };
      }
      if (query.target === SHARED_TEST) {
        return {
          id: query.id,
          operation: query.operation,
          target: query.target,
          outcome: 'ready',
          data: [exactNode(SHARED_TEST, SHARED_TEST, 'file')],
        };
      }
      return {
        id: query.id,
        operation: query.operation,
        target: query.target,
        outcome: 'ready',
        data: query.operation === 'query'
          ? [exactNode('buildDispatchRecord', fixtureEntry)]
          : [],
        resolution: [exactNode('buildDispatchRecord', fixtureEntry)],
      };
    }),
  };
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('v4 fixed inputs expose production and test ownership without a condition selector', async () => {
  const [candidateSpec, querySet, oracle, planInput] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/candidate-spec-v2.json'),
    readJson('research/campaigns/rc1/inputs/query-set-v2.json'),
    readJson('research/campaigns/rc1/inputs/behavior-oracle-v2.json'),
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
  ]);

  assert.equal(candidateSpec.schema, 'lattice.rc1.boundary_candidate_spec.v2');
  assert.equal(candidateSpec.compiler_contract.condition_selector, 'forbidden');
  assert.deepEqual(candidateSpec.todos.map(({ todo_id: id }) => id), planInput.todos.map(({ id }) => id));
  assert.deepEqual(
    candidateSpec.todos.map(({ current }) => current.tests.map(({ path: testPath }) => testPath)),
    [[SHARED_TEST], [SHARED_TEST]],
  );
  assert.deepEqual(
    candidateSpec.todos.map(({ proposed }) => proposed.tests.map(({ path: testPath }) => testPath)),
    [['test/research-dispatch-channel.test.mjs'], ['test/research-dispatch-label.test.mjs']],
  );
  assert.equal(new Set(querySet.queries.map(({ id }) => id)).size, querySet.queries.length);
  assert.deepEqual(
    querySet.queries.filter(({ id }) => id.startsWith('query-') && id.endsWith('-policy-contract'))
      .map(({ target }) => target),
    ['channelPolicyContract', 'labelPolicyContract'],
  );
  assert.equal(oracle.transform_scope_contract.oracle_input_writable, false);
  assert.equal(oracle.transform_scope_contract.executor_writable, false);
  assert.equal(oracle.cases.length, 8);
});

test('pre and post snapshots must use one condition-agnostic boundary compiler', async () => {
  const { compileBoundaryCondition } = await import('../src/boundary-compiler.mjs');
  assert.equal(typeof compileBoundaryCondition, 'function');
  assert.throws(
    () => compileBoundaryCondition({ condition: 'control' }),
    /condition selector/i,
  );
});

test('control compilation must include the shared future test write in both TODO boundaries', async () => {
  const { compileBoundaryCondition } = await import('../src/boundary-compiler.mjs');
  const [planInput, candidateSpec, manualEvidence, querySet] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/candidate-spec-v2.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/query-set-v2.json'),
  ]);
  const compiled = compileBoundaryCondition({
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
    codegraphEvidence: controlGraphEvidence(querySet),
    codeSnapshotDigest: SHA256_C,
    planVersion: 'rc1-v4-control',
  });

  for (const todo of compiled.boundary_manifest.todos) {
    assert.ok(todo.writes.some(({ kind, target }) => kind === 'path' && target === SHARED_TEST));
  }
  assert.ok(compiled.boundary_manifest.conflicts.some(({ resource }) => (
    resource.kind === 'path' && resource.target === SHARED_TEST
  )));
  assert.equal(compiled.plan_graph.minimum_feasible_waves, 2);
});

test('black-box behavior oracle is executable outside transform-owned tests', async () => {
  const { runRc1BlackBoxOracle } = await import('../src/rc1-black-box-oracle.mjs');
  const oracle = await readJson('research/campaigns/rc1/inputs/behavior-oracle-v2.json');
  const result = await runRc1BlackBoxOracle({
    repoRoot: new URL('..', import.meta.url).pathname,
    oracle,
  });

  assert.equal(result.schema, 'lattice.rc1.black_box_behavior_receipt.v2');
  assert.equal(result.outcome, 'passed');
  assert.deepEqual(result.case_results.map(({ outcome }) => outcome), Array(8).fill('passed'));
});

test('digest-only v3 Codegraph evidence is rejected as a missing-preimage bundle', async () => {
  const { validateRc1EvidenceBundle } = await import('../src/rc1-evidence-bundle.mjs');
  const [controlEvidence, treatmentEvidence] = await Promise.all([
    readJson('research/campaigns/rc1/artifacts/control-v2/compilation-evidence.json'),
    readJson('research/campaigns/rc1/artifacts/treatment-v2/compiled/execution-evidence.json'),
  ]);

  assert.equal(validateRc1EvidenceBundle(controlEvidence), false);
  assert.equal(validateRc1EvidenceBundle(treatmentEvidence), false);
});

test('v3 supported result is rejected when the complete success predicate is absent', async () => {
  const { evaluateRc1Hypothesis } = await import('../src/rc1-comparison.mjs');
  const v3Comparison = await readJson(
    'research/campaigns/rc1/artifacts/treatment-v2/compiled/comparison.json',
  );
  const evaluation = evaluateRc1Hypothesis(v3Comparison);

  assert.equal(evaluation.supported, false);
  assert.ok(evaluation.failed_conditions.includes('compiler_identity'));
  assert.ok(evaluation.failed_conditions.includes('test_write_conflicts'));
  assert.ok(evaluation.failed_conditions.includes('portable_preimages'));
});

test('isolated transform detects content-only drift in an existing ignored protected file', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-v4-source-invariant-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(repoRoot, 'src'), { recursive: true }),
    mkdir(path.join(repoRoot, 'test'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(repoRoot, '.gitignore'), 'test/protected.ignore\n'),
    writeFile(path.join(repoRoot, 'src/base.mjs'), 'export const value = 1;\n'),
    writeFile(path.join(repoRoot, 'test/protected.ignore'), 'before\n'),
  ]);
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Lattice Test']);
  git(repoRoot, ['add', '.gitignore', 'src/base.mjs']);
  git(repoRoot, ['commit', '-m', 'source invariant fixture']);

  await assert.rejects(
    runIsolatedTransform({
      repoRoot,
      baseRef: 'HEAD',
      allowedPaths: ['src/base.mjs'],
      transform: async ({ worktreePath }) => {
        await Promise.all([
          writeFile(path.join(worktreePath, 'src/base.mjs'), 'export const value = 2;\n'),
          writeFile(path.join(repoRoot, 'test/protected.ignore'), 'after\n'),
        ]);
      },
      verifyCommands: [],
    }),
    /source repository changed/i,
  );
});
