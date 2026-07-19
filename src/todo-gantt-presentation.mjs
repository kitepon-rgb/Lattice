import {
  lstat, readFile, realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

import {
  digestTodoArtifact,
  exactRecord,
  isTodoIdentifier,
} from './todo-contracts.mjs';
import { TodoStoreError } from './todo-store.mjs';

export const TODO_GANTT_PRESENTATION_REF = '.lattice/todo/gantt-presentation.json';
export const TODO_GANTT_PRESENTATION_SCHEMA = 'lattice.todo_gantt_presentation.v1';
export const TODO_GANTT_PRESENTATION_MODEL_SCHEMA = 'lattice.todo_gantt_presentation_model.v1';

const MAX_PRESENTATION_BYTES = 64 * 1_024;
const MAX_PLANS = 256;
const MAX_LANES_PER_PLAN = 256;
const MAX_NAME_BYTES = 256;
const MAX_DESCRIPTION_BYTES = 2_048;
const MAX_TASK_NUMBER_DIGITS = 12;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const NUMERIC_SUFFIX = /(\d+)$/u;

function fail(reason, detail = {}) {
  throw new TodoStoreError('PRESENTATION_INVALID', reason, undefined, detail);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function boundedText(value, maximumBytes) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    && !CONTROL.test(value) && Buffer.byteLength(value, 'utf8') <= maximumBytes;
}

function hasDuplicateJsonKey(node) {
  if (node?.type === 'object') {
    const keys = new Set();
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? [];
      if (keys.has(key?.value) || hasDuplicateJsonKey(value)) return true;
      keys.add(key?.value);
    }
  } else if (node?.type === 'array') {
    return (node.children ?? []).some(hasDuplicateJsonKey);
  }
  return false;
}

function validateDocument(value) {
  if (!exactRecord(value, ['schema', 'project_id', 'plans'])
    || value.schema !== TODO_GANTT_PRESENTATION_SCHEMA
    || !isTodoIdentifier(value.project_id)
    || !Array.isArray(value.plans) || value.plans.length > MAX_PLANS) {
    fail('presentation_schema_invalid');
  }
  const planKeys = new Set();
  for (const plan of value.plans) {
    if (!exactRecord(plan, ['plan_key', 'lanes']) || !isTodoIdentifier(plan.plan_key)
      || !Array.isArray(plan.lanes) || plan.lanes.length > MAX_LANES_PER_PLAN) {
      fail('presentation_schema_invalid');
    }
    if (planKeys.has(plan.plan_key)) fail('presentation_plan_duplicate', { plan_key: plan.plan_key });
    planKeys.add(plan.plan_key);
    const lanes = new Set();
    for (const lane of plan.lanes) {
      if (!exactRecord(lane, ['lane', 'name', 'description']) || !isTodoIdentifier(lane.lane)
        || !boundedText(lane.name, MAX_NAME_BYTES)
        || !boundedText(lane.description, MAX_DESCRIPTION_BYTES)) {
        fail('presentation_schema_invalid');
      }
      if (lanes.has(lane.lane)) {
        fail('presentation_lane_duplicate', { plan_key: plan.plan_key, lane: lane.lane });
      }
      lanes.add(lane.lane);
    }
  }
  return value;
}

function normalizedTaskNumber(taskId) {
  const suffix = NUMERIC_SUFFIX.exec(taskId)?.[1] ?? null;
  if (suffix === null || suffix.length > MAX_TASK_NUMBER_DIGITS) return null;
  return { display_number: suffix, normalized_number: suffix.replace(/^0+(?=\d)/u, '') };
}

