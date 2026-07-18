import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp, readFile, readdir, rm, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  canonicalizeTodoArtifact,
  todoSelfDigest,
} from '../src/todo-contracts.mjs';
import {
  appendTodoEvent,
  createTodoStoreWriter,
  initializeTodoStore,
} from '../src/todo-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const ACTOR = Object.freeze({ host: 'host-1', session: 'session-1', agent: 'agent-1' });
const NOW = '2026-07-18T00:00:00.000Z';
const manifestRef = '.lattice/todo/manifest.json';
const journalRef = '.lattice/todo/plans/main/v1/journal/active.jsonl';
const snapshotRef = '.lattice/todo/plans/main/v1/snapshot.json';

const task = (taskId) => ({
  task_id: taskId,
  title: taskId,
  lane: 'main',
  narrative_ref: null,
  compile_binding: null,
});

async function workspace(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0);
  await initializeTodoStore({
    repoRoot: root,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1',
    repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v1',
        project_id: 'project-1',
        plan_key: 'main',
        plan_version: 'v1',
        predecessor_plan_digest: null,
        tasks: [task('T1'), task('T2')],
        hard_dependencies: [{
          from: { project_id: 'project-1', plan_key: 'main', task_id: 'T1' },
          to: { project_id: 'project-1', plan_key: 'main', task_id: 'T2' },
        }],
        joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }],
    now: NOW,
  });
  return root;
}

function runCli(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.error, undefined);
  return result;
}

function successJson(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\{.*\}\n$/u);
  return JSON.parse(result.stdout);
}

async function fileBytes(root, ref) {
  return readFile(path.join(root, ref));
}

async function storeDigest(root) {
  const storeRoot = path.join(root, '.lattice', 'todo');
  const entries = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const ref = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), ref);
      else entries.push([ref, await readFile(path.join(directory, entry.name))]);
    }
  }
  await visit(storeRoot);
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const hash = createHash('sha256');
  for (const [ref, bytes] of entries) hash.update(ref).update('\0').update(bytes).update('\0');
  return hash.digest('hex');
}

async function writeCanonical(root, ref, value) {
  await writeFile(path.join(root, ref), `${canonicalizeTodoArtifact(value)}\n`);
}

function assertExactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

test('todo verifyは全member/plan指定のexact result wireを一行で返す', async (context) => {
  const root = await workspace(context);
  for (const args of [['todo', 'verify'], ['todo', 'verify', '--plan', 'main']]) {
    const output = successJson(runCli(root, args));
    assertExactKeys(output, [
      'schema', 'project_id', 'requested_plan_key', 'verified_members', 'snapshot_stale', 'result_digest',
    ]);
    assert.equal(output.schema, 'lattice.todo_verify_result.v1');
    assert.equal(output.project_id, 'project-1');
    assert.equal(output.requested_plan_key, args.length === 2 ? null : 'main');
    assert.equal(output.snapshot_stale, false);
    assert.equal(output.result_digest, todoSelfDigest(output, 'result_digest'));
    assert.equal(output.verified_members.length, 1);
    assertExactKeys(output.verified_members[0], [
      'plan_key', 'topology_digest', 'journal_head_digest', 'through_sequence', 'snapshot_stale',
    ]);
  }
});

const snapshotCases = [
  ['missing', async (root) => unlink(path.join(root, snapshotRef))],
  ['stale_projection', async (root) => {
    const value = JSON.parse(await fileBytes(root, snapshotRef));
    value.plan_version = 'old';
    value.snapshot_digest = todoSelfDigest(value, 'snapshot_digest');
    await writeCanonical(root, snapshotRef, value);
  }],
  ['digest_mismatch', async (root) => {
    const value = JSON.parse(await fileBytes(root, snapshotRef));
    value.snapshot_digest = 'f'.repeat(64);
    await writeCanonical(root, snapshotRef, value);
  }],
  ['body_mismatch', async (root) => {
    const value = JSON.parse(await fileBytes(root, snapshotRef));
    value.tasks[0].status = 'in-progress';
    value.tasks[0].started_at = NOW;
    value.snapshot_digest = todoSelfDigest(value, 'snapshot_digest');
    await writeCanonical(root, snapshotRef, value);
  }],
  ['byte_corrupt', async (root) => {
    await writeFile(path.join(root, snapshotRef), Buffer.from([0xff, 0x0a]));
  }],
  ['previous_head', async (root) => {
    const oldSnapshot = await fileBytes(root, snapshotRef);
    await appendTodoEvent({
      repoRoot: root,
      writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
      planKey: 'main',
      now: NOW,
      event: {
        kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW,
        payload: { override_reason: null },
      },
    });
    await writeFile(path.join(root, snapshotRef), oldSnapshot);
  }],
];

