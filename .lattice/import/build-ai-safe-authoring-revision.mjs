import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalizeTodoArtifact,
  todoSelfDigest,
} from '../../src/todo-contracts.mjs';
import {
  todoLegacyReconciliationDigest,
  todoReconciliationDigest,
  todoRevisionPlanVersion,
  todoSourceInventoryDigest,
} from '../../src/todo-revision.mjs';
import { buildTodoPlan } from '../../src/todo-store.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const planKey = 'ai-safe-todo-authoring';
const manifest = JSON.parse(await readFile(path.join(repoRoot, '.lattice/todo/manifest.json'), 'utf8'));
const member = manifest.members.find((entry) => entry.plan_key === planKey);
if (member === undefined) throw new Error(`${planKey} is not active`);
const previousPlan = JSON.parse(await readFile(path.join(repoRoot, member.plan_ref), 'utf8'));
const sourceRef = '.lattice/import/ai-safe-authoring-revision-source.md';
const sourceLines = (await readFile(path.join(repoRoot, sourceRef))).toString('utf8').split('\n');

const noteRefs = new Map(previousPlan.tasks.map(({ task_id: taskId }) => [
  taskId, `.lattice/import/notes/${taskId}.md`,
]));
noteRefs.set('static-gantt-retirement', '.lattice/import/notes/static-gantt-retirement.md');

const tasks = [];
for (const previous of previousPlan.tasks) {
  tasks.push({
    ...previous,
    design_memo: await readFile(path.join(repoRoot, noteRefs.get(previous.task_id)), 'utf8'),
    parent_task_id: null,
  });
}
if (!previousPlan.tasks.some(({ task_id: taskId }) => taskId === 'static-gantt-retirement')) {
  tasks.push({
    task_id: 'static-gantt-retirement',
    title: '静的Gantt HTML生成を廃止して動的dashboardへ一本化する',
    lane: 'main',
    design_memo: await readFile(path.join(repoRoot, noteRefs.get('static-gantt-retirement')), 'utf8'),
    narrative_ref: 'docs/plan_ai-safe-todo-authoring.md',
    narrative_anchor: null,
    compile_binding: null,
    parent_task_id: null,
  });
}
tasks.sort((left, right) => left.task_id.localeCompare(right.task_id, 'en'));

const ref = (taskId) => ({ project_id: 'lattice', plan_key: planKey, task_id: taskId });
const staticDependency = { from: ref('static-gantt-retirement'), to: ref('integration-release-smoke') };
const hardDependencies = previousPlan.hard_dependencies.some((dependency) => (
  canonicalizeTodoArtifact(dependency) === canonicalizeTodoArtifact(staticDependency)
)) ? [...previousPlan.hard_dependencies] : [...previousPlan.hard_dependencies, staticDependency];
hardDependencies.sort((left, right) => (
  canonicalizeTodoArtifact(left).localeCompare(canonicalizeTodoArtifact(right), 'en')
));

const predecessor = {
  plan_digest: previousPlan.plan_digest,
  journal_head_digest: member.journal_head_digest,
  plan_version: previousPlan.plan_version,
};
const taskMigration = previousPlan.tasks.map(({ task_id: taskId }) => ({
  from_task_id: taskId,
  to_task_id: taskId,
  state_policy: taskId === 'integration-release-smoke' ? 'reset_pending' : 'carry',
})).sort((left, right) => left.from_task_id.localeCompare(right.from_task_id, 'en'));
const sourceInventory = {
  active: tasks.map(({ task_id: taskId }) => {
    const line = sourceLines.findIndex((entry) => entry === `- [ ] ${taskId}`);
    if (line === -1) throw new Error(`source line missing for ${taskId}`);
    return {
      task_id: taskId,
      source_ref: `${sourceRef}#L${line + 1}`,
      source_digest: createHash('sha256').update(Buffer.from(sourceLines[line], 'utf8')).digest('hex'),
    };
  }),
  excluded_tombstones: [],
};
const desiredInput = {
  schema: 'lattice.todo_plan.v6',
  project_id: previousPlan.project_id,
  plan_key: previousPlan.plan_key,
  plan_version: 'pending',
  predecessor_plan_digest: previousPlan.plan_digest,
  tasks,
  hard_dependencies: hardDependencies,
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
const predecessorRevision = member.active_revision_digest === null ? null : JSON.parse(await readFile(
  path.join(repoRoot, path.dirname(member.plan_ref), 'revision.json'), 'utf8',
));
const predecessorReconciliationDigest = predecessorRevision === null
  ? todoLegacyReconciliationDigest({
    planDigest: predecessor.plan_digest,
    journalHeadDigest: predecessor.journal_head_digest,
  })
  : predecessorRevision.reconciliation.reconciliation_digest;
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
await writeFile(
  path.join(repoRoot, '.lattice/import/ai-safe-authoring-design-memo-revision.json'),
  `${canonicalizeTodoArtifact(revision)}\n`,
);
