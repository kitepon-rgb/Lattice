import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  canonicalizeTodoArtifact, isStrictTodoTimestamp, todoSelfDigest,
} from '../src/todo-contracts.mjs';
import {
  TodoStoreError, appendImportedPlan, appendTodoEvent, buildTodoPlan, createTodoStoreWriter,
  createSuccessorTodoPlan, initializeTodoStore, readTodoStore, rebuildTodoSnapshot,
} from '../src/todo-store.mjs';
import { projectTodoChainV1 } from '../src/todo-chain.mjs';
import { layoutTodoGantt } from '../src/todo-gantt-layout.mjs';

const NOW = '2026-07-18T00:00:00.000Z';
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const planRef = '.lattice/todo/plans/main/v1/plan.json';
const journalRef = '.lattice/todo/plans/main/v1/journal/active.jsonl';
const snapshotRef = '.lattice/todo/plans/main/v1/snapshot.json';
const manifestRef = '.lattice/todo/manifest.json';

const task = (taskId) => ({ task_id: taskId, title: taskId, lane: 'main', narrative_ref: null, compile_binding: null });
const ref = (taskId, planKey = 'main', projectId = 'project-1', expected) => ({
  project_id: projectId, plan_key: planKey, task_id: taskId,
  ...(expected === undefined ? {} : { expected_topology_digest: expected }),
});

async function workspace(context, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const plan = overrides.plan ?? {
    schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main', plan_version: 'v1',
    predecessor_plan_digest: null, tasks: [task('T1'), task('T2')],
    hard_dependencies: [{ from: ref('T1'), to: ref('T2') }], joins: [],
  };
  await initializeTodoStore({
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: overrides.projectId ?? 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: overrides.plans ?? [{ plan, genesis: { actor: ACTOR, recorded_at: NOW } }], now: NOW,
  });
  return root;
}

async function bytes(root, refValue) { return readFile(path.join(root, refValue)); }
async function expectCode(promise, code, reason) {
  await assert.rejects(promise, (error) => error instanceof TodoStoreError
    && error.code === code && (reason === undefined || error.detail.reason === reason));
}

function pinnedMarkdownCommit(root) {
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root, input: '# Imported plan\n- [x] A1\n- [x] A2\n', encoding: 'utf8',
  }).trim();
  const tree = execFileSync('git', ['mktree'], {
    cwd: root, input: `100644 blob ${blob}\tplan.md\n`, encoding: 'utf8',
  }).trim();
  return execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: root,
    input: `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1760000000 +0000\ncommitter Fixture <fixture@example.invalid> 1760000000 +0000\n\nfixture\n`,
    encoding: 'utf8',
  }).trim();
}

function importedPlanRequest(root, overrides = {}) {
  const sourceCommit = overrides.sourceCommit ?? pinnedMarkdownCommit(root);
  const source = (origin_line) => ({ schema: 'lattice.todo_import_source.v1', origin_plan_ref: 'plan.md',
    origin_line, source_commit: sourceCommit });
  return {
    repoRoot: root, writer: createTodoStoreWriter({ caller: 'g4-migration' }), now: NOW,
    plan: { schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'archive', plan_version: 'v1',
      predecessor_plan_digest: null, tasks: [task('A1'), task('A2')],
      hard_dependencies: [{ from: ref('A1', 'archive'), to: ref('A2', 'archive') }], joins: [] },
    genesis: { actor: ACTOR, recorded_at: NOW },
    completedTasks: [
      { task_id: 'A2', completed_at: 'unknown_requires_evidence', evidence: source(3) },
      { task_id: 'A1', completed_at: NOW, evidence: source(2) },
    ],
    ...overrides,
  };
}

function todoTopology(store) {
  return {
    nodes: store.members.flatMap(({ plan }) => plan.tasks.map(({ task_id }) => ref(task_id, plan.plan_key))),
    hard_edges: store.members.flatMap(({ plan }) => plan.hard_dependencies),
    joins: store.members.flatMap(({ plan }) => plan.joins),
  };
}

