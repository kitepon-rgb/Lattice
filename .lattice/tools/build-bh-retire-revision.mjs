import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.LATTICE_REPO_ROOT ?? process.cwd());
const contracts = await import(pathToFileURL(resolve(ROOT, 'src/todo-contracts.mjs')).href);
const revisionTools = await import(pathToFileURL(resolve(ROOT, 'src/todo-revision.mjs')).href);
const { canonicalizeTodoArtifact, digestTodoArtifact, todoSelfDigest } = contracts;
const { todoRevisionPlanVersion, todoLegacyReconciliationDigest,
  todoSourceInventoryDigest, todoReconciliationDigest } = revisionTools;
const plan = JSON.parse(readFileSync(`${ROOT}/.lattice/todo/plans/bridge-hub/v1/plan.json`, 'utf8'));
const snap = JSON.parse(readFileSync(`${ROOT}/.lattice/todo/plans/bridge-hub/v1/snapshot.json`, 'utf8'));
const ARCHIVE = 'docs/archive/plan_bridge-hub_tasks.md';
const KEEP = new Set(['bh1-protocol', 'bh2-hub-server', 'bh3-terminal-heartbeat', 'bh4-integration-test']);
const sha = (b) => createHash('sha256').update(b).digest('hex');

// 生きたMarkdownの実バイトからsource_digestを取る（narrative_anchorの記録値と突合する）
const liveLines = readFileSync(`${ROOT}/docs/plan_bridge-hub.md`).toString('utf8').split('\n');
const rows = plan.tasks.map((t) => {
  const line = t.narrative_anchor.origin_line;
  const text = liveLines[line - 1];
  const digest = sha(Buffer.from(text, 'utf8'));
  if (digest !== t.narrative_anchor.source_line_digest) {
    throw new Error(`source drift ${t.task_id} L${line}: recorded=${t.narrative_anchor.source_line_digest.slice(0,12)} actual=${digest.slice(0,12)}\n  ${text}`);
  }
  return { task: t, source_ref: `${t.narrative_anchor.origin_plan_ref}#L${line}`, source_digest: digest, text };
});
rows.sort((a, b) => a.source_ref < b.source_ref ? -1 : a.source_ref > b.source_ref ? 1 : 0);

const operations = rows.map((r) => {
  const keep = KEEP.has(r.task.task_id);
  return { task_id: keep ? r.task.task_id : null, disposition: keep ? 'active' : 'excluded',
    source_ref: r.source_ref, source_digest: r.source_digest,
    live_replacement: keep
      ? `- ${r.task.task_id}: ${r.task.title}（完了・工程正本はLattice store）`
      : `- ${r.task.task_id}: オーナー裁定2026-08-10で打ち切り。工程から除外し再開しない` };
});
const batchBase = { batch_id: 'bh-cutover-20260811', archive_ref: ARCHIVE, operations, batch_digest: '' };
batchBase.batch_digest = todoSelfDigest(batchBase, 'batch_digest');
const archivedRef = (i) => `${ARCHIVE}#L${i + 6}`;

const active = [], tombstones = [];
operations.forEach((op, i) => {
  if (op.disposition === 'active') active.push({ task_id: op.task_id, source_ref: archivedRef(i), source_digest: op.source_digest });
  else tombstones.push({ source_ref: archivedRef(i), source_digest: op.source_digest,
    exclusion_reason: 'オーナー裁定2026-08-10により工程ごと打ち切り。未commit成果も廃棄済みで再開しない' });
});
active.sort((a, b) => a.task_id < b.task_id ? -1 : 1);
tombstones.sort((a, b) => a.source_ref < b.source_ref ? -1 : 1);
const sourceInventory = { active, excluded_tombstones: tombstones };

const refByTask = new Map(operations.map((op, i) => [op.task_id, archivedRef(i)]));
const tasks = plan.tasks.filter((t) => KEEP.has(t.task_id))
  .map((t) => ({ ...t, narrative_ref: refByTask.get(t.task_id), narrative_anchor: null }))
  .sort((a, b) => a.task_id < b.task_id ? -1 : 1);
const deps = plan.hard_dependencies.filter((e) => KEEP.has(e.from.task_id) && KEEP.has(e.to.task_id));

const taskMigration = plan.tasks.map((t) => KEEP.has(t.task_id)
  ? { from_task_id: t.task_id, to_task_id: t.task_id, state_policy: 'carry_reconciled_metadata' }
  : { from_task_id: t.task_id, to_task_id: 'removed', state_policy: 'removed' })
  .sort((a, b) => a.from_task_id < b.from_task_id ? -1 : 1);

const predecessor = { plan_digest: plan.plan_digest, journal_head_digest: snap.journal_head_digest, plan_version: plan.plan_version };
const desiredCore = { schema: 'lattice.todo_plan.v6', project_id: plan.project_id, plan_key: plan.plan_key,
  predecessor_plan_digest: plan.plan_digest, tasks, hard_dependencies: deps, joins: [] };
const planVersion = todoRevisionPlanVersion({ projectId: plan.project_id, planKey: plan.plan_key,
  predecessor, desiredPlan: desiredCore, taskMigration, sourceInventory, sourceCutoverBatch: batchBase });
const desired = { ...desiredCore, plan_version: planVersion, topology_digest: '', plan_digest: '' };
desired.topology_digest = digestTodoArtifact({ project_id: desired.project_id, plan_key: desired.plan_key,
  plan_version: desired.plan_version, tasks: desired.tasks, hard_dependencies: desired.hard_dependencies, joins: desired.joins });
desired.plan_digest = todoSelfDigest(desired, 'plan_digest');

const predecessorReconciliationDigest = todoLegacyReconciliationDigest({ planDigest: plan.plan_digest, journalHeadDigest: snap.journal_head_digest });
const sourceInventoryDigest = todoSourceInventoryDigest(sourceInventory);
const reconciliation = { predecessor_reconciliation_digest: predecessorReconciliationDigest,
  source_inventory_digest: sourceInventoryDigest,
  reconciliation_digest: todoReconciliationDigest({ predecessorReconciliationDigest, sourceInventoryDigest,
    predecessor, desiredPlanDigest: desired.plan_digest, taskMigration, sourceCutoverBatch: batchBase }) };

const revision = { schema: 'lattice.todo_revision.v2', project_id: plan.project_id, plan_key: plan.plan_key,
  predecessor, desired_plan: desired, task_migration: taskMigration, source_inventory: sourceInventory,
  reconciliation, source_cutover_batch: batchBase, revision_digest: '' };
revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
writeFileSync(`${ROOT}/.lattice/revision-bridge-hub-cutover.json`, canonicalizeTodoArtifact(revision) + '\n');
console.log('plan_version:', planVersion, '| tasks:', tasks.length, '| ops:', operations.length, '| removed:', taskMigration.filter(m => m.state_policy === 'removed').length);
