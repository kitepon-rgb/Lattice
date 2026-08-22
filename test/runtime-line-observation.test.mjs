import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExecutorPackets,
  buildNextRunEvent,
  classifyCheckpointObservation,
  initializeRunEvents,
} from '../src/runtime-engine.mjs';
import {
  classifyObservedDiff,
  recomputeHoldDecision,
} from '../src/runtime-decision-verifier.mjs';
import { detectCheckpointFindings } from '../src/runtime-diff-observer.mjs';
import { severabilityOfRuntimeFinding } from '../src/runtime-hold-recompile.mjs';
import { validateRuntimeFindingCandidate } from '../src/runtime-multi-epoch-store.mjs';
import {
  RUNTIME_CONFLICT_KINDS,
  selfDigest,
} from '../src/runtime-contracts.mjs';

const RUN_ID = 'run-line-observation';
const AT = '2026-08-09T00:00:00.000Z';
const SHA1 = 'b'.repeat(40);
const SHA256 = 'a'.repeat(64);
const LINE_ID = 'runtime-finding-line';
const ANCHOR_PATH = 'src/finding-kind.mjs';
const SYMBOL_PATH = 'src/finding-verifier.mjs';

function line(role, lineId = LINE_ID) {
  return {
    line_id: lineId,
    role,
    anchors: [
      { kind: 'path', path: ANCHOR_PATH },
      { kind: 'symbol', name: 'findingKind', path: SYMBOL_PATH },
    ],
  };
}

function boundary(todoId, { writes = [], lines = [] } = {}) {
  const manifest = {
    schema: 'lattice.boundary_manifest.v4',
    todo_id: todoId,
    owns: [],
    reads: [],
    writes,
    resources: [],
    state_effects: [],
    unknowns: [],
    affected_tests: [],
    graph_evidence: [],
    witness_provenance: {},
    lines,
    manifest_digest: '',
  };
  manifest.manifest_digest = selfDigest(manifest, 'manifest_digest');
  return manifest;
}

function fixture({ observerLines = [], readerLines = [line('reads')] } = {}) {
  const todos = ['OBSERVER', 'READER'];
  const manualWitness = Object.fromEntries(todos.map((todoId) => [todoId, {
    owns: [], reads: [], writes: todoId === 'OBSERVER' ? [ANCHOR_PATH, SYMBOL_PATH] : [],
    resources: [], state_effects: [], sensor_provenance: { queries: [] },
    affected_tests: [], unknowns: [],
  }]));
  const request = {
    schema: 'lattice.run_request.v1',
    request_id: 'request-line-observation',
    repo: { base_sha: SHA1, root_kind: 'git-worktree' },
    capacity: { executors: 2 },
    todos: todos.map((todoId) => ({ todo_id: todoId })),
    manual_witness: manualWitness,
    sensor_query_set: { queries: [] },
    executor_capability: { adapters: ['scripted'] },
    claim_mode: 'exact_minimum',
    request_digest: '',
  };
  request.request_digest = selfDigest(request, 'request_digest');
  const manifests = {
    OBSERVER: boundary('OBSERVER', {
      writes: [ANCHOR_PATH, SYMBOL_PATH], lines: observerLines,
    }),
    READER: boundary('READER', { lines: readerLines }),
  };
  const plan = {
    schema: 'lattice.runtime_plan.v1',
    plan_ref: 'plan-line-observation-v1',
    plan_epoch: 1,
    request_digest: request.request_digest,
    base_sha: SHA1,
    nodes: todos.map((todoId) => ({ todo_id: todoId })),
    precedence: [],
    conflicts: [],
    capacity: { executors: 2 },
    manifest_digests: Object.fromEntries(todos.map((todoId) => (
      [todoId, manifests[todoId].manifest_digest]
    ))),
    claim: { mode: 'exact_minimum' },
    predecessor_refs: [],
    plan_digest: '',
  };
  plan.plan_digest = selfDigest(plan, 'plan_digest');
  return { request, manifests, plan };
}

