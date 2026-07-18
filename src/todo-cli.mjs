import { execFileSync } from 'node:child_process';

import { isTodoIdentifier, todoSelfDigest } from './todo-contracts.mjs';
import {
  TodoStoreError,
  readTodoStore,
  rebuildTodoSnapshot,
} from './todo-store.mjs';

const CLI_ERROR_SCHEMA = 'lattice.cli_error.v2';

function usageFailure(stderr, argv) {
  const received = argv.length === 0 ? '(none)' : argv.join(' ').replace(/[\r\n]/gu, ' ');
  stderr.write(`lattice todo: unsupported command or arguments: ${received}\n`);
  return 2;
}

function typedFailure(stderr, error) {
  const payload = {
    schema: CLI_ERROR_SCHEMA,
    code: error.code,
    message: error.message,
  };
  if (error.detail !== null && typeof error.detail === 'object'
    && !Array.isArray(error.detail) && Object.keys(error.detail).length > 0) {
    payload.detail = error.detail;
  }
  stderr.write(`${JSON.stringify(payload)}\n`);
  return 1;
}

function resolveRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new TodoStoreError('REPO_UNRESOLVED', 'git_toplevel_unresolved', 'cwdのgit toplevelを解決できない');
  }
}

function selectMembers(store, requestedPlanKey) {
  if (requestedPlanKey === null) return store.members;
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === requestedPlanKey);
  if (member === undefined) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active');
  }
  return [member];
}

async function verify({ repoRoot, requestedPlanKey }) {
  const store = await readTodoStore({ repoRoot });
  const members = selectMembers(store, requestedPlanKey);
  for (const member of members) {
    const unverified = member.tasks.find((task) => task.evidence_unverified);
    if (unverified !== undefined) {
      throw new TodoStoreError('STORE_INCONSISTENT', 'evidence_unverified', 'evidence_unverified', {
        plan_key: member.descriptor.plan_key,
        task_id: unverified.task_id,
      });
    }
  }
  const verifiedMembers = members.map((member) => ({
    plan_key: member.descriptor.plan_key,
    topology_digest: member.plan.topology_digest,
    journal_head_digest: member.journal.events.at(-1).event_digest,
    through_sequence: member.journal.events.at(-1).sequence,
    snapshot_stale: member.snapshot_stale,
  }));
  const result = {
    schema: 'lattice.todo_verify_result.v1',
    project_id: store.project_id,
    requested_plan_key: requestedPlanKey,
    verified_members: verifiedMembers,
    snapshot_stale: verifiedMembers.some((member) => member.snapshot_stale),
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function rebuildSnapshot({ repoRoot, planKey }) {
  // Read first so every typed validation failure happens before the rebuild writer is entered.
  const store = await readTodoStore({ repoRoot });
  const [member] = selectMembers(store, planKey);
  const snapshot = await rebuildTodoSnapshot({ repoRoot, planKey });
  const result = {
    schema: 'lattice.todo_snapshot_result.v1',
    project_id: store.project_id,
    plan_key: planKey,
    snapshot_ref: member.descriptor.snapshot_ref,
    through_sequence: snapshot.through_sequence,
    journal_head_digest: snapshot.journal_head_digest,
    snapshot_digest: snapshot.snapshot_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

/**
 * `lattice todo` namespace. Exact position, order, and argument count are part of
 * the public contract; usage failures never use a JSON envelope.
 */
export async function runTodoCli({ argv, cwd, stdout, stderr }) {
  if (!Array.isArray(argv) || typeof cwd !== 'string'
    || typeof stdout?.write !== 'function' || typeof stderr?.write !== 'function') {
    throw new TypeError('runTodoCli optionsが不正');
  }

  let action = null;
  if (argv.length === 1 && argv[0] === 'verify') {
    action = (repoRoot) => verify({ repoRoot, requestedPlanKey: null });
  } else if (argv.length === 3 && argv[0] === 'verify' && argv[1] === '--plan'
    && isTodoIdentifier(argv[2])) {
    action = (repoRoot) => verify({ repoRoot, requestedPlanKey: argv[2] });
  } else if (argv.length === 4 && argv[0] === 'snapshot' && argv[1] === '--rebuild'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])) {
    action = (repoRoot) => rebuildSnapshot({ repoRoot, planKey: argv[3] });
  }
  if (action === null) return usageFailure(stderr, argv);

  try {
    const result = await action(resolveRepoRoot(cwd));
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof TodoStoreError) return typedFailure(stderr, error);
    if (error instanceof TypeError) {
      return typedFailure(stderr, {
        code: 'CONTRACT_VIOLATION',
        message: error.message,
      });
    }
    return typedFailure(stderr, {
      code: 'INTERNAL_FAILURE',
      message: error?.constructor?.name ?? 'Error',
    });
  }
}
