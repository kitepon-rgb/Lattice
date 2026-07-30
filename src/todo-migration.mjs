import {
  TODO_LIMITS,
  exactRecord,
  isStrictTodoTimestamp,
  isTodoDigest,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
} from './todo-contracts.mjs';
import {
  TodoStoreError,
  appendImportedPlan,
  createTodoStoreWriter,
} from './todo-store.mjs';

export const TODO_EXTRACTION_SCHEMA = 'lattice.todo_extraction.v1';
export const TODO_EXTRACTION_SCHEMA_V2 = 'lattice.todo_extraction.v2';

const V1_DISPOSITIONS = new Set([
  'register_pending',
  'register_done',
  'exclude_superseded',
  'exclude_compatibility_record',
  'unknown_requires_evidence',
]);
const V2_DISPOSITIONS = new Set([...V1_DISPOSITIONS, 'register_in_progress']);
const CHECKBOX_STATES = new Set(['checked', 'unchecked', 'absent', 'ambiguous']);
const COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function boundedText(value, maximumBytes = 16_384) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maximumBytes;
}

function nullableText(value) {
  return value === null || boundedText(value);
}

function actor(value) {
  return exactRecord(value, ['host', 'session', 'agent'])
    && [value.host, value.session, value.agent].every(isTodoIdentifier);
}

function nodeRef(value) {
  return (exactRecord(value, ['project_id', 'plan_key', 'task_id'])
    || exactRecord(value, ['project_id', 'plan_key', 'task_id', 'expected_topology_digest']))
    && isTodoIdentifier(value.project_id) && isTodoIdentifier(value.plan_key)
    && isTodoIdentifier(value.task_id)
    && (value.expected_topology_digest === undefined || isTodoDigest(value.expected_topology_digest));
}

function refKey(value) {
  return `${value.project_id}\0${value.plan_key}\0${value.task_id}`;
}

function sortedStrictly(values, key = (value) => value) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}

function sourceLocation(value) {
  return exactRecord(value, [
    'origin_plan_ref', 'origin_line', 'source_commit', 'heading_path', 'markdown_depth',
    'parent_task_id', 'checkbox_state',
  ]) && isTodoRef(value.origin_plan_ref) && Number.isSafeInteger(value.origin_line) && value.origin_line >= 1
    && COMMIT_OID.test(value.source_commit)
    && Array.isArray(value.heading_path) && value.heading_path.length <= 32
    && value.heading_path.every((part) => boundedText(part, 1_024))
    && Number.isSafeInteger(value.markdown_depth) && value.markdown_depth >= 0 && value.markdown_depth <= 64
    && (value.parent_task_id === null || isTodoIdentifier(value.parent_task_id))
    && CHECKBOX_STATES.has(value.checkbox_state);
}

function migrationContext(value) {
  return exactRecord(value, [
    'external_canonical_ref', 'carry_over_ref', 'h_required', 'condition', 'evidence_refs', 'notes',
  ]) && nullableText(value.external_canonical_ref) && nullableText(value.carry_over_ref)
    && typeof value.h_required === 'boolean' && nullableText(value.condition)
    && Array.isArray(value.evidence_refs) && value.evidence_refs.length <= 64
    && value.evidence_refs.every((entry) => boundedText(entry, 4_096))
    && Array.isArray(value.notes) && value.notes.length <= 64
    && value.notes.every((entry) => boundedText(entry, 4_096));
}

function completion(value) {
  return exactRecord(value, ['done_mode', 'completed_at'])
    && value.done_mode === 'historical_import'
    && (value.completed_at === 'unknown_requires_evidence' || isStrictTodoTimestamp(value.completed_at));
}

function historicalStart(value) {
  return exactRecord(value, ['start_mode', 'status', 'started_at'])
    && value.start_mode === 'historical_import' && value.status === 'in-progress'
    && (value.started_at === 'unknown_requires_evidence' || isStrictTodoTimestamp(value.started_at));
}

