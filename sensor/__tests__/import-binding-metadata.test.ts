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

describe('import surface for rewrite tooling (file-nodes contract)', () => {
  let dir: string;
  let cg: LatticeSensor | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-importsurface-'));
  });
  afterEach(() => {
    cg?.destroy();
    cg = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('joins statement extents with bindings by line, including multi-line and builtin imports', async () => {
    fs.writeFileSync(
      path.join(dir, 'lib.ts'),
      ['export function one() { return 1; }', 'export function two() { return 2; }'].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'user.ts'),
      [
        "import * as nodePath from 'path';",
        'import {',
        '  one,',
        '  two as second,',
        "} from './lib';",
        'export function use() { return nodePath.join(String(one()), String(second())); }',
      ].join('\n'),
    );
    const g = LatticeSensor.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    cg = g;
    await g.indexAll();

    // Statement extents: the multi-line import spans its full range.
    const all = g.getNodesInFile('user.ts');
    const imports = all
      .filter((n) => n.kind === 'import')
      .map((n) => ({ name: n.name, startLine: n.startLine, endLine: n.endLine }))
      .sort((a, b) => a.startLine - b.startLine);
    expect(imports).toEqual([
      { name: 'path', startLine: 1, endLine: 1 },
      { name: './lib', startLine: 2, endLine: 5 },
    ]);

    // Resolved bindings land on edges; the builtin ('path') has no resolvable
    // target, so its binding is only recoverable from unresolved_refs. The
    // file-nodes CLI reads both — pin that union here at the same API surface.
    const fileNode = all.find((n) => n.kind === 'file');
    const locals: Array<{ local: string; line: number | null }> = [];
    for (const e of g.getOutgoingEdges(fileNode!.id)) {
      if (e.kind !== 'imports') continue;
      const meta = e.metadata as { refName?: string; binding?: string };
      if (typeof meta?.refName !== 'string' || typeof meta?.binding !== 'string') continue;
      locals.push({ local: meta.refName, line: typeof e.line === 'number' ? e.line : null });
    }
    for (const ref of g.getImportBindingRefsForFile('user.ts')) {
      if (ref.referenceKind !== 'imports' || typeof ref.bindingForm !== 'string') continue;
      locals.push({ local: ref.referenceName, line: ref.line });
    }
    locals.sort((a, b) => (a.local < b.local ? -1 : 1));
    // Binding lines are the binding's own line (inside a multi-line statement,
    // not its first line) — the join is by statement extent containment.
    // 'nodePath' binds a builtin: resolution parks it as failed, and the
    // status-agnostic reader must still see it.
    expect(locals).toEqual([
      { local: 'nodePath', line: 1 },
      { local: 'one', line: 3 },
      { local: 'second', line: 4 },
    ]);
  });
});

describe('EXTENSION_RESOLUTION export (reverse-direction material)', () => {
  it('exposes per-language suffix omission rules, read-only shape', async () => {
    const { EXTENSION_RESOLUTION } = await import('../src/resolution/import-resolver');
    // The reverse mapping (file → specifier) needs exactly what resolution
    // omits. Pin the invariants rewrite tooling depends on.
    expect(EXTENSION_RESOLUTION.javascript).toContain('.mjs');
    expect(EXTENSION_RESOLUTION.typescript).toContain('/index.ts');
    expect(EXTENSION_RESOLUTION.python).toEqual(['.py', '/__init__.py']);
    expect(EXTENSION_RESOLUTION.rust).toEqual(['.rs', '/mod.rs']);
    for (const suffixes of Object.values(EXTENSION_RESOLUTION)) {
      expect(Array.isArray(suffixes)).toBe(true);
      expect(suffixes.length).toBeGreaterThan(0);
    }
  });
});
