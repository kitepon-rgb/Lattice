#!/usr/bin/env node

import {
  runWorkOrderAdapterController,
  WorkOrderAdapterControllerError,
} from '../src/runtime-work-order-controller.mjs';

try {
  await runWorkOrderAdapterController();
} catch (error) {
  const payload = {
    schema: 'lattice.work_order_adapter_error.v1',
    code: error instanceof WorkOrderAdapterControllerError
      ? error.code
      : 'WORK_ORDER_CONTROLLER_FAILED',
    message: String(error?.message ?? error),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
}
