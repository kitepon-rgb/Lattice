import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt, TodoGanttLayoutError } from '../src/todo-gantt-layout.mjs';
import { projectTodoGanttPresentation } from '../src/todo-gantt-presentation.mjs';
import {
  renderTodoGanttHtml,
  TODO_GANTT_HTML_MAX_BYTES,
  TODO_GANTT_PROSE_MAX_BYTES,
  TodoGanttRenderError,
} from '../src/todo-gantt-html.mjs';
import { TODO_MARKDOWN_SECTION_MAX_BYTES } from '../src/todo-markdown-renderer.mjs';
import { verifyNarrativeAnchors } from '../src/todo-narrative-anchor.mjs';
import {
  createTodoStoreWriter,
  initializeTodoStore,
} from '../src/todo-store.mjs';
import { digestTodoArtifact, todoSelfDigest } from '../src/todo-contracts.mjs';

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

function renderFixture(read, narratives = [], anchorOutcomes = [], document = null, metadata = {}) {
  const chain = projectTodoChainV1(topology(read));
  const layout = layoutTodoGantt(read, chain);
  const presentation = projectTodoGanttPresentation(read, document);
  return renderTodoGanttHtml({ readModel: read, layout, narratives, anchorOutcomes, presentation, metadata });
}

test('v5 GanttはPhaseを通常ToDoのschedule gateとして説明しない', () => {
  const read = readFixture(2);
  const member = read.members[0];
  member.plan.schema = 'lattice.todo_plan.v5';
  member.plan.tasks = member.plan.tasks.map((task, index) => ({
    ...task, narrative_anchor: null, parent_task_id: null, phase_id: `phase-${index + 1}`,
  }));
  member.plan.phases = [
    { phase_id: 'phase-1', title: '設計', gate_policy: 'heavy', predecessor_phase_ids: [],
      required_evidence_slots: ['heavy'] },
    { phase_id: 'phase-2', title: '実装', gate_policy: 'heavy', predecessor_phase_ids: ['phase-1'],
      required_evidence_slots: ['heavy'] },
  ];
  member.plan.phase_accept_dependencies = [];
  member.snapshot = { phases: [
    { phase_id: 'phase-1', status: 'active' },
    { phase_id: 'phase-2', status: 'locked' },
  ] };
  const { html } = renderFixture(read);
  assert.match(html, /Phaseは重監査の順序を表し、通常ToDoの開始順はToDo依存だけで決まります。/u);
  assert.doesNotMatch(html, /後続Phaseはまだ解放されません/u);
  const ungatedLayout = layoutTodoGantt(read, projectTodoChainV1(topology(read)));
  assert.deepEqual(ungatedLayout.nodes.filter(({ visibility }) => visibility.next_ready)
    .map(({ ref: taskRef }) => taskRef.task_id), ['T0000', 'T0001']);

  member.plan.phase_accept_dependencies = [{
    from: { project_id: 'project-1', plan_key: 'main', phase_id: 'phase-1' },
    to: ref('T0001'),
  }];
  const gatedLayout = layoutTodoGantt(read, projectTodoChainV1(topology(read)));
  assert.deepEqual(gatedLayout.nodes.filter(({ visibility }) => visibility.next_ready)
    .map(({ ref: taskRef }) => taskRef.task_id), ['T0000']);
});

async function workspace(context, title = 'T1', narrativeRef = 'narrative.md') {
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
        tasks: [{ task_id: 'T1', title, lane: 'main', narrative_ref: narrativeRef, compile_binding: null }],
        hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
  });
  return root;
}

async function anchoredWorkspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-gantt-anchor-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  const markdown = '# Plan\n- [ ] Anchored task\n';
  await writeFile(path.join(root, 'plan.md'), markdown);
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root, input: markdown, encoding: 'utf8',
  });
  assert.equal(blob.status, 0, blob.stderr);
  const tree = spawnSync('git', ['mktree'], {
    cwd: root, input: `100644 blob ${blob.stdout.trim()}\tplan.md\n`, encoding: 'utf8',
  });
  assert.equal(tree.status, 0, tree.stderr);
  const commit = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: root,
    input: `tree ${tree.stdout.trim()}\nauthor Fixture <fixture@example.invalid> 1760000000 +0000\ncommitter Fixture <fixture@example.invalid> 1760000000 +0000\n\nfixture\n`,
    encoding: 'utf8',
  });
  assert.equal(commit.status, 0, commit.stderr);
  const task = {
    task_id: 'T1', title: 'Anchored task', lane: 'main', narrative_ref: 'plan.md',
    narrative_anchor: {
      origin_plan_ref: 'plan.md', origin_line: 2, source_commit: commit.stdout.trim(),
      source_line_digest: createHash('sha256').update('- [ ] Anchored task').digest('hex'),
    },
    compile_binding: null,
  };
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }], now: NOW,
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v2', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v2', predecessor_plan_digest: null, tasks: [task],
        hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
  });
  return { root, markdown };
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

