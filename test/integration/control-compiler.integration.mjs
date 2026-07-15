import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanGraph,
} from '../../src/artifact-contracts.mjs';
import { collectCodegraphEvidence } from '../../src/codegraph-adapter.mjs';
import { compileControlArtifacts } from '../../src/control-compiler.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

const [planInput, manualEvidence, querySet, fixtureSource] = await Promise.all([
  readJson('research/campaigns/rc1/inputs/plan-input.json'),
  readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
  readJson('research/campaigns/rc1/inputs/query-set.json'),
  readFile(new URL('../../research/fixtures/dispatch-record/src/dispatch-record.mjs', import.meta.url)),
]);
const codegraphEvidence = await collectCodegraphEvidence({ cwd: process.cwd(), querySet });
const codeSnapshotDigest = digestArtifact({
  files: [
    {
      path: planInput.project.fixture_entry,
      content_digest: createHash('sha256').update(fixtureSource).digest('hex'),
    },
  ],
});
const compiled = compileControlArtifacts({
  planInput,
  manualEvidence,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest,
});

assert.equal(validateBoundaryManifest(compiled.boundary_manifest), true);
assert.equal(validateBoundaryVerdict(compiled.boundary_verdict), true);
assert.equal(validatePlanGraph(compiled.plan_graph), true);
assert.equal(compiled.boundary_manifest.conflicts.length, 1);
assert.equal(compiled.boundary_verdict.verdicts[0].verdict, 'seam_candidate');
assert.equal(compiled.plan_graph.minimum_feasible_waves, 2);

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  code_snapshot_digest: codeSnapshotDigest,
  boundary_manifest_digest: compiled.boundary_manifest_digest,
  boundary_verdict_digest: compiled.boundary_verdict_digest,
  plan_graph_digest: compiled.plan_graph_digest,
  graph_outcomes: codegraphEvidence.outcomes.map(({ id, outcome }) => ({ id, outcome })),
})}\n`);
