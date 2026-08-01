import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir, open, readFile, readdir, rename, rm, stat,
} from 'node:fs/promises';
import path from 'node:path';

import {
  TODO_LIMITS,
  TODO_NOTE_EVENT_SCHEMA,
  canonicalizeTodoArtifact,
  exactRecord,
  isTodoIdentifier,
  todoSelfDigest,
  validateTodoNoteEvent,
} from './todo-contracts.mjs';

const NOTE_ROOT_REF = '.lattice/todo/notes';
const SEALED_NAME = /^(\d{12})-(\d{12})-([0-9a-f]{64})-([0-9a-f]{64})\.jsonl$/u;
const ZERO_DIGEST = '0'.repeat(64);
const MAX_SEGMENTS = 4_096;

export class TodoNoteStoreError extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'TodoNoteStoreError';
    this.code = code;
    this.detail = { reason, ...detail };
  }
}

function fail(code, reason, detail) {
  throw new TodoNoteStoreError(code, reason, detail);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalLine(value) {
  return Buffer.from(`${canonicalizeTodoArtifact(value)}\n`, 'utf8');
}

function notePaths(repoRoot, planKey) {
  if (!isTodoIdentifier(planKey)) throw new TypeError('planKey must be a todo identifier');
  const root = path.resolve(repoRoot, NOTE_ROOT_REF, planKey);
  return { root, active: path.join(root, 'active.jsonl'), sealed: path.join(root, 'sealed') };
}

async function readOptionalBounded(ref, { missing = false } = {}) {
  try {
    const metadata = await stat(ref);
    if (!metadata.isFile() || metadata.size > TODO_LIMITS.journalSegmentBytes) {
      fail('NOTE_LOG_CORRUPT', 'note_segment_invalid', { ref });
    }
    return await readFile(ref);
  } catch (error) {
    if (error instanceof TodoNoteStoreError) throw error;
    if (missing && error?.code === 'ENOENT') return null;
    fail('NOTE_LOG_CORRUPT', 'note_segment_unreadable', { ref });
  }
}

function parseCanonicalSegment(bytes, ref) {
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) {
    fail('NOTE_LOG_CORRUPT', 'note_segment_not_canonical', { ref });
  }
  const lines = bytes.toString('utf8').slice(0, -1).split('\n');
  const events = [];
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { fail('NOTE_LOG_CORRUPT', 'note_json_invalid', { ref }); }
    if (!validateTodoNoteEvent(event) || canonicalLine(event).toString('utf8') !== `${line}\n`) {
      fail('NOTE_LOG_CORRUPT', 'note_event_invalid', { ref });
    }
    events.push(event);
  }
  return events;
}

async function sealedFiles(ref) {
  try {
    const names = await readdir(ref);
    if (names.length > MAX_SEGMENTS || names.some((name) => !SEALED_NAME.test(name))) {
      fail('NOTE_LOG_CORRUPT', 'note_sealed_inventory_invalid', { ref });
    }
    return names.sort();
  } catch (error) {
    if (error instanceof TodoNoteStoreError) throw error;
    if (error?.code === 'ENOENT') return [];
    fail('NOTE_LOG_CORRUPT', 'note_sealed_inventory_unreadable', { ref });
  }
}

function validateEventChain(events, { projectId, planKey }) {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const previous = events[index - 1] ?? null;
    if (event.project_id !== projectId || event.plan_key !== planKey
      || event.sequence !== index + 1
      || event.previous_digest !== (previous?.event_digest ?? null)) {
      fail('NOTE_LOG_CORRUPT', 'note_digest_chain_invalid', {
        plan_key: planKey, sequence: event.sequence,
      });
    }
  }
}

