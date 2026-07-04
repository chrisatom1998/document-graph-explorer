/**
 * Entity edges — document links from shared named entities (spec §5.1's
 * "entities are gold in internal docs"). The extractor already pulls code
 * identifiers, acronyms, and capitalized phrases onto every node
 * (entities.ts); until now nothing turned them into links. Two docs that both
 * reference `AuthService` or `refresh_token_flow` are almost certainly
 * related — a higher-precision signal than a shared common keyword.
 *
 * Structurally a sibling of keywordEdges (tfidf.ts): an inverted index,
 * IDF-weighted pair scores, a per-doc fan-out cap against hairballs, and
 * min-max normalized weights. Entities are matched case-sensitively — they are
 * identifiers, so 'IT' (acronym) must not fold into 'it'.
 *
 * PURE — runs in the aggregator worker and is unit-tested directly.
 */

import type { Edge } from '../model/types';

// Entities are rarer and higher-precision than keywords, so their edges sit a
// notch higher in the weight band.
const ENTITY_WEIGHT_MIN = 0.35;
const ENTITY_WEIGHT_MAX = 0.9;
const MAX_EVIDENCE_ENTITIES = 4;

/**
 * An entity in this many documents carries negligible IDF and would only
 * expand into O(df²) low-value pairs — skip its pairing (mirrors tfidf.ts).
 */
const MAX_ENTITY_DF_FOR_PAIRING = 150;

interface PairAcc {
  a: string;
  b: string;
  score: number;
  shared: string[];
}

export function entityEdges(
  docs: { id: string; entities: string[] }[],
  params: { minShared: number; edgesPerDoc: number },
): Edge[] {
  // inverted index: entity -> doc ids that mention it (deduped per doc)
  const docsByEntity = new Map<string, string[]>();
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const entity of doc.entities ?? []) {
      if (!entity || seen.has(entity)) continue;
      seen.add(entity);
      let list = docsByEntity.get(entity);
      if (!list) {
        list = [];
        docsByEntity.set(entity, list);
      }
      list.push(doc.id);
    }
  }

  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [entity, ids] of docsByEntity) {
    idf.set(entity, Math.log(1 + n / ids.length));
  }

  // accumulate pair scores from co-occurring entities
  const pairs = new Map<string, PairAcc>();
  for (const [entity, ids] of docsByEntity) {
    if (ids.length < 2 || ids.length > MAX_ENTITY_DF_FOR_PAIRING) continue;
    const weight = idf.get(entity) ?? 0;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i] < ids[j] ? ids[i] : ids[j];
        const b = ids[i] < ids[j] ? ids[j] : ids[i];
        const key = `${a} ${b}`;
        let pair = pairs.get(key);
        if (!pair) {
          pair = { a, b, score: 0, shared: [] };
          pairs.set(key, pair);
        }
        pair.score += weight;
        pair.shared.push(entity);
      }
    }
  }

  // threshold on shared count, then strongest-first per-doc cap
  const kept: PairAcc[] = [];
  for (const pair of pairs.values()) {
    if (pair.shared.length >= params.minShared) kept.push(pair);
  }
  kept.sort((x, y) => y.score - x.score);

  const degree = new Map<string, number>();
  const capped: PairAcc[] = [];
  for (const pair of kept) {
    const da = degree.get(pair.a) ?? 0;
    const db = degree.get(pair.b) ?? 0;
    if (da >= params.edgesPerDoc || db >= params.edgesPerDoc) continue;
    degree.set(pair.a, da + 1);
    degree.set(pair.b, db + 1);
    capped.push(pair);
  }
  if (capped.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const pair of capped) {
    if (pair.score < min) min = pair.score;
    if (pair.score > max) max = pair.score;
  }
  const span = max - min;

  return capped.map((pair): Edge => {
    const ratio = span > 0 ? (pair.score - min) / span : 1;
    // show the rarest shared identifiers first — they carry the most signal
    const shared = [...pair.shared]
      .sort((x, y) => (idf.get(y) ?? 0) - (idf.get(x) ?? 0) || (x < y ? -1 : 1))
      .slice(0, MAX_EVIDENCE_ENTITIES)
      .map((e) => `'${e}'`)
      .join(', ');
    return {
      id: `${pair.a}->${pair.b}:entity`,
      source: pair.a,
      target: pair.b,
      kind: 'entity',
      weight: ENTITY_WEIGHT_MIN + (ENTITY_WEIGHT_MAX - ENTITY_WEIGHT_MIN) * ratio,
      evidence: [`shared identifiers: ${shared}`],
    };
  });
}
