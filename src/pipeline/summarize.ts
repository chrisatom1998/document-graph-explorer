/**
 * Local extractive summaries (roadmap item 14): sentence-level TextRank with
 * LEXICAL similarity — cosine over term-frequency maps built with the existing
 * tokenize() — computed inside the pipeline worker as part of parse/analyze.
 * Deterministic, dependency-free, and offline by construction: no embedding
 * traffic, no new pool message type.
 *
 * Deliberately not perfect NLP: the sentence splitter is a punctuation
 * heuristic whose short-fragment merging happens to heal common abbreviation
 * splits ("e.g.") — see summarize.test.ts for the chosen behavior.
 */

import {
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_INPUT_SENTENCES,
  SUMMARY_SENTENCES,
} from '../config';
import { tokenize } from './tokenize';

/** Fragments shorter than this merge into a neighboring sentence. */
const MIN_FRAGMENT_CHARS = 25;
/** Safety valve for run-on "sentences" (tables, minified text). */
const MAX_SENTENCE_CHARS = 400;

const DAMPING = 0.85;
const MAX_ITERATIONS = 30;
const CONVERGENCE_DELTA = 1e-4;

// A sentence is text up to a run of enders (./!/?) plus any closing
// quotes/parens riding on it — but only where whitespace (or the line end)
// follows, so "e.g." and "3.5" don't split mid-token — or a tail of the
// line with no ender at all.
const SENTENCE_RE = /.+?[.!?]+[)\]"'”’»]*(?=\s|$)|.+$/g;

/**
 * Split text into sentences on ./!/? (keeping closing quotes/parens with
 * their sentence) and hard newlines. Fragments under MIN_FRAGMENT_CHARS are
 * merged forward into the next sentence (a trailing fragment merges into the
 * previous one), and every sentence is capped at MAX_SENTENCE_CHARS.
 * Returns [] for empty/whitespace-only input.
 */
export function splitSentences(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const pieces: string[] = [];
  for (const line of text.split(/\r?\n+/)) {
    for (const match of line.match(SENTENCE_RE) ?? []) {
      const piece = match.trim();
      if (piece.length > 0) pieces.push(piece);
    }
  }

  const sentences: string[] = [];
  let carry = '';
  for (const piece of pieces) {
    const current = carry.length > 0 ? `${carry} ${piece}` : piece;
    if (current.length < MIN_FRAGMENT_CHARS) {
      carry = current; // too short to stand alone — keep gluing forward
      continue;
    }
    sentences.push(current);
    carry = '';
  }
  if (carry.length > 0) {
    // a short tail has no next sentence — fold it into the previous one
    if (sentences.length > 0) sentences[sentences.length - 1] += ` ${carry}`;
    else sentences.push(carry);
  }

  return sentences.map((s) =>
    s.length > MAX_SENTENCE_CHARS ? s.slice(0, MAX_SENTENCE_CHARS) : s,
  );
}

function termVector(sentence: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokenize(sentence)) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

function cosine(a: Map<string, number>, b: Map<string, number>, normA: number, normB: number): number {
  if (normA === 0 || normB === 0) return 0;
  // iterate the smaller map
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, count] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += count * other;
  }
  return dot / (normA * normB);
}

function norm(tf: Map<string, number>): number {
  let sum = 0;
  for (const count of tf.values()) sum += count * count;
  return Math.sqrt(sum);
}

/** Truncate at SUMMARY_MAX_CHARS on a word boundary, marking the cut with '…'. */
function truncateAtWord(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  const cut = text.lastIndexOf(' ', SUMMARY_MAX_CHARS - 1);
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, SUMMARY_MAX_CHARS - 1);
  return `${head.trimEnd()}…`;
}

/**
 * TextRank over the first SUMMARY_MAX_INPUT_SENTENCES sentences: TF-cosine
 * similarity graph, damping 0.85, ≤MAX_ITERATIONS power iterations or
 * Δ<CONVERGENCE_DELTA. The top `maxSentences` sentences are re-sorted into
 * document order and joined with a space. Returns '' when nothing usable.
 */
export function summarize(text: string, maxSentences = SUMMARY_SENTENCES): string {
  const sentences = splitSentences(text).slice(0, SUMMARY_MAX_INPUT_SENTENCES);
  if (sentences.length === 0) return '';
  if (sentences.length <= maxSentences) return truncateAtWord(sentences.join(' '));

  const n = sentences.length;
  const vectors = sentences.map(termVector);
  const norms = vectors.map(norm);

  // Symmetric similarity matrix + per-node degree (sum of edge weights).
  const sim = new Float64Array(n * n);
  const degree = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vectors[i], vectors[j], norms[i], norms[j]);
      if (s <= 0) continue;
      sim[i * n + j] = s;
      sim[j * n + i] = s;
      degree[i] += s;
      degree[j] += s;
    }
  }

  // Weighted PageRank. Isolated sentences keep the (1-d)/n floor.
  let scores = new Float64Array(n).fill(1 / n);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const next = new Float64Array(n).fill((1 - DAMPING) / n);
    for (let j = 0; j < n; j++) {
      if (degree[j] === 0) continue;
      const share = (DAMPING * scores[j]) / degree[j];
      for (let i = 0; i < n; i++) {
        const s = sim[j * n + i];
        if (s > 0) next[i] += share * s;
      }
    }
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - scores[i]);
    scores = next;
    if (delta < CONVERGENCE_DELTA) break;
  }

  const picked = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => scores[b] - scores[a] || a - b) // score desc, doc order tie-break
    .slice(0, maxSentences)
    .sort((a, b) => a - b); // back into document order

  return truncateAtWord(picked.map((i) => sentences[i]).join(' '));
}
