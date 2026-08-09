import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  DEFAULT_IO_EXCLUDES, buildIoEscalation, classifyIoObservation, createIoSentinel, isExcludedPath,
  probeIoWarning, relativeToRoot, syncSentinelWatches,
} from '../src/runtime-io-sentinel.mjs';
import { detectCheckpointFindings } from '../src/runtime-diff-observer.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { validateRuntimeFindingCandidate } from '../src/runtime-multi-epoch-store.mjs';

// ADR 0143。警報はfindingではない——正本はcheckpointのままで、ここは早めるためだけに在る。
// 判定述語はcheckpoint findingと同一である必要がある（分かれるとどちらが正しいか分からなくなる）。

const packets = {
  T1: { todo_id: 'T1', scope: { writes: ['src/page.mjs', 'docs/'] } },
  T2: { todo_id: 'T2', scope: { writes: ['src/style.mjs'] } },
};

test('他のrunning TODOの宣言scopeへ書いたら重なりを警報する', () => {
  const { warnings } = classifyIoObservation({
    todoId: 'T2', relativePath: 'src/page.mjs', packets, runningTodoIds: ['T1', 'T2'],
  });
  // 自分の宣言外でもあるので、scope警報も同時に立つ。
  assert.deepEqual(warnings.map(({ kind }) => kind).sort(),
    ['io_overlap_warning', 'io_undeclared_write_warning']);
  const overlap = warnings.find(({ kind }) => kind === 'io_overlap_warning');
  assert.deepEqual(overlap.todo_ids, ['T1', 'T2']);
  assert.equal(overlap.path, 'src/page.mjs');
});

test('自分の宣言scope内だけなら警報しない', () => {
  const { warnings } = classifyIoObservation({
    todoId: 'T1', relativePath: 'src/page.mjs', packets, runningTodoIds: ['T1', 'T2'],
  });
  assert.deepEqual(warnings, []);
});

test('末尾スラッシュの宣言はprefixとして読む（checkpoint findingと同じ）', () => {
  const inside = classifyIoObservation({
    todoId: 'T1', relativePath: 'docs/adr/0143.md', packets, runningTodoIds: ['T1'],
  });
  assert.deepEqual(inside.warnings, []);
  const outside = classifyIoObservation({
    todoId: 'T2', relativePath: 'docs/adr/0143.md', packets, runningTodoIds: ['T1', 'T2'],
  });
  assert.equal(outside.warnings.some(({ kind }) => kind === 'io_overlap_warning'), true);
});

test('走っていないTODOの宣言とは重ならない', () => {
  // 止まっている相手のscopeへ書いても、いま競合しているわけではない。
  const { warnings } = classifyIoObservation({
    todoId: 'T2', relativePath: 'src/page.mjs', packets, runningTodoIds: ['T2'],
  });
  assert.deepEqual(warnings.map(({ kind }) => kind), ['io_undeclared_write_warning']);
});

test('宣言の無いTODOの観測でrunを止めない', () => {
  // 分からないものを「競合なし」へ丸めるのは判定側の話であり、警報は正本ではない。
  const { warnings } = classifyIoObservation({
    todoId: 'TX', relativePath: 'src/page.mjs', packets, runningTodoIds: ['T1', 'TX'],
  });
  assert.deepEqual(warnings, []);
});

test('rootの外を指す観測は相対pathにしない', () => {
  assert.equal(relativeToRoot('/w/a', '/w/a/src/page.mjs'), 'src/page.mjs');
  assert.equal(relativeToRoot('/w/a', '/w/b/src/page.mjs'), null);
  assert.equal(relativeToRoot('/w/a', '/w/a'), null);
});

test('道具自身の書き込みと共有mountは監視しない', () => {
  // node_modulesはworktreeを跨いで同じ絶対pathを指しうるので、pathの一致を競合と読むと必ず誤る。
  for (const excluded of ['.git/index', '.lattice/sensor/db', 'node_modules/x/index.js']) {
    assert.equal(isExcludedPath(excluded, DEFAULT_IO_EXCLUDES), true, excluded);
  }
  assert.equal(isExcludedPath('src/page.mjs', DEFAULT_IO_EXCLUDES), false);
});

// --- sentinel本体。イベント配送は差し替えて決定的に測るが、file自体は実在させる。
// sentinelは「いま実在する通常file」だけを観測として扱うので、実在しないpathでは何も起きない。

