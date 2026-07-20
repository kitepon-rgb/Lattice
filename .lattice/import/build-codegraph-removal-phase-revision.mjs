import fs from 'node:fs';
import {
  buildTodoPlan,
} from '../../src/todo-store.mjs';
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
if (currentPlan.schema !== 'lattice.todo_plan.v3') throw new Error('expected v3 predecessor');

const projectId = currentPlan.project_id;
const planKey = currentPlan.plan_key;
const phaseId = 'lattice-codegraph-removal';
const ref = (taskId) => ({ project_id: projectId, plan_key: planKey, task_id: taskId });
const ledgerRef = 'docs/archive/codegraph-name-removal-authoring.md';
const ledger = fs.readFileSync(new URL(`../../${ledgerRef}`, import.meta.url), 'utf8').split('\n');
const additions = [
  ['lpg-020', 'contract', '旧名・旧保存先・旧runtime依存のcharacterizationとcutover契約を固定する', 6],
  ['lpg-021', 'sensor', 'sensor本体のbinary・storage・env・CLIをLattice所有名へ切り替える', 7],
  ['lpg-022', 'integration', 'root adapter・MCP tool・artifact schema・package surfaceをsensor名へ切り替える', 8],
  ['lpg-023', 'gate', 'tests・現行docs・package manifestを更新し旧runtime名の再混入gateを置く', 9],
  ['lpg-024', 'dogfood', '旧dataが無いfresh AIShellでdogfoodしPhase重監査とfull gateを閉じる', 10],
];
for (const [taskId, , title, line] of additions) {
  if (ledger[line - 1] !== `- [ ] ${taskId} ${title}`) throw new Error(`ledger line mismatch: ${taskId}`);
}

const existingTasks = currentPlan.tasks.map((task) => ({ ...task, phase_id: phaseId }));
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
const tasks = [...existingTasks, ...newTasks];
const dependencyPairs = [
  ['lpg-020', 'lpg-021'],
  ['lpg-020', 'lpg-022'],
  ['lpg-021', 'lpg-023'],
  ['lpg-022', 'lpg-023'],
  ['lpg-023', 'lpg-024'],
];
const hardDependencies = [...currentPlan.hard_dependencies,
  ...dependencyPairs.map(([from, to]) => ({ from: ref(from), to: ref(to) }))];
const phases = [{
  gate_policy: 'dotagents-heavy',
  phase_id: phaseId,
  predecessor_phase_ids: [],
  required_evidence_slots: ['adversarial-review', 'fresh-dogfood', 'full-gate'],
  title: 'Lattice hardeningとCodeGraph runtime完全排除',
}];
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
const phaseMigration = [{ from_phase_id: null, state_policy: 'reset', to_phase_id: phaseId }];
const desiredSeed = {
  schema: 'lattice.todo_plan.v5',
  project_id: projectId,
  plan_key: planKey,
  predecessor_plan_digest: currentPlan.plan_digest,
  tasks,
  phases,
  hard_dependencies: hardDependencies,
  joins: currentPlan.joins,
  phase_accept_dependencies: [],
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
  throw new Error('generated CodeGraph removal phase revision failed validation');
}
const output = new URL('codegraph-removal-phase-revision-v1.json', latticeRoot);
fs.writeFileSync(output, `${canonicalizeTodoArtifact(revision)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  schema: 'lattice.codegraph_removal_revision_build.v1',
  predecessor_plan_version: currentPlan.plan_version,
  desired_plan_version: desiredPlan.plan_version,
  phase_id: phaseId,
  added_tasks: additions.map(([taskId]) => taskId),
  revision_digest: revision.revision_digest,
})}\n`);
