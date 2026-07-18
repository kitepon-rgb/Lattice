import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { verifyNarrativeAnchors } from '../src/todo-narrative-anchor.mjs';

const digest = (line) => createHash('sha256').update(Buffer.from(line, 'utf8')).digest('hex');
const ref = (task_id, plan_key = 'main', project_id = 'project-1') => ({ project_id, plan_key, task_id });

function anchor(originLine, line, originPlanRef = 'plan.md') {
  return {
    origin_plan_ref: originPlanRef,
    origin_line: originLine,
    source_commit: '1'.repeat(40),
    source_line_digest: digest(line),
  };
}

function task(taskId, narrativeAnchor, narrativeRef = 'plan.md') {
  return {
    task_id: taskId,
    title: taskId,
    lane: 'main',
    narrative_ref: narrativeRef,
    narrative_anchor: narrativeAnchor,
    compile_binding: null,
  };
}

function fixture(tasks) {
  return {
    schema: 'lattice.todo_store_read.v1',
    project_id: 'project-1',
    members: [{
      plan: {
        schema: 'lattice.todo_plan.v2',
        project_id: 'project-1',
        plan_key: 'main',
        tasks,
        hard_dependencies: [],
        joins: [],
      },
      tasks: tasks.map(({ task_id }) => ({ task_id, status: 'pending' })),
    }],
  };
}

function narrative(taskId, markdown, narrativeRef = 'plan.md') {
  return { ref: ref(taskId), narrative_ref: narrativeRef, markdown };
}

test('anchor成立とclosed reason 5種をfixed lineだけで判定する', () => {
  const markdown = '# Plan\n- [ ] anchored\n- ordinary list\nplain text';
  const tasks = [
    task('T-anchor', anchor(2, '- [ ] anchored')),
    task('T-anchor-missing', null),
    task('T-path', anchor(2, '- [ ] anchored', 'other.md')),
    task('T-line', anchor(9, 'absent')),
    task('T-digest', anchor(4, '- [x] drifted')),
    task('T-checkbox', anchor(3, '- ordinary list')),
  ];
  const narratives = tasks
    .filter(({ task_id }) => task_id !== 'T-path')
    .map(({ task_id }) => narrative(task_id, markdown));

  const outcomes = verifyNarrativeAnchors({ readModel: fixture(tasks), narratives });
  assert.deepEqual(outcomes.map(({ ref: value, anchored, reason, origin_line }) => ({
    task_id: value.task_id, anchored, reason, origin_line,
  })), [
    { task_id: 'T-anchor', anchored: true, reason: null, origin_line: 2 },
    { task_id: 'T-anchor-missing', anchored: false, reason: 'anchor_missing', origin_line: null },
    { task_id: 'T-checkbox', anchored: false, reason: 'not_checkbox', origin_line: 3 },
    { task_id: 'T-digest', anchored: false, reason: 'digest_mismatch', origin_line: 4 },
    { task_id: 'T-line', anchored: false, reason: 'line_missing', origin_line: 9 },
    { task_id: 'T-path', anchored: false, reason: 'path_mismatch', origin_line: 2 },
  ]);
});

test('same documentのsame lineを2 taskがclaimすると関与全taskがduplicate_claim', () => {
  const markdown = '- [ ] shared';
  const tasks = [task('T2', anchor(1, markdown)), task('T1', anchor(1, markdown))];
  const outcomes = verifyNarrativeAnchors({
    readModel: fixture(tasks),
    narratives: tasks.map(({ task_id }) => narrative(task_id, markdown)),
  });

  assert.deepEqual(outcomes.map(({ ref: value, reason }) => [value.task_id, reason]), [
    ['T1', 'duplicate_claim'],
    ['T2', 'duplicate_claim'],
  ]);
});

test('listItemにpositionが無いASTはast_location_missingでfail closed', () => {
  const markdown = '- [ ] location missing';
  const tasks = [task('T1', anchor(1, markdown))];
  const outcomes = verifyNarrativeAnchors({
    readModel: fixture(tasks),
    narratives: [narrative('T1', markdown)],
    parseMarkdown: () => ({
      type: 'root',
      children: [{ type: 'list', children: [{ type: 'listItem', checked: false, children: [] }] }],
    }),
  });

  assert.equal(outcomes[0].reason, 'ast_location_missing');
  assert.equal(outcomes[0].anchored, false);
});

test('CRLFはLFのみで分割し、行末CRをdigestから除かない', () => {
  const markdown = '# Plan\r\n- [ ] CRLF task\r\n';
  const exact = task('T-exact', anchor(2, '- [ ] CRLF task\r'));
  const normalized = task('T-normalized', anchor(2, '- [ ] CRLF task'));
  const outcomes = [exact, normalized].flatMap((candidate) => verifyNarrativeAnchors({
    readModel: fixture([candidate]),
    narratives: [narrative(candidate.task_id, markdown)],
  })).sort((left, right) => left.ref.task_id < right.ref.task_id ? -1 : 1);

  assert.deepEqual(outcomes.map(({ ref: value, anchored, reason }) => [value.task_id, anchored, reason]), [
    ['T-exact', true, null],
    ['T-normalized', false, 'digest_mismatch'],
  ]);
});
