/**
 * Dynamic import() / require() extraction + resolution (ADR 0048, Lattice
 * sensor correctness fix b).
 *
 * The JS/TS extractors only recognized STATIC `import ... from '...'`
 * (importTypes: ['import_statement']) — dynamic `import(<expr>)` and
 * CommonJS `require(<expr>)` were invisible, false-negating the oracle's
 * `helpers.mjs -> control-record.mjs` dependency:
 *
 *   import { dirname, join, resolve } from "node:path";
 *   export const ROOT = resolve(import.meta.dirname, "..", "..");
 *   export const CONTROL_LIB = join(ROOT, "lib", "orchestrate", "control-record.mjs");
 *   export const loadControl = () => import(CONTROL_LIB);
 *
 * Detection + constant-folding lives in src/extraction/dynamic-import.ts;
 * it's wired into the core `extractCall` dispatch (src/extraction/
 * tree-sitter.ts) rather than the per-language `visitNode` hook (the Lua/
 * Ruby `require()` precedent) because `extractCall` is the single point
 * BOTH call walkers funnel through — including the function-body-only
 * walker that never invokes `visitNode`, which is exactly where `() =>
 * import(CONTROL_LIB)` (an arrow function body) lives.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LatticeSensor } from '../src';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import {
  DYNAMIC_IMPORT_UNRESOLVED_MARKER,
} from '../src/extraction/dynamic-import';

describe('Dynamic import()/require() extraction + resolution', () => {
  let tempDir: string;
  let cg: LatticeSensor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-dynimport-'));
  });

  afterEach(() => {
    if (cg) {
      cg.destroy();
    } else if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('(i) import(\'./x.mjs\') string literal lands a cross-file imports edge, visible in getDependentFilePaths', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.mjs'),
      `export function run() {\n  return import('./x.mjs');\n}\n`
    );
    fs.writeFileSync(path.join(tempDir, 'x.mjs'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const q = new QueryBuilder(db.getDb());
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, t.file_path tfp, e.kind, e.resolved_by
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'imports' AND t.file_path = 'x.mjs'`
      )
      .get() as { sfp: string; tfp: string; kind: string; resolved_by: string } | undefined;
    expect(edge, 'a.mjs -> x.mjs imports edge missing').toBeDefined();
    expect(edge!.sfp).toBe('a.mjs');

    expect(q.getDependentFilePaths('x.mjs')).toContain('a.mjs');
  });

  it('(ii) require(\'./x\') — no extension — resolves the same way', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.js'),
      `function run() {\n  return require('./x');\n}\nmodule.exports = { run };\n`
    );
    fs.writeFileSync(path.join(tempDir, 'x.js'), `module.exports = { val: 1 };\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const q = new QueryBuilder(db.getDb());
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, e.resolved_by rb
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'imports' AND t.file_path = 'x.js'`
      )
      .get() as { sfp: string; rb: string } | undefined;
    expect(edge, 'require(\'./x\') (extensionless) must resolve to x.js').toBeDefined();
    expect(edge!.sfp).toBe('a.js');

    expect(q.getDependentFilePaths('x.js')).toContain('a.js');
  });

  it('(iii) oracle reproduction: import.meta.dirname + resolve(..,..) + join(ROOT,...) + 2-level const + arrow-body import(CONST)', async () => {
    fs.mkdirSync(path.join(tempDir, 'tests', 'orchestrate'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'lib', 'orchestrate'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'tests', 'orchestrate', 'helpers.mjs'),
      `import { dirname, join, resolve } from "node:path";\n` +
        `export const ROOT = resolve(import.meta.dirname, "..", "..");\n` +
        `export const CONTROL_LIB = join(ROOT, "lib", "orchestrate", "control-record.mjs");\n` +
        `export const loadControl = () => import(CONTROL_LIB);\n`
    );
    fs.writeFileSync(
      path.join(tempDir, 'lib', 'orchestrate', 'control-record.mjs'),
      `export function reject() {}\n`
    );

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const q = new QueryBuilder(db.getDb());
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, t.file_path tfp, e.resolved_by rb, e.confidence conf
         FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'imports' AND t.file_path = 'lib/orchestrate/control-record.mjs'`
      )
      .get() as { sfp: string; tfp: string; rb: string; conf: number } | undefined;
    expect(edge, 'oracle shape: helpers.mjs -> control-record.mjs imports edge missing').toBeDefined();
    expect(edge!.sfp).toBe('tests/orchestrate/helpers.mjs');
    expect(edge!.conf).not.toBeNull();

    expect(q.getDependentFilePaths('lib/orchestrate/control-record.mjs')).toContain(
      'tests/orchestrate/helpers.mjs'
    );
  });

  it('(iv) substitution-less template literal folds and resolves', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.js'),
      'function run() { return import(`./x.mjs`); }\n'
    );
    fs.writeFileSync(path.join(tempDir, 'x.mjs'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp FROM edges e
         JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'imports' AND t.file_path = 'x.mjs'`
      )
      .get() as { sfp: string } | undefined;
    expect(edge, 'substitution-less template literal must fold and resolve').toBeDefined();
  });

  it('(v) import(someVariable) — unfoldable — creates zero edges and a visible unresolved marker, no accidental name match', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.js'),
      `function run(p) {\n  return import(p);\n}\n`
    );
    // A same-named export ("p") exists elsewhere — if the unresolved marker
    // ever leaked into ordinary name-matching, this is exactly the kind of
    // coincidental symbol it could wrongly bind to.
    fs.writeFileSync(path.join(tempDir, 'other.js'), `export const p = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const importEdges = db
      .getDb()
      .prepare(`SELECT count(*) c FROM edges WHERE kind = 'imports'`)
      .get() as { c: number };
    expect(importEdges.c).toBe(0);

    // Also no OTHER kind of edge accidentally landed on `p` (excluding the
    // file's own unrelated containment edge to its top-level const `p`).
    const anyEdgeToP = db
      .getDb()
      .prepare(
        `SELECT count(*) c FROM edges e JOIN nodes t ON t.id = e.target
         WHERE t.file_path = 'other.js' AND t.name = 'p' AND e.kind != 'contains'`
      )
      .get() as { c: number };
    expect(anyEdgeToP.c).toBe(0);

    const markerRows = db
      .getDb()
      .prepare(
        `SELECT status FROM unresolved_refs WHERE reference_name = ?`
      )
      .all(DYNAMIC_IMPORT_UNRESOLVED_MARKER) as Array<{ status: string }>;
    expect(markerRows.length).toBeGreaterThan(0);
    expect(markerRows.every((r) => r.status === 'failed')).toBe(true);

    // The unresolved marker is also visible as a graph node (searchable),
    // not just a row in a maintenance table.
    const markerNode = db
      .getDb()
      .prepare(`SELECT kind, name FROM nodes WHERE kind = 'import' AND name = ?`)
      .get(DYNAMIC_IMPORT_UNRESOLVED_MARKER) as { kind: string; name: string } | undefined;
    expect(markerNode, 'unresolved dynamic import should still create a visible import node').toBeDefined();
  });

  it('(vi) TS: string literal import() and the oracle shape both resolve', async () => {
    fs.mkdirSync(path.join(tempDir, 'tests', 'orchestrate'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'tests', 'orchestrate', 'helpers.ts'),
      `import { join, resolve } from "node:path";\n` +
        `export const ROOT = resolve(import.meta.dirname, "..", "..");\n` +
        `export const LIB = join(ROOT, "lib", "x.ts");\n` +
        `export const loadIt = () => import(LIB);\n` +
        `export function directLoad() { return import('../../lib/x.ts'); }\n`
    );
    fs.writeFileSync(path.join(tempDir, 'lib', 'x.ts'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edges = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp, e.resolved_by rb FROM edges e
         JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'imports' AND t.file_path = 'lib/x.ts'`
      )
      .all() as Array<{ sfp: string; rb: string }>;
    // Both the folded oracle shape AND the direct relative-literal form
    // must resolve — 2 distinct dynamic import() call sites into the same file.
    expect(edges.length).toBe(2);
    expect(edges.every((e) => e.sfp === 'tests/orchestrate/helpers.ts')).toBe(true);
  });

  it('same-language js<->ts dynamic import is unaffected by the cross-language gate', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.ts'),
      `export function run() {\n  return import('./x.mjs');\n}\n`
    );
    fs.writeFileSync(path.join(tempDir, 'x.mjs'), `export const val = 1;\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edge = db
      .getDb()
      .prepare(
        `SELECT s.file_path sfp FROM edges e
         JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'imports' AND t.file_path = 'x.mjs'`
      )
      .get() as { sfp: string } | undefined;
    expect(edge).toBeDefined();
  });

  it('a bare package specifier in a dynamic require() never lands a wrong file edge', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'a.js'),
      `function run() {\n  return require('lodash');\n}\n`
    );
    // A same-named FILE happens to exist in the project — the bare
    // specifier must NOT accidentally resolve to it (npm resolution is out
    // of this graph's scope; only './'/'../' specifiers get the raw-path
    // fallback in resolveViaImport).
    fs.writeFileSync(path.join(tempDir, 'lodash.js'), `module.exports = {};\n`);

    cg = await LatticeSensor.init(tempDir, { index: true });

    const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
    const edge = db
      .getDb()
      .prepare(`SELECT count(*) c FROM edges WHERE kind = 'imports'`)
      .get() as { c: number };
    expect(edge.c).toBe(0);
  });
});
