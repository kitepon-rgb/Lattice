/**
 * MCP shared engine — the heavyweight, *shared* state for an MCP server:
 * the project's {@link LatticeSensor} instance, file watcher, and the
 * {@link ToolHandler} cache for cross-project queries.
 *
 * One engine, many sessions:
 * - direct mode (single stdio session) instantiates one engine + one session;
 * - daemon mode instantiates one engine and a new session per socket
 *   connection. Every session reads from the same SQLite WAL and the same
 *   inotify watch set — that's the entire point of issue #411.
 */

import * as os from 'os';
import type LatticeSensor from '../index';
import { findNearestLatticeSensorRoot } from '../directory';
import { watchDisabledReason } from '../sync';
import { ToolHandler } from './tools';
import { QueryPool, resolvePoolSize } from './query-pool';

// Lazy-load the heavy LatticeSensor chain (sqlite + query/graph/context layers) OFF
// the MCP startup path. It's only needed once a tool actually opens a project —
// not to answer initialize/tools-list — so deferring it lets `serve --mcp` (and
// the daemon it spawns) bind + register tools in ~Node-startup time instead of
// ~800ms, closing the "No such tool available" cold-start race that made headless
// agents flounder. require() is sync + cached on the CommonJS build.
const loadLatticeSensor = (): typeof import('../index').default =>
  (require('../index') as typeof import('../index')).default;

export interface MCPEngineOptions {
  /**
   * Whether to start the file watcher when initializing. Daemon and direct
   * modes both want this true; tests may set it false to keep the engine
   * cheap. Honors {@link watchDisabledReason} regardless.
   */
  watch?: boolean;
  /**
   * Whether to off-load read-tool dispatch to a worker-thread pool. Only the
   * SHARED daemon wants this — it serves many concurrent clients on one event
   * loop, so without a pool concurrent explores serialize and starve the MCP
   * transport. Direct mode (one stdio client, no concurrency) leaves it off so a
   * single call never pays a worker round-trip. `LATTICE_SENSOR_QUERY_POOL_SIZE=0`
   * disables it even in daemon mode.
   */
  queryPool?: boolean;
}

/**
 * Shared MCP engine. Thread-safe in the sense that multiple sessions can
 * call its methods concurrently — internally it serializes initialization
 * through a single promise so multiple sessions racing each other on first
 * connect never double-open the SQLite file.
 */
export class MCPEngine {
  private cg: LatticeSensor | null = null;
  private toolHandler: ToolHandler;
  // Project root we resolved to. Null until `ensureInitialized` succeeds
  // (or null forever if no .lattice/sensor/ ever turned up — that's a valid
  // state for the engine, since cross-project queries still work).
  private projectPath: string | null = null;
  // Set on first `ensureInitialized` so subsequent sessions don't redo work.
  private initPromise: Promise<void> | null = null;
  private watcherStarted = false;
  private opts: Required<MCPEngineOptions>;
  private closed = false;
  // Off-loop read-tool pool (daemon mode only). Created lazily once the default
  // project is open — workers each hold their own WAL read connection.
  private queryPool: QueryPool | null = null;

  constructor(opts: MCPEngineOptions = {}) {
    this.opts = { watch: opts.watch ?? true, queryPool: opts.queryPool ?? false };
    this.toolHandler = new ToolHandler(null);
  }

  /**
   * Start the worker-thread query pool once a default project is open (daemon
   * mode only; honors `LATTICE_SENSOR_QUERY_POOL_SIZE`). Idempotent and best-effort:
   * if workers can't spawn on this platform the ToolHandler keeps serving reads
   * in-process, so the pool can only help, never break, tool calls.
   */
  private maybeStartPool(root: string): void {
    if (!this.opts.queryPool || this.queryPool || this.closed) return;
    const size = resolvePoolSize(process.env.LATTICE_SENSOR_QUERY_POOL_SIZE, os.cpus().length);
    if (size <= 0) {
      process.stderr.write('[LatticeSensor MCP] Query pool disabled (LATTICE_SENSOR_QUERY_POOL_SIZE=0); serving reads in-process.\n');
      return;
    }
    try {
      this.queryPool = new QueryPool({ root, size });
      this.toolHandler.setQueryPool(this.queryPool);
      process.stderr.write(`[LatticeSensor MCP] Query pool: up to ${size} worker thread(s) for concurrent reads.\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[LatticeSensor MCP] Query pool unavailable (${msg}); serving reads in-process.\n`);
      this.queryPool = null;
    }
  }

  /**
   * Convenience for {@link MCPServer} compatibility: pre-seed an explicit
   * project path (from the `--path` CLI flag) without yet opening it. This
   * keeps the synchronous constructor cheap; the actual open happens on the
   * first `ensureInitialized` call.
   */
  setProjectPathHint(projectPath: string): void {
    this.projectPath = projectPath;
    this.toolHandler.setDefaultProjectHint(projectPath);
  }

  /** Project root that the engine resolved on first init (null if none). */
  getProjectPath(): string | null {
    return this.projectPath;
  }