test('todo timestampはmillisecond UTCのparse→toISOString byte一致だけを受理する', () => {
  assert.equal(isStrictTodoTimestamp(NOW), true);
  for (const value of [
    '2026-02-30T00:00:00.000Z', '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00.00Z', '2026-07-18T09:00:00.000+09:00',
  ]) assert.equal(isStrictTodoTimestamp(value), false, value);
});

test('canonical journalを唯一正本としてplanとsnapshotを束縛して読む', async (context) => {
  const root = await workspace(context);
  const result = await readTodoStore({ repoRoot: root, now: NOW });
  assert.equal(result.schema, 'lattice.todo_store_read.v1');
  assert.equal(result.snapshot_stale, false);
  assert.deepEqual(result.members[0].tasks.map(({ task_id, status }) => [task_id, status]), [['T1', 'pending'], ['T2', 'pending']]);
});

test('writer capabilityはG4 migrationとG5 authoringだけに限定する', () => {
  assert.throws(() => createTodoStoreWriter({ caller: 'todo-cli' }), TypeError);
  assert.equal(createTodoStoreWriter({ caller: 'g4-migration' }).caller, 'g4-migration');
  assert.equal(createTodoStoreWriter({ caller: 'g5-authoring' }).caller, 'g5-authoring');
});

test('closed transitionと依存gateをappend前に検証し、失敗時bytesを変えない', async (context) => {
  const root = await workspace(context);
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  const before = await bytes(root, journalRef);
  await expectCode(appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T2', actor: ACTOR, recorded_at: NOW, payload: { override_reason: null } } }),
  'STORE_INCONSISTENT', 'invalid_start_transition');
  assert.deepEqual(await bytes(root, journalRef), before);
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { override_reason: null } } });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'block', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { reason: 'waiting' } } });
  const result = await readTodoStore({ repoRoot: root, now: NOW });
  assert.equal(result.members[0].tasks[0].status, 'blocked');
  assert.equal(result.members[0].tasks[0].blocked_reason, 'waiting');
});

const journalCorruptions = [
  ['duplicate_key', 'journal_non_canonical_or_duplicate_key', (line) => Buffer.from(`{"schema":"lattice.todo_event.v1",${line.slice(1)}`)],
  ['invalid_utf8', 'journal_invalid_utf8', () => Buffer.from([0xff, 0x0a])],
  ['bom', 'journal_byte_contract', (line) => Buffer.from(`\uFEFF${line}`)],
  ['crlf', 'journal_byte_contract', (line) => Buffer.from(line.replace(/\n$/u, '\r\n'))],
  ['truncated_write', 'journal_byte_contract', (line) => Buffer.from(line.slice(0, -2))],
  ['merge_marker', 'journal_json_invalid', () => Buffer.from('<<<<<<< HEAD\n')],
  ['schema_version_mixed', 'journal_schema_invalid', (line) => Buffer.from(line.replace('lattice.todo_event.v1', 'lattice.todo_event.v2'))],
  ['size_limit', 'journal_segment_limit_exceeded', () => Buffer.alloc(1_048_577, 0x20)],
];

for (const [name, reason, corrupt] of journalCorruptions) {
  test(`journal byte fixture ${name} はSTORE_CORRUPTで全拒否する`, async (context) => {
    const root = await workspace(context);
    const original = (await bytes(root, journalRef)).toString('utf8');
    await writeFile(path.join(root, journalRef), corrupt(original));
    await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_CORRUPT', reason);
  });
}

test('genesis欠落はvalid event bytesでもSTORE_CORRUPT', async (context) => {
  const root = await workspace(context);
  const original = JSON.parse((await bytes(root, journalRef)).toString('utf8'));
  original.kind = 'start'; original.task_id = 'T1'; original.payload = { override_reason: null };
  original.event_digest = todoSelfDigest(original, 'event_digest');
  await writeFile(path.join(root, journalRef), `${canonicalizeTodoArtifact(original)}\n`);
  await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_CORRUPT', 'genesis_missing_or_repeated');
});