function taskNumberBindings(readModel) {
  const candidatesByPlan = new Map();
  for (const member of readModel.members) {
    const plan = member?.plan;
    for (const task of plan?.tasks ?? []) {
      const candidate = normalizedTaskNumber(task.task_id);
      if (candidate === null) continue;
      const planKey = JSON.stringify([plan.project_id, plan.plan_key]);
      if (!candidatesByPlan.has(planKey)) candidatesByPlan.set(planKey, new Map());
      const byNumber = candidatesByPlan.get(planKey);
      if (!byNumber.has(candidate.normalized_number)) byNumber.set(candidate.normalized_number, []);
      byNumber.get(candidate.normalized_number).push({
        project_id: plan.project_id,
        plan_key: plan.plan_key,
        task_id: task.task_id,
        ...candidate,
      });
    }
  }
  const bindings = [];
  for (const byNumber of candidatesByPlan.values()) {
    for (const candidates of byNumber.values()) if (candidates.length === 1) bindings.push(candidates[0]);
  }
  const globalCounts = new Map();
  for (const binding of bindings) {
    globalCounts.set(binding.normalized_number, (globalCounts.get(binding.normalized_number) ?? 0) + 1);
  }
  return bindings.map((binding) => ({
    ...binding,
    globally_unique: globalCounts.get(binding.normalized_number) === 1,
  })).sort((left, right) => compareText(left.project_id, right.project_id)
    || compareText(left.plan_key, right.plan_key)
    || compareText(left.task_id, right.task_id));
}

export function projectTodoGanttPresentation(readModel, document) {
  if (!exactRecord(readModel, ['schema', 'project_id', 'manifest', 'members', 'snapshot_stale'])
    && !(readModel?.schema === 'lattice.todo_store_read.v1'
      && isTodoIdentifier(readModel.project_id) && Array.isArray(readModel.members))) {
    throw new TypeError('readModel must be lattice.todo_store_read.v1');
  }
  if (document !== null) validateDocument(document);
  if (document !== null && document.project_id !== readModel.project_id) {
    fail('presentation_project_mismatch', {
      expected_project_id: readModel.project_id,
      actual_project_id: document.project_id,
    });
  }

  const planLanes = new Map();
  for (const member of readModel.members) {
    const plan = member?.plan;
    if (!isTodoIdentifier(plan?.project_id) || !isTodoIdentifier(plan?.plan_key)
      || !Array.isArray(plan?.tasks)) throw new TypeError('readModel member plan is invalid');
    planLanes.set(plan.plan_key, new Set(plan.tasks.map(({ lane }) => lane)));
  }

  const lanes = [];
  for (const plan of document?.plans ?? []) {
    const knownLanes = planLanes.get(plan.plan_key);
    if (knownLanes === undefined) fail('presentation_plan_unknown', { plan_key: plan.plan_key });
    for (const lane of plan.lanes) {
      if (!knownLanes.has(lane.lane)) {
        fail('presentation_lane_unknown', { plan_key: plan.plan_key, lane: lane.lane });
      }
      lanes.push({ plan_key: plan.plan_key, ...lane });
    }
  }
  lanes.sort((left, right) => compareText(left.plan_key, right.plan_key)
    || compareText(left.lane, right.lane));

  const model = {
    schema: TODO_GANTT_PRESENTATION_MODEL_SCHEMA,
    project_id: readModel.project_id,
    configured: document !== null,
    lanes,
    task_numbers: taskNumberBindings(readModel),
  };
  return { ...model, presentation_digest: digestTodoArtifact(model) };
}

async function readDocument(repoRoot) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, TODO_GANTT_PRESENTATION_REF);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) fail('presentation_path_outside_repo');
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('presentation_unreadable');
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_PRESENTATION_BYTES) {
    fail(stats.size > MAX_PRESENTATION_BYTES
      ? 'presentation_size_limit_exceeded' : 'presentation_path_unsafe');
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) fail('presentation_path_unsafe');
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_PRESENTATION_BYTES) fail('presentation_size_limit_exceeded');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('presentation_invalid_utf8');
  }
  const errors = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (errors.length > 0 || tree === undefined) fail('presentation_json_parse_failed');
  if (hasDuplicateJsonKey(tree)) fail('presentation_duplicate_key');
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail('presentation_json_parse_failed');
  }
  return validateDocument(document);
}

export async function loadTodoGanttPresentation({ repoRoot, readModel }) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new TypeError('repoRoot is required');
  return projectTodoGanttPresentation(readModel, await readDocument(repoRoot));
}
