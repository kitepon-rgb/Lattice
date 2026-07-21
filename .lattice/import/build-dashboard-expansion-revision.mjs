import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildTodoPlan,
} from '../../src/todo-store.mjs';
import {
  canonicalizeTodoArtifact,
  digestTodoArtifact,
  todoSelfDigest,
  validateTodoPlan,
} from '../../src/todo-contracts.mjs';
import {
  phaseTodoRevisionPlanVersion,
  todoLegacyReconciliationDigest,
  todoSourceInventoryDigest,
  validatePhaseTodoRevision,
} from '../../src/todo-revision.mjs';

const latticeRoot = new URL('../', import.meta.url);
const repoRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('todo/manifest.json', latticeRoot)));
const member = manifest.members.find(({ plan_key: planKey }) => planKey === 'phase-control-live-gantt');
if (member === undefined) throw new Error('active plan missing');
const currentDir = new URL(`todo/plans/${member.plan_key}/${member.active_plan_version}/`, latticeRoot);
const currentPlan = JSON.parse(fs.readFileSync(new URL('plan.json', currentDir)));
const currentSnapshot = JSON.parse(fs.readFileSync(new URL('snapshot.json', currentDir)));
if (currentPlan.schema !== 'lattice.todo_plan.v5') throw new Error('expected v5 predecessor');
if (currentPlan.plan_version !== 'rev-634bdc4ae41878ae10b3e233') {
  throw new Error(`unexpected active predecessor: ${currentPlan.plan_version}`);
}

const projectId = currentPlan.project_id;
const planKey = currentPlan.plan_key;
const phaseId = 'lattice-codegraph-removal';
const ref = (taskId) => ({ project_id: projectId, plan_key: planKey, task_id: taskId });
const digestBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const taskNumber = (taskId) => Number(taskId.slice(4));

function readRevisionAncestry() {
  const planRoot = new URL(`todo/plans/${planKey}/`, latticeRoot);
  const byDigest = new Map();
  for (const version of fs.readdirSync(planRoot).sort()) {
    const planUrl = new URL(`${version}/plan.json`, planRoot);
    if (!fs.existsSync(planUrl)) continue;
    const plan = JSON.parse(fs.readFileSync(planUrl));
    byDigest.set(plan.plan_digest, { plan, version });
  }
  const revisions = [];
  let cursor = currentPlan;
  while (cursor.predecessor_plan_digest !== null) {
    const predecessor = byDigest.get(cursor.predecessor_plan_digest);
    if (predecessor === undefined) break;
    const revisionUrl = new URL(`${predecessor.version}/revision.json`, planRoot);
    if (fs.existsSync(revisionUrl)) revisions.push(JSON.parse(fs.readFileSync(revisionUrl)));
    cursor = predecessor.plan;
  }
  return revisions;
}

const inventoryAncestor = readRevisionAncestry().find((revision) => (
  revision.source_inventory?.active?.length === 19
  && typeof revision.reconciliation?.reconciliation_digest === 'string'
));
if (inventoryAncestor === undefined) throw new Error('19-task source inventory ancestor missing');
if (inventoryAncestor.desired_plan.plan_version !== 'rev-79c03ad19713f74229189e3c') {
  throw new Error(`unexpected source inventory ancestor: ${inventoryAncestor.desired_plan.plan_version}`);
}
const inheritedInventory = inventoryAncestor.source_inventory.active;
if (inheritedInventory.map(({ task_id: taskId }) => taskId).join(',')
  !== Array.from({ length: 19 }, (_, index) => `lpg-${String(index + 1).padStart(3, '0')}`).join(',')) {
  throw new Error('unexpected inherited source inventory');
}

const newTaskDefinitions = [
  ['lpg-032', 'renderer', '工程図rendererを線重複なし・BOX迂回・非接触半円bridge・接続黒丸・青い進行中iconへ更新しproject名を本文とbrowser tab titleに表示する'],
  ['lpg-033', 'dashboard', 'active sessionのproject dashboardを自動起動し`/`・`/projects/`一覧・project別URLを提供する'],
  ['lpg-034', 'setup', 'opt-in setup wizardで49152–65535の未使用portをexclusive bindしlisten／upstream設定とdisable／reconfigureを提供する'],
  ['lpg-035', 'deployment', '192.168.1.2へDocker・Caddy・Cloudflare Tunnelでsecretを複製せずlattice.kitepon.devを復旧可能に公開し実到達を確認する'],
];
const sourceDefinitions = [
  ...Array.from({ length: 5 }, (_, index) => ({
    task_id: `lpg-${String(index + 20).padStart(3, '0')}`,
    source_ref: `docs/archive/codegraph-name-removal-authoring.md#L${index + 6}`,
  })),
  ...Array.from({ length: 7 }, (_, index) => ({
    task_id: `lpg-${String(index + 25).padStart(3, '0')}`,
    source_ref: `docs/archive/runtime-hold-public-bridge-authoring.md#L${index + 6}`,
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    task_id: `lpg-${String(index + 32).padStart(3, '0')}`,
    source_ref: `docs/lattice-dashboard-expansion-authoring.md#L${index + 6}`,
  })),
];
const sourceRows = sourceDefinitions.map((definition) => {
  const match = /^(.*)#L([1-9]\d*)$/u.exec(definition.source_ref);
  const lines = fs.readFileSync(new URL(match[1], repoRoot), 'utf8').split('\n');
  const line = lines[Number(match[2]) - 1];
  if (!line?.startsWith(`- [ ] ${definition.task_id} `)) {
    throw new Error(`source checkbox mismatch: ${definition.task_id}`);
  }
  return { ...definition, line, source_digest: digestBytes(Buffer.from(line, 'utf8')) };
}).sort((left, right) => left.source_ref < right.source_ref ? -1
  : left.source_ref > right.source_ref ? 1 : 0);
