#!/usr/bin/env node

import { buildBootstrapDiagnostics } from '../src/bootstrap.mjs';
import { runRuntimeCli } from '../src/runtime-cli.mjs';
import packageJson from '../package.json' with { type: 'json' };

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(`${packageJson.version}\n`);
} else if (args.length === 2 && args[0] === 'doctor' && args[1] === '--json') {
  process.stdout.write(`${JSON.stringify(buildBootstrapDiagnostics())}\n`);
} else if (args.length === 2 && args[0] === 'factory-diagnostics' && args[1] === '--json') {
  const { buildFactoryDiagnostics } = await import('../src/factory-diagnostics.mjs');
  const diagnostics = await buildFactoryDiagnostics();
  process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
  process.exitCode = diagnostics.overall === 'ok' ? 0 : 1;
} else {
  process.exitCode = await runRuntimeCli({
    argv: args,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