  /** Shared ToolHandler — sessions delegate tool dispatch through this. */
  getToolHandler(): ToolHandler {
    return this.toolHandler;
  }

  /**
   * ADR 0049 Decision 5④: record this engine's execution mode (`daemon` vs.
   * `direct` + a typed reason), delegated straight through to the
   * ToolHandler so `lattice_sensor_status` can report it. Callers: `MCPServer`
   * (direct mode), `Daemon` (daemon mode), and the local-handshake proxy's
   * fallback engine (direct mode, various reasons).
   */
  setExecutionMode(mode: 'daemon' | 'direct', reason: string): void {
    this.toolHandler.setExecutionMode(mode, reason);
  }

  /** Whether the default project's LatticeSensor is open. */
  hasDefaultLatticeSensor(): boolean {
    return this.toolHandler.hasDefaultLatticeSensor();
  }

  /**
   * Walk up from `searchFrom` to find the nearest `.lattice/sensor/` and open it.
   * Idempotent: concurrent callers share one in-flight init; subsequent
   * callers after success are no-ops.
   *
   * The original `MCPServer.tryInitializeDefault` carried the same retry-on-
   * subsequent-tool-call semantics; we preserve them by NOT throwing when the
   * search misses (just leaves `cg` null so the next call can retry).
   */
  async ensureInitialized(searchFrom: string): Promise<void> {
    if (this.closed) return;
    if (this.toolHandler.hasDefaultLatticeSensor()) return;
    if (this.initPromise) {
      try { await this.initPromise; } catch { /* let caller retry */ }
      return;
    }

    this.initPromise = this.doInitialize(searchFrom).finally(() => {
      this.initPromise = null;
    });
    try {
      await this.initPromise;
    } catch {
      // Init errors are logged inside `doInitialize`; falling through here
      // matches MCPServer's previous "retry on next tool call" behavior.
    }
  }

