#!/usr/bin/env node
/**
 * ADRの未決に発火条件を必須にするgate。
 *
 * 「実データが溜まってから決める」は正しい判断であることが多い。だが**いつ誰が何を見たら
 * 決めるのか**が書かれていない未決は、判断の保留ではなく放置である。実際、25件の未決を
 * 読み直したら、後のADRで既に裁定したのに元へ戻って印を付けていないものが5件あり、
 * 「未決が残っている」という見た目だけが残っていた。
 *
 * よって各未決へ次のどれかを要求する:
 *
 * - **発火条件** — 「〜が実データで1件出たら着手する」のように、観測できる条件が書いてある
 * - **移譲先** — 別のADRやplanが所有すると書いてある
 * - **裁定済み** — 解決したADRへの参照が書いてある
 *
 * どれも無い未決は落とす。放置と保留を見た目で区別できない状態を残さない。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADR_DIR = path.join(ROOT, 'docs', 'adr');

/** 発火条件・移譲・裁定済みのいずれかを示す語。どれか1つ含まれていればよい。 */
const RESOLUTION_MARKERS = [
  '発火条件', '発火待ち', 'が出たら', '件出たら', '観測したら', '実測で',
  'が所有', 'へ移した', 'へ移す', 'で裁定する', 'が裁定する',
  '裁定済み', '解決済み', 'ADR 01', 'ADR 00',
];

const ITEM = /^\s*(?:[0-9]+\.|[-*])\s+\S/u;

function openQuestionItems(text) {
  const match = /##\s*(?:Open questions|未決[^\n]*)\n([\s\S]*?)(?=\n## |$)/u.exec(text);
  if (match === null) return [];
  const items = [];
  let current = null;
  for (const line of match[1].split('\n')) {
    if (ITEM.test(line)) {
      if (current !== null) items.push(current);
      current = line.trim();
    } else if (current !== null && line.trim().length > 0) {
      current += ` ${line.trim()}`;
    } else if (current !== null) {
      items.push(current);
      current = null;
    }
  }
  if (current !== null) items.push(current);
  return items;
}

const files = (await readdir(ADR_DIR)).filter((name) => name.endsWith('.md')).sort();
const unanchored = [];
let total = 0;
for (const name of files) {
  const text = await readFile(path.join(ADR_DIR, name), 'utf8');
  for (const item of openQuestionItems(text)) {
    total += 1;
    if (RESOLUTION_MARKERS.some((marker) => item.includes(marker))) continue;
    unanchored.push({ adr: name, item: item.slice(0, 140) });
  }
}

const report = {
  schema: 'lattice.open_question_report.v1',
  adr_files: files.length,
  open_questions: total,
  unanchored,
};
process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
if (unanchored.length > 0) {
  process.stderr.write(`open questions without a firing condition: ${unanchored.length}\n`);
  process.exit(1);
}
process.stdout.write(`open questions anchored: ${total}\n`);