test('clock reversalはtyped anomalyとしてSTORE_INCONSISTENT', async (context) => {
  const root = await workspace(context); const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { override_reason: null } } });
  const events = (await bytes(root, journalRef)).toString('utf8').trimEnd().split('\n').map(JSON.parse);
  events[1].recorded_at = '2026-07-17T23:59:59.999Z'; events[1].event_digest = todoSelfDigest(events[1], 'event_digest');
  await writeFile(path.join(root, journalRef), `${events.map(canonicalizeTodoArtifact).join('\n')}\n`);
  const manifest = JSON.parse((await bytes(root, manifestRef)).toString('utf8'));
  manifest.members[0].journal_head_digest = events[1].event_digest;
  manifest.manifest_digest = todoSelfDigest(manifest, 'manifest_digest');
  await writeFile(path.join(root, manifestRef), `${canonicalizeTodoArtifact(manifest)}\n`);
  await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_INCONSISTENT', 'clock_reversal');
});

test('journal symlink escapeはSTORE_CORRUPTでhard rejectする', async (context) => {
  const root = await workspace(context);
  const outside = path.join(root, 'outside.jsonl');
  await writeFile(outside, await bytes(root, journalRef));
  await unlink(path.join(root, journalRef)); await symlink(outside, path.join(root, journalRef));
  await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_CORRUPT', 'unsafe_artifact_path');
});

for (const [name, mutate] of [
  ['missing', async (root) => unlink(path.join(root, snapshotRef))],
  ['digest_mismatch', async (root) => {
    const value = JSON.parse((await bytes(root, snapshotRef)).toString('utf8'));
    value.snapshot_digest = 'f'.repeat(64); await writeFile(path.join(root, snapshotRef), `${canonicalizeTodoArtifact(value)}\n`);
  }],
  ['invalid_utf8', async (root) => writeFile(path.join(root, snapshotRef), Buffer.from([0xff, 0x0a]))],
  ['duplicate_key', async (root) => {
    const line = (await bytes(root, snapshotRef)).toString('utf8');
    await writeFile(path.join(root, snapshotRef), `{"schema":"lattice.todo_snapshot.v1",${line.slice(1)}`);
  }],
  ['old_head', async (root) => {
    const value = JSON.parse((await bytes(root, snapshotRef)).toString('utf8'));
    value.journal_head_digest = 'e'.repeat(64); value.snapshot_digest = todoSelfDigest(value, 'snapshot_digest');
    await writeFile(path.join(root, snapshotRef), `${canonicalizeTodoArtifact(value)}\n`);
  }],
  ['projection_body_mismatch', async (root) => {
    const value = JSON.parse((await bytes(root, snapshotRef)).toString('utf8'));
    value.tasks[0].status = 'done'; value.tasks[0].done_at = NOW;
    value.snapshot_digest = todoSelfDigest(value, 'snapshot_digest');
    await writeFile(path.join(root, snapshotRef), `${canonicalizeTodoArtifact(value)}\n`);
  }],
  ['bom', async (root) => writeFile(path.join(root, snapshotRef), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await bytes(root, snapshotRef)]))],
  ['crlf', async (root) => writeFile(path.join(root, snapshotRef), (await bytes(root, snapshotRef)).toString('utf8').replace(/\n$/u, '\r\n'))],
  ['truncated', async (root) => {
    const value = await bytes(root, snapshotRef); await writeFile(path.join(root, snapshotRef), value.subarray(0, value.length - 2));
  }],
  ['merge_marker', async (root) => writeFile(path.join(root, snapshotRef), '<<<<<<< HEAD\n')],
  ['schema_mixed', async (root) => writeFile(path.join(root, snapshotRef), (await bytes(root, snapshotRef)).toString('utf8').replace('lattice.todo_snapshot.v1', 'lattice.todo_snapshot.v2'))],
  ['trailing_bytes', async (root) => writeFile(path.join(root, snapshotRef), Buffer.concat([await bytes(root, snapshotRef), Buffer.from('x')]))],
  ['size_limit', async (root) => writeFile(path.join(root, snapshotRef), Buffer.alloc(8_388_609, 0x20))],
]) {
  test(`snapshot単独 ${name} はreader継続＋snapshot_stale、writer拒否`, async (context) => {
    const root = await workspace(context); await mutate(root);
    const result = await readTodoStore({ repoRoot: root, now: NOW });
    assert.equal(result.snapshot_stale, true);
    await expectCode(readTodoStore({ repoRoot: root, now: NOW, forWrite: true }), 'STORE_WRITE_REFUSED', 'snapshot_stale');
    const rebuilt = await rebuildTodoSnapshot({ repoRoot: root, planKey: 'main', now: NOW });
    assert.equal(rebuilt.schema, 'lattice.todo_snapshot.v1');
    assert.equal((await readTodoStore({ repoRoot: root, now: NOW })).snapshot_stale, false);
  });
}