function fakeWatchFactory(registry) {
  return (root, _options, listener) => {
    const entry = { root, listener, closed: false };
    registry.push(entry);
    return { close() { entry.closed = true; }, on() {} };
  };
}

/** 実fileを持つworktreeを2つ作る。 */
async function worktrees(context) {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const base = await mkdtemp(path.join(tmpdir(), 'lattice-sentinel-wt-'));
  context.after(() => rm(base, { recursive: true, force: true }));
  const roots = {};
  for (const todoId of ['T1', 'T2']) {
    const root = path.join(base, todoId);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src/page.mjs'), 'x\n');
    roots[todoId] = root;
  }
  return roots;
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

test('同じ事実を何度も報告しない', async (context) => {
  const roots = await worktrees(context);
  const registry = [];
  const seen = [];
  const sentinel = createIoSentinel({
    packets, onWarning: (warning) => { seen.push(warning); },
    watchFactory: fakeWatchFactory(registry),
  });
  context.after(() => sentinel.close());
  sentinel.watchBinding({ todoId: 'T1', worktreePath: roots.T1 });
  sentinel.watchBinding({ todoId: 'T2', worktreePath: roots.T2 });

  const t2 = registry.find(({ root }) => root === roots.T2);
  t2.listener('change', 'src/page.mjs');
  t2.listener('change', 'src/page.mjs');
  await settle();

  assert.equal(seen.filter(({ kind }) => kind === 'io_overlap_warning').length, 1);

  // epochを跨いだら改めて報告する。新しい版では同じpathでも事実が違う。
  sentinel.resetEpoch();
  t2.listener('change', 'src/page.mjs');
  await settle();
  assert.equal(seen.filter(({ kind }) => kind === 'io_overlap_warning').length, 2);
});

test('directoryと実在しないentryは観測として扱わない', async (context) => {
  // 実測でmacOSのfs.watchは、directoryイベントと監視対象自身の名前を持つ幽霊entryを配ってくる。
  // どちらもcheckpoint diffのentryにならないので、警報にすると述語がずれる。
  const roots = await worktrees(context);
  const registry = [];
  const seen = [];
  const sentinel = createIoSentinel({
    packets, onWarning: (warning) => { seen.push(warning); },
    watchFactory: fakeWatchFactory(registry),
  });
  context.after(() => sentinel.close());
  // 重なりの相手も監視していないとrunning集合に入らない（running＝監視中）。
  sentinel.watchBinding({ todoId: 'T1', worktreePath: roots.T1 });
  sentinel.watchBinding({ todoId: 'T2', worktreePath: roots.T2 });
  const t2 = registry.find(({ root }) => root === roots.T2);

  t2.listener('rename', 'src');
  t2.listener('rename', path.basename(roots.T2));
  t2.listener('change', 'src/never-existed.mjs');
  await settle();
  assert.deepEqual(seen, []);

  // 実在する通常fileなら通る。
  t2.listener('change', 'src/page.mjs');
  await settle();
  assert.equal(seen.some(({ kind }) => kind === 'io_overlap_warning'), true);
});

test('監視を張れない環境でrunを止めない', () => {
  const sentinel = createIoSentinel({
    packets,
    onWarning: () => {},
    watchFactory: () => { throw new Error('ENOSYS'); },
  });
  assert.equal(sentinel.watchBinding({ todoId: 'T1', worktreePath: '/w/t1' }), false);
  assert.deepEqual(sentinel.watchedTodoIds(), []);
  sentinel.close();
});

test('binding lifecycleに沿ってwatchを張り替える', () => {
  const registry = [];
  const sentinel = createIoSentinel({
    packets, onWarning: () => {}, watchFactory: fakeWatchFactory(registry),
  });
  sentinel.watchBinding({ todoId: 'T1', worktreePath: '/w/old' });
  sentinel.watchBinding({ todoId: 'T1', worktreePath: '/w/new' });
  assert.deepEqual(sentinel.watchedTodoIds(), ['T1']);
  assert.equal(registry.find(({ root }) => root === '/w/old').closed, true);

  sentinel.unwatchBinding('T1');
  assert.deepEqual(sentinel.watchedTodoIds(), []);
  assert.equal(registry.find(({ root }) => root === '/w/new').closed, true);
  sentinel.close();
});

test('閉じた後の観測は配送しない', async (context) => {
  const roots = await worktrees(context);
  const registry = [];
  const seen = [];
  const sentinel = createIoSentinel({
    packets, onWarning: (warning) => { seen.push(warning); },
    watchFactory: fakeWatchFactory(registry),
  });
  sentinel.watchBinding({ todoId: 'T2', worktreePath: roots.T2 });
  const entry = registry.find(({ root }) => root === roots.T2);
  sentinel.close();
  entry.listener('change', 'src/page.mjs');
  await settle();
  assert.deepEqual(seen, []);
});

test('実fs.watchで書き込みを拾える', async (context) => {
  // 差し替えなしの経路が本当に動くことを1本だけ確かめる。取りこぼしは仕様なので、
  // 「拾えなければ落とす」ではなく「拾えたら内容が正しい」を見る。
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-sentinel-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });

  const seen = [];
  const sentinel = createIoSentinel({ packets, onWarning: (warning) => { seen.push(warning); } });
  context.after(() => sentinel.close());
  if (!sentinel.watchBinding({ todoId: 'T2', worktreePath: root })) return;

  await writeFile(path.join(root, 'src/page.mjs'), 'touched\n');
  const hit = () => seen.some(({ kind, path: target }) => (
    kind === 'io_overlap_warning' && target === 'src/page.mjs'));
  for (let attempt = 0; attempt < 40 && !hit(); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  // 取りこぼしは仕様なので「拾えなければ落とす」ではなく「拾えたら内容が正しい」を見る。
  // 拾えた場合、directoryや幽霊entryの警報が混ざっていないことも確かめる。
  if (!hit()) return;
  assert.equal(seen.every(({ path: target }) => target.includes('/')), true, JSON.stringify(seen));
});

