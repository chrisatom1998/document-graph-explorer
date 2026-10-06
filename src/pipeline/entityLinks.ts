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
 * min-max normalized weights. Entities match by entityKey (aliases.ts): the
 * same name in camelCase, snake_case or prose, singular or plural, is one
 * entity, while acronyms stay case-sensitive so 'IT' never folds into 'it'.
 *
 * PURE — runs in the aggregator worker and is unit-tested directly.
 */

import type { Edge } from '../model/types';
import { entityKey } from './aliases';

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

/**
 * Entities mentioned by more than this share of the corpus are corpus-wide
 * vocabulary (the company name, a ticket prefix, a team-wide acronym), not
 * evidence that two particular docs belong together. They neither pair docs
 * nor count toward `minShared`.
 */
const MAX_IDENTIFIER_DOC_FRACTION = 0.1;
/**
 * Capitalized phrases are mostly names of people and customers, who show up
 * across unrelated work, so they go corpus-wide sooner. On the generated demo
 * records, shared people and customer names linked unrelated records over
 * half the time (src/eval/graphAccuracy.test.ts).
 */
const MAX_PHRASE_DOC_FRACTION = 0.05;
/** ...but never below this many docs, so small corpora keep their entity links. */
const MIN_ENTITY_DF_CAP = 4;
/** Shape of entities.ts's capitalized-phrase pattern ("Maya Patel", "Search Engineering"). */
const CAPITALIZED_PHRASE = /^[A-Z][a-z]+(?: [A-Z][a-z]+)+$/;

/** Minimum length for a corpus-unique entity to link a pair on its own. */
const UNIQUE_ENTITY_MIN_LEN = 6;

/**
 * The unique-entity rule needs a corpus large enough for df === 2 to mean
 * something: in a 5-doc drop every shared entity is "rare", and keyword +
 * semantic edges already connect small corpora densely.
 */
const UNIQUE_ENTITY_MIN_CORPUS = 8;

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
  // inverted index: entity key -> doc ids that mention it (deduped per doc),
  // shown under the first spelling seen; identifiers win over phrases for
  // the df cap, since a name written as code is not a person's name
  const docsByEntity = new Map<string, string[]>();
  const shownAs = new Map<string, string>();
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const entity of doc.entities ?? []) {
      if (!entity) continue;
      const key = entityKey(entity);
      if (seen.has(key)) continue;
      seen.add(key);
      let list = docsByEntity.get(key);
      if (!list) {
        list = [];
        docsByEntity.set(key, list);
        shownAs.set(key, entity);
      } else if (CAPITALIZED_PHRASE.test(shownAs.get(key)!) && !CAPITALIZED_PHRASE.test(entity)) {
        shownAs.set(key, entity);
      }
      list.push(doc.id);
    }
  }

  const n = docs.length;
  const dfCap = (fraction: number): number =>
    Math.min(MAX_ENTITY_DF_FOR_PAIRING, Math.max(MIN_ENTITY_DF_CAP, Math.ceil(n * fraction)));
  const identifierMaxDf = dfCap(MAX_IDENTIFIER_DOC_FRACTION);
  const phraseMaxDf = dfCap(MAX_PHRASE_DOC_FRACTION);
  const idf = new Map<string, number>();
  for (const [entity, ids] of docsByEntity) {
    idf.set(entity, Math.log(1 + n / ids.length));
  }

  // accumulate pair scores from co-occurring entities
  const pairs = new Map<string, PairAcc>();
  for (const [entity, ids] of docsByEntity) {
    const maxDf = CAPITALIZED_PHRASE.test(shownAs.get(entity)!) ? phraseMaxDf : identifierMaxDf;
    if (ids.length < 2 || ids.length > maxDf) continue;
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
    if (pair.shared.length >= params.minShared) {
      kept.push(pair);
      continue;
    }
    // Below the shared-count floor, a single entity still links the pair when
    // NO other document in the corpus mentions it (df === 2 means exactly
    // these two): a corpus-unique identifier like `refresh_token_flow` is a
    // near-certain relationship, unlike one shared common acronym. The length
    // floor keeps short acronym coincidences ('QA', 'CI') out.
    if (
      n >= UNIQUE_ENTITY_MIN_CORPUS &&
      pair.shared.some(
        (entity) =>
          entity.length >= UNIQUE_ENTITY_MIN_LEN &&
          (docsByEntity.get(entity)?.length ?? 0) === 2,
      )
    ) {
      kept.push(pair);
    }
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
      .map((e) => `'${shownAs.get(e)}'`)
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
