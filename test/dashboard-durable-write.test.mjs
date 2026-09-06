import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTodoDashboardActivity } from '../src/todo-dashboard-registry.mjs';

test('ディスク同期が失敗した登録内容は既存の一覧へ公開しない', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-durable-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { LATTICE_DASHBOARD_RUNTIME_DIR: path.join(root, 'runtime') };
  const options = { repoRoot: root, projectId: 'sample', displayName: '元の登録', sessionId: 'probe', env };
  await registerTodoDashboardActivity(options);
  const registry = path.join(env.LATTICE_DASHBOARD_RUNTIME_DIR, 'projects.json');
  const before = await readFile(registry);
  const handle = await open(registry, 'r');
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const failure = Object.assign(new Error('試験用の同期失敗'), { code: 'EIO' });
  const sync = t.mock.method(prototype, 'sync', async () => { throw failure; });
  await assert.rejects(registerTodoDashboardActivity({ ...options, displayName: '未確定の登録' }), failure);
  assert.equal(sync.mock.callCount(), 1);
  assert.deepEqual(await readFile(registry), before);
});