function checkpoint(paths = [ANCHOR_PATH, SYMBOL_PATH]) {
  return {
    checkpoint_digest: SHA256,
    diff: {
      entries: paths.map((entryPath) => ({
        path: entryPath, change: 'modified', content_digest: SHA256,
      })),
    },
  };
}

function packets() {
  return {
    OBSERVER: { scope: { writes: [ANCHOR_PATH, SYMBOL_PATH] } },
    READER: { scope: { writes: [] } },
    IRRELEVANT: { scope: { writes: [] } },
  };
}

test('producerとverifierはpath/symbol錨の線変更を独立に同じ資源findingへ束ねる', () => {
  const { plan, manifests } = fixture();
  manifests.IRRELEVANT = boundary('IRRELEVANT', { lines: [line('reads')] });
  const expected = [{
    kind: 'observed_line_change',
    todo_ids: ['OBSERVER', 'READER'],
    resource_id: LINE_ID,
  }];
  const produced = detectCheckpointFindings({
    todoId: 'OBSERVER', checkpoint: checkpoint(), packets: packets(), manifests,
    runningTodoIds: ['OBSERVER', 'READER'],
  }).findings;
  const verified = classifyObservedDiff({
    plan, manifests,
    observations: [{ todo_id: 'OBSERVER', paths: [ANCHOR_PATH, SYMBOL_PATH] }],
    relevantTodoIds: ['OBSERVER', 'READER'],
  }).findings;
  assert.deepEqual(produced, expected, '複数錨へ触れても1線1findingでなければならない');
  assert.deepEqual(verified, expected);
  assert.ok(RUNTIME_CONFLICT_KINDS.includes('observed_line_change'));
});

test('同じline_idのwriter宣言がある観測taskは線変更findingを出さない', () => {
  const { plan, manifests } = fixture({ observerLines: [line('writes')] });
  const produced = detectCheckpointFindings({
    todoId: 'OBSERVER', checkpoint: checkpoint([ANCHOR_PATH]), packets: packets(), manifests,
    runningTodoIds: ['OBSERVER', 'READER'],
  }).findings;
  const verified = classifyObservedDiff({
    plan, manifests,
    observations: [{ todo_id: 'OBSERVER', paths: [ANCHOR_PATH] }],
    relevantTodoIds: ['OBSERVER', 'READER'],
  }).findings;
  assert.equal(produced.some(({ kind }) => kind === 'observed_line_change'), false);
  assert.equal(verified.some(({ kind }) => kind === 'observed_line_change'), false);
});

test('line findingはconflict→freeze→hold閉包へreaderを運び、資源型としてserialになる', () => {
  const { request, plan, manifests } = fixture();
  const builtPackets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  for (const todoId of ['OBSERVER', 'READER']) {
    events.push(buildNextRunEvent({
      events, runId: RUN_ID, kind: 'executor_dispatched', planEpoch: 1,
      subject: { kind: 'todo', ref: todoId },
      payload: {
        executor_handle: `executor-${todoId.toLowerCase()}`,
        worktree_id: `worktree-${todoId.toLowerCase()}`,
        packet_digest: builtPackets[todoId].packet_digest,
      },
      recordedAt: AT,
    }));
  }
  events.push(buildNextRunEvent({
    events, runId: RUN_ID, kind: 'checkpoint_observed', planEpoch: 1,
    subject: { kind: 'todo', ref: 'OBSERVER' }, payload: checkpoint([ANCHOR_PATH]),
    recordedAt: AT,
  }));
  const classified = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets: builtPackets, manifests, todoId: 'OBSERVER',
    detect: detectCheckpointFindings, recordedAt: AT,
  });
  assert.deepEqual(classified.findings, [{
    kind: 'observed_line_change', todo_ids: ['OBSERVER', 'READER'], resource_id: LINE_ID,
  }]);
  const held = recomputeHoldDecision({ plan, events: classified.events, manifests });
  assert.deepEqual(held.hold_set, ['OBSERVER', 'READER']);
  assert.deepEqual(held.reasons, {
    OBSERVER: 'affected_closure',
    READER: 'affected_closure',
  });
  assert.equal(severabilityOfRuntimeFinding(classified.findings[0]), 'serial');

  const candidate = {
    schema: 'lattice.runtime_finding_candidate.v1',
    proposed_kind: 'observed_line_change',
    todo_ids: ['OBSERVER', 'READER'],
    path: null,
    resource_id: LINE_ID,
    evidence_digests: [SHA256],
    candidate_digest: '',
  };
  candidate.candidate_digest = selfDigest(candidate, 'candidate_digest');
  assert.equal(validateRuntimeFindingCandidate(candidate), true);
});

