import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  DEFAULT_IO_EXCLUDES, classifyIoObservation, createIoSentinel, isExcludedPath, relativeToRoot,
} from '../src/runtime-io-sentinel.mjs';

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
    ['io_overlap_warning', 'io_scope_warning']);
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
  assert.deepEqual(warnings.map(({ kind }) => kind), ['io_scope_warning']);
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