const archiveRef = 'docs/archive/lattice-dashboard-expansion-authoring-cutover.md';
const sourceCutoverBatch = {
  batch_id: 'lattice-dashboard-expansion-cutover-v1',
  archive_ref: archiveRef,
  operations: sourceRows.map(({ task_id: taskId, source_ref: sourceRef, source_digest: sourceDigest }) => ({
    task_id: taskId,
    disposition: 'active',
    source_ref: sourceRef,
    source_digest: sourceDigest,
    live_replacement: `- ${taskId} source is managed by Lattice todo store.`,
  })),
  batch_digest: '',
};
sourceCutoverBatch.batch_digest = todoSelfDigest(sourceCutoverBatch, 'batch_digest');
const archivedSources = new Map(sourceRows.map((row, index) => [row.task_id, {
  source_ref: `${archiveRef}#L${index + 6}`,
  source_digest: row.source_digest,
}]));

const existingTasks = currentPlan.tasks.map((task) => {
  if (taskNumber(task.task_id) < 20) return task;
  const source = archivedSources.get(task.task_id);
  if (source === undefined) throw new Error(`cutover source missing: ${task.task_id}`);
  return {
    ...task,
    ...(task.task_id === 'lpg-029'
      ? { title: 'held／carry-over／redispatchをrun statusへ投影する' } : {}),
    narrative_ref: source.source_ref,
  };
});
const tasks = [...existingTasks, ...newTaskDefinitions.map(([taskId, lane, title]) => ({
  compile_binding: null,
  lane,
  narrative_anchor: null,
  narrative_ref: archivedSources.get(taskId).source_ref,
  parent_task_id: null,
  phase_id: phaseId,
  task_id: taskId,
  title,
}))];

