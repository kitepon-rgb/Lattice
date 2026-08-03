import { spawnSync } from 'node:child_process';

export const SQLITE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const RELAUNCH_GUARD_ENV = 'LATTICE_SENSOR_SQLITE_WARNING_RELAUNCHED';

export function sensorNodeRuntimeFlags(nodeVersion = process.versions.node) {
  const major = Number(nodeVersion.split('.')[0]);
  return major === 22 ? [SQLITE_EXPERIMENTAL_WARNING_FLAG] : [];
}

export function sensorRelaunchArgv(
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
 * Node 22 prints node:sqlite's ExperimentalWarning to stderr. Sensor commands
 * have a strict JSON-only stderr contract, so relaunch only that command
 * surface with Node's warning-category flag before node:sqlite is imported.
 */
export function relaunchSensorForNode22IfNeeded({ args, scriptPath, env = process.env }) {
  const flags = sensorNodeRuntimeFlags();
  if (args[0] !== 'sensor'
    || flags.length === 0
    || flags.every((flag) => process.execArgv.includes(flag))
    || env[RELAUNCH_GUARD_ENV] === '1') return null;

  const result = spawnSync(
    process.execPath,
    sensorRelaunchArgv(scriptPath, args),
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
