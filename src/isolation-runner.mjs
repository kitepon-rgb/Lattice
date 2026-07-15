import { lstat, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args, { cwd, allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const result = { code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (allowExitCodes.includes(code) && signal === null) resolve(result);
      else reject(Object.assign(new Error(`${command} failed (${signal ?? code}): ${result.stderr.toString('utf8').trim()}`), result));
    });
  });
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !path.posix.isAbsolute(value)
    && value === path.posix.normalize(value)
    && !value.split('/').includes('..');
}

function isAllowed(changedPath, allowedPaths) {
  return allowedPaths.some((allowedPath) => changedPath === allowedPath || changedPath.startsWith(`${allowedPath}/`));
}

function statusPaths(status) {
  const fields = status.toString('utf8').split('\0');
  const paths = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (code[0] === 'R' || code[0] === 'C') paths.push(fields[++index]);
  }
  return [...new Set(paths)].sort();
}

async function rejectUnsafeEntry(worktreePath, baseSha, changedPath) {
  const segments = changedPath.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const candidate = path.join(worktreePath, ...segments.slice(0, index));
    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) throw new Error(`symlink change is not allowed: ${changedPath}`);
      if (index === segments.length && !stat.isFile()) throw new Error(`special file change is not allowed: ${changedPath}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const tree = await run('git', ['ls-tree', '-z', baseSha, '--', changedPath], { cwd: worktreePath });
  if (tree.stdout.length > 0) {
    const mode = tree.stdout.toString('utf8').slice(0, 6);
    if (mode === '120000') throw new Error(`symlink change is not allowed: ${changedPath}`);
    if (mode === '160000') throw new Error(`submodule change is not allowed: ${changedPath}`);
    if (mode !== '100644' && mode !== '100755') throw new Error(`special file change is not allowed: ${changedPath}`);
  }
}

async function buildPatch(worktreePath, changedPaths) {
  const tracked = await run('git', ['diff', '--binary', 'HEAD'], { cwd: worktreePath });
  const parts = [tracked.stdout];
  for (const changedPath of changedPaths) {
    const trackedPath = await run('git', ['ls-files', '--error-unmatch', '--', changedPath], {
      cwd: worktreePath,
      allowExitCodes: [0, 1],
    });
    if (trackedPath.code === 0) continue;
    const added = await run('git', ['diff', '--binary', '--no-index', '--', '/dev/null', changedPath], {
      cwd: worktreePath,
      allowExitCodes: [0, 1],
    });
    if (added.stdout.length > 0) parts.push(added.stdout);
  }
  return Buffer.concat(parts);
}

async function captureSnapshot(worktreePath, baseSha, allowedPaths) {
  const changedPaths = statusPaths((await run('git', [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
  ], { cwd: worktreePath })).stdout);
  for (const changedPath of changedPaths) {
    if (!safeRelativePath(changedPath) || !isAllowed(changedPath, allowedPaths)) {
      throw new Error(`change outside allowed paths: ${changedPath}`);
    }
    await rejectUnsafeEntry(worktreePath, baseSha, changedPath);
  }
  return { changedPaths, patch: await buildPatch(worktreePath, changedPaths) };
}

async function assertSnapshotUnchanged(worktreePath, baseSha, allowedPaths, expected, actor) {
  const actual = await captureSnapshot(worktreePath, baseSha, allowedPaths);
  if (actual.changedPaths.length !== expected.changedPaths.length
    || actual.changedPaths.some((changedPath, index) => changedPath !== expected.changedPaths[index])
    || !actual.patch.equals(expected.patch)) {
    throw new Error(`${actor} mutated isolated snapshot`);
  }
}

async function assertSourceUnchanged(repoRoot, sourceHead, sourceStatus) {
  const [head, status] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    run('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot }),
  ]);
  if (head.stdout.toString('utf8').trim() !== sourceHead || !status.stdout.equals(sourceStatus)) {
    throw new Error('source repository changed during isolated transform');
  }
}

export async function runIsolatedTransform({ repoRoot, baseRef, allowedPaths, transform, verifyCommands, observe } = {}) {
  if (!safeRelativePath('.') || typeof repoRoot !== 'string' || typeof baseRef !== 'string'
    || !Array.isArray(allowedPaths) || allowedPaths.some((entry) => !safeRelativePath(entry))
    || typeof transform !== 'function' || !Array.isArray(verifyCommands)
    || (observe !== undefined && typeof observe !== 'function')) {
    throw new TypeError('invalid isolated transform arguments');
  }

  const sourceHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.toString('utf8').trim();
  const sourceStatus = (await run('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot })).stdout;
  if (sourceStatus.length > 0) throw new Error('source repository must be clean');
  const baseSha = (await run('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: repoRoot })).stdout.toString('utf8').trim();
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'lattice-isolated-transform-'));
  let added = false;
  let primaryError;
  let result;
  try {
    await run('git', ['worktree', 'add', '--detach', worktreePath, baseSha], { cwd: repoRoot });
    added = true;
    await transform({ worktreePath });
    const snapshot = await captureSnapshot(worktreePath, baseSha, allowedPaths);
    for (const verifier of verifyCommands) {
      if (!verifier || typeof verifier.command !== 'string' || !Array.isArray(verifier.args) || verifier.args.some((arg) => typeof arg !== 'string')) {
        throw new TypeError('verifyCommands must contain command and string args');
      }
      try {
        await run(verifier.command, verifier.args, { cwd: worktreePath });
      } catch (error) {
        throw new Error(`verifier failed (${error.signal ?? error.code}): ${verifier.command}`);
      }
      await assertSnapshotUnchanged(worktreePath, baseSha, allowedPaths, snapshot, 'verifier');
    }
    if (observe) {
      await observe({ worktreePath, changedPaths: snapshot.changedPaths, patch: snapshot.patch, baseSha });
      await assertSnapshotUnchanged(worktreePath, baseSha, allowedPaths, snapshot, 'observe');
    }
    result = { baseSha, ...snapshot };
  } catch (error) {
    primaryError = error;
  }
  let cleanupError;
  try {
    if (added) await run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    await rm(worktreePath, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }
  let sourceInvariantError;
  try {
    await assertSourceUnchanged(repoRoot, sourceHead, sourceStatus);
  } catch (error) {
    sourceInvariantError = error;
  }
  const errors = [primaryError, cleanupError, sourceInvariantError].filter(Boolean);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'isolated transform failed; source repository changed or cleanup failed');
  return result;
}
