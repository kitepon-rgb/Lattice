import * as control from '../../../dotagents/lib/orchestrate/control-record.mjs';

const cwd = '/Users/kite/Developer/Lattice';
const controlId = 'ai-safe-todo-authoring-20260801';
const actorId = 'codex-parent-20260801';
const observedAt = new Date().toISOString();

const file = (ref, digest) => ({ type: 'file', ref, digest, observed_at: observedAt });
const decision = (ref, digest) => ({ type: 'decision', ref, digest, observed_at: observedAt });

const plan = file(
  'docs/plan_ai-safe-todo-authoring.md',
  'c8261b3d5cda2dd52a426ee7069fbd7b142dd1ee6b84eb252969253ff2418436',
);
const verification = file(
  'docs/evidence/2026-08-01-ai-safe-todo-authoring-verification.json',
  '49a7e88be9951cda0734adc16e8a813dc4cb6368b5ed385f947451adf0c7cb62',
);
const productContract = file(
  'docs/00_product-contract.md',
  'ffb993381f03c2c5502c99465ec33eec38a567515754ccd947901951ed0b8249',
);
const memoDecision = decision(
  'docs/adr/0150-todo-design-memo-is-required.md',
  'bedb88ceb95a95992355c2c584b3fe5d6451dbcf8f6c22b450ed6a1595e02006',
);
const dashboardDecision = decision(
  'docs/adr/0151-dashboard-is-the-only-operational-gantt.md',
  'ae44b937d894ef922e04b7ea5ef55cc9314e6d474603d546d5b721c63a851cd3',
);

let current = await control.status({ cwd, control_id: controlId });
if (current.record_revision !== 2) {
  throw new Error(`unexpected Control revision: ${current.record_revision}`);
}

const phases = [
  ['baseline', [plan], null],
  ['discovery', [plan], null],
  ['design', [], memoDecision],
  ['safety_net', [verification], null],
  ['implementation', [verification], null],
  ['behavior_change', [], dashboardDecision],
  ['integration', [verification], null],
  ['knowledge_return', [productContract], null],
  ['complete', [verification], memoDecision],
];
for (const [phase, evidence, phaseDecision] of phases) {
  const advanced = await control.phaseGateAdvance({
    cwd,
    control_id: controlId,
    actor_id: actorId,
    expected_revision: current.record_revision,
    phase,
    state: 'completed',
    evidence,
    decision: phaseDecision,
  });
  current = advanced.manifest;
}

const taskFinalized = await control.taskFinalizeRecord({
  cwd,
  control_id: controlId,
  actor_id: actorId,
  expected_revision: current.record_revision,
  task_id: 'todo-design-memo-core',
  finalization_ref: 'docs/adr/0150-todo-design-memo-is-required.md',
  recorded_by: actorId,
});
current = taskFinalized.manifest;

const finalized = await control.finalizeControl({
  cwd,
  control_id: controlId,
  actor_id: actorId,
  expected_revision: current.record_revision,
  acceptance_matrix_ref: 'docs/plan_ai-safe-todo-authoring.md',
  final_audit_evidence: [verification],
  regression_evidence: [verification],
  knowledge_return_refs: [
    'docs/00_product-contract.md',
    'docs/adr/0151-dashboard-is-the-only-operational-gantt.md',
  ],
  parent_decision: memoDecision,
  finalized_by: actorId,
});

process.stdout.write(`${JSON.stringify({
  control_id: controlId,
  revision: finalized.revision,
  status: finalized.manifest.status,
  phase_complete: finalized.manifest.phase_gate.phases.every(({ state }) => state !== 'pending'),
  task_finalized: finalized.manifest.task_finalizations.map(({ task_id: taskId }) => taskId),
  control_finalized: finalized.manifest.control_finalization !== null,
})}\n`);
