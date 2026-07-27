import { SEAM_REF_PREFIX, git } from './seam-commit-shared.mjs';

/** 変換の成果を指すref。branch名前空間へ置かないので、通常のbranch一覧には現れない。 */
export function seamRefFor(candidateId) {
  return `${SEAM_REF_PREFIX}/${candidateId}`;
}

/**
 * 確定済みseam refを列挙する（ADR 0142 / ADR 0141 OQ1）。
 *
 * **自動では消さない。** このrefが指すのは「五条件を通って受理された変換の実体」であり、
 * どの版がどの競合をどう解いたかを後から辿れる唯一の資源である。runが閉じたら消す設計も
 * 検討したが、それは証跡を寿命付きにするということで、記録を所有するという製品の役目と
 * 衝突する。消すかどうかは所有者の裁定に委ね、道具は「何が在るか」を見せる側だけを持つ。
 *
 * @returns {Promise<Array<{ref: string, candidate_id: string, commit_sha: string}>>}
 */
export async function listSeamRefs({ repoRoot } = {}) {
  let stdout;
  try {
    stdout = await git(['for-each-ref', '--format=%(refname) %(objectname)', SEAM_REF_PREFIX], repoRoot);
  } catch {
    return [];
  }
  return stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ref, commitSha] = line.split(' ');
      return { ref, candidate_id: ref.slice(`${SEAM_REF_PREFIX}/`.length), commit_sha: commitSha };
    })
    .sort((left, right) => (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0));
}
