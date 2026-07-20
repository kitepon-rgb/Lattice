import { execFileSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalizeTodoArtifact,
  exactRecord,
  isStrictTodoTimestamp,
  isTodoDigest,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
} from './todo-contracts.mjs';
import { projectTodoStatus } from './todo-status.mjs';
import {
  buildTodoPlan,
  createTodoStoreWriter,
  initializeAuthoredTodoStore,
  readTodoStore,
  TodoStoreError,
} from './todo-store.mjs';

const STORE_REF = '.lattice/todo';
const MANIFEST_REF = `${STORE_REF}/manifest.json`;
const MAX_INPUT_BYTES = 8_388_608;
const STATUS_SCHEMA = 'lattice.project_status.v1';
const CREATE_INPUT_SCHEMA = 'lattice.plan_create_input.v1';
const PHASE_CREATE_INPUT_SCHEMA = 'lattice.plan_create_input.v2';
const DECOUPLED_PHASE_CREATE_INPUT_SCHEMA = 'lattice.plan_create_input.v3';
const CURRENT_CREATE_INPUT_SCHEMA = DECOUPLED_PHASE_CREATE_INPUT_SCHEMA;
const CURRENT_CREATE_SCHEMA_COMMAND = 'lattice plan create --schema-version 3 --json';
const CREATE_RESULT_SCHEMA = 'lattice.plan_create_result.v1';

function resolveRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\r?\n$/u, '');
  } catch {
    return null;
  }
}

function gitHead(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\r?\n$/u, '');
  } catch {
    return null;
  }
}

function resultDigest(value) {
  return todoSelfDigest(value, 'result_digest');
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateProjectStatus(value) {
  try {
    if (!exactRecord(value, [
      'schema', 'cli', 'project', 'state', 'store', 'active_plans', 'active_runs',
      'can_create_plan', 'next_action', 'result_digest',
    ]) || value.schema !== STATUS_SCHEMA
      || !exactRecord(value.cli, ['available', 'version']) || value.cli.available !== true
      || typeof value.cli.version !== 'string' || value.cli.version.length > 64
      || !['uninitialized', 'ready', 'active_run', 'invalid'].includes(value.state)
      || !exactRecord(value.store, ['ref', 'absolute_path']) || value.store.ref !== STORE_REF
      || (value.store.absolute_path !== null && typeof value.store.absolute_path !== 'string')
      || !Array.isArray(value.active_plans) || value.active_plans.length > 256
      || !value.active_plans.every((entry) => exactRecord(entry, ['plan_key', 'plan_version'])
        && isTodoIdentifier(entry.plan_key) && isTodoIdentifier(entry.plan_version))
      || !Array.isArray(value.active_runs) || value.active_runs.length > 2_000
      || !value.active_runs.every((entry) => exactRecord(entry, ['plan_key', 'task_id', 'label'])
        && isTodoIdentifier(entry.plan_key) && isTodoIdentifier(entry.task_id)
        && typeof entry.label === 'string' && [...entry.label].length > 0 && [...entry.label].length <= 160)
      || typeof value.can_create_plan !== 'boolean' || !plain(value.next_action)
      || typeof value.next_action.command !== 'string' || value.next_action.command.length === 0
      || !isTodoDigest(value.result_digest) || value.result_digest !== resultDigest(value)) return false;
    if (value.project !== null && (!exactRecord(value.project, ['root', 'git_head', 'project_id'])
      || typeof value.project.root !== 'string' || value.project.root.length === 0
      || (value.project.git_head !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.project.git_head))
      || (value.project.project_id !== null && !isTodoIdentifier(value.project.project_id)))) return false;
    if (value.state === 'uninitialized') {
      return value.project !== null && value.project.project_id === null && value.can_create_plan === true
        && exactRecord(value.next_action, ['command', 'input_schema', 'schema_command'])
        && value.next_action.input_schema === CURRENT_CREATE_INPUT_SCHEMA
        && value.next_action.schema_command === CURRENT_CREATE_SCHEMA_COMMAND;
    }
    if (value.state === 'invalid') {
      return value.can_create_plan === false && exactRecord(value.next_action, ['command', 'reason'])
        && typeof value.next_action.reason === 'string' && value.next_action.reason.length > 0;
    }
    return value.project !== null && isTodoIdentifier(value.project.project_id)
      && value.can_create_plan === false && exactRecord(value.next_action, ['command', 'reason'])
      && typeof value.next_action.reason === 'string' && value.next_action.reason.length > 0
      && (value.state !== 'active_run' || value.active_runs.length > 0)
      && (value.state !== 'ready' || value.active_runs.length === 0);
  } catch { return false; }
}