function taskNodeY(html) {
  const positions = new Map();
  const pattern = /<g class="todo-node[^"]*"[^>]*data-task-id="([^"]+)"[^>]*><rect class="node-surface" x="[^"]+" y="([^"]+)"/gu;
  for (const match of html.matchAll(pattern)) positions.set(match[1], Number(match[2]));
  return positions;
}

test('small real store E2E generates the default self-contained gantt and exact binding result', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, '.lattice', 'project.json'), `${JSON.stringify({
    schema: 'lattice.project_identity.v1', project_id: 'project-1', display_name: 'Fixture Project',
  })}\n`);
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
  assert.equal(result.renderer_version, 'lattice.todo_gantt_renderer.v8');
  const generatedHtml = await readFile(path.join(root, '.lattice', 'generated', 'gantt.html'), 'utf8');
  assert.match(generatedHtml, /<title>Lattice — Fixture Project 依存工程図<\/title>/u);
  const narrativeBytes = await readFile(path.join(root, 'narrative.md'));
  assert.equal(result.narrative_bindings_digest, digestTodoArtifact([{
    project_id: 'project-1',
    plan_key: 'main',
    task_id: 'T1',
    narrative_ref: 'narrative.md',
    content_digest: createHash('sha256').update(narrativeBytes).digest('hex'),
    anchored: false,
    reason: 'anchor_missing',
  }]));
  assert.equal(result.result_digest, todoSelfDigest(result, 'result_digest'));
  assert.equal(path.isAbsolute(result.output_ref), false);
  assert.equal(JSON.stringify(result).includes('file://'), false);
  const html = await readFile(path.join(root, result.output_ref), 'utf8');
  assert.match(html, /class="todo-gantt"/u);
  assert.match(html, /data-node-key=/u);
  assert.match(html, /tabindex="0" role="button" aria-selected="false"/u);
  assert.match(html, /構造上の最長依存鎖は各工程を同じ重みとして数え、実時間・工数・資源律速を表さない/u);
  assert.match(html, /data-right-panel="task-index" hidden/u);
  assert.match(html, /class="task-index-status status-pending" role="img" aria-label="未着手">☐<\/span>/u);
  assert.match(html, /class="task-index-reference">工程 1<\/span>/u);
  assert.doesNotMatch(html, /<h1>Background<\/h1>|class="markdown-checkbox"/u);
  assert.match(html, /"presentation_digest":"[0-9a-f]{64}"/u);
  assert.match(html, /"schema":"lattice\.todo_gantt_presentation_model\.v1"/u);
  assert.match(html, /"task_id":"T1","display_number":"1","normalized_number":"1"/u);
});

test('manual gantt serveもproject identity fileのdisplay nameを使う', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, '.lattice', 'project.json'), `${JSON.stringify({
    schema: 'lattice.project_identity.v1', project_id: 'project-1', display_name: 'Manual Fixture',
  })}\n`);
  const child = spawn(process.execPath, [CLI, 'todo', 'gantt', 'serve', '--port', '0'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LATTICE_DASHBOARD_AUTOSTART: '0' },
  });
  context.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  let stdout = '';
  while (!stdout.includes('\n')) {
    const [chunk] = await once(child.stdout, 'data');
    stdout += chunk.toString('utf8');
  }
  const live = JSON.parse(stdout.split('\n')[0]);
  const response = await fetch(live.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Lattice — Manual Fixture 依存工程図<\/title>/u);
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});

