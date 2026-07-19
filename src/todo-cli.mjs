import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat, mkdir, open, readFile, realpath, rename, rm,
} from 'node:fs/promises';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

import {
  canonicalizeTodoArtifact,
  digestTodoArtifact,
  isTodoIdentifier,
  isTodoRef,
  todoSelfDigest,
  validateEvidenceDescriptor,
} from './todo-contracts.mjs';
import { projectTodoChainV1 } from './todo-chain.mjs';
import { layoutTodoGantt } from './todo-gantt-layout.mjs';
import { loadTodoGanttPresentation } from './todo-gantt-presentation.mjs';
import {
  renderTodoGanttHtml,
  TODO_GANTT_RENDERER_VERSION,
} from './todo-gantt-html.mjs';
import { verifyNarrativeAnchors } from './todo-narrative-anchor.mjs';
import {
  appendTodoEvent,
  applyTodoRevision,
  createTodoStoreWriter,
  TodoStoreError,
  readTodoStore,
  rebuildTodoSnapshot,
  verifyTodoRevisionSources,
} from './todo-store.mjs';
import {
  appendTodoExtraction,
  validateTodoExtraction,
} from './todo-migration.mjs';
import { projectTodoStatus } from './todo-status.mjs';
import {
  parseTodoSourceRef, todoLegacyReconciliationDigest, validateTodoRevision,
} from './todo-revision.mjs';

const CLI_ERROR_SCHEMA = 'lattice.cli_error.v2';
const DEFAULT_GANTT_REF = '.lattice/generated/gantt.html';
const MAX_MIGRATION_INPUT_BYTES = 8_388_608;
const ACTOR_ENV_KEYS = Object.freeze([
  'LATTICE_TODO_ACTOR_HOST',
  'LATTICE_TODO_ACTOR_SESSION',
  'LATTICE_TODO_ACTOR_AGENT',
]);

function usageFailure(stderr, argv) {
  const received = argv.length === 0 ? '(none)' : argv.join(' ').replace(/[\r\n]/gu, ' ');
  stderr.write(`lattice todo: unsupported command or arguments: ${received}\n`);
  return 2;
}

function typedFailure(stderr, error) {
  const payload = {
    schema: CLI_ERROR_SCHEMA,
    code: error.code,
    message: error.message,
  };
  if (error.detail !== null && typeof error.detail === 'object'
    && !Array.isArray(error.detail) && Object.keys(error.detail).length > 0) {
    payload.detail = error.detail;
  }
  stderr.write(`${JSON.stringify(payload)}\n`);
  return 1;
}

function resolveRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new TodoStoreError('REPO_UNRESOLVED', 'git_toplevel_unresolved', 'cwdのgit toplevelを解決できない');
  }
}

function selectMembers(store, requestedPlanKey) {
  if (requestedPlanKey === null) return store.members;
  const member = store.members.find(({ descriptor }) => descriptor.plan_key === requestedPlanKey);
  if (member === undefined) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'plan_not_active');
  }
  return [member];
}

function taskRef(plan, taskId) {
  return { project_id: plan.project_id, plan_key: plan.plan_key, task_id: taskId };
}

function mergedTopology(store) {
  return {
    nodes: store.members.flatMap(({ plan }) => plan.tasks.map(({ task_id: taskId }) => taskRef(plan, taskId))),
    hard_edges: store.members.flatMap(({ plan }) => plan.hard_dependencies),
    joins: store.members.flatMap(({ plan }) => plan.joins),
  };
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function hasDuplicateJsonKey(node) {
  if (node?.type === 'object') {
    const keys = new Set();
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? [];
      if (keys.has(key?.value) || hasDuplicateJsonKey(value)) return true;
      keys.add(key?.value);
    }
  } else if (node?.type === 'array') {
    return (node.children ?? []).some(hasDuplicateJsonKey);
  }
  return false;
}

