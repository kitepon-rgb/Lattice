#!/usr/bin/env node
/**
 * 配布物のsyntax gate。
 *
 * 以前は`package.json`へfile名を手で並べていたので、新しいfileを足すたびに載せ忘れ、
 * gateが静かに縮んでいた（実測でsrc配下108本のうち53本が未収載）。列挙をやめて、
 * 走査対象のdirectoryを宣言する形にする。fileを足したらgateが自動で広がる。
 */

import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 走査するdirectory。再帰しないのは、ここが配布物の本体だけを見る面だからである。
const SCANNED_DIRECTORIES = ['bin', 'src', 'scripts'];

// directory走査に載らないが検査したいfile。testのfixture等。
const EXTRA_FILES = [
  'research/fixtures/dispatch-record/src/dispatch-record.mjs',
  'test/research-dispatch-record.test.mjs',
];

async function collect() {
  const files = [];
  for (const directory of SCANNED_DIRECTORIES) {
    const entries = await readdir(path.join(ROOT, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.mjs')) continue;
      files.push(`${directory}/${entry.name}`);
    }
  }
  return [...files.sort(), ...EXTRA_FILES];
}

const files = await collect();
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) failures.push({ file, stderr: result.stderr.trim() });
}

if (failures.length > 0) {
  for (const { file, stderr } of failures) process.stderr.write(`${file}\n${stderr}\n\n`);
  process.stderr.write(`syntax check failed: ${failures.length}/${files.length}\n`);
  process.exit(1);
}
process.stdout.write(`syntax check passed: ${files.length} files\n`);
