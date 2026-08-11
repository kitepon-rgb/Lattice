import { todoSelfDigest } from './todo-contracts.mjs';
import {
  readTodoStructureRealizationChain,
  readTodoStructureSource,
} from './todo-store.mjs';
import {
  projectTodoStructureEffective,
  readTodoStructureFinalizationState,
  readTodoStructureState,
} from './todo-structure-store.mjs';

export const TODO_STRUCTURE_PRESENTATION_SCHEMA = 'lattice.todo_structure_presentation.v1';

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function nextActions({ coverage, planKey, findings }) {
  const actions = [];
  const add = (value) => { if (typeof value === 'string' && !actions.includes(value)) actions.push(value); };
  findings.forEach(({ next_action: nextAction }) => add(nextAction));
  if (coverage === 'superseded') {
    add(`lattice todo structure input --plan ${planKey} --input <migrated-structure-set.json> --dry-run --json`);
  } else if (['inconsistent', 'unknown'].includes(coverage)) {
    add(`lattice todo structure --plan ${planKey} --json`);
  } else if (coverage === 'stale') {
    add(`lattice todo structure finalize --plan ${planKey} --json`);
  } else {
    add(`lattice todo structure --plan ${planKey} --json`);
  }
  return actions;
}

async function realizationsFor(repoRoot, source) {
  const entries = [];
  for (const task of source.tasks.filter(({ applicability }) => applicability === 'graph')) {
    entries.push(...await readTodoStructureRealizationChain({
      repoRoot, structureSet: source, taskId: task.task_id,
    }));
  }
  return entries;
}

function taskPresentation(source, effective) {
  const byTask = new Map(effective.tasks.map((task) => [task.task_id, task]));
  return source.tasks.map((task) => {
    if (task.applicability === 'excluded') return {
      task_id: task.task_id, applicability: 'excluded', excluded_reason: task.excluded_reason,
      form: 'excluded', planned_outcome: null, effective_outcome: null,
      changed_fields: [], realization_digest: null, code_anchors: [],
    };
    const projected = byTask.get(task.task_id);
    return {
      task_id: task.task_id, applicability: 'graph', excluded_reason: null,
      form: projected.form,
      planned_outcome: task.planned.outcome,
      effective_outcome: projected.effective.outcome,
      changed_fields: projected.changed_fields,
      realization_digest: projected.realization_digest,
      code_anchors: projected.effective.code_anchors.map((anchor) => ({
        anchor_id: anchor.anchor_id, effect: anchor.effect, path: anchor.path,
        symbol: anchor.symbol, expected_at: anchor.expected_at,
      })),
    };
  });
}

function provenancePresentation(artifact) {
  if (artifact === null) return null;
  return {
    baseline_sha: artifact.git_provenance.baseline_sha,
    current_head_sha: artifact.git_provenance.head_sha,
    commits: artifact.git_provenance.changesets.map((changeset) => ({
      commit_oid: changeset.commit_oid,
      changes: changeset.changes.map((change) => ({
        path: change.path, previous_path: change.previous_path,
        change: change.change, file_kind: change.file_kind,
      })),
    })),
  };
}

function unreadablePlan(member, error) {
  return {
    plan_key: member.plan.plan_key, plan_version: member.plan.plan_version,
    coverage: 'unreadable', freshness: 'unreadable', enabled: false,
    verdict: null, compiled_verdict: null, structure_set_digest: null,
    artifact_digest: null, finalization: null, tasks: [], graph: { nodes: [], edges: [] },
    provenance: null, finding_summary: null, findings: [],
    unreadable_reason: `${error?.code ?? error?.constructor?.name ?? 'Error'}:${error?.detail?.reason ?? error?.message ?? 'unreadable'}`,
    next_actions: [`lattice todo structure --plan ${member.plan.plan_key} --json`],
  };
}

/** 保存済みartifactだけからGantt用の独立構造面を作る。sensorは起動しない。 */
export async function loadTodoStructurePresentation({ repoRoot, readModel } = {}) {
  if (typeof repoRoot !== 'string' || readModel?.schema !== 'lattice.todo_store_read.v1'
    || !Array.isArray(readModel.members)) {
    throw new TypeError('repoRoot and lattice.todo_store_read.v1 are required');
  }
  const plans = [];
  for (const member of readModel.members) {
    let source;
    try {
      source = await readTodoStructureSource({ repoRoot, planKey: member.plan.plan_key });
    } catch (error) {
      plans.push(unreadablePlan(member, error));
      continue;
    }
    if (source === null) continue;
    try {
      const state = await readTodoStructureState({
        repoRoot, store: readModel, planKey: member.plan.plan_key,
      });
      const realizations = source.plan_version === member.plan.plan_version
        ? await realizationsFor(repoRoot, source) : [];
      const effective = projectTodoStructureEffective({ structureSet: source, realizations });
      const finalization = await readTodoStructureFinalizationState({
        repoRoot, store: readModel, planKey: member.plan.plan_key,
      });
      // finalize後は、着手前にactivateしたcompile artifactではなく、最終形態を
      // 再compileして保存したfinalization artifactが表示正本になる。
      const artifact = finalization.artifact ?? state.artifact;
      const freshness = finalization.artifact === null ? state.status : finalization.status;
      const compiledVerdict = artifact?.overlay?.verdict ?? null;
      const unboundVerdict = state.status === 'missing'
        && state.reason === 'activation_binding_missing'
        && ['inconsistent', 'unknown'].includes(compiledVerdict)
        ? compiledVerdict : null;
      const coverage = unboundVerdict
        ?? (freshness === 'fresh' ? compiledVerdict : freshness);
      const findings = artifact?.overlay?.findings ?? [];
      plans.push({
        plan_key: member.plan.plan_key, plan_version: member.plan.plan_version,
        coverage, freshness, enabled: state.binding_digest !== null,
        verdict: unboundVerdict ?? (freshness === 'fresh' ? compiledVerdict : null),
        compiled_verdict: compiledVerdict,
        structure_set_digest: state.structure_set_digest,
        artifact_digest: artifact?.artifact_digest ?? null,
        finalization: {
          required: finalization.required, status: finalization.status,
          reason: finalization.reason, stale_reasons: finalization.stale_reasons,
        },
        tasks: taskPresentation(source, effective),
        graph: artifact?.overlay?.graph ?? { nodes: [], edges: [] },
        provenance: provenancePresentation(artifact),
        finding_summary: artifact?.overlay?.finding_summary ?? null,
        findings,
        unreadable_reason: null,
        next_actions: nextActions({ coverage, planKey: member.plan.plan_key, findings }),
      });
    } catch (error) {
      plans.push(unreadablePlan(member, error));
    }
  }
  plans.sort((left, right) => compareText(left.plan_key, right.plan_key));
  const projection = {
    schema: TODO_STRUCTURE_PRESENTATION_SCHEMA,
    project_id: readModel.project_id,
    plans,
    projection_digest: '',
  };
  projection.projection_digest = todoSelfDigest(projection, 'projection_digest');
  return projection;
}
