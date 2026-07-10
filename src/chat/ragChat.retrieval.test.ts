import { describe, expect, it, vi } from 'vitest';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn(),
}));

import { buildPrompt, diversifyChunks, keywordEvidence } from './ragChat';

describe('RAG retrieval helpers', () => {
  it('caps passages from one document to preserve corpus diversity', () => {
    const selected = diversifyChunks([
      { docId: 'a', score: 0.99 },
      { docId: 'a', score: 0.98 },
      { docId: 'a', score: 0.97 },
      { docId: 'b', score: 0.96 },
    ], 3, 2);
    expect(selected).toEqual([
      { docId: 'a', score: 0.99 },
      { docId: 'a', score: 0.98 },
      { docId: 'b', score: 0.96 },
    ]);
  });

  it('returns keyword evidence rather than the document opening', () => {
    const text = `${'intro '.repeat(200)}rate limiting caps requests at 100 per minute. ${'tail '.repeat(200)}`;
    const evidence = keywordEvidence(text, ['rate', 'limit'], 160);
    expect(evidence).toContain('rate limiting');
    expect(evidence).not.toBe(text.slice(0, 160));
  });

  it('labels evidence passages and requires grounded inline citations', () => {
    const prompt = buildPrompt('What is the rate limit?', [{
      docId: 'rate-limits',
      docTitle: 'Rate Limits',
      chunkIndex: 2,
      text: 'Requests are capped at 100 per minute.',
      score: 0.91,
    }]);

    expect(prompt).toContain('[Source 1: "Rate Limits", passage 3]');
    expect(prompt).toContain('Every factual claim must be supported');
    expect(prompt).toContain('inline as [Source N]');
  });
});
