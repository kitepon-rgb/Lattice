import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureWorktreeDiff,
  detectCheckpointFindings,
  isGeneratedOutputPath,
} from '../src/runtime-diff-observer.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('generated output の path 判定は directory segment だけを見る', () => {
  assert.equal(isGeneratedOutputPath('src/OpenLogicool.Contracts/obj/project.assets.json'), true);
  assert.equal(isGeneratedOutputPath('bin/lattice.mjs'), true);
  assert.equal(isGeneratedOutputPath('src/hidden.cs'), false);
  assert.equal(isGeneratedOutputPath('docs/readme.md'), false);
});

test('ignored な obj/ は undeclared_write にせず、ignored なソースは残す', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-diff-obs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'src', 'Lib', 'obj'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), 'obj/\nhidden.cs\n');
  await writeFile(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);

  await writeFile(path.join(root, 'src', 'a.mjs'), 'export const a = 2;\n');
  await writeFile(path.join(root, 'src', 'Lib', 'obj', 'project.assets.json'), '{}\n');
  await writeFile(path.join(root, 'hidden.cs'), 'class Hidden {}\n');

  const checkpoint = await captureWorktreeDiff({ worktreePath: root, baseSha });
  const paths = checkpoint.diff.entries.map((entry) => entry.path).sort();
  assert.deepEqual(paths, ['hidden.cs', 'src/a.mjs']);

  const findings = detectCheckpointFindings({
    todoId: 'T1',
    checkpoint,
    packets: { T1: { scope: { writes: ['src/a.mjs'] } } },
    manifests: { T1: { writes: ['src/a.mjs'], lines: [] } },
    runningTodoIds: ['T1'],
  }).findings;
  assert.deepEqual(findings, [
    { kind: 'undeclared_write', todo_ids: ['T1'], path: 'hidden.cs' },
  ]);
});
