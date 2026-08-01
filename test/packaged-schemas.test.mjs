import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 配布物の`files`はschemaを個別列挙する。CLIが`docs/schemas/`から読むschemaを1つでも
// 列挙し忘れると、repo内では通るのにglobal installでは読み込みに失敗する——0.36.0で
// 実際に踏んだ（`todo revise-phase --schema --json`がINTERNAL_FAILUREになった）。
// 参照側の表と配布リストの一致を機械で強制し、publish前に気づけるようにする。
test('CLIが読むschemaはすべて配布物のfilesへ列挙されている', async () => {
  const [pkg, todoCli, projectCli, runtimeCli] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/todo-cli.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/project-cli.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/runtime-cli.mjs', import.meta.url), 'utf8'),
  ]);
  const listed = new Set(pkg.files.filter((entry) => entry.startsWith('docs/schemas/')));

  const referenced = new Set();
  // todo-cliはfile名を表で持つ（TODO_SCHEMA_COMMANDS）。
  for (const [, file] of todoCli.matchAll(/file: '([^']+\.schema\.json)'/gu)) {
    referenced.add(`docs/schemas/${file}`);
  }
  // 版番号をURLへ埋める入口は、受理する全版を明示的に数え上げる。
  for (const version of [1, 2, 3]) {
    referenced.add(`docs/schemas/lattice.plan_create_input.v${version}.schema.json`);
  }
  for (const source of [projectCli, runtimeCli]) {
    for (const [, ref] of source.matchAll(/docs\/schemas\/([a-z0-9._]+\.schema\.json)/gu)) {
      referenced.add(`docs/schemas/${ref}`);
    }
  }
  assert.ok(referenced.size >= 8, `参照schemaの抽出が少なすぎる: ${referenced.size}`);

  const missing = [...referenced].filter((ref) => !listed.has(ref)).sort();
  assert.deepEqual(missing, [], `配布物のfilesへ未列挙のschema: ${missing.join(', ')}`);
});

test('revision公開schemaはruntimeが受理するacquire_phaseを列挙する', async () => {
  for (const file of [
    'lattice.todo_revision.v2.schema.json',
    'lattice.todo_revision_set.v3.schema.json',
    'lattice.phase_todo_revision.v3.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(new URL(`../docs/schemas/${file}`, import.meta.url), 'utf8'));
    assert.ok(
      schema.$defs.taskMigrationEntry.properties.state_policy.enum.includes('acquire_phase'),
      `${file} がruntime受理値acquire_phaseを公開していない`,
    );
  }
});
