import { existsSync } from 'node:fs';
import path from 'node:path';
import sensorPackage from '../sensor/package.json' with { type: 'json' };
import { spawnSensorCli } from './sensor-runtime.mjs';

const MAX_CAPTURE_BYTES = 1024 * 1024;

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function usage(stderr) {
  writeJson(stderr, {
    schema: 'lattice.cli_error.v2',
    code: 'USAGE',
    message: 'usage: lattice sensor <init|sync> [path] --json',
  });
  return 2;
}

function parse(argv) {
  if (argv.at(-1) !== '--json') return null;
  const words = argv.slice(0, -1);
  if (!['init', 'sync'].includes(words[0]) || words.length > 2) return null;
  return { command: words[0], path: words[1] ?? '.' };
}

function execute(command, projectPath) {
  return new Promise((resolve, reject) => {
    let captured = 0;
    const hasIndex = existsSync(path.resolve(projectPath, '.lattice/sensor', 'sensor.db'));
    const sensorArgs = command === 'init' && hasIndex
      ? ['index', projectPath, '--quiet']
      : [command, projectPath];
    const child = spawnSensorCli(sensorArgs, {
      env: {
        ...process.env,
        LATTICE_SENSOR_NO_UPDATE_CHECK: '1',
        DO_NOT_TRACK: '1',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const observe = (chunk) => {
      captured += chunk.length;
      if (captured > MAX_CAPTURE_BYTES) child.kill('SIGTERM');
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, overflow: captured > MAX_CAPTURE_BYTES }));
  });
}

export async function runSensorCli({ argv, stdout, stderr }) {
  const request = parse(argv);
  if (!request) return usage(stderr);
  try {
    const result = await execute(request.command, request.path);
    if (result.code !== 0 || result.signal || result.overflow) {
      writeJson(stderr, {
        schema: 'lattice.cli_error.v2',
        code: result.overflow ? 'LATTICE_SENSOR_OUTPUT_LIMIT' : 'LATTICE_SENSOR_COMMAND_FAILED',
        message: `LatticeSensor ${request.command} failed`,
      });
      return 1;
    }
    writeJson(stdout, {
      schema: 'lattice.sensor_command_result.v1',
      provider: 'lattice',
      sensor_owner: 'lattice',
      sensor_version: sensorPackage.version,
      command: request.command,
      status: 'ok',
    });
    return 0;
  } catch (error) {
    writeJson(stderr, {
      schema: 'lattice.cli_error.v2',
      code: error?.code === 'LATTICE_SENSOR_UNAVAILABLE' ? error.code : 'LATTICE_SENSOR_COMMAND_FAILED',
      message: `LatticeSensor ${request.command} failed`,
    });
    return 1;
  }
}