test('snapshot symlinkはsnapshot_staleへ丸めずhard rejectする', async (context) => {
  const root = await workspace(context); const outside = path.join(root, 'snapshot-copy.json');
  await writeFile(outside, await bytes(root, snapshotRef)); await unlink(path.join(root, snapshotRef));
  await symlink(outside, path.join(root, snapshotRef));
  await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_INCONSISTENT', 'unsafe_artifact_path');
});

for (const [name, refValue] of [['manifest', manifestRef], ['plan', planRef]]) {
  test(`${name} canonical/schema破損はSTORE_INCONSISTENT`, async (context) => {
    const root = await workspace(context); const line = (await bytes(root, refValue)).toString('utf8');
    await writeFile(path.join(root, refValue), `{"schema":"duplicate",${line.slice(1)}`);
    await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_INCONSISTENT');
  });
}

test('cross-plan expected_topology_digest違反はdetail.reason=binding_stale', async (context) => {
  const planB = buildTodoPlan({ schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'b', plan_version: 'v1',
    predecessor_plan_digest: null, tasks: [task('B1')], hard_dependencies: [], joins: [] });
  const planA = { schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'a', plan_version: 'v1',
    predecessor_plan_digest: null, tasks: [task('A1')], hard_dependencies: [{
      from: ref('B1', 'b', 'project-1', 'f'.repeat(64)), to: ref('A1', 'a'),
    }], joins: [] };
  const plans = [planA, planB].map((plan) => ({ plan, genesis: { actor: ACTOR, recorded_at: NOW } }));
  await assert.rejects(workspace(context, { plans }), (error) => error instanceof TodoStoreError
    && error.code === 'STORE_INCONSISTENT' && error.detail.reason === 'binding_stale');
});

test('snapshot rebuildはcurrentでも同一canonical bytesを返す', async (context) => {
  const root = await workspace(context); const before = await bytes(root, snapshotRef);
  await rebuildTodoSnapshot({ repoRoot: root, planKey: 'main', now: NOW });
  assert.deepEqual(await bytes(root, snapshotRef), before);
});

test('crash matrix: journal commit後にmanifestが旧headなら不整合、snapshotだけ旧版ならstale', async (context) => {
  const root = await workspace(context); const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  const oldManifest = await bytes(root, manifestRef); const oldSnapshot = await bytes(root, snapshotRef);
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { override_reason: null } } });
  const newManifest = await bytes(root, manifestRef);
  await writeFile(path.join(root, manifestRef), oldManifest);
  await expectCode(readTodoStore({ repoRoot: root, now: NOW }), 'STORE_INCONSISTENT', 'manifest_journal_head_mismatch');
  await writeFile(path.join(root, manifestRef), newManifest); await writeFile(path.join(root, snapshotRef), oldSnapshot);
  assert.equal((await readTodoStore({ repoRoot: root, now: NOW })).snapshot_stale, true);
});