test('gantt statusはmissing/current/staleを区別しartifact改竄をtyped拒否する', async (context) => {
  const root = await workspace(context);
  const missingExecution = run(root, ['todo', 'gantt', 'status']);
  assert.equal(missingExecution.status, 0, missingExecution.stderr);
  const missing = JSON.parse(missingExecution.stdout);
  assert.equal(missing.schema, 'lattice.todo_gantt_status_result.v1');
  assert.equal(missing.artifact_status, 'missing');
  assert.equal(missing.artifact_manifest_digest, null);
  assert.equal(missing.html_digest, null);

  const generated = run(root, ['todo', 'gantt']);
  assert.equal(generated.status, 0, generated.stderr);
  const currentExecution = run(root, ['todo', 'gantt', 'status']);
  assert.equal(currentExecution.status, 0, currentExecution.stderr);
  const current = JSON.parse(currentExecution.stdout);
  assert.equal(current.artifact_status, 'current');
  assert.equal(current.current_manifest_digest, current.artifact_manifest_digest);
  assert.equal(current.result_digest, todoSelfDigest(current, 'result_digest'));
  const descriptor = JSON.parse(await readFile(path.join(root, current.descriptor_ref), 'utf8'));
  assert.equal(descriptor.schema, 'lattice.todo_gantt_artifact.v1');
  assert.equal(descriptor.html_digest, current.html_digest);
  assert.equal(descriptor.artifact_digest, todoSelfDigest(descriptor, 'artifact_digest'));

  await writeFile(path.join(root, 'narrative.md'), '# Changed narrative\n');
  const staleExecution = run(root, ['todo', 'gantt', 'status']);
  assert.equal(staleExecution.status, 0, staleExecution.stderr);
  assert.equal(JSON.parse(staleExecution.stdout).artifact_status, 'stale');

  await writeFile(path.join(root, current.output_ref), 'tampered\n');
  const invalid = run(root, ['todo', 'gantt', 'status']);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  const error = JSON.parse(invalid.stderr);
  assert.equal(error.code, 'GANTT_ARTIFACT_INVALID');
  assert.equal(error.detail.reason, 'artifact_digest_mismatch');
});

test('Gantt narrativeはarchive line fragmentをfile pathと混同せず1行だけ読む', async (context) => {
  const root = await workspace(context, 'fragment narrative', 'narrative.md#L3');
  const execution = run(root, ['todo', 'gantt']);
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.narrative_bindings_digest, digestTodoArtifact([{
    project_id: 'project-1', plan_key: 'main', task_id: 'T1',
    narrative_ref: 'narrative.md#L3',
    content_digest: createHash('sha256').update('fragment narrative').digest('hex'),
    anchored: false, reason: 'anchor_missing',
  }]));
  const html = await readFile(path.join(root, result.output_ref), 'utf8');
  assert.match(html, /fragment narrative/u);
  assert.doesNotMatch(html, /# Background/u);
});

test('v2 anchor成立のCLI ganttはoutcomeをbinding digestと行内markの両方へ一度で束縛する', async (context) => {
  const { root, markdown } = await anchoredWorkspace(context);
  const execution = run(root, ['todo', 'gantt']);
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.deepEqual(Object.keys(result), [
    'schema', 'project_id', 'output_ref', 'manifest_digest', 'member_bindings',
    'narrative_bindings_digest', 'chain_digest', 'layout_digest', 'renderer_version',
    'html_digest', 'result_digest',
  ]);
  assert.equal(result.narrative_bindings_digest, digestTodoArtifact([{
    project_id: 'project-1', plan_key: 'main', task_id: 'T1', narrative_ref: 'plan.md',
    content_digest: createHash('sha256').update(markdown).digest('hex'), anchored: true, reason: null,
  }]));
  const html = await readFile(path.join(root, result.output_ref), 'utf8');
  assert.match(html, /class="task-index-status status-pending" role="img" aria-label="未着手">☐<\/span>/u);
  assert.doesNotMatch(html, /class="task-line"|class="narrative-warning"|class="narrative-body"/u);
});

