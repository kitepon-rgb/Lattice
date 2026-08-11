import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { LatticeSensor } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/lattice-sensor.js');

describe('CLI exact traversal', () => {
  let repo: string;

  beforeAll(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-sensor-exact-traversal-'));
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/target.ts'), [
      'export function target(): number { return 1; }',
      'export function caller(): number { return target(); }',
      '',
    ].join('\n'));
    const sensor = LatticeSensor.initSync(repo);
    await sensor.indexAll();
    sensor.close();
  }, 60_000);

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('exact symbol＋pathのnodeだけを辿りresolutionをJSONへ明示する', () => {
    const stdout = execFileSync(process.execPath, [
      BIN, 'callers', 'target', '--path', repo, '--exact-path', 'src/target.ts', '--json',
    ], {
      encoding: 'utf8',
      env: { ...process.env, LATTICE_SENSOR_NO_DAEMON: '1', LATTICE_SENSOR_TELEMETRY: '0' },
    });
    const result = JSON.parse(stdout);
    expect(result.exactPath).toBe('src/target.ts');
    expect(result.exactResolution).toBe('ready');
    expect(result.callers.map(({ name }: { name: string }) => name)).toContain('caller');
  });

  it('path違いを空の成功へ丸めずabsentと明示する', () => {
    const stdout = execFileSync(process.execPath, [
      BIN, 'callees', 'target', '--path', repo, '--exact-path', 'src/other.ts', '--json',
    ], {
      encoding: 'utf8',
      env: { ...process.env, LATTICE_SENSOR_NO_DAEMON: '1', LATTICE_SENSOR_TELEMETRY: '0' },
    });
    expect(JSON.parse(stdout)).toMatchObject({
      exactPath: 'src/other.ts', exactResolution: 'absent', callees: [],
    });
  });
});