for (const [name, mutate] of snapshotCases) {
  test(`crash matrix: journal健全×snapshot ${name} はverify read-only＋明示rebuild`, async (context) => {
    const root = await workspace(context);
    await mutate(root);
    const beforeVerify = await storeDigest(root);
    const verify = successJson(runCli(root, ['todo', 'verify']));
    assert.equal(verify.snapshot_stale, true);
    assert.equal(verify.verified_members[0].snapshot_stale, true);
    assert.equal(await storeDigest(root), beforeVerify, 'verify must not regenerate or modify snapshot');

    const journalBefore = await fileBytes(root, journalRef);
    const manifestBefore = await fileBytes(root, manifestRef);
    const rebuilt = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
    assertExactKeys(rebuilt, [
      'schema', 'project_id', 'plan_key', 'snapshot_ref', 'through_sequence',
      'journal_head_digest', 'snapshot_digest', 'result_digest',
    ]);
    assert.equal(rebuilt.schema, 'lattice.todo_snapshot_result.v1');
    assert.equal(rebuilt.snapshot_ref, snapshotRef);
    assert.equal(rebuilt.result_digest, todoSelfDigest(rebuilt, 'result_digest'));
    assert.deepEqual(await fileBytes(root, journalRef), journalBefore);
    assert.deepEqual(await fileBytes(root, manifestRef), manifestBefore);
    assert.equal(successJson(runCli(root, ['todo', 'verify'])).snapshot_stale, false);

    const rebuiltBytes = await fileBytes(root, snapshotRef);
    const second = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
    assert.deepEqual(await fileBytes(root, snapshotRef), rebuiltBytes);
    assert.deepEqual(second, rebuilt);
  });
}

test('crash matrix: current snapshotのrebuildもbytes/resultが決定的', async (context) => {
  const root = await workspace(context);
  const before = await fileBytes(root, snapshotRef);
  const first = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
  assert.deepEqual(await fileBytes(root, snapshotRef), before);
  const second = successJson(runCli(root, ['todo', 'snapshot', '--rebuild', '--plan', 'main']));
  assert.deepEqual(second, first);
  assert.deepEqual(await fileBytes(root, snapshotRef), before);
});

test('journal破損はSTORE_CORRUPT exit 1で全store bytes不変', async (context) => {
  const root = await workspace(context);
  await writeFile(path.join(root, journalRef), Buffer.from([0xff, 0x0a]));
  const before = await storeDigest(root);
  for (const args of [
    ['todo', 'verify'],
    ['todo', 'snapshot', '--rebuild', '--plan', 'main'],
  ]) {
    const result = runCli(root, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^\{.*\}\n$/u);
    const error = JSON.parse(result.stderr);
    assert.equal(error.schema, 'lattice.cli_error.v2');
    assert.equal(error.code, 'STORE_CORRUPT');
    assert.equal(error.detail.reason, 'journal_invalid_utf8');
    assert.equal(await storeDigest(root), before);
  }
});

test('todo namespaceの未知subcommand・不足・余剰・重複・順序違反はusage exit 2', async (context) => {
  const root = await workspace(context);
  const malformed = [
    ['todo'],
    ['todo', 'unknown'],
    ['todo', 'verify', '--plan'],
    ['todo', 'verify', '--plan', 'main', 'extra'],
    ['todo', 'verify', '--plan', 'main', '--plan', 'main'],
    ['todo', 'snapshot', '--plan', 'main', '--rebuild'],
    ['todo', 'snapshot', '--rebuild', '--plan', 'main', 'extra'],
  ];
  for (const args of malformed) {
    const before = await storeDigest(root);
    const result = runCli(root, args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.split('\n').length, 2);
    assert.doesNotMatch(result.stderr, /^\{/u);
    assert.equal(await storeDigest(root), before);
  }
});

test('存在しないplanはtyped exit 1でstore bytes不変', async (context) => {
  const root = await workspace(context);
  for (const args of [
    ['todo', 'verify', '--plan', 'absent'],
    ['todo', 'snapshot', '--rebuild', '--plan', 'absent'],
  ]) {
    const before = await storeDigest(root);
    const result = runCli(root, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).code, 'STORE_INCONSISTENT');
    assert.equal(await storeDigest(root), before);
  }
});

test('todo verifyはdone evidenceをhard検証し、解決不能ならtyped exit 1', async (context) => {
  const root = await workspace(context);
  const blob = Buffer.from('completion evidence\n');
  const object = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    input: blob,
    encoding: 'utf8',
  });
  assert.equal(object.status, 0);
  const oid = object.stdout.trim();
  const writer = createTodoStoreWriter({ caller: 'g5-authoring' });
  await appendTodoEvent({
    repoRoot: root, writer, planKey: 'main', now: NOW,
    event: {
      kind: 'start', task_id: 'T1', actor: ACTOR, recorded_at: NOW,
      payload: { override_reason: null },
    },
  });
  await appendTodoEvent({
    repoRoot: root, writer, planKey: 'main', now: NOW,
    event: {
      kind: 'done', task_id: 'T1', actor: ACTOR, recorded_at: NOW,
      payload: { evidence: {
        evidence_id: 'evidence-1', repo_id: 'self', path: 'evidence.txt', git_blob_oid: oid,
        content_digest: createHash('sha256').update(blob).digest('hex'),
        media_type: 'text/plain', anchor_digest: null,
      } },
    },
  });
  await unlink(path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
  const before = await storeDigest(root);
  const result = runCli(root, ['todo', 'verify']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, 'STORE_INCONSISTENT');
  assert.equal(error.detail.reason, 'evidence_unverified');
  assert.equal(error.detail.plan_key, 'main');
  assert.equal(error.detail.task_id, 'T1');
  assert.equal(await storeDigest(root), before);
});