test('再分類のdedupeは同じtask組でもline_idごとに独立する', () => {
  const { request, plan, manifests } = fixture();
  const builtPackets = buildExecutorPackets({ plan, manifests });
  let events = initializeRunEvents({ runId: RUN_ID, request, plan, manifests, recordedAt: AT });
  for (const todoId of ['OBSERVER', 'READER']) {
    events.push(buildNextRunEvent({
      events, runId: RUN_ID, kind: 'executor_dispatched', planEpoch: 1,
      subject: { kind: 'todo', ref: todoId },
      payload: {
        executor_handle: `executor-${todoId.toLowerCase()}`,
        worktree_id: `worktree-${todoId.toLowerCase()}`,
        packet_digest: builtPackets[todoId].packet_digest,
      }, recordedAt: AT,
    }));
  }
  events.push(buildNextRunEvent({
    events, runId: RUN_ID, kind: 'checkpoint_observed', planEpoch: 1,
    subject: { kind: 'todo', ref: 'OBSERVER' }, payload: checkpoint([ANCHOR_PATH]),
    recordedAt: AT,
  }));
  const first = classifyCheckpointObservation({
    runId: RUN_ID, plan, events, packets: builtPackets, manifests, todoId: 'OBSERVER',
    detect: detectCheckpointFindings, recordedAt: AT,
  });
  const secondLine = 'runtime-finding-line-v2';
  const expanded = structuredClone(manifests);
  expanded.READER.lines.push(line('reads', secondLine));
  const second = classifyCheckpointObservation({
    runId: RUN_ID, plan, events: first.events, packets: builtPackets, manifests: expanded,
    todoId: 'OBSERVER', detect: detectCheckpointFindings, recordedAt: AT,
  });
  assert.deepEqual(second.findings, [{
    kind: 'observed_line_change', todo_ids: ['OBSERVER', 'READER'], resource_id: secondLine,
  }]);
});

test('ディレクトリ宣言のwritesは末尾スラッシュ無しでも配下pathを覆う', () => {
  // witness の writes は `templates` のような素のディレクトリ名を普通に持つ。
  // 末尾 `/` の時だけ prefix 扱いにすると、境界内で作った配下ファイルが全部
  // undeclared_write になり、accept のたびに hold → worker SIGSTOP で卓が凍る
  // （2026-08-22 実測: plaude 円卓の t1/t3 で連続被弾）。
  const { plan, manifests } = fixture();
  manifests.OBSERVER = boundary('OBSERVER', { writes: ['templates'] });
  plan.manifest_digests.OBSERVER = manifests.OBSERVER.manifest_digest;
  plan.plan_digest = '';
  plan.plan_digest = selfDigest(plan, 'plan_digest');
  const verified = classifyObservedDiff({
    plan, manifests,
    observations: [{ todo_id: 'OBSERVER', paths: ['templates/board-update.md', 'templates/a/b.md'] }],
    relevantTodoIds: ['OBSERVER'],
  }).findings;
  assert.deepEqual(verified.filter((f) => f.kind === 'undeclared_write'), []);
  const outside = classifyObservedDiff({
    plan, manifests,
    observations: [{ todo_id: 'OBSERVER', paths: ['templatesX/evil.md'] }],
    relevantTodoIds: ['OBSERVER'],
  }).findings;
  assert.deepEqual(outside, [{ kind: 'undeclared_write', todo_ids: ['OBSERVER'], path: 'templatesX/evil.md' }]);
});
