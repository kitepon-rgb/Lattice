export interface TraversalCandidate {
  node: {
    name: string;
    qualifiedName?: string;
    filePath: string;
  };
}

export type ExactTraversalSelection<T> =
  | { outcome: 'ready'; candidate: T }
  | { outcome: 'absent' | 'ambiguous'; candidate: null };

/**
 * fuzzy検索結果から、宣言されたsymbolとfileを同時にexact一致するnodeを一つだけ選ぶ。
 * node IDは既存index内の走査にだけ使い、外部contractへは公開しない。
 */
export function selectExactTraversalCandidate<T extends TraversalCandidate>(
  candidates: T[], symbol: string, exactPath: string,
): ExactTraversalSelection<T> {
  const exact = candidates.filter(({ node }) => node.filePath === exactPath
    && (node.name === symbol || node.qualifiedName === symbol));
  if (exact.length === 0) return { outcome: 'absent', candidate: null };
  if (exact.length > 1) return { outcome: 'ambiguous', candidate: null };
  return { outcome: 'ready', candidate: exact[0]! };
}
