/**
 * `latticeSensor affected` input-path normalization (#825).
 *
 * The index stores project-relative, forward-slash paths. A user (or a wrapping
 * script) may pass a `./`-prefixed path or an absolute path; before #825 those
 * silently matched nothing and reported 0 affected tests. All three spellings
 * must now resolve the same affected test file.
 *
 * Exercised end-to-end against the built binary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LatticeSensor } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/lattice-sensor.js');

function affected(cwd: string, arg: string): string[] {
  const out = execFileSync(process.execPath, [BIN, 'affected', arg, '--quiet', '-p', cwd], {
    encoding: 'utf-8',
    env: { ...process.env, LATTICE_SENSOR_NO_DAEMON: '1', LATTICE_SENSOR_WASM_RELAUNCHED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

describe('latticeSensor affected — input path normalization (#825)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-affected-paths-'));
    fs.mkdirSync(path.join(tempDir, 'src'));
    // util.ts <- helper.ts <- helper.test.ts (transitive test dependency)
    fs.writeFileSync(path.join(tempDir, 'src/util.ts'), 'export function util(x: number){ return x + 1; }\n');
    fs.writeFileSync(
      path.join(tempDir, 'src/helper.ts'),
      "import { util } from './util';\nexport function helper(){ return util(1); }\n",
    );
    fs.writeFileSync(
      path.join(tempDir, 'src/helper.test.ts'),
      "import { helper } from './helper';\ntest('t', () => helper());\n",
    );
    const cg = LatticeSensor.initSync(tempDir);
    await cg.indexAll();
    cg.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('bare-relative, ./-prefixed, and absolute paths all resolve the same affected test', () => {
    const expected = ['src/helper.test.ts'];
    // Baseline that always worked.
    expect(affected(tempDir, 'src/util.ts')).toEqual(expected);
    // Both of these returned [] before the normalization fix.
    expect(affected(tempDir, './src/util.ts')).toEqual(expected);
    expect(affected(tempDir, path.join(tempDir, 'src/util.ts'))).toEqual(expected);
  });
});

describe('latticeSensor affected — Swift test classification', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-affected-swift-'));
    fs.mkdirSync(path.join(tempDir, 'Sources', 'Feature'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'Tests', 'FeatureTests'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'Sources', 'Feature', 'Feature.swift'),
      'public struct Feature { public init() {} }\n');
    fs.writeFileSync(path.join(tempDir, 'Tests', 'FeatureTests', 'FeatureTests.swift'), [
      'import XCTest',
      '@testable import Feature',
      'final class FeatureTests: XCTestCase {',
      '  func testFeature() { _ = Feature() }',
      '}',
      '',
    ].join('\n'));
    const cg = LatticeSensor.initSync(tempDir);
    await cg.indexAll();
    cg.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('includes a changed Tests/.../*Tests.swift file itself', () => {
    expect(affected(tempDir, 'Tests/FeatureTests/FeatureTests.swift'))
      .toEqual(['Tests/FeatureTests/FeatureTests.swift']);
  });

  it('discovers a dependent Swift test from a Sources file', () => {
    expect(affected(tempDir, 'Sources/Feature/Feature.swift'))
      .toEqual(['Tests/FeatureTests/FeatureTests.swift']);
  });
});
