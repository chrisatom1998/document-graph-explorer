import { describe, expect, it } from 'vitest';
import { GENERATED_DEMO_DOCUMENT_COUNT, generatedDemoText } from '../demo/generatedDocuments';
import { extractPhraseTf } from './phrases';
import { computeIdf, topKeywords } from './tfidf';
import { termFreq, tokenize } from './tokenize';
import { groupTopics, selectFallbackTopics } from './topics';

describe('generated demo topic quality', () => {
  it('retains subject hubs without ticket prefixes or artificial byline phrases', () => {
    const docs = Array.from({ length: GENERATED_DEMO_DOCUMENT_COUNT }, (_, i) => {
      const text = generatedDemoText(i + 1);
      const { tf, total } = termFreq(tokenize(text));
      return {
        id: String(i),
        title: text.split('\n').find((line) => line.trim())!.replace(/^#+\s*/, ''),
        tf: { ...tf, ...extractPhraseTf(text) },
        total,
      };
    });
    const idf = computeIdf(docs);
    const topics = docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      topicsSource: 'tfidf',
      topics: selectFallbackTopics(topKeywords(doc.tf, doc.total, idf, 15), doc.title),
    }));
    const hubs = groupTopics(topics, { minDocs: 2, maxDocFraction: 0.33 });
    const keys = hubs.map((hub) => hub.key);
    expect(keys).toContain('data platform');
    expect(keys).toContain('platform reliability');
    expect(keys).toContain('api governance');
    expect(keys).not.toContain('dat');
    expect(keys).not.toContain('pla');
    expect(keys.some((key) => key.startsWith('detail '))).toBe(false);
    expect(hubs.length).toBeLessThan(GENERATED_DEMO_DOCUMENT_COUNT);
  });
});
