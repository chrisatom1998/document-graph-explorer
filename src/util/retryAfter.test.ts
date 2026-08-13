import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfter } from './retryAfter';

describe('parseRetryAfter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a delay-seconds value into milliseconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('caps delays at 60 seconds', () => {
    expect(parseRetryAfter('120')).toBe(60_000);
  });

  it('parses an HTTP-date relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    expect(parseRetryAfter('Wed, 01 Jan 2020 00:00:15 GMT')).toBe(15_000);
  });

  it('returns null for malformed values', () => {
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('not-a-date')).toBeNull();
  });
});
