import {
  canonicalizeTodoArtifact, exactRecord, todoSelfDigest, validateTodoPlan,
} from './todo-contracts.mjs';
import { gitSync } from './git-process.mjs';
import {
  TODO_STRUCTURE_COMPILE_ARTIFACT_SCHEMA,
  TODO_STRUCTURE_PROFILE,
  digestTodoStructureRealizationHeads,
  digestTodoStructureTransform,
  explainTodoStructureCompileArtifact,
  explainTodoStructureRealization,
  explainTodoStructureSet,
} from './todo-structure-contracts.mjs';
import {
  readTodoStore,
  readTodoStructureBinding,
  readTodoStructureCompileArtifact,
  readTodoStructureFinalization,
  readTodoStructureRealizationChain,
  readTodoStructureSource,
  todoStructureBindingRef,
  todoStructureCompileArtifactRef,
  todoStructureFinalizationRef,
  todoStructureSourceRef,
} from './todo-store.mjs';

const SHA = /^[0-9a-f]{40}$/u;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export class TodoStructureStoreError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoStructureStoreError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail = {}) {
  throw new TodoStructureStoreError(code, reason, detail);
}

function latestRealizationHeads(structureSet, realizations) {
  if (!Array.isArray(realizations)) fail('STRUCTURE_COMPILE_INPUT_INVALID', 'realizations_invalid');
  const grouped = new Map();
  for (const realization of realizations) {
    const entries = grouped.get(realization?.task_id) ?? [];
    entries.push(realization); grouped.set(realization?.task_id, entries);
  }
  const heads = [];
  for (const [taskId, unsorted] of grouped) {
    const entries = [...unsorted].sort((left, right) => left.sequence - right.sequence);
    let previous = null; const priorDigests = new Set();
    for (const realization of entries) {
      const result = explainTodoStructureRealization(realization, {
        structureSet, previous, priorDigests,
      });
      if (!result.valid || realization.task_id !== taskId) {
        fail('STRUCTURE_COMPILE_INPUT_INVALID', result.valid ? 'task_id_mismatch' : result.reason, {
          task_id: taskId ?? null, path: result.path ?? '/task_id',
        });
      }
      previous = realization; priorDigests.add(realization.realization_digest);
    }
    if (previous !== null) heads.push({
      task_id: taskId, sequence: previous.sequence,
      realization_digest: previous.realization_digest,
    });
  }
  return heads.sort((left, right) => compareText(left.task_id, right.task_id));
}

/** compilerの各bounded出力を一つのself-digested artifactへ束縛する。 */
export function buildTodoStructureCompileArtifact({
  structureSet, sourceProjection, gitProvenance, overlay, realizations = [], compiledAt, actor,
} = {}) {
  const structure = explainTodoStructureSet(structureSet);
  if (!structure.valid) {
    fail('STRUCTURE_COMPILE_INPUT_INVALID', structure.reason, { path: structure.path });
  }
  const heads = latestRealizationHeads(structureSet, realizations);
  const artifact = {
    schema: TODO_STRUCTURE_COMPILE_ARTIFACT_SCHEMA,
    project_id: structureSet.project_id,
    plan_key: structureSet.plan_key,
    plan_version: structureSet.plan_version,
    topology_digest: structureSet.topology_digest,
    profile: TODO_STRUCTURE_PROFILE,
    baseline_sha: structureSet.baseline_sha,
    current_head_sha: gitProvenance?.head_sha ?? null,
    structure_set_digest: structureSet.structure_set_digest,
    source_projection: structuredClone(sourceProjection),
    git_provenance: structuredClone(gitProvenance),
    realization_heads: heads,
    realization_head_digest: digestTodoStructureRealizationHeads(heads),
    overlay: structuredClone(overlay),
    compiled_at: compiledAt,
    actor: structuredClone(actor),
    artifact_digest: '',
  };
  artifact.artifact_digest = todoSelfDigest(artifact, 'artifact_digest');
  const explained = explainTodoStructureCompileArtifact(artifact);
  if (!explained.valid) {
    fail('STRUCTURE_COMPILE_INPUT_INVALID', explained.reason, { path: explained.path });
  }
  return artifact;
}

