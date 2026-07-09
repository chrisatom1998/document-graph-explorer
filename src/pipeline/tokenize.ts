/**
 * Tokenization + term-frequency counting for the lexical layer (spec §5.1).
 * Pure functions — used by the pipeline worker and by unit tests.
 */

/** ~130 common English stopwords (also consumed by entities.ts). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am',
  'an', 'and', 'any', 'are', 'aren', 'as', 'at', 'be', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'cannot', 'could', 'did', 'do', 'does', 'doing', 'don', 'done', 'down',
  'during', 'each', 'else', 'few', 'for', 'from', 'further', 'had', 'has',
  'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'however', 'i', 'if', 'in', 'into', 'is', 'isn',
  'it', 'its', 'itself', 'just', 'let', 'may', 'me', 'might', 'more',
  'most', 'must', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off',
  'on', 'once', 'only', 'onto', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'shall', 'she', 'should',
  'since', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'upon', 'us', 'very',
  'via', 'was', 'we', 'were', 'what', 'when', 'where', 'whether', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'within', 'without',
  'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
]);

const MIN_TOKEN_LEN = 3;
const MAX_TOKEN_LEN = 30;
const NUMBERS_ONLY = /^\d+$/;

// Unicode property escapes (\p{L} letters, \p{N} numbers, `u` flag) instead
// of an ASCII-only [a-z0-9] class, so non-Latin-script text (e.g. Cyrillic,
// CJK, Arabic) tokenizes into real tokens rather than being split into
// individual characters (or dropped entirely) at every non-ASCII boundary.
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Lowercase, split on non-alphanumerics (Unicode-aware), drop very
 * short/long tokens, numbers-only tokens, and stopwords.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(WORD_SPLIT)) {
    if (raw.length < MIN_TOKEN_LEN || raw.length > MAX_TOKEN_LEN) continue;
    if (NUMBERS_ONLY.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

export function termFreq(tokens: string[]): { tf: Record<string, number>; total: number } {
  const tf: Record<string, number> = {};
  for (const token of tokens) {
    tf[token] = (tf[token] ?? 0) + 1;
  }
  return { tf, total: tokens.length };
}
