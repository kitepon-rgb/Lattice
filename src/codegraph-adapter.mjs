import { spawn } from 'node:child_process';

const OPERATIONS = new Set(['status', 'query', 'callers', 'callees', 'impact', 'affected']);
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value) {
  return value.replace(ANSI_ESCAPE, '');
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function outcomeFromStatus(status) {
  if (status.initialized === false) {
    return 'absent';
  }

  const version = status.version;
  if (typeof version !== 'string' || version.length === 0) {
    return 'unsupported';
  }

  if (status.initialized !== true
    || !isPlainObject(status.pendingChanges)
    || !hasExactKeys(status.pendingChanges, ['added', 'modified', 'removed'])
    || !Object.values(status.pendingChanges).every(isNonNegativeInteger)
    || !isPlainObject(status.index)
    || !hasExactKeys(status.index, [
      'builtWithVersion',
      'builtWithExtractionVersion',
      'currentExtractionVersion',
      'reindexRecommended',
      'state',
      'pendingRefs',
    ])
    || typeof status.index.builtWithVersion !== 'string'
    || status.index.builtWithVersion.length === 0
    || !isNonNegativeInteger(status.index.builtWithExtractionVersion)
    || !isNonNegativeInteger(status.index.currentExtractionVersion)
    || typeof status.index.state !== 'string'
    || typeof status.index.reindexRecommended !== 'boolean'
    || !isNonNegativeInteger(status.index.pendingRefs)
    || (status.worktreeMismatch !== null && !isPlainObject(status.worktreeMismatch))) {
    return 'unresolved';
  }

  if (status.index.state === 'unsupported') {
    return 'unsupported';
  }

  const pendingTotal = status.pendingChanges.added
    + status.pendingChanges.modified
    + status.pendingChanges.removed;
  if (pendingTotal > 0 || status.worktreeMismatch !== null || status.index.reindexRecommended) {
    return 'stale';
  }

  if (status.index.pendingRefs !== 0 || status.index.state !== 'complete') {
    return 'unresolved';
  }

  return 'ready';
}

function parseJson(stdout) {
  try {
    return { value: JSON.parse(stdout) };
  } catch {
    return { value: undefined };
  }
}

function isExactSymbolAbsent(stdout, target) {
  return stripAnsi(stdout).trim() === `ℹ Symbol "${target}" not found`;
}

function exactSymbolCandidates(value, target) {
  if (!Array.isArray(value)) {
    return { outcome: 'invalid_json', candidates: [] };
  }
  const candidates = value.filter((entry) => {
    const node = entry?.node;
    return isPlainObject(node)
      && (node.name === target || node.qualifiedName === target);
  });
  return {
    outcome: candidates.length > 0 ? 'ready' : 'symbol_absent',
    candidates,
  };
}

function summarizeAffected(targets) {
  if (targets.every(({ outcome }) => outcome === 'ready')) {
    return 'ready';
  }
  if (targets.every(({ outcome }) => outcome === 'empty')) {
    return 'empty';
  }
  return 'unresolved';
}

function defaultExecutor({ args, cwd }) {
  return new Promise((resolve) => {
    const child = spawn('codegraph', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function executeCommand(execute, command) {
  try {
    const result = await execute(command);
    if (!result || typeof result !== 'object') {
      return { code: null, stdout: '', stderr: '', error: 'invalid executor result' };
    }
    return {
      code: result.code,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      error: result.error,
    };
  } catch (error) {
    return {
      code: null,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveExactSymbol({ cwd, target, execute }) {
  const result = await executeCommand(execute, {
    operation: 'query',
    target,
    cwd,
    args: ['query', target, '--path', '.', '--json'],
  });
  if (result.code !== 0) {
    return { outcome: 'command_failure', exitCode: result.code };
  }
  const parsed = parseJson(result.stdout);
  if (parsed.value === undefined) {
    return {
      outcome: isExactSymbolAbsent(result.stdout, target) ? 'symbol_absent' : 'invalid_json',
    };
  }
  return exactSymbolCandidates(parsed.value, target);
}

async function collectOne({ cwd, query, execute }) {
  const { id, operation, target } = query;
  if (!OPERATIONS.has(operation)) {
    return { id, operation, outcome: 'unsupported' };
  }

  if (operation === 'affected') {
    const targets = Array.isArray(query.targets) ? query.targets : [target];
    if (targets.length === 0 || targets.some((value) => typeof value !== 'string' || value.length === 0)) {
      return { id, operation, outcome: 'unresolved' };
    }

    const results = [];
    for (const path of targets) {
      const command = {
        operation,
        target: path,
        cwd,
        args: ['affected', path, '--path', '.', '--json'],
      };
      const result = await executeCommand(execute, command);
      if (result.code !== 0) {
        results.push({ target: path, outcome: 'command_failure', exitCode: result.code });
        continue;
      }
      const parsed = parseJson(result.stdout);
      if (parsed.value === undefined || !parsed.value || !Array.isArray(parsed.value.affectedTests)) {
        results.push({ target: path, outcome: 'invalid_json' });
        continue;
      }
      results.push({
        target: path,
        outcome: parsed.value.affectedTests.length === 0 ? 'empty' : 'ready',
        data: parsed.value,
      });
    }
    return { id, operation, outcome: summarizeAffected(results), targets: results };
  }

  if (operation !== 'status' && (typeof target !== 'string' || target.length === 0)) {
    return { id, operation, outcome: 'unresolved' };
  }

  const command = {
    operation,
    target,
    cwd,
    args: operation === 'status'
      ? ['status', '.', '--json']
      : [operation, target, '--path', '.', '--json'],
  };
  const result = await executeCommand(execute, command);
  if (result.code !== 0) {
    return { id, operation, outcome: 'command_failure', exitCode: result.code };
  }

  const parsed = parseJson(result.stdout);
  if (parsed.value === undefined) {
    if (operation !== 'status' && isExactSymbolAbsent(result.stdout, target)) {
      return { id, operation, target, outcome: 'symbol_absent' };
    }
    return { id, operation, target, outcome: 'invalid_json' };
  }

  if (operation === 'status') {
    if (!parsed.value || Array.isArray(parsed.value) || typeof parsed.value !== 'object') {
      return { id, operation, outcome: 'invalid_json' };
    }
    return { id, operation, outcome: outcomeFromStatus(parsed.value), data: parsed.value };
  }

  if (operation === 'query') {
    const resolution = exactSymbolCandidates(parsed.value, target);
    return {
      id,
      operation,
      target,
      outcome: resolution.outcome,
      data: parsed.value,
    };
  }

  const resolution = await resolveExactSymbol({ cwd, target, execute });
  if (resolution.outcome !== 'ready') {
    return {
      id,
      operation,
      target,
      outcome: resolution.outcome,
      ...(resolution.exitCode === undefined ? {} : { exitCode: resolution.exitCode }),
    };
  }

  return {
    id,
    operation,
    target,
    outcome: 'ready',
    data: parsed.value,
    resolution: resolution.candidates,
  };
}

/**
 * Collects Codegraph CLI evidence without turning command failures or empty results into independence.
 * @param {{ cwd: string, querySet: { queries?: object[] }, execute?: Function }} options
 * @returns {Promise<{ cwd: string, outcomes: object[] }>}
 */
export async function collectCodegraphEvidence({ cwd, querySet, execute = defaultExecutor } = {}) {
  const queries = Array.isArray(querySet?.queries) ? querySet.queries : [];
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { cwd, outcomes: [{ outcome: 'unresolved', reason: 'invalid_cwd' }] };
  }
  if (!Array.isArray(querySet?.queries)) {
    return { cwd, outcomes: [{ outcome: 'unresolved', reason: 'invalid_query_set' }] };
  }

  const outcomes = [];
  for (const query of queries) {
    if (!query || typeof query !== 'object') {
      outcomes.push({ outcome: 'unresolved', reason: 'invalid_query' });
      continue;
    }
    outcomes.push(await collectOne({ cwd, query, execute }));
  }
  return { cwd, outcomes };
}
