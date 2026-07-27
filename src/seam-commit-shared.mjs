import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export const GIT_SHA1 = /^[0-9a-f]{40}$/u;

export const SEAM_REF_PREFIX = 'refs/lattice/seam';

export async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export function safeRelative(target) {
  return typeof target === 'string' && target.length > 0 && !target.includes('\0')
    && !path.posix.isAbsolute(target) && target === path.posix.normalize(target)
    && !target.split('/').includes('..');
}
