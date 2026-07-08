/**
 * Splits document text into ~CHUNK_TOKENS-token chunks with CHUNK_OVERLAP
 * overlap for embedding (spec §5.2). Prefers paragraph boundaries,
 * hard-splits oversized paragraphs, and respects the corpus-wide
 * MAX_EMBED_TEXT_BYTES cap per document (spec §4.3).
 */

import { CHUNK_OVERLAP, CHUNK_TOKENS, MAX_EMBED_TEXT_BYTES } from '../config';

/** tokens ≈ words × 1.3, so words-per-chunk = targetTokens / 1.3 */
const TOKENS_PER_WORD = 1.3;
const MIN_CHUNK_WORDS = 16;

export interface ChunkResult {
  chunks: string[];
  /**
   * True when the per-document embed byte budget cut off later chunks, so the
   * returned chunks cover only the leading portion of the document. Callers
   * should surface this (e.g. a 'partial' node warning) rather than silently
   * indexing part of a large document.
   */
  truncated: boolean;
}

export function chunkText(
  text: string,
  targetTokens: number = CHUNK_TOKENS,
  overlap: number = CHUNK_OVERLAP,
): ChunkResult {
  const cleaned = text.trim();
  if (!cleaned) return { chunks: [], truncated: false };

  const targetWords = Math.max(MIN_CHUNK_WORDS, Math.round(targetTokens / TOKENS_PER_WORD));
  const overlapWords = Math.min(
    Math.max(0, Math.floor(targetWords * overlap)),
    targetWords - 1,
  );

  // 1) paragraph segments; hard-split paragraphs longer than a chunk
  const segments: string[][] = [];
  for (const para of cleaned.split(/\n\s*\n+/)) {
    const words = para.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;
    if (words.length <= targetWords) {
      segments.push(words);
      continue;
    }
    const step = Math.max(1, targetWords - overlapWords);
    for (let start = 0; start < words.length; start += step) {
      segments.push(words.slice(start, start + targetWords));
      if (start + targetWords >= words.length) break;
    }
  }
  if (segments.length === 0) return { chunks: [], truncated: false };

  // 2) greedy packing into chunks, carrying an overlap tail between chunks
  const chunks: string[] = [];
  let current: string[] = [];
  let carried = 0; // words at the head of `current` that are pure overlap
  for (const segment of segments) {
    if (current.length > carried && current.length + segment.length > targetWords) {
      chunks.push(current.join(' '));
      const tail = current.slice(current.length - Math.min(overlapWords, current.length));
      current = tail.slice();
      carried = current.length;
    }
    current = current.concat(segment);
  }
  if (current.length > carried || chunks.length === 0) {
    chunks.push(current.join(' '));
  }

  // 3) enforce the per-document embed byte budget (truncate further chunks)
  const encoder = new TextEncoder();
  const out: string[] = [];
  let usedBytes = 0;
  let truncated = false;
  for (const chunk of chunks) {
    const chunkBytes = encoder.encode(chunk).byteLength;
    if (usedBytes + chunkBytes > MAX_EMBED_TEXT_BYTES) {
      truncated = true;
      if (out.length === 0) {
        // pathological single oversized chunk (e.g. minified blobs):
        // never return an empty result for a non-empty document
        out.push(chunk.slice(0, Math.max(1, Math.floor(MAX_EMBED_TEXT_BYTES / 2))));
      }
      break;
    }
    usedBytes += chunkBytes;
    out.push(chunk);
  }
  return { chunks: out, truncated };
}