function statusResult(fields) {
  const result = { schema: STATUS_SCHEMA, ...fields, result_digest: '' };
  result.result_digest = resultDigest(result);
  if (!validateProjectStatus(result)) throw new TypeError('project status result contract invalid');
  return result;
}

function invalidStatus({ cliVersion, repoRoot, reason }) {
  return statusResult({
    cli: { available: true, version: cliVersion },
    project: repoRoot === null ? null : { root: repoRoot, git_head: gitHead(repoRoot), project_id: null },
    state: 'invalid',
    store: { ref: STORE_REF, absolute_path: repoRoot === null ? null : path.join(repoRoot, STORE_REF) },
    active_plans: [], active_runs: [], can_create_plan: false,
    next_action: { command: repoRoot === null ? 'git status' : 'lattice todo verify', reason },
  });
}

export async function runProjectStatus({ cwd, stdout, cliVersion }) {
  const repoRoot = resolveRepoRoot(cwd);
  if (repoRoot === null) {
    stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason: 'git_repository_unresolved' }))}\n`);
    return 1;
  }
  const storeAbsolute = path.join(repoRoot, STORE_REF);
  const manifestAbsolute = path.join(repoRoot, MANIFEST_REF);
  const latticeAbsolute = path.join(repoRoot, '.lattice');
  let latticeState;
  let storeState;
  let manifestState;
  try { latticeState = await lstat(latticeAbsolute); } catch (error) {
    if (error?.code !== 'ENOENT') {
      stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason: 'lattice_root_unreadable' }))}\n`);
      return 1;
    }
  }
  if (latticeState !== undefined && (latticeState.isSymbolicLink() || !latticeState.isDirectory())) {
    stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason: 'lattice_root_invalid' }))}\n`);
    return 1;
  }
  try { storeState = await lstat(storeAbsolute); } catch (error) {
    if (error?.code !== 'ENOENT') {
      stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason: 'store_unreadable' }))}\n`);
      return 1;
    }
  }
  try { manifestState = await lstat(manifestAbsolute); } catch (error) {
    if (error?.code !== 'ENOENT') {
      stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason: 'manifest_unreadable' }))}\n`);
      return 1;
    }
  }
  if (storeState === undefined && manifestState === undefined) {
    const result = statusResult({
      cli: { available: true, version: cliVersion },
      project: { root: repoRoot, git_head: gitHead(repoRoot), project_id: null },
      state: 'uninitialized',
      store: { ref: STORE_REF, absolute_path: storeAbsolute },
      active_plans: [], active_runs: [], can_create_plan: true,
      next_action: {
        command: 'lattice plan create --input .lattice/plan-create.json',
        input_schema: CURRENT_CREATE_INPUT_SCHEMA,
        schema_command: CURRENT_CREATE_SCHEMA_COMMAND,
      },
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (storeState?.isSymbolicLink() || !storeState?.isDirectory()
    || manifestState?.isSymbolicLink() || !manifestState?.isFile()) {
    stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason: 'store_layout_invalid' }))}\n`);
    return 1;
  }
  try {
    const store = await readTodoStore({ repoRoot });
    const todo = projectTodoStatus(store);
    const activeRuns = todo.active_set.map((entry) => ({
      plan_key: entry.plan_key, task_id: entry.task_id, label: entry.label,
    }));
    const state = activeRuns.length > 0 ? 'active_run' : 'ready';
    const next = activeRuns.length > 0
      ? { command: 'lattice todo status', reason: 'active_run_present' }
      : todo.next_ready.length > 0
        ? { command: `lattice todo start --plan ${todo.next_ready[0].plan_key} --task ${todo.next_ready[0].task_id}`,
          reason: 'next_ready_present' }
        : { command: 'lattice todo status', reason: 'no_ready_task' };
    const result = statusResult({
      cli: { available: true, version: cliVersion },
      project: { root: repoRoot, git_head: gitHead(repoRoot), project_id: store.project_id },
      state,
      store: { ref: STORE_REF, absolute_path: storeAbsolute },
      active_plans: todo.member_heads.map((entry) => ({
        plan_key: entry.plan_key, plan_version: entry.plan_version,
      })),
      active_runs: activeRuns,
      can_create_plan: false,
      next_action: next,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const reason = error instanceof TodoStoreError ? `${error.code}:${error.detail?.reason ?? error.message}` : 'store_validation_failed';
    stdout.write(`${JSON.stringify(invalidStatus({ cliVersion, repoRoot, reason }))}\n`);
    return 1;
  }
}

async function readCanonicalInput(repoRoot, inputRef) {
  if (!isTodoRef(inputRef)) throw new TodoStoreError('INPUT_INVALID', 'input_ref_invalid');
  const root = await realpath(repoRoot);
  const absolute = path.resolve(root, inputRef);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new TodoStoreError('INPUT_INVALID', 'input_outside_repo');
  let cursor = root;
  try {
    for (const part of path.relative(root, absolute).split(path.sep)) {
      cursor = path.join(cursor, part);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) throw new TodoStoreError('INPUT_INVALID', 'input_path_symlink');
    }
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    throw new TodoStoreError('INPUT_INVALID', 'input_unreadable');
  }
  const state = await lstat(absolute);
  if (!state.isFile() || await realpath(absolute) !== absolute) {
    throw new TodoStoreError('INPUT_INVALID', 'input_path_invalid');
  }
  if (state.size > MAX_INPUT_BYTES) throw new TodoStoreError('INPUT_INVALID', 'input_too_large');
  let handle;
  let bytes;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.dev !== state.dev || opened.ino !== state.ino || opened.size !== state.size
      || opened.mtimeMs !== state.mtimeMs || opened.ctimeMs !== state.ctimeMs || !opened.isFile()) {
      throw new TodoStoreError('INPUT_INVALID', 'input_changed_during_validation');
    }
    if (opened.size > MAX_INPUT_BYTES) throw new TodoStoreError('INPUT_INVALID', 'input_too_large');
    const capture = Buffer.allocUnsafe(MAX_INPUT_BYTES + 1);
    let captured = 0;
    while (captured < capture.length) {
      const { bytesRead } = await handle.read(capture, captured, capture.length - captured, null);
      if (bytesRead === 0) break;
      captured += bytesRead;
    }
    if (captured > MAX_INPUT_BYTES) throw new TodoStoreError('INPUT_INVALID', 'input_too_large');
    bytes = capture.subarray(0, captured);
    const after = await lstat(absolute);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || await realpath(absolute) !== absolute) {
      throw new TodoStoreError('INPUT_INVALID', 'input_changed_during_validation');
    }
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    throw new TodoStoreError('INPUT_INVALID', 'input_unreadable');
  } finally {
    await handle?.close();
  }
  if (bytes.length > MAX_INPUT_BYTES) throw new TodoStoreError('INPUT_INVALID', 'input_too_large');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new TodoStoreError('INPUT_INVALID', 'input_utf8_invalid'); }
  if (!text.endsWith('\n') || text.includes('\r') || text.slice(0, -1).includes('\n')) {
    throw new TodoStoreError('INPUT_INVALID', 'input_bytes_noncanonical');
  }
  let value;
  try { value = JSON.parse(text.slice(0, -1)); } catch { throw new TodoStoreError('INPUT_INVALID', 'input_json_invalid'); }
  if (`${canonicalizeTodoArtifact(value)}\n` !== text) throw new TodoStoreError('INPUT_INVALID', 'input_bytes_noncanonical');
  return value;
}

