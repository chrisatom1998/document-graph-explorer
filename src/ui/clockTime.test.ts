import { describe, expect, it } from 'vitest';
import { clockTime } from './clockTime';
describe('clockTime', () => {
  it('shows tenths below one second and minutes:seconds otherwise', () => {
    expect(clockTime(.43)).toBe('0.4 s');
    expect(clockTime(0, .43)).toBe('0.0 s');
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(1)).toBe('0:01');
    expect(clockTime(75.9)).toBe('1:15');
  });
});