test('real store smoke draws every edge and emits readable nodes plus named category totals', async (context) => {
  const root = await graphWorkspace(context);
  await writeFile(path.join(root, '.lattice', 'todo', 'gantt-presentation.json'), `${JSON.stringify({
    schema: 'lattice.todo_gantt_presentation.v1',
    project_id: 'project-1',
    plans: [{
      plan_key: 'main',
      lanes: [
        { lane: 'impl', name: '実装', description: '実装工程。' },
        { lane: 'recon', name: '調査', description: '調査工程。' },
        { lane: 'verify', name: '検証', description: '検証工程。' },
      ],
    }],
  })}\n`);
  const execution = run(root, ['todo', 'gantt']);
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.renderer_version, 'lattice.todo_gantt_renderer.v8');
  const html = await readFile(path.join(root, result.output_ref), 'utf8');
  assert.equal((html.match(/<g class="dependency-edge(?: |")/gu) ?? []).length, 3);
  assert.equal((html.match(/data-node-key=/gu) ?? []).length, 4);
  assert.match(html, /class="summary-plan"[^>]*aria-label="main — 4 ToDo"/u);
  assert.match(html, /class="summary-lane"[^>]*aria-label="impl — 実装、2 ToDo。実装工程。"/u);
  assert.match(html, />impl · 実装 2<\/text>/u);
  assert.ok(html.indexOf('class="summary-plan"') < html.indexOf('class="summary-lane"'));
  assert.doesNotMatch(html, /main\/(?:recon|impl|verify)/u);
  assert.doesNotMatch(html, /hidden edges|folded edges|data-fold-state|bundle-badge/u);
  assert.doesNotMatch(html, /class="node-time"|>S:|>D:|Started at|Done at/u);
  assert.doesNotMatch(html, /class="task-facts"|class="evidence"/u);
  const positions = taskNodeY(html);
  assert.ok(positions.get('T1') < positions.get('T2'));
  assert.ok(positions.get('T2') < positions.get('T3'));
  assert.match(html, /class="task-index-status status-pending"[^>]*>☐<\/span>/u);
  assert.equal((html.match(/class="task-index-status status-/gu) ?? []).length, 4);
  assert.doesNotMatch(html, /class="narrative-warning"|class="narrative-body"/u);
  assert.match(html, /\.task-index-list button\{[^}]*display:grid;width:100%/u);
  assert.match(html, /\.task-index-list strong\{[^}]*font-size:13\.5px[^}]*font-weight:600/u);
  assert.match(html, /\.task-index-plan h2\{[^}]*font-size:16px[^}]*font-weight:600/u);
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

test('right pane exposes overview/detail/current task index states while retaining navigation controls', () => {
  const read = readFixture(2, [{ from: ref('T0000'), to: ref('T0001') }]);
  for (const task of read.members[0].plan.tasks) task.narrative_ref = 'plan.md';
  Object.assign(read.members[0].tasks[1], { status: 'in-progress', started_at: NOW });
  const markdown = '# Intent\n\n- [ ] Keep the document flow\n\n## Acceptance\n\nOrdinary prose.';
  const output = renderFixture(read, read.members[0].plan.tasks.map(({ task_id }) => ({
    ref: ref(task_id), narrative_ref: 'plan.md', markdown,
  })), [], {
    schema: 'lattice.todo_gantt_presentation.v1',
    project_id: 'project-1',
    plans: [{
      plan_key: 'main',
      lanes: [
        { lane: 'lane-0', name: '調査', description: '調査工程。' },
        { lane: 'lane-1', name: '実装', description: '実装工程。' },
      ],
    }],
  });
  assert.equal((output.html.match(/class="task-index-status status-/gu) ?? []).length, 2);
  assert.equal((output.html.match(/<h1>Intent<\/h1>/gu) ?? []).length, 0);
  assert.match(output.html, /data-view-state="overview"/u);
  assert.match(output.html, /<button type="button" data-show-overview>概要<\/button>/u);
  assert.match(output.html, /<button type="button" data-show-selected hidden>選択工程へ戻る<\/button>/u);
  assert.match(output.html, /<button type="button" data-show-task-index>元Markdown全文<\/button>/u);
  assert.match(output.html, /data-right-panel="overview"/u);
  assert.match(output.html, /data-right-panel="details" hidden/u);
  assert.match(output.html, /data-right-panel="task-index" hidden/u);
  assert.equal((output.html.match(/class="task-detail" data-detail-key=/gu) ?? []).length, 2);
  assert.match(output.html, /<div class="status-summary"><span>☐ 未着手 1<\/span><span>▶ 作業中 1<\/span>/u);
  assert.match(output.html, /<strong>カテゴリ:<\/strong> lane-0 — 調査/u);
  assert.match(output.html, /class="category-description">調査工程。<\/p>/u);
  assert.match(output.html, /<h2>前提工程<\/h2>/u);
  assert.match(output.html, /<h2>後続工程<\/h2>/u);
  assert.match(output.html, /data-select-node-key="\[&quot;project-1&quot;,&quot;main&quot;,&quot;T0001&quot;\]"/u);
  assert.match(output.html, /const detailPanels=\[\.\.\.root\.querySelectorAll\('\[data-detail-key\]'\)\]/u);
  assert.match(output.html, /const showOverview=\(\)=>/u);
  assert.match(output.html, /const showTaskIndex=\(\)=>/u);
  assert.match(output.html, /const showSelected=\(\)=>/u);
  assert.match(output.html, /selectedReturnButton\.hidden=name!=='task-index'\|\|selectedKey===null/u);
  assert.match(output.html, /edge\.classList\.toggle\('selected-incident-edge',selected&&\(edge\.dataset\.fromNodeKey===selectedKey\|\|edge\.dataset\.toNodeKey===selectedKey\)\)/u);
  assert.match(output.html, /event\.key==='Enter'\|\|event\.key===' '/u);
  assert.match(output.html, /event\.key==='Escape'/u);
  assert.match(output.html, /const selectButton=event\.target\.closest\('\[data-select-node-key\]'\)/u);
  assert.equal((output.html.match(/root\.addEventListener\('click'/gu) ?? []).length, 1);
  assert.equal((output.html.match(/root\.addEventListener\('keydown'/gu) ?? []).length, 1);
  assert.match(output.html, /class="diagram-scroll" data-diagram-scroll tabindex="0"/u);
  assert.match(output.html, /data-zoom-action="reset">等倍<\/button>/u);
  assert.match(output.html, /data-zoom-action="fit">全体表示/u);
  assert.match(output.html, /zoom<1&&zoom\*1\.25>=1\?1:zoom\*1\.25/u);
  assert.match(output.html, /zoom>1&&zoom\/1\.25<=1\?1:zoom\/1\.25/u);
  assert.match(output.html, /scroller\.scrollTo\(0,0\)/u);
  assert.match(output.html, /\.diagram-scroll\{[^}]*max-width:calc\(100% - 16px\);margin:8px;overflow:auto[^}]*border:1px solid rgba\(217,216,212,\.5\)/u);
  assert.match(output.html, /grid-template-columns:minmax\(0,var\(--split,58%\)\) auto minmax\(24rem,1fr\)/u);
  assert.match(output.html, /<div class="pane-divider" data-pane-divider aria-hidden="true"><\/div>/u);
  assert.match(output.html, /\.pane-divider\{width:8px;cursor:col-resize;background:rgba\(217,216,212,\.5\);touch-action:none\}/u);
  assert.match(output.html, /@media\(max-width:900px\)\{body\{display:block;height:auto\}\.shell\{display:block\}\.pane-divider\{display:none\}/u);
  assert.match(output.html, /root\.addEventListener\('pointerdown'/u);
  assert.match(output.html, /root\.addEventListener\('pointermove'/u);
  assert.match(output.html, /root\.addEventListener\('pointerup'/u);
  assert.match(output.html, /paneDivider\.setPointerCapture\(event\.pointerId\)/u);
  assert.match(output.html, /Math\.max\(30,Math\.min\(75,/u);
  assert.match(output.html, /shell\.style\.setProperty\('--split',percent\+'%'\)/u);
  assert.match(output.html, /root\.addEventListener\('dblclick',event=>\{const paneDivider=[^}]+shell\.style\.setProperty\('--split','58%'\)/u);
  assert.match(output.html, /data-right-panel="task-index" hidden><h1>全工程<\/h1>/u);
  assert.match(output.html, /<section class="task-index-plan"><h2><code>main<\/code><\/h2><ol class="task-index-list">/u);
  assert.match(output.html, /class="task-index-reference">工程 0000<\/span><strong>Task 0<\/strong>/u);
  assert.match(output.html, /class="task-index-reference">工程 0001<\/span><strong>Task 1<\/strong>/u);
  assert.ok(output.html.indexOf('<strong>Task 0</strong>') < output.html.indexOf('<strong>Task 1</strong>'));
  assert.doesNotMatch(output.html, /Keep the document flow|<h2>Acceptance<\/h2>|class="markdown-checkbox"/u);
  assert.match(output.html, /\.next-ready-node \.node-surface\{stroke:var\(--accent\);stroke-width:2;stroke-dasharray:4 3\}/u);
  assert.match(output.html, /data-task-id="T0000" data-task-number="0000" data-task-number-normalized="0"/u);
  assert.match(output.html, /aria-label="工程0000。未着手。lane-0、調査。Task 0。正規ID main\/T0000。ready frontierの同時dispatch候補"/u);
  assert.match(output.html, /class="node-meta"[^>]*>未着手 · 工程 0000<\/text>/u);
  assert.match(output.html, /<tspan[^>]*class="node-title-line">Task 0<\/tspan>/u);
  assert.match(output.html, /\.dependency-edge \.edge-arrow\{fill:var\(--text-secondary\);opacity:\.7\}/u);
  assert.match(output.html, /data-from-node-key="\[&quot;project-1&quot;,&quot;main&quot;,&quot;T0000&quot;\]"/u);
  assert.match(output.html, /data-to-node-key="\[&quot;project-1&quot;,&quot;main&quot;,&quot;T0001&quot;\]"/u);
  assert.match(output.html, /class="summary-lane" data-lane-key="\[&quot;main&quot;,&quot;lane-0&quot;\]" role="button" tabindex="0" aria-pressed="false"/u);
  assert.match(output.html, /data-node-key="[^"]+" data-lane-key="\[&quot;main&quot;,&quot;lane-0&quot;\]"/u);
  assert.match(output.html, /\.lane-dimmed\{opacity:\.35\}/u);
  assert.doesNotMatch(output.html, /\.summary-lane:focus\{/u);
  assert.doesNotMatch(output.html, /\.summary-lane:focus-visible\{/u);
  assert.doesNotMatch(output.html, /\.summary-lane\[aria-pressed="true"\] \.summary-chip/u);
  assert.match(output.html, /const toggleLane=\(key\)=>applyLane\(activeLaneKey===key\?null:key\)/u);
  assert.match(output.html, /edge\.dataset\.fromLaneKey!==key&&edge\.dataset\.toLaneKey!==key/u);
  assert.doesNotMatch(output.html, /<p class="notice">/u);
  assert.match(output.html, /<title>Lattice — project-1 依存工程図<\/title>/u);
  assert.match(output.html, /class="project-heading">project-1 依存工程図<\/strong>/u);
  assert.match(output.html, /縦方向は時間ではなく、登録済み依存関係による工程段階/u);
  assert.match(output.html, /class="diagram-legend"[^>]*aria-label="工程図の凡例"/u);
  assert.match(output.html, /class="status-symbol status-in-progress"[^>]*>▶<\/span> 作業中/u);
  assert.match(output.html, /☐ 未着手/u);
  assert.match(output.html, /破線枠: ready frontier（同時dispatch推奨）/u);
  assert.match(output.html, /ready frontierは全件同時dispatchが既定/u);
  assert.match(output.html, /太線: 構造上の最長依存鎖/u);
  assert.match(output.html, /半円: 非接触の線交差/u);
  assert.match(output.html, /黒丸: 論理上の合流/u);
  assert.match(output.html, /body\{display:grid;grid-template-rows:minmax\(0,1fr\)/u);
  assert.doesNotMatch(output.html, /data-show-all|data-view-state="all"|data-view-state="selected"/u);
  assert.doesNotMatch(output.html, /class="task-facts"|class="evidence"/u);
  assert.equal(output.html.includes('innerHTML'), false);
  assert.doesNotMatch(output.html, /\son[a-z]+\s*=/iu);
});

test('project display name is preserved exactly in the visible heading and browser title', () => {
  const read = readFixture(1);
  const html = renderFixture(read, [], [], null, { project_display_name: 'AIShell' }).html;
  assert.match(html, /<title>Lattice — AIShell 依存工程図<\/title>/u);
  assert.match(html, /class="project-heading">AIShell 依存工程図<\/strong>/u);
  assert.doesNotMatch(html, /Aishell/u);
});

test('geometric crossings render a semicircle bridge without a logical junction dot', () => {
  const T0 = ref('T0000'); const T1 = ref('T0001'); const T2 = ref('T0002');
  const read = readFixture(3, [{ from: T0, to: T1 }, { from: T0, to: T2 }]);
  read.members[0].plan.tasks[1].lane = 'z-lane';
  read.members[0].plan.tasks[2].lane = 'a-lane';
  const html = renderFixture(read).html;
  assert.match(html, /class="edge-route" d="[^"]* A 5 5 /u);
  assert.doesNotMatch(html, /class="join-marker"/u);
  assert.equal((html.match(/class="edge-arrow"/gu) ?? []).length, 2);
});

test('overlapping logical joins render one distinct black dot per fully-qualified join', () => {
  const T0 = ref('T0000'); const T1 = ref('T0001'); const T2 = ref('T0002'); const T3 = ref('T0003');
  const read = readFixture(4);
  read.members[0].plan.joins = [
    { id: 'j1', after: [T0, T1], before: T3 },
    { id: 'j2', after: [T0, T2], before: T3 },
  ];
  const html = renderFixture(read).html;
  const markers = [...html.matchAll(/<g class="join-marker"[^>]*><circle cx="([^"]+)" cy="([^"]+)"/gu)];
  assert.equal(markers.length, 2);
  assert.equal(new Set(markers.map((match) => `${match[1]},${match[2]}`)).size, 2);
  assert.equal((html.match(/data-from-node-key="\[&quot;project-1&quot;,&quot;main&quot;,&quot;T0000&quot;\]"/gu) ?? []).length, 2);
});

test('全工程一覧はanchor成否に依存せずstoreの現在状態と全文タイトルを登録順で表示する', () => {
  const read = readFixture(3);
  const markdown = '# Plan\n- [ ] pending task\n- [ ] blocked task\n- [ ] drifted task';
  const lineDigest = (line) => createHash('sha256').update(line).digest('hex');
  for (const [index, task] of read.members[0].plan.tasks.entries()) {
    task.narrative_ref = 'plan.md';
    task.narrative_anchor = {
      origin_plan_ref: 'plan.md',
      origin_line: index + 2,
      source_commit: '1'.repeat(40),
      source_line_digest: lineDigest(index === 2 ? '- [ ] stale task' : markdown.split('\n')[index + 1]),
    };
  }
  Object.assign(read.members[0].tasks[1], { status: 'blocked', blocked_reason: null });
  const narratives = read.members[0].plan.tasks.map(({ task_id }) => ({
    ref: ref(task_id), narrative_ref: 'plan.md', markdown,
  }));
  const outcomes = verifyNarrativeAnchors({ readModel: read, narratives });
  const html = renderFixture(read, narratives, outcomes).html;

  assert.equal((html.match(/class="task-index-status status-/gu) ?? []).length, 3);
  assert.match(html, /class="task-index-status status-pending"[^>]*>☐<\/span><span class="task-index-reference">工程 0000<\/span><strong>Task 0<\/strong>/u);
  assert.match(html, /class="task-index-status status-blocked"[^>]*>⛔<\/span><span class="task-index-reference">工程 0001<\/span><strong>Task 1<\/strong><span class="task-index-blocked-reason">— 理由未記録<\/span>/u);
  assert.match(html, /class="task-index-reference">工程 0002<\/span><strong>Task 2<\/strong>/u);
  assert.ok(html.indexOf('<strong>Task 0</strong>') < html.indexOf('<strong>Task 1</strong>'));
  assert.ok(html.indexOf('<strong>Task 1</strong>') < html.indexOf('<strong>Task 2</strong>'));
  assert.doesNotMatch(html, /pending task|blocked task|drifted task|class="anchor-diagnostics"|class="narrative-body"/u);
});

test('SVG renders readable status nodes, every edge, join marker, and hierarchical summary without timestamps', () => {
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
  assert.equal((html.match(/class="join-marker"/gu) ?? []).length, 1);
  assert.match(html, /class="join-marker"[^>]*><circle[^>]*r="4"><\/circle>/u);
  assert.doesNotMatch(html, /class="join-marker"[^>]*><polygon/u);
  assert.match(html, /class="todo-summary" aria-label="カテゴリ別ToDo集計表"/u);
  assert.match(html, /class="summary-plan"[^>]*><rect[^>]*class="summary-chip plan-chip"/u);
  assert.match(html, /class="summary-lane"/u);
  assert.match(html, /class="summary-plan-group"[^>]*><rect class="summary-container"/u);
  assert.doesNotMatch(html, /class="summary-connector"/u);
  assert.match(html, /class="status-bar"/u);
  assert.match(html, /class="task-index-blocked-reason">— Waiting for owner<\/span>/u);
  assert.doesNotMatch(html, /main\/lane-/u);
  assert.doesNotMatch(html, /hidden edges|folded edges|data-fold-state|bundle-badge/u);
  assert.doesNotMatch(html, /class="node-time"|S:07-18|D:07-18|Started at|Done at/u);
  assert.doesNotMatch(html, /class="task-facts"|class="evidence"/u);
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
