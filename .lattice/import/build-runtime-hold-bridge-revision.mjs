import fs from 'node:fs';
import { buildTodoPlan } from '../../src/todo-store.mjs';
import {
  canonicalizeTodoArtifact,
  todoSelfDigest,
  validateTodoPlan,
} from '../../src/todo-contracts.mjs';
import {
  phaseTodoRevisionPlanVersion,
  validatePhaseTodoRevision,
} from '../../src/todo-revision.mjs';

const latticeRoot = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('todo/manifest.json', latticeRoot)));
const member = manifest.members.find(({ plan_key: planKey }) => planKey === 'phase-control-live-gantt');
if (member === undefined) throw new Error('active plan missing');
const currentDir = new URL(`todo/plans/${member.plan_key}/${member.active_plan_version}/`, latticeRoot);
const currentPlan = JSON.parse(fs.readFileSync(new URL('plan.json', currentDir)));
const currentSnapshot = JSON.parse(fs.readFileSync(new URL('snapshot.json', currentDir)));
if (currentPlan.schema !== 'lattice.todo_plan.v5') throw new Error('expected v5 predecessor');

const projectId = currentPlan.project_id;
const planKey = currentPlan.plan_key;
const phaseId = 'lattice-codegraph-removal';
const ref = (taskId) => ({ project_id: projectId, plan_key: planKey, task_id: taskId });
const ledgerRef = 'docs/archive/runtime-hold-public-bridge-authoring.md';
const ledger = fs.readFileSync(new URL(`../../${ledgerRef}`, import.meta.url), 'utf8').split('\n');
const additions = [
  ['lpg-025', 'contract', '競合freeze・実停止ack・multi-epoch recompile・seam splitの公開契約とcharacterizationを固定する', 6],
  ['lpg-026', 'store', 'multi-epoch run storeとrun conflict公開CLIを実装しfreeze中の新規dispatchを拒否する', 7],
  ['lpg-027', 'executor', 'executor hold request／checkpoint／停止ack検証を実装し論理停止の捏造を禁止する', 8],
  ['lpg-028', 'runtime', 'run recompileでseam splitまたはintentional serialを選びepoch rebind／redispatch後に再開する', 9],
  ['lpg-029', 'projection', 'held／carry-over／redispatchをrun statusとproject別動的工程表へ投影する', 10],
  ['lpg-030', 'dogfood', 'AIShellの実競合fixtureで片側stay・seam分割・process再起動回収をdogfoodする', 11],
  ['lpg-031', 'release-gate', '独立反証、関連/full test、公開docs、npm release、global installを閉じる', 12],
];
for (const [taskId, , title, line] of additions) {
  if (ledger[line - 1] !== `- [ ] ${taskId} ${title}`) throw new Error(`ledger line mismatch: ${taskId}`);
}

const newTasks = additions.map(([taskId, lane, title, line]) => ({
  compile_binding: null,
  lane,
  narrative_anchor: null,
  narrative_ref: `${ledgerRef}#L${line}`,
  parent_task_id: null,
  phase_id: phaseId,
  task_id: taskId,
  title,
}));
const tasks = [...currentPlan.tasks, ...newTasks];
const dependencyPairs = [
  ['lpg-025', 'lpg-026'],
  ['lpg-025', 'lpg-027'],
  ['lpg-026', 'lpg-028'],
  ['lpg-027', 'lpg-028'],
  ['lpg-028', 'lpg-029'],
  ['lpg-029', 'lpg-030'],
  ['lpg-030', 'lpg-031'],
];
const hardDependencies = [
  ...currentPlan.hard_dependencies,
  ...dependencyPairs.map(([from, to]) => ({ from: ref(from), to: ref(to) })),
];
const phases = currentPlan.phases.map((phase) => phase.phase_id === phaseId ? {
  ...phase,
  title: 'Lattice hardeningと実運用統制',
} : phase);
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
const phaseMigration = [{ from_phase_id: phaseId, state_policy: 'reset', to_phase_id: phaseId }];
const desiredSeed = {
  schema: 'lattice.todo_plan.v5',
  project_id: projectId,
  plan_key: planKey,
  predecessor_plan_digest: currentPlan.plan_digest,
  tasks,
  phases,
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
const revision = {
  schema: 'lattice.phase_todo_revision.v2',
  project_id: projectId,
  plan_key: planKey,
  predecessor,
  desired_plan: desiredPlan,
  task_migration: taskMigration,
  phase_migration: phaseMigration,
  revision_digest: '',
};
revision.revision_digest = todoSelfDigest(revision, 'revision_digest');
if (!validateTodoPlan(desiredPlan) || !validatePhaseTodoRevision(revision)) {
  throw new Error('generated runtime hold bridge revision failed validation');
}
const output = new URL('runtime-hold-bridge-revision-v1.json', latticeRoot);
fs.writeFileSync(output, `${canonicalizeTodoArtifact(revision)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  schema: 'lattice.runtime_hold_bridge_revision_build.v1',
  predecessor_plan_version: currentPlan.plan_version,
  desired_plan_version: desiredPlan.plan_version,
  added_tasks: additions.map(([taskId]) => taskId),
  revision_digest: revision.revision_digest,
})}\n`);
