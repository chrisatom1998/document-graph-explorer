import { describe, expect, it } from 'vitest';
import { MAX_NODES } from '../config';
import { CHUNK_CONTEXT_CHARS } from './ragChatConstants';
import {
  CHARS_PER_TOKEN,
  MILLION_TOKEN_WINDOW,
  RAG_ALL_DOCS_MAX_CHARS,
  allDocsMaxChars,
  charsPerDocumentForBudget,
  estimateAllDocsWindow,
  estimateTokensFromChars,
  generationTimeoutMs,
  reservedTokensForWindow,
} from './chatContextBudget';

describe('all-documents context budget', () => {
  it('uses a conservative 2 chars/token and scales the reserve with the window', () => {
    expect(CHARS_PER_TOKEN).toBe(2);
    expect(reservedTokensForWindow(1_000_000)).toBe(100_000);
    expect(reservedTokensForWindow(200_000)).toBe(20_000);
    expect(reservedTokensForWindow(32_000)).toBe(16_000);
    expect(RAG_ALL_DOCS_MAX_CHARS).toBe(allDocsMaxChars(MILLION_TOKEN_WINDOW));
    expect(RAG_ALL_DOCS_MAX_CHARS).toBe(1_800_000);
  });

  it('caps Haiku-sized 200k windows well below the 1M packing ceiling', () => {
    expect(allDocsMaxChars(200_000)).toBe(360_000);
    const haiku = estimateAllDocsWindow({
      documentCount: 534,
      charsPerDocument: CHUNK_CONTEXT_CHARS,
      windowTokens: 200_000,
    });
    expect(haiku.fitsEntireCorpus).toBe(false);
    expect(haiku.documentsThatFit).toBe(240);
  });

  it('fits the demo corpus and the max graph in one 1M-token turn', () => {
    const demo = estimateAllDocsWindow({
      documentCount: 50,
      charsPerDocument: CHUNK_CONTEXT_CHARS,
    });
    expect(demo.fitsEntireCorpus).toBe(true);
    expect(demo.contextTokens).toBe(estimateTokensFromChars(50 * CHUNK_CONTEXT_CHARS));
    expect(demo.windowFractionUsed).toBeLessThan(0.05);
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
    // 900k tokens * 2 chars / 1500 chars = 1200 documents.
    expect(estimate.documentsThatFit).toBe(1200);
    expect(estimate.fitsEntireCorpus).toBe(false);
  });

  it('extends the generation timeout with prompt size and caps it', () => {
    expect(generationTimeoutMs(0, 120_000)).toBe(120_000);
    expect(generationTimeoutMs(8_000, 120_000)).toBe(122_000);
    expect(generationTimeoutMs(10_000_000, 120_000)).toBe(600_000);
  });
});
