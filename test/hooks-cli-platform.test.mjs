import assert from 'node:assert/strict';
import test from 'node:test';

import { runHooksCli } from '../src/hooks-cli.mjs';

function captureStdout() {
  return {
    output: '',
    write(chunk) {
      this.output += String(chunk);
      return true;
    },
  };
}

test('native Windowsでは全hooks commandが同じtyped unsupported契約を返す', async () => {
  for (const host of ['claude', 'codex', 'cursor']) {
    for (const command of ['install', 'status', 'uninstall', 'emit']) {
      const stdout = captureStdout();
      const status = await runHooksCli({
        argv: [command, '--host', host],
        stdout,
        platform: 'win32',
      });
      assert.equal(status, 1, `${host} ${command}`);
      assert.deepEqual(JSON.parse(stdout.output), {
        schema: 'lattice.hooks_error.v1',
        code: 'HOST_PLATFORM_UNSUPPORTED',
        message: 'native Windows hooks are unsupported',
      }, `${host} ${command}`);
    }
  }
});
