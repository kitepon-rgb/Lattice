import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateNodeVersionGuard } from '../../src/node-version-guard.mjs';

// ADR 0049 Decision 8 — lattice-mcp bin契約の統合検証（実プロセス）。
//
//   ① stdoutはMCP protocol frame専用（診断は全てstderr）
//   ② 内部daemon再invoke形（`serve --mcp --path <root>` + CODEGRAPH_DAEMON_INTERNAL）
//      を受理する — daemon spawn（sensor/src/mcp/index.ts `spawnDetachedDaemon`）が
//      `process.argv[1]` を再invokeするため、lattice-mcp.mjs経由でも同じ形で
//      daemon化できることを実測する
//   ③ 起動前usage違反=exit 2
//
// CLI 6面（bin/lattice.mjs）とは別の公理系であることが前提— このファイルは
// lattice-mcp.mjs だけを対象にする。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCP_BIN = path.join(REPO_ROOT, 'bin', 'lattice-mcp.mjs');
const SENSOR_CLI = path.join(REPO_ROOT, 'sensor', 'dist', 'bin', 'codegraph.js');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // CODEGRAPH_ALLOW_UNSAFE_NODE: this fixture setup runs the sensor's own
    // CLI directly (not the globally-installed `codegraph`), which carries a
    // Node-version guard (#81, a real V8/turboshaft OOM bug on Node 25.x) —
    // irrelevant to the fixture's `init` call and unrelated to the MCP surface
    // under test here, so it's overridden for this harness only.
    env: { ...process.env, NO_COLOR: '1', CODEGRAPH_ALLOW_UNSAFE_NODE: '1' },
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function scaffoldIndexedRepo(root) {
  run('git', ['init', '--quiet', '--initial-branch=main'], root);
  await writeFile(path.join(root, 'a.mjs'), 'export const a = 1;\n');
  run('git', ['-c', 'user.email=mcp@example.invalid', '-c', 'user.name=mcp', 'add', '.'], root);
  run('git', [
    '-c', 'user.email=mcp@example.invalid', '-c', 'user.name=mcp',
    'commit', '--quiet', '-m', 'lattice-mcp smoke fixture',
  ], root);
  run(process.execPath, [SENSOR_CLI, 'init', '.'], root);
}

