import { randomBytes } from 'node:crypto';
import {
  lstat, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { gitCatFileBatch, gitSpawnSync } from './git-process.mjs';
import { TodoStoreError } from './todo-store.mjs';

const STORE_REF = '.lattice/todo';
const ATTRIBUTES_REF = '.lattice/.gitattributes';
const EOL_PROTECTION = '# Lattice store artifacts are canonical JSON+LF bytes; EOL conversion corrupts the store.\n* -text\n';
const INDEX_REFRESH_BATCH_SIZE = 40;

function fail(reason, detail = {}) {
  throw new TodoStoreError('STORE_EOL_REPAIR_UNSAFE', reason, undefined, detail);
}

async function regularFileState(absolute, ref) {
  let stats;
  try { stats = await lstat(absolute); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('artifact_unreadable', { ref, message: error.message });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) fail('unsafe_artifact_path', { ref });
  return stats;
}

async function assertSafeDirectoryChain(repoRoot, relative) {
  let absolute = repoRoot;
  let ref = '';
  for (const segment of relative.replaceAll('\\', '/').split('/')) {
    ref = path.posix.join(ref, segment);
    absolute = path.join(absolute, segment);
    let stats;
    try { stats = await lstat(absolute); } catch (error) {
      fail(error?.code === 'ENOENT' ? 'store_missing' : 'store_unreadable', {
        ref, message: error.message,
      });
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) fail('unsafe_artifact_path', { ref });
  }
  return absolute;
}

async function safeRegularFileState(repoRoot, ref) {
  await assertSafeDirectoryChain(repoRoot, path.posix.dirname(ref));
  return regularFileState(path.join(repoRoot, ref), ref);
}

async function collectArtifactRefs(repoRoot, relative = STORE_REF) {
  const absolute = await assertSafeDirectoryChain(repoRoot, relative);
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); } catch (error) {
    fail(error?.code === 'ENOENT' ? 'store_missing' : 'store_unreadable', {
      ref: relative, message: error.message,
    });
  }
  const refs = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const ref = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isSymbolicLink()) fail('unsafe_artifact_path', { ref });
    if (entry.isDirectory()) refs.push(...await collectArtifactRefs(repoRoot, ref));
    else if (entry.isFile() && /\.(?:json|jsonl)$/u.test(entry.name)) refs.push(ref);
    else if (!entry.isFile()) fail('unsafe_artifact_path', { ref });
  }
  return refs;
}

function normalizePureCrlf(bytes, ref) {
  if (!bytes.includes(13)) return null;
  const normalized = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 13) {
      normalized.push(byte);
      continue;
    }
    if (bytes[index + 1] !== 10) fail('artifact_not_pure_crlf_conversion', { ref });
  }
  return Buffer.from(normalized);
}

