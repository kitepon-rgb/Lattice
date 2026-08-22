import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { digestArtifact } from './artifact-contracts.mjs';

/**
 * RC3-F diff observer（ADR 0044 Decision 5、plan RC3-F）。
 *
 * disposable worktreeの実diffを、bounded canonical checkpoint recordへ変換する。
 * git diffがwriteの一次sensor（plan「path／resource binding」）であり、executor
 * 自己申告を診断入力にしない。observed pathはdeclared scope／他TODOのdeclared write
 * へcross-bindされ、宣言外writeと運転中overlapを別findingで検出する。
 *
 * - symlink・submodule・special fileの変更はfail closed（isolation-runner規律の継承）。
 * - 過大diff（entry数・byte数）は黙って切り詰めずreject。
 * - commit・branch作成等の禁止操作はHEAD driftとして検出しfail loudする。
 */

const MAX_DIFF_ENTRIES = 256;
const MAX_TRACKED_FILE_BYTES = 4_194_304;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const LINE_ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/;

/**
 * gitignore 済みのコンパイラ／ツール出力 directory 名。
 * 観測から外すのは ignored かつこの segment を持つ path だけ。
 * tracked な `bin/`（CLI の正本）は status code が `!!` ではないので残る。
 * gitignore 迂回の検知（ignored なソース相当 file）は残す。
 */
export const GENERATED_OUTPUT_DIR_NAMES = Object.freeze([
  'obj', 'bin', 'node_modules', '.vs', 'TestResults',
  '__pycache__', '.pytest_cache', 'dist', 'coverage',
]);

export function isGeneratedOutputPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return false;
  return relativePath.replace(/\/$/u, '').split('/').some(
    (segment) => GENERATED_OUTPUT_DIR_NAMES.includes(segment),
  );
}

function isIgnoredStatus(code) {
  return typeof code === 'string' && code.includes('!');
}

function keepObservedEntry(entry) {
  if (!isIgnoredStatus(entry.code)) return true;
  return !isGeneratedOutputPath(entry.path);
}

