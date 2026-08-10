import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

/** A concrete, currently-free port. LATTICE_HUB_PORT (unlike bridge's --port
  * auto) refuses 0/ephemeral by design, so tests need a real number too. */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const ENTRY = fileURLToPath(new URL('../bin/lattice-hub.mjs', import.meta.url));

function run(env, context) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const kill = setTimeout(() => child.kill('SIGKILL'), 2_000);
    child.once('exit', () => { clearTimeout(kill); resolve(); });
    child.kill('SIGTERM');
  }));
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

function waitForLine(getter) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const poll = () => {
      const text = getter();
      if (text.includes('\n')) { resolve(text); return; }
      if (Date.now() > deadline) { reject(new Error(`timed out waiting for output, got: ${text}`)); return; }
      setTimeout(poll, 20);
    };
    poll();
  });
}

test('LATTICE_HUB_PORT未設定はtypedエラーでexit 1する（silent defaultしない）', async (context) => {
  const { child, stderr } = run({
    LATTICE_HUB_PORT: '', LATTICE_HUB_ALLOWED_HOSTS: 'lattice.example.com',
  }, context);
  const code = await waitForExit(child);
  assert.equal(code, 1);
  assert.match(stderr(), /LATTICE_HUB_PORT_REQUIRED/u);
});

test('LATTICE_HUB_ALLOWED_HOSTS未設定はtypedエラーでexit 1する', async (context) => {
  const { child, stderr } = run({
    LATTICE_HUB_PORT: String(await freePort()), LATTICE_HUB_ALLOWED_HOSTS: '',
  }, context);
  const code = await waitForExit(child);
  assert.equal(code, 1);
  assert.match(stderr(), /LATTICE_HUB_ALLOWED_HOSTS_REQUIRED/u);
});

test('不正なLATTICE_HUB_LISTENはtypedエラーでexit 1する', async (context) => {
  const { child, stderr } = run({
    LATTICE_HUB_PORT: String(await freePort()), LATTICE_HUB_ALLOWED_HOSTS: 'lattice.example.com',
    LATTICE_HUB_LISTEN: 'not-an-ip',
  }, context);
  const code = await waitForExit(child);
  assert.equal(code, 1);
  assert.match(stderr(), /LATTICE_HUB_LISTEN_INVALID/u);
});

test('port 0（ephemeral）はCaddy上流が動いてしまうため明示的に拒否する', async (context) => {
  const { child, stderr } = run({
    LATTICE_HUB_PORT: '0', LATTICE_HUB_ALLOWED_HOSTS: 'lattice.example.com',
  }, context);
  const code = await waitForExit(child);
  assert.equal(code, 1);
  assert.match(stderr(), /LATTICE_HUB_PORT_INVALID/u);
});

test('妥当な環境変数で起動しSIGTERMで正常終了する', async (context) => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'lattice-hub-daemon-'));
  context.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const { child, stdout } = run({
    LATTICE_HUB_PORT: String(await freePort()), LATTICE_HUB_ALLOWED_HOSTS: 'lattice.example.com,127.0.0.1',
    LATTICE_HUB_RUNTIME_DIR: runtimeDir,
  }, context);
  const startedLine = await waitForLine(stdout);
  const started = JSON.parse(startedLine.trim().split('\n')[0]);
  assert.equal(started.schema, 'lattice.hub_daemon_started.v1');
  assert.equal(started.host, '127.0.0.1');
  assert.ok(Number.isSafeInteger(started.port) && started.port > 0);
  assert.deepEqual(started.allowed_hosts, ['127.0.0.1', 'lattice.example.com']);

  const response = await fetch(`http://127.0.0.1:${started.port}/projects/`, {
    headers: { accept: 'application/json' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);

  child.kill('SIGTERM');
  const code = await waitForExit(child);
  assert.equal(code, 0);
});
