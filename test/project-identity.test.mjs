import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveProjectIdentity } from '../src/project-identity.mjs';

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