async function atomicReplace({ repoRoot, ref, absolute, sourceBytes, bytes, mode }) {
  await safeRegularFileState(repoRoot, ref);
  const currentBytes = await readFile(absolute);
  if (!currentBytes.equals(sourceBytes)) fail('artifact_changed_during_repair', { ref });
  const temporary = `${absolute}.eol-repair-${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: mode & 0o777 });
    await rename(temporary, absolute);
  } catch (error) {
    try { await rm(temporary, { force: true }); } catch { /* noop */ }
    fail('artifact_write_failed', { ref: path.basename(absolute), message: error.message });
  }
}

async function prepareProtection(repoRoot) {
  const absolute = path.join(repoRoot, ATTRIBUTES_REF);
  const stats = await safeRegularFileState(repoRoot, ATTRIBUTES_REF);
  if (stats === null) return { absolute, create: true };
  const text = await readFile(absolute, 'utf8');
  if (!text.split(/\r?\n/u).includes('* -text')) {
    fail('eol_protection_conflict', { ref: ATTRIBUTES_REF, required_rule: '* -text' });
  }
  return { absolute, create: false };
}

function stagedArtifactRefs(repoRoot, refs) {
  const staged = new Set();
  for (let offset = 0; offset < refs.length; offset += INDEX_REFRESH_BATCH_SIZE) {
    const batch = refs.slice(offset, offset + INDEX_REFRESH_BATCH_SIZE);
    const result = gitSpawnSync(['diff-index', '--cached', '--name-only', '-z', 'HEAD', '--', ...batch], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.signal || result.status !== 0) {
      fail('git_index_artifacts_unreadable', { refs: batch, status: result.status ?? null });
    }
    for (const ref of (result.stdout ?? '').split('\0')) {
      if (ref !== '') staged.add(ref.replaceAll('\\', '/'));
    }
  }
  return staged;
}

function refreshGitIndex(repoRoot, refs) {
  for (let offset = 0; offset < refs.length; offset += INDEX_REFRESH_BATCH_SIZE) {
    const batch = refs.slice(offset, offset + INDEX_REFRESH_BATCH_SIZE);
    const refresh = gitSpawnSync(['update-index', '--refresh', '--', ...batch], {
      cwd: repoRoot, stdio: 'ignore',
    });
    // 対象は呼出前にindex blob=HEADを実証済み。update-index --refreshで内容をstageせずstatだけを揃える。
    if (refresh.error || refresh.signal || ![0, 1].includes(refresh.status)) {
      fail('git_index_refresh_failed', { refs: batch, status: refresh.status ?? null });
    }
    const verified = gitSpawnSync(['diff-files', '--quiet', '--', ...batch], {
      cwd: repoRoot, stdio: 'ignore',
    });
    if (verified.error || verified.signal || verified.status !== 0) {
      fail('git_index_refresh_failed', { refs: batch, status: verified.status ?? null });
    }
  }
}

/**
 * Gitのcheckoutがcanonical LF artifactをCRLFへ変換した既存storeだけを修復する。
 * JSONの意味・順序・空白には触れず、CRLF除去後にcanonical byte列へ完全一致するfileだけを書く。
 */
export async function repairTodoStoreWorktreeEol({ repoRoot }) {
  const protection = await prepareProtection(repoRoot);
  const refs = await collectArtifactRefs(repoRoot);
  const stagedRefs = stagedArtifactRefs(repoRoot, refs);
  const artifacts = [];
  for (const ref of refs) {
    const absolute = path.join(repoRoot, ref);
    const stats = await safeRegularFileState(repoRoot, ref);
    const bytes = await readFile(absolute);
    const normalized = normalizePureCrlf(bytes, ref);
    artifacts.push({
      ref, absolute, sourceBytes: bytes, bytes: normalized ?? bytes, mode: stats.mode,
      converted: normalized !== null,
    });
  }

  let headArtifacts = [];
  let indexArtifacts = [];
  if (artifacts.length > 0) {
    const maxBodyBytes = Math.max(...artifacts.map(({ bytes }) => bytes.length));
    try {
      headArtifacts = gitCatFileBatch(artifacts.map(({ ref }) => `HEAD:${ref}`), {
        cwd: repoRoot, maxBodyBytes,
      });
    } catch (error) {
      fail('git_head_artifacts_unreadable', { message: error.message });
    }
    try {
      indexArtifacts = gitCatFileBatch(artifacts.map(({ ref }) => `:${ref}`), {
        cwd: repoRoot, maxBodyBytes,
      });
    } catch (error) {
      fail('git_index_artifacts_unreadable', { message: error.message });
    }
  }
  const converted = [];
  const refreshRefs = [];
  for (const [index, artifact] of artifacts.entries()) {
    const head = headArtifacts[index];
    const staged = indexArtifacts[index];
    if (artifact.converted) {
      if (head?.type !== 'blob' || !head.bytes.equals(artifact.bytes)) {
        fail('artifact_not_pure_checkout_conversion', { ref: artifact.ref });
      }
      if (stagedRefs.has(artifact.ref)
        || staged?.type !== 'blob' || !staged.bytes.equals(head.bytes)) {
        fail('artifact_staged_change_present', { ref: artifact.ref });
      }
      converted.push(artifact);
    }
    if (!stagedRefs.has(artifact.ref) && head?.type === 'blob' && staged?.type === 'blob'
      && staged.bytes.equals(head.bytes) && artifact.bytes.equals(head.bytes)) {
      refreshRefs.push(artifact.ref);
    }
  }

  for (const artifact of converted) {
    await atomicReplace({ repoRoot, ...artifact });
  }
  // 0.64.2がLF書換後のstat refreshで止まった部分状態も、再実行だけで回復させる。
  refreshGitIndex(repoRoot, refreshRefs);
  if (protection.create) {
    await assertSafeDirectoryChain(repoRoot, path.posix.dirname(ATTRIBUTES_REF));
    await writeFile(protection.absolute, EOL_PROTECTION, { flag: 'wx' });
  }

  return {
    repaired_refs: converted.map(({ ref }) => ref),
    protection_ref: ATTRIBUTES_REF,
    protection_created: protection.create,
  };
}