const additionalDependencyPairs = [
  ['lpg-029', 'lpg-032'],
  ['lpg-029', 'lpg-033'],
  ['lpg-033', 'lpg-034'],
  ['lpg-032', 'lpg-035'],
  ['lpg-034', 'lpg-035'],
  ['lpg-035', 'lpg-030'],
];
const dependencyKeys = new Set(currentPlan.hard_dependencies.map(({ from, to }) => (
  `${from.task_id}->${to.task_id}`
)));
const hardDependencies = [...currentPlan.hard_dependencies];
for (const [from, to] of additionalDependencyPairs) {
  const key = `${from}->${to}`;
  if (dependencyKeys.has(key)) throw new Error(`duplicate dependency: ${key}`);
  dependencyKeys.add(key);
  hardDependencies.push({ from: ref(from), to: ref(to) });
}
hardDependencies.sort((left, right) => {
  const leftKey = `${left.from.project_id}\0${left.from.plan_key}\0${left.from.task_id}\0${left.to.project_id}\0${left.to.plan_key}\0${left.to.task_id}`;
  const rightKey = `${right.from.project_id}\0${right.from.plan_key}\0${right.from.task_id}\0${right.to.project_id}\0${right.to.plan_key}\0${right.to.task_id}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
});

const predecessor = {
  journal_head_digest: currentSnapshot.journal_head_digest,
  plan_digest: currentPlan.plan_digest,
  plan_version: currentPlan.plan_version,
};
const evidenceRef = new URL('../dashboard-expansion-migration-evidence-v1.json', import.meta.url);
const evidenceDigest = digestBytes(fs.readFileSync(evidenceRef));
const runtimeTaskMigration = {
  schema: 'lattice.runtime_task_migration.v1',
  entries: currentPlan.tasks.map(({ task_id: taskId }) => {
    if (taskId === 'lpg-029') return {
      predecessor_task_id: taskId,
      disposition: 'split',
      successor_task_ids: ['lpg-029', 'lpg-032', 'lpg-033', 'lpg-034', 'lpg-035'],
      reason: '未完了のruntime projectionとdashboard・setup・deployment責務を独立successorへ分割する',
      evidence_digests: [evidenceDigest],
    };
    if (taskId === 'lpg-030') return {
      predecessor_task_id: taskId,
      disposition: 'replace',
      successor_task_ids: [taskId],
      reason: '新しいincoming dependency lpg-035からの待機を正本化するため未着手taskをpendingへresetする',
      evidence_digests: [evidenceDigest],
    };
    return {
      predecessor_task_id: taskId,
      disposition: 'carry',
      successor_task_ids: [taskId],
      reason: taskNumber(taskId) <= 28
        ? 'active journalで確定した完了状態と実証拠を維持する'
        : '未完了taskの意味を維持しsource metadataだけをreconcileする',
      evidence_digests: [evidenceDigest],
    };
  }),
  migration_digest: '',
};
runtimeTaskMigration.migration_digest = todoSelfDigest(runtimeTaskMigration, 'migration_digest');
const taskMigration = currentPlan.tasks.map(({ task_id: taskId }) => {
  const number = taskNumber(taskId);
  return {
    from_task_id: taskId,
    to_task_id: taskId,
    state_policy: number <= 19 ? 'carry'
      : ['lpg-029', 'lpg-030'].includes(taskId)
        ? 'reset_pending' : 'carry_reconciled_metadata',
  };
});
const phaseMigration = [{ from_phase_id: phaseId, to_phase_id: phaseId, state_policy: 'reset' }];
const desiredSeed = {
  schema: 'lattice.todo_plan.v5',
  project_id: projectId,
  plan_key: planKey,
  predecessor_plan_digest: currentPlan.plan_digest,
  tasks,
  phases: currentPlan.phases,
  hard_dependencies: hardDependencies,
  joins: currentPlan.joins,
  phase_accept_dependencies: currentPlan.phase_accept_dependencies,
};
const planVersion = phaseTodoRevisionPlanVersion({
  projectId,
  planKey,
  predecessor,
  desiredPlan: desiredSeed,
  taskMigration,
  phaseMigration,
});
const desiredPlan = buildTodoPlan({ ...desiredSeed, plan_version: planVersion });
const sourceInventory = {
  active: [...inheritedInventory, ...tasks.slice(19).map(({ task_id: taskId }) => ({
    task_id: taskId,
    ...archivedSources.get(taskId),
  }))],
  excluded_tombstones: inventoryAncestor.source_inventory.excluded_tombstones,
};
const taskMigrationDigest = todoSelfDigest({
  task_migration: taskMigration,
  task_migration_digest: '',
}, 'task_migration_digest');
const reconciliation = {
  predecessor_reconciliation_digest: todoLegacyReconciliationDigest({
    planDigest: currentPlan.plan_digest,
    journalHeadDigest: currentSnapshot.journal_head_digest,
  }),
  source_inventory_digest: todoSourceInventoryDigest(sourceInventory),
  desired_plan_digest: desiredPlan.plan_digest,
  runtime_task_migration_digest: runtimeTaskMigration.migration_digest,
  task_migration_digest: taskMigrationDigest,
  phase_migration_digest: digestTodoArtifact(phaseMigration),
  source_cutover_batch_digest: sourceCutoverBatch.batch_digest,
  reconciliation_digest: '',
};
reconciliation.reconciliation_digest = todoSelfDigest(reconciliation, 'reconciliation_digest');
const revision = {
  schema: 'lattice.phase_todo_revision.v3',
  project_id: projectId,
  plan_key: planKey,
  predecessor,
  desired_plan: desiredPlan,
  runtime_task_migration: runtimeTaskMigration,
  task_migration: taskMigration,
  phase_migration: phaseMigration,
  source_inventory: sourceInventory,
  reconciliation,
  source_cutover_batch: sourceCutoverBatch,
  revision_digest: '',
};
revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
if (!validateTodoPlan(desiredPlan) || !validatePhaseTodoRevision(revision)) {
  throw new Error('generated dashboard expansion revision failed validation');
}
const bytes = `${canonicalizeTodoArtifact(revision)}\n`;
const output = new URL('../dashboard-expansion-revision-v1.json', import.meta.url);
if (fs.existsSync(output)) {
  if (!fs.readFileSync(output).equals(Buffer.from(bytes))) throw new Error('output exists with different bytes');
} else {
  fs.writeFileSync(output, bytes, { flag: 'wx' });
}
process.stdout.write(`${JSON.stringify({
  schema: 'lattice.dashboard_expansion_revision_build.v1',
  predecessor_plan_version: currentPlan.plan_version,
  predecessor_journal_head_digest: predecessor.journal_head_digest,
  desired_plan_version: desiredPlan.plan_version,
  evidence_digest: evidenceDigest,
  source_cutover_operations: sourceCutoverBatch.operations.length,
  revision_digest: revision.revision_digest,
  output_digest: digestBytes(Buffer.from(bytes)),
  valid: true,
})}\n`);
