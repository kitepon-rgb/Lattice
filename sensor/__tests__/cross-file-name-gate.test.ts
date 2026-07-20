/**
 * ADR 0048 correctness fix, revised design (2-layer):
 *
 * 1. resolution-time gate (`src/resolution/index.ts`, Strategy 3): only
 *    gates a cross-*language* bare-name match between two of
 *    {javascript, typescript, python} that are NOT the same language family
 *    (js<->ts are one family — LANGUAGE_FAMILY in name-matcher.ts — so a
 *    js<->ts hit is untouched). Python calling a JS/TS symbol by bare name
 *    has no legitimate mechanism (interop is subprocess/CLI, never a
 *    linkable symbol) — real FP: `advisory-hook.py -> *.mjs` bare
 *    read/decode/flush hits. Same-LANGUAGE cross-file bare-name matches
 *    (js calling js) are intentionally left alone at resolution time —
 *    several existing, regression-tested features rely on them (destructured
 *    store actions, receiver-typed method calls, DI-constructor calls); the
 *    first cut of this fix gated those too and broke 7 test files / 14 tests,
 *    reverted (see git history on this file for what NOT to do).
 *
 * 2. file-level corroboration filter (`src/db/queries.ts`,
 *    `getDependentFilePaths` / `getDependencyFilePaths`): ADR 0048's ground
 *    truth for the FILE-level dependency graph is the transitive import
 *    closure. A file pair connected ONLY by edges whose `resolved_by` is an
 *    unverified name/proximity strategy (exact-match, fuzzy, instance-method,
 *    function-ref) has no corroborating import path and is excluded from
 *    these two file-level projections — the symbol-level edge itself is left
 *    alone (still visible via getOutgoingEdges/getCallers/explore).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LatticeSensor } from '../src';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';

describe('ADR 0048: cross-file name-match correctness (2-layer)', () => {
  let tempDir: string;
  let cg: LatticeSensor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-xfile-gate-'));
  });

  afterEach(() => {
    if (cg) {
      cg.destroy();
    } else if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('2-1: resolution-time gate is cross-LANGUAGE only', () => {
    it('(iii) python calling a JS symbol by bare name does NOT create a cross-file edge', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'advisory-hook.py'),
        `def run():\n    read()\n`
      );
      fs.writeFileSync(
        path.join(tempDir, 'other.mjs'),
        `export function read() {\n  console.log('boom');\n}\n`
      );

      cg = await LatticeSensor.init(tempDir, { index: true });

      const run = cg.getNodesByKind('function').find((n) => n.name === 'run');
      const readFn = cg.getNodesByKind('function').find((n) => n.name === 'read');
      expect(run).toBeDefined();
      expect(readFn).toBeDefined();

      const outgoing = cg.getOutgoingEdges(run!.id);
      const crossLangCall = outgoing.find((e) => e.target === readFn!.id);
      expect(crossLangCall, 'python must not bind to a same-named JS export').toBeUndefined();

      const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
      const rows = db
        .getDb()
        .prepare(
          `SELECT status FROM unresolved_refs WHERE from_node_id = ? AND reference_name = 'read'`
        )
        .all(run!.id) as Array<{ status: string }>;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === 'failed')).toBe(true);
    });

    it('js calling js by bare name (no import) still creates the symbol edge — resolution is unaffected', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'caller.js'),
        `export function run() {\n  reject('boom');\n}\n`
      );
      fs.writeFileSync(
        path.join(tempDir, 'other.js'),
        `export function reject(msg) {\n  console.log(msg);\n}\n`
      );

      cg = await LatticeSensor.init(tempDir, { index: true });

      const run = cg.getNodesByKind('function').find((n) => n.name === 'run');
      const rejectFn = cg.getNodesByKind('function').find((n) => n.name === 'reject');
      expect(run).toBeDefined();
      expect(rejectFn).toBeDefined();

      const outgoing = cg.getOutgoingEdges(run!.id);
      const crossFileCall = outgoing.find((e) => e.target === rejectFn!.id);
      expect(crossFileCall, 'js->js symbol resolution must not be gated at resolution time').toBeDefined();
    });

    it('js<->ts (same family) cross-file bare-name match is unaffected', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'caller.ts'),
        `export function run(): void {\n  reject('boom');\n}\n`
      );
      fs.writeFileSync(
        path.join(tempDir, 'other.js'),
        `export function reject(msg) {\n  console.log(msg);\n}\n`
      );

      cg = await LatticeSensor.init(tempDir, { index: true });

      const run = cg.getNodesByKind('function').find((n) => n.name === 'run');
      const rejectFn = cg.getNodesByKind('function').find((n) => n.name === 'reject');
      expect(run).toBeDefined();
      expect(rejectFn).toBeDefined();

      const outgoing = cg.getOutgoingEdges(run!.id);
      const crossFileCall = outgoing.find((e) => e.target === rejectFn!.id);
      expect(crossFileCall, 'ts calling js (same web family) must not be gated').toBeDefined();
    });
  });

  describe('2-2: file-level corroboration filter', () => {
    it('(i) a file pair connected ONLY by an uncorroborated name-match edge is excluded from getDependentFilePaths', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'caller.js'),
        `export function run() {\n  reject('boom');\n}\n`
      );
      fs.writeFileSync(
        path.join(tempDir, 'other.js'),
        `export function reject(msg) {\n  console.log(msg);\n}\n`
      );

      cg = await LatticeSensor.init(tempDir, { index: true });

      const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
      const q = new QueryBuilder(db.getDb());

      // Sanity: the symbol edge exists and is uncorroborated (exact-match).
      const run = cg.getNodesByKind('function').find((n) => n.name === 'run');
      const rejectFn = cg.getNodesByKind('function').find((n) => n.name === 'reject');
      const row = db
        .getDb()
        .prepare('SELECT resolved_by FROM edges WHERE source = ? AND target = ?')
        .get(run!.id, rejectFn!.id) as { resolved_by: string } | undefined;
      expect(row?.resolved_by).toBe('exact-match');

      const dependents = q.getDependentFilePaths('other.js');
      expect(dependents, 'import-less name-match-only file pair must not appear').not.toContain('caller.js');

      const dependencies = q.getDependencyFilePaths('caller.js');
      expect(dependencies).not.toContain('other.js');
    });

    it('(ii) a file pair with a real import edge (in addition to a name-match edge) IS included', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'caller.js'),
        `import { helper } from './other';\nexport function run() {\n  helper();\n  reject('boom');\n}\n`
      );
      fs.writeFileSync(
        path.join(tempDir, 'other.js'),
        `export function helper() {}\nexport function reject(msg) {\n  console.log(msg);\n}\n`
      );

      cg = await LatticeSensor.init(tempDir, { index: true });

      const db = DatabaseConnection.open(path.join(tempDir, '.lattice/sensor', 'sensor.db'));
      const q = new QueryBuilder(db.getDb());

      const dependents = q.getDependentFilePaths('other.js');
      expect(dependents, 'a corroborated (import-resolved) edge keeps the pair in the projection').toContain(
        'caller.js'
      );

      const dependencies = q.getDependencyFilePaths('caller.js');
      expect(dependencies).toContain('other.js');
    });
  });
});
