import { EMBED_QUERY_PREFIX } from '../config';
import type { EmbeddingQueryStyle } from '../store/settingsStore';

/**
 * BGE-small was trained with an English retrieval instruction. That prefix
 * helps English queries and hurts mixed-language ones, so multilingual
 * corpora can opt into a raw (unprefixed) query string.
 */
export function embeddingQueryText(
  query: string,
  style: EmbeddingQueryStyle = 'english',
): string {
  const trimmed = query.trim();
  return style === 'neutral' ? trimmed : `${EMBED_QUERY_PREFIX}${trimmed}`;
}
