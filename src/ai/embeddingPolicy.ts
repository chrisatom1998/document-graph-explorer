import { EMBED_QUERY_PREFIX } from '../config';

export function embeddingQueryText(query: string): string {
  return `${EMBED_QUERY_PREFIX}${query.trim()}`;
}
