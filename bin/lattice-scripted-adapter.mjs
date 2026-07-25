#!/usr/bin/env node

import {
  runScriptedAdapterController,
  ScriptedAdapterControllerError,
} from '../src/runtime-scripted-adapter-controller.mjs';

try {
  await runScriptedAdapterController();
} catch (error) {
  const payload = {
    schema: 'lattice.scripted_adapter_error.v1',
    code: error instanceof ScriptedAdapterControllerError
      ? error.code
      : 'SCRIPTED_CONTROLLER_FAILED',
    message: String(error?.message ?? error),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
}
