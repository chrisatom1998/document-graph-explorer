/**
 * Lightweight named-entity heuristics (spec §5.1): code identifiers
 * (CamelCase / snake_case), ACRONYMS, and Capitalized Multi-Word Phrases.
 * These are gold in internal docs.
 */

import { entityKey } from './aliases';
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
// 3+ all-caps words in a row: a shouted heading ("LOAD TEST RESULTS"), whose
// words are ordinary vocabulary, not acronyms.
const SHOUTED_RUN = /\b[A-Z]{2,}(?:[ \t]+[A-Z]{2,}){2,}\b/g;

/**
 * All-caps tokens that are boilerplate in almost any document: format and
 * protocol names, time zones, titles, status words, roman numerals. They match
 * the acronym pattern but say nothing about what a document is about, so two
 * docs sharing them are not related.
 */
const GENERIC_ACRONYMS: ReadonlySet<string> = new Set([
  'API', 'APIS', 'PDF', 'CSV', 'JSON', 'XML', 'HTML', 'HTTP', 'HTTPS', 'URL', 'URI',
  'ID', 'IDS', 'OK', 'FAQ', 'TBD', 'TBA', 'ETA', 'FYI', 'ASAP', 'TODO', 'NA',
  'AM', 'PM', 'UTC', 'GMT', 'EST', 'PST', 'CET',
  'CEO', 'CTO', 'CFO', 'COO', 'VP', 'HR', 'PR', 'QA', 'UI', 'UX', 'IT',
  'INC', 'LLC', 'LLP', 'LTD', 'US', 'USA', 'UK', 'EU',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
  'NOTE', 'NOTES', 'PASS', 'FAIL', 'YES', 'NO', 'NEW', 'LOW', 'HIGH', 'NULL', 'NONE', 'ALL',
]);

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
 * Spellings of one name ('dependency_groups', 'Dependency Groups') pool their
 * counts and take one slot, under the doc's most frequent spelling.
 * Returns the top ~12 by frequency, excluding pure stopwords.
 */
export function extractEntities(text: string): string[] {
  const stats = new Map<string, EntityStat>();
  // Blank shouted headings so their words aren't read as acronyms; other
  // patterns never match all-caps runs, so nothing else is lost.
  const acronymText = text.replace(SHOUTED_RUN, (run) => ' '.repeat(run.length));
  collect(text, CAMEL_CASE, false, stats);
  collect(text, SNAKE_CASE, false, stats);
  collect(text, SCREAMING_SNAKE, false, stats);
  collect(acronymText, ACRONYM, false, stats);
  collect(text, PHRASE, true, stats);

  const byKey = new Map<string, { entity: string; best: number; count: number }>();
  for (const [entity, stat] of stats) {
    if (stat.isPhrase && stat.count < 2) continue;
    if (isAllStopwords(entity)) continue;
    if (GENERIC_ACRONYMS.has(entity)) continue;
    const key = entityKey(entity);
    const group = byKey.get(key);
    if (!group) {
      byKey.set(key, { entity, best: stat.count, count: stat.count });
      continue;
    }
    group.count += stat.count;
    if (stat.count > group.best || (stat.count === group.best && entity < group.entity)) {
      group.entity = entity;
      group.best = stat.count;
    }
  }
  const kept: [string, number][] = [...byKey.values()].map((g) => [g.entity, g.count]);
  kept.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return kept.slice(0, MAX_ENTITIES).map((entry) => entry[0]);
}
