import { describe, expect, it } from 'vitest';
import { timeAgo } from './relativeTime';

const NOW = 1_700_000_000_000; // fixed reference so tests are deterministic
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('returns "just now" under one hour', () => {
    expect(timeAgo(NOW, NOW)).toBe('just now');
    expect(timeAgo(NOW - (HOUR - 1), NOW)).toBe('just now');
  });

  it('uses singular at exactly one unit and plural beyond', () => {
    expect(timeAgo(NOW - HOUR, NOW)).toBe('1 hour ago');
    expect(timeAgo(NOW - 2 * HOUR, NOW)).toBe('2 hours ago');
    expect(timeAgo(NOW - DAY, NOW)).toBe('1 day ago');
    expect(timeAgo(NOW - 2 * DAY, NOW)).toBe('2 days ago');
  });

  it('picks the largest fitting unit (week / month / year)', () => {
    expect(timeAgo(NOW - 7 * DAY, NOW)).toBe('1 week ago');
    expect(timeAgo(NOW - 30 * DAY, NOW)).toBe('1 month ago');
    expect(timeAgo(NOW - 365 * DAY, NOW)).toBe('1 year ago');
    expect(timeAgo(NOW - 400 * DAY, NOW)).toBe('1 year ago');
  });

  it('floors within a unit (just under a boundary rounds down)', () => {
    expect(timeAgo(NOW - (2 * DAY - 1), NOW)).toBe('1 day ago');
  });
});
