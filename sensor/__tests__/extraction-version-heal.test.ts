/**
 * Extraction-version heal (schema v12): rows written by an older extractor are
 * pending changes even when file content is unchanged, sync re-extracts them
 * through the ordinary incremental path, and the global stamp advances by
 * itself once nothing stale remains. Before this, the only cure was a manual
 * full re-index that `status` merely recommended — and a resident daemon
 * running old code could keep an index timestamp-fresh but semantically stale
 * forever (2026-07-28 incident).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import LatticeSensor from '../src';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { EXTRACTION_VERSION } from '../src/extraction/extraction-version';

describe('extraction-version heal', () => {
  let dir: string;
  let cg: LatticeSensor | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-extheal-'));
  });
  afterEach(() => {
    cg?.destroy();
    cg = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('re-extracts unchanged files whose rows carry an older extraction version, then advances the global stamp', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function alpha() { return 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export function beta() { return 2; }\n');
    const g = LatticeSensor.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    cg = g;
    await g.indexAll();
    expect(g.isIndexStale()).toBe(false);
    g.destroy();
    cg = undefined;

    // Simulate an index written by an older engine: same content hashes, older
    // per-file stamps, older global stamp. This is exactly what a pre-upgrade
    // daemon leaves behind.
    const db = DatabaseConnection.open(getDatabasePath(dir));
    db.getDb().prepare("UPDATE files SET extraction_version = ? WHERE path = 'a.ts'")
      .run(EXTRACTION_VERSION - 1);
    db.getDb().prepare("UPDATE project_metadata SET value = ? WHERE key = 'indexed_with_extraction_version'")
      .run(String(EXTRACTION_VERSION - 1));
    db.close();

    const g2 = await LatticeSensor.open(dir);
    cg = g2;
    // The stale row is visible as a pending change before any file changes.
    expect(g2.isIndexStale()).toBe(true);

    const result = await g2.sync();
    // Only the stale-stamped file re-extracts; the current one is untouched.
    expect(result.extractionHealed).toBe(1);

    const db2 = DatabaseConnection.open(getDatabasePath(dir));
    const rows = db2.getDb()
      .prepare('SELECT path, extraction_version FROM files ORDER BY path')
      .all() as Array<{ path: string; extraction_version: number }>;
    db2.close();
    expect(rows).toEqual([
      { path: 'a.ts', extraction_version: EXTRACTION_VERSION },
      { path: 'b.ts', extraction_version: EXTRACTION_VERSION },
    ]);

    // No stale rows remain, so the global stamp advanced and the re-index
    // hint clears without anyone running a manual full re-index.
    expect(g2.isIndexStale()).toBe(false);

    // A second sync heals nothing — the mechanism converges.
    const again = await g2.sync();
    expect(again.extractionHealed).toBe(0);
  });
});
