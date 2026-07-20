import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildTodoPlan,
} from '../../src/todo-store.mjs';
import {
  canonicalizeTodoArtifact,
  todoSelfDigest,
} from '../../src/todo-contracts.mjs';
import {
  todoReconciliationDigest,
  todoRevisionPlanVersion,
  todoSourceInventoryDigest,
  validateTodoRevision,
} from '../../src/todo-revision.mjs';

const latticeRoot = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('todo/manifest.json', latticeRoot)));
const descriptor = manifest.members.find(({ plan_key: planKey }) => planKey === 'phase-control-live-gantt');
if (descriptor === undefined) throw new Error('active plan missing');
const activeRoot = new URL(`todo/plans/${descriptor.plan_key}/${descriptor.active_plan_version}/`, latticeRoot);
const currentPlan = JSON.parse(fs.readFileSync(new URL('plan.json', activeRoot)));
const currentRevision = JSON.parse(fs.readFileSync(new URL('revision.json', activeRoot)));
const currentSnapshot = JSON.parse(fs.readFileSync(new URL('snapshot.json', activeRoot)));
const ledgerRef = 'docs/archive/phase-scheduling-decoupling-authoring.md';
const ledger = fs.readFileSync(new URL(`../../${ledgerRef}`, import.meta.url), 'utf8').split('\n');
const taskId = 'lpg-018';
const line = 9;
const title = 'AIShell successorをv5へ移行し24 task waveと既存8 Phaseの維持を実測する';
if (ledger[line - 1] !== `- [ ] ${taskId} ${title}`) throw new Error('ledger line mismatch');
const tasks = currentPlan.tasks.map((task) => task.task_id === taskId ? { ...task, title } : task);
const predecessor = {
  journal_head_digest: currentSnapshot.journal_head_digest,
  plan_digest: currentPlan.plan_digest,
  plan_version: currentPlan.plan_version,
};
const taskMigration = currentPlan.tasks.map(({ task_id: currentTaskId }) => ({
  from_task_id: currentTaskId,
  state_policy: currentTaskId === taskId ? 'reset_pending' : 'carry',
  to_task_id: currentTaskId,
}));
const sourceInventory = {
  active: currentRevision.source_inventory.active.map((entry) => entry.task_id === taskId ? {
    ...entry,
    source_digest: createHash('sha256').update(Buffer.from(ledger[line - 1], 'utf8')).digest('hex'),
  } : entry),
  excluded_tombstones: currentRevision.source_inventory.excluded_tombstones,
};
const desiredSeed = {
  schema: currentPlan.schema,
  project_id: currentPlan.project_id,
  plan_key: currentPlan.plan_key,
  predecessor_plan_digest: currentPlan.plan_digest,
  tasks,
  hard_dependencies: currentPlan.hard_dependencies,
  joins: currentPlan.joins,
};
const planVersion = todoRevisionPlanVersion({
  projectId: currentPlan.project_id, planKey: currentPlan.plan_key, predecessor,
  desiredPlan: desiredSeed, taskMigration, sourceInventory,
});
const desiredPlan = buildTodoPlan({ ...desiredSeed, plan_version: planVersion });
const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
const reconciliation = {
  predecessor_reconciliation_digest: currentRevision.reconciliation.reconciliation_digest,
  source_inventory_digest: sourceInventoryDigest,
  reconciliation_digest: todoReconciliationDigest({
    predecessorReconciliationDigest: currentRevision.reconciliation.reconciliation_digest,
    sourceInventoryDigest,
    predecessor,
    desiredPlanDigest: desiredPlan.plan_digest,
    taskMigration,
  }),
};
const revision = {
  schema: 'lattice.todo_revision.v1',
  project_id: currentPlan.project_id,
  plan_key: currentPlan.plan_key,
  predecessor,
  desired_plan: desiredPlan,
  task_migration: taskMigration,
  source_inventory: sourceInventory,
  reconciliation,
  revision_digest: '',
};
revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
if (!validateTodoRevision(revision)) throw new Error('generated wording revision is invalid');
const output = new URL('phase-decoupling-wording-revision-v1.json', latticeRoot);
fs.writeFileSync(output, `${canonicalizeTodoArtifact(revision)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ plan_version: desiredPlan.plan_version,
  revision_digest: revision.revision_digest })}\n`);