/** plannedを残したまま、最新realizationをeffectiveへ投影するdiagnostic面。 */
export function projectTodoStructureEffective({ structureSet, realizations = [] } = {}) {
  const structure = explainTodoStructureSet(structureSet);
  if (!structure.valid) fail('STRUCTURE_EFFECTIVE_INPUT_INVALID', structure.reason, {
    path: structure.path,
  });
  const heads = latestRealizationHeads(structureSet, realizations);
  const headDigests = new Map(heads.map((head) => [head.task_id, head.realization_digest]));
  const latest = new Map(realizations
    .filter((entry) => headDigests.get(entry.task_id) === entry.realization_digest)
    .map((entry) => [entry.task_id, entry]));
  const transformFields = [
    'outcome', 'inputs', 'operations', 'outputs', 'code_anchors', 'failures',
    'first_live_e2e', 'non_goals',
  ];
  const tasks = structureSet.tasks.map((task) => {
    if (task.applicability === 'excluded') return {
      task_id: task.task_id, applicability: 'excluded', form: 'excluded',
      planned_digest: null, realization_digest: null,
      changed_fields: [], effective: null,
    };
    const realization = latest.get(task.task_id) ?? null;
    const changedFields = realization === null ? [] : transformFields.filter((field) => (
      canonicalizeTodoArtifact(task.planned[field])
        !== canonicalizeTodoArtifact(realization.realized[field])
    ));
    return {
      task_id: task.task_id, applicability: 'graph',
      form: realization === null ? 'planned' : 'realized',
      planned_digest: digestTodoStructureTransform(task.planned),
      realization_digest: realization?.realization_digest ?? null,
      changed_fields: changedFields,
      effective: structuredClone(realization?.realized ?? task.planned),
    };
  });
  const history = [...realizations]
    .sort((left, right) => compareText(left.task_id, right.task_id) || left.sequence - right.sequence)
    .map((entry) => ({
      task_id: entry.task_id, sequence: entry.sequence,
      realization_digest: entry.realization_digest, supersedes: entry.supersedes,
      head_sha: entry.head_sha, commit_oids: entry.commit_oids,
    }));
  const projection = {
    schema: 'lattice.todo_structure_effective.v1',
    structure_set_digest: structureSet.structure_set_digest,
    realization_head_digest: digestTodoStructureRealizationHeads(heads),
    tasks, history, projection_digest: '',
  };
  projection.projection_digest = todoSelfDigest(projection, 'projection_digest');
  return projection;
}

