import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sensorNodeRuntimeFlags,
  node22RelaunchArgv,
  SQLITE_EXPERIMENTAL_WARNING_FLAG,
} from '../src/sensor-node-runtime.mjs';

test('Node 22だけnode:sqliteのExperimentalWarningを対象指定で抑止する', () => {
  assert.deepEqual(sensorNodeRuntimeFlags('22.22.0'), [SQLITE_EXPERIMENTAL_WARNING_FLAG]);
  assert.deepEqual(sensorNodeRuntimeFlags('24.11.0'), []);
  assert.deepEqual(sensorNodeRuntimeFlags('26.5.0'), []);
});

test('Node 22再起動は全CLIの引数と既存Node引数を保ちwarning flagを重複させない', () => {
  assert.deepEqual(
    node22RelaunchArgv('/repo/bin/lattice.mjs', ['sensor', 'diff'], ['--trace-uncaught'], '22.22.0'),
    [SQLITE_EXPERIMENTAL_WARNING_FLAG, '--trace-uncaught', '/repo/bin/lattice.mjs', 'sensor', 'diff'],
  );
  assert.deepEqual(
    node22RelaunchArgv('/repo/bin/lattice.mjs', ['sensor'], [SQLITE_EXPERIMENTAL_WARNING_FLAG], '22.22.0'),
    [SQLITE_EXPERIMENTAL_WARNING_FLAG, '/repo/bin/lattice.mjs', 'sensor'],
  );
  assert.deepEqual(
    node22RelaunchArgv('/repo/bin/lattice.mjs', ['todo', 'status', '--json'], [], '22.22.0'),
    [SQLITE_EXPERIMENTAL_WARNING_FLAG, '/repo/bin/lattice.mjs', 'todo', 'status', '--json'],
  );
});
