import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt, TodoGanttLayoutError } from '../src/todo-gantt-layout.mjs';
import {
  renderTodoGanttHtml,
  TODO_GANTT_HTML_MAX_BYTES,
  TODO_GANTT_PROSE_MAX_BYTES,
  TodoGanttRenderError,
} from '../src/todo-gantt-html.mjs';
import { TODO_MARKDOWN_SECTION_MAX_BYTES } from '../src/todo-markdown-renderer.mjs';
import {
  createTodoStoreWriter,
  initializeTodoStore,
} from '../src/todo-store.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const NOW = '2026-07-18T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const ref = (task_id, plan_key = 'main') => ({ project_id: 'project-1', plan_key, task_id });

function readFixture(taskCount, edges = []) {
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    task_id: `T${String(index).padStart(4, '0')}`, title: `Task ${index}`, lane: `lane-${index % 8}`,
    narrative_ref: null, compile_binding: null,
  }));
  return {
    schema: 'lattice.todo_store_read.v1', project_id: 'project-1',
    members: [{
      plan: { project_id: 'project-1', plan_key: 'main', tasks, hard_dependencies: edges, joins: [] },
      tasks: tasks.map(({ task_id }) => ({ task_id, status: 'pending', started_at: null,
        done_at: null, blocked_reason: null, evidence: null, evidence_unverified: false })),
    }],
  };
}

function topology(read) {
  return {
    nodes: read.members.flatMap(({ plan }) => plan.tasks.map(({ task_id }) => ref(task_id, plan.plan_key))),
    hard_edges: read.members.flatMap(({ plan }) => plan.hard_dependencies),
    joins: read.members.flatMap(({ plan }) => plan.joins),
  };
}

function renderFixture(read, narratives = []) {
  const chain = projectTodoChainV1(topology(read));
  const layout = layoutTodoGantt(read, chain);
  return renderTodoGanttHtml({ readModel: read, layout, narratives });
}

async function workspace(context, title = 'T1') {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-gantt-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  await writeFile(path.join(root, 'narrative.md'), [
    '# Background', '', title, '', '- [ ] Follow-up', '', '[unsafe](javascript:alert(1))',
    '<svg onload=alert(2)>', '</script><script>alert(3)</script>',
    '[web](https://example.com/path)',
  ].join('\n'));
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }], now: NOW,
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [{ task_id: 'T1', title, lane: 'main', narrative_ref: 'narrative.md', compile_binding: null }],
        hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
  });
  return root;
}

async function graphWorkspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-gantt-graph-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  const tasks = [
    { task_id: 'T1', title: 'Recon', lane: 'recon', narrative_ref: null, compile_binding: null },
    { task_id: 'T2', title: 'Implement', lane: 'impl', narrative_ref: null, compile_binding: null },
    { task_id: 'T3', title: 'Verify', lane: 'verify', narrative_ref: null, compile_binding: null },
    { task_id: 'T4', title: 'Alternate', lane: 'impl', narrative_ref: null, compile_binding: null },
  ];
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }], now: NOW,
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null, tasks,
        hard_dependencies: [
          { from: ref('T1'), to: ref('T2') },
          { from: ref('T1'), to: ref('T4') },
          { from: ref('T2'), to: ref('T3') },
        ],
        joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
  });
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
}

