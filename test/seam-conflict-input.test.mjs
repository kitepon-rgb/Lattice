import assert from 'node:assert/strict';
import test from 'node:test';

import { seamConflictFromFinding, seamConflictFromProposal } from '../src/seam-apply.mjs';

// 請求項8。静的側と実行時側で導出の芯は同じで、違うのは入力だけである。
// 口を分けて共有し、実行時にだけ緩い規律を作らない。

const witnessSet = {
  manual_witness: {
    T1: {
      concern_anchors: [
        { within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['renderLeft'] },
        { within: { kind: 'path', target: 'src/other.mjs' }, symbols: ['ignored'] },
      ],
    },
    T2: {
      concern_anchors: [{ within: { kind: 'path', target: 'src/page.mjs' }, symbols: ['CSS'] }],
    },
  },
};

test('記録済み提案は所有面のpathを持つので、名前は与えられた分だけ差し替わる', () => {
  const proposal = {
    source_binding: { base_sha: 'a'.repeat(40), independence_result_digest: 'b'.repeat(64) },
    decisions: [{
      verdict: 'seam_candidate',
      component_id: 'component-1',
      task_ids: ['T1', 'T2'],
      conflicts: [{ target: 'src/page.mjs' }],
      seam_candidate: {
        proposed_surfaces: [
          { target: 'src/page.seam-aaa.mjs', owner_task_ids: ['T1'] },
          { target: 'src/page.seam-bbb.mjs', owner_task_ids: ['T2'] },
        ],
        affected_tests: ['test/page.test.mjs'],
        proposal_digest: 'c'.repeat(64),
      },
    }],
  };
  const { conflict } = seamConflictFromProposal({
    proposal, witnessSet, pathNames: { T1: 'src/page-left.mjs' },
  });
  assert.equal(conflict.sourcePath, 'src/page.mjs');
  // 係争資源の中の宣言だけを拾う。別資源への宣言は混ぜない。
  assert.deepEqual(conflict.ownedSymbolsByTask, { T1: ['renderLeft'], T2: ['CSS'] });
  // 与えられた名前は差し替え、無い分は提案の仮名のまま。
  assert.deepEqual(conflict.proposedPathByTask,
    { T1: 'src/page-left.mjs', T2: 'src/page.seam-bbb.mjs' });
});

test('seam候補を持たない提案からは変換入力を作らない', () => {
  const { conflict, reasons } = seamConflictFromProposal({
    proposal: { decisions: [{ verdict: 'unknown_requires_evidence' }] }, witnessSet,
  });
  assert.equal(conflict, null);
  assert.deepEqual(reasons, ['no_seam_candidate']);
});

test('実行時findingからも同じ形の変換入力を作る', () => {
  const { conflict, reasons } = seamConflictFromFinding({
    finding: { kind: 'observed_write_conflict', path: 'src/page.mjs', todo_ids: ['T2', 'T1'] },
    witnessSet,
    pathNames: { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs' },
    affectedTests: ['test/page.test.mjs'],
    baseSha: 'a'.repeat(40),
    manifestDigest: 'b'.repeat(64),
  });
  assert.deepEqual(reasons, []);
  assert.equal(conflict.sourcePath, 'src/page.mjs');
  assert.deepEqual(conflict.taskIds, ['T1', 'T2']);
  assert.deepEqual(conflict.ownedSymbolsByTask, { T1: ['renderLeft'], T2: ['CSS'] });
  assert.deepEqual(conflict.proposedPathByTask,
    { T1: 'src/page-left.mjs', T2: 'src/page-style.mjs' });
  // 実行時は提案artifactが無いので、観測したfindingそのものを出所として縛る。
  assert.match(conflict.findingDigest, /^[0-9a-f]{64}$/u);
  assert.match(conflict.candidateId, /^seam-runtime-[0-9a-f]{16}$/u);
});

test('実行時でも名前は製品が発明しない', () => {
  // 所有面のpathは提案と違って決まっていない。与えられなければ候補を作らない。
  const { conflict, reasons } = seamConflictFromFinding({
    finding: { kind: 'observed_write_conflict', path: 'src/page.mjs', todo_ids: ['T1', 'T2'] },
    witnessSet,
    pathNames: { T1: 'src/page-left.mjs' },
  });
  assert.equal(conflict, null);
  assert.deepEqual(reasons, ['owned_path_name_missing:T2']);
});

test('書込み競合でないfindingと、2 taskに満たないfindingは対象にしない', () => {
  assert.deepEqual(seamConflictFromFinding({
    finding: { kind: 'undeclared_write', path: 'src/page.mjs', todo_ids: ['T1'] }, witnessSet,
  }).reasons, ['finding_not_write_conflict']);

  assert.deepEqual(seamConflictFromFinding({
    finding: { kind: 'observed_write_conflict', path: 'src/page.mjs', todo_ids: ['T1'] },
    witnessSet,
    pathNames: { T1: 'src/page-left.mjs' },
  }).reasons, ['finding_below_two_tasks']);
});
