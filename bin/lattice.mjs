#!/usr/bin/env node

import { runRuntimeCli } from '../src/runtime-cli.mjs';
import packageJson from '../package.json' with { type: 'json' };

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(`${packageJson.version}\n`);
} else if (args.length === 2 && args[0] === 'status' && args[1] === '--json') {
  const { projectStatusFailure, runProjectStatus } = await import('../src/project-cli.mjs');
  try {
    process.exitCode = await runProjectStatus({
      cwd: process.cwd(), stdout: process.stdout, cliVersion: packageJson.version,
    });
  } catch (error) {
    process.exitCode = projectStatusFailure({
      cwd: process.cwd(), stdout: process.stdout, cliVersion: packageJson.version, error,
    });
  }
} else if (args.length === 4 && args[0] === 'plan' && args[1] === 'create' && args[2] === '--input') {
  const { projectCliFailure, runPlanCreate } = await import('../src/project-cli.mjs');
  try {
    process.exitCode = await runPlanCreate({ cwd: process.cwd(), inputRef: args[3], stdout: process.stdout });
  } catch (error) {
    process.exitCode = projectCliFailure(process.stderr, error);
  }
} else if (args.length === 4 && args[0] === 'plan' && args[1] === 'create'
  && args[2] === '--schema' && args[3] === '--json') {
  const { projectCliFailure, runPlanCreateSchema } = await import('../src/project-cli.mjs');
  try {
    process.exitCode = await runPlanCreateSchema({ stdout: process.stdout });
  } catch (error) {
    process.exitCode = projectCliFailure(process.stderr, error);
  }
} else if (args.length === 5 && args[0] === 'plan' && args[1] === 'create'
  && args[2] === '--schema-version' && args[3] === '2' && args[4] === '--json') {
  const { projectCliFailure, runPlanCreateSchema } = await import('../src/project-cli.mjs');
  try {
    process.exitCode = await runPlanCreateSchema({ stdout: process.stdout, version: 2 });
  } catch (error) {
    process.exitCode = projectCliFailure(process.stderr, error);
  }
} else if (args.length === 2 && args[0] === 'factory-diagnostics' && args[1] === '--json') {
  const { buildFactoryDiagnostics } = await import('../src/factory-diagnostics.mjs');
  const diagnostics = await buildFactoryDiagnostics();
  process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
  process.exitCode = diagnostics.overall === 'ok' ? 0 : 1;
} else if (args[0] === 'sensor') {
  const { runSensorCli } = await import('../src/sensor-cli.mjs');
  process.exitCode = await runSensorCli({
    argv: args.slice(1), stdout: process.stdout, stderr: process.stderr,
  });
} else if (args[0] === 'runtime-errors') {
  process.exitCode = await runRuntimeErrorsCli(args.slice(1));
} else if (args[0] === 'todo') {
  const { runTodoCli } = await import('../src/todo-cli.mjs');
  process.exitCode = await runTodoCli({
    argv: args.slice(1),
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
} else {
  try {
    process.exitCode = await runRuntimeCli({
      argv: args,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
    });
  } catch (error) {
    // typed契約（cli_error.v2＋exit 1/2）の外へ漏れた例外＝内部故障。opt-in時のみ観測を残す。
    const { observeRuntimeError } = await import('../src/runtime-errors.mjs');
    observeRuntimeError('LATTICE.CLI_INTERNAL_FAILED', { version: packageJson.version });
    process.stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2', code: 'INTERNAL_FAILURE', message: error?.constructor?.name ?? 'Error' })}\n`);
    process.exitCode = 1;
  }
}

async function runRuntimeErrorsCli(rest) {
  const runtimeErrors = await import('../src/runtime-errors.mjs');
  const usage = () => {
    process.stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2', code: 'USAGE', message: 'usage: lattice runtime-errors <snapshot [--after-cursor N] [--limit N]|ack <cursor>|diagnostics|resolve <fingerprint>|reopen <fingerprint>|compact> --json' })}\n`);
    return 2;
  };
  const options = { version: packageJson.version };
  if (rest.at(-1) !== '--json') return usage();
  const words = rest.slice(0, -1);
  try {
    let result;
    if (words[0] === 'snapshot') {
      let afterCursor = 0;
      let limit = 256;
      const flags = words.slice(1);
      while (flags.length > 0) {
        const flag = flags.shift();
        const raw = flags.shift();
        if (raw === undefined || !/^\d+$/.test(raw)) return usage();
        if (flag === '--after-cursor') afterCursor = Number(raw);
        else if (flag === '--limit') limit = Number(raw);
        else return usage();
      }
      result = runtimeErrors.runtimeErrorsSnapshot(afterCursor, limit, options);
    } else if (words[0] === 'ack' && words.length === 2 && /^\d+$/.test(words[1])) {
      result = runtimeErrors.acknowledgeRuntimeErrors(Number(words[1]), options);
    } else if (words[0] === 'diagnostics' && words.length === 1) {
      result = runtimeErrors.runtimeErrorsDiagnostics(options);
    } else if ((words[0] === 'resolve' || words[0] === 'reopen') && words.length === 2) {
      result = runtimeErrors.setRuntimeErrorStatus(words[1], words[0] === 'resolve' ? 'resolved' : 'open', options);
    } else if (words[0] === 'compact' && words.length === 1) {
      result = runtimeErrors.compactRuntimeErrors(options);
    } else {
      return usage();
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schema: 'lattice.cli_error.v2', code: 'RUNTIME_ERRORS_FAILED', message: error?.message ?? 'unknown' })}\n`);
    return 1;
  }
}
