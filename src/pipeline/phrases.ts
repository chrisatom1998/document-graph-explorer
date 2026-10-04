/**
 * RAKE-style multiword keyphrase candidates (roadmap item 15).
 * Stopword-delimited 2..PHRASE_MAX_WORDS n-gram counts, computed in the
 * pipeline worker so cache-restored docs get phrases via the analyze path.
 *
 * Phrase keys contain spaces, so they never collide with unigram tf keys.
 * Aggregators MUST compute IDF over the combined unigram+phrase maps —
 * feeding phrases into keywordEdges without phrase-level IDF flattens every
 * keyword edge to weight 0.85 (span 0 -> ratio 1).
 */

import {
  PHRASE_MAX_WORDS,
  PHRASE_MIN_TF,
  PHRASE_TOP_PER_DOC,
} from "../config";
import { STOPWORDS } from "./tokenize";

// Must match tokenize.ts: length / numbers-only rules for a content token.
const MIN_TOKEN_LEN = 3;
const MAX_TOKEN_LEN = 30;
const NUMBERS_ONLY = /^\d+$/;
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function isContentToken(raw: string): boolean {
  if (raw.length < MIN_TOKEN_LEN || raw.length > MAX_TOKEN_LEN) return false;
  if (NUMBERS_ONLY.test(raw)) return false;
  return true;
}

/**
 * Stopword-delimited 2..PHRASE_MAX_WORDS n-gram counts (RAKE-style candidates).
 */
export function extractPhraseTf(text: string): Record<string, number> {
  if (!text || text.trim().length === 0) return {};

  const counts = new Map<string, number>();
  let segment: string[] = [];

  const flush = (): void => {
    if (segment.length >= 2) {
      const maxN = Math.min(PHRASE_MAX_WORDS, segment.length);
      for (let n = 2; n <= maxN; n += 1) {
        for (let i = 0; i + n <= segment.length; i += 1) {
          const phrase = segment.slice(i, i + n).join(" ");
          counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
        }
      }
    }
    segment = [];
  };

  for (const sentence of text.toLowerCase().split(/[.!?:;\r\n]+/)) {
    for (const raw of sentence.split(WORD_SPLIT)) {
      if (!raw || STOPWORDS.has(raw) || !isContentToken(raw)) {
        flush();
        continue;
      }
      segment.push(raw);
    }
    flush();
  }

  const kept: [string, number][] = [];
  for (const [phrase, count] of counts) {
    if (count >= PHRASE_MIN_TF) kept.push([phrase, count]);
  }
  kept.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  const out: Record<string, number> = {};
  for (const [phrase, count] of kept.slice(0, PHRASE_TOP_PER_DOC)) {
    out[phrase] = count;
  }
  return out;
}
