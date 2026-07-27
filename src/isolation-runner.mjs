import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  mkdir,
  readlink,
  rm,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

function run(command, args, { cwd, allowExitCodes = [0], env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env === undefined ? {} : { env }),
    });
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

function bufferDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

const PROTECTED_PATHS = Object.freeze(['src', 'test']);

function verificationReceipt(verifier, result, outcome) {
  const stdout = Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result?.stderr) ? result.stderr : Buffer.alloc(0);
  return {
    command: verifier.command,
    args: [...verifier.args],
    outcome,
    exit_code: Number.isSafeInteger(result?.code) && result.code >= 0 ? result.code : 1,
    stdout_digest: bufferDigest(stdout),
    stderr_digest: bufferDigest(stderr),
  };
}

function verifierEnvironment(extra = {}) {
  const env = { ...process.env, NO_COLOR: '1', ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  return env;
}

function isPlainStringRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
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

/**
 * mountのために作った親dirが1エントリで報告されたら、除外せず展開して子を同じ規律で見る。
 *
 * 親ごと除外すると、その中に現れた別の変更まで隠れる。runnerが張ったmountだけを外す規律を、
 * ディレクトリ単位の報告でも保つ。
 */
async function expandMountAncestors(worktreePath, paths, mountedEntries) {
  const isAncestor = (entry) => mountedEntries
    .some((mount) => mount.startsWith(`${entry}/`));
  const expanded = [];
  const pending = [...paths];
  while (pending.length > 0) {
    const current = pending.pop();
    const normalized = current.replace(/\/$/u, '');
    if (!current.endsWith('/') || !isAncestor(normalized)) { expanded.push(current); continue; }
    const children = await readdir(path.join(worktreePath, normalized), { withFileTypes: true });
    for (const child of children) {
      pending.push(`${normalized}/${child.name}${child.isDirectory() ? '/' : ''}`);
    }
  }
  return [...new Set(expanded)].sort();
}

async function captureSnapshot(worktreePath, baseSha, allowedPaths, mountedEntries = []) {
  const mounted = new Set(mountedEntries);
  const reported = statusPaths((await run('git', [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
  ], { cwd: worktreePath })).stdout);
  const changedPaths = (await expandMountAncestors(worktreePath, reported, [...mounted]))
    // runnerが張ったmountだけを外す。それ以外は無視しない——gitignore対象であっても、
    // allowed pathの外に現れたものは変更である。
    .filter((changedPath) => {
      const normalized = changedPath.replace(/\/$/u, '');
      return ![...mounted].some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
    });
  for (const changedPath of changedPaths) {
    if (!safeRelativePath(changedPath) || !isAllowed(changedPath, allowedPaths)) {
      throw new Error(`change outside allowed paths: ${changedPath}`);
    }
    await rejectUnsafeEntry(worktreePath, baseSha, changedPath);
  }
  return { changedPaths, patch: await buildPatch(worktreePath, changedPaths) };
}

async function assertSnapshotUnchanged(worktreePath, baseSha, allowedPaths, expected, actor, mountedEntries = []) {
  const actual = await captureSnapshot(worktreePath, baseSha, allowedPaths, mountedEntries);
  if (actual.changedPaths.length !== expected.changedPaths.length
    || actual.changedPaths.some((changedPath, index) => changedPath !== expected.changedPaths[index])
    || !actual.patch.equals(expected.patch)) {
    throw new Error(`${actor} mutated isolated snapshot`);
  }
}

async function fingerprintEntry(repoRoot, relativePath, records) {
  const absolutePath = path.join(repoRoot, relativePath);
  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      records.push({ path: relativePath, type: 'missing', content_digest: null });
      return;
    }
    throw error;
  }
  if (stat.isDirectory()) {
    records.push({ path: relativePath, type: 'directory', content_digest: null });
    const entries = await readdir(absolutePath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await fingerprintEntry(repoRoot, path.posix.join(relativePath, entry.name), records);
    }
    return;
  }
  if (stat.isFile()) {
    records.push({
      path: relativePath,
      type: 'file',
      content_digest: bufferDigest(await readFile(absolutePath)),
    });
    return;
  }
  if (stat.isSymbolicLink()) {
    records.push({
      path: relativePath,
      type: 'symlink',
      content_digest: bufferDigest(Buffer.from(await readlink(absolutePath), 'utf8')),
    });
    return;
  }
  records.push({ path: relativePath, type: 'special', content_digest: null });
}

