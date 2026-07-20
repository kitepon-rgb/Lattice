/**
 * Resolved package version, computed once at module load.
 *
 * The version string is the rendezvous datum between cooperating daemon and
 * proxy processes: the daemon advertises its version in the hello line, and
 * the proxy refuses to share IPC across a mismatch (falls back to direct
 * mode). Keeping the resolution in one place avoids drift between the CLI
 * `--version` output (which reads `package.json` directly) and the daemon
 * handshake.
 *
 * Resolution strategy: read the bundled `package.json` two levels up from
 * this file — same relative position whether we're loaded from `src/mcp/` or
 * the `dist/mcp/` output, since `tsc` preserves the layout. If reading fails
 * (e.g. the package was unpacked oddly), fall back to "0.0.0-unknown" — a
 * sentinel that will never match a real version, so the proxy harmlessly
 * falls back to direct mode.
 */

import * as fs from 'fs';
import * as path from 'path';

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to sentinel.
  }
  return '0.0.0-unknown';
}

export const LatticeSensorPackageVersion = readPackageVersion();

/**
 * ADR 0049 Decision 3(a)/5(3): whether a version string carries the Lattice
 * product-identity marker (`-lattice.`). Used to bisect a daemon hello
 * mismatch into two structurally different situations:
 *   - marker present  → same product, different build (e.g. a self-update
 *     left a stale daemon running) → safe to degrade to direct mode.
 *   - marker absent    → a DIFFERENT product's daemon (third-party LatticeSensor)
 *     is bound at this socket path → NOT safe to silently fall back to; the
 *     proxy must fail closed instead of risking a cross-product attach.
 */
export function isLatticeVersion(version: string): boolean {
  return version.includes('-lattice.');
}
