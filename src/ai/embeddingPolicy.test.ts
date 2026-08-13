import { describe, expect, it } from 'vitest';
import { EMBED_MODEL_ID, EMBED_QUERY_PREFIX, EMBEDDING_FINGERPRINT } from '../config';
import { embeddingQueryText } from './embeddingPolicy';

describe('embedding model policy', () => {
  it('uses the local BGE model as the default embedding model', () => {
    expect(EMBED_MODEL_ID).toBe('Xenova/bge-small-en-v1.5');
  });

  it('prefixes short queries for retrieval without changing stored document text', () => {
    expect(embeddingQueryText('  rate limits  ')).toBe(`${EMBED_QUERY_PREFIX}rate limits`);
  });

  it('omits the English instruction prefix in language-neutral mode', () => {
    expect(embeddingQueryText('  límites de tasa  ', 'neutral')).toBe('límites de tasa');
  });

  it('includes the document-vector model in the cache fingerprint', () => {
    expect(EMBEDDING_FINGERPRINT).toContain('Xenova/bge-small-en-v1.5');
  });
});
