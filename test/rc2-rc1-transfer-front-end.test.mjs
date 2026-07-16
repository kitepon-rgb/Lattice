import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const TRANSFER_MODULE = '../src/rc2-rc1-transfer-front-end.mjs';
const ARTIFACT_ROOT = new URL('../research/campaigns/rc1/artifacts/v6/', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, ARTIFACT_ROOT), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

async function conditionInputs(condition, manualEvidence = 'normal') {
  const manualPath = manualEvidence === 'normal'
    ? 'inputs/manual-evidence.normal.json'
    : 'inputs/manual-evidence.shared-state-negative.json';
  return {
    planInput: await readJson('inputs/plan-input.json'),
    candidateSpec: await readJson('inputs/candidate-spec-v2.json'),
    manualEvidence: await readJson(manualPath),
    querySet: await readJson('inputs/query-set-v2.json'),
    boundaryManifest: await readJson(`compiled/${condition}/boundary-manifest.json`),
  };
}

async function compile(condition, manualEvidence) {
  const { compileRc1TransferBundleV2 } = await import(TRANSFER_MODULE);
  return {
    compileRc1TransferBundleV2,
    inputs: await conditionInputs(condition, manualEvidence),
  };
}

async function assertTransferredCondition({
  condition,
  manualEvidence = 'normal',
  conflictRecords,
  distinctConflictPairs,
  waves,
  stateConflictRecords = 0,
}) {
  const { compileRc1TransferBundleV2, inputs } = await compile(condition, manualEvidence);
  const {
    validateBoundaryVerdictV2,
    validateNormalizedBoundaryBundleV2,
    validatePlanGraphV2,
  } = await import('../src/artifact-contracts-v2.mjs');
  const transfer = compileRc1TransferBundleV2(inputs);

  assert.equal(transfer.bundle.schema_version, 'lattice.normalized_boundary_bundle.v2');
  assert.equal(transfer.bundle.graph.conflicts.length, conflictRecords);
  assert.equal(new Set(transfer.bundle.graph.conflicts.map(({ todo_ids: todoIds }) => (
    [...todoIds].sort().join('\u0000')
  ))).size, distinctConflictPairs);
  const stateResourceIds = new Set(transfer.bundle.resources
    .filter(({ kind }) => kind === 'state')
    .map(({ resource_id: resourceId }) => resourceId));
  assert.equal(transfer.bundle.graph.conflicts.filter(({ resource_id: resourceId }) => (
    stateResourceIds.has(resourceId)
  )).length, stateConflictRecords);
  assert.deepEqual(transfer.plan.waves, waves.map((todoIds) => ({ todo_ids: todoIds })));
  assert.equal(validateNormalizedBoundaryBundleV2(transfer.bundle), true);
  assert.equal(validateBoundaryVerdictV2(transfer.verdict, transfer.bundle.graph), true);
  assert.equal(validatePlanGraphV2(transfer.plan, transfer.bundle.graph), true);
}

test('RC1 v6 control-normal transfers three conflict records over one TODO pair into two waves', async () => {
  await assertTransferredCondition({
    condition: 'control-normal',
    conflictRecords: 3,
    distinctConflictPairs: 1,
    waves: [['channel-policy'], ['label-policy']],
  });
});

test('RC1 v6 treatment-normal transfers zero conflicts into one wave', async () => {
  await assertTransferredCondition({
    condition: 'treatment-normal',
    conflictRecords: 0,
    distinctConflictPairs: 0,
    waves: [['channel-policy', 'label-policy']],
  });
});

test('RC1 v6 control-negative transfers four conflict records into two waves', async () => {
  await assertTransferredCondition({
    condition: 'control-negative',
    manualEvidence: 'shared-state-negative',
    conflictRecords: 4,
    distinctConflictPairs: 1,
    stateConflictRecords: 1,
    waves: [['channel-policy'], ['label-policy']],
  });
});

test('RC1 v6 treatment-negative transfers exactly one manual state conflict into two waves', async () => {
  await assertTransferredCondition({
    condition: 'treatment-negative',
    manualEvidence: 'shared-state-negative',
    conflictRecords: 1,
    distinctConflictPairs: 1,
    stateConflictRecords: 1,
    waves: [['channel-policy'], ['label-policy']],
  });
});

test('RC1 transfer rejects candidate binding corruption', async () => {
  const { compileRc1TransferBundleV2, inputs } = await compile('control-normal');
  const corrupted = clone(inputs);
  corrupted.candidateSpec.candidate_id = 'mutated-candidate';

  assert.throws(() => compileRc1TransferBundleV2(corrupted));
});

test('RC1 transfer rejects query binding corruption', async () => {
  const { compileRc1TransferBundleV2, inputs } = await compile('control-normal');
  const corrupted = clone(inputs);
  corrupted.querySet.queries[1].target = 'mutatedQueryTarget';

  assert.throws(() => compileRc1TransferBundleV2(corrupted));
});

test('RC1 transfer rejects manual evidence binding corruption', async () => {
  const { compileRc1TransferBundleV2, inputs } = await compile('control-negative', 'shared-state-negative');
  const corrupted = clone(inputs);
  corrupted.manualEvidence.evidence[0].state_writes = ['mutated-state'];

  assert.throws(() => compileRc1TransferBundleV2(corrupted));
});
