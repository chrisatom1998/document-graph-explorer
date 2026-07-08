import { describe, expect, it } from 'vitest';
import { truncateToBytes } from './bytes';

const byteLen = (s: string) => new TextEncoder().encode(s).byteLength;

describe('truncateToBytes', () => {
  it('returns text unchanged when it fits the budget', () => {
    expect(truncateToBytes('hello', 5)).toBe('hello');
    expect(truncateToBytes('hello', 500)).toBe('hello');
  });

  it('caps ASCII text at exactly the byte budget', () => {
    const out = truncateToBytes('abcdefgh', 3);
    expect(out).toBe('abc');
  });

  it('never exceeds the budget for multibyte text', () => {
    // '€' is 3 bytes in UTF-8, so 10 of them are 30 bytes
    const text = '€'.repeat(10);
    const out = truncateToBytes(text, 10);
    expect(byteLen(out)).toBeLessThanOrEqual(10);
    expect(text.startsWith(out)).toBe(true);
    // budget 10 fits three 3-byte chars, not four
    expect(out).toBe('€€€');
  });

  it('never splits a code point at the cut', () => {
    // budget lands mid-'€': keep only the whole chars that fit
    expect(truncateToBytes('a€b', 3)).toBe('a'); // 'a'(1) + '€'(3) would be 4
    // '𐍈' is a surrogate pair, 4 bytes: budget 5 fits one, not two
    expect(truncateToBytes('𐍈𐍈', 5)).toBe('𐍈');
  });

  it('returns an empty string for a zero or too-small budget', () => {
    expect(truncateToBytes('€', 0)).toBe('');
    expect(truncateToBytes('€', 2)).toBe('');
  });
});
