import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyActualArtifactOnDisk } from '../../src/rc3-actual-dogfood.mjs';
import { projectRuntimeState } from '../../src/runtime-projection.mjs';

// RC3-I integration（plan RC3-I、ADR 0044 Decision 9.5）。
// commit済み正典artifact v2（actual multi-agent dogfood）を保存bytesだけから
// 再検証する。実行系（実agent dispatch）は親orchestratorの一回性の観測であり、
// 本testは保存されたcausal chainの再計算可能性を固定する。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTIFACT_ROOT = path.join(REPO_ROOT, 'research', 'campaigns', 'rc3', 'artifacts', 'v2');

test('actual dogfood artifactは保存bytesだけから再検証できる', async () => {
  const verification = await verifyActualArtifactOnDisk({ artifactRoot: ARTIFACT_ROOT });
  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
  assert.ok(verification.checks.length >= 14);
});

test('保存eventsはhold {TA,TB}・carry-over {TC}・全TODO受理・closeを再構成する', async () => {
  const events = JSON.parse(await readFile(path.join(ARTIFACT_ROOT, 'events.json'), 'utf8'));
  const holdDecision = JSON.parse(await readFile(path.join(ARTIFACT_ROOT, 'hold-decision.json'), 'utf8'));
  assert.deepEqual(holdDecision.hold_set, ['TA', 'TB']);
  assert.deepEqual(holdDecision.continue_set, ['TC']);
  const state = projectRuntimeState({ events });
  assert.deepEqual(state.accepted, ['TA', 'TB', 'TC']);
  assert.equal(state.closed, true);
  assert.deepEqual(Object.keys(state.rebinds), ['TC']);
  // serial redispatchの直接証拠: epoch 2でTB dispatchはTA受理より後。
  const taAccepted = events.find((e) => e.kind === 'receipt_accepted' && e.subject.ref === 'TA' && e.plan_epoch === 2);
  const tbDispatch = events.find((e) => e.kind === 'executor_dispatched' && e.subject.ref === 'TB' && e.plan_epoch === 2);
  assert.ok(taAccepted.sequence < tbDispatch.sequence);
});

test('provider観測はcore eventsから分離され、実測値を持つ', async () => {
  const providerRuns = JSON.parse(await readFile(path.join(ARTIFACT_ROOT, 'provider-runs.json'), 'utf8'));
  const probes = JSON.parse(await readFile(path.join(ARTIFACT_ROOT, 'probes.json'), 'utf8'));
  // dispatch 5回（epoch1×3＋epoch2×2）のterminal報告と実測duration。
  const terminals = providerRuns.filter(({ state }) => state === 'terminal_reported');
  assert.equal(terminals.length, 5);
  assert.ok(terminals.every(({ duration_ms: ms }) => Number.isFinite(ms) && ms > 0));
  // in-flight unknown観測（timeout相当）と同一handle回収の記録。
  assert.ok(providerRuns.some(({ state }) => state === 'unknown_in_flight'));
  // 重複dispatch拒否とstale receipt rejectのprobe記録。
  assert.match(probes.duplicate_dispatch.refused, /重複dispatchを拒否/u);
  assert.equal(probes.stale_receipt.decision.decision, 'rejected');
  assert.deepEqual(probes.residual_worktrees, []);
});
