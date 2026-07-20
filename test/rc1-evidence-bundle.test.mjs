import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestArtifact } from '../src/artifact-contracts.mjs';
import {
  createRc1EvidenceBundle,
  recomputePortableAggregate,
  validateRc1EvidenceBundle,
  validateRc1EvidenceCampaign,
} from '../src/rc1-evidence-bundle.mjs';

const QUERY_SET = {
  schema: 'lattice.sensor_query_set.v2',
  queries: [
    { id: 'status', operation: 'status' },
    { id: 'query-build', operation: 'query', target: 'buildDispatchRecord' },
    { id: 'affected', operation: 'affected', targets: ['src/fixture.mjs', 'test/fixture.test.mjs'] },
  ],
};

function rawEvidence(root, { treatment = false } = {}) {
  return {
    cwd: root,
    outcomes: [
      {
        id: 'status',
        operation: 'status',
        outcome: 'ready',
        data: {
          initialized: true,
          version: '1.4.1',
          projectPath: root,
          indexPath: `${root}/.lattice/sensor`,
          lastIndexed: treatment ? '2026-07-15T00:00:02.000Z' : '2026-07-15T00:00:01.000Z',
          dbSizeBytes: treatment ? 2_048 : 1_024,
          fileCount: treatment ? 20 : 18,
          customFutureField: 'must remain',
        },
      },
      {
        id: 'query-build',
        operation: 'query',
        target: 'buildDispatchRecord',
        outcome: 'ready',
        data: [{
          node: {
            id: 'function:stable',
            kind: 'function',
            name: 'buildDispatchRecord',
            qualifiedName: 'buildDispatchRecord',
            filePath: 'src/fixture.mjs',
            updatedAt: treatment ? 2 : 1,
            customFutureField: 'must remain',
          },
          score: 100,
        }],
      },
      {
        id: 'affected',
        operation: 'affected',
        outcome: 'ready',
        targets: [
          {
            target: 'src/fixture.mjs',
            outcome: 'ready',
            data: {
              changedFiles: ['src/fixture.mjs'],
              affectedTests: ['test/fixture.test.mjs'],
              totalDependentsTraversed: 1,
            },
          },
          {
            target: 'test/fixture.test.mjs',
            outcome: 'ready',
            data: {
              changedFiles: ['test/fixture.test.mjs'],
              affectedTests: ['test/fixture.test.mjs'],
              totalDependentsTraversed: 0,
            },
          },
        ],
      },
    ],
  };
}

function refreshDiagnosticDigests(bundle) {
  bundle.diagnostic.payload_digest = digestArtifact(bundle.diagnostic.payload);
  bundle.component_digests.diagnostic_payload = bundle.diagnostic.payload_digest;
}

test('bundle separates opaque raw, sanitized diagnostic, and full portable preimage', () => {
  const raw = rawEvidence('/private/tmp/lattice-control-one');
  const bundle = createRc1EvidenceBundle({
    condition: 'control',
    runId: 'control-1',
    querySet: QUERY_SET,
    rawEvidence: raw,
  });

  assert.equal(validateRc1EvidenceBundle(bundle), true);
  assert.equal(bundle.raw.schema, 'lattice.sensor_raw_opaque_receipt.v1');
  assert.equal(bundle.diagnostic.schema, 'lattice.sensor_sanitized_diagnostic.v1');
  assert.equal(bundle.portable.schema, 'lattice.sensor_portable_preimage.v1');
  assert.match(Buffer.from(bundle.raw.payload_base64, 'base64').toString('utf8'), /private\/tmp/);
  assert.equal(JSON.stringify(bundle.diagnostic).includes('/private/tmp'), false);
  assert.equal(JSON.stringify(bundle.portable).includes('/private/tmp'), false);
  assert.equal(bundle.diagnostic.payload.cwd, '<repo-root>');
  assert.equal(bundle.diagnostic.payload.outcomes[0].data.customFutureField, 'must remain');
  assert.equal(bundle.portable.outcomes[0].data.customFutureField, 'must remain');
  assert.equal('updatedAt' in bundle.portable.outcomes[1].data[0].node, false);
  assert.equal(bundle.portable.per_query.length, QUERY_SET.queries.length);
  assert.ok(bundle.portable.per_query.every(({ result_digest: digest }) => digest.length === 64));
  assert.equal(recomputePortableAggregate(bundle.portable), bundle.portable.aggregate_digest);
});