function extractionTask(value, schema) {
  const v2 = schema === TODO_EXTRACTION_SCHEMA_V2;
  const keys = [
    'task_id', 'title', 'lane', 'narrative_ref', 'compile_binding', 'disposition',
    'completion', 'source', 'migration_context',
  ];
  if (v2) keys.push('start');
  if (!exactRecord(value, keys) || !isTodoIdentifier(value.task_id) || !boundedText(value.title)
    || !isTodoIdentifier(value.lane) || (value.narrative_ref !== null && !isTodoRef(value.narrative_ref))
    || value.compile_binding !== null || !(v2 ? V2_DISPOSITIONS : V1_DISPOSITIONS).has(value.disposition)
    || !sourceLocation(value.source) || !migrationContext(value.migration_context)) return false;
  if (!v2) return value.disposition === 'register_done' ? completion(value.completion) : value.completion === null;
  if (value.disposition === 'register_done') return value.start === null && completion(value.completion);
  if (value.disposition === 'register_in_progress') {
    return historicalStart(value.start) && value.completion === null;
  }
  return value.start === null && value.completion === null;
}

function validateEdges(value) {
  return Array.isArray(value) && value.length <= TODO_LIMITS.edgesPerPlan
    && value.every((edge) => exactRecord(edge, ['from', 'to']) && nodeRef(edge.from) && nodeRef(edge.to))
    && sortedStrictly(value, (edge) => `${refKey(edge.from)}\0${refKey(edge.to)}`);
}

function validateJoins(value) {
  return Array.isArray(value) && value.length <= TODO_LIMITS.joinsPerPlan
    && value.every((join) => exactRecord(join, ['id', 'after', 'before'])
      && isTodoIdentifier(join.id) && Array.isArray(join.after) && join.after.length > 0
      && join.after.length <= TODO_LIMITS.tasksPerPlan && join.after.every(nodeRef)
      && sortedStrictly(join.after, refKey) && nodeRef(join.before))
    && sortedStrictly(value, (join) => join.id);
}

const reject = (reason, path = '') => ({ valid: false, reason, path });

/** value自体がexactRecordの対象になれる素朴なobjectかどうか（配列・nullを除く）。 */
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 期待keyとの過不足を1件ずつ言い当てる。missing/unexpectedのどちらが先に見つかっても
 * そこで止め、複数の欠落を一度に説明しない——`exactRecord`のbooleanと違い、
 * 最初に見つかった違反fieldをpathへ刻む。
 */
function explainKeys(value, requiredKeys, at) {
  if (!plainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return reject('not_an_object', at);
  }
  const actualKeys = new Set(Object.keys(value));
  for (const key of requiredKeys) {
    if (!actualKeys.has(key)) return reject('missing_required_key', `${at}/${key}`);
  }
  const requiredSet = new Set(requiredKeys);
  for (const key of actualKeys) {
    if (!requiredSet.has(key)) return reject('unexpected_key', `${at}/${key}`);
  }
  return { valid: true };
}

function explainSortedStrictly(values, key, at) {
  for (let index = 1; index < values.length; index += 1) {
    if (!(key(values[index - 1]) < key(values[index]))) {
      return reject('unsorted_or_duplicate_collection', `${at}/${index}`);
    }
  }
  return { valid: true };
}

/**
 * `lattice.todo_extraction.v1/v2`を、既存の`validateTodoExtraction`の可否は変えずに
 * 診断する（ADR 0130の案内規律をmigration入口へ拡張）。
 *
 * 深いgraph整合（親task解決・edge/join local参照解決）はここでは個別に言い当てず、
 * 単一のreasonへ丸める——既知の実運用の詰まりどころ（必須key欠落・task/edge/joinの
 * ソート違反・digest不一致）を優先して解消する。それでも掴めない違反は
 * `diagnosis_incomplete`として正直に返す。
 */