// --- probe（ADR 0143の二段目）。警報だけで止めない。

const checkpoint = (paths) => ({
  checkpoint_digest: 'a'.repeat(64),
  diff: { entries: paths.map((target) => ({ path: target, change: 'modified' })) },
});

test('重なり警報は、両者のdiffに残っていて初めて実在とする', () => {
  const warning = { kind: 'io_overlap_warning', todo_ids: ['T1', 'T2'], path: 'src/page.mjs' };
  const observed = probeIoWarning({
    warning,
    checkpointsByTodo: { T1: checkpoint(['src/page.mjs']), T2: checkpoint(['src/page.mjs']) },
  });
  assert.deepEqual(observed, { outcome: 'observed', writers: ['T1', 'T2'] });
});

test('書いて消したtempで全workerを止めない', () => {
  // 警報は出るが、checkpointに残っていない。これがprobeを挟む理由そのもの。
  const warning = { kind: 'io_overlap_warning', todo_ids: ['T1', 'T2'], path: 'src/page.mjs.tmp' };
  const probed = probeIoWarning({
    warning,
    checkpointsByTodo: { T1: checkpoint(['src/page.mjs']), T2: checkpoint([]) },
  });
  assert.equal(probed.outcome, 'transient');
});

test('片方しか書いていない重なりは、まだ重なりではない', () => {
  const warning = { kind: 'io_overlap_warning', todo_ids: ['T1', 'T2'], path: 'src/page.mjs' };
  const probed = probeIoWarning({
    warning,
    checkpointsByTodo: { T1: checkpoint(['src/page.mjs']), T2: checkpoint(['src/style.mjs']) },
  });
  assert.equal(probed.outcome, 'transient');
  assert.deepEqual(probed.writers, ['T1']);
});

test('scope警報は自分のdiffに残っていれば実在である', () => {
  const warning = { kind: 'io_undeclared_write_warning', todo_ids: ['T2'], path: 'src/page.mjs' };
  assert.equal(probeIoWarning({
    warning, checkpointsByTodo: { T2: checkpoint(['src/page.mjs']) },
  }).outcome, 'observed');
  assert.equal(probeIoWarning({
    warning, checkpointsByTodo: { T2: checkpoint([]) },
  }).outcome, 'transient');
});

test('checkpointが取れていないTODOを書き手と数えない', () => {
  // 観測できていないことを「書いていない」へも「書いた」へも丸めない。
  const warning = { kind: 'io_overlap_warning', todo_ids: ['T1', 'T2'], path: 'src/page.mjs' };
  const probed = probeIoWarning({
    warning, checkpointsByTodo: { T1: checkpoint(['src/page.mjs']) },
  });
  assert.equal(probed.outcome, 'transient');
  assert.deepEqual(probed.writers, ['T1']);
});

// --- 監視の張り方。帰属が立たない構成では、そもそも警報を作らない。

