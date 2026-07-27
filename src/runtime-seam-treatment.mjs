/**
 * 実行時競合を、実際の変換で解消する処置へ変える（請求項8・ADR 0137〜0139）。
 *
 * 実行時の入力は観測である。どのpathでどの2 taskがぶつかったかは`detectCheckpointFindings`が
 * 実際に変更された資源から返すので、ここで影響範囲を探し直さない。
 *
 * 変換の導出はbase状態に対して行う。holdされたTODOは再計画で旧contextを失効させられ、
 * 新plan_ref由来のpacketで再開するため、進行中の編集は設計上そこで捨てられる。
 * `head_sha`が効くのは止めずに継続するcarry-over側であり、held側ではない。
 */

import { createHash } from 'node:crypto';

import { canonicalizeArtifact } from './artifact-contracts.mjs';
import { selfDigest } from './runtime-contracts.mjs';
import { seamConflictFromFinding } from './seam-apply.mjs';

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha16 = (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

/** 資源idはidentifier規律なのでpathをそのまま使えない。boundary compilerと同じ合成形にする。 */
export function pathResourceId(target) {
  return `own-path-${sha16(target)}`;
}

function sealed(value, field) {
  const record = { ...value, [field]: '' };
  record[field] = selfDigest(record, field);
  return record;
}

function canonicalSort(entries) {
  return [...entries].sort((left, right) => compareText(
    canonicalizeArtifact(left), canonicalizeArtifact(right),
  ));
}

/**
 * 採用された変換から、再計画が読む`lattice.runtime_seam_split.v1`を組む。
 *
 * 所有の差分は「係争資源の所有を降りて、自分の新資源を所有する」である。競合辺は消える——
 * それが変換の目的であり、消えていなければ五条件のoverlap_reducedが通っていない。
 */
export function buildRuntimeSeamSplit({
  conflict, candidate, taskMigrationDigest, verifierRefs = [],
} = {}) {
  const owned = (candidate?.surfaces ?? []).filter(({ role }) => role === 'task_owned');
  if (owned.length < 2) return { split: null, reasons: ['owned_surfaces_below_two'] };
  const sourceResource = pathResourceId(conflict.sourcePath);

  const removed = canonicalSort(conflict.taskIds.map((taskId) => ({
    resource_id: sourceResource, owner_todo_id: taskId, access_kind: 'own',
  })));
  const added = canonicalSort(owned.map((surface) => ({
    resource_id: pathResourceId(surface.path),
    owner_todo_id: surface.owner_task_ids[0],
    access_kind: 'own',
  })));

  // 競合辺は消える側だけを載せる。変換で新しい競合を作っていないことは
  // 五条件のoverlap_reduced（plan全体の競合対が増えない）が既に見ている。
  const removedEdges = [];
  for (let left = 0; left < conflict.taskIds.length; left += 1) {
    for (let right = left + 1; right < conflict.taskIds.length; right += 1) {
      const pair = [conflict.taskIds[left], conflict.taskIds[right]].sort(compareText);
      removedEdges.push({ from_todo_id: pair[0], to_todo_id: pair[1], kind: 'conflict' });
    }
  }

  const split = sealed({
    schema: 'lattice.runtime_seam_split.v1',
    finding_digest: conflict.findingDigest,
    predecessor_task_ids: [...conflict.taskIds].sort(compareText),
    task_migration_digest: taskMigrationDigest,
    ownership_diff: sealed({
      schema: 'lattice.runtime_ownership_diff.v1', added, removed, diff_digest: '',
    }, 'diff_digest'),
    edge_diff: sealed({
      schema: 'lattice.runtime_edge_diff.v1',
      added: [], removed: canonicalSort(removedEdges), diff_digest: '',
    }, 'diff_digest'),
    verifier_refs: [...new Set(verifierRefs)].sort(compareText),
    split_digest: '',
  }, 'split_digest');
  return { split, reasons: [] };
}

/**
 * 実行時競合の処置を決める。
 *
 * 事前宣言された処置があればそれを使う。無ければ**その場で変換候補を導出して適用を試みる**——
 * ここが請求項8の一手で、従来は事前宣言が無い競合をすべて意図的直列へ倒していた。
 *
 * 変換は五条件を通ったときだけ処置になる。1つでも欠けたら意図的直列へ送り、欠けた条件を残す。
 * 「実行時だから緩める」ことをしない——緩めると、外部挙動を変えうる変更が便益の証明なしに
 * 実行中のrunへ入る。
 */
export async function resolveRuntimeSeamTreatment(options = {}) {
  const {
    finding, witnessSet, pathNames = {}, predeclaredTreatments = [],
    applyConflict, baseSha, manifestDigest, affectedTests = [], taskMigrationDigest,
  } = options;

  if (finding?.kind === 'observed_write_conflict' && typeof finding.path === 'string') {
    for (const treatment of predeclaredTreatments) {
      if (Array.isArray(treatment.covered_paths) && treatment.covered_paths.includes(finding.path)) {
        return { lane: 'seam_transform', treatment: structuredClone(treatment), split: null, reasons: [] };
      }
    }
  }

  const { conflict, reasons } = seamConflictFromFinding({
    finding, witnessSet, pathNames, affectedTests, baseSha, manifestDigest,
  });
  if (conflict === null) {
    return { lane: 'intentional_serial', treatment: null, split: null, reasons };
  }
  if (typeof applyConflict !== 'function') {
    return {
      lane: 'intentional_serial', treatment: null, split: null, reasons: ['applier_absent'],
    };
  }

  const applied = await applyConflict({ conflict });
  if (applied?.outcome?.decision !== 'accepted') {
    return {
      lane: 'intentional_serial',
      treatment: null,
      split: null,
      reasons: [...(applied?.outcome?.reasons ?? ['transform_rejected'])],
    };
  }

  const built = buildRuntimeSeamSplit({
    conflict,
    candidate: applied.candidate ?? { surfaces: applied.outcome.surfaces ?? [] },
    taskMigrationDigest,
    verifierRefs: affectedTests,
  });
  if (built.split === null) {
    return { lane: 'intentional_serial', treatment: null, split: null, reasons: built.reasons };
  }
  return {
    lane: 'seam_transform',
    treatment: {
      covered_paths: [conflict.sourcePath],
      candidate_digest: applied.outcome.candidate_digest,
    },
    split: built.split,
    files: applied.files ?? null,
    reasons: [],
  };
}