function resolveCurrentHead(repoRoot, resolveHead) {
  let value;
  try {
    value = resolveHead === undefined
      ? gitSync(['rev-parse', '--verify', 'HEAD^{commit}'], {
        cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      : resolveHead(repoRoot);
  } catch (error) {
    fail('STRUCTURE_GIT_HEAD_UNAVAILABLE', 'current_head_unavailable', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!SHA.test(value)) fail('STRUCTURE_GIT_HEAD_UNAVAILABLE', 'current_head_invalid');
  return value;
}

async function currentRealizationHeads(repoRoot, structureSet) {
  const heads = [];
  for (const task of structureSet.tasks) {
    if (task.applicability !== 'graph') continue;
    const chain = await readTodoStructureRealizationChain({
      repoRoot, structureSet, taskId: task.task_id,
    });
    const head = chain.at(-1);
    if (head !== undefined) heads.push({
      task_id: task.task_id, sequence: head.sequence, realization_digest: head.realization_digest,
    });
  }
  return heads;
}

function projectState({ status, reason, plan, source = null, binding = null, artifact = null,
  staleReasons = [] }) {
  return {
    schema: 'lattice.todo_structure_state.v1',
    status,
    reason,
    plan_key: plan.plan_key,
    plan_version: plan.plan_version,
    topology_digest: plan.topology_digest,
    structure_set_digest: source?.structure_set_digest ?? null,
    binding_digest: binding?.binding_digest ?? null,
    artifact_digest: artifact?.artifact_digest ?? null,
    compiled_verdict: artifact?.overlay?.verdict ?? null,
    effective_verdict: status === 'fresh' ? artifact.overlay.verdict : null,
    stale_reasons: [...staleReasons].sort(compareText),
    artifact,
  };
}

/**
 * 保存artifactを読むだけのprojection。sensor／Git diffは起動せず、GitはHEAD identityだけ読む。
 * stale artifactのcompiled verdictは履歴として残すが、effective verdictには絶対に昇格させない。
 */
export async function readTodoStructureState(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const store = options.store ?? await readTodoStore({ repoRoot, now: options.now });
  const member = store.members.find(({ plan }) => plan.plan_key === options.planKey);
  if (member === undefined) fail('STRUCTURE_PLAN_NOT_FOUND', 'plan_not_active', {
    plan_key: options.planKey,
  });
  const plan = member.plan;
  const source = await readTodoStructureSource({ repoRoot, planKey: plan.plan_key });
  const binding = await readTodoStructureBinding({
    repoRoot, planKey: plan.plan_key, planVersion: plan.plan_version,
  });
  const artifact = await readTodoStructureCompileArtifact({
    repoRoot, planKey: plan.plan_key, planVersion: plan.plan_version,
  });

  if (source === null) {
    if (binding !== null || artifact !== null) {
      fail('STRUCTURE_SOURCE_MISSING', 'activated_planned_source_missing', {
        plan_key: plan.plan_key, plan_version: plan.plan_version,
      });
    }
    return projectState({ status: 'missing', reason: 'structure_source_missing', plan });
  }
  if (source.project_id !== plan.project_id || source.plan_key !== plan.plan_key) {
    fail('STRUCTURE_SOURCE_CORRUPT', 'planned_source_identity_mismatch');
  }
  if (source.plan_version !== plan.plan_version) {
    const oldBinding = await readTodoStructureBinding({
      repoRoot, planKey: source.plan_key, planVersion: source.plan_version,
    });
    const oldArtifact = await readTodoStructureCompileArtifact({
      repoRoot, planKey: source.plan_key, planVersion: source.plan_version,
    });
    return projectState({
      status: 'superseded', reason: 'plan_revision_changed', plan, source,
      binding: oldBinding, artifact: oldArtifact,
      staleReasons: ['plan_version'],
    });
  }
  if (binding === null) {
    return projectState({
      status: 'missing', reason: artifact === null
        ? 'compile_artifact_missing' : 'activation_binding_missing',
      plan, source, artifact,
    });
  }
  if (artifact === null) {
    fail('STRUCTURE_COMPILE_ARTIFACT_MISSING', 'activated_compile_artifact_missing', {
      plan_key: plan.plan_key, plan_version: plan.plan_version,
    });
  }
  if (binding.project_id !== plan.project_id || binding.plan_key !== plan.plan_key
    || binding.plan_version !== plan.plan_version || binding.topology_digest !== plan.topology_digest
    || binding.compile_artifact_digest !== artifact.artifact_digest
    || binding.compiled_head_sha !== artifact.current_head_sha
    || binding.structure_set_digest !== artifact.structure_set_digest) {
    fail('STRUCTURE_BINDING_CORRUPT', 'binding_source_artifact_mismatch');
  }

  const currentHeadSha = resolveCurrentHead(repoRoot, options.resolveHead);
  const realizationHeads = await currentRealizationHeads(repoRoot, source);
  const realizationHeadDigest = digestTodoStructureRealizationHeads(realizationHeads);
  const staleReasons = [];
  if (artifact.current_head_sha !== currentHeadSha) staleReasons.push('current_head_sha');
  if (artifact.topology_digest !== plan.topology_digest) staleReasons.push('topology_digest');
  if (artifact.structure_set_digest !== source.structure_set_digest) staleReasons.push('structure_set_digest');
  if (artifact.realization_head_digest !== realizationHeadDigest) staleReasons.push('realization_head_digest');
  return projectState({
    status: staleReasons.length === 0 ? 'fresh' : 'stale',
    reason: staleReasons.length === 0 ? null : 'freshness_key_changed',
    plan, source, binding, artifact, staleReasons,
  });
}

/**
 * terminal gateが読むfinalizationの鮮度。sensorやdiffを再実行せず、保存artifactを
 * active plan/source、現在HEAD、現在realization headsへexactに照合する。
 */
export async function readTodoStructureFinalizationState(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const store = options.store ?? await readTodoStore({ repoRoot, now: options.now });
  const member = store.members.find(({ plan }) => plan.plan_key === options.planKey);
  if (member === undefined) fail('STRUCTURE_PLAN_NOT_FOUND', 'plan_not_active', {
    plan_key: options.planKey,
  });
  const plan = member.plan;
  const binding = await readTodoStructureBinding({
    repoRoot, planKey: plan.plan_key, planVersion: plan.plan_version,
  });
  if (binding === null) return {
    schema: 'lattice.todo_structure_finalization_state.v1',
    plan_key: plan.plan_key, plan_version: plan.plan_version,
    enabled: false, required: false, status: 'not_applicable', reason: 'structure_not_enabled',
    finalization_digest: null, stale_reasons: [], artifact: null,
  };
  const source = await readTodoStructureSource({ repoRoot, planKey: plan.plan_key });
  if (source === null || source.structure_set_digest !== binding.structure_set_digest) {
    fail('STRUCTURE_SOURCE_MISSING', 'activated_planned_source_missing', {
      plan_key: plan.plan_key, plan_version: plan.plan_version,
    });
  }
  const terminalClosed = Array.isArray(member.phases) && member.phases.length > 0
    && member.phases.every(({ status }) => ['accepted', 'closed_unaudited'].includes(status));
  const required = member.tasks.every(({ status }) => status === 'done') && !terminalClosed;
  const artifact = await readTodoStructureFinalization({
    repoRoot, planKey: plan.plan_key, planVersion: plan.plan_version,
  });
  if (artifact === null) return {
    schema: 'lattice.todo_structure_finalization_state.v1',
    plan_key: plan.plan_key, plan_version: plan.plan_version,
    enabled: true, required,
    status: required ? 'missing' : terminalClosed ? 'complete' : 'not_ready',
    reason: required ? 'finalization_missing' : terminalClosed ? 'terminal_closed' : 'tasks_incomplete',
    finalization_digest: null, stale_reasons: [], artifact: null,
  };
  const currentHeadSha = resolveCurrentHead(repoRoot, options.resolveHead);
  const realizationHeads = await currentRealizationHeads(repoRoot, source);
  const staleReasons = [];
  if (artifact.project_id !== plan.project_id) staleReasons.push('project_id');
  if (artifact.plan_key !== plan.plan_key) staleReasons.push('plan_key');
  if (artifact.plan_version !== plan.plan_version) staleReasons.push('plan_version');
  if (artifact.topology_digest !== plan.topology_digest) staleReasons.push('topology_digest');
  if (artifact.structure_set_digest !== source.structure_set_digest) {
    staleReasons.push('structure_set_digest');
  }
  if (artifact.current_head_sha !== currentHeadSha) staleReasons.push('current_head_sha');
  if (artifact.realization_head_digest
    !== digestTodoStructureRealizationHeads(realizationHeads)) {
    staleReasons.push('realization_head_digest');
  }
  if (artifact.overlay.verdict !== 'consistent') staleReasons.push('verdict');
  return {
    schema: 'lattice.todo_structure_finalization_state.v1',
    plan_key: plan.plan_key, plan_version: plan.plan_version,
    enabled: true, required,
    status: staleReasons.length === 0 ? 'fresh' : 'stale',
    reason: staleReasons.length === 0 ? null : 'freshness_key_changed',
    finalization_digest: artifact.artifact_digest,
    stale_reasons: staleReasons.sort(compareText), artifact,
  };
}

/** todo/project statusへ載せる、終端を保留しているplanだけのbounded入力。 */
export async function readTodoStructureFinalizationsForStatus(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const store = options.store ?? await readTodoStore({ repoRoot, now: options.now });
  const entries = [];
  for (const member of store.members) {
    const state = await readTodoStructureFinalizationState({
      repoRoot, store, planKey: member.plan.plan_key,
    });
    if (!state.required || state.status === 'fresh') continue;
    entries.push({
      plan_key: member.plan.plan_key,
      status: state.status,
      reason: state.reason,
      stale_reasons: state.stale_reasons,
      next_commands: [`lattice todo structure finalize --plan ${member.plan.plan_key} --json`],
    });
  }
  return entries.sort((left, right) => compareText(left.plan_key, right.plan_key));
}

/**
 * 保存済みstructure artifactの破損を、status／verifyが成功扱いへ丸めずに
 * 利用者へ渡すためのbounded診断。入力の推測や修理は行わず、既存の
 * structure input writerへ戻す次の一手だけを示す。
 */
export async function readTodoStructureArtifactDiagnostics(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const store = options.store ?? await readTodoStore({ repoRoot, now: options.now });
  const diagnostics = [];
  for (const member of store.members) {
    const planKey = member.plan.plan_key;
    const planVersion = member.plan.plan_version;
    try {
      await readTodoStructureState({ repoRoot, store, planKey });
      await readTodoStructureFinalizationState({ repoRoot, store, planKey });
    } catch (error) {
      const refs = {
        INVALID_TODO_STRUCTURE_SET: todoStructureSourceRef(planKey),
        INVALID_TODO_STRUCTURE_BINDING: todoStructureBindingRef(planKey, planVersion),
        INVALID_TODO_STRUCTURE_COMPILE_ARTIFACT:
          todoStructureCompileArtifactRef(planKey, planVersion),
        INVALID_TODO_STRUCTURE_FINALIZATION:
          todoStructureFinalizationRef(planKey, planVersion),
      };
      const artifactPath = refs[error?.code];
      if (artifactPath === undefined) throw error;
      const reason = error?.detail?.reason ?? error?.message ?? 'structure_artifact_invalid';
      diagnostics.push({
        plan_key: planKey,
        artifact_path: artifactPath,
        reason,
        next_command: `lattice todo structure input --plan ${planKey} --input <corrected-structure-set.json> --dry-run --json`,
      });
    }
  }
  return diagnostics;
}

function validateTaskMigration(taskMigration) {
  if (!Array.isArray(taskMigration) || taskMigration.length === 0) {
    fail('STRUCTURE_MIGRATION_INVALID', 'task_migration_missing');
  }
  const from = new Set(); const to = new Set();
  for (const entry of taskMigration) {
    if (!exactRecord(entry, ['from_task_id', 'to_task_id', 'state_policy'])
      || typeof entry.from_task_id !== 'string' || typeof entry.to_task_id !== 'string'
      || from.has(entry.from_task_id)
      || (entry.to_task_id !== 'removed' && to.has(entry.to_task_id))) {
      fail('STRUCTURE_MIGRATION_INVALID', 'task_migration_invalid');
    }
    from.add(entry.from_task_id);
    if (entry.to_task_id !== 'removed') to.add(entry.to_task_id);
  }
  return new Map(taskMigration.map((entry) => [entry.from_task_id, entry.to_task_id]));
}

/**
 * plan revisionの一対一task migrationをstructure sourceへ機械転記する。
 * ID以外は維持するが、意味が新planでも妥当だという判定は返さない。
 */
export function migrateTodoStructureSetTaskIds({ structureSet, taskMigration, successorPlan } = {}) {
  const source = explainTodoStructureSet(structureSet);
  if (!source.valid) fail('STRUCTURE_MIGRATION_INVALID', source.reason, { path: source.path });
  if (!validateTodoPlan(successorPlan)
    || successorPlan.project_id !== structureSet.project_id
    || successorPlan.plan_key !== structureSet.plan_key) {
    fail('STRUCTURE_MIGRATION_INVALID', 'successor_plan_invalid');
  }
  const mapping = validateTaskMigration(taskMigration);
  const successorIds = new Set(successorPlan.tasks.map(({ task_id: id }) => id));
  const resolve = (taskId) => {
    const target = mapping.get(taskId) ?? (successorIds.has(taskId) ? taskId : undefined);
    if (target === undefined || target === 'removed') {
      fail('STRUCTURE_MIGRATION_UNRESOLVED', 'task_reference_removed_or_unresolved', {
        task_id: taskId,
      });
    }
    if (!successorIds.has(target)) {
      fail('STRUCTURE_MIGRATION_UNRESOLVED', 'task_target_absent', { task_id: target });
    }
    return target;
  };
  const tasks = [];
  for (const task of structureSet.tasks) {
    const target = mapping.get(task.task_id) ?? (successorIds.has(task.task_id) ? task.task_id : undefined);
    if (target === 'removed') continue;
    if (target === undefined || !successorIds.has(target)) {
      fail('STRUCTURE_MIGRATION_UNRESOLVED', 'structure_task_unresolved', { task_id: task.task_id });
    }
    const migrated = structuredClone(task);
    migrated.task_id = target;
    if (migrated.applicability === 'graph') {
      for (const input of migrated.planned.inputs) {
        if (input.source.kind === 'task_output') input.source.task_id = resolve(input.source.task_id);
      }
      for (const output of migrated.planned.outputs) {
        for (const sink of output.sinks) {
          if (sink.kind === 'task') sink.task_id = resolve(sink.task_id);
        }
      }
    }
    tasks.push(migrated);
  }
  tasks.sort((left, right) => compareText(left.task_id, right.task_id));
  if (new Set(tasks.map(({ task_id: id }) => id)).size !== tasks.length || tasks.length === 0) {
    fail('STRUCTURE_MIGRATION_INVALID', 'migrated_task_set_invalid');
  }
  const migrated = {
    ...structuredClone(structureSet),
    plan_version: successorPlan.plan_version,
    topology_digest: successorPlan.topology_digest,
    tasks,
    structure_set_digest: '',
  };
  migrated.structure_set_digest = todoSelfDigest(migrated, 'structure_set_digest');
  const explained = explainTodoStructureSet(migrated);
  if (!explained.valid) {
    fail('STRUCTURE_MIGRATION_INVALID', explained.reason, { path: explained.path });
  }
  return {
    structure_set: migrated,
    semantic_validation: 'required',
    copied_task_ids: tasks.map(({ task_id: id }) => id),
    source_structure_set_digest: structureSet.structure_set_digest,
    task_migration_digest: todoSelfDigest({
      schema: 'lattice.todo_structure_task_migration.v1',
      task_migration: taskMigration,
      task_migration_digest: '',
    }, 'task_migration_digest'),
    result_digest: todoSelfDigest({
      schema: 'lattice.todo_structure_migration_result.v1',
      structure_set_digest: migrated.structure_set_digest,
      semantic_validation: 'required',
      task_migration: taskMigration,
      result_digest: '',
    }, 'result_digest'),
  };
}
