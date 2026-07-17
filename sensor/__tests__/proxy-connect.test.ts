/**
 * Proxy connect resilience — issue #974.
 *
 * `connectWithHello` returns a live socket to the caller, which then attaches
 * its own onDaemonLost handler. Before #974, `readHelloLine` attached an
 * 'error' listener and REMOVED it on success, leaving a window where the socket
 * had no 'error' listener — and a socket 'error' with no listener is re-thrown
 * by Node as an uncaughtException, which the global fatal handler turns into
 * process.exit(1). To an MCP client that is a bare "Transport closed". The fix
 * keeps a guard 'error' listener attached for the socket's whole life.
 *
 * AF_UNIX over WSL2/DrvFs makes that window common; here we just prove the
 * invariant on a normal socket: the returned socket always has an 'error'
 * listener, and emitting an error on it never throws.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { connectWithHello } from '../src/mcp/proxy';
import { CodeGraphPackageVersion } from '../src/mcp/version';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) {
    try { cleanups.pop()!(); } catch { /* best-effort */ }
  }
});

/** Stand up a fake daemon that emits a valid hello line on connect. */
async function fakeDaemon(version: string): Promise<{ sockPath: string; server: net.Server }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-proxy-'));
  const sockPath = path.join(dir, 'd.sock');
  const server = net.createServer((socket) => {
    const hello = { codegraph: version, pid: process.pid, socketPath: sockPath, protocol: 1 };
    socket.write(JSON.stringify(hello) + '\n');
  });
  await new Promise<void>((resolve) => server.listen(sockPath, resolve));
  cleanups.push(() => server.close());
  cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  return { sockPath, server };
}

describe('connectWithHello — socket is never left without an error listener (#974)', () => {
  it.runIf(process.platform !== 'win32')('returns a socket that has an error listener and never throws on error', async () => {
    const { sockPath } = await fakeDaemon(CodeGraphPackageVersion);

    const result = await connectWithHello(sockPath);
    expect(result).not.toBeNull();
    expect(result).not.toBe('version-mismatch');

    const socket = result as net.Socket;
    cleanups.push(() => socket.destroy());

    // The invariant: a guard 'error' listener is attached for the socket's whole
    // life, so a stray socket error can't escalate to an uncaughtException.
    expect(socket.listenerCount('error')).toBeGreaterThanOrEqual(1);

    // Emitting an error must NOT throw. Without the guard this is exactly the
    // path that crashed the proxy with "Transport closed".
    expect(() => socket.emit('error', new Error('simulated ECONNRESET'))).not.toThrow();
  });

  // ADR 0049 Decision 5③: a hello version WITHOUT the `-lattice.` marker is a
  // DIFFERENT product (third-party CodeGraph) — 'foreign-product', not
  // 'version-mismatch'. Updated from the pre-ADR-0049 expectation (that test
  // predates product-identity separation, when any version mismatch meant
  // "the same product, a different build").
  it.runIf(process.platform !== 'win32')('reports foreign-product for a mismatch with no -lattice. marker (and that path does not throw)', async () => {
    const { sockPath } = await fakeDaemon('0.0.0-not-our-version');
    const result = await connectWithHello(sockPath);
    expect(result).toBe('foreign-product');
  });

  // ADR 0049 Decision 5③: a hello version WITH the marker but different from
  // ours is the SAME product at a different build (e.g. a self-update left a
  // stale daemon running) — safe to bisect to the pre-existing
  // 'version-mismatch' degrade-to-direct path.
  it.runIf(process.platform !== 'win32')('still reports version-mismatch for a same-product version skew (and that path does not throw)', async () => {
    const { sockPath } = await fakeDaemon('1.4.1-lattice.999');
    const result = await connectWithHello(sockPath);
    expect(result).toBe('version-mismatch');
  });

  it.runIf(process.platform !== 'win32')('returns null when no daemon is listening', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-proxy-none-'));
    cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
    const result = await connectWithHello(path.join(dir, 'missing.sock'));
    expect(result).toBeNull();
  });
});