function validateCreateInput(value) {
  const phaseInput = [PHASE_CREATE_INPUT_SCHEMA, DECOUPLED_PHASE_CREATE_INPUT_SCHEMA].includes(value?.schema);
  const decoupledPhaseInput = value?.schema === DECOUPLED_PHASE_CREATE_INPUT_SCHEMA;
  const keys = [
    'schema', 'project_id', 'plan_key', 'plan_version', 'actor', 'recorded_at',
    'tasks', 'hard_dependencies', 'joins', 'input_digest',
  ];
  if (phaseInput) keys.push('phases');
  if (decoupledPhaseInput) keys.push('phase_accept_dependencies');
  if (!exactRecord(value, keys) || ![
    CREATE_INPUT_SCHEMA, PHASE_CREATE_INPUT_SCHEMA, DECOUPLED_PHASE_CREATE_INPUT_SCHEMA,
  ].includes(value.schema)
    || !isTodoIdentifier(value.project_id)
    || !isTodoIdentifier(value.plan_key) || !isTodoIdentifier(value.plan_version)
    || !exactRecord(value.actor, ['host', 'session', 'agent'])
    || ![value.actor.host, value.actor.session, value.actor.agent].every(isTodoIdentifier)
    || !isStrictTodoTimestamp(value.recorded_at) || !isTodoDigest(value.input_digest)
    || value.input_digest !== todoSelfDigest(value, 'input_digest')
    || !Array.isArray(value.tasks)
    || value.tasks.some((task) => task?.narrative_anchor !== null || task?.compile_binding !== null)) return false;
  try {
    buildTodoPlan({
      schema: decoupledPhaseInput ? 'lattice.todo_plan.v5'
        : phaseInput ? 'lattice.todo_plan.v4' : 'lattice.todo_plan.v3', project_id: value.project_id,
      plan_key: value.plan_key, plan_version: value.plan_version,
      predecessor_plan_digest: null, tasks: value.tasks,
      hard_dependencies: value.hard_dependencies, joins: value.joins,
      ...(phaseInput ? { phases: value.phases } : {}),
      ...(decoupledPhaseInput ? { phase_accept_dependencies: value.phase_accept_dependencies } : {}),
    });
    return true;
  } catch { return false; }
}

