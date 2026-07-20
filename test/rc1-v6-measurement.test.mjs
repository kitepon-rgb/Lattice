import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import { verifyRc1V6RunEvidence } from '../src/rc1-v6-causal-binding.mjs';

const ARTIFACT_ROOT = new URL('../research/campaigns/rc1/artifacts/v5/', import.meta.url);

async function readArtifact(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, ARTIFACT_ROOT), 'utf8'));
}

test('v6 measurement binds snapshot and sensor executable; archived LatticeSensor evidence remains replayable', async () => {
  const {
    bindRc1V6EvidenceBundle,
    compileRc1V6BoundaryCondition,
    createRc1V6ConditionRun,
    resolveRc1V6LatticeSensorIdentity,
    sourceSnapshotFromRc1BehaviorSurface,
    sourceSnapshotFromRc1TransformOutput,
  } = await import('../src/rc1-v6-measurement.mjs');
  const [
    baseBundle,
    preReceipt,
    postReceipt,
    transformArtifact,
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
  ] = await Promise.all([
    readArtifact('evidence/control-1.json'),
    readArtifact('behavior/pre-receipt.json'),
    readArtifact('behavior/post-receipt.json'),
    readArtifact('transform/transform-artifact.json'),
    readArtifact('inputs/plan-input.json'),
    readArtifact('inputs/candidate-spec-v2.json'),
    readArtifact('inputs/manual-evidence.normal.json'),
    readArtifact('inputs/query-set-v2.json'),
  ]);
  const controlSnapshot = sourceSnapshotFromRc1BehaviorSurface(preReceipt.surface);
  const treatmentSnapshot = sourceSnapshotFromRc1TransformOutput(transformArtifact);
  const postSnapshot = sourceSnapshotFromRc1BehaviorSurface(postReceipt.surface);
  const currentSensorIdentity = await resolveRc1V6LatticeSensorIdentity();
  assert.equal(currentSensorIdentity.executable_ref, 'lattice-sensor');
  // The immutable v5 fixture was captured by LatticeSensor 1.4.1. Preserve its
  // measured identity for replay; current campaigns capture Lattice sensor.
  const sensorIdentity = {
    ...currentSensorIdentity,
    version: '1.4.1',
    executable_ref: 'sensor',
  };
  const expected = {
    base_sha: preReceipt.base_sha,
    patch_digest: null,
    snapshot: controlSnapshot,
    sensor_identity: sensorIdentity,
    query_set_digest: digestArtifact(querySet),
  };
  const bundle = bindRc1V6EvidenceBundle({
    bundle: baseBundle,
    ...expected,
  });
  const run = createRc1V6ConditionRun(bundle);

  assert.equal(controlSnapshot.schema, 'lattice.rc1.source_snapshot.v1');
  assert.deepEqual(treatmentSnapshot, postSnapshot);
  assert.equal(sensorIdentity.schema, 'lattice.rc1.sensor_identity.v1');
  assert.match(sensorIdentity.version, /^\d+\.\d+\.\d+/);
  assert.match(sensorIdentity.executable_digest, /^[0-9a-f]{64}$/);
  assert.equal(verifyRc1V6RunEvidence({ run, bundle, expected }).valid, true);

  const compiled = compileRc1V6BoundaryCondition({
    planInput,
    candidateSpec,
    manualEvidence,
    querySet,
    run,
    bundle,
    expected,
    planVersion: 'rc1-v6-control',
  });
  assert.equal(
    compiled.boundary_manifest.source.code_snapshot_digest,
    digestArtifact(controlSnapshot),
  );
  assert.equal(
    compiled.boundary_manifest.source.sensor_version,
    sensorIdentity.version,
  );

  const substituted = structuredClone({ run, bundle });
  substituted.bundle.measurement.snapshot.files[0].content_digest = 'f'.repeat(64);
  substituted.bundle.measurement.snapshot_digest = digestArtifact(
    substituted.bundle.measurement.snapshot,
  );
  substituted.bundle.measurement_digest = digestArtifact(substituted.bundle.measurement);
  substituted.run.measurement_digest = substituted.bundle.measurement_digest;
  assert.throws(
    () => compileRc1V6BoundaryCondition({
      planInput,
      candidateSpec,
      manualEvidence,
      querySet,
      ...substituted,
      expected,
      planVersion: 'rc1-v6-control-corrupt',
    }),
    /measurement|snapshot|binding/i,
  );
});

test('v6 source snapshot preserves present bytes and explicit absence as typed preimage', async (t) => {
  const { captureRc1V6SourceSnapshot } = await import('../src/rc1-v6-measurement.mjs');
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc1-v6-snapshot-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await writeFile(path.join(repoRoot, 'src/present.mjs'), 'export const value = 1;\n');

  const snapshot = await captureRc1V6SourceSnapshot({
    repoRoot,
    paths: ['src/absent.mjs', 'src/present.mjs'],
  });
  assert.deepEqual(snapshot.files.map(({ path: relativePath, state }) => ({
    path: relativePath,
    state,
  })), [
    { path: 'src/absent.mjs', state: 'absent' },
    { path: 'src/present.mjs', state: 'file' },
  ]);
  assert.equal(snapshot.files[0].content_digest, null);
  assert.match(snapshot.files[1].content_digest, /^[0-9a-f]{64}$/);
  assert.match(digestArtifact(snapshot), /^[0-9a-f]{64}$/);
});
