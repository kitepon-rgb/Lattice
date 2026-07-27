import { SEAM_REF_PREFIX } from './seam-commit-shared.mjs';

/** 変換の成果を指すref。branch名前空間へ置かないので、通常のbranch一覧には現れない。 */
export function seamRefFor(candidateId) {
  return `${SEAM_REF_PREFIX}/${candidateId}`;
}
