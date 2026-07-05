import { describe, it, expect } from 'vitest';
import { formatExtractiveAnswer, type Passage } from './extractiveAnswer';

const p = (docId: string, docTitle: string, text: string, score: number): Passage => ({
  docId, docTitle, text, score,
});

describe('formatExtractiveAnswer', () => {
  it('returns an honest empty message and no sources when nothing matched', () => {
    const r = formatExtractiveAnswer('anything', []);
    expect(r.sources).toEqual([]);
    expect(r.text).toMatch(/couldn.t find/i);
  });

  it('quotes the passage verbatim and cites the source doc', () => {
    const r = formatExtractiveAnswer('rate limits', [
      p('doc1', 'Rate Limiting', 'Requests are capped at 100/min per token.', 0.9),
    ]);
    expect(r.text).toContain('Rate Limiting');
    expect(r.text).toContain('Requests are capped at 100/min per token.');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ docId: 'doc1' });
  });

  it('keeps only the best passage per document', () => {
    const r = formatExtractiveAnswer('q', [
      p('doc1', 'A', 'low score chunk', 0.4),
      p('doc1', 'A', 'high score chunk', 0.8),
      p('doc2', 'B', 'other doc', 0.5),
    ]);
    expect(r.sources.map((s) => s.docId)).toEqual(['doc1', 'doc2']); // best-per-doc, score-sorted
    expect(r.text).toContain('high score chunk');
    expect(r.text).not.toContain('low score chunk');
  });

  it('caps the number of passages at EXTRACT_MAX_PASSAGES (4)', () => {
    const many = Array.from({ length: 7 }, (_, i) => p(`doc${i}`, `T${i}`, `text ${i}`, 1 - i * 0.1));
    const r = formatExtractiveAnswer('q', many);
    expect(r.sources).toHaveLength(4);
  });

  it('truncates a long passage to EXTRACT_PASSAGE_CHARS with an ellipsis', () => {
    const long = 'word '.repeat(400); // 2000 chars
    const r = formatExtractiveAnswer('q', [p('doc1', 'Long', long, 0.9)]);
    // quoted body (after the "> ") is capped near 600 chars and ends with an ellipsis
    expect(r.text).toContain('…');
    expect(r.text.length).toBeLessThan(long.length);
  });
});