test('two full bundles per condition admit only reproducible portable preimages', () => {
  const bundles = [
    createRc1EvidenceBundle({
      condition: 'control', runId: 'control-1', querySet: QUERY_SET,
      rawEvidence: rawEvidence('/private/tmp/control-one'),
    }),
    createRc1EvidenceBundle({
      condition: 'control', runId: 'control-2', querySet: QUERY_SET,
      rawEvidence: rawEvidence('/private/tmp/control-two'),
    }),
    createRc1EvidenceBundle({
      condition: 'treatment', runId: 'treatment-1', querySet: QUERY_SET,
      rawEvidence: rawEvidence('/private/tmp/treatment-one', { treatment: true }),
    }),
    createRc1EvidenceBundle({
      condition: 'treatment', runId: 'treatment-2', querySet: QUERY_SET,
      rawEvidence: rawEvidence('/private/tmp/treatment-two', { treatment: true }),
    }),
  ];

  assert.equal(validateRc1EvidenceCampaign(bundles), true);
  assert.notEqual(bundles[0].raw.payload_digest, bundles[1].raw.payload_digest);
  assert.equal(bundles[0].portable.aggregate_digest, bundles[1].portable.aggregate_digest);
  assert.equal(bundles[2].portable.aggregate_digest, bundles[3].portable.aggregate_digest);

  const drifted = structuredClone(bundles);
  drifted[3].portable.outcomes[0].data.fileCount += 1;
  drifted[3].portable.per_query[0].result_digest = digestArtifact(drifted[3].portable.outcomes[0]);
  drifted[3].portable.aggregate_digest = recomputePortableAggregate(drifted[3].portable);
  assert.equal(validateRc1EvidenceCampaign(drifted), false);
});

test('manifest-external field drop, absolute path, and portable rewrite fail closed', () => {
  const original = createRc1EvidenceBundle({
    condition: 'control', runId: 'control-1', querySet: QUERY_SET,
    rawEvidence: rawEvidence('/private/tmp/control'),
  });

  const dropped = structuredClone(original);
  delete dropped.diagnostic.payload.outcomes[0].data.customFutureField;
  refreshDiagnosticDigests(dropped);
  assert.equal(validateRc1EvidenceBundle(dropped), false);

  const absolute = structuredClone(original);
  absolute.diagnostic.payload.outcomes[0].data.customFutureField = '/secret/path';
  refreshDiagnosticDigests(absolute);
  assert.equal(validateRc1EvidenceBundle(absolute), false);

  const rewritten = structuredClone(original);
  rewritten.portable.outcomes[1].data[0].node.customFutureField = 'rewritten';
  rewritten.portable.per_query[1].result_digest = digestArtifact(rewritten.portable.outcomes[1]);
  rewritten.portable.aggregate_digest = recomputePortableAggregate(rewritten.portable);
  rewritten.component_digests.portable = rewritten.portable.aggregate_digest;
  assert.equal(validateRc1EvidenceBundle(rewritten), false);

  const manifestDrop = structuredClone(original);
  manifestDrop.diagnostic.sanitization_manifest.operations.pop();
  manifestDrop.diagnostic.sanitization_manifest_digest = digestArtifact(
    manifestDrop.diagnostic.sanitization_manifest,
  );
  manifestDrop.component_digests.sanitization_manifest =
    manifestDrop.diagnostic.sanitization_manifest_digest;
  assert.equal(validateRc1EvidenceBundle(manifestDrop), false);
});

test('digest-only v3 artifacts and missing full payload are rejected', async () => {
  const [control, treatment] = await Promise.all([
    readFile(new URL(
      '../research/campaigns/rc1/artifacts/control-v2/compilation-evidence.json',
      import.meta.url,
    ), 'utf8').then(JSON.parse),
    readFile(new URL(
      '../research/campaigns/rc1/artifacts/treatment-v2/compiled/execution-evidence.json',
      import.meta.url,
    ), 'utf8').then(JSON.parse),
  ]);
  assert.equal(validateRc1EvidenceBundle(control), false);
  assert.equal(validateRc1EvidenceBundle(treatment), false);

  const bundle = createRc1EvidenceBundle({
    condition: 'control', runId: 'control-1', querySet: QUERY_SET,
    rawEvidence: rawEvidence('/private/tmp/control'),
  });
  delete bundle.portable.outcomes;
  assert.equal(validateRc1EvidenceBundle(bundle), false);
});
