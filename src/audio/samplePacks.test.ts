import { describe, expect, it } from 'vitest';
import { findSamplePacks, publicSourceUrl } from './samplePacks';
import { packRequestBody, parsePackResults } from '../server/djAssistant';

describe('training source discovery', () => {
  it('filters actual curated sources and preserves license evidence', () => {
    const hits = findSamplePacks('synth percussion');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(p => p.licenseUrl.startsWith('https:') && p.checked === '2026-10-02')).toBe(true);
    expect(findSamplePacks('nonexistentfoobar')).toEqual([]);
  });
  it('requires a live web search and distinguishes training purpose', () => {
    expect(packRequestBody('vocals', false)).toMatchObject({ model: 'gpt-6-astra', service_tier: 'ultrafast' });
    expect(packRequestBody('vocals', false).tools).toEqual([{ type: 'web_search' }]);
    expect(packRequestBody('vocals', true).instructions).toContain('generative audio model training');
    expect(packRequestBody('vocals', false).instructions).toContain('non-generative sound classification');
  });
  it('rejects unsourced web recommendations', () => {
    expect(() => parsePackResults({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Invented pack', annotations: [] }] }] })).toThrow();
  });
  it('returns only safe cited source links', () => {
    const result = parsePackResults({ status: 'completed', output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'Found a source.', annotations: [
      { type: 'url_citation', title: 'Publisher', url: 'https://kenney.nl/assets/impact-sounds' },
      { type: 'url_citation', title: 'Bad', url: 'javascript:alert(1)' },
    ] }] }] });
    expect(result.sources).toHaveLength(1);
    expect(publicSourceUrl('http://127.0.0.1/file')).toBe(null);
    expect(publicSourceUrl('https://user:password@example.com')).toBe(null);
  });
});
