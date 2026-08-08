import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readProjectExternalPane, resolveProjectIdentity } from '../src/project-identity.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-project-identity-'));
  await mkdir(path.join(root, '.lattice'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('project identityはenv override > project file > project_idの順で解決する', async (context) => {
  const root = await fixture(context);
  assert.deepEqual(await resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }), {
    projectId: 'aishell', displayName: 'aishell', source: 'project_id',
  });
  await writeFile(path.join(root, '.lattice', 'project.json'), `${JSON.stringify({
    schema: 'lattice.project_identity.v1', project_id: 'aishell', display_name: 'AIShell',
  })}\n`);
  assert.deepEqual(await resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }), {
    projectId: 'aishell', displayName: 'AIShell', source: 'project_file',
  });
  assert.deepEqual(await resolveProjectIdentity({ repoRoot: root, projectId: 'aishell',
    env: { LATTICE_PROJECT_DISPLAY_NAME: 'AIShell Preview' } }), {
    projectId: 'aishell', displayName: 'AIShell Preview', source: 'environment',
  });
});

test('external_paneは任意欄として通り、無い時はnullになる', async (context) => {
  const root = await fixture(context);
  const ref = path.join(root, '.lattice', 'project.json');
  assert.equal(await readProjectExternalPane({ repoRoot: root, projectId: 'aishell' }), null);
  await writeFile(ref, `${JSON.stringify({
    schema: 'lattice.project_identity.v1', project_id: 'aishell', display_name: 'AIShell',
  })}\n`);
  assert.equal(await readProjectExternalPane({ repoRoot: root, projectId: 'aishell' }), null);
  await writeFile(ref, `${JSON.stringify({
    schema: 'lattice.project_identity.v1', project_id: 'aishell', display_name: 'AIShell',
    external_pane: { title: '円卓', url: 'https://pane.example/room-a', probe_url: 'https://probe.example/api/room-a/members' },
  })}\n`);
  // 既存の呼び出し（status/gantt系）は戻り値の形が変わらないまま通り続ける。
  assert.deepEqual(await resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }), {
    projectId: 'aishell', displayName: 'AIShell', source: 'project_file',
  });
  assert.deepEqual(await readProjectExternalPane({ repoRoot: root, projectId: 'aishell' }), {
    title: '円卓',
    url: 'https://pane.example/room-a',
    probeUrl: 'https://probe.example/api/room-a/members',
    frameOrigin: 'https://pane.example',
    probeOrigin: 'https://probe.example',
  });
});

test('壊れたexternal_paneは黙って無視せずPROJECT_IDENTITY_INVALIDで落ちる', async (context) => {
  const root = await fixture(context);
  const ref = path.join(root, '.lattice', 'project.json');
  const identity = { schema: 'lattice.project_identity.v1', project_id: 'aishell', display_name: 'AIShell' };
  const broken = [
    { title: '円卓', url: 'https://pane.example/' },
    { title: '円卓', url: 'https://pane.example/', probe_url: 'https://probe.example/', extra: 1 },
    { title: '', url: 'https://pane.example/', probe_url: 'https://probe.example/' },
    { title: '円卓', url: '/relative/path', probe_url: 'https://probe.example/' },
    { title: '円卓', url: 'javascript:alert(1)', probe_url: 'https://probe.example/' },
    { title: '円卓', url: 'https://pane.example/', probe_url: 'ftp://probe.example/' },
    'not-an-object',
  ];
  for (const external_pane of broken) {
    await writeFile(ref, `${JSON.stringify({ ...identity, external_pane })}\n`);
    await assert.rejects(readProjectExternalPane({ repoRoot: root, projectId: 'aishell' }),
      (error) => error.code === 'PROJECT_IDENTITY_INVALID');
    await assert.rejects(resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }),
      (error) => error.code === 'PROJECT_IDENTITY_INVALID');
  }
  await writeFile(ref, `${JSON.stringify({ ...identity, unknown_key: 1 })}\n`);
  await assert.rejects(resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }),
    (error) => error.code === 'PROJECT_IDENTITY_INVALID');
});

test('project identityはproject mismatch・duplicate key・symlinkをfallbackせず拒否する', async (context) => {
  const root = await fixture(context);
  const ref = path.join(root, '.lattice', 'project.json');
  await writeFile(ref, '{"schema":"lattice.project_identity.v1","project_id":"other","display_name":"AIShell"}\n');
  await assert.rejects(resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }),
    (error) => error.code === 'PROJECT_IDENTITY_INVALID');
  await writeFile(ref, '{"schema":"lattice.project_identity.v1","project_id":"aishell","display_name":"A","display_name":"B"}\n');
  await assert.rejects(resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }),
    (error) => error.code === 'PROJECT_IDENTITY_INVALID');
  await rm(ref);
  await writeFile(path.join(root, 'identity.json'), '{}\n');
  const { symlink } = await import('node:fs/promises');
  await symlink(path.join(root, 'identity.json'), ref);
  await assert.rejects(resolveProjectIdentity({ repoRoot: root, projectId: 'aishell', env: {} }),
    (error) => error.code === 'PROJECT_IDENTITY_INVALID');
});
