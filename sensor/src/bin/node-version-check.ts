/**
 * Node.js version compatibility check.
 *
 * Node 25.x has a V8 turboshaft WASM JIT Zone allocator bug that
 * reliably crashes LatticeSensor with `Fatal process out of memory: Zone`
 * during tree-sitter grammar compilation. This module owns the
 * user-facing banner shown before exit. Kept side-effect-free so it's
 * safe to import from tests without triggering CLI bootstrap.
 */

/**
 * Build the bordered banner shown when LatticeSensor detects an
 * unsupported Node.js major version (Node 25.x). Pinned via unit
 * test so the recovery commands and override instructions can't be
 * silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNode25BlockBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[LatticeSensor] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    'Node.js 25.x has a V8 WASM JIT (turboshaft) Zone allocator bug that',
    'crashes with `Fatal process out of memory: Zone` when LatticeSensor',
    'compiles tree-sitter grammars. LatticeSensor WILL crash on this Node',
    'version mid-indexing. See https://github.com/kitepon-rgb/Lattice/issues/81',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - you will likely OOM):',
    '  LATTICE_SENSOR_ALLOW_UNSAFE_NODE=1 lattice sensor ...',
    sep,
  ].join('\n');
}

/** Node 25.xだけが既知のV8 WASM Zone allocator bugの影響を受ける。 */
export function isNode25Affected(nodeMajor: number): boolean {
  return nodeMajor === 25;
}

/**
 * Lowest supported Node.js major version. Matches the `engines` floor in
 * package.json. Below this, LatticeSensor relies on language features / native APIs
 * that aren't present, and the combination is untested. `engines` alone only
 * *warns* on install (unless the user set `engine-strict`), so the CLI bootstrap
 * also hard-blocks here to actually enforce the floor.
 */
export const MIN_NODE_MAJOR = 20;

/**
 * Build the bordered banner shown when LatticeSensor detects a Node.js major below
 * {@link MIN_NODE_MAJOR}. Pinned via unit test so the recovery commands and the
 * override env var can't be silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[LatticeSensor] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `LatticeSensor requires Node.js ${MIN_NODE_MAJOR} or newer. Older versions lack`,
    'language features and native APIs LatticeSensor depends on, and are not',
    'tested or supported.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  LATTICE_SENSOR_ALLOW_UNSAFE_NODE=1 lattice sensor ...',
    sep,
  ].join('\n');
}
