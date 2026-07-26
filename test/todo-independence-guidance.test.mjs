import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TODO_INDEPENDENCE_GUIDANCE_CODES,
  TODO_INDEPENDENCE_WORKFLOW,
  selectIndependenceGuidance,
  todoIndependenceGuidance,
} from '../src/todo-independence-guidance.mjs';

// ADR 0130。案内の単一正本。事実と次の一歩だけを述べ、指示しない。

test('全codeが説明と次の一歩を持つ', () => {
  for (const code of TODO_INDEPENDENCE_GUIDANCE_CODES) {
    const guidance = todoIndependenceGuidance(code);
    assert.equal(guidance.code, code);
    assert.ok(guidance.message.length > 0, `${code} has no message`);
    assert.ok(guidance.next_action.length > 0, `${code} has no next_action`);
  }
});

test('未知のcodeは黙って通さない', () => {
  assert.throws(() => todoIndependenceGuidance('probably_fine'), TypeError);
});

test('案内は命令形にならない（判断はhostが所有する）', () => {
  for (const code of TODO_INDEPENDENCE_GUIDANCE_CODES) {
    const { message } = todoIndependenceGuidance(code);
    // 「〜すべき」「〜しなさい」「〜してください」はLatticeがdispatchを統制する言い方になる。
    assert.doesNotMatch(message, /すべき|しなさい|してください|must|should/u,
      `${code} reads as an instruction: ${message}`);
  }
});

test('conflictの案内は切断可能性で言い換えが変わる', () => {
  const seam = todoIndependenceGuidance('independence_conflict_with_active', {
    severability: 'code_seam',
  });
  const serial = todoIndependenceGuidance('independence_conflict_with_active', {
    severability: 'serial',
  });
  assert.match(seam.message, /refactorで並列化しうる/u);
  assert.match(serial.message, /分割では切り離せない/u);
  assert.notEqual(seam.message, serial.message);
  // 同じ状況なのでcodeとnext_actionは共有する。
  assert.equal(seam.code, serial.code);
  assert.equal(seam.next_action, serial.next_action);
});

test('重なった状況からは最も行動を要する1つを選ぶ', () => {
  // 記録が無い状態でも、activeとの衝突が分かっているならそちらを先に告げる。
  const conflict = selectIndependenceGuidance({
    coverage: 'verified', taskDeclared: true, taskStale: false,
    conflictWithActive: 'code_seam',
  });
  assert.equal(conflict.code, 'independence_conflict_with_active');

  const undeclared = selectIndependenceGuidance({
    coverage: 'verified', taskDeclared: false, taskStale: false,
  });
  assert.equal(undeclared.code, 'independence_task_undeclared');

  const stale = selectIndependenceGuidance({
    coverage: 'stale', taskDeclared: true, taskStale: true,
  });
  assert.equal(stale.code, 'independence_stale_for_task');

  // 宣言境界に触れていないstaleは、そのtaskについては検証済みのまま。
  const untouched = selectIndependenceGuidance({
    coverage: 'stale', taskDeclared: true, taskStale: false,
  });
  assert.equal(untouched.code, 'independence_verified');

  const missing = selectIndependenceGuidance({
    coverage: 'missing', taskDeclared: false, taskStale: false,
  });
  assert.equal(missing.code, 'independence_unrecorded');

  const superseded = selectIndependenceGuidance({
    coverage: 'superseded', taskDeclared: true, taskStale: false,
  });
  assert.equal(superseded.code, 'independence_superseded');
});

test('着手候補が無いとき、空虚に検証済みへ倒れない', () => {
  // ready集合が空だとunknown listも空になり、`.every()`が空虚に真、`.some()`が偽になる。
  // readyCountを見ないと「記録が古いのに検証済み」という嘘を返す（0.13.0のsmokeで実際に出た）。
  const noReady = selectIndependenceGuidance({
    coverage: 'stale', taskDeclared: true, taskStale: false, readyCount: 0,
  });
  assert.equal(noReady.code, 'independence_no_ready_frontier');
  assert.equal(noReady.next_action, 'none');

  // 記録が無い場合も同じ——述べる対象が無いことのほうが precise。
  assert.equal(selectIndependenceGuidance({
    coverage: 'missing', taskDeclared: false, taskStale: false, readyCount: 0,
  }).code, 'independence_no_ready_frontier');

  // readyがあれば従来どおり状況を述べる。
  assert.equal(selectIndependenceGuidance({
    coverage: 'verified', taskDeclared: true, taskStale: false, readyCount: 2,
  }).code, 'independence_verified');

  // readyCount未指定（着手時advisory）は対象taskが確定しているので影響を受けない。
  assert.equal(selectIndependenceGuidance({
    coverage: 'stale', taskDeclared: true, taskStale: true,
  }).code, 'independence_stale_for_task');
});

test('作業手順は宣言からcompileを経て読むまでを順に述べる', () => {
  const numbered = TODO_INDEPENDENCE_WORKFLOW.filter((line) => /^\d\. /u.test(line));
  assert.equal(numbered.length, 4);
  assert.match(numbered[0], /witness/u);
  assert.match(numbered[1], /independence compile/u);
  assert.match(numbered[2], /todo independence --plan/u);
  assert.match(numbered[3], /witness migrate/u);
});

test('宣言の手順はconcern_anchorsを宣言できる欄として挙げる', () => {
  const declareAt = TODO_INDEPENDENCE_WORKFLOW.findIndex((line) => line.startsWith('1. '));
  const anchorAt = TODO_INDEPENDENCE_WORKFLOW.findIndex((line) => line.includes('concern_anchors'));
  // 宣言の段（1.）に属する。判定や追従の段へ置くと、書く時点が過ぎてから読まれる。
  assert.ok(anchorAt > declareAt);
  assert.ok(!/^\d\. /u.test(TODO_INDEPENDENCE_WORKFLOW[anchorAt]));
  // 誰が書くべきかの条件を述べる。条件が無いと全ToDoが書く欄だと読まれる。
  assert.match(TODO_INDEPENDENCE_WORKFLOW[anchorAt], /係争資源/u);
  // 判定へ写らないことまで述べる。並列可否の入力と誤読されると、宣言が判定を動かすと思われる。
  assert.match(TODO_INDEPENDENCE_WORKFLOW[anchorAt], /判定には写らず/u);
});