test('rootを共有して走っているTODOは監視しない', () => {
  // 帰属はrootだけで決まる。同じrootで2つ走っていると、1件の書き込みが両方のwatcherへ
  // 配られ、無実のTODOへ「他人のscopeへ書いた」と主張してしまう。
  const registry = [];
  const sentinel = createIoSentinel({
    packets, onWarning: () => {}, watchFactory: fakeWatchFactory(registry),
  });
  const shared = { T1: '/repo', T2: '/repo' };
  syncSentinelWatches({ sentinel, runningTodoIds: ['T1', 'T2'], rootOf: (id) => shared[id] });
  assert.deepEqual(sentinel.watchedTodoIds(), []);

  // 分離されていれば見る。同じcodeがそのまま効く。
  const isolated = { T1: '/wt/T1', T2: '/wt/T2' };
  syncSentinelWatches({ sentinel, runningTodoIds: ['T1', 'T2'], rootOf: (id) => isolated[id] });
  assert.deepEqual(sentinel.watchedTodoIds(), ['T1', 'T2']);
  sentinel.close();
});

test('共有rootでも1つだけ走っているなら帰属は立つ', () => {
  const registry = [];
  const sentinel = createIoSentinel({
    packets, onWarning: () => {}, watchFactory: fakeWatchFactory(registry),
  });
  syncSentinelWatches({ sentinel, runningTodoIds: ['T1'], rootOf: () => '/repo' });
  assert.deepEqual(sentinel.watchedTodoIds(), ['T1']);
  sentinel.close();
});

test('走り終わったTODOの監視は外し、走り続けている監視は張り替えない', () => {
  const registry = [];
  const sentinel = createIoSentinel({
    packets, onWarning: () => {}, watchFactory: fakeWatchFactory(registry),
  });
  const roots = { T1: '/wt/T1', T2: '/wt/T2' };
  syncSentinelWatches({ sentinel, runningTodoIds: ['T1', 'T2'], rootOf: (id) => roots[id] });
  assert.equal(registry.length, 2);

  syncSentinelWatches({ sentinel, runningTodoIds: ['T1'], rootOf: (id) => roots[id] });
  assert.deepEqual(sentinel.watchedTodoIds(), ['T1']);
  // 張り替えは監視を一度落とす。走り続けているTODOで落とすと、その隙の書き込みを取り逃す。
  assert.equal(registry.length, 2);
  assert.equal(registry.find(({ root }) => root === '/wt/T2').closed, true);
  assert.equal(registry.find(({ root }) => root === '/wt/T1').closed, false);
  sentinel.close();
});

test('bindingを持たないTODOは監視対象にしない', () => {
  const registry = [];
  const sentinel = createIoSentinel({
    packets, onWarning: () => {}, watchFactory: fakeWatchFactory(registry),
  });
  syncSentinelWatches({ sentinel, runningTodoIds: ['T1'], rootOf: () => undefined });
  assert.deepEqual(sentinel.watchedTodoIds(), []);
  sentinel.close();
});

test('sentinelが無い構成でも呼べる', () => {
  assert.equal(syncSentinelWatches({ sentinel: null, runningTodoIds: ['T1'], rootOf: () => '/w' }),
    undefined);
});

// --- escalation（ADR 0143の三段目）。probeを通った警報を既存hold経路の入力へ写す。

const overlapWarning = { kind: 'io_overlap_warning', todo_ids: ['T1', 'T2'], path: 'src/page.mjs' };
const bothWrote = { T1: checkpoint(['src/page.mjs']), T2: checkpoint(['src/page.mjs', 'src/style.mjs']) };
const manifests = {
  T1: { writes: [...packets.T1.scope.writes] },
  T2: { writes: [...packets.T2.scope.writes] },
};

