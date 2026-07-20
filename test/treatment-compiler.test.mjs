import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  digestArtifact,
  validateBoundaryManifest,
  validateBoundaryVerdict,
  validatePlanDiff,
  validatePlanGraph,
} from '../src/artifact-contracts.mjs';
import { compileTreatmentArtifacts } from '../src/treatment-compiler.mjs';

const FIXTURE_PATH = 'research/fixtures/dispatch-record/src/dispatch-record.mjs';
const CHANNEL_PATH = 'research/fixtures/dispatch-record/src/dispatch-channel.mjs';
const LABEL_PATH = 'research/fixtures/dispatch-record/src/dispatch-label.mjs';
const AFFECTED_TEST = 'test/research-dispatch-record.test.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function exactNode(target) {
  const filePath = target === 'buildDispatchRecord'
    ? FIXTURE_PATH
    : target === 'selectDispatchChannel' ? CHANNEL_PATH : LABEL_PATH;
  return { node: { name: target, qualifiedName: target, filePath } };
}

function treatmentEvidence(querySet) {
  return {
    cwd: '/isolated-treatment',
    outcomes: querySet.queries.map((query) => {
      if (query.operation === 'status') {
        return { id: query.id, operation: query.operation, outcome: 'ready', data: { version: '1.4.1' } };
      }
      if (query.operation === 'affected') {
        return {
          id: query.id,
          operation: query.operation,
          outcome: 'ready',
          targets: query.targets.map((target) => ({
            target,
            outcome: 'ready',
            data: { affectedTests: [AFFECTED_TEST] },
          })),
        };
      }
      return {
        id: query.id,
        operation: query.operation,
        target: query.target,
        outcome: 'ready',
        data: query.operation === 'query' ? [exactNode(query.target)] : [],
        ...(query.operation === 'query' ? {} : { resolution: [exactNode(query.target)] }),
      };
    }),
  };
}

async function options() {
  const [
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    transformArtifact,
    controlBoundaryManifest,
    controlBoundaryVerdict,
    controlPlan,
    negativeBoundaryManifest,
    negativeBoundaryVerdict,
    negativePlan,
  ] = await Promise.all([
    readJson('research/campaigns/rc1/inputs/plan-input.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.normal.json'),
    readJson('research/campaigns/rc1/inputs/manual-evidence.shared-state-negative.json'),
    readJson('research/campaigns/rc1/inputs/query-set.json'),
    readJson('research/campaigns/rc1/artifacts/treatment-v2/transform/transform-artifact.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/plan-v1.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-boundary-manifest.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-boundary-verdict.json'),
    readJson('research/campaigns/rc1/artifacts/control-v2/negative-shared-state-plan-v1.json'),
  ]);
  return {
    planInput,
    manualNormal,
    manualNegative,
    querySet,
    sensorEvidence: treatmentEvidence(querySet),
    codeSnapshotDigest: transformArtifact.output.snapshot_digest,
    transformArtifact,
    control: {
      normal: {
        boundary_manifest: controlBoundaryManifest,
        boundary_verdict: controlBoundaryVerdict,
        plan_graph: controlPlan,
      },
      negative: {
        boundary_manifest: negativeBoundaryManifest,
        boundary_verdict: negativeBoundaryVerdict,
        plan_graph: negativePlan,
      },
    },
  };
}

