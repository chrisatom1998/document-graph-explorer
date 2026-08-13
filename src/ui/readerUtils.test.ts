import { describe, expect, it } from 'vitest';
import { MAX_RENDER_CHARS, FALLBACK_EXCERPT_CHARS, getFallbackExcerpt } from './readerUtils';

describe('readerUtils', () => {
  it('exports expected render and excerpt threshold constants', () => {
    expect(MAX_RENDER_CHARS).toBe(8_000_000);
    expect(FALLBACK_EXCERPT_CHARS).toBe(200_000);
  });

  it('returns text as-is when length is within fallback cap', () => {
    const text = 'Hello world, short document.';
    expect(getFallbackExcerpt(text)).toBe(text);
  });

  it('returns empty string unchanged', () => {
    expect(getFallbackExcerpt('')).toBe('');
  });

  it('truncates text exceeding fallback cap and appends indicator', () => {
    const overflowLength = FALLBACK_EXCERPT_CHARS + 50;
    const input = 'a'.repeat(overflowLength);
    const result = getFallbackExcerpt(input);

    expect(result.startsWith('a'.repeat(FALLBACK_EXCERPT_CHARS))).toBe(true);
    expect(result).toContain('\n\n… (truncated)');
    expect(result.length).toBe(FALLBACK_EXCERPT_CHARS + '\n\n… (truncated)'.length);
  });

  it('respects a custom truncation cap if specified', () => {
    const input = '1234567890';
    const result = getFallbackExcerpt(input, 5);

    expect(result).toBe('12345\n\n… (truncated)');
  });
});
