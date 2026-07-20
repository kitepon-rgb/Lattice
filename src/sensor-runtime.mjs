import { spawn, spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LATTICE_SENSOR_CLI = fileURLToPath(
  new URL('../sensor/dist/bin/codegraph.js', import.meta.url),
);

export class SensorRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SensorRuntimeError';
    this.code = 'LATTICE_SENSOR_UNAVAILABLE';
  }
}

function assertBundledSensor() {
  try {
    const info = lstatSync(LATTICE_SENSOR_CLI);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file');
  } catch (error) {
    throw new SensorRuntimeError(`bundled sensor is unavailable: ${error.message}`);
  }
}

export function sensorCliInvocation(args) {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new TypeError('sensor args must be an array of strings');
  }
  assertBundledSensor();
  return Object.freeze({ command: process.execPath, args: Object.freeze([LATTICE_SENSOR_CLI, ...args]) });
}

export function invokeSensorCli(run, args, options) {
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  const invocation = sensorCliInvocation(args);
  return run(invocation.command, invocation.args, options);
}

export function spawnSensorCli(args, options = {}) {
  const invocation = sensorCliInvocation(args);
  return spawn(invocation.command, invocation.args, { ...options, shell: false });
}

export function spawnSensorCliSync(args, options = {}) {
  const invocation = sensorCliInvocation(args);
  return spawnSync(invocation.command, invocation.args, { ...options, shell: false });
}
