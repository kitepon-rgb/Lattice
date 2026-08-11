import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { gitSpawnSync } from '../src/git-process.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';
import {
  TODO_STRUCTURE_REALIZATION_SCHEMA,
  TODO_STRUCTURE_SET_SCHEMA,
  digestTodoStructureTransform,
} from '../src/todo-structure-contracts.mjs';
import {
  TODO_STRUCTURE_GIT_LIMITS,
  TodoStructureGitError,
  bindTodoStructureRealizationCommits,
  collectTodoStructureGitProvenance,
  projectTodoStructureSensorDiff,
} from '../src/todo-structure-git-adapter.mjs';

const DIGEST = (character) => character.repeat(64);

function git(cwd, args, options = {}) {
  const result = gitSpawnSync(args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options,
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

function contract() {
  return {
    shape_id: 'compiled-source', schema_ref: null, identity_fields: ['source_id'],
    lifecycle: 'immutable_artifact', cardinality: 'one', compatible_shape_ids: [],
  };
}

function planned() {
  return {
    outcome: 'sourceを変換する',
    inputs: [{
      port_id: 'source-in', source: { kind: 'constant', constant_id: 'fixture', value: 'source' },
      access: 'read', contract: contract(),
    }],
    operations: [{
      operation_id: 'compile', input_port_ids: ['source-in'], output_port_ids: ['source-out'],
      summary: 'sourceをcompileする',
    }],
    outputs: [{
      port_id: 'source-out', data_id: 'compiled-source', contract: contract(),
      sinks: [{ kind: 'final_product', product_id: 'compiled-product' }],
    }],
    code_anchors: [{
      anchor_id: 'compiler', effect: 'modify', path: 'src/core.mjs',
      symbol: 'compile', expected_at: 'current',
    }],
    failures: ['compile失敗'], first_live_e2e: '実sourceを一件compileする', non_goals: ['transport変更'],
  };
}

function structureSet(baselineSha) {
  const value = {
    schema: TODO_STRUCTURE_SET_SCHEMA,
    project_id: 'lattice', plan_key: 'structure-plan', plan_version: 'v1',
    topology_digest: DIGEST('a'), profile: 'code-dataflow', baseline_sha: baselineSha,
    external_contracts: [],
    tasks: [{ task_id: 'task-1', applicability: 'graph', planned: planned() }],
    structure_set_digest: '',
  };
  value.structure_set_digest = todoSelfDigest(value, 'structure_set_digest');
  return value;
}

function sensorDiff(overrides = {}) {
  return {
    schema: 'lattice.sensor_diff_result.v1',
    provider: 'lattice', sensor_owner: 'lattice', command: 'diff',
    a: { root: '/secret/base', database: '/secret/base/sensor.db', subtree: '', indexed: { nodes: 1 } },
    b: { root: '/secret/current', database: '/secret/current/sensor.db', subtree: '', indexed: { nodes: 2 } },
    comparability: { status: 'ok', reasons: [] },
    summary: { nodes: { added: 1 }, edges: { added: 0 } },
    excluded: { a: { nodes_outside_subtree: 0 }, b: { nodes_outside_subtree: 0 } },
    integrity: { a: { files_with_extraction_errors: 0 }, b: { files_with_extraction_errors: 0 } },
    limit: 200, truncation: {},
    files: { added: [], removed: [], changed: [] },
    nodes: { added: [], removed: [], changed: [], moved: [] },
    edges: { added: [], removed: [] },
    ...overrides,
  };
}

async function fixtureRepo(context) {
  const repo = await mkdtemp(path.join(tmpdir(), 'lattice-structure-git-'));
  context.after(() => rm(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Lattice Test']);
  git(repo, ['config', 'user.email', 'lattice@example.invalid']);
  await mkdir(path.join(repo, 'src'));
  await writeFile(path.join(repo, 'src/main.mjs'), 'export function compile() { return 1; }\n');
  git(repo, ['add', '--', 'src/main.mjs']);
  git(repo, ['commit', '-q', '-m', 'baseline']);
  const baseline = git(repo, ['rev-parse', 'HEAD']);

  await writeFile(path.join(repo, 'src/main.mjs'), 'export function compile() { return 2; }\n');
  await writeFile(path.join(repo, 'asset.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  await symlink('src/main.mjs', path.join(repo, 'compile-link'));
  git(repo, ['add', '--', 'src/main.mjs', 'asset.bin', 'compile-link']);
  git(repo, ['commit', '-q', '-m', 'content']);
  const first = git(repo, ['rev-parse', 'HEAD']);

  git(repo, ['mv', 'src/main.mjs', 'src/core.mjs']);
  await writeFile(path.join(repo, 'src/core.mjs'), [
    'export function compile() { return 2; }',
    'export const current = true;',
    '',
  ].join('\n'));
  git(repo, ['add', '--', 'src/core.mjs']);
  git(repo, ['commit', '-q', '-m', 'rename']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  return { repo, baseline, first, head };
}

test('cleanなbaseline..HEADをcommit changesetへ写しrename・binary・symlinkを分類する', async (context) => {
  const fixture = await fixtureRepo(context);
  let observedSensorRequest = null;
  const set = structureSet(fixture.baseline);
  const provenance = collectTodoStructureGitProvenance({
    repoRoot: fixture.repo,
    structureSet: set,
    sensorDiffRequest: { a: { root: '/base' }, b: { root: '/current' }, limit: 999 },
    compareSensor: (request) => {
      observedSensorRequest = request;
      return sensorDiff();
    },
  });

  assert.equal(provenance.baseline_sha, fixture.baseline);
  assert.equal(provenance.head_sha, fixture.head);
  assert.deepEqual(provenance.commit_order, [fixture.first, fixture.head]);
  assert.equal(provenance.summary.commits, 2);
  assert.equal(provenance.summary.binary, 1);
  assert.equal(provenance.summary.symlink, 1);
  assert.equal(provenance.summary.renames, 1);
  const changes = provenance.changesets.flatMap(({ changes: entries }) => entries);
  assert.equal(changes.find(({ path: entryPath }) => entryPath === 'asset.bin').binary, true);
  assert.equal(changes.find(({ path: entryPath }) => entryPath === 'compile-link').file_kind, 'symlink');
  assert.deepEqual(changes.find(({ change }) => change === 'rename'), {
    ...changes.find(({ change }) => change === 'rename'),
    path: 'src/core.mjs', previous_path: 'src/main.mjs',
  });
  assert.equal(observedSensorRequest.limit, TODO_STRUCTURE_GIT_LIMITS.sensorDetailsPerBucket);
  assert.equal(provenance.sensor_diff.status, 'ready');
  assert.equal('root' in provenance.sensor_diff.projection.a, false);
  assert.equal('database' in provenance.sensor_diff.projection.b, false);
});

test('compareSensorIndexesのcomparability・excluded・truncationを再定義せず保持する', () => {
  const input = sensorDiff({
    comparability: { status: 'degraded', reasons: ['version differs'] },
    excluded: { a: { dangling_edge_endpoints: 2 }, b: { edges_outside_subtree: 3 } },
    truncation: { 'nodes.added': { returned: 1, omitted: 4, total: 5 } },
    nodes: {
      added: [{ kind: 'function', file_path: 'src/a.mjs', qualified_name: 'a', name: 'a' }],
      removed: [], changed: [], moved: [],
    },
  });
  const projected = projectTodoStructureSensorDiff(input);
  assert.deepEqual(projected.projection.comparability, input.comparability);
  assert.deepEqual(projected.projection.excluded, input.excluded);
  assert.deepEqual(projected.projection.truncation, input.truncation);
  assert.equal(JSON.stringify(projected).includes('/secret/'), false);
});

test('Gitlinkは通常fileへ丸めずsubmoduleとしてchangesetへ残す', async (context) => {
  const fixture = await fixtureRepo(context);
  await mkdir(path.join(fixture.repo, 'vendor'));
  git(fixture.repo, ['clone', '-q', fixture.repo, 'vendor/sub']);
  git(path.join(fixture.repo, 'vendor/sub'), ['checkout', '-q', fixture.baseline]);
  git(fixture.repo, [
    'update-index', '--add', '--cacheinfo', `160000,${fixture.baseline},vendor/sub`,
  ]);
  git(fixture.repo, ['commit', '-q', '-m', 'gitlink']);
  const provenance = collectTodoStructureGitProvenance({
    repoRoot: fixture.repo, structureSet: structureSet(fixture.baseline),
  });
  const gitlink = provenance.changesets.flatMap(({ changes }) => changes)
    .find(({ path: entryPath }) => entryPath === 'vendor/sub');
  assert.equal(gitlink.file_kind, 'submodule');
  assert.equal(gitlink.binary, null);
  assert.equal(provenance.summary.submodule, 1);
});

test('dirty・baseline不在・非祖先を別のtyped errorで止める', async (context) => {
  const fixture = await fixtureRepo(context);
  await writeFile(path.join(fixture.repo, 'dirty.txt'), 'dirty\n');
  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: fixture.repo, structureSet: structureSet(fixture.baseline),
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_WORKTREE_DIRTY');
  await rm(path.join(fixture.repo, 'dirty.txt'));

  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: fixture.repo, structureSet: structureSet('f'.repeat(40)),
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_BASELINE_UNREACHABLE');

  git(fixture.repo, ['checkout', '-q', '--orphan', 'other-history']);
  git(fixture.repo, ['rm', '-q', '-rf', '.']);
  await writeFile(path.join(fixture.repo, 'other.txt'), 'other\n');
  git(fixture.repo, ['add', '--', 'other.txt']);
  git(fixture.repo, ['commit', '-q', '-m', 'other']);
  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: fixture.repo, structureSet: structureSet(fixture.baseline),
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_BASELINE_NOT_ANCESTOR');
});

test('realization用のcommit-only読取はdirty worktreeを証拠へ混ぜず無視できる', async (context) => {
  const fixture = await fixtureRepo(context);
  await writeFile(path.join(fixture.repo, 'realization-input.json'), '{"draft":true}\n');
  const provenance = collectTodoStructureGitProvenance({
    repoRoot: fixture.repo,
    structureSet: structureSet(fixture.baseline),
    requireClean: false,
  });
  assert.equal(provenance.head_sha, fixture.head);
  assert.equal(provenance.changesets.some(({ changes }) => (
    changes.some(({ path: changedPath }) => changedPath === 'realization-input.json')
  )), false);
});

test('shallow欠損とcommit上限をtypedに分類する', () => {
  const head = 'a'.repeat(40);
  const result = (status, stdout = '') => ({
    status, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0),
  });
  const shallowRun = ({ args }) => {
    if (args[0] === 'status') return result(0);
    if (args[0] === 'rev-parse' && args[1] === '--verify') return result(0, `${head}\n`);
    if (args[0] === 'cat-file') return result(128);
    if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return result(0, 'true\n');
    throw new Error(`unexpected: ${args.join(' ')}`);
  };
  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: '/repo', structureSet: structureSet('b'.repeat(40)), runGit: shallowRun,
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_BASELINE_SHALLOW');

  const commits = Array.from({ length: TODO_STRUCTURE_GIT_LIMITS.commits + 1 }, (_, index) => {
    const oid = index.toString(16).padStart(40, '0');
    return `${oid} ${'b'.repeat(40)}`;
  }).join('\n');
  const oversizedRun = ({ args }) => {
    if (args[0] === 'status') return result(0);
    if (args[0] === 'rev-parse') return result(0, `${head}\n`);
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return result(0);
    if (args[0] === 'rev-list') return result(0, `${commits}\n`);
    throw new Error(`unexpected: ${args.join(' ')}`);
  };
  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: '/repo', structureSet: structureSet('b'.repeat(40)), runGit: oversizedRun,
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_HISTORY_TOO_LARGE');
});

test('path件数と変更行量の巨大diffを別理由のtyped errorで止める', () => {
  const baseline = 'b'.repeat(40);
  const head = 'c'.repeat(40);
  const blob = 'd'.repeat(40);
  const result = (status, stdout = '') => ({
    status, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0),
  });
  const runFor = ({ raw, numstat }) => ({ args }) => {
    if (args[0] === 'status') return result(0);
    if (args[0] === 'rev-parse') return result(0, `${head}\n`);
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return result(0);
    if (args[0] === 'rev-list') return result(0, `${head} ${baseline}\n`);
    if (args[0] === 'log' && args.includes('--raw')) return result(0, raw);
    if (args[0] === 'log' && args.includes('--numstat')) return result(0, numstat);
    throw new Error(`unexpected: ${args.join(' ')}`);
  };
  const many = TODO_STRUCTURE_GIT_LIMITS.changes + 1;
  const paths = Array.from({ length: many }, (_, index) => `src/f-${String(index).padStart(4, '0')}.mjs`);
  const raw = `\x1e${head}\0\0\n${paths
    .map((entryPath) => `:000000 100644 ${'0'.repeat(40)} ${blob} A\0${entryPath}\0`).join('')}`;
  const numstat = `\x1e${head}\0\0\n${paths.map((entryPath) => `1\t0\t${entryPath}\0`).join('')}`;
  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: '/repo', structureSet: structureSet(baseline), runGit: runFor({ raw, numstat }),
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_DIFF_TOO_LARGE'
    && error.detail.reason === 'change_count_exceeds_limit');

  const onePath = 'src/huge.mjs';
  const oneRaw = `\x1e${head}\0\0\n:000000 100644 ${'0'.repeat(40)} ${blob} A\0${onePath}\0`;
  const oneNumstat = `\x1e${head}\0\0\n${TODO_STRUCTURE_GIT_LIMITS.changedLines + 1}\t0\t${onePath}\0`;
  assert.throws(() => collectTodoStructureGitProvenance({
    repoRoot: '/repo', structureSet: structureSet(baseline),
    runGit: runFor({ raw: oneRaw, numstat: oneNumstat }),
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_GIT_DIFF_TOO_LARGE'
    && error.detail.reason === 'changed_line_count_exceeds_limit');
});

function realization(set, commitOid, overrides = {}) {
  const value = {
    schema: TODO_STRUCTURE_REALIZATION_SCHEMA,
    project_id: set.project_id, plan_key: set.plan_key, plan_version: set.plan_version,
    task_id: 'task-1', sequence: 1, previous_digest: null,
    structure_set_digest: set.structure_set_digest,
    planned_digest: digestTodoStructureTransform(set.tasks[0].planned),
    head_sha: commitOid, commit_oids: [commitOid], realized: structuredClone(set.tasks[0].planned),
    supersedes: null,
    actor: { host: 'MS-A2', session: 'codex-1', agent: 'bell' },
    recorded_at: '2026-08-11T14:00:00.000Z', realization_digest: '',
    ...overrides,
  };
  value.realization_digest = todoSelfDigest(value, 'realization_digest');
  return value;
}

test('realizationの明示commitだけをchangeset digestへ束縛しmessage推定しない', async (context) => {
  const fixture = await fixtureRepo(context);
  const set = structureSet(fixture.baseline);
  const provenance = collectTodoStructureGitProvenance({ repoRoot: fixture.repo, structureSet: set });
  const bound = bindTodoStructureRealizationCommits({
    provenance, realizations: [realization(set, fixture.first)],
  });
  assert.equal(bound[0].task_id, 'task-1');
  assert.equal(bound[0].commits[0].commit_oid, fixture.first);
  assert.equal(bound[0].commits[0].changeset_digest,
    provenance.changesets[0].changeset_digest);

  assert.throws(() => bindTodoStructureRealizationCommits({
    provenance, realizations: [realization(set, fixture.baseline)],
  }), (error) => error instanceof TodoStructureGitError
    && error.code === 'STRUCTURE_REALIZATION_COMMIT_UNREACHABLE');
});