/** A minimal line-delimited JSON-RPC client over a spawned MCP server's stdio. */
function jsonRpcClient(child) {
  let buf = '';
  const lines = [];
  const rawChunks = [];
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    rawChunks.push(text);
    buf += text;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) lines.push(line);
    }
  });
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  const waitForId = async (id, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const line of lines) {
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (parsed && parsed.id === id && (parsed.result !== undefined || parsed.error !== undefined)) {
          return parsed;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for response id=${id}; raw stdout so far:\n${rawChunks.join('')}`);
  };
  return { send, waitForId, lines };
}

async function waitForFile(filePath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// Node version guard(④, lattice-mcp.mjs)は起動時にargv解析より前に走るため、
// このusage違反テストはCODEGRAPH_ALLOW_UNSAFE_NODEでガードを迂回する — でない
// とテスト実行ホストのNodeがサポート対象外の場合、usage違反(exit 2)に届く前に
// version guardのblock(exit 1)で止まってしまう。ガードそのものの境界は
// test/node-version-guard.test.mjsで固定している。
const UNSAFE_NODE_ENV = { ...process.env, CODEGRAPH_ALLOW_UNSAFE_NODE: '1' };

test('lattice-mcp: 未知のフラグはstartup前のusage違反としてexit 2', () => {
  const result = spawnSync(process.execPath, [MCP_BIN, '--totally-unknown-flag'], { encoding: 'utf8', env: UNSAFE_NODE_ENV });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  // ホストNodeがサポート対象外の場合、override有効でも可視化のためbannerが
  // 先に書かれる(sensor CLIと同一意味論)。よってusage違反メッセージが必ず
  // stderrの絶対先頭に来るとは限らないため、行頭一致で見る。
  assert.match(result.stderr, /^lattice-mcp:/m);
});

test('lattice-mcp: --path に値が無いのはusage違反でexit 2', () => {
  const result = spawnSync(process.execPath, [MCP_BIN, '--path'], { encoding: 'utf8', env: UNSAFE_NODE_ENV });
  assert.equal(result.status, 2);
});

test(
  'lattice-mcp: initialize→codegraph_status往復でstdoutが純粋なJSON-RPC、serverInfo versionがLattice系列、mode/reasonが機械可読',
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lattice-mcp-smoke-'));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    await scaffoldIndexedRepo(root);

    // Direct mode (CODEGRAPH_NO_DAEMON=1) — no detached daemon process to leak
    // out of this particular test; the daemon re-invoke path has its own test.
    const child = spawn(process.execPath, [MCP_BIN, '--path', root], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // CODEGRAPH_ALLOW_UNSAFE_NODE: same override as UNSAFE_NODE_ENV above —
      // this exercises the JSON-RPC round trip regardless of whether the
      // test-runner's own Node major happens to be inside the supported
      // range; the version guard's block/override boundary is covered
      // separately (test/node-version-guard.test.mjs, plus the dedicated
      // spawn test below).
      env: { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_ALLOW_UNSAFE_NODE: '1' },
    });
    t.after(() => { try { child.kill(); } catch { /* already gone */ } });
    const client = jsonRpcClient(child);

    client.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lattice-mcp-integration-test', version: '0.0.0' },
      },
    });
    const initResp = await client.waitForId(1);
    assert.equal(initResp.error, undefined, JSON.stringify(initResp));
    assert.equal(initResp.result.serverInfo.version, '1.4.1-lattice.1');

    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    client.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'codegraph_status', arguments: {} },
    });
    const statusResp = await client.waitForId(2);
    assert.equal(statusResp.error, undefined, JSON.stringify(statusResp));
    const text = statusResp.result.content[0].text;
    assert.match(text, /mode: direct/);
    assert.match(text, /reason: opt-out/);

    // stdout purity (ADR 0049 Decision 8①): every line the process emitted on
    // stdout — across both responses — must be a standalone parseable
    // JSON-RPC frame. Any inherited-code stdout write (upstream update-check
    // notice, stray console.log, …) would break this.
    assert.ok(client.lines.length >= 2, 'expected at least the initialize + tools/call responses');
    for (const line of client.lines) {
      assert.doesNotThrow(() => JSON.parse(line), `non-JSON stdout line: ${line}`);
    }
  },
);

test(
  'lattice-mcp: daemon経由起動でspawnDetachedDaemonのprocess.argv[1]再invokeがlattice-mcp自身を指し、正しくdaemon化する',
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lattice-mcp-daemon-'));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    await scaffoldIndexedRepo(root);

    // No CODEGRAPH_NO_DAEMON here — the normal proxy path, which spawns the
    // shared daemon by re-invoking `process.argv[1]` (this bin) with
    // `serve --mcp --path <root>` + CODEGRAPH_DAEMON_INTERNAL=1 (see
    // sensor/src/mcp/index.ts spawnDetachedDaemon). If lattice-mcp.mjs
    // rejected that re-invoke form, the daemon could never bind and this
    // project would be silently pinned to direct mode forever.
    // CODEGRAPH_ALLOW_UNSAFE_NODE is set on the launcher's own env — the
    // daemon re-invoke (spawnDetachedDaemon) inherits `process.env` when it
    // re-execs this same bin (sensor/src/mcp/index.ts), so this override
    // propagates to both the launcher AND the detached daemon it spawns.
    const child = spawn(process.execPath, [MCP_BIN, '--path', root], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEGRAPH_ALLOW_UNSAFE_NODE: '1' },
    });
    t.after(() => { try { child.kill(); } catch { /* already gone */ } });
    const client = jsonRpcClient(child);

    client.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lattice-mcp-daemon-integration-test', version: '0.0.0' },
      },
    });
    await client.waitForId(1);

    const pidPath = path.join(root, '.codegraph', 'daemon.pid');
    const bound = await waitForFile(pidPath, 10000);
    assert.ok(bound, `daemon did not bind within 10s (pidfile never appeared at ${pidPath}) — the internal re-invoke form was not accepted`);

    const lock = JSON.parse(readFileSync(pidPath, 'utf8'));
    assert.equal(lock.version, '1.4.1-lattice.1');
    t.after(() => { try { process.kill(lock.pid, 'SIGTERM'); } catch { /* already gone */ } });
  },
);

test(
  'lattice-mcp: override無し・サポート対象外Nodeでのspawnはexit 1 + stderrにlattice.cli_error.v2(code=NODE_VERSION_UNSUPPORTED)',
  () => {
    // 実プロセスのNode majorはこのテストランナーのNode binaryそのもの —
    // 差し替えできない。CIは(package.json記載どおり)Node 22で走るため、通常
    // このホストではガードがblockしない側(サポート対象内)になり、この分岐は
    // 早期returnでskipする。境界(24/25/20/19、override有無)はすべて
    // test/node-version-guard.test.mjsのunit testで固定済み。
    // このホスト(開発機、Node 26系)のようにサポート対象外Nodeで動く場合だけ、
    // override無し経路のexit 1 + lattice.cli_error.v2を実プロセスで確認する。
    const guard = evaluateNodeVersionGuard(process.versions.node, false);
    if (!guard.blocked) {
      return;
    }

    const result = spawnSync(process.execPath, [MCP_BIN, '--path', '/does/not/matter'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');

    const lines = result.stderr.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    const payload = JSON.parse(jsonLine);
    assert.equal(payload.schema, 'lattice.cli_error.v2');
    assert.equal(payload.code, 'NODE_VERSION_UNSUPPORTED');
    assert.match(payload.message, /Unsupported Node\.js version/);
  },
);