test('1 MiB到達時にactive segmentをsealし、exact bytes digestと連結を検証する', async (context) => {
  const root = await workspace(context);
  const events = [JSON.parse((await bytes(root, journalRef)).toString('utf8'))];
  const append = (kind, payload) => {
    const previous = events.at(-1);
    const event = { schema: 'lattice.todo_event.v1', project_id: 'project-1', plan_key: 'main', plan_version: 'v1',
      sequence: previous.sequence + 1, previous_digest: previous.event_digest, kind, task_id: 'T1', actor: ACTOR,
      recorded_at: NOW, provenance: null, payload, event_digest: '' };
    event.event_digest = todoSelfDigest(event, 'event_digest'); events.push(event);
  };
  append('start', { override_reason: null });
  const largeBlock = { reason: 'x'.repeat(16_000) };
  for (;;) {
    const probe = { schema: 'lattice.todo_event.v1', project_id: 'project-1', plan_key: 'main', plan_version: 'v1',
      sequence: events.at(-1).sequence + 1, previous_digest: events.at(-1).event_digest, kind: 'block', task_id: 'T1',
      actor: ACTOR, recorded_at: NOW, provenance: null, payload: largeBlock, event_digest: '' };
    probe.event_digest = todoSelfDigest(probe, 'event_digest');
    const currentBytes = Buffer.byteLength(`${events.map(canonicalizeTodoArtifact).join('\n')}\n`);
    if (currentBytes + Buffer.byteLength(`${canonicalizeTodoArtifact(probe)}\n`) > 1_048_576) break;
    append('block', { reason: 'padding' }); append('unblock', {});
  }
  await writeFile(path.join(root, journalRef), `${events.map(canonicalizeTodoArtifact).join('\n')}\n`);
  const manifest = JSON.parse((await bytes(root, manifestRef)).toString('utf8'));
  manifest.members[0].journal_head_digest = events.at(-1).event_digest;
  manifest.manifest_digest = todoSelfDigest(manifest, 'manifest_digest');
  await writeFile(path.join(root, manifestRef), `${canonicalizeTodoArtifact(manifest)}\n`);
  await rebuildTodoSnapshot({ repoRoot: root, planKey: 'main', now: NOW });
  await appendTodoEvent({ repoRoot: root, writer: createTodoStoreWriter({ caller: 'g5-authoring' }), planKey: 'main', now: NOW,
    event: { kind: 'block', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: largeBlock } });
  const sealed = await readdir(path.join(root, path.dirname(journalRef), 'sealed'));
  assert.equal(sealed.length, 1); assert.match(sealed[0], /^\d{12}-\d{12}-[0-9a-f]{64}-[0-9a-f]{64}\.jsonl$/u);
  assert.equal((await readTodoStore({ repoRoot: root, now: NOW })).members[0].tasks[0].status, 'blocked');
});

test('done evidenceはpinned git blobとcontent digestをwrite時にhard検証する', async (context) => {
  const root = await workspace(context);
  const evidenceBytes = Buffer.from('verified evidence\n');
  await writeFile(path.join(root, 'evidence.txt'), evidenceBytes);
  const oid = execFileSync('git', ['hash-object', '-w', 'evidence.txt'], { cwd: root, encoding: 'utf8' }).trim();
  const evidence = { evidence_id: 'ev-1', repo_id: 'self', path: 'evidence.txt', git_blob_oid: oid,
    content_digest: createHash('sha256').update(evidenceBytes).digest('hex'), media_type: 'text/plain', anchor_digest: null };
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { override_reason: null } } });
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'done', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { evidence } } });
  assert.equal((await readTodoStore({ repoRoot: root, now: NOW })).members[0].tasks[0].status, 'done');
});

test('topology変更はactive file上書きでなくsuccessor versionを発行する', async (context) => {
  const root = await workspace(context); const oldPlan = await bytes(root, planRef);
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  const current = (await readTodoStore({ repoRoot: root, now: NOW })).members[0];
  await createSuccessorTodoPlan({ repoRoot: root, writer, planKey: 'main', now: NOW,
    plan: { schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main', plan_version: 'v2',
      predecessor_plan_digest: current.plan.plan_digest, tasks: [task('T1'), task('T3')], hard_dependencies: [], joins: [] },
    genesis: { actor: ACTOR, recorded_at: NOW, task_migration: [
      { from_task_id: 'T1', to_task_id: 'T1' }, { from_task_id: 'T2', to_task_id: 'removed' },
    ] } });
  const result = await readTodoStore({ repoRoot: root, now: NOW });
  assert.equal(result.members[0].plan.plan_version, 'v2');
  assert.deepEqual(await bytes(root, planRef), oldPlan);
});