export function explainTodoExtraction(value) {
  try {
    if (!plainObject(value)) return reject('not_an_object', '');
    const schema = value.schema;
    if (![TODO_EXTRACTION_SCHEMA, TODO_EXTRACTION_SCHEMA_V2].includes(schema)) {
      return reject('schema_mismatch', '/schema');
    }
    const v2 = schema === TODO_EXTRACTION_SCHEMA_V2;
    const topKeys = [
      'schema', 'project_id', 'plan_key', 'plan_version', 'actor', 'recorded_at',
      'tasks', 'hard_dependencies', 'joins', 'extraction_digest',
    ];
    const topKeyCheck = explainKeys(value, topKeys, '');
    if (!topKeyCheck.valid) return topKeyCheck;
    if (!isTodoIdentifier(value.project_id)) return reject('invalid_identifier', '/project_id');
    if (!isTodoIdentifier(value.plan_key)) return reject('invalid_identifier', '/plan_key');
    if (!isTodoIdentifier(value.plan_version)) return reject('invalid_identifier', '/plan_version');
    if (!actor(value.actor)) return reject('invalid_actor', '/actor');
    if (!isStrictTodoTimestamp(value.recorded_at)) return reject('invalid_timestamp', '/recorded_at');
    if (!Array.isArray(value.tasks) || value.tasks.length === 0
      || value.tasks.length > TODO_LIMITS.tasksPerPlan) {
      return reject('bounded_collection_violation', '/tasks');
    }
    const taskKeys = v2
      ? ['task_id', 'title', 'lane', 'narrative_ref', 'compile_binding', 'disposition',
        'start', 'completion', 'source', 'migration_context']
      : ['task_id', 'title', 'lane', 'narrative_ref', 'compile_binding', 'disposition',
        'completion', 'source', 'migration_context'];
    for (const [index, task] of value.tasks.entries()) {
      const taskKeyCheck = explainKeys(task, taskKeys, `/tasks/${index}`);
      if (!taskKeyCheck.valid) return taskKeyCheck;
      if (!extractionTask(task, schema)) {
        return reject('task_shape_invalid', `/tasks/${index}`);
      }
    }
    const sortCheck = explainSortedStrictly(value.tasks, (task) => task.task_id, '/tasks');
    if (!sortCheck.valid) return sortCheck;
    if (new Set(value.tasks.map(({ task_id: taskId }) => taskId)).size !== value.tasks.length) {
      return reject('duplicate_task_id', '/tasks');
    }
    if (!validateEdges(value.hard_dependencies)) return reject('hard_dependencies_invalid', '/hard_dependencies');
    if (!validateJoins(value.joins)) return reject('joins_invalid', '/joins');
    if (!isTodoDigest(value.extraction_digest)) return reject('invalid_digest', '/extraction_digest');
    const expectedDigest = todoSelfDigest(value, 'extraction_digest');
    if (value.extraction_digest !== expectedDigest) {
      return reject('extraction_digest_mismatch', '/extraction_digest');
    }
    const taskIds = new Set(value.tasks.map(({ task_id: taskId }) => taskId));
    const badParent = value.tasks.find((task) => task.source.parent_task_id === task.task_id
      || (task.source.parent_task_id !== null && !taskIds.has(task.source.parent_task_id)));
    if (badParent !== undefined) {
      return reject('parent_task_id_unresolved',
        `/tasks/${value.tasks.indexOf(badParent)}/source/parent_task_id`);
    }
    if (!localRefsResolve(value)) return reject('local_ref_unresolved', '');
    // ここまでの個別検査を全て通過したのに`validateTodoExtraction`がfalseを返す状況は、
    // このexplainがまだ言い当てられない違反があるということ。捏造せず未特定と申告する。
    return { valid: true };
  } catch {
    return reject('diagnosis_failed', '');
  }
}

function registeredTaskIds(value) {
  return new Set(value.tasks
    .filter(({ disposition }) => disposition.startsWith('register_'))
    .map(({ task_id }) => task_id));
}

function localRefsResolve(value) {
  const registered = registeredTaskIds(value);
  const local = (ref) => ref.project_id !== value.project_id || ref.plan_key !== value.plan_key
    || registered.has(ref.task_id);
  return value.hard_dependencies.every((edge) => local(edge.from) && local(edge.to))
    && value.joins.every((join) => local(join.before) && join.after.every(local));
}

