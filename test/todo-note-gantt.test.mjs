import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ganttLiveHeadDigest, renderTodoGanttForProject } from '../src/todo-cli.mjs';
import { appendTodoNote } from '../src/todo-note-store.mjs';
import {
  createTodoStoreWriter, initializeTodoStore, readTodoStore,
} from '../src/todo-store.mjs';
import { registerManagedDaemonFixture } from './helpers/managed-daemon-fixture.mjs';

const ACTOR = { host: 'host-1', session: 'session-1', agent: 'agent-1' };
const NOW = '2026-08-01T00:00:00.000Z';

async function workspace(t) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-note-gantt-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: repoRoot }).status, 0);
  await initializeTodoStore({
    repoRoot,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v6', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [{ task_id: 'T1', title: 'Task 1', lane: 'main',
          design_memo: '## 初期方針\n\n`NO_PLAN`ではなく、作業記録とは別の初期設計を持つ。',
          narrative_ref: null, narrative_anchor: null, compile_binding: null,
          parent_task_id: null }], hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  return repoRoot;
}

async function append(repoRoot, body, recordedAt = NOW) {
  return appendTodoNote({
    repoRoot, projectId: 'project-1', planKey: 'main', planVersion: 'v1', taskId: 'T1',
    actor: ACTOR, recordedAt, body, supersedes: null, eligibleSupersedes: [],
  });
}

// 描く面はどれも記録込みで描く。除外の選択肢自体が無いことを、描画結果で押さえる。
test('Ganttは設計メモとappend-only作業記録をどちらも表示し危険な要素だけ落とす', async (t) => {
  const repoRoot = await workspace(t);
  const memo = 'PUBLIC-DESIGN-NOTE-9f83';
  await append(repoRoot, `${memo}\n\n**重要**\n\n<script>alert(1)</script>\n\n[危険](javascript:alert(1))`);
  const store = await readTodoStore({ repoRoot });

  const rendered = await renderTodoGanttForProject({
    repoRoot, readModel: store, displayName: 'Fixture',
  });
  assert.match(rendered.rendered.html, new RegExp(memo, 'u'));
  assert.match(rendered.rendered.html, /<h2>設計メモ<\/h2>/u);
  assert.match(rendered.rendered.html, /<h2>作業記録<\/h2>/u);
  assert.match(rendered.rendered.html, /<h2>初期方針<\/h2>/u);
  assert.match(rendered.rendered.html, /作業記録とは別の初期設計を持つ/u);
  assert.match(rendered.rendered.html, /<strong>重要<\/strong>/u);
  assert.match(rendered.rendered.html, /来歴: v1\/T1/u);
  assert.match(rendered.rendered.html, /安全上表示できない要素を除外/u);
  assert.doesNotMatch(rendered.rendered.html, /<script>alert\(1\)<\/script>/u);
  assert.doesNotMatch(rendered.rendered.html, /javascript:/u);
});

/** 1行のJSON resultを吐くまで待つ。CLIの契約はstdout 1行目のJSONである。 */
function firstJsonLine(child) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      try {
        resolve(JSON.parse(buffered.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`serve exited early: ${code} ${stderr}`)));
  });
}

// serveがnoteを読まない配線へ戻ると作業記録が丸ごと消える。表示の有無ではなく配線を守る。
test('gantt serve は作業記録込みでHTMLを配信する', async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'lattice-note-serve-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: repoRoot }).status, 0);
  await initializeTodoStore({
    repoRoot,
    writer: createTodoStoreWriter({ caller: 'g4-migration' }),
    projectId: 'project-1', repositories: [{ repo_id: 'self', path: '.' }],
    plans: [{
      plan: {
        schema: 'lattice.todo_plan.v6', project_id: 'project-1', plan_key: 'main',
        plan_version: 'v1', predecessor_plan_digest: null,
        tasks: [{ task_id: 'T1', title: 'Task 1', lane: 'main',
          design_memo: '`NO_PLAN`', narrative_ref: null, narrative_anchor: null,
          compile_binding: null, parent_task_id: null }], hard_dependencies: [], joins: [],
      },
      genesis: { actor: ACTOR, recorded_at: NOW },
    }], now: NOW,
  });
  const marker = 'SERVED-WORK-LOG-4c1e';
  await append(repoRoot, marker);

  const child = spawn(process.execPath, [
    path.resolve(import.meta.dirname, '../bin/lattice.mjs'),
    'todo', 'gantt', 'serve', '--port', '0',
  // fixtureのreapはプロセスグループ（-pid）へ signal を送る。detachedでなければ届かない。
  ], {
    cwd: repoRoot, detached: true,
    env: { ...process.env, LATTICE_DASHBOARD_AUTOSTART: '0' },
  });
  registerManagedDaemonFixture(t, repoRoot, { tracked: [child.pid] });
  const started = await firstJsonLine(child);

  const html = await (await fetch(new URL('/projects/project-1/', started.url))).text();
  assert.match(html, /<h2>作業記録<\/h2>/u);
  assert.match(html, new RegExp(marker, 'u'));
});

// HTMLを作る側は閲覧者の地域を知らない。UTCのまま埋め、変換はブラウザへ委ねる。
test('作業記録の時刻はUTCを保持したままブラウザで現地時刻へ直す', async (t) => {
  const repoRoot = await workspace(t);
  await append(repoRoot, '時刻表示の確認', '2026-08-01T14:08:23.766Z');
  const { rendered } = await renderTodoGanttForProject({
    repoRoot, readModel: await readTodoStore({ repoRoot }), displayName: 'Fixture',
  });

  // 機械可読なUTCはdatetimeとtitleへ残す。scriptが動かなければ本文のUTCがそのまま読める。
  assert.match(rendered.html, /<time datetime="2026-08-01T14:08:23\.766Z" title="2026-08-01T14:08:23\.766Z" data-utc-stamp>2026-08-01T14:08:23\.766Z<\/time>/u);
  // 変換は閲覧者のlocaleに従う。生成時のサーバTZを焼き込まない。
  assert.match(rendered.html, /querySelectorAll\('time\[data-utc-stamp\]'\)/u);
  assert.match(rendered.html, /stamp\.textContent=parsed\.toLocaleString\(\)/u);
});

test('Ganttのnote chain破損は明示警告になりlive headも破損を反映する', async (t) => {
  const repoRoot = await workspace(t);
  await append(repoRoot, '破損前');
  const store = await readTodoStore({ repoRoot });
  const before = await ganttLiveHeadDigest({ repoRoot, store });
  const active = path.join(repoRoot, '.lattice/todo/notes/main/active.jsonl');
  await writeFile(active, ` ${await readFile(active, 'utf8')}`);

  const rendered = await renderTodoGanttForProject({
    repoRoot, readModel: store, displayName: 'Fixture',
  });
  assert.match(rendered.rendered.html, /作業記録の読取警告/u);
  assert.match(rendered.rendered.html, /NOTE_LOG_CORRUPT/u);
  assert.match(rendered.rendered.html, /作業記録を読み取れません/u);
  assert.doesNotMatch(rendered.rendered.html, /記録はありません/u);
  const after = await ganttLiveHeadDigest({ repoRoot, store });
  assert.notEqual(after, before);
});
