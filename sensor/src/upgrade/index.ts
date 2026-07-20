/**
 * Retirement-only compatibility helpers.
 *
 * The upstream self-update implementation is archived outside `src/` and is
 * not compiled or shipped. These pure helpers remain solely so the legacy
 * uninstaller can identify and remove an independently installed Lattice sensor.
 */
import * as fs from 'fs';
import * as path from 'path';

export const NPM_PACKAGE = '@kitepon-rgb/Lattice';

export type InstallMethod =
  | { kind: 'bundle'; os: 'unix' | 'windows'; bundleRoot: string; installDir: string | null }
  | { kind: 'npm'; scope: 'global' | 'local' }
  | { kind: 'npx' }
  | { kind: 'source'; root: string }
  | { kind: 'unknown'; reason: string };

export interface DetectInput {
  filename: string;
  platform: NodeJS.Platform;
  cwd: string;
  exists?: (candidate: string) => boolean;
}

function toPosix(candidate: string): string {
  return candidate.replace(/\\/g, '/');
}

export function deriveInstallDir(
  bundleRoot: string,
  os: 'unix' | 'windows',
  exists: (candidate: string) => boolean,
): string | null {
  const platformPath = os === 'windows' ? path.win32 : path.posix;
  if (os === 'windows') {
    return platformPath.basename(bundleRoot).toLowerCase() === 'current'
      ? platformPath.dirname(bundleRoot)
      : null;
  }
  const parent = platformPath.dirname(bundleRoot);
  if (platformPath.basename(parent) !== 'versions') return null;
  const installDir = platformPath.dirname(parent);
  return exists(installDir) ? installDir : platformPath.dirname(parent);
}

export function detectInstallMethod(input: DetectInput): InstallMethod {
  const exists = input.exists ?? fs.existsSync;
  const isWindows = input.platform === 'win32';
  const platformPath = isWindows ? path.win32 : path.posix;
  const binDir = platformPath.dirname(input.filename);
  const normalized = toPosix(input.filename);
  if (normalized.includes('/_npx/')) return { kind: 'npx' };
  if (normalized.includes('/node_modules/')) {
    const underCwd = normalized.startsWith(`${toPosix(platformPath.resolve(input.cwd))}/`);
    return { kind: 'npm', scope: underCwd ? 'local' : 'global' };
  }
  const bundleRoot = platformPath.resolve(binDir, '..', '..', '..');
  const vendoredNode = platformPath.join(bundleRoot, isWindows ? 'node.exe' : 'node');
  const launcher = platformPath.join(bundleRoot, 'bin', isWindows ? 'latticeSensor.cmd' : 'latticeSensor');
  if (exists(vendoredNode) && exists(launcher)) {
    const os = isWindows ? 'windows' : 'unix';
    return { kind: 'bundle', os, bundleRoot, installDir: deriveInstallDir(bundleRoot, os, exists) };
  }
  const repoRoot = platformPath.resolve(binDir, '..', '..');
  if (exists(platformPath.join(repoRoot, 'package.json')) && exists(platformPath.join(repoRoot, '.git'))) {
    return { kind: 'source', root: repoRoot };
  }
  return { kind: 'unknown', reason: `unrecognized install layout at ${input.filename}` };
}

export function npmInvocation(
  platform: NodeJS.Platform,
  npmArgs: string[],
): { cmd: string; args: string[] } {
  return platform === 'win32'
    ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', ['npm', ...npmArgs].join(' ')] }
    : { cmd: 'npm', args: npmArgs };
}
