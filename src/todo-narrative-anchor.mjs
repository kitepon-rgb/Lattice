import { createHash } from 'node:crypto';

import { parseTodoMarkdownDocument } from './todo-markdown-renderer.mjs';

const REASONS = Object.freeze({
  ANCHOR_MISSING: 'anchor_missing',
  PATH_MISMATCH: 'path_mismatch',
  LINE_MISSING: 'line_missing',
  DIGEST_MISMATCH: 'digest_mismatch',
  NOT_CHECKBOX: 'not_checkbox',
  DUPLICATE_CLAIM: 'duplicate_claim',
  AST_LOCATION_MISSING: 'ast_location_missing',
});

function refKey(ref) {
  return JSON.stringify([ref.project_id, ref.plan_key, ref.task_id]);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRefs(left, right) {
  return compareText(left.project_id, right.project_id)
    || compareText(left.plan_key, right.plan_key)
    || compareText(left.task_id, right.task_id);
}

function listItems(tree) {
  const result = [];
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'listItem') result.push(node);
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  };
  visit(tree);
  return result;
}

function outcome(ref, narrativeRef, anchor, reason) {
  return {
    ref,
    narrative_ref: narrativeRef,
    anchored: reason === null,
    reason,
    origin_line: anchor?.origin_line ?? null,
  };
}

export function verifyNarrativeAnchors({
  readModel,
  narratives,
  parseMarkdown = parseTodoMarkdownDocument,
}) {
  if (readModel?.schema !== 'lattice.todo_store_read.v1' || !Array.isArray(readModel.members)) {
    throw new TypeError('readModel must be lattice.todo_store_read.v1');
  }
  if (!Array.isArray(narratives)) throw new TypeError('narratives must be an array');
  if (typeof parseMarkdown !== 'function') throw new TypeError('parseMarkdown must be a function');

  const supplied = new Map(narratives.map((entry) => [refKey(entry.ref), entry]));
  const candidates = [];
  for (const member of readModel.members) for (const task of member.plan.tasks) {
    const ref = {
      project_id: member.plan.project_id,
      plan_key: member.plan.plan_key,
      task_id: task.task_id,
    };
    const anchor = task.narrative_anchor ?? null;
    const narrative = supplied.get(refKey(ref));
    candidates.push({ ref, task, anchor, narrative });
  }

  const duplicateClaims = new Set();
  const claims = new Map();
  for (const candidate of candidates) {
    const { anchor, narrative, task } = candidate;
    if (anchor === null || task.narrative_ref !== anchor.origin_plan_ref
      || narrative?.narrative_ref !== task.narrative_ref || typeof narrative?.markdown !== 'string') continue;
    const claimKey = JSON.stringify([anchor.origin_plan_ref, anchor.origin_line]);
    const claimed = claims.get(claimKey) ?? [];
    claimed.push(candidate);
    claims.set(claimKey, claimed);
  }
  for (const claimed of claims.values()) {
    if (claimed.length > 1) for (const candidate of claimed) duplicateClaims.add(refKey(candidate.ref));
  }

  const parsedDocuments = new Map();
  const outcomes = candidates.map(({ ref, task, anchor, narrative }) => {
    if (anchor === null) return outcome(ref, task.narrative_ref, anchor, REASONS.ANCHOR_MISSING);
    if (task.narrative_ref !== anchor.origin_plan_ref
      || narrative?.narrative_ref !== task.narrative_ref || typeof narrative?.markdown !== 'string') {
      return outcome(ref, task.narrative_ref, anchor, REASONS.PATH_MISMATCH);
    }
    if (duplicateClaims.has(refKey(ref))) {
      return outcome(ref, task.narrative_ref, anchor, REASONS.DUPLICATE_CLAIM);
    }
    const lines = narrative.markdown.split('\n');
    if (!Number.isSafeInteger(anchor.origin_line) || anchor.origin_line < 1
      || anchor.origin_line > lines.length) {
      return outcome(ref, task.narrative_ref, anchor, REASONS.LINE_MISSING);
    }
    const line = lines[anchor.origin_line - 1];
    const lineDigest = createHash('sha256').update(Buffer.from(line, 'utf8')).digest('hex');
    if (lineDigest !== anchor.source_line_digest) {
      return outcome(ref, task.narrative_ref, anchor, REASONS.DIGEST_MISMATCH);
    }

    const documentKey = JSON.stringify([task.narrative_ref, narrative.markdown]);
    let items = parsedDocuments.get(documentKey);
    if (items === undefined) {
      items = listItems(parseMarkdown(narrative.markdown));
      parsedDocuments.set(documentKey, items);
    }
    const matched = items.find((item) => item.position?.start?.line === anchor.origin_line);
    if (matched !== undefined && typeof matched.checked === 'boolean') {
      return outcome(ref, task.narrative_ref, anchor, null);
    }
    if (matched === undefined && items.some((item) => !Number.isSafeInteger(item.position?.start?.line))) {
      return outcome(ref, task.narrative_ref, anchor, REASONS.AST_LOCATION_MISSING);
    }
    return outcome(ref, task.narrative_ref, anchor, REASONS.NOT_CHECKBOX);
  });

  outcomes.sort((left, right) => compareRefs(left.ref, right.ref));
  return outcomes;
}

export const TODO_NARRATIVE_ANCHOR_REASONS = REASONS;