export async function runPlanCreate({ cwd, inputRef, stdout }) {
  const repoRoot = resolveRepoRoot(cwd);
  if (repoRoot === null) throw new TodoStoreError('REPO_UNRESOLVED', 'git_toplevel_unresolved');
  const input = await readCanonicalInput(repoRoot, inputRef);
  if (!validateCreateInput(input)) throw new TodoStoreError('INPUT_INVALID', 'plan_create_schema_invalid');
  const store = await initializeAuthoredTodoStore({
    repoRoot, writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    projectId: input.project_id, repositories: [{ repo_id: 'self', path: '.' }],
    plan: {
      schema: input.schema === DECOUPLED_PHASE_CREATE_INPUT_SCHEMA ? 'lattice.todo_plan.v5'
        : input.schema === PHASE_CREATE_INPUT_SCHEMA
          ? 'lattice.todo_plan.v4' : 'lattice.todo_plan.v3', project_id: input.project_id,
      plan_key: input.plan_key, plan_version: input.plan_version,
      predecessor_plan_digest: null, tasks: input.tasks,
      hard_dependencies: input.hard_dependencies, joins: input.joins,
      ...(input.schema === PHASE_CREATE_INPUT_SCHEMA
        || input.schema === DECOUPLED_PHASE_CREATE_INPUT_SCHEMA ? { phases: input.phases } : {}),
      ...(input.schema === DECOUPLED_PHASE_CREATE_INPUT_SCHEMA
        ? { phase_accept_dependencies: input.phase_accept_dependencies } : {}),
    },
    genesis: { actor: input.actor, recorded_at: input.recorded_at, provenance: null },
  });
  const member = store.members[0];
  const result = {
    schema: CREATE_RESULT_SCHEMA, project_id: store.project_id,
    plan_key: member.plan.plan_key, plan_version: member.plan.plan_version,
    store_ref: STORE_REF, plan_ref: member.descriptor.plan_ref,
    journal_ref: member.descriptor.journal_ref, snapshot_ref: member.descriptor.snapshot_ref,
    plan_digest: member.plan.plan_digest, result_digest: '',
  };
  result.result_digest = resultDigest(result);
  stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

export async function runPlanCreateSchema({ stdout, version = 1 }) {
  if (![1, 2, 3].includes(version)) throw new TypeError('unsupported plan create schema version');
  const expected = version === 3 ? DECOUPLED_PHASE_CREATE_INPUT_SCHEMA
    : version === 2 ? PHASE_CREATE_INPUT_SCHEMA : CREATE_INPUT_SCHEMA;
  const schemaUrl = new URL(`../docs/schemas/lattice.plan_create_input.v${version}.schema.json`, import.meta.url);
  const handle = await open(schemaUrl, fsConstants.O_RDONLY);
  try {
    const schema = JSON.parse(await handle.readFile('utf8'));
    if (schema?.title !== expected) throw new TypeError('bundled plan create schema invalid');
    stdout.write(`${JSON.stringify(schema)}\n`);
    return 0;
  } finally {
    await handle.close();
  }
}

export function projectStatusFailure({ cwd, stdout, cliVersion, error }) {
  const result = invalidStatus({
    cliVersion, repoRoot: resolveRepoRoot(cwd),
    reason: `status_internal_failure:${error?.constructor?.name ?? 'Error'}`,
  });
  stdout.write(`${JSON.stringify(result)}\n`);
  return 1;
}

export function projectCliFailure(stderr, error) {
  const payload = {
    schema: 'lattice.cli_error.v2', code: error?.code ?? 'INTERNAL_FAILURE',
    message: error?.message ?? 'project command failed',
  };
  if (error?.detail && Object.keys(error.detail).length > 0) payload.detail = error.detail;
  stderr.write(`${JSON.stringify(payload)}\n`);
  return 1;
}
