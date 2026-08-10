/**
 * A content-addressed cache in front of `readTodoStoreStable`, for long-running
 * processes (the dashboard daemon) that re-render on every request/poll and would
 * otherwise re-validate the whole merged store every time.
 *
 * An earlier version keyed the cache on a stat()-derived fingerprint (dev/ino/size/
 * mtimeMs/ctimeMs). On filesystems with coarse mtime granularity (observed on
 * WSL/DrvFs), two different manifest contents written close together can land on the
 * same fingerprint, so the cache would serve a stale store as current — and since the
 * mismatch never surfaces as an error, nothing invalidates it until the process
 * restarts. Hashing the manifest's actual bytes costs one small file read and removes
 * that failure mode entirely.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readTodoStoreStable } from './todo-store.mjs';

async function manifestContentDigest(manifestRef) {
  return createHash('sha256').update(await readFile(manifestRef)).digest('hex');
}

/**
 * @param {object} [options]
 * @param {(options: object) => Promise<object>} [options.readStable] injection point for tests
 */
export function createTodoStoreCache({ readStable = readTodoStoreStable } = {}) {
  const cache = new Map();
  return {
    async read(repoRoot) {
      const manifestRef = path.join(repoRoot, '.lattice', 'todo', 'manifest.json');
      const digest = await manifestContentDigest(manifestRef);
      const cached = cache.get(repoRoot);
      if (cached?.digest === digest) return cached.store;
      // Read before caching: a failure here (including the store's own inconsistency
      // detection) must not populate the cache, so the very next call re-reads instead
      // of serving a poisoned entry.
      const store = await readStable({ repoRoot });
      cache.set(repoRoot, { digest, store });
      return store;
    },
  };
}
