import { describe, expect, it } from 'vitest';
import { prepareDocumentContext } from './documentContext';

const paragraph = (label: string) => `${label} ${'detail '.repeat(1_500)}`;

describe('prepareDocumentContext', () => {
  it('leaves a document below the budget intact', () => {
    expect(prepareDocumentContext('Short document.', 'summarize', undefined, 100)).toEqual({
      text: 'Short document.',
      truncated: false,
    });
  });

  it('bounds a large summary while retaining distributed sections in order', () => {
    const input = [paragraph('Opening.'), paragraph('Middle.'), paragraph('Conclusion.')].join('\n\n');
    const result = prepareDocumentContext(input, 'summarize', undefined, 1_000);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1_000);
    expect(result.text).toContain('Opening.');
  });

  it('prefers question-relevant evidence for a large document', () => {
    const input = [paragraph('General status.'), paragraph('Rate limiting allows 100 requests per minute.'), paragraph('Appendix.')].join('\n\n');
    const result = prepareDocumentContext(input, 'ask', 'What is the rate limit?', 1_000);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('Rate limiting');
    expect(result.text.length).toBeLessThanOrEqual(1_000);
  });
});
