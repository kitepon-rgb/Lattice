/**
 * JS/TS `child_process` spawn-family process-invocation indexing (ADR 0048,
 * Lattice sensor correctness fix c/1).
 *
 * `spawnSync(process.execPath, [BIN, ...args])` reaches `BIN` by starting a
 * brand-new OS process — no `calls` edge can ever represent it, so a
 * spawn-driven test harness (the oracle shape: `tests/orchestrate/
 * helpers.mjs` spawning `bin/orchestrate-run.mjs`) showed zero `affected`
 * dependents even though changing the spawned file plainly breaks the test.
 *
 * Detection + target folding live in src/extraction/spawn-invokes.ts, reusing
 * dynamic-import.ts's constant-folding engine (`foldConstantExpr`). Wired
 * into `extractCall` (src/extraction/tree-sitter.ts) alongside — but NOT
 * claiming/early-returning like — the dynamic-import branch, so the generic
 * `calls` ref to the local callee name still fires exactly as before this
 * fix. Resolved in import-resolver.ts's `resolveViaImport` via exact
 * `filePath` match (no module-resolution algorithm — spawn's target domain
 * is mostly external binaries), landing `kind='invokes'`,
 * `resolved_by='spawn-path'`, `confidence=0.95`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LatticeSensor } from '../src';
import { DatabaseConnection } from '../src/db';
import { SPAWN_INVOKES_UNRESOLVED_MARKER } from '../src/extraction/spawn-invokes';

describe('child_process spawn-family `invokes` edge indexing', () => {
  let tempDir: string;
  let cg: LatticeSensor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-spawn-invokes-'));
  });

  afterEach(() => {
    if (cg) {
      cg.destroy();
    } else if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('(1) spawnSync(process.execPath, [CONST, ...args]) with module-level const join() folding resolves to the target file', async () => {
    fs.mkdirSync(path.join(tempDir, 'tests', 'orchestrate'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'tests', 'orchestrate', 'helpers.mjs'),
      `import { spawnSync } from 'node:child_process';\n` +
        `import { join } from 'node:path';\n` +
        `export const ROOT = '.';\n` +
        `export const BIN = join(ROOT, 'bin', 'orchestrate-run.mjs');\n` +
        `export function run(args) {\n` +
        `  return spawnSync(process.execPath, [BIN, ...args]);\n` +
        `}\n`
    );
    fs.writeFileSync(path.join(tempDir, 'bin', 'orchestrate-run.mjs'), `console.log('run');\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, e.resolved_by rb, e.confidence conf
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'invokes' AND t.file_path = 'bin/orchestrate-run.mjs'`
      )
      .get() as { sfp: string; rb: string; conf: number } | undefined;
    expect(edge, 'helpers.mjs -> bin/orchestrate-run.mjs invokes edge missing').toBeDefined();
    expect(edge!.sfp).toBe('tests/orchestrate/helpers.mjs');
    expect(edge!.rb).toBe('spawn-path');
    expect(edge!.conf).toBeCloseTo(0.95);
  });

  it('(2) fork(\'./x.mjs\') resolves the same way', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.mjs'),
      `import { fork } from 'node:child_process';\n` +
        `export function run() {\n  return fork('./x.mjs');\n}\n`
    );
    fs.writeFileSync(path.join(tempDir, 'x.mjs'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, e.resolved_by rb
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'invokes' AND t.file_path = 'x.mjs'`
      )
      .get() as { sfp: string; rb: string } | undefined;
    expect(edge, 'a.mjs -> x.mjs invokes edge missing').toBeDefined();
    expect(edge!.rb).toBe('spawn-path');
  });

  it('(3) execFileSync(\'node\', [p]) resolves p to its target file', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.js'),
      `const { execFileSync } = require('node:child_process');\n` +
        `const TARGET = 'y.mjs';\n` +
        `function run() {\n  return execFileSync('node', [TARGET]);\n}\n` +
        `module.exports = { run };\n`
    );
    fs.writeFileSync(path.join(tempDir, 'y.mjs'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, e.resolved_by rb
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'invokes' AND t.file_path = 'y.mjs'`
      )
      .get() as { sfp: string; rb: string } | undefined;
    expect(edge, 'a.js -> y.mjs invokes edge missing').toBeDefined();
    expect(edge!.sfp).toBe('a.js');
  });

  it('(4) spawn(\'git\', ...) — an external command — creates zero invokes edges', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.mjs'),
      `import { spawn } from 'node:child_process';\n` +
        `export function runGit() {\n  return spawn('git', ['status']);\n}\n`
    );

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const count = db
      .getDb()
      .prepare(`SELECT count(*) c FROM edges WHERE kind = 'invokes'`)
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('(5) a user-defined spawn() with no child_process binding creates zero invokes edges, even when a same-named file exists', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.mjs'),
      `function spawn(cmd) {\n  return cmd;\n}\n` +
        `export function run() {\n  return spawn('./should-not-resolve.mjs');\n}\n`
    );
    fs.writeFileSync(path.join(tempDir, 'should-not-resolve.mjs'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const count = db
      .getDb()
      .prepare(`SELECT count(*) c FROM edges WHERE kind = 'invokes'`)
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('(7) spawn(\'git\', ...) creates zero invokes edges even when a same-named SYMBOL exists in the project', async () => {
    // The FP class this guards: an external-command name coinciding with a
    // project symbol's name. resolveViaImport's exact-file-path branch
    // correctly misses ('git' is no file), but without a dedicated pipeline
    // gate the ref would fall through to Strategy 3 name-matching and land
    // on `export function git()` — the exact no-name-match-fallback
    // principle fix (a) exists to enforce (same reason as #660's PHP
    // include rule).
    fs.writeFileSync(
      path.join(tempDir, 'a.mjs'),
      `import { spawn } from 'node:child_process';\n` +
        `export function runGit() {\n  return spawn('git', ['status']);\n}\n`
    );
    fs.writeFileSync(path.join(tempDir, 'vcs.mjs'), `export function git(args) {\n  return args;\n}\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const count = db
      .getDb()
      .prepare(`SELECT count(*) c FROM edges WHERE kind = 'invokes'`)
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('(6) fork(mod) with an unfoldable argument creates zero edges but a visible unresolved sentinel', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.mjs'),
      `import { fork } from 'node:child_process';\n` +
        `export function run(mod) {\n  return fork(mod);\n}\n`
    );

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const count = db
      .getDb()
      .prepare(`SELECT count(*) c FROM edges WHERE kind = 'invokes'`)
      .get() as { c: number };
    expect(count.c).toBe(0);

    const markerRows = db
      .getDb()
      .prepare(`SELECT status, reference_kind FROM unresolved_refs WHERE reference_name = ?`)
      .all(SPAWN_INVOKES_UNRESOLVED_MARKER) as Array<{ status: string; reference_kind: string }>;
    expect(markerRows.length).toBeGreaterThan(0);
    expect(markerRows.every((r) => r.status === 'failed')).toBe(true);
    expect(markerRows.every((r) => r.reference_kind === 'invokes')).toBe(true);
  });
});