async function protectedFingerprint(repoRoot) {
  const records = [];
  for (const protectedPath of PROTECTED_PATHS) {
    await fingerprintEntry(repoRoot, protectedPath, records);
  }
  return {
    digest: bufferDigest(Buffer.from(JSON.stringify(records), 'utf8')),
    entry_count: records.length,
  };
}

async function captureSourceState(repoRoot) {
  const [head, visibleStatus, ignoredStatus, protectedContent] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    run('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot }),
    run('git', [
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
    ], { cwd: repoRoot }),
    protectedFingerprint(repoRoot),
  ]);
  return {
    head: head.stdout.toString('utf8').trim(),
    visibleStatus: visibleStatus.stdout,
    ignoredStatus: ignoredStatus.stdout,
    protectedContent,
  };
}

function sourceInvariantComparison(before, after) {
  const compareBuffers = (left, right) => ({
    before_digest: bufferDigest(left),
    after_digest: bufferDigest(right),
    equal: left.equals(right),
  });
  const receipt = {
    schema: 'lattice.source_invariant_receipt.v1',
    protected_paths: [...PROTECTED_PATHS],
    outcome: 'passed',
    head: {
      before: before.head,
      after: after.head,
      equal: before.head === after.head,
    },
    visible_status: compareBuffers(before.visibleStatus, after.visibleStatus),
    ignored_paths: compareBuffers(before.ignoredStatus, after.ignoredStatus),
    protected_content: {
      before_digest: before.protectedContent.digest,
      after_digest: after.protectedContent.digest,
      before_entry_count: before.protectedContent.entry_count,
      after_entry_count: after.protectedContent.entry_count,
      equal: before.protectedContent.digest === after.protectedContent.digest,
    },
  };
  receipt.outcome = [
    receipt.head.equal,
    receipt.visible_status.equal,
    receipt.ignored_paths.equal,
    receipt.protected_content.equal,
  ].every(Boolean) ? 'passed' : 'failed';
  return receipt;
}

async function assertSourceUnchanged(repoRoot, sourceState) {
  const receipt = sourceInvariantComparison(sourceState, await captureSourceState(repoRoot));
  if (receipt.outcome !== 'passed') {
    const error = new Error('source repository changed during isolated transform');
    error.sourceInvariant = receipt;
    throw error;
  }
  return receipt;
}

