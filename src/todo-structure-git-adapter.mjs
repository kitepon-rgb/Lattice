import { isUtf8 } from 'node:buffer';

import { gitSpawnSync } from './git-process.mjs';
import { compareSensorIndexes } from './sensor-diff.mjs';
import { digestTodoArtifact, isTodoRef, todoSelfDigest } from './todo-contracts.mjs';
import {
  explainTodoStructureRealization,
  explainTodoStructureSet,
} from './todo-structure-contracts.mjs';

export const TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA = 'lattice.todo_structure_git_provenance.v1';
export const TODO_STRUCTURE_GIT_LIMITS = Object.freeze({
  commits: 512,
  changes: 4_096,
  changedLines: 5_000_000,
  sensorDetailsPerBucket: 200,
});

const SHA = /^[0-9a-f]{40}$/u;
const RAW_HEADER = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])(\d{0,3})$/u;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class TodoStructureGitError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoStructureGitError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail = {}) {
  throw new TodoStructureGitError(code, reason, detail);
}

function assertStructureSet(structureSet) {
  const result = explainTodoStructureSet(structureSet);
  if (!result.valid) fail('STRUCTURE_GIT_INPUT_INVALID', result.reason, { path: result.path });
}

function defaultRunGit({ args, cwd, maxBuffer = 64 * 1024 * 1024 }) {
  return gitSpawnSync(args, {
    cwd, encoding: null, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitResult(run, cwd, args, { allow = [0], maxBuffer = 64 * 1024 * 1024 } = {}) {
  let result;
  try {
    result = run({ args, cwd, maxBuffer });
  } catch (error) {
    fail('STRUCTURE_GIT_COMMAND_FAILED', 'git_command_spawn_failed', {
      operation: args[0], cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isPlain(result) || !allow.includes(result.status) || result.signal !== null
    || !(Buffer.isBuffer(result.stdout) || typeof result.stdout === 'string')) {
    fail('STRUCTURE_GIT_COMMAND_FAILED', 'git_command_failed', {
      operation: args[0], status: result?.status ?? null, signal: result?.signal ?? null,
    });
  }
  return {
    ...result,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'utf8'),
  };
}

function runGit(run, cwd, args, options = {}) {
  return gitResult(run, cwd, args, options).stdout;
}

function utf8(buffer, operation) {
  if (!isUtf8(buffer)) fail('STRUCTURE_GIT_PATH_ENCODING_UNSUPPORTED', 'git_output_not_utf8', { operation });
  return buffer.toString('utf8');
}

function stripRecordNewlines(value) {
  return value.replace(/^\n+/u, '').replace(/\n+$/u, '');
}

function shallowRepository(run, cwd) {
  return utf8(runGit(run, cwd, ['rev-parse', '--is-shallow-repository']), 'shallow')
    .trim() === 'true';
}

function resolveGitIdentity(run, cwd, baselineSha, { requireClean }) {
  if (requireClean) {
    const dirty = runGit(run, cwd, [
      'status', '--porcelain=v1', '-z', '--untracked-files=all',
    ]);
    if (dirty.length > 0) {
      fail('STRUCTURE_GIT_WORKTREE_DIRTY', 'worktree_not_clean', {
        changed_entries: dirty.toString('utf8').split('\0').filter(Boolean).length,
        next_action: 'commit_or_stash_then_retry',
      });
    }
  }
  const headSha = utf8(runGit(run, cwd, ['rev-parse', '--verify', 'HEAD^{commit}']), 'head').trim();
  if (!SHA.test(headSha)) fail('STRUCTURE_GIT_HEAD_INVALID', 'git_head_invalid', { actual: headSha });

  const baseline = gitResult(run, cwd, ['cat-file', '-e', `${baselineSha}^{commit}`], {
    allow: [0, 1, 128], maxBuffer: 1_024,
  });
  if (baseline.status !== 0) {
    const shallow = shallowRepository(run, cwd);
    fail(shallow ? 'STRUCTURE_GIT_BASELINE_SHALLOW' : 'STRUCTURE_GIT_BASELINE_UNREACHABLE',
      shallow ? 'baseline_missing_from_shallow_history' : 'baseline_commit_unreachable',
      { baseline_sha: baselineSha });
  }
  const ancestor = gitResult(run, cwd, ['merge-base', '--is-ancestor', baselineSha, headSha], {
    allow: [0, 1], maxBuffer: 1_024,
  });
  if (ancestor.status === 1) {
    const shallow = shallowRepository(run, cwd);
    fail(shallow ? 'STRUCTURE_GIT_BASELINE_SHALLOW' : 'STRUCTURE_GIT_BASELINE_NOT_ANCESTOR',
      shallow ? 'baseline_ancestry_incomplete_in_shallow_history' : 'baseline_not_ancestor',
      { baseline_sha: baselineSha, head_sha: headSha });
  }
  return headSha;
}

function parseRevisionList(text) {
  const commits = text.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [commitOid, ...parents] = line.split(' ');
    if (!SHA.test(commitOid) || !parents.every((oid) => SHA.test(oid))) {
      fail('STRUCTURE_GIT_OUTPUT_INVALID', 'rev_list_output_invalid');
    }
    return { commit_oid: commitOid, parent_oids: parents };
  });
  if (commits.length > TODO_STRUCTURE_GIT_LIMITS.commits) {
    fail('STRUCTURE_GIT_HISTORY_TOO_LARGE', 'commit_count_exceeds_limit', {
      actual: commits.length, limit: TODO_STRUCTURE_GIT_LIMITS.commits,
    });
  }
  return commits;
}

function logSections(buffer, operation) {
  const text = utf8(buffer, operation);
  const sections = new Map();
  for (const raw of text.split('\x1e').slice(1)) {
    const separator = raw.indexOf('\0');
    if (separator === -1) fail('STRUCTURE_GIT_OUTPUT_INVALID', 'git_log_section_invalid', { operation });
    const commitOid = stripRecordNewlines(raw.slice(0, separator));
    if (!SHA.test(commitOid) || sections.has(commitOid)) {
      fail('STRUCTURE_GIT_OUTPUT_INVALID', 'git_log_commit_invalid', { operation });
    }
    sections.set(commitOid, raw.slice(separator + 1).split('\0'));
  }
  return sections;
}

function parseRawChanges(buffer) {
  const sections = logSections(buffer, 'raw_diff');
  const changesByCommit = new Map();
  for (const [commitOid, tokens] of sections) {
    const changes = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const header = stripRecordNewlines(tokens[index]);
      if (header === '') continue;
      const matched = RAW_HEADER.exec(header);
      if (matched === null) fail('STRUCTURE_GIT_OUTPUT_INVALID', 'raw_diff_header_invalid', { commit_oid: commitOid });
      const [, oldMode, newMode, oldOid, newOid, status, score] = matched;
      const firstPath = tokens[++index];
      if (!isTodoRef(firstPath)) {
        fail('STRUCTURE_GIT_OUTPUT_INVALID', 'raw_diff_path_missing', { commit_oid: commitOid });
      }
      const renamed = ['R', 'C'].includes(status);
      const secondPath = renamed ? tokens[++index] : null;
      if (renamed && !isTodoRef(secondPath)) {
        fail('STRUCTURE_GIT_OUTPUT_INVALID', 'raw_diff_second_path_missing', { commit_oid: commitOid });
      }
      changes.push({
        status,
        score: score === '' ? null : Number(score),
        path: renamed ? secondPath : firstPath,
        previous_path: renamed ? firstPath : null,
        old_mode: oldMode,
        new_mode: newMode,
        old_oid: oldOid,
        new_oid: newOid,
      });
    }
    changesByCommit.set(commitOid, changes);
  }
  return changesByCommit;
}

function parseNumstat(buffer) {
  const sections = logSections(buffer, 'numstat');
  const statsByCommit = new Map();
  for (const [commitOid, tokens] of sections) {
    const stats = new Map();
    for (const token of tokens) {
      const record = stripRecordNewlines(token);
      if (record === '') continue;
      const first = record.indexOf('\t');
      const second = record.indexOf('\t', first + 1);
      if (first <= 0 || second <= first + 1) {
        fail('STRUCTURE_GIT_OUTPUT_INVALID', 'numstat_record_invalid', { commit_oid: commitOid });
      }
      const addedText = record.slice(0, first);
      const deletedText = record.slice(first + 1, second);
      const filePath = record.slice(second + 1);
      if (!isTodoRef(filePath) || stats.has(filePath)) {
        fail('STRUCTURE_GIT_OUTPUT_INVALID', 'numstat_path_invalid', { commit_oid: commitOid });
      }
      const binary = addedText === '-' && deletedText === '-';
      if (!binary && (!/^\d+$/u.test(addedText) || !/^\d+$/u.test(deletedText))) {
        fail('STRUCTURE_GIT_OUTPUT_INVALID', 'numstat_count_invalid', { commit_oid: commitOid });
      }
      const linesAdded = binary ? null : Number(addedText);
      const linesDeleted = binary ? null : Number(deletedText);
      if (!binary && (!Number.isSafeInteger(linesAdded) || !Number.isSafeInteger(linesDeleted))) {
        fail('STRUCTURE_GIT_OUTPUT_INVALID', 'numstat_count_unsafe', { commit_oid: commitOid });
      }
      stats.set(filePath, {
        binary,
        lines_added: linesAdded,
        lines_deleted: linesDeleted,
      });
    }
    statsByCommit.set(commitOid, stats);
  }
  return statsByCommit;
}

function fileKind(oldMode, newMode) {
  const modes = [oldMode, newMode].filter((mode) => mode !== '000000');
  if (modes.includes('160000')) return 'submodule';
  if (modes.includes('120000')) return 'symlink';
  if (modes.every((mode) => ['100644', '100755'].includes(mode))) return 'regular';
  return 'special';
}

function changeKind(status) {
  return ({ A: 'add', M: 'modify', D: 'delete', R: 'rename', C: 'copy', T: 'type_change' })[status]
    ?? 'unknown';
}

function buildChangesets(commits, rawByCommit, statsByCommit) {
  let totalChanges = 0;
  let totalChangedLines = 0;
  const changesets = commits.map(({ commit_oid: commitOid, parent_oids: parentOids }) => {
    const raw = rawByCommit.get(commitOid) ?? [];
    const stats = statsByCommit.get(commitOid) ?? new Map();
    const changes = raw.map((entry) => {
      const stat = stats.get(entry.path) ?? (entry.previous_path === null ? undefined : stats.get(entry.previous_path));
      const kind = fileKind(entry.old_mode, entry.new_mode);
      if (stat !== undefined && !stat.binary) {
        totalChangedLines += stat.lines_added + stat.lines_deleted;
      }
      return {
        change: changeKind(entry.status),
        status: entry.status,
        path: entry.path,
        previous_path: entry.previous_path,
        similarity: entry.score,
        old_mode: entry.old_mode,
        new_mode: entry.new_mode,
        old_oid: entry.old_oid,
        new_oid: entry.new_oid,
        file_kind: kind,
        binary: kind === 'regular' && stat !== undefined ? stat.binary : null,
        lines_added: stat?.lines_added ?? null,
        lines_deleted: stat?.lines_deleted ?? null,
      };
    }).sort((left, right) => compareText(left.path, right.path)
      || compareText(left.previous_path ?? '', right.previous_path ?? ''));
    totalChanges += changes.length;
    const changeset = {
      schema: 'lattice.todo_structure_changeset.v1',
      commit_oid: commitOid,
      parent_oids: parentOids,
      changes,
      changeset_digest: '',
    };
    changeset.changeset_digest = todoSelfDigest(changeset, 'changeset_digest');
    return changeset;
  });
  if (totalChanges > TODO_STRUCTURE_GIT_LIMITS.changes) {
    fail('STRUCTURE_GIT_DIFF_TOO_LARGE', 'change_count_exceeds_limit', {
      actual: totalChanges, limit: TODO_STRUCTURE_GIT_LIMITS.changes,
    });
  }
  if (totalChangedLines > TODO_STRUCTURE_GIT_LIMITS.changedLines) {
    fail('STRUCTURE_GIT_DIFF_TOO_LARGE', 'changed_line_count_exceeds_limit', {
      actual: totalChangedLines, limit: TODO_STRUCTURE_GIT_LIMITS.changedLines,
    });
  }
  return { changesets, totalChanges, totalChangedLines };
}

function collectChangesets(run, cwd, commits, revision) {
  if (commits.length === 0) return { changesets: [], totalChanges: 0, totalChangedLines: 0 };
  const revisions = Array.isArray(revision) ? revision : [revision];
  const raw = runGit(run, cwd, [
    'log', '--reverse', '--topo-order', '--format=%x1e%H%x00', '--raw', '-z', '--no-abbrev',
    '--find-renames=50%', '--diff-merges=first-parent', ...revisions,
  ]);
  const numstat = runGit(run, cwd, [
    'log', '--reverse', '--topo-order', '--format=%x1e%H%x00', '--numstat', '-z',
    '--no-renames', '--diff-merges=first-parent', ...revisions,
  ]);
  return buildChangesets(commits, parseRawChanges(raw), parseNumstat(numstat));
}

function supplementalCommits(run, cwd, baselineSha, headSha, requested) {
  if (!Array.isArray(requested) || requested.some((oid) => !SHA.test(oid))
    || new Set(requested).size !== requested.length) {
    fail('STRUCTURE_GIT_INPUT_INVALID', 'supplemental_commit_oids_invalid');
  }
  const supplemental = [];
  for (const commitOid of requested) {
    const object = gitResult(run, cwd, ['cat-file', '-e', `${commitOid}^{commit}`], {
      allow: [0, 1, 128], maxBuffer: 1_024,
    });
    const reachable = object.status === 0 && gitResult(run, cwd, [
      'merge-base', '--is-ancestor', commitOid, headSha,
    ], { allow: [0, 1], maxBuffer: 1_024 }).status === 0;
    if (!reachable || commitOid === baselineSha) {
      fail('STRUCTURE_REALIZATION_COMMIT_UNREACHABLE',
        !reachable ? 'realization_commit_unreachable_from_head' : 'realization_commit_is_baseline',
        { commit_oid: commitOid, baseline_sha: baselineSha, head_sha: headSha });
    }
    const preBaseline = gitResult(run, cwd, [
      'merge-base', '--is-ancestor', commitOid, baselineSha,
    ], { allow: [0, 1], maxBuffer: 1_024 }).status === 0;
    if (preBaseline) supplemental.push(commitOid);
  }
  if (supplemental.length > TODO_STRUCTURE_GIT_LIMITS.commits) {
    fail('STRUCTURE_GIT_HISTORY_TOO_LARGE', 'supplemental_commit_count_exceeds_limit', {
      actual: supplemental.length, limit: TODO_STRUCTURE_GIT_LIMITS.commits,
    });
  }
  return supplemental.sort(compareText);
}

function boundedSensorLists(result) {
  return [
    result?.files?.added, result?.files?.removed, result?.files?.changed,
    result?.nodes?.added, result?.nodes?.removed, result?.nodes?.changed, result?.nodes?.moved,
    result?.edges?.added, result?.edges?.removed,
  ].every((list) => Array.isArray(list)
    && list.length <= TODO_STRUCTURE_GIT_LIMITS.sensorDetailsPerBucket);
}

/** compareSensorIndexesの意味を変えず、host固有root／databaseだけを除いた保存形へ写す。 */
export function projectTodoStructureSensorDiff(result) {
  if (!isPlain(result) || result.schema !== 'lattice.sensor_diff_result.v1'
    || !isPlain(result.comparability) || !isPlain(result.summary)
    || !isPlain(result.excluded) || !isPlain(result.integrity)
    || !['ok', 'degraded'].includes(result.comparability.status)
    || !isPlain(result.a) || !isPlain(result.b)
    || !isPlain(result.truncation) || !boundedSensorLists(result)) {
    fail('STRUCTURE_SENSOR_DIFF_INVALID', 'sensor_diff_result_invalid');
  }
  const projection = {
    schema: result.schema,
    provider: result.provider,
    sensor_owner: result.sensor_owner,
    command: result.command,
    a: { subtree: result.a?.subtree ?? '', indexed: structuredClone(result.a?.indexed ?? null) },
    b: { subtree: result.b?.subtree ?? '', indexed: structuredClone(result.b?.indexed ?? null) },
    comparability: structuredClone(result.comparability),
    summary: structuredClone(result.summary),
    excluded: structuredClone(result.excluded),
    integrity: structuredClone(result.integrity),
    limit: result.limit,
    truncation: structuredClone(result.truncation),
    files: structuredClone(result.files),
    nodes: structuredClone(result.nodes),
    edges: structuredClone(result.edges),
  };
  return { projection, projection_digest: digestTodoArtifact(projection) };
}

function collectSensorDiff(sensorDiffRequest, compareSensor) {
  if (sensorDiffRequest === null) {
    return { status: 'unknown', reason: 'STRUCTURE_SENSOR_DIFF_MISSING', projection: null, projection_digest: null };
  }
  try {
    const requested = {
      ...sensorDiffRequest,
      limit: TODO_STRUCTURE_GIT_LIMITS.sensorDetailsPerBucket,
    };
    const projected = projectTodoStructureSensorDiff(compareSensor(requested));
    return {
      status: projected.projection.comparability.status === 'ok' ? 'ready' : 'degraded',
      reason: projected.projection.comparability.status === 'ok'
        ? null : 'STRUCTURE_SENSOR_DIFF_DEGRADED',
      ...projected,
    };
  } catch (error) {
    if (error instanceof TodoStructureGitError) throw error;
    return {
      status: 'unknown',
      reason: typeof error?.code === 'string' ? error.code : 'STRUCTURE_SENSOR_DIFF_UNAVAILABLE',
      projection: null,
      projection_digest: null,
    };
  }
}

/** cleanなcurrent treeのcommit来歴と既存sensor diffをprovenance artifactへ束縛する。 */
export function collectTodoStructureGitProvenance({
  repoRoot,
  structureSet,
  supplementalCommitOids = [],
  sensorDiffRequest = null,
  requireClean = true,
  runGit: run = defaultRunGit,
  compareSensor = compareSensorIndexes,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0 || typeof requireClean !== 'boolean'
    || typeof run !== 'function' || typeof compareSensor !== 'function') {
    fail('STRUCTURE_GIT_INPUT_INVALID', 'git_adapter_options_invalid');
  }
  assertStructureSet(structureSet);
  const headSha = resolveGitIdentity(run, repoRoot, structureSet.baseline_sha, { requireClean });
  const revisionText = utf8(runGit(run, repoRoot, [
    'rev-list', '--parents', '--reverse', '--topo-order',
    `${structureSet.baseline_sha}..${headSha}`,
  ]), 'rev_list');
  const commits = parseRevisionList(revisionText);
  const range = `${structureSet.baseline_sha}..${headSha}`;
  const built = collectChangesets(run, repoRoot, commits, range);
  const changesets = built.changesets;
  const supplementalOids = supplementalCommits(
    run, repoRoot, structureSet.baseline_sha, headSha, supplementalCommitOids,
  );
  const supplementalRevision = supplementalOids.map((oid) => `${oid}^!`);
  const supplementalRevisionText = supplementalOids.length === 0 ? '' : utf8(runGit(run, repoRoot, [
    'rev-list', '--parents', '--no-walk=unsorted', ...supplementalOids,
  ]), 'supplemental_rev_list');
  const supplemental = collectChangesets(
    run, repoRoot, parseRevisionList(supplementalRevisionText), supplementalRevision,
  ).changesets;
  const summaryChanges = changesets.flatMap(({ changes }) => changes);
  const sensorDiff = collectSensorDiff(sensorDiffRequest, compareSensor);
  const provenance = {
    schema: TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA,
    structure_set_digest: structureSet.structure_set_digest,
    baseline_sha: structureSet.baseline_sha,
    head_sha: headSha,
    commit_order: commits.map(({ commit_oid: oid }) => oid),
    changesets,
    supplemental_changesets: supplemental,
    summary: {
      commits: commits.length,
      changes: built.totalChanges,
      changed_lines: built.totalChangedLines,
      regular: summaryChanges
        .filter(({ file_kind: kind }) => kind === 'regular').length,
      symlink: summaryChanges
        .filter(({ file_kind: kind }) => kind === 'symlink').length,
      submodule: summaryChanges
        .filter(({ file_kind: kind }) => kind === 'submodule').length,
      special: summaryChanges
        .filter(({ file_kind: kind }) => kind === 'special').length,
      binary: summaryChanges
        .filter(({ binary }) => binary === true).length,
      renames: summaryChanges
        .filter(({ change }) => change === 'rename').length,
    },
    sensor_diff: sensorDiff,
    provenance_digest: '',
  };
  provenance.provenance_digest = todoSelfDigest(provenance, 'provenance_digest');
  return provenance;
}

/** realizationが明示したcommit OIDを、message推定なしでchangesetへexact束縛する。 */
export function bindTodoStructureRealizationCommits({ provenance, realizations } = {}) {
  if (!isPlain(provenance) || provenance.schema !== TODO_STRUCTURE_GIT_PROVENANCE_SCHEMA
    || !Array.isArray(provenance.changesets) || !Array.isArray(realizations)) {
    fail('STRUCTURE_GIT_INPUT_INVALID', 'realization_binding_input_invalid');
  }
  const changesets = new Map([...provenance.changesets, ...(provenance.supplemental_changesets ?? [])]
    .map((changeset) => [changeset.commit_oid, changeset.changeset_digest]));
  return realizations.map((realization) => {
    const explained = explainTodoStructureRealization(realization);
    if (!explained.valid) {
      fail('STRUCTURE_REALIZATION_INVALID', explained.reason, { path: explained.path });
    }
    const commits = realization.commit_oids.map((commitOid) => {
      const changesetDigest = changesets.get(commitOid);
      if (changesetDigest === undefined) {
        fail('STRUCTURE_REALIZATION_COMMIT_UNREACHABLE', 'realization_commit_outside_baseline_range', {
          task_id: realization.task_id, commit_oid: commitOid,
        });
      }
      return { commit_oid: commitOid, changeset_digest: changesetDigest };
    });
    return {
      task_id: realization.task_id,
      realization_digest: realization.realization_digest,
      commits,
    };
  }).sort((left, right) => compareText(left.task_id, right.task_id)
    || compareText(left.realization_digest, right.realization_digest));
}
