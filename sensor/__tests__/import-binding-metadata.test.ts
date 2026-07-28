/**
 * Import binding shape on resolved `imports` edges (v10): default / named /
 * namespace, plus the source-side name when an alias renames it. Rewrite
 * tooling reproduces the binding from edge metadata instead of re-parsing
 * import statement text with regexes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import LatticeSensor from '../src';

describe('import binding metadata', () => {
  let dir: string;
  let cg: LatticeSensor | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-importbind-'));
  });
  afterEach(() => {
    cg?.destroy();
    cg = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('carries default/named/namespace and alias source names into edge metadata', async () => {
    fs.writeFileSync(
      path.join(dir, 'lib.ts'),
      [
        'export default function main() { return 1; }',
        'export function named() { return 2; }',
        'export function renamed() { return 3; }',
        'export const NS_VALUE = 4;',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'user.ts'),
      [
        "import main from './lib';",
        "import { named, renamed as alias } from './lib';",
        "import * as lib from './lib';",
        'export function use() { return main() + named() + alias() + lib.NS_VALUE; }',
      ].join('\n'),
    );
    const g = LatticeSensor.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    cg = g;
    await g.indexAll();

    const userFile = g.searchNodes('user.ts').map((r) => r.node).find((n) => n.kind === 'file');
    expect(userFile).toBeDefined();
    const byRefName: Record<string, { binding?: string; importedName?: string }> = {};
    for (const e of g.getOutgoingEdges(userFile!.id, ['imports'])) {
      const meta = e.metadata as { refName?: string; binding?: string; importedName?: string };
      if (typeof meta?.refName === 'string' && meta.binding !== undefined) {
        byRefName[meta.refName] = { binding: meta.binding, importedName: meta.importedName };
      }
    }
    expect(byRefName).toEqual({
      main: { binding: 'default', importedName: undefined },
      named: { binding: 'named', importedName: undefined },
      alias: { binding: 'named', importedName: 'renamed' },
      lib: { binding: 'namespace', importedName: undefined },
    });
  });
});
