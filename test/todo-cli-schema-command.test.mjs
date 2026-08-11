import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runTodoCli } from '../src/todo-cli.mjs';

/**
 * `lattice todo revise` / `revise-set` / `revise-phase` / `migrate`は`--schema --json`で
 * 実際に受理する最新契約のJSON Schemaを返す（`plan create --schema`と同じ規律）。
 *
 * schemaを取る手段が無いと、srcを読んで必須keyを数えるほかなくなる実運用の詰まりを解消する
 * ためのCLI拡張。store・gitを一切読まない決定的出力であることを、`cwd`がgit repoでも
 * `.lattice`初期化済みでもない空tmpdirであることで確認する（store読取や repoRoot解決を
 * 経由していれば、この呼び出しは失敗するはず）。
 */
function stdio() {
  const out = []; const err = [];
  return {
    stdout: { write: (chunk) => { out.push(chunk); } },
    stderr: { write: (chunk) => { err.push(chunk); } },
    out, err,
  };
}

async function bareCwd(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-todo-schema-cmd-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const CASES = [
  { argv: ['revise', '--schema', '--json'], title: 'lattice.todo_revision.v2' },
  { argv: ['revise-set', '--schema', '--json'], title: 'lattice.todo_revision_set.v3' },
  { argv: ['revise-phase', '--schema', '--json'], title: 'lattice.phase_todo_revision.v3' },
  { argv: ['migrate', '--schema', '--json'], title: 'lattice.todo_extraction.v3' },
  { argv: ['structure', '--schema', '--json'], title: 'lattice.todo_structure_set.v1' },
];

for (const { argv, title } of CASES) {
  test(`todo ${argv[0]} --schema --jsonはgitもstoreも読まず${title}を返す`, async (context) => {
    const cwd = await bareCwd(context);
    const { stdout, stderr, out, err } = stdio();
    const exitCode = await runTodoCli({ argv, cwd, stdout, stderr });
    assert.equal(exitCode, 0, err.join(''));
    assert.equal(err.length, 0);
    assert.equal(out.length, 1);
    const schema = JSON.parse(out[0]);
    assert.equal(schema.title, title);
    assert.equal(schema.type, 'object');
    assert.equal(Array.isArray(schema.required), true);
    assert.equal(schema.required.includes('schema'), true);
  });
}

test('todo migrate --schema --jsonはdesign_memoとNO_PLAN案内を持つv3 schemaを返す', async (context) => {
  const cwd = await bareCwd(context);
  const { stdout, stderr, out } = stdio();
  await runTodoCli({ argv: ['migrate', '--schema', '--json'], cwd, stdout, stderr });
  const schema = JSON.parse(out[0]);
  assert.deepEqual(schema.required, [
    'schema', 'project_id', 'plan_key', 'plan_version', 'actor', 'recorded_at',
    'tasks', 'hard_dependencies', 'joins', 'extraction_digest',
  ]);
  assert.equal(schema.$defs.task.required.includes('design_memo'), true);
  assert.match(schema.$comment, /`NO_PLAN`/u);
});

test('todo revise-phase --schema --jsonが返すschemaはphase_todo_revision.v3の必須12keyを持つ', async (context) => {
  const cwd = await bareCwd(context);
  const { stdout, stderr, out } = stdio();
  await runTodoCli({ argv: ['revise-phase', '--schema', '--json'], cwd, stdout, stderr });
  const schema = JSON.parse(out[0]);
  assert.equal(schema.required.length, 12);
  assert.deepEqual([...schema.required].sort(), [
    'desired_plan', 'phase_migration', 'plan_key', 'predecessor', 'project_id', 'reconciliation',
    'revision_digest', 'runtime_task_migration', 'schema', 'source_cutover_batch', 'source_inventory',
    'task_migration',
  ]);
});

test('todo revise --schema --jsonはunknown subcommandではなくtitle付きschemaを返す', async (context) => {
  const cwd = await bareCwd(context);
  const { stdout, stderr, out, err } = stdio();
  const exitCode = await runTodoCli({
    argv: ['revise', '--schema', '--json'], cwd, stdout, stderr,
  });
  assert.equal(exitCode, 0);
  assert.equal(err.length, 0);
  assert.equal(JSON.parse(out[0]).title, 'lattice.todo_revision.v2');
});