  /**
   * Synchronous last-resort init used by the per-session retry loop when the
   * background `ensureInitialized` already finished (or failed) and we need
   * to pick up a project that appeared *after* the engine started.
   */
  retryInitializeSync(searchFrom: string): void {
    if (this.closed) return;
    if (this.toolHandler.hasDefaultLatticeSensor()) return;
    this.toolHandler.setDefaultProjectHint(searchFrom);
    const resolvedRoot = findNearestLatticeSensorRoot(searchFrom);
    if (!resolvedRoot) return;
    try {
      // Close any previously failed instance to avoid leaking resources.
      if (this.cg) {
        try { this.cg.close(); } catch { /* ignore */ }
        this.cg = null;
      }
      this.cg = loadLatticeSensor().openSync(resolvedRoot);
      this.projectPath = resolvedRoot;
      this.toolHandler.setDefaultLatticeSensor(this.cg);
      this.startWatching();
      this.catchUpSync();
      this.maybeStartPool(resolvedRoot);
    } catch (err) {
      // ADR 0049 Decision 5②: a `.lattice/sensor/` root WAS found (this is the
      // retry-sync path, only reached once `findNearestLatticeSensorRoot`
      // succeeded above) but opening it failed — a genuine malfunction (DB
      // open error, schema mismatch, integrity error, lock contention), not
      // "no index". Record it so the next tool call fails closed instead of
      // silently reading as NotIndexedError's success-shaped "run lattice sensor
      // init" guidance. Still failing — caller will try again on the next
      // tool call, which re-attempts the open (clearing this on success).
      this.toolHandler.setOpenFailure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Close everything. Used on graceful daemon shutdown (SIGTERM/idle timeout)
   * and on direct-mode stop. Idempotent.
   */
  stop(): void {
    if (this.closed) return;
    this.closed = true;
    // Detach + terminate the worker pool first so no tool call routes to a
    // worker mid-teardown; outstanding pool calls resolve with graceful guidance.
    this.toolHandler.setQueryPool(null);
    if (this.queryPool) {
      void this.queryPool.destroy();
      this.queryPool = null;
    }
    this.toolHandler.closeAll();
    if (this.cg) {
      try { this.cg.close(); } catch { /* ignore */ }
      this.cg = null;
    }
  }

  private async doInitialize(searchFrom: string): Promise<void> {
    this.toolHandler.setDefaultProjectHint(searchFrom);

    const resolvedRoot = findNearestLatticeSensorRoot(searchFrom);
    if (!resolvedRoot) {
      // No .lattice/sensor/ above searchFrom. Sessions may still discover one later via roots/list
      this.projectPath = searchFrom;
      return;
    }

    this.projectPath = resolvedRoot;
    try {
      this.cg = await loadLatticeSensor().open(resolvedRoot);
      this.toolHandler.setDefaultLatticeSensor(this.cg);
      this.startWatching();
      this.catchUpSync();
      this.maybeStartPool(resolvedRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[LatticeSensor MCP] Failed to open project at ${resolvedRoot}: ${msg}\n`);
      // ADR 0049 Decision 5②: `.lattice/sensor/` WAS found (findNearestLatticeSensorRoot
      // succeeded above) but opening it threw — fail closed on the next tool
      // call instead of letting `getLatticeSensor()`'s default-not-loaded branch
      // read this as "no index" and hand back success-shaped guidance. The
      // stderr line above stays for operators tailing logs; this is the
      // machine-readable half, consumed by ToolHandler.getLatticeSensor().
      this.toolHandler.setOpenFailure(err instanceof Error ? err : new Error(msg));
    }
  }

  /**
   * Start file watching on the active LatticeSensor instance. Idempotent — the
   * watcher is per-engine, not per-session, which is why the daemon path
   * collapses N inotify sets to one. The wording of the disabled-reason log
   * exactly matches the prior in-tree implementation so log-driven dashboards
   * keep working.
   */
  private startWatching(): void {
    if (!this.cg || this.watcherStarted || !this.opts.watch) return;

    const disabledReason = watchDisabledReason(this.projectPath ?? process.cwd());
    if (disabledReason) {
      process.stderr.write(
        `[LatticeSensor MCP] File watcher disabled — ${disabledReason}. ` +
        `The graph will not auto-update; run \`lattice sensor sync . --json\` (or initialize via \`lattice sensor init . --json\`) to refresh.\n`
      );
      this.watcherStarted = true;
      return;
    }

    // Optional override for the debounce window via env var (issue #403).
    // Useful for workspaces with bursty writes (formatter-on-save chains,
    // large generated outputs) where the 2s default fires too often. Clamped
    // to [100ms, 60s]; out-of-range / non-numeric values fall back to the
    // FileWatcher default. We log the active value so it's discoverable.
    const debounceMs = parseDebounceEnv(process.env.LATTICE_SENSOR_WATCH_DEBOUNCE_MS);
    if (debounceMs !== undefined) {
      process.stderr.write(`[LatticeSensor MCP] File watcher debounce: ${debounceMs}ms (LATTICE_SENSOR_WATCH_DEBOUNCE_MS)\n`);
    }

    const started = this.cg.watch({
      debounceMs,
      onSyncComplete: (result) => {
        if (result.filesChanged > 0) {
          process.stderr.write(
            `[LatticeSensor MCP] Auto-synced ${result.filesChanged} file(s) in ${result.durationMs}ms\n`
          );
        }
      },
      onSyncError: (err) => {
        process.stderr.write(`[LatticeSensor MCP] Auto-sync error: ${err.message}\n`);
      },
      onDegraded: (reason) => {
        // Live watching gave up permanently (watch-resource exhaustion or a
        // write lock held past the retry budget). Say so loudly and ONCE — the
        // graph will no longer auto-update, so a long-running MCP session must
        // not keep assuming it's fresh. The reason already names the remedy
        // (`lattice sensor sync . --json` / git sync hooks).
        process.stderr.write(`[LatticeSensor MCP] File watcher degraded — ${reason}\n`);
      },
    });

    this.watcherStarted = true;
    if (started) {
      process.stderr.write('[LatticeSensor MCP] File watcher active — graph will auto-sync on changes\n');
    } else {
      process.stderr.write(
        '[Lattice sensor] File watcher unavailable on this platform — run `lattice sensor sync . --json` to refresh the graph after changes.\n'
      );
    }
  }

  /**
   * Reconcile the index with the current filesystem once, right after open —
   * catches edits, adds, deletes, and `git pull`/`checkout` changes made while
   * no watcher was running. Runs in the background, but the returned promise
   * is pushed into the ToolHandler as a one-shot gate so the *first* tool
   * call awaits completion before serving (without this, a tool call that
   * races past sync returns rows for files that no longer exist on disk —
   * and the per-file staleness banner can't help because `getPendingFiles()`
   * is populated by the watcher, not by catch-up).
   */
  private catchUpSync(): void {
    const cg = this.cg;
    if (!cg) return;
    const p = cg
      .sync()
      .then((result) => {
        const changed = result.filesAdded + result.filesModified + result.filesRemoved;
        if (changed > 0) {
          process.stderr.write(`[LatticeSensor MCP] Caught up ${changed} file(s) changed since last run\n`);
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[LatticeSensor MCP] Catch-up sync failed: ${msg}\n`);
      });
    this.toolHandler.setCatchUpGate(p);
  }
}

/**
 * Parse and clamp the LATTICE_SENSOR_WATCH_DEBOUNCE_MS env override.
 *
 * Issue #403: workspaces with bursty writes (formatter-on-save, multi-file
 * refactors) sometimes want a longer quiet window before sync. Returns
 * `undefined` for unset / empty / non-numeric / out-of-range values so the
 * FileWatcher default (2000ms) takes over — never throws.
 *
 * Clamp range: 100ms (faster would mean a sync per keystroke) to 60s (longer
 * and the watcher feels broken). Out-of-range values are treated as "ignore
 * this misconfiguration" rather than capped, since silently capping a 0 or
 * a typoed value would mask a real config bug.
 */
export function parseDebounceEnv(raw: string | undefined): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (n < 100 || n > 60000) return undefined;
  return n;
}