test('probeを通った重なりは、そのままfinding candidateになる', () => {
  const probe = probeIoWarning({ warning: overlapWarning, checkpointsByTodo: bothWrote });
  const escalation = buildIoEscalation({ warning: overlapWarning, probe, checkpointsByTodo: bothWrote, packets });
  // 契約を満たさないcandidateを作ったら、既存のfinding_recordが受け取れない。
  assert.equal(validateRuntimeFindingCandidate(escalation.candidate), true);
  assert.equal(escalation.candidate.proposed_kind, 'observed_write_conflict');
  assert.deepEqual(escalation.candidate.todo_ids, ['T1', 'T2']);
  assert.equal(escalation.candidate.path, 'src/page.mjs');
  assert.equal(escalation.candidate.resource_id, null);
  // 証拠はprobeが撮ったcheckpointそのもの。fs eventをfindingの証拠にしない。
  // anchorは**他人の宣言scopeへ書いた側**——T1は自分のscope内に書いただけなので、
  // T1のcheckpointへ縛るとproducerが同じfindingを再導出できない。
  assert.equal(escalation.anchor_todo_id, 'T2');
  assert.equal(escalation.checkpoint_digest, bothWrote.T2.checkpoint_digest);
  assert.deepEqual(escalation.candidate.evidence_digests, [bothWrote.T2.checkpoint_digest]);
});

test('candidateは、anchorのcheckpointからproducerが再導出できる形である', () => {
  // finding_recordは`detectCheckpointFindings`での再導出一致を要求する。ここが揃っていないと、
  // 正しい警報が形式の都合で落ちる。producer側の判定をそのまま突き合わせる。
  const probe = probeIoWarning({ warning: overlapWarning, checkpointsByTodo: bothWrote });
  const escalation = buildIoEscalation({ warning: overlapWarning, probe, checkpointsByTodo: bothWrote, packets });
  const { findings } = detectCheckpointFindings({
    todoId: escalation.anchor_todo_id, checkpoint: bothWrote[escalation.anchor_todo_id],
    packets, manifests, runningTodoIds: ['T1', 'T2'],
  });
  const match = findings.find((finding) => finding.kind === escalation.candidate.proposed_kind
    && finding.path === escalation.candidate.path);
  assert.notEqual(match, undefined);
  assert.deepEqual(match.todo_ids, escalation.candidate.todo_ids);
});

test('単独のscope警報はhold経路へ運ばない', () => {
  // 宣言境界は計画時の**予測**であって、workerを閉じ込める制約ではない。範囲内へ無理に
  // 押し込めるとworkerの自由度が落ち、成果の品質が下がる。誰の領分とも重なっていない
  // 宣言外の書き込みは競合ではなく、予測が実態より狭かったという情報である。止めない。
  const warning = { kind: 'io_undeclared_write_warning', todo_ids: ['T2'], path: 'src/page.mjs' };
  const checkpointsByTodo = { T2: checkpoint(['src/page.mjs']) };
  const probe = probeIoWarning({ warning, checkpointsByTodo });
  assert.equal(probe.outcome, 'observed');
  // 実在と裁定されてもescalationは組まない。記録（io_warning_observed）だけが残る。
  assert.equal(buildIoEscalation({ warning, probe, checkpointsByTodo, packets }), null);
});

test('probeが実在と言っていない警報はescalationへ進めない', () => {
  const transient = { T1: checkpoint(['src/page.mjs']), T2: checkpoint([]) };
  const probe = probeIoWarning({ warning: overlapWarning, checkpointsByTodo: transient });
  assert.equal(buildIoEscalation({ warning: overlapWarning, probe, checkpointsByTodo: transient, packets }), null);
  assert.equal(buildIoEscalation({
    warning: overlapWarning, probe: { outcome: 'unprobed', writers: [] },
    checkpointsByTodo: transient, packets,
  }), null);
});

test('anchorのcheckpoint digestが無ければescalationを組まない', () => {
  // 証拠を指せないcandidateを作らない。作れば、finding_recordがdurable evidenceへ
  // 解決できずに落ちるだけで、失敗の原因がここから遠ざかる。
  const broken = { T1: { diff: { entries: [{ path: 'src/page.mjs' }] } },
    T2: { diff: { entries: [{ path: 'src/page.mjs' }] } } };
  const probe = probeIoWarning({ warning: overlapWarning, checkpointsByTodo: broken });
  assert.equal(probe.outcome, 'observed');
  assert.equal(buildIoEscalation({ warning: overlapWarning, probe, checkpointsByTodo: broken, packets }), null);
});

test('candidate digestは本文へ束縛される', () => {
  const probe = probeIoWarning({ warning: overlapWarning, checkpointsByTodo: bothWrote });
  const { candidate } = buildIoEscalation({ warning: overlapWarning, probe, checkpointsByTodo: bothWrote, packets });
  assert.equal(candidate.candidate_digest, selfDigest(candidate, 'candidate_digest'));
  assert.equal(validateRuntimeFindingCandidate({ ...candidate, path: 'src/other.mjs' }), false);
});