for (const stage of [
  'manifest_validated', 'plan_key_absent', 'staging_fsynced',
  'manifest_cas_matched', 'pre_activation_renamed', 'manifest_activated',
]) {
  test(`historical import crash recovery: ${stage}`, async (context) => {
    const root = await workspace(context);
    const request = importedPlanRequest(root, {
      onProtocolStage(current) { if (current === stage) throw new Error(`crash:${stage}`); },
    });
    await assert.rejects(appendImportedPlan(request), new RegExp(`crash:${stage}`, 'u'));
    const afterCrash = await readTodoStore({ repoRoot: root, now: NOW });
    if (stage === 'manifest_activated') {
      assert.deepEqual(afterCrash.members.map(({ descriptor }) => descriptor.plan_key), ['archive', 'main']);
      await expectCode(appendImportedPlan(importedPlanRequest(root)), 'STORE_WRITE_CONFLICT', 'plan_key_already_imported');
    } else {
      assert.deepEqual(afterCrash.members.map(({ descriptor }) => descriptor.plan_key), ['main']);
      await appendImportedPlan(importedPlanRequest(root));
      assert.deepEqual((await readTodoStore({ repoRoot: root, now: NOW })).members
        .map(({ descriptor }) => descriptor.plan_key), ['archive', 'main']);
    }
  });
}

test('historical import manifest digest CAS不一致はstagingをmember化せず無変更拒否する', async (context) => {
  const root = await workspace(context);
  const request = importedPlanRequest(root, { onProtocolStage: async (stage) => {
    if (stage !== 'staging_fsynced') return;
    const manifest = JSON.parse((await bytes(root, manifestRef)).toString('utf8'));
    manifest.repositories.push({ repo_id: 'secondary', path: '.' });
    manifest.repositories.sort((left, right) => left.repo_id < right.repo_id ? -1 : 1);
    manifest.manifest_digest = todoSelfDigest(manifest, 'manifest_digest');
    await writeFile(path.join(root, manifestRef), `${canonicalizeTodoArtifact(manifest)}\n`);
  } });
  await expectCode(appendImportedPlan(request), 'STORE_WRITE_CONFLICT', 'manifest_digest_changed');
  assert.deepEqual((await readTodoStore({ repoRoot: root, now: NOW })).members
    .map(({ descriptor }) => descriptor.plan_key), ['main']);
});

test('historical importはimport済みとauthored既存plan_keyを区別して再取込拒否する', async (context) => {
  const root = await workspace(context);
  await appendImportedPlan(importedPlanRequest(root));
  await expectCode(appendImportedPlan(importedPlanRequest(root)), 'STORE_WRITE_CONFLICT', 'plan_key_already_imported');
  const mainPlan = { schema: 'lattice.todo_plan.v1', project_id: 'project-1', plan_key: 'main', plan_version: 'v1',
    predecessor_plan_digest: null, tasks: [task('T1')], hard_dependencies: [], joins: [] };
  await expectCode(appendImportedPlan(importedPlanRequest(root, { plan: mainPlan })),
    'STORE_WRITE_CONFLICT', 'plan_key_already_exists');
});

test('historical doneは通常writerから追加できず、import source不在はverify用annotation/hard拒否へ分離する', async (context) => {
  const root = await workspace(context);
  const sourceCommit = pinnedMarkdownCommit(root);
  await appendImportedPlan(importedPlanRequest(root, { sourceCommit }));
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  const archive = (await readTodoStore({ repoRoot: root, now: NOW })).members
    .find(({ descriptor }) => descriptor.plan_key === 'archive');
  await expectCode(appendTodoEvent({ repoRoot: root, writer, planKey: 'archive', now: NOW,
    event: { kind: 'done', task_id: 'A1', actor: ACTOR, recorded_at: NOW,
      payload: archive.journal.events[1].payload } }),
  'STORE_WRITE_CONFLICT', 'historical_import_writer_required');
  await unlink(path.join(root, '.git', 'objects', sourceCommit.slice(0, 2), sourceCommit.slice(2)));
  const readable = await readTodoStore({ repoRoot: root, now: NOW });
  assert.equal(readable.members.find(({ descriptor }) => descriptor.plan_key === 'archive')
    .tasks.every(({ evidence_unverified }) => evidence_unverified), true);
  await expectCode(readTodoStore({ repoRoot: root, now: NOW, forWrite: true }),
    'STORE_INCONSISTENT', 'import_source_unverified');
});