function fail(reason) {
  throw new TypeError(`diff observer契約違反: ${reason}`);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, cwd, { allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (allowExitCodes.includes(code) && signal === null) {
        resolve(Object.assign(Buffer.concat(stdout), { code }));
      }
      else {
        reject(new TypeError(
          `${command} ${args[0]} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ));
      }
    });
  });
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MAX_PATH_BYTES = 1_024;

// receipt契約（runtime-contracts repoRelativePath）と同じbyte-safe規律を使う。
function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= MAX_PATH_BYTES
    && !CONTROL_CHARACTER.test(value)
    && !value.includes('\\')
    && !path.posix.isAbsolute(value)
    && value === path.posix.normalize(value)
    && !value.split('/').includes('..');
}

function statusEntries(statusBytes) {
  const fields = statusBytes.toString('utf8').split('\0');
  const entries = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const code = field.slice(0, 2);
    const entryPath = field.slice(3);
    if (code[0] === 'R' || code[0] === 'C') {
      // renameは移動先(added)＋移動元(deleted)へ分解する。copyは複製先だけが
      // 変更で、複製元は残るため分解しない。
      const source = fields[++index];
      entries.push({ path: entryPath, code });
      if (code[0] === 'R') entries.push({ path: source, code: ' D' });
      continue;
    }
    entries.push({ path: entryPath, code });
  }
  return entries;
}

function changeKind(code, exists) {
  if (!exists) return 'deleted';
  if (code.includes('?') || code.includes('!') || code.includes('A')
    || code[0] === 'R' || code[0] === 'C') {
    return 'added';
  }
  return 'modified';
}

async function assertBaseEntryRegular(worktreePath, baseSha, entryPath) {
  // 削除entryはbase側のmodeを検査する（symlink/submodule/specialの削除も
  // fail closed。isolation-runner規律の継承）。
  const tree = await run('git', ['ls-tree', '-z', baseSha, '--', entryPath], worktreePath);
  if (tree.length === 0) return;
  const mode = tree.toString('utf8').slice(0, 6);
  if (mode === '120000') fail(`symlink changeは許可されない: ${entryPath}`);
  if (mode === '160000') fail(`submodule changeは許可されない: ${entryPath}`);
  if (mode !== '100644' && mode !== '100755') fail(`special file changeは許可されない: ${entryPath}`);
}

async function entryRecord(worktreePath, baseSha, entry) {
  const absolutePath = path.join(worktreePath, entry.path);
  let stat = null;
  try {
    stat = await lstat(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (stat !== null) {
    if (stat.isSymbolicLink()) fail(`symlink changeは許可されない: ${entry.path}`);
    if (!stat.isFile()) fail(`special file changeは許可されない: ${entry.path}`);
    if (stat.size > MAX_TRACKED_FILE_BYTES) fail(`変更fileが上限byteを超える: ${entry.path}`);
  } else {
    await assertBaseEntryRegular(worktreePath, baseSha, entry.path);
  }
  return {
    path: entry.path,
    change: changeKind(entry.code, stat !== null),
    content_digest: stat === null ? null : sha256(await readFile(absolutePath)),
  };
}

/**
 * worktreeの実diffをbounded canonical recordへ変換する。
 *
 * HEADはbaseの子孫へ進んでよい（＝workerが自分のworktreeでcommitしてよい）。進んだ分は
 * `base..HEAD`として観測へ含める。子孫でない位置へ動いた場合——reset、branch切替、rebase——は
 * 観測の前提が壊れるのでfail loudする（ADR 0139）。
 *
 * commitを一律禁止していた頃は、進行中の成果が未commitのままworktreeにしか存在せず、
 * 再計画がその変更を含まないsourceに対して行われていた。
 */
export async function captureWorktreeDiff(options = {}) {
  if (!exactRecord(options, ['worktreePath', 'baseSha'])) {
    fail('captureWorktreeDiff optionsがexact shapeでない');
  }
  const { worktreePath, baseSha } = options;
  if (typeof worktreePath !== 'string' || worktreePath.length === 0 || !GIT_SHA1.test(baseSha ?? '')) {
    fail('worktreePath／baseShaが不正');
  }
  const head = (await run('git', ['rev-parse', 'HEAD'], worktreePath)).toString('utf8').trim();
  if (head !== baseSha) {
    const descendant = await run('git', ['merge-base', '--is-ancestor', baseSha, head], worktreePath, {
      allowExitCodes: [0, 1],
    });
    if (descendant.code !== 0) {
      fail(`worktree HEADがbaseの子孫でない（reset・branch切替・rebase）: ${head}`);
    }
  }
  // ignored fileへのwriteもwrite sensorの対象にする（gitignore経由の
  // scope violation迂回を塞ぐ。isolation-runnerと同じ--ignored=matching）。
  // ただし obj/bin/node_modules 等のコンパイラ出力は成果ではない。
  // 展開すると MAX_DIFF_ENTRIES を踏み、accept が undeclared_write で hold する。
  const statusBytes = await run('git', [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
  ], worktreePath);
  const entries = statusEntries(statusBytes).filter(keepObservedEntry);
  // commit済みの変更はstatusへ出ない。base..HEADの範囲も観測へ入れないと、
  // commitした瞬間に変更が観測から消える。
  if (head !== baseSha) {
    const committed = await run('git', [
      'diff', '--name-status', '--no-renames', '-z', `${baseSha}..${head}`,
    ], worktreePath);
    const fields = committed.toString('utf8').split('\0').filter((field) => field.length > 0);
    for (let index = 0; index + 1 < fields.length; index += 2) {
      entries.push({ path: fields[index + 1], code: `${fields[index][0]} ` });
    }
  }
  if (entries.length > MAX_DIFF_ENTRIES) {
    fail(`diff entry数が上限を超える: ${entries.length}`);
  }
  // ignored directoryは`!! dir/`の集約entryで届くため、内包fileへ展開する
  // （集約のまま扱うとdirectoryをspecial file扱いで落とし、write pathを特定できない）。
  const expanded = [];
  for (const entry of entries) {
    if (isIgnoredStatus(entry.code) && isGeneratedOutputPath(entry.path)) continue;
    if (!entry.path.endsWith('/')) {
      expanded.push(entry);
      continue;
    }
    const inner = await run('git', [
      'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', entry.path,
    ], worktreePath);
    for (const innerPath of inner.toString('utf8').split('\0')) {
      if (innerPath.length === 0) continue;
      const innerEntry = { path: innerPath, code: entry.code };
      if (!keepObservedEntry(innerEntry)) continue;
      expanded.push(innerEntry);
    }
  }
  if (expanded.length > MAX_DIFF_ENTRIES) {
    fail(`diff entry数が上限を超える: ${expanded.length}`);
  }
  const seen = new Set();
  const records = [];
  for (const entry of expanded) {
    if (!safeRelativePath(entry.path)) fail(`不正なchanged path: ${entry.path}`);
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    records.push(await entryRecord(worktreePath, baseSha, entry));
  }
  records.sort((left, right) => (left.path < right.path ? -1 : 1));
  // 観測中のHEAD移動（TOCTOU）を閉じる: 収集後に再確認する。
  const headAfter = (await run('git', ['rev-parse', 'HEAD'], worktreePath)).toString('utf8').trim();
  if (headAfter !== head) {
    fail(`観測中にworktree HEADが動いた: ${headAfter}`);
  }
  const record = {
    schema: 'lattice.checkpoint_diff.v2',
    base_sha: baseSha,
    // 生み出した木そのものを記録へ縛る。入力側のdigestだけでは、進行中の成果が
    // どの状態だったかを後から指せない。
    head_sha: head,
    entries: records,
  };
  return {
    checkpoint_digest: digestArtifact(record),
    diff: record,
  };
}

/**
 * 宣言writeがobserved pathを覆うか。末尾`/`はprefixとして読む。
 *
 * I/O sentinelの早期警報も同じ述語を使う（ADR 0143）。警報とcheckpoint findingで
 * 述語が分かれると、「警報は出たがcheckpointでは競合にならない」種類のずれが生まれ、
 * どちらが正しいのか誰にも分からなくなる。
 */
export function coveredBy(declaredWrites, observedPath) {
  // 宣言はファイルにも素のディレクトリ名（`templates` 等）にも成り得る。末尾 `/` の時だけ
  // prefix 扱いにすると、境界内で作った配下ファイルが全部 undeclared_write になる
  // （2026-08-22 実測: accept のたびに hold → worker SIGSTOP で卓が凍った）。
  return declaredWrites.some((declared) => {
    if (declared === observedPath) return true;
    const prefix = declared.endsWith('/') ? declared : `${declared}/`;
    return observedPath.startsWith(prefix);
  });
}

function lineGroupsFor(manifests, todoIds) {
  if (!plainRecord(manifests)) fail('boundary manifestsが不正');
  const groups = new Map();
  for (const todoId of [...new Set(todoIds)].sort()) {
    const manifest = manifests[todoId];
    if (!plainRecord(manifest) || !Array.isArray(manifest.lines ?? [])) {
      fail(`boundary manifestのlinesが不正: ${todoId}`);
    }
    const seen = new Set();
    for (const line of manifest.lines ?? []) {
      if (!exactRecord(line, ['line_id', 'role', 'anchors'])
        || !LINE_ID.test(line.line_id ?? '')
        || !['reads', 'writes'].includes(line.role)
        || !Array.isArray(line.anchors) || line.anchors.length === 0
        || seen.has(line.line_id)) {
        fail(`line宣言が不正: ${todoId}`);
      }
      seen.add(line.line_id);
      const group = groups.get(line.line_id) ?? {
        readers: new Set(), writers: new Set(), anchorPaths: new Set(),
      };
      group[line.role === 'reads' ? 'readers' : 'writers'].add(todoId);
      for (const anchor of line.anchors) {
        const valid = anchor?.kind === 'path'
          ? exactRecord(anchor, ['kind', 'path']) && safeRelativePath(anchor.path)
          : anchor?.kind === 'symbol'
            && exactRecord(anchor, ['kind', 'name', 'path'])
            && typeof anchor.name === 'string' && anchor.name.length > 0
            && safeRelativePath(anchor.path);
        if (!valid) fail(`line anchorが不正: ${todoId}/${line.line_id}`);
        // symbol解決は実行時diffに存在しないので、初期実装では宣言済みpathへ近似する。
        group.anchorPaths.add(anchor.path);
      }
      groups.set(line.line_id, group);
    }
  }
  return groups;
}

/**
 * checkpoint diffのobserved pathをdeclared scope／他running TODOのdeclared writeへ
 * cross-bindし、closed conflict分類のfindingを返す（producer側の検出。独立再計算は
 * runtime-decision-verifierの`classifyObservedDiff`が行う）。
 *
 * - undeclared_write: 宣言write scope外へのwrite（offender=当該TODO）。
 * - observed_write_conflict: 他のrunning TODOのdeclared writeとのpath overlap。
 */
export function detectCheckpointFindings(options = {}) {
  if (!exactRecord(options, ['todoId', 'checkpoint', 'packets', 'manifests', 'runningTodoIds'])) {
    fail('detectCheckpointFindings optionsがexact shapeでない');
  }
  const { todoId, checkpoint, packets, manifests, runningTodoIds } = options;
  if (!plainRecord(checkpoint) || !plainRecord(checkpoint.diff) || !Array.isArray(checkpoint.diff.entries)) {
    fail('checkpoint diff recordが不正');
  }
  const packet = packets[todoId];
  if (!plainRecord(packet) || !plainRecord(packet.scope) || !Array.isArray(packet.scope.writes)) {
    fail(`packetが不正: ${todoId}`);
  }
  const manifest = manifests[todoId];
  if (!plainRecord(manifest) || !Array.isArray(manifest.writes)) {
    fail(`boundary manifestが不正: ${todoId}`);
  }
  // findingはverifier（classifyObservedDiff）と同じper-path shapeで返す。
  const findings = [];
  for (const entry of [...checkpoint.diff.entries].sort((l, r) => (l.path < r.path ? -1 : 1))) {
    if (!coveredBy(manifest.writes, entry.path)) {
      findings.push({ kind: 'undeclared_write', todo_ids: [todoId], path: entry.path });
    }
  }
  for (const otherId of [...runningTodoIds].sort()) {
    if (otherId === todoId) continue;
    const other = packets[otherId];
    if (!plainRecord(other) || !plainRecord(other.scope) || !Array.isArray(other.scope.writes)) {
      fail(`packetが不正: ${otherId}`);
    }
    const otherManifest = manifests[otherId];
    if (!plainRecord(otherManifest) || !Array.isArray(otherManifest.writes)) {
      fail(`boundary manifestが不正: ${otherId}`);
    }
    for (const entry of [...checkpoint.diff.entries].sort((l, r) => (l.path < r.path ? -1 : 1))) {
      if (coveredBy(otherManifest.writes, entry.path)) {
        findings.push({
          kind: 'observed_write_conflict',
          todo_ids: [todoId, otherId].sort(),
          path: entry.path,
        });
      }
    }
  }
  const observedPaths = new Set(checkpoint.diff.entries.map((entry) => entry.path));
  for (const [lineId, group] of lineGroupsFor(
    manifests, [todoId, ...runningTodoIds],
  )) {
    if (group.writers.has(todoId)) continue;
    const readers = [...group.readers].filter((readerId) => readerId !== todoId).sort();
    if (readers.length === 0
      || ![...group.anchorPaths].some((anchorPath) => observedPaths.has(anchorPath))) continue;
    findings.push({
      kind: 'observed_line_change',
      todo_ids: [todoId, ...readers].sort(),
      resource_id: lineId,
    });
  }
  return { findings };
}