async function readMigrationInput(repoRoot, inputRef) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, inputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_missing', undefined, { input_ref: inputRef });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'unsafe_input_path', undefined, { input_ref: inputRef });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_alias_or_escape', undefined, { input_ref: inputRef });
  }
  if (stats.size > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('INVALID_JSON', 'invalid_utf8');
  }
  const parseErrors = [];
  const tree = parseTree(text, parseErrors, { allowTrailingComma: false, disallowComments: true });
  if (parseErrors.length > 0 || tree === undefined) {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (hasDuplicateJsonKey(tree)) throw new TodoStoreError('INVALID_JSON', 'duplicate_key');
  let extraction;
  try { extraction = JSON.parse(text); } catch {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (!validateTodoExtraction(extraction)) {
    throw new TodoStoreError('INVALID_TODO_EXTRACTION', 'schema_invalid');
  }
  return extraction;
}

async function readRevisionInput(repoRoot, inputRef) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, inputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_missing', undefined, { input_ref: inputRef });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'unsafe_input_path', undefined, { input_ref: inputRef });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_alias_or_escape', undefined, { input_ref: inputRef });
  }
  if (stats.size > MAX_MIGRATION_INPUT_BYTES) throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_MIGRATION_INPUT_BYTES) throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('INVALID_JSON', 'invalid_utf8');
  }
  if (!text.endsWith('\n') || text.startsWith('\uFEFF') || text.includes('\r')
    || text.slice(0, -1).includes('\n')) {
    throw new TodoStoreError('REVISION_INVALID', 'non_canonical_revision_bytes');
  }
  const parseErrors = [];
  const tree = parseTree(text.slice(0, -1), parseErrors, { allowTrailingComma: false, disallowComments: true });
  if (parseErrors.length > 0 || tree === undefined) throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  if (hasDuplicateJsonKey(tree)) throw new TodoStoreError('INVALID_JSON', 'duplicate_key');
  let revision;
  try { revision = JSON.parse(text.slice(0, -1)); } catch {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (!validateTodoRevision(revision)) throw new TodoStoreError('REVISION_INVALID', 'revision_schema_or_digest_invalid');
  if (text !== `${canonicalizeTodoArtifact(revision)}\n`) {
    throw new TodoStoreError('REVISION_INVALID', 'non_canonical_revision_bytes');
  }
  return revision;
}

async function readEvidenceInput(repoRoot, inputRef) {
  if (!isTodoRef(inputRef)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, inputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_outside_repo', undefined, { input_ref: inputRef });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_missing', undefined, { input_ref: inputRef });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'unsafe_input_path', undefined, { input_ref: inputRef });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('INPUT_UNREADABLE', 'input_path_alias_or_escape', undefined, { input_ref: inputRef });
  }
  if (stats.size > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_MIGRATION_INPUT_BYTES) {
    throw new TodoStoreError('INPUT_TOO_LARGE', 'input_size_limit_exceeded');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('INVALID_JSON', 'invalid_utf8');
  }
  if (text.startsWith('\uFEFF') || text.includes('\r')) {
    throw new TodoStoreError('INVALID_JSON', 'non_portable_json_bytes');
  }
  const parseErrors = [];
  const tree = parseTree(text, parseErrors, { allowTrailingComma: false, disallowComments: true });
  if (parseErrors.length > 0 || tree === undefined) {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (hasDuplicateJsonKey(tree)) throw new TodoStoreError('INVALID_JSON', 'duplicate_key');
  let descriptor;
  try { descriptor = JSON.parse(text); } catch {
    throw new TodoStoreError('INVALID_JSON', 'json_parse_failed');
  }
  if (!validateEvidenceDescriptor(descriptor)) {
    throw new TodoStoreError('INVALID_EVIDENCE', 'schema_invalid');
  }
  return descriptor;
}

function mutationActor(env) {
  const values = ACTOR_ENV_KEYS.map((key) => env[key]);
  if (!values.every(isTodoIdentifier)) {
    throw new TodoStoreError('ACTOR_UNRESOLVED', 'actor_environment_invalid');
  }
  return { host: values[0], session: values[1], agent: values[2] };
}