test('small real store E2E generates the default self-contained gantt and exact binding result', async (context) => {
  const root = await workspace(context);
  const execution = run(root, ['todo', 'gantt']);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, '');
  const result = JSON.parse(execution.stdout);
  assert.deepEqual(Object.keys(result), [
    'schema', 'project_id', 'output_ref', 'manifest_digest', 'member_bindings',
    'narrative_bindings_digest', 'chain_digest', 'layout_digest', 'renderer_version',
    'html_digest', 'result_digest',
  ]);
  assert.equal(result.schema, 'lattice.todo_gantt_result.v1');
  assert.equal(result.output_ref, '.lattice/generated/gantt.html');
  assert.equal(result.result_digest, todoSelfDigest(result, 'result_digest'));
  assert.equal(path.isAbsolute(result.output_ref), false);
  assert.equal(JSON.stringify(result).includes('file://'), false);
  const html = await readFile(path.join(root, result.output_ref), 'utf8');
  assert.match(html, /class="todo-gantt"/u);
  assert.match(html, /data-node-key=/u);
  assert.match(html, /tabindex="0" role="button" aria-selected="false"/u);
  assert.match(html, /unit-weightの構造深さであり実時間・資源律速ではない/u);
  assert.match(html, /<h1>Background<\/h1>/u);
  assert.match(html, /class="markdown-checkbox" role="img" aria-label="unchecked">☐/u);
  assert.match(html, /class="document-status status-pending" role="img" aria-label="未着手">☐/u);
});

test('real store smoke draws every edge and emits compact nodes plus concise category totals', async (context) => {
  const root = await graphWorkspace(context);
  const execution = run(root, ['todo', 'gantt']);
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.renderer_version, 'lattice.todo_gantt_renderer.v2');
  const html = await readFile(path.join(root, result.output_ref), 'utf8');
  assert.equal((html.match(/<g class="dependency-edge(?: |")/gu) ?? []).length, 3);
  assert.equal((html.match(/data-node-key=/gu) ?? []).length, 4);
  assert.match(html, /class="summary-plan"[^>]*aria-label="main — 4 ToDo"/u);
  assert.match(html, /class="summary-lane"[^>]*aria-label="impl — 2 ToDo"/u);
  assert.ok(html.indexOf('class="summary-plan"') < html.indexOf('class="summary-lane"'));
  assert.doesNotMatch(html, /main\/(?:recon|impl|verify)/u);
  assert.doesNotMatch(html, /hidden edges|folded edges|data-fold-state|bundle-badge/u);
  assert.doesNotMatch(html, /class="node-time"|S:|D:|Started at|Done at/u);
  assert.doesNotMatch(html, /class="task-facts"|class="evidence"|<dl|<dt>/u);
  assert.match(html, /class="document-status status-pending"[^>]*>☐<\/span>/u);
  assert.match(html, /\.narrative-body\{[^}]*max-width:72ch[^}]*font-size:13\.5px[^}]*font-weight:400[^}]*line-height:1\.6/u);
  assert.match(html, /\.task-line h2\{[^}]*font-size:16px[^}]*font-weight:600/u);
  assert.match(html, /\.plan-title\{[^}]*font-size:19px[^}]*font-weight:650/u);
  const palette = [...new Set(html.match(/#[0-9a-f]{6}/gu) ?? [])].sort();
  assert.deepEqual(palette, [
    '#0b0b0b', '#0ca30c', '#2a78d6', '#52514e', '#d03b3b', '#d9d8d4', '#f4f4f2', '#fcfcfb',
  ]);
  assert.doesNotMatch(html, /#7c3aed|drop-shadow|font-size:30px/u);
});

test('custom output remains repo-relative and traversal/absolute refs are usage failures', async (context) => {
  const root = await workspace(context);
  const success = run(root, ['todo', 'gantt', '--out', 'artifacts/todo.html']);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).output_ref, 'artifacts/todo.html');
  for (const bad of ['../escape.html', '/tmp/escape.html', 'a/../../escape.html']) {
    const failure = run(root, ['todo', 'gantt', '--out', bad]);
    assert.equal(failure.status, 2);
    assert.equal(failure.stdout, '');
  }
});

