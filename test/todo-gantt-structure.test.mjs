import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { renderTodoGanttHtml } from '../src/todo-gantt-html.mjs';
import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';
import { TODO_STRUCTURE_PRESENTATION_SCHEMA } from '../src/todo-structure-presentation.mjs';

const task = {
  task_id: 'T1', title: '構造対象', lane: 'main', narrative_ref: null, compile_binding: null,
};
const readModel = {
  schema: 'lattice.todo_store_read.v1', project_id: 'project-1', members: [{
    plan: {
      project_id: 'project-1', plan_key: 'main', tasks: [task],
      hard_dependencies: [], joins: [],
    },
    tasks: [{
      task_id: 'T1', status: 'done', started_at: null, done_at: null,
      blocked_reason: null, evidence: null, evidence_unverified: false,
    }],
  }],
};
const taskRef = { project_id: 'project-1', plan_key: 'main', task_id: 'T1' };
const layout = layoutTodoGantt(readModel, projectTodoChainV1({
  nodes: [taskRef], hard_edges: [], joins: [],
}), { scope: 'all' });

function structurePresentation() {
  return {
    schema: TODO_STRUCTURE_PRESENTATION_SCHEMA,
    project_id: 'project-1',
    plans: [{
      plan_key: 'main', plan_version: 'v1', coverage: 'inconsistent', freshness: 'fresh',
      enabled: true, verdict: 'inconsistent', compiled_verdict: 'inconsistent',
      structure_set_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64),
      finalization: { required: true, status: 'missing', reason: 'finalization_missing', stale_reasons: [] },
      tasks: [{
        task_id: 'T1', applicability: 'graph', excluded_reason: null, form: 'realized',
        planned_outcome: 'planned出力を作る', effective_outcome: 'realized出力を作る',
        changed_fields: ['outcome'], realization_digest: 'c'.repeat(64),
        code_anchors: [{
          anchor_id: 'writer', effect: 'modify', path: 'src/writer.mjs',
          symbol: 'writeResult', expected_at: 'current',
        }],
      }],
      graph: {
        nodes: [
          { kind: 'task_transform', ref: 'task:T1', task_id: 'T1', state: 'done', form: 'realized' },
          { kind: 'data', ref: 'data:T1/result', task_id: 'T1', port_id: 'result' },
          { kind: 'code', ref: 'code:T1/writer', task_id: 'T1', anchor_id: 'writer' },
          { kind: 'external', ref: 'external:room-api', contract_id: 'room-api' },
          { kind: 'changeset', ref: `commit:${'d'.repeat(40)}` },
        ],
        edges: [
          { kind: 'output', from: 'task:T1', to: 'data:T1/result', port_id: 'result' },
          { kind: 'sink', from: 'data:T1/result', to: 'external:room-api', port_id: 'result' },
          { kind: 'realization', from: `commit:${'d'.repeat(40)}`, to: 'task:T1' },
        ],
      },
      provenance: {
        baseline_sha: 'e'.repeat(40), current_head_sha: 'd'.repeat(40),
        commits: [{
        commit_oid: 'd'.repeat(40),
          changes: [{ path: 'src/writer.mjs', previous_path: null, change: 'modify', file_kind: 'regular' }],
        }],
      },
      finding_summary: { total: 1, returned: 1, omitted: 0, errors: 1, unknowns: 0, notices: 0 },
      findings: [{
        code: 'STRUCTURE_CONTRACT_MISMATCH', severity: 'error', task_ids: ['T1'],
        data_refs: ['T1/result'], code_refs: ['T1/writer'], commit_oids: [],
        observed: null, expected: null, next_action: 'align_the_producer_and_consumer_data_contracts',
      }],
      unreadable_reason: null,
      next_actions: ['lattice todo structure --plan main --json'],
    }],
    projection_digest: 'f'.repeat(64),
  };
}

test('構造検査は工程依存SVGと別panelでnode種別・edge・finding移動先を表示する', () => {
  const html = renderTodoGanttHtml({
    readModel, layout, structurePresentation: structurePresentation(),
  }).html;
  const processPane = html.slice(html.indexOf('<section class="gantt-pane"'), html.indexOf('<div class="pane-divider"'));
  assert.doesNotMatch(processPane, /structure-node|structure-edge-list|STRUCTURE_CONTRACT_MISMATCH/u);
  assert.match(html, /data-show-structure>構造検査/u);
  assert.match(html, /data-right-panel="structure" hidden/u);
  for (const label of ['工程変換', 'データ', 'コード', '外部契約', 'commit']) {
    assert.match(html, new RegExp(label, 'u'));
  }
  assert.match(html, /planned: planned出力を作る/u);
  assert.match(html, /effective: realized出力を作る/u);
  assert.match(html, /src\/writer\.mjs/u);
  assert.match(html, /STRUCTURE_CONTRACT_MISMATCH/u);
  assert.match(html, /data-structure-target-id="structure-node-0-0"/u);
  assert.match(html, /data-structure-target-id="structure-node-0-1"/u);
  assert.match(html, /data-structure-target-id="structure-node-0-2"/u);
  assert.match(html, /data-structure-target-id="structure-edge-0-0"/u);
  assert.match(html, /id="structure-edge-0-0" data-structure-edge-from="task:T1" data-structure-edge-to="data:T1\/result"/u);
  assert.match(html, /<noscript><section class="structure-noscript"><h1>構造検査の指摘/u);
});

test('構造未適用なら独立panelを出さず、異なるprojectのprojectionは拒否する', () => {
  const empty = { schema: TODO_STRUCTURE_PRESENTATION_SCHEMA, project_id: 'project-1', plans: [], projection_digest: '0'.repeat(64) };
  const html = renderTodoGanttHtml({ readModel, layout, structurePresentation: empty }).html;
  assert.doesNotMatch(html, /<button type="button" data-show-structure|<section class="structure-inspection" data-right-panel="structure"/u);
  assert.throws(() => renderTodoGanttHtml({
    readModel, layout, structurePresentation: { ...empty, project_id: 'other' },
  }), /structurePresentation/u);
});

test('unknownは問題なしへ丸めず、次の一手と同じ独立面へ表示する', () => {
  const presentation = structurePresentation();
  presentation.plans[0].coverage = 'unknown';
  presentation.plans[0].freshness = 'fresh';
  presentation.plans[0].verdict = 'unknown';
  presentation.plans[0].compiled_verdict = 'unknown';
  presentation.plans[0].findings[0].severity = 'unknown';
  presentation.plans[0].findings[0].next_action = 'collect_missing_sensor_evidence';
  const html = renderTodoGanttHtml({ readModel, layout, structurePresentation: presentation }).html;
  assert.match(html, /structure-verdict verdict-unknown">unknown/u);
  assert.match(html, /severity-unknown/u);
  assert.match(html, /次: <code>collect_missing_sensor_evidence<\/code>/u);
});
