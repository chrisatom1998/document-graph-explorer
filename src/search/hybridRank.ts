/** Reciprocal-rank fusion and a small diversity pass shared by local retrieval UIs. */
export interface RankedCandidate {
  id: string;
  semanticRank?: number;
  lexicalRank?: number;
  groupId?: string;
  /** Exact identifier tokens from the query (e.g. "PT-01") found in this candidate. */
  identifierHits?: number;
}

const RRF_K = 60;
/** The largest score plain rank fusion can give, so each identifier hit outranks any rank-only candidate. */
const IDENTIFIER_BONUS = 2 / (RRF_K + 1);

export function reciprocalRankFusion<T extends RankedCandidate>(candidates: T[]): Array<T & { score: number }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score:
        (candidate.semanticRank ? 1 / (RRF_K + candidate.semanticRank) : 0) +
        (candidate.lexicalRank ? 1 / (RRF_K + candidate.lexicalRank) : 0) +
        (candidate.identifierHits ?? 0) * IDENTIFIER_BONUS,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Greedy diversity cap: preserves the best evidence while avoiding one-document result walls. */
export function diversifyRanked<T extends { id: string; groupId?: string }>(items: T[], limit: number, perGroup = 2): T[] {
  const seen = new Map<string, number>();
  const result: T[] = [];
  for (const item of items) {
    const group = item.groupId ?? item.id;
    if ((seen.get(group) ?? 0) >= perGroup) continue;
    seen.set(group, (seen.get(group) ?? 0) + 1);
    result.push(item);
    if (result.length === limit) break;
  }
  return result;
}
