/** Search UI adapter over the provider-independent hybrid retriever. */

import { SEARCH_MAX_RESULTS, SEARCH_MIN_SCORE } from '../config';
import { retrieveCorpus, type RetrievalMatchKind } from './retrieval';

export interface SearchHit {
  id: string;
  score: number;
  matchKind: RetrievalMatchKind;
  snippet?: string;
}

/** Label preference when scores tie: title > hybrid > semantic > keyword. */
const KIND_RANK: Record<SearchHit['matchKind'], number> = {
  title: 0,
  hybrid: 1,
  semantic: 2,
  keyword: 3,
};

/** Exported for unit testing and compatibility with existing callers. */
export function mergeHit(hits: Map<string, SearchHit>, hit: SearchHit): void {
  const prev = hits.get(hit.id);
  if (!prev) {
    hits.set(hit.id, hit);
    return;
  }
  if (hit.score > prev.score) {
    hits.set(hit.id, { ...hit, snippet: hit.snippet ?? prev.snippet });
  } else if (hit.score === prev.score && KIND_RANK[hit.matchKind] < KIND_RANK[prev.matchKind]) {
    hits.set(hit.id, { ...prev, matchKind: hit.matchKind, snippet: prev.snippet ?? hit.snippet });
  } else if (!prev.snippet && hit.snippet) {
    hits.set(hit.id, { ...prev, snippet: hit.snippet });
  }
}

function toSearchHits(retrieved: Awaited<ReturnType<typeof retrieveCorpus>>): SearchHit[] {
  const maxFused = retrieved[0]?.fusedScore ?? 1;
  return retrieved.map((hit) => ({
    id: hit.docId,
    // RRF is intentionally rank-based and has a small raw range. Normalize it
    // for the existing 0..1 UI score bar without changing ranking semantics.
    score: maxFused > 0 ? hit.fusedScore / maxFused : 0,
    matchKind: hit.matchKind,
    ...(hit.text
      ? { snippet: hit.text.replace(/\s+/g, ' ').trim().slice(0, 140) }
      : {}),
  }));
}

async function runSearch(query: string, semantic: boolean): Promise<SearchHit[]> {
  const retrieved = await retrieveCorpus(query, {
    limit: SEARCH_MAX_RESULTS,
    perDocument: 1,
    timeoutMs: 15_000,
    minSemanticScore: SEARCH_MIN_SCORE,
    maxPassageChars: 500,
    semantic,
  });
  return toSearchHits(retrieved);
}

export function searchCorpusLexical(query: string): Promise<SearchHit[]> {
  return runSearch(query, false);
}

export function searchCorpus(query: string): Promise<SearchHit[]> {
  return runSearch(query, true);
}
