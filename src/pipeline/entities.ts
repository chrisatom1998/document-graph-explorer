/**
 * Lightweight named-entity heuristics (spec §5.1): code identifiers
 * (CamelCase / snake_case), ACRONYMS, and Capitalized Multi-Word Phrases.
 * These are gold in internal docs.
 */

import { STOPWORDS } from './tokenize';

const MAX_ENTITIES = 12;

// UpperCamelCase and lowerCamelCase identifiers (≥ 2 humps)
const CAMEL_CASE = /\b(?:[A-Z][a-z0-9]+|[a-z][a-z0-9]*)(?:[A-Z][a-z0-9]+)+\b/g;
// snake_case and SCREAMING_SNAKE_CASE identifiers
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const SCREAMING_SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
// 2–6 capital letters standing alone
const ACRONYM = /\b[A-Z]{2,6}\b/g;
// 2–4 capitalized words separated by single spaces
const PHRASE = /\b[A-Z][a-z]+(?: [A-Z][a-z]+){1,3}\b/g;

interface EntityStat {
  count: number;
  isPhrase: boolean;
}

function isAllStopwords(entity: string): boolean {
  const words = entity.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  if (words.length === 0) return true;
  return words.every((w) => STOPWORDS.has(w));
}

function collect(
  text: string,
  rx: RegExp,
  isPhrase: boolean,
  stats: Map<string, EntityStat>,
): void {
  for (const match of text.matchAll(rx)) {
    const entity = match[0];
    const stat = stats.get(entity);
    if (stat) {
      stat.count += 1;
    } else {
      stats.set(entity, { count: 1, isPhrase });
    }
  }
}

/**
 * Heuristic: identifiers/acronyms count from a single occurrence; capitalized
 * phrases must appear ≥ 2 times (filters sentence-initial-only noise).
 * Returns the top ~12 by frequency, excluding pure stopwords.
 */
export function extractEntities(text: string): string[] {
  const stats = new Map<string, EntityStat>();
  collect(text, CAMEL_CASE, false, stats);
  collect(text, SNAKE_CASE, false, stats);
  collect(text, SCREAMING_SNAKE, false, stats);
  collect(text, ACRONYM, false, stats);
  collect(text, PHRASE, true, stats);

  const kept: [string, number][] = [];
  for (const [entity, stat] of stats) {
    if (stat.isPhrase && stat.count < 2) continue;
    if (isAllStopwords(entity)) continue;
    kept.push([entity, stat.count]);
  }
  kept.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return kept.slice(0, MAX_ENTITIES).map((entry) => entry[0]);
}
