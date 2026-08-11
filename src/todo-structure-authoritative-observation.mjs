import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gitSpawnSync } from './git-process.mjs';
import { runSensorCli } from './sensor-cli.mjs';
import { collectTodoStructureGitProvenance } from './todo-structure-git-adapter.mjs';
import { collectTodoStructureSourceEvidence } from './todo-structure-source-adapter.mjs';

const SHA = /^[0-9a-f]{40}$/u;

export class TodoStructureObservationError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoStructureObservationError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail = {}) {
  throw new TodoStructureObservationError(code, reason, detail);
}

function git({ cwd, args, operation }) {
  const result = gitSpawnSync(args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    fail('STRUCTURE_OBSERVATION_GIT_FAILED', 'observation_git_command_failed', {
      operation, status: result.status ?? null, signal: result.signal ?? null,
      cause: result.error?.message ?? null,
    });
  }
  return result.stdout.trim();
}

function memoryStream() {
  let value = '';
  return {
    stream: { write: (chunk) => { value += String(chunk); } },
    read: () => value,
  };
}

async function initializeObservationSensor(observationRoot) {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const status = await runSensorCli({
    argv: ['init', observationRoot, '--json'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  if (status !== 0) {
    let diagnostic = null;
    try {
      const parsed = JSON.parse(stderr.read().trim());
      diagnostic = {
        code: typeof parsed?.code === 'string' ? parsed.code : null,
        detail: parsed?.detail ?? null,
      };
    } catch {
      diagnostic = { code: null, detail: null };
    }
    fail('STRUCTURE_OBSERVATION_SENSOR_INIT_FAILED', 'observation_sensor_init_failed', {
      sensor_error: diagnostic,
    });
  }
}

function errorSummary(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 管理repoのdirtyなindex／worktreeを一切観測せず、current HEADだけを一時detached worktreeへ
 * 展開してGit来歴とsource graphを収集する。store／planned source／artifactの読書きは呼出側が
 * 管理repoで行うため、ここへは持ち込まない。
 */
export async function collectTodoStructureAuthoritativeObservation({
  repoRoot, structureSet, effectiveTransforms = null,
  initializeSensor = initializeObservationSensor,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0
    || structureSet === null || typeof structureSet !== 'object'
    || typeof initializeSensor !== 'function') {
    fail('STRUCTURE_OBSERVATION_INPUT_INVALID', 'observation_input_invalid');
  }

  const headSha = git({
    cwd: repoRoot, args: ['rev-parse', '--verify', 'HEAD^{commit}'], operation: 'resolve_head',
  });
  if (!SHA.test(headSha)) fail('STRUCTURE_OBSERVATION_HEAD_INVALID', 'observation_head_invalid');

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-structure-observation-'));
  const observationRoot = path.join(temporaryRoot, 'worktree');
  let registered = false;
  let operationError = null;
  let result;
  try {
    git({
      cwd: repoRoot,
      args: ['worktree', 'add', '--detach', '--quiet', observationRoot, headSha],
      operation: 'worktree_add',
    });
    registered = true;
    const observedHead = git({
      cwd: observationRoot, args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      operation: 'verify_observation_head',
    });
    if (observedHead !== headSha) {
      fail('STRUCTURE_OBSERVATION_HEAD_MISMATCH', 'observation_head_mismatch', {
        expected_head_sha: headSha, actual_head_sha: observedHead,
      });
    }

    // sensor DBを作る前にclean treeをGit provenanceへ束縛する。sensorの一時fileは証拠対象外で、
    // source projection収集後にworktreeごと破棄する。
    const gitProvenance = collectTodoStructureGitProvenance({
      repoRoot: observationRoot, structureSet,
    });
    await initializeSensor(observationRoot);
    const sourceEvidence = await collectTodoStructureSourceEvidence({
      cwd: observationRoot, structureSet, effectiveTransforms,
    });
    result = {
      head_sha: headSha,
      git_provenance: gitProvenance,
      source_evidence: sourceEvidence,
    };
  } catch (error) {
    operationError = error;
  }

  let cleanupError = null;
  try {
    if (registered) {
      git({
        cwd: repoRoot,
        args: ['worktree', 'remove', '--force', observationRoot],
        operation: 'worktree_remove',
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }

  if (cleanupError !== null) {
    fail('STRUCTURE_OBSERVATION_CLEANUP_FAILED', 'observation_cleanup_failed', {
      operation_error: operationError === null ? null : errorSummary(operationError),
      cleanup_error: errorSummary(cleanupError),
      observation_root: observationRoot,
    });
  }
  if (operationError !== null) throw operationError;
  return result;
}