test('accepted treatment recompiles the whole affected plan to one parallel wave', async () => {
  const values = await options();
  const first = compileTreatmentArtifacts(values);
  const second = compileTreatmentArtifacts(structuredClone(values));

  assert.deepEqual(second, first);
  assert.equal(validateBoundaryManifest(first.normal.boundary_manifest), true);
  assert.equal(validateBoundaryVerdict(first.normal.boundary_verdict), true);
  assert.equal(validatePlanGraph(first.normal.plan_graph), true);
  assert.equal(validateBoundaryManifest(first.negative.boundary_manifest), true);
  assert.equal(validateBoundaryVerdict(first.negative.boundary_verdict), true);
  assert.equal(validatePlanGraph(first.negative.plan_graph), true);
  assert.equal(validatePlanDiff(first.plan_diff), true);

  assert.equal(first.normal.boundary_manifest.conflicts.length, 0);
  assert.deepEqual(first.normal.boundary_manifest.unknowns, []);
  assert.equal(first.normal.boundary_verdict.verdicts[0].verdict, 'parallel_ready');
  assert.equal(first.normal.plan_graph.plan_version, 'rc1-treatment-v2');
  assert.equal(first.normal.plan_graph.minimum_feasible_waves, 1);
  assert.deepEqual(first.normal.plan_graph.waves[0].todo_ids, ['channel-policy', 'label-policy']);
  assert.deepEqual(first.normal.plan_graph.nodes.map((node) => node.owned_boundaries), [
    [
      { kind: 'symbol', target: 'selectDispatchChannel' },
      { kind: 'path', target: CHANNEL_PATH },
    ],
    [
      { kind: 'symbol', target: 'formatDispatchLabel' },
      { kind: 'path', target: LABEL_PATH },
    ],
  ]);
  assert.equal(first.plan_diff.old_plan.digest, digestArtifact(values.control.normal.plan_graph));
  assert.equal(first.plan_diff.new_plan.digest, first.normal.plan_graph_digest);
  assert.deepEqual(first.plan_diff.nodes.changed, ['channel-policy', 'label-policy']);
  assert.deepEqual(first.plan_diff.edges.removed, ['shared-dispatch-boundary']);
  assert.deepEqual(first.plan_diff.invalidated_contexts.map(({ kind }) => kind), [
    'old_plan',
    'agent_context',
    'partial_patch',
    'interface_assumption',
  ]);
  assert.deepEqual(first.plan_diff.metrics, {
    write_conflicts_before: 1,
    write_conflicts_after: 0,
    hard_precedence_before: 0,
    hard_precedence_after: 0,
    minimum_feasible_waves_before: 2,
    minimum_feasible_waves_after: 1,
  });
  assert.equal(first.comparison.hypothesis_result, 'supported_in_fixture');
  assert.equal(first.comparison.fixed_inputs.query_set, digestArtifact(values.querySet));
});

test('shared manual state remains serial after path separation', async () => {
  const compiled = compileTreatmentArtifacts(await options());

  assert.deepEqual(compiled.negative.boundary_manifest.conflicts.map(({ kind }) => kind), ['state']);
  assert.equal(compiled.negative.boundary_verdict.verdicts[0].verdict, 'intentional_serial');
  assert.equal(compiled.negative.plan_graph.minimum_feasible_waves, 2);
  assert.equal(compiled.comparison.negative_control.state_conflicts, 1);
  assert.equal(compiled.comparison.negative_treatment.state_conflicts, 1);
});

test('missing seam evidence, affected-test drift, and predecessor drift fail closed', async () => {
  const missingSeam = await options();
  missingSeam.sensorEvidence.outcomes[2].outcome = 'symbol_absent';
  assert.throws(() => compileTreatmentArtifacts(missingSeam), /LatticeSensor evidence|seam/i);

  const affectedDrift = await options();
  affectedDrift.sensorEvidence.outcomes.at(-1).targets[1].data.affectedTests = [];
  affectedDrift.sensorEvidence.outcomes.at(-1).targets[1].outcome = 'empty';
  assert.throws(() => compileTreatmentArtifacts(affectedDrift), /affected test/i);

  const predecessorDrift = await options();
  predecessorDrift.control.normal.plan_graph.plan_version = 'drifted-control';
  assert.throws(() => compileTreatmentArtifacts(predecessorDrift), /predecessor|digest chain/i);

  const snapshotDrift = await options();
  snapshotDrift.codeSnapshotDigest = '0'.repeat(64);
  assert.throws(() => compileTreatmentArtifacts(snapshotDrift), /snapshot/i);
});
