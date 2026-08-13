import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installNode22SqliteWarningFilter,
  sensorNodeRuntimeFlags,
  SQLITE_EXPERIMENTAL_WARNING_FLAG,
  SQLITE_EXPERIMENTAL_WARNING_MESSAGE,
} from '../src/sensor-node-runtime.mjs';

test('Node 22だけnode:sqliteのExperimentalWarningを対象指定で抑止する', () => {
  assert.deepEqual(sensorNodeRuntimeFlags('22.22.0'), [SQLITE_EXPERIMENTAL_WARNING_FLAG]);
  assert.deepEqual(sensorNodeRuntimeFlags('24.11.0'), []);
  assert.deepEqual(sensorNodeRuntimeFlags('26.5.0'), []);
});

test('Node 22はSQLite警告だけを抑止し、他の警告とrestore後の動作を保つ', () => {
  const emitted = [];
  const processObject = {
    emitWarning(warning, ...args) {
      emitted.push([warning, ...args]);
    },
  };
  const restore = installNode22SqliteWarningFilter({
    nodeVersion: '22.22.0',
    processObject,
  });

  processObject.emitWarning(SQLITE_EXPERIMENTAL_WARNING_MESSAGE, 'ExperimentalWarning');
  processObject.emitWarning('another warning', 'Warning');
  assert.deepEqual(emitted, [['another warning', 'Warning']]);

  restore();
  processObject.emitWarning(SQLITE_EXPERIMENTAL_WARNING_MESSAGE, 'ExperimentalWarning');
  assert.equal(emitted.length, 2);
});
