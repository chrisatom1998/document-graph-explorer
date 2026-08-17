import { describe, expect, it } from 'vitest';
import { MAX_NODES } from '../config';
import { CHUNK_CONTEXT_CHARS } from './ragChatConstants';
import {
  CHARS_PER_TOKEN,
  MILLION_TOKEN_WINDOW,
  RAG_ALL_DOCS_MAX_CHARS,
  RAG_ALL_DOCS_RESERVED_TOKENS,
  charsPerDocumentForBudget,
  estimateAllDocsWindow,
  estimateTokensFromChars,
} from './chatContextBudget';

describe('all-documents 1M-token window', () => {
  it('reserves 100k tokens and packs the rest as document text', () => {
    expect(RAG_ALL_DOCS_MAX_CHARS).toBe(
      (MILLION_TOKEN_WINDOW - RAG_ALL_DOCS_RESERVED_TOKENS) * CHARS_PER_TOKEN,
    );
    expect(RAG_ALL_DOCS_MAX_CHARS).toBe(3_600_000);
  });

  it('fits the demo corpus and the max graph in one 1M-token turn', () => {
    const demo = estimateAllDocsWindow({
      documentCount: 50,
      charsPerDocument: CHUNK_CONTEXT_CHARS,
    });
    expect(demo.fitsEntireCorpus).toBe(true);
    expect(demo.contextTokens).toBe(estimateTokensFromChars(50 * CHUNK_CONTEXT_CHARS));
    expect(demo.windowFractionUsed).toBeLessThan(0.03);
    expect(demo.theoreticalTurnsIfAccumulated).toBeGreaterThan(10);

    const packedMax = charsPerDocumentForBudget(
      MAX_NODES,
      RAG_ALL_DOCS_MAX_CHARS,
      CHUNK_CONTEXT_CHARS,
    );
    const maxCorpus = estimateAllDocsWindow({
      documentCount: MAX_NODES,
      charsPerDocument: packedMax,
    });
    expect(maxCorpus.fitsEntireCorpus).toBe(true);
    expect(maxCorpus.contextTokens + maxCorpus.reservedTokens).toBeLessThanOrEqual(
      MILLION_TOKEN_WINDOW,
    );
  });

  it('reports how many 1500-char documents fill the 1M window', () => {
    const estimate = estimateAllDocsWindow({
      documentCount: 10_000,
      charsPerDocument: CHUNK_CONTEXT_CHARS,
    });
    // 900k tokens * 4 chars / 1500 chars ≈ 2400 documents.
    expect(estimate.documentsThatFit).toBe(2400);
    expect(estimate.fitsEntireCorpus).toBe(false);
  });
});
