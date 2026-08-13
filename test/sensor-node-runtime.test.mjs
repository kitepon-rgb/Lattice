import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installSqliteExperimentalWarningFilter,
  sensorNodeRuntimeFlags,
  SQLITE_EXPERIMENTAL_WARNING_FLAG,
  SQLITE_EXPERIMENTAL_WARNING_MESSAGE,
} from '../src/sensor-node-runtime.mjs';

test('node:sqliteがexperimentalのNode 22/24だけ警告抑止flagを付ける', () => {
  assert.deepEqual(sensorNodeRuntimeFlags('22.22.0'), [SQLITE_EXPERIMENTAL_WARNING_FLAG]);
  assert.deepEqual(sensorNodeRuntimeFlags('24.14.0'), [SQLITE_EXPERIMENTAL_WARNING_FLAG]);
  assert.deepEqual(sensorNodeRuntimeFlags('26.5.0'), []);
});

test('対象NodeはSQLite警告だけを抑止し、他の警告とrestore後の動作を保つ', () => {
  const emitted = [];
  const processObject = {
    emitWarning(warning, ...args) {
      emitted.push([warning, ...args]);
    },
  };
  const restore = installSqliteExperimentalWarningFilter({
    nodeVersion: '24.14.0',
    processObject,
  });

  processObject.emitWarning(SQLITE_EXPERIMENTAL_WARNING_MESSAGE, 'ExperimentalWarning');
  processObject.emitWarning('another warning', 'Warning');
  assert.deepEqual(emitted, [['another warning', 'Warning']]);

  restore();
  processObject.emitWarning(SQLITE_EXPERIMENTAL_WARNING_MESSAGE, 'ExperimentalWarning');
  assert.equal(emitted.length, 2);
});
