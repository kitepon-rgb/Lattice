#!/usr/bin/env node

import { buildBootstrapDiagnostics } from '../src/bootstrap.mjs';
import packageJson from '../package.json' with { type: 'json' };

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(`${packageJson.version}\n`);
} else if (args.length === 2 && args[0] === 'doctor' && args[1] === '--json') {
  process.stdout.write(`${JSON.stringify(buildBootstrapDiagnostics())}\n`);
} else {
  const received = args.length === 0 ? '(none)' : args.join(' ');
  process.stderr.write(`lattice: unsupported command or arguments: ${received}\n`);
  process.exitCode = 1;
}
