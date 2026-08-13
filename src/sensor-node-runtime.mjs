import { spawnSync } from 'node:child_process';

export const SQLITE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const RELAUNCH_GUARD_ENV = 'LATTICE_SQLITE_WARNING_RELAUNCHED';

export function sensorNodeRuntimeFlags(nodeVersion = process.versions.node) {
  const major = Number(nodeVersion.split('.')[0]);
  return major === 22 ? [SQLITE_EXPERIMENTAL_WARNING_FLAG] : [];
}

export function node22RelaunchArgv(
  scriptPath,
  args,
  execArgv = process.execArgv,
  nodeVersion = process.versions.node,
) {
  const flags = sensorNodeRuntimeFlags(nodeVersion)
    .filter((flag) => !execArgv.includes(flag));
  return [...flags, ...execArgv, scriptPath, ...args];
}

/**
 * Node 22 prints node:sqlite's ExperimentalWarning to stderr. The CLI has a
 * JSON-only output contract, so relaunch before any command can import node:sqlite.
 */
export function relaunchForNode22IfNeeded({ args, scriptPath, env = process.env }) {
  const flags = sensorNodeRuntimeFlags();
  if (flags.length === 0
    || flags.every((flag) => process.execArgv.includes(flag))
    || env[RELAUNCH_GUARD_ENV] === '1') return null;

  const result = spawnSync(
    process.execPath,
    node22RelaunchArgv(scriptPath, args),
    {
      cwd: process.cwd(),
      env: { ...env, [RELAUNCH_GUARD_ENV]: '1' },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error) {
    process.stderr.write(`${JSON.stringify({
      schema: 'lattice.cli_error.v2',
      code: 'LATTICE_SENSOR_RELAUNCH_FAILED',
      message: result.error.message,
    })}\n`);
    return 1;
  }
  return result.status ?? 1;
}