async function mutate({ repoRoot, env, planKey, taskId, kind, payload, evidenceRef }) {
  const actor = mutationActor(env);
  const evidence = evidenceRef === null ? null : await readEvidenceInput(repoRoot, evidenceRef);
  let eventPayload = payload;
  if (kind === 'done' && payload === 'authored') eventPayload = { evidence };
  if (kind === 'done' && payload === 'evidence_promotion') {
    eventPayload = { done_mode: 'evidence_promotion', imported: true, evidence };
  }
  const { event, snapshot } = await appendTodoEvent({
    repoRoot,
    writer: createTodoStoreWriter({ caller: 'g5-authoring' }),
    planKey,
    event: { kind, task_id: taskId, actor, payload: eventPayload },
  });
  const task = snapshot.tasks.find(({ task_id: current }) => current === taskId);
  const result = {
    schema: 'lattice.todo_mutation_result.v1',
    project_id: event.project_id,
    plan_key: event.plan_key,
    plan_version: event.plan_version,
    task_id: event.task_id,
    kind: event.kind,
    sequence: event.sequence,
    event_digest: event.event_digest,
    journal_head_digest: event.event_digest,
    snapshot_digest: snapshot.snapshot_digest,
    status: task.status,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function migrate({ repoRoot, inputRef }) {
  const extraction = await readMigrationInput(repoRoot, inputRef);
  const imported = await appendTodoExtraction({ repoRoot, extraction });
  const registered = extraction.tasks.filter(({ disposition }) => disposition.startsWith('register_'));
  const result = {
    schema: 'lattice.todo_migrate_result.v1',
    project_id: imported.plan.project_id,
    plan_key: imported.plan.plan_key,
    plan_version: imported.plan.plan_version,
    extraction_digest: extraction.extraction_digest,
    imported_task_count: registered.length,
    completed_task_count: extraction.tasks.filter(({ disposition }) => disposition === 'register_done').length,
    plan_ref: imported.descriptor.plan_ref,
    journal_ref: imported.descriptor.journal_ref,
    snapshot_ref: imported.descriptor.snapshot_ref,
    topology_digest: imported.plan.topology_digest,
    journal_head_digest: imported.events.at(-1).event_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function revise({ repoRoot, env, planKey, inputRef }) {
  const revision = await readRevisionInput(repoRoot, inputRef);
  if (revision.plan_key !== planKey) {
    throw new TodoStoreError('REVISION_INVALID', 'requested_plan_mismatch');
  }
  return applyTodoRevision({
    repoRoot, writer: createTodoStoreWriter({ caller: 'g5-authoring' }), revision,
    actor: mutationActor(env), recordedAt: new Date().toISOString(),
  });
}

async function status({ repoRoot }) {
  return projectTodoStatus(await readTodoStore({ repoRoot }));
}

async function readNarrative(repoRoot, ref) {
  const canonicalRoot = await realpath(repoRoot);
  const source = parseTodoSourceRef(ref);
  const fileRef = source?.path ?? ref;
  const absolute = path.resolve(canonicalRoot, fileRef);
  if (!within(canonicalRoot, absolute)) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_path_outside_repo', undefined, { ref });
  }
  let stats;
  try { stats = await lstat(absolute); } catch {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_missing', undefined, { ref });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'unsafe_narrative_path', undefined, { ref });
  }
  const resolved = await realpath(absolute);
  if (resolved !== absolute || !within(canonicalRoot, resolved)) {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_path_alias_or_escape', undefined, { ref });
  }
  const fileBytes = await readFile(resolved);
  let bytes = fileBytes;
  if (source !== null) {
    const lines = [];
    let start = 0;
    for (let index = 0; index <= fileBytes.length; index += 1) {
      if (index === fileBytes.length || fileBytes[index] === 0x0a) {
        lines.push(fileBytes.subarray(start, index));
        start = index + 1;
      }
    }
    bytes = lines[source.line - 1];
    if (bytes === undefined) {
      throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_line_missing', undefined, { ref });
    }
  }
  let markdown;
  try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TodoStoreError('STORE_INCONSISTENT', 'narrative_invalid_utf8', undefined, { ref });
  }
  return { markdown, content_digest: createHash('sha256').update(bytes).digest('hex') };
}

async function loadNarratives(store, repoRoot) {
  const content = new Map();
  const bindings = [];
  const narratives = [];
  for (const member of store.members) for (const task of member.plan.tasks) {
    const ref = taskRef(member.plan, task.task_id);
    if (task.narrative_ref === null) {
      bindings.push({ ...ref, narrative_ref: null, content_digest: null });
      narratives.push({ ref, markdown: '', narrative_ref: null, content_digest: null });
      continue;
    }
    let loaded = content.get(task.narrative_ref);
    if (loaded === undefined) {
      loaded = await readNarrative(repoRoot, task.narrative_ref);
      content.set(task.narrative_ref, loaded);
    }
    bindings.push({ ...ref, narrative_ref: task.narrative_ref, content_digest: loaded.content_digest });
    narratives.push({ ref, markdown: loaded.markdown, narrative_ref: task.narrative_ref,
      content_digest: loaded.content_digest });
  }
  return { narratives, bindings };
}

async function resolveOutput(repoRoot, outputRef) {
  const canonicalRoot = await realpath(repoRoot);
  const absolute = path.resolve(canonicalRoot, outputRef);
  if (!within(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new TodoStoreError('OUTPUT_PATH_INVALID', 'output_path_outside_repo', undefined, { output_ref: outputRef });
  }
  let cursor = path.dirname(absolute);
  const missing = [];
  while (cursor !== canonicalRoot) {
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new TodoStoreError('OUTPUT_PATH_INVALID', 'unsafe_output_parent', undefined, { output_ref: outputRef });
      }
      const resolved = await realpath(cursor);
      if (resolved !== cursor || !within(canonicalRoot, resolved)) {
        throw new TodoStoreError('OUTPUT_PATH_INVALID', 'output_parent_alias_or_escape', undefined, { output_ref: outputRef });
      }
      break;
    } catch (error) {
      if (error instanceof TodoStoreError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      missing.push(cursor);
      cursor = path.dirname(cursor);
    }
  }
  let target;
  try { target = await lstat(absolute); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (target !== undefined && (target.isSymbolicLink() || !target.isFile())) {
    throw new TodoStoreError('OUTPUT_PATH_INVALID', 'unsafe_output_target', undefined, { output_ref: outputRef });
  }
  return { absolute, missing };
}

async function atomicWriteOutput(repoRoot, outputRef, html) {
  const { absolute } = await resolveOutput(repoRoot, outputRef);
  await mkdir(path.dirname(absolute), { recursive: true });
  // Re-resolve after mkdir so a raced alias cannot redirect the write.
  const checked = await resolveOutput(repoRoot, outputRef);
  const temporary = path.join(path.dirname(checked.absolute),
    `.${path.basename(checked.absolute)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(html, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, checked.absolute);
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

async function gantt({ repoRoot, outputRef }) {
  const store = await readTodoStore({ repoRoot });
  const presentation = await loadTodoGanttPresentation({ repoRoot, readModel: store });
  const topology = mergedTopology(store);
  const chain = projectTodoChainV1(topology);
  const layout = layoutTodoGantt(store, chain);
  const narrative = await loadNarratives(store, repoRoot);
  const anchorOutcomes = verifyNarrativeAnchors({
    readModel: store,
    narratives: narrative.narratives,
  });
  const outcomesByRef = new Map(anchorOutcomes.map((entry) => [
    JSON.stringify([entry.ref.project_id, entry.ref.plan_key, entry.ref.task_id]), entry,
  ]));
  const narrativeBindings = narrative.bindings.map((entry) => {
    const key = JSON.stringify([entry.project_id, entry.plan_key, entry.task_id]);
    const anchor = outcomesByRef.get(key);
    return { ...entry, anchored: anchor.anchored, reason: anchor.reason };
  });
  const memberBindings = store.members.map((member) => ({
    plan_key: member.descriptor.plan_key,
    topology_digest: member.plan.topology_digest,
    journal_head_digest: member.journal.events.at(-1).event_digest,
  }));
  const metadata = {
    manifest_digest: store.manifest.manifest_digest,
    member_bindings: memberBindings,
    narrative_bindings_digest: digestTodoArtifact(narrativeBindings),
    presentation_digest: presentation.presentation_digest,
    chain_digest: digestTodoArtifact(chain),
    layout_digest: digestTodoArtifact(layout),
    renderer_version: TODO_GANTT_RENDERER_VERSION,
  };
  const rendered = renderTodoGanttHtml({
    readModel: store,
    layout,
    narratives: narrative.narratives,
    anchorOutcomes,
    presentation,
    metadata,
  });
  await atomicWriteOutput(repoRoot, outputRef, rendered.html);
  const result = {
    schema: 'lattice.todo_gantt_result.v1',
    project_id: store.project_id,
    output_ref: outputRef,
    manifest_digest: metadata.manifest_digest,
    member_bindings: memberBindings,
    narrative_bindings_digest: metadata.narrative_bindings_digest,
    chain_digest: metadata.chain_digest,
    layout_digest: metadata.layout_digest,
    renderer_version: TODO_GANTT_RENDERER_VERSION,
    html_digest: rendered.html_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function verify({ repoRoot, requestedPlanKey }) {
  const store = await readTodoStore({ repoRoot });
  const members = selectMembers(store, requestedPlanKey);
  for (const member of members) {
    const unverified = member.tasks.find((task) => task.evidence_unverified);
    if (unverified !== undefined) {
      throw new TodoStoreError('STORE_INCONSISTENT', 'evidence_unverified', 'evidence_unverified', {
        plan_key: member.descriptor.plan_key,
        task_id: unverified.task_id,
      });
    }
    if (member.revision !== null) await verifyTodoRevisionSources({ repoRoot, revision: member.revision });
  }
  const verifiedMembers = members.map((member) => {
    const reconciled = member.revision !== null;
    return {
      plan_key: member.descriptor.plan_key,
      plan_version: member.plan.plan_version,
      topology_digest: member.plan.topology_digest,
      journal_head_digest: member.journal.events.at(-1).event_digest,
      through_sequence: member.journal.events.at(-1).sequence,
      snapshot_stale: member.snapshot_stale,
      reconciliation_state: reconciled ? 'reconciled' : 'registered_unreconciled',
      revision_digest: reconciled ? member.revision.revision_digest : null,
      reconciliation_digest: reconciled ? member.revision.reconciliation.reconciliation_digest
        : todoLegacyReconciliationDigest({ planDigest: member.plan.plan_digest,
          journalHeadDigest: member.journal.events.at(-1).event_digest }),
      source_inventory_count: reconciled
        ? member.revision.source_inventory.active.length
          + member.revision.source_inventory.excluded_tombstones.length : null,
      active_task_count: reconciled ? member.revision.source_inventory.active.length : null,
      excluded_tombstone_count: reconciled
        ? member.revision.source_inventory.excluded_tombstones.length : null,
    };
  });
  const result = {
    schema: 'lattice.todo_verify_result.v2',
    project_id: store.project_id,
    requested_plan_key: requestedPlanKey,
    verified_members: verifiedMembers,
    snapshot_stale: verifiedMembers.some((member) => member.snapshot_stale),
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

async function rebuildSnapshot({ repoRoot, planKey }) {
  // Read first so every typed validation failure happens before the rebuild writer is entered.
  const store = await readTodoStore({ repoRoot });
  const [member] = selectMembers(store, planKey);
  const snapshot = await rebuildTodoSnapshot({ repoRoot, planKey });
  const result = {
    schema: 'lattice.todo_snapshot_result.v1',
    project_id: store.project_id,
    plan_key: planKey,
    snapshot_ref: member.descriptor.snapshot_ref,
    through_sequence: snapshot.through_sequence,
    journal_head_digest: snapshot.journal_head_digest,
    snapshot_digest: snapshot.snapshot_digest,
    result_digest: '',
  };
  result.result_digest = todoSelfDigest(result, 'result_digest');
  return result;
}

/**
 * `lattice todo` namespace. Exact position, order, and argument count are part of
 * the public contract; usage failures never use a JSON envelope.
 */
export async function runTodoCli({ argv, cwd, stdout, stderr, env = process.env }) {
  if (!Array.isArray(argv) || typeof cwd !== 'string'
    || typeof stdout?.write !== 'function' || typeof stderr?.write !== 'function'
    || env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('runTodoCli optionsが不正');
  }

  let action = null;
  if (argv.length === 1 && argv[0] === 'status') {
    action = (repoRoot) => status({ repoRoot });
  } else if (argv.length === 1 && argv[0] === 'verify') {
    action = (repoRoot) => verify({ repoRoot, requestedPlanKey: null });
  } else if (argv.length === 3 && argv[0] === 'verify' && argv[1] === '--plan'
    && isTodoIdentifier(argv[2])) {
    action = (repoRoot) => verify({ repoRoot, requestedPlanKey: argv[2] });
  } else if (argv.length === 4 && argv[0] === 'snapshot' && argv[1] === '--rebuild'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])) {
    action = (repoRoot) => rebuildSnapshot({ repoRoot, planKey: argv[3] });
  } else if (argv.length === 1 && argv[0] === 'gantt') {
    action = (repoRoot) => gantt({ repoRoot, outputRef: DEFAULT_GANTT_REF });
  } else if (argv.length === 3 && argv[0] === 'gantt' && argv[1] === '--out'
    && isTodoRef(argv[2])) {
    action = (repoRoot) => gantt({ repoRoot, outputRef: argv[2] });
  } else if (argv.length === 3 && argv[0] === 'migrate' && argv[1] === '--input'
    && isTodoRef(argv[2])) {
    action = (repoRoot) => migrate({ repoRoot, inputRef: argv[2] });
  } else if (argv.length === 5 && argv[0] === 'revise'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--input' && isTodoRef(argv[4])) {
    action = (repoRoot) => revise({ repoRoot, env, planKey: argv[2], inputRef: argv[4] });
  } else if ((argv.length === 5 || argv.length === 7) && argv[0] === 'start'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && (argv.length === 5 || (argv[5] === '--override-reason' && argv[6].length > 0))) {
    const overrideReason = argv.length === 7 ? argv[6] : null;
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'start', payload: { override_reason: overrideReason }, evidenceRef: null });
  } else if (argv.length === 7 && argv[0] === 'block'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && argv[5] === '--reason' && argv[6].length > 0) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'block', payload: { reason: argv[6] }, evidenceRef: null });
  } else if (argv.length === 5 && argv[0] === 'unblock'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'unblock', payload: {}, evidenceRef: null });
  } else if (argv.length === 7 && argv[0] === 'done'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && argv[5] === '--evidence' && isTodoRef(argv[6])) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'done', payload: 'authored', evidenceRef: argv[6] });
  } else if (argv.length === 8 && argv[0] === 'evidence' && argv[1] === 'promote'
    && argv[2] === '--plan' && isTodoIdentifier(argv[3])
    && argv[4] === '--task' && isTodoIdentifier(argv[5])
    && argv[6] === '--evidence' && isTodoRef(argv[7])) {
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[3], taskId: argv[5],
      kind: 'done', payload: 'evidence_promotion', evidenceRef: argv[7] });
  } else if ((argv.length === 7 || argv.length === 9) && argv[0] === 'reopen'
    && argv[1] === '--plan' && isTodoIdentifier(argv[2])
    && argv[3] === '--task' && isTodoIdentifier(argv[4])
    && argv[5] === '--reason' && argv[6].length > 0
    && (argv.length === 7 || (argv[7] === '--override-reason' && argv[8].length > 0))) {
    const overrideReason = argv.length === 9 ? argv[8] : null;
    action = (repoRoot) => mutate({ repoRoot, env, planKey: argv[2], taskId: argv[4],
      kind: 'reopen', payload: { reason: argv[6], override_reason: overrideReason }, evidenceRef: null });
  }
  if (action === null) return usageFailure(stderr, argv);

  try {
    const result = await action(resolveRepoRoot(cwd));
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof TodoStoreError || (typeof error?.code === 'string'
      && error.detail !== null && typeof error.detail === 'object')) return typedFailure(stderr, error);
    if (error instanceof TypeError) {
      return typedFailure(stderr, {
        code: 'CONTRACT_VIOLATION',
        message: error.message,
      });
    }
    return typedFailure(stderr, {
      code: 'INTERNAL_FAILURE',
      message: error?.constructor?.name ?? 'Error',
    });
  }
}