/** Exact, bounded validation for the AI-authored G4 intermediate artifact. */
export function validateTodoExtraction(value) {
  try {
    const schema = value?.schema;
    if (!exactRecord(value, [
      'schema', 'project_id', 'plan_key', 'plan_version', 'actor', 'recorded_at',
      'tasks', 'hard_dependencies', 'joins', 'extraction_digest',
    ]) || ![TODO_EXTRACTION_SCHEMA, TODO_EXTRACTION_SCHEMA_V2].includes(schema)
      || !isTodoIdentifier(value.project_id)
      || !isTodoIdentifier(value.plan_key) || !isTodoIdentifier(value.plan_version)
      || !actor(value.actor) || !isStrictTodoTimestamp(value.recorded_at)
      || !Array.isArray(value.tasks) || value.tasks.length === 0
      || value.tasks.length > TODO_LIMITS.tasksPerPlan
      || !value.tasks.every((task) => extractionTask(task, schema))
      || !sortedStrictly(value.tasks, (task) => task.task_id)
      || new Set(value.tasks.map(({ task_id }) => task_id)).size !== value.tasks.length
      || !validateEdges(value.hard_dependencies) || !validateJoins(value.joins)
      || !isTodoDigest(value.extraction_digest)
      || value.extraction_digest !== todoSelfDigest(value, 'extraction_digest')) return false;

    const taskIds = new Set(value.tasks.map(({ task_id }) => task_id));
    if (value.tasks.some((task) => task.source.parent_task_id === task.task_id
      || (task.source.parent_task_id !== null && !taskIds.has(task.source.parent_task_id)))) return false;
    return localRefsResolve(value);
  } catch {
    return false;
  }
}

export function todoExtractionImportSource(task) {
  return {
    schema: 'lattice.todo_import_source.v1',
    origin_plan_ref: task.source.origin_plan_ref,
    origin_line: task.source.origin_line,
    source_commit: task.source.source_commit,
  };
}

/**
 * Translate an already-extracted artifact into appendImportedPlan input.
 * Source locations are passed to the importer but no Markdown is read here.
 * Unresolved records stop the whole transaction so the owner can adjudicate
 * the JSON and rerun the same command.
 */
export function compileTodoExtraction(value, repoRoot) {
  if (!validateTodoExtraction(value)) {
    throw new TodoStoreError('INVALID_TODO_EXTRACTION', 'schema_invalid');
  }
  const unresolved = value.tasks
    .filter(({ disposition }) => disposition === 'unknown_requires_evidence')
    .map(({ task_id }) => task_id);
  if (unresolved.length > 0) {
    throw new TodoStoreError('MIGRATION_UNRESOLVED', 'unknown_requires_evidence', undefined, {
      task_ids: unresolved,
    });
  }

  const registered = value.tasks.filter(({ disposition }) => disposition.startsWith('register_'));
  if (registered.length === 0) {
    throw new TodoStoreError('MIGRATION_EMPTY', 'no_registered_tasks');
  }
  return {
    repoRoot,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    initializeIfMissing: {
      projectId: value.project_id,
      repositories: [{ repo_id: 'self', path: '.' }],
    },
    plan: {
      schema: 'lattice.todo_plan.v2',
      project_id: value.project_id,
      plan_key: value.plan_key,
      plan_version: value.plan_version,
      predecessor_plan_digest: null,
      tasks: registered.map((task) => ({
        task_id: task.task_id,
        title: task.title,
        lane: task.lane,
        narrative_ref: task.narrative_ref,
        narrative_anchor: null,
        compile_binding: null,
      })),
      hard_dependencies: value.hard_dependencies,
      joins: value.joins,
    },
    narrativeAnchorSources: registered.map((task) => ({
      task_id: task.task_id,
      origin_plan_ref: task.source.origin_plan_ref,
      origin_line: task.source.origin_line,
      source_commit: task.source.source_commit,
      checkbox_state: task.source.checkbox_state,
    })),
    genesis: {
      actor: value.actor,
      recorded_at: value.recorded_at,
      provenance: null,
    },
    completedTasks: registered
      .filter(({ disposition }) => disposition === 'register_done')
      .map((task) => ({
        task_id: task.task_id,
        completed_at: task.completion.completed_at,
        evidence: todoExtractionImportSource(task),
      })),
    inProgressTasks: registered
      .filter(({ disposition }) => disposition === 'register_in_progress')
      .map((task) => ({
        task_id: task.task_id,
        started_at: task.start.started_at,
        evidence: todoExtractionImportSource(task),
      })),
  };
}

export async function appendTodoExtraction({ repoRoot, extraction }) {
  const request = compileTodoExtraction(extraction, repoRoot);
  return appendImportedPlan(request);
}
