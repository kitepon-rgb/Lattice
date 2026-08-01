import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalizeTodoArtifact, todoSelfDigest } from '../../src/todo-contracts.mjs';
import {
  todoLegacyReconciliationDigest,
  todoReconciliationDigest,
  todoRevisionPlanVersion,
  todoSourceInventoryDigest,
} from '../../src/todo-revision.mjs';
import { buildTodoPlan } from '../../src/todo-store.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const planKey = 'ai-safe-terminal-audit-fixes';
const manifest = JSON.parse(await readFile(path.join(repoRoot, '.lattice/todo/manifest.json'), 'utf8'));
const member = manifest.members.find((entry) => entry.plan_key === planKey);
if (member === undefined) throw new Error(`${planKey} is not active`);
const previousPlan = JSON.parse(await readFile(path.join(repoRoot, member.plan_ref), 'utf8'));
const extraction = JSON.parse(await readFile(
  path.join(repoRoot, '.lattice/ai-safe-terminal-audit-fixes-extraction.json'), 'utf8'));
const memoByTask = new Map(extraction.tasks.map((task) => [task.task_id, task.design_memo]));
const sourceByTask = new Map(extraction.tasks.map((task) => [task.task_id, task.source]));

const tasks = previousPlan.tasks.map((task) => {
  const designMemo = memoByTask.get(task.task_id);
  if (typeof designMemo !== 'string' || designMemo.trim() === '') {
    throw new Error(`design memo missing for ${task.task_id}`);
  }
  return { ...task, design_memo: designMemo };
});
const changedMemoIds = new Set(tasks.filter((task) => (
  previousPlan.tasks.find(({ task_id: taskId }) => taskId === task.task_id)?.design_memo
    !== task.design_memo
)).map(({ task_id: taskId }) => taskId));

const predecessor = {
  plan_digest: previousPlan.plan_digest,
  journal_head_digest: member.journal_head_digest,
  plan_version: previousPlan.plan_version,
};
const taskMigration = previousPlan.tasks.map(({ task_id: taskId }) => ({
  from_task_id: taskId,
  to_task_id: taskId,
  state_policy: changedMemoIds.has(taskId) ? 'carry_reconciled_metadata' : 'carry',
})).sort((left, right) => left.from_task_id.localeCompare(right.from_task_id, 'en'));

const sourceInventory = { active: [], excluded_tombstones: [] };
for (const task of tasks) {
  const source = sourceByTask.get(task.task_id);
  if (source === undefined) throw new Error(`source missing for ${task.task_id}`);
  const sourcePath = path.join(repoRoot, source.origin_plan_ref);
  const lines = (await readFile(sourcePath, 'utf8')).split('\n');
  const line = lines[source.origin_line - 1];
  if (line === undefined) throw new Error(`source line missing for ${task.task_id}`);
  sourceInventory.active.push({
    task_id: task.task_id,
    source_ref: `${source.origin_plan_ref}#L${source.origin_line}`,
    source_digest: createHash('sha256').update(Buffer.from(line, 'utf8')).digest('hex'),
  });
}

const desiredInput = {
  schema: previousPlan.schema,
  project_id: previousPlan.project_id,
  plan_key: previousPlan.plan_key,
  plan_version: 'pending',
  predecessor_plan_digest: previousPlan.plan_digest,
  tasks,
  hard_dependencies: previousPlan.hard_dependencies,
  joins: previousPlan.joins,
};
desiredInput.plan_version = todoRevisionPlanVersion({
  projectId: previousPlan.project_id,
  planKey: previousPlan.plan_key,
  predecessor,
  desiredPlan: desiredInput,
  taskMigration,
  sourceInventory,
});
const desiredPlan = buildTodoPlan(desiredInput);
const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
const predecessorReconciliationDigest = todoLegacyReconciliationDigest({
  planDigest: predecessor.plan_digest,
  journalHeadDigest: predecessor.journal_head_digest,
});
const reconciliation = {
  predecessor_reconciliation_digest: predecessorReconciliationDigest,
  source_inventory_digest: sourceInventoryDigest,
  reconciliation_digest: todoReconciliationDigest({
    predecessorReconciliationDigest,
    sourceInventoryDigest,
    predecessor,
    desiredPlanDigest: desiredPlan.plan_digest,
    taskMigration,
  }),
};
const revision = {
  schema: 'lattice.todo_revision.v1',
  project_id: previousPlan.project_id,
  plan_key: previousPlan.plan_key,
  predecessor,
  desired_plan: desiredPlan,
  task_migration: taskMigration,
  source_inventory: sourceInventory,
  reconciliation,
  revision_digest: '',
};
revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
const outputRef = path.join(repoRoot, '.lattice/import/ai-safe-terminal-audit-fixes-revision.json');
await writeFile(outputRef, `${canonicalizeTodoArtifact(revision)}\n`);
process.stdout.write(`${outputRef}\n`);
