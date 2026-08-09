import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderCliHelp } from '../src/cli-help.mjs';
import { buildTodoPlan } from '../src/todo-store.mjs';
import { compileTodoSplit, validateTodoSplitProposal } from '../src/todo-split.mjs';
import { validatePhaseTodoRevision, validateTodoRevision } from '../src/todo-revision.mjs';

const DIGEST = 'a'.repeat(64);
const HEAD = 'b'.repeat(64);

function task(taskId, line, phaseId = undefined) {
  return {
    task_id: taskId,
    title: taskId,
    lane: 'main',
    design_memo: `${taskId}の設計`,
    narrative_ref: `docs/plan.md#L${line}`,
    narrative_anchor: null,
    compile_binding: null,
    parent_task_id: null,
    ...(phaseId === undefined ? {} : { phase_id: phaseId }),
  };
}

async function fixture({ phase = false } = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-todo-split-'));
  await mkdir(path.join(repoRoot, 'docs'), { recursive: true });
  await writeFile(path.join(repoRoot, 'docs/plan.md'), [
    '- [ ] A original',
    '- [ ] B downstream',
    '- [ ] A1 extracted',
    '- [ ] A2 extracted',
    '',
  ].join('\n'));
  const plan = buildTodoPlan({
    schema: phase ? 'lattice.todo_plan.v7' : 'lattice.todo_plan.v6',
    project_id: 'project-1',
    plan_key: 'main',
    plan_version: 'v1',
    predecessor_plan_digest: null,
    tasks: [task('A', 1, phase ? 'phase-1' : undefined),
      task('B', 2, phase ? 'phase-1' : undefined)],
    hard_dependencies: [{
      from: { project_id: 'project-1', plan_key: 'main', task_id: 'A' },
      to: { project_id: 'project-1', plan_key: 'main', task_id: 'B' },
    }],
    joins: [],
    ...(phase ? {
      phases: [{
        phase_id: 'phase-1', title: 'Phase 1', gate_policy: 'heavy',
        predecessor_phase_ids: [], required_evidence_slots: ['heavy'],
      }],
      phase_accept_dependencies: [],
    } : {}),
  });
  const member = {
    plan,
    revision: null,
    journal: { events: [{ schema: 'lattice.todo_event.v1', event_digest: HEAD }] },
    tasks: [
      { task_id: 'A', status: 'in-progress' },
      { task_id: 'B', status: 'pending' },
    ],
  };
  const proposal = {
    schema: 'lattice.todo_split.v1',
    project_id: 'project-1',
    plan_key: 'main',
    task_id: 'A',
    reason: '責務を独立した後続へ抽出する',
    evidence_digests: [DIGEST],
    archive_ref: 'docs/archive/split.md',
    residual: { title: 'A residual', lane: 'main', design_memo: '抽出後の残差を完了する' },
    extracted_tasks: [
      { task_id: 'A2', title: 'A2 extracted', lane: 'worker', design_memo: 'A1の後に実施する',
        source_ref: 'docs/plan.md#L4', depends_on: ['A1'] },
      { task_id: 'A1', title: 'A1 extracted', lane: 'worker', design_memo: '独立責務を実装する',
        source_ref: 'docs/plan.md#L3', depends_on: [] },
    ],
  };
  return { repoRoot, member, proposal };
}

test('phaseless split compiles extracted children before a pending residual', async () => {
  const { repoRoot, member, proposal } = await fixture();
  assert.equal(validateTodoSplitProposal(proposal), true);
  const { revision, extracted_task_ids: extractedTaskIds } = await compileTodoSplit({
    repoRoot, member, proposal,
  });
  assert.equal(validateTodoRevision(revision), true);
  assert.deepEqual(extractedTaskIds, ['A1', 'A2']);
  assert.equal(revision.task_migration.find(({ from_task_id: id }) => id === 'A').state_policy,
    'reset_pending');
  assert.equal(revision.desired_plan.tasks.find(({ task_id: id }) => id === 'A').title, 'A residual');
  assert.equal(revision.desired_plan.tasks.find(({ task_id: id }) => id === 'A1').parent_task_id, 'A');
  const dependencyPairs = revision.desired_plan.hard_dependencies
    .map(({ from, to }) => `${from.task_id}->${to.task_id}`);
  assert.deepEqual(dependencyPairs.sort(), ['A->B', 'A1->A', 'A1->A2', 'A2->A'].sort());
  assert.deepEqual(revision.source_cutover_batch.operations.map(({ task_id: id }) => id), ['A1', 'A2']);
});

test('phase split records plural runtime lineage and resets only the source phase', async () => {
  const { repoRoot, member, proposal } = await fixture({ phase: true });
  const { revision } = await compileTodoSplit({ repoRoot, member, proposal });
  assert.equal(validatePhaseTodoRevision(revision), true);
  const split = revision.runtime_task_migration.entries
    .find(({ predecessor_task_id: id }) => id === 'A');
  assert.equal(split.disposition, 'split');
  assert.deepEqual(split.successor_task_ids, ['A', 'A1', 'A2']);
  assert.deepEqual(revision.phase_migration, [{
    from_phase_id: 'phase-1', to_phase_id: 'phase-1', state_policy: 'reset',
  }]);
  assert.equal(revision.desired_plan.tasks.find(({ task_id: id }) => id === 'A2').phase_id,
    'phase-1');
});

test('split rejects an empty expansion and is exposed in CLI help', async () => {
  const { proposal } = await fixture();
  assert.equal(validateTodoSplitProposal({ ...proposal, extracted_tasks: [] }), false);
  assert.match(renderCliHelp(['todo', 'split', '--help']),
    /todo split --plan <key> --input <file>/u);
});