test('right pane reads as a Markdown document while retaining all/selected/reset states', () => {
  const read = readFixture(2);
  for (const task of read.members[0].plan.tasks) task.narrative_ref = 'plan.md';
  const markdown = '# Intent\n\n- [ ] Keep the document flow\n\n## Acceptance\n\nOrdinary prose.';
  const output = renderFixture(read, read.members[0].plan.tasks.map(({ task_id }) => ({
    ref: ref(task_id), narrative_ref: 'plan.md', markdown,
  })));
  assert.equal((output.html.match(/data-narrative-key=/gu) ?? []).length, 2);
  assert.equal((output.html.match(/<h1>Intent<\/h1>/gu) ?? []).length, 1);
  assert.match(output.html, /data-view-state="all"/u);
  assert.match(output.html, /<button type="button" data-show-all>全文表示へ戻る<\/button>/u);
  assert.match(output.html, /line\.hidden=line\.dataset\.narrativeKey!==key/u);
  assert.match(output.html, /item\.section\.hidden=!item\.lines\.some/u);
  assert.match(output.html, /event\.key==='Enter'\|\|event\.key===' '/u);
  assert.match(output.html, /event\.key==='Escape'/u);
  assert.equal((output.html.match(/root\.addEventListener\('click'/gu) ?? []).length, 1);
  assert.equal((output.html.match(/root\.addEventListener\('keydown'/gu) ?? []).length, 1);
  assert.match(output.html, /class="diagram-scroll" data-diagram-scroll tabindex="0"/u);
  assert.match(output.html, /data-zoom-action="fit">全体表示/u);
  assert.match(output.html, /\.diagram-scroll\{[^}]*max-width:100%;overflow:auto/u);
  assert.match(output.html, /grid-template-columns:minmax\(0,58%\)/u);
  assert.match(output.html, /<div class="narrative-document"><section class="plan-document"><h1 class="plan-title"><code>main<\/code><\/h1>/u);
  assert.match(output.html, /<h2>Acceptance<\/h2>/u);
  assert.match(output.html, /class="markdown-checkbox" role="img" aria-label="unchecked">☐/u);
  assert.doesNotMatch(output.html, /class="task-facts"|class="evidence"|<dl|<dt>/u);
  assert.equal(output.html.includes('innerHTML'), false);
  assert.doesNotMatch(output.html, /\son[a-z]+\s*=/iu);
});

test('SVG renders compact status nodes, every edge, join marker, and hierarchical summary without timestamps', () => {
  const T0 = ref('T0000'); const T1 = ref('T0001'); const T2 = ref('T0002');
  const read = readFixture(4, [{ from: T0, to: T1 }]);
  read.members[0].plan.joins = [{ id: 'join-all', after: [T0, T1], before: T2 }];
  Object.assign(read.members[0].tasks[0], { status: 'done', started_at: NOW, done_at: NOW });
  Object.assign(read.members[0].tasks[1], { status: 'in-progress', started_at: NOW });
  Object.assign(read.members[0].tasks[2], { status: 'blocked', blocked_reason: 'Waiting for owner' });
  const html = renderFixture(read).html;
  assert.match(html, /class="todo-node status-done longest-chain-node/u);
  assert.match(html, /class="todo-node status-in-progress longest-chain-node active-node/u);
  assert.match(html, /class="todo-node status-blocked longest-chain-node/u);
  assert.match(html, /class="status-mark"[^>]*>☐<\/text>/u);
  assert.match(html, /class="status-mark"[^>]*>▶<\/text>/u);
  assert.match(html, /class="status-mark"[^>]*>✅<\/text>/u);
  assert.match(html, /class="status-mark"[^>]*>⛔<\/text>/u);
  assert.match(html, /class="dependency-edge longest-chain-edge/u);
  assert.equal((html.match(/<g class="dependency-edge(?: |")/gu) ?? []).length, 3);
  assert.match(html, /class="join-marker" aria-label="join join-all"/u);
  assert.match(html, /class="todo-summary" aria-label="カテゴリ別ToDo集計表"/u);
  assert.match(html, /class="summary-plan"[^>]*><rect[^>]*class="summary-chip plan-chip"/u);
  assert.match(html, /class="summary-lane"/u);
  assert.match(html, /class="summary-plan-group"[^>]*><rect class="summary-container"/u);
  assert.doesNotMatch(html, /class="summary-connector"/u);
  assert.match(html, /class="status-bar"/u);
  assert.match(html, /class="blocked-reason">— Waiting for owner<\/span>/u);
  assert.doesNotMatch(html, /main\/lane-/u);
  assert.doesNotMatch(html, /hidden edges|folded edges|data-fold-state|bundle-badge/u);
  assert.doesNotMatch(html, /class="node-time"|S:07-18|D:07-18|Started at|Done at/u);
  assert.doesNotMatch(html, /class="task-facts"|class="evidence"|<dl|<dt>/u);
});

test('XSS through narrative and task title is inert in the final document', async (context) => {
  const payload = '</script><script>globalThis.pwned=1</script><svg onload=alert(1)>';
  const root = await workspace(context, payload);
  const execution = run(root, ['todo', 'gantt']);
  assert.equal(execution.status, 0, execution.stderr);
  const html = await readFile(path.join(root, '.lattice/generated/gantt.html'), 'utf8');
  assert.equal(html.includes('<script>globalThis.pwned=1</script>'), false);
  assert.equal(html.includes('<svg onload='), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('href="https://example.com'), false);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;globalThis\.pwned=1/u);
});

test('task/edge scale limit accepts 2,000/8,000 and rejects N+1', { timeout: 15_000 }, () => {
  const edges = [];
  for (let distance = 1; edges.length < 8_001; distance += 1) {
    for (let from = 0; from + distance < 2_000 && edges.length < 8_001; from += 1) {
      edges.push({ from: ref(`T${String(from).padStart(4, '0')}`),
        to: ref(`T${String(from + distance).padStart(4, '0')}`) });
    }
  }
  const atLimit = readFixture(2_000, edges.slice(0, 8_000));
  const rendered = renderFixture(atLimit);
  assert.equal((rendered.html.match(/<g class="dependency-edge(?: |")/gu) ?? []).length, 8_000);
  assert.ok(rendered.html_bytes > 0 && rendered.html_bytes <= TODO_GANTT_HTML_MAX_BYTES);
  assert.throws(() => layoutTodoGantt(readFixture(2_001), projectTodoChainV1(topology(readFixture(2_001)))),
    (error) => error instanceof TodoGanttLayoutError && error.code === 'TODO_SCALE_EXCEEDED');
  const overEdges = readFixture(2_000, edges);
  assert.throws(() => layoutTodoGantt(overEdges, projectTodoChainV1(topology(overEdges))),
    (error) => error instanceof TodoGanttLayoutError && error.code === 'TODO_SCALE_EXCEEDED'
      && error.detail.edge_count === 8_001);
});

test('aggregate prose limit accepts N-1/N and rejects N+1', { timeout: 15_000 }, () => {
  const read = readFixture(33);
  const oneSection = 'a'.repeat(TODO_MARKDOWN_SECTION_MAX_BYTES);
  const narrativeFor = (sizes) => sizes.map((size, index) => ({
    ref: ref(`T${String(index).padStart(4, '0')}`), markdown: 'a'.repeat(size),
  }));
  const base = Array.from({ length: 32 }, () => TODO_MARKDOWN_SECTION_MAX_BYTES);
  const below = [...base]; below[31] -= 1;
  assert.equal(renderFixture(read, narrativeFor(below)).prose_bytes, TODO_GANTT_PROSE_MAX_BYTES - 1);
  assert.equal(renderFixture(read, narrativeFor(base)).prose_bytes, TODO_GANTT_PROSE_MAX_BYTES);
  assert.throws(() => renderFixture(read, narrativeFor([...base, 1])),
    (error) => error instanceof TodoGanttRenderError && error.code === 'TODO_SCALE_EXCEEDED'
      && error.detail.prose_bytes === TODO_GANTT_PROSE_MAX_BYTES + 1);
  assert.equal(oneSection.length, TODO_MARKDOWN_SECTION_MAX_BYTES);
});
