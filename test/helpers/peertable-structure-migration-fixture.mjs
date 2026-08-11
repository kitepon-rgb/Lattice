import { digestTodoArtifact, todoSelfDigest } from '../../src/todo-contracts.mjs';
import { TODO_STRUCTURE_SET_SCHEMA } from '../../src/todo-structure-contracts.mjs';

const pad = (index) => String(index + 1).padStart(2, '0');
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const contract = (shapeId = 'peertable-freeform-text-v0') => ({
  shape_id: shapeId, schema_ref: null, identity_fields: ['text'],
  lifecycle: 'immutable_artifact', cardinality: 'one', compatible_shape_ids: [],
});

function transform(task) {
  const inputs = task.receives.map((text, index) => ({
    port_id: `receive-${pad(index)}`,
    source: { kind: 'constant', constant_id: `${task.task_id}-receive-${pad(index)}`, value: text },
    access: 'read', contract: contract(),
  }));
  const outputs = task.emits.map((text, index) => ({
    port_id: `emit-${pad(index)}`, data_id: `${task.task_id}-emission-${pad(index)}`,
    contract: contract(),
    sinks: [{ kind: 'final_product', product_id: `${task.task_id}-emission-${pad(index)}` }],
  }));
  const inputPortIds = inputs.map(({ port_id: id }) => id);
  const outputPortIds = outputs.map(({ port_id: id }) => id);
  return {
    outcome: task.outcome, inputs,
    operations: task.organizes.map((summary, index) => ({
      operation_id: `organize-${pad(index)}`, input_port_ids: inputPortIds,
      output_port_ids: outputPortIds, summary,
    })),
    outputs, code_anchors: [], failures: [...task.failures].sort(compareText),
    first_live_e2e: task.first_live_e2e, non_goals: [...task.non_goals].sort(compareText),
  };
}

/** logical_dataflow.v0の自由文を失わず、意味推定なしでv1 contractへ移すtest専用変換。 */
export function migratePeertableLogicalDataflowFixture(fixture) {
  const byPlan = new Map();
  for (const task of fixture.tasks) {
    const entries = byPlan.get(task.plan_key) ?? [];
    entries.push(task);
    byPlan.set(task.plan_key, entries);
  }
  const structureSets = [];
  const unresolvedCodeAnchors = [];
  for (const [planKey, tasks] of [...byPlan].sort(([left], [right]) => compareText(left, right))) {
    const taskIds = tasks.map(({ task_id: id }) => id).sort(compareText);
    const set = {
      schema: TODO_STRUCTURE_SET_SCHEMA, project_id: 'peertable-fixture', plan_key: planKey,
      plan_version: 'fixture-v1',
      topology_digest: digestTodoArtifact({ plan_key: planKey, task_ids: taskIds }),
      profile: 'code-dataflow', baseline_sha: 'b'.repeat(40), external_contracts: [],
      tasks: tasks.map((task) => ({
        task_id: task.task_id, applicability: 'graph', planned: transform(task),
      })),
      structure_set_digest: '',
    };
    set.structure_set_digest = todoSelfDigest(set, 'structure_set_digest');
    structureSets.push(set);
    unresolvedCodeAnchors.push(...tasks.map((task) => ({
      plan_key: planKey, task_id: task.task_id,
      reason: 'logical_dataflow_v0_has_no_code_path_or_symbol',
    })));
  }
  return {
    structure_sets: structureSets,
    unresolved_code_anchors: unresolvedCodeAnchors,
  };
}

export function resealPeertableStructureSet(set) {
  const result = structuredClone(set);
  result.structure_set_digest = '';
  result.structure_set_digest = todoSelfDigest(result, 'structure_set_digest');
  return result;
}

export function peertableFixtureContract(shapeId) {
  return contract(shapeId);
}
