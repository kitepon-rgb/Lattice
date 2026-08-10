/**
 * What gets baked into the OS persistence surfaces (the macOS LaunchAgent
 * plist, the Windows Startup launcher) as the Node executable — and how a
 * bridge installed out of a development tree is called out at setup time.
 *
 * `process.execPath` is already realpath-resolved by libuv, so under Homebrew
 * it reads `/opt/homebrew/Cellar/node/<version>/bin/node` even when node was
 * invoked through `/opt/homebrew/bin/node`. Baking that version-pinned path
 * into a LaunchAgent makes `brew upgrade node` delete the very binary launchd
 * is told to exec: KeepAlive then respins a process that can never start, and
 * nothing anywhere reports it — the terminal just disappears from the
 * published view (hit on this Mac 2026-08-08 and again 2026-08-10).
 *
 * So we bake a stable alias whenever one demonstrably resolves to the same
 * binary. The test is deliberately narrow — `realpath(candidate)` equals the
 * already-validated `resolved` path, and nothing else. In particular we do
 * NOT additionally require the candidate's parent directories to be free of
 * group write: the standard Homebrew prefix (`/opt/homebrew/bin`, drwxrwxr-x)
 * fails that check, so the rule would refuse to fire in exactly the
 * environment it exists for. Nor would it buy anything — the Cellar path we
 * bake today sits under an equally group-writable `/opt/homebrew/Cellar`, so
 * the set of principals who can swap the binary is identical either way. The
 * binary itself is still checked (owner, mode, exec bit) by the caller before
 * any of this runs.
 *
 * Shim-based version managers (asdf, volta) resolve to their own launcher
 * rather than to the node binary, so they never match and we keep the
 * resolved path. That is the honest outcome: we never bake a path we could
 * not verify, and `lattice bridge status` reports what the persistence
 * surface actually points at, so a version-pinned path is visible before it
 * dies rather than silent after.
 */

import { realpath } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_BRIDGE_PATH = path.resolve(import.meta.dirname, '../bin/lattice-bridge.mjs');
export const DEFAULT_SUPERVISOR_PATH =
  path.resolve(import.meta.dirname, '../bin/lattice-bridge-supervisor.mjs');

// Directories that hold a stable `node` on a default install of the platform's
// usual package manager. They are appended to (not substituted for) whatever
// PATH the installing shell had, because launchd and the Windows Startup
// folder inherit no PATH at all — the candidate has to come from here.
const WELL_KNOWN_DIRECTORIES = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
  win32: ['C:\\Program Files\\nodejs'],
  other: ['/usr/local/bin', '/usr/bin'],
};

function candidateDirectories(env, platform) {
  const raw = typeof env.PATH === 'string' ? env.PATH
    : typeof env.Path === 'string' ? env.Path : '';
  const fromPath = raw.split(platform === 'win32' ? ';' : ':')
    .filter((entry) => entry !== '' && path.isAbsolute(entry));
  const wellKnown = WELL_KNOWN_DIRECTORIES[platform] ?? WELL_KNOWN_DIRECTORIES.other;
  return [...new Set([...fromPath, ...wellKnown])];
}

function samePath(left, right, platform) {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The path to bake for a node executable whose real location is `resolved`:
 * the first candidate alias that resolves to exactly that binary, or
 * `resolved` itself when no alias can be verified.
 */
export async function stableNodePath({ resolved, env = process.env,
  platform = process.platform } = {}) {
  if (typeof resolved !== 'string' || !path.isAbsolute(resolved)) {
    throw new TypeError('resolved node executable path required');
  }
  const name = platform === 'win32' ? 'node.exe' : 'node';
  for (const directory of candidateDirectories(env, platform)) {
    const candidate = path.join(directory, name);
    if (samePath(candidate, resolved, platform)) continue;
    let target;
    try { target = await realpath(candidate); } catch { continue; }
    if (samePath(target, resolved, platform)) return candidate;
  }
  return resolved;
}

/**
 * A bridge script outside any `node_modules` is being persisted straight out
 * of a checkout: the daemon then survives every `npm update` unchanged, and
 * dies for good if the tree is moved or deleted. Not an error — installing
 * from a development tree is a legitimate thing to do deliberately — but it
 * must not happen without the operator being told.
 */
export function bridgeDevelopmentTreeWarning(bridgePath) {
  if (typeof bridgePath !== 'string') return null;
  if (bridgePath.split(/[\\/]/u).includes('node_modules')) return null;
  return {
    code: 'BRIDGE_PERSISTED_FROM_DEVELOPMENT_TREE',
    message: `the bridge is persisted from a development tree (${bridgePath}); `
      + 'it will not follow npm updates and stops for good if that tree moves',
  };
}