/** planに属する独立note chainをbyte-levelで検証して読む。missingだけは空chainである。 */
export async function readTodoNoteEvents(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const { active, sealed } = notePaths(repoRoot, options.planKey);
  const names = await sealedFiles(sealed);
  const events = [];
  let previousSegmentDigest = ZERO_DIGEST;
  for (const name of names) {
    const match = name.match(SEALED_NAME);
    const bytes = await readOptionalBounded(path.join(sealed, name));
    const segmentDigest = sha256(bytes);
    const segmentEvents = parseCanonicalSegment(bytes, path.join(sealed, name));
    if (Number(match[1]) !== segmentEvents[0]?.sequence
      || Number(match[2]) !== segmentEvents.at(-1)?.sequence
      || match[3] !== previousSegmentDigest || match[4] !== segmentDigest) {
      fail('NOTE_LOG_CORRUPT', 'note_seal_invalid', { ref: path.join(sealed, name) });
    }
    events.push(...segmentEvents);
    previousSegmentDigest = segmentDigest;
  }
  const activeBytes = await readOptionalBounded(active, { missing: true });
  if (activeBytes !== null) events.push(...parseCanonicalSegment(activeBytes, active));
  if (events.length > 0) {
    validateEventChain(events, { projectId: events[0].project_id, planKey: options.planKey });
  }
  return {
    events,
    head_digest: events.at(-1)?.event_digest ?? null,
    active_bytes: activeBytes ?? Buffer.alloc(0),
    previous_segment_digest: previousSegmentDigest,
  };
}

async function atomicWrite(ref, bytes) {
  await mkdir(path.dirname(ref), { recursive: true });
  const temporary = path.join(path.dirname(ref),
    `.${path.basename(ref)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, ref);
    const directory = await open(path.dirname(ref), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

async function withNoteLock(repoRoot, callback) {
  const root = path.resolve(repoRoot, NOTE_ROOT_REF);
  await mkdir(root, { recursive: true });
  const lockRef = path.join(root, '.write.lock');
  let handle;
  try { handle = await open(lockRef, 'wx', 0o600); }
  catch (error) {
    if (error?.code === 'EEXIST') fail('NOTE_WRITE_CONFLICT', 'note_store_locked');
    throw error;
  }
  try { return await callback(); }
  finally { await handle.close(); await rm(lockRef, { force: true }); }
}

/** lifecycle artifactsへ触れず、独立note chainだけへ1 eventを追記する。 */
export async function appendTodoNote(options = {}) {
  if (!exactRecord(options, [
    'repoRoot', 'projectId', 'planKey', 'planVersion', 'taskId', 'actor',
    'recordedAt', 'body', 'supersedes',
  ]) || ![options.projectId, options.planKey, options.planVersion, options.taskId]
    .every(isTodoIdentifier)) throw new TypeError('todo note append options invalid');
  const repoRoot = path.resolve(options.repoRoot);
  return withNoteLock(repoRoot, async () => {
    const chain = await readTodoNoteEvents({ repoRoot, planKey: options.planKey });
    if (options.supersedes !== null) {
      const target = chain.events.find(({ event_digest: digest }) => digest === options.supersedes);
      if (target === undefined || target.task_id !== options.taskId) {
        fail('NOTE_SUPERSEDES_INVALID', 'superseded_note_not_in_same_task', {
          plan_key: options.planKey, task_id: options.taskId,
        });
      }
    }
    const previous = chain.events.at(-1) ?? null;
    const event = {
      schema: TODO_NOTE_EVENT_SCHEMA,
      project_id: options.projectId,
      plan_key: options.planKey,
      task_id: options.taskId,
      plan_version: options.planVersion,
      sequence: (previous?.sequence ?? 0) + 1,
      previous_digest: previous?.event_digest ?? null,
      actor: options.actor,
      recorded_at: options.recordedAt,
      body: options.body,
      supersedes: options.supersedes,
      event_digest: '',
    };
    event.event_digest = todoSelfDigest(event, 'event_digest');
    if (!validateTodoNoteEvent(event)) throw new TypeError('todo note event input invalid');

    const paths = notePaths(repoRoot, options.planKey);
    const eventBytes = canonicalLine(event);
    if (chain.active_bytes.length > 0
      && chain.active_bytes.length + eventBytes.length > TODO_LIMITS.journalSegmentBytes) {
      const activeEvents = parseCanonicalSegment(chain.active_bytes, paths.active);
      const segmentDigest = sha256(chain.active_bytes);
      const name = `${String(activeEvents[0].sequence).padStart(12, '0')}`
        + `-${String(activeEvents.at(-1).sequence).padStart(12, '0')}`
        + `-${chain.previous_segment_digest}-${segmentDigest}.jsonl`;
      await atomicWrite(path.join(paths.sealed, name), chain.active_bytes);
      await atomicWrite(paths.active, eventBytes);
    } else {
      await atomicWrite(paths.active, Buffer.concat([chain.active_bytes, eventBytes]));
    }
    return event;
  });
}