test('historical doneはlatent start付きdoneとしてchain/ganttへ投影し依存順を捏造しない', async (context) => {
  const root = await workspace(context);
  const result = await appendImportedPlan(importedPlanRequest(root));
  assert.equal(result.genesis.payload.historical_import, true);
  const store = await readTodoStore({ repoRoot: root, now: NOW });
  const archive = store.members.find(({ descriptor }) => descriptor.plan_key === 'archive');
  assert.deepEqual(archive.tasks.map(({ task_id, status, started_at, done_at, imported }) =>
    [task_id, status, started_at, done_at, imported]), [
    ['A1', 'done', null, NOW, true], ['A2', 'done', null, null, true],
  ]);
  const chain = projectTodoChainV1(todoTopology(store));
  const layout = layoutTodoGantt(store, chain);
  assert.deepEqual(layout.nodes.filter(({ ref: taskRef }) => taskRef.plan_key === 'archive')
    .map(({ ref: taskRef, status }) => [taskRef.task_id, status]), [['A1', 'done'], ['A2', 'done']]);
});

test('unknown historical doneは正規evidenceへ新eventで昇格しreopenでin-progressへ戻る', async (context) => {
  const root = await workspace(context);
  const imported = await appendImportedPlan(importedPlanRequest(root));
  const sourceEvent = imported.events.find(({ task_id }) => task_id === 'A2');
  const sourceBytes = Buffer.from('promoted evidence\n');
  await writeFile(path.join(root, 'promoted.txt'), sourceBytes);
  const oid = execFileSync('git', ['hash-object', '-w', 'promoted.txt'], { cwd: root, encoding: 'utf8' }).trim();
  const evidence = { evidence_id: 'promoted', repo_id: 'self', path: 'promoted.txt', git_blob_oid: oid,
    content_digest: createHash('sha256').update(sourceBytes).digest('hex'), media_type: 'text/plain', anchor_digest: null };
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  const promotion = await appendTodoEvent({ repoRoot: root, writer, planKey: 'archive', now: NOW,
    event: { kind: 'done', task_id: 'A2', actor: ACTOR, recorded_at: NOW,
      payload: { done_mode: 'evidence_promotion', imported: true,
        target_done_digest: sourceEvent.event_digest, evidence } } });
  let state = (await readTodoStore({ repoRoot: root, now: NOW })).members
    .find(({ descriptor }) => descriptor.plan_key === 'archive').tasks.find(({ task_id }) => task_id === 'A2');
  assert.equal(state.status, 'done'); assert.deepEqual(state.evidence, evidence); assert.equal(state.done_at, null);
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'archive', now: NOW,
    event: { kind: 'reopen', task_id: 'A2', actor: ACTOR, recorded_at: NOW,
      payload: { reason: 'correct history', target_done_digest: promotion.event.event_digest, override_reason: null } } });
  state = (await readTodoStore({ repoRoot: root, now: NOW })).members
    .find(({ descriptor }) => descriptor.plan_key === 'archive').tasks.find(({ task_id }) => task_id === 'A2');
  assert.equal(state.status, 'in-progress'); assert.equal(state.started_at, null); assert.equal(state.evidence, null);
  assert.equal(state.imported, true);
});

test('authored doneはpending/blockedを許さず従来のhard evidence検証も維持する', async (context) => {
  const root = await workspace(context);
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  const invalidEvidence = { evidence_id: 'missing', repo_id: 'self', path: 'missing.txt', git_blob_oid: 'f'.repeat(40),
    content_digest: 'e'.repeat(64), media_type: 'text/plain', anchor_digest: null };
  const authored = { done_mode: 'authored', imported: false, evidence: invalidEvidence };
  const before = await bytes(root, journalRef);
  await expectCode(appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'done', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: authored } }),
  'STORE_INCONSISTENT', 'invalid_done_transition');
  assert.deepEqual(await bytes(root, journalRef), before);
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { override_reason: null } } });
  await expectCode(appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'done', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: authored } }),
  'STORE_INCONSISTENT', 'evidence_unverified');
  await appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'block', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: { reason: 'blocked' } } });
  await expectCode(appendTodoEvent({ repoRoot: root, writer, planKey: 'main', now: NOW,
    event: { kind: 'done', task_id: 'T1', actor: ACTOR, recorded_at: NOW, payload: authored } }),
  'STORE_INCONSISTENT', 'invalid_done_transition');
});
