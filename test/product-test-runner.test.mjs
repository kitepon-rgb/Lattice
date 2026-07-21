import assert from 'node:assert/strict';
import test from 'node:test';

import { productTestEnvironment } from '../scripts/run-product-tests.mjs';

test('product test child envはFORCE_COLORを除去しdashboard autostartを無効化する', () => {
  const parentEnv = {
    PATH: '/fixture/bin',
    FORCE_COLOR: '1',
    NO_COLOR: '1',
    LATTICE_DASHBOARD_AUTOSTART: '1',
  };

  const childEnv = productTestEnvironment(parentEnv);

  assert.equal(Object.hasOwn(childEnv, 'FORCE_COLOR'), false);
  assert.equal(childEnv.NO_COLOR, '1');
  assert.equal(childEnv.LATTICE_DASHBOARD_AUTOSTART, '0');
  assert.equal(childEnv.PATH, '/fixture/bin');
  assert.deepEqual(parentEnv, {
    PATH: '/fixture/bin',
    FORCE_COLOR: '1',
    NO_COLOR: '1',
    LATTICE_DASHBOARD_AUTOSTART: '1',
  });
});
