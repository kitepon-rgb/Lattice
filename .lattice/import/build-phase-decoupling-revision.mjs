import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  canonicalizeTodoArtifact,
  digestTodoArtifact,
  todoSelfDigest,
  validateTodoPlan,
} from '../../src/todo-contracts.mjs';
import {
  todoReconciliationDigest,
  todoRevisionPlanVersion,
  todoSourceInventoryDigest,
  validateTodoRevision,
} from '../../src/todo-revision.mjs';

const latticeRoot = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('todo/manifest.json', latticeRoot)));
const member = manifest.members.find(({ plan_key: planKey }) => planKey === 'phase-control-live-gantt');
if (member === undefined) throw new Error('active plan missing');
const currentDir = new URL(`todo/plans/phase-control-live-gantt/${member.active_plan_version}/`, latticeRoot);
const currentPlan = JSON.parse(fs.readFileSync(new URL('plan.json', currentDir)));
const currentRevision = JSON.parse(fs.readFileSync(new URL('revision.json', currentDir)));
const currentSnapshot = JSON.parse(fs.readFileSync(new URL('snapshot.json', currentDir)));
const projectId = currentPlan.project_id;
const planKey = currentPlan.plan_key;
const ref = (taskId) => ({ project_id: projectId, plan_key: planKey, task_id: taskId });
const ledgerRef = 'docs/archive/phase-scheduling-decoupling-authoring.md';
const ledger = fs.readFileSync(new URL(`../../${ledgerRef}`, import.meta.url), 'utf8').split('\n');
const additions = [
  ['lpg-015', 'contract', 'Phase監査集合とToDo schedulingを分離するv5契約とcharacterizationを固定する', 6],
  ['lpg-016', 'schema', 'todo_plan.v5・plan create v3・Phase revision v2のversioned schemaを実装する', 7],
  ['lpg-017', 'store', 'explicit Phase-accept dependency、store transition、status、Ganttを実装する', 8],
  ['lpg-018', 'dogfood', 'AIShell successorをv5へ移行し24 task waveと8重監査の両立を実測する', 9],
  ['lpg-019', 'release-gate', 'maintenance、関連/full gate、公開契約、ADR、効果証拠を閉じる', 10],
];
for (const [taskId, , title, line] of additions) {
  if (ledger[line - 1] !== `- [ ] ${taskId} ${title}`) throw new Error(`ledger line mismatch: ${taskId}`);
}
const tasks = [...currentPlan.tasks, ...additions.map(([taskId, lane, title, line]) => ({
  compile_binding: null,
  lane,
  narrative_anchor: null,
  narrative_ref: `${ledgerRef}#L${line}`,
  parent_task_id: null,
  task_id: taskId,
  title,
}))];
const pairs = [
  ['lpg-015', 'lpg-016'],
  ['lpg-016', 'lpg-017'],
  ['lpg-017', 'lpg-018'],
  ['lpg-018', 'lpg-019'],
];
const hardDependencies = [...currentPlan.hard_dependencies,
  ...pairs.map(([from, to]) => ({ from: ref(from), to: ref(to) }))];
const predecessor = {
  journal_head_digest: currentSnapshot.journal_head_digest,
  plan_digest: currentPlan.plan_digest,
  plan_version: currentPlan.plan_version,
};
const taskMigration = currentPlan.tasks.map(({ task_id: taskId }) => ({
  from_task_id: taskId,
  state_policy: 'carry',
  to_task_id: taskId,
}));
const sourceInventory = {
  active: [...currentRevision.source_inventory.active, ...additions.map(([taskId, , , line]) => ({
    source_digest: createHash('sha256').update(Buffer.from(ledger[line - 1], 'utf8')).digest('hex'),
    source_ref: `${ledgerRef}#L${line}`,
    task_id: taskId,
  }))],
  excluded_tombstones: currentRevision.source_inventory.excluded_tombstones,
};
const desiredSeed = {
  schema: 'lattice.todo_plan.v3',
  project_id: projectId,
  plan_key: planKey,
  predecessor_plan_digest: currentPlan.plan_digest,
  tasks,
  hard_dependencies: hardDependencies,
  joins: currentPlan.joins,
};
const planVersion = todoRevisionPlanVersion({
  projectId, planKey, predecessor, desiredPlan: desiredSeed, taskMigration, sourceInventory,
});
const topology = {
  project_id: projectId,
  plan_key: planKey,
  plan_version: planVersion,
  tasks,
  hard_dependencies: hardDependencies,
  joins: currentPlan.joins,
};
const desiredPlan = {
  ...desiredSeed,
  plan_version: planVersion,
  topology_digest: digestTodoArtifact(topology),
  plan_digest: '',
};
desiredPlan.plan_digest = todoSelfDigest(desiredPlan, 'plan_digest');
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
  project_id: projectId,
  plan_key: planKey,
  predecessor,
  desired_plan: desiredPlan,
  task_migration: taskMigration,
  source_inventory: sourceInventory,
  reconciliation,
  revision_digest: '',
};
revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
if (!validateTodoPlan(desiredPlan) || !validateTodoRevision(revision)) {
  throw new Error('generated phase decoupling revision failed validation');
}
const bytes = `${canonicalizeTodoArtifact(revision)}\n`;
const output = new URL('phase-decoupling-revision-v3.json', latticeRoot);
fs.writeFileSync(output, bytes, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  schema: 'lattice.phase_decoupling_revision_build.v1',
  predecessor_plan_version: currentPlan.plan_version,
  desired_plan_version: planVersion,
  added_tasks: additions.map(([taskId]) => taskId),
  revision_digest: revision.revision_digest,
})}\n`);