export async function runIsolatedTransform({ repoRoot, baseRef, allowedPaths, transform, verifyCommands, observe, mounts = [], verifierEnv = {} } = {}) {
  if (!safeRelativePath('.') || typeof repoRoot !== 'string' || typeof baseRef !== 'string'
    || !Array.isArray(allowedPaths) || allowedPaths.some((entry) => !safeRelativePath(entry))
    || typeof transform !== 'function' || !Array.isArray(verifyCommands)
    || (observe !== undefined && typeof observe !== 'function')
    || !isPlainStringRecord(verifierEnv)
    || !Array.isArray(mounts)
    || mounts.some(({ entry, target } = {}) => typeof entry !== 'string'
      || !safeRelativePath(entry) || typeof target !== 'string' || !path.isAbsolute(target))) {
    throw new TypeError('invalid isolated transform arguments');
  }
  // mountはrunnerが自分で張り、自分が張ったentryだけをsnapshotから外す。呼び出し側が
  // transformの中で作ると、任意の変更をsnapshotから隠す口になる。
  const mountedEntries = mounts.map(({ entry }) => entry);

  const sourceState = await captureSourceState(repoRoot);
  if (sourceState.visibleStatus.length > 0) throw new Error('source repository must be clean');
  const baseSha = (await run('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: repoRoot })).stdout.toString('utf8').trim();
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'lattice-isolated-transform-'));
  let added = false;
  let primaryError;
  let result;
  let snapshot;
  let sourceInvariant;
  const verifications = [];
  try {
    await run('git', ['worktree', 'add', '--detach', worktreePath, baseSha], { cwd: repoRoot });
    added = true;
    for (const { entry, target } of mounts) {
      // 保護pathへはmountさせない。そこを許すと、変更をsnapshotから隠す口になる。
      if (PROTECTED_PATHS.includes(entry.split('/')[0])) {
        throw new Error(`mount over protected path is not allowed: ${entry}`);
      }
      const mountPath = path.join(worktreePath, entry);
      await mkdir(path.dirname(mountPath), { recursive: true });
      // base checkoutが同名を持つ場合がある（trackedな.gitignore等）。mount配下は
      // まるごとsnapshotの対象外になるので、置き換えても判定の抜けは生まれない。
      await rm(mountPath, { recursive: true, force: true });
      await symlink(target, mountPath);
    }
    await transform({ worktreePath });
    snapshot = await captureSnapshot(worktreePath, baseSha, allowedPaths, mountedEntries);
    for (const verifier of verifyCommands) {
      if (!verifier || typeof verifier.command !== 'string' || !Array.isArray(verifier.args) || verifier.args.some((arg) => typeof arg !== 'string')) {
        throw new TypeError('verifyCommands must contain command and string args');
      }
      try {
        const verification = await run(verifier.command, verifier.args, {
          cwd: worktreePath,
          env: verifierEnvironment(verifierEnv),
        });
        verifications.push(verificationReceipt(verifier, verification, 'passed'));
      } catch (error) {
        verifications.push(verificationReceipt(verifier, error, 'failed'));
        // どのverifierがなぜ落ちたかを載せる。commandだけ返すと、五条件の棄却理由が
        // 「focused testが落ちた」で止まり、原因を追う手段が無くなる。
        const detail = String(error?.stderr || error?.stdout || '')
          .split('\n').filter((line) => line.trim().length > 0).slice(-6).join(' | ').slice(0, 600);
        throw new Error(`verifier failed (${error.signal ?? error.code}):`
          + ` ${[verifier.command, ...verifier.args].join(' ')}`
          + (detail.length > 0 ? ` :: ${detail}` : ''));
      }
      await assertSnapshotUnchanged(worktreePath, baseSha, allowedPaths, snapshot, 'verifier', mountedEntries);
    }
    if (observe) {
      await observe({ worktreePath, changedPaths: snapshot.changedPaths, patch: snapshot.patch, baseSha });
      await assertSnapshotUnchanged(worktreePath, baseSha, allowedPaths, snapshot, 'observe', mountedEntries);
    }
    result = { baseSha, ...snapshot, verifications };
  } catch (error) {
    primaryError = error;
  }
  let cleanupError;
  try {
    if (added) await run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    await rm(worktreePath, { recursive: true, force: true });
  } catch (error) {
    cleanupError = new Error(`cleanup failed: ${error.message}`);
  }
  let sourceInvariantError;
  try {
    sourceInvariant = await assertSourceUnchanged(repoRoot, sourceState);
  } catch (error) {
    sourceInvariant = error.sourceInvariant;
    sourceInvariantError = error;
  }
  const errors = [primaryError, cleanupError, sourceInvariantError].filter(Boolean);
  const transformEvidence = {
    baseSha,
    changedPaths: snapshot ? [...snapshot.changedPaths] : [],
    patch: snapshot ? Buffer.from(snapshot.patch) : null,
    verifications: structuredClone(verifications),
    sourceInvariant: sourceInvariant ? structuredClone(sourceInvariant) : null,
  };
  for (const error of errors) error.transformEvidence = transformEvidence;
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'isolated transform failed; source repository changed or cleanup failed');
  return { ...result, sourceInvariant };
}
