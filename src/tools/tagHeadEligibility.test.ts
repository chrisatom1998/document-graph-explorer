import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

describe('runtime-eligible tag head shipping', () => {
  it('keeps disabled one-shots out of head eligibility, tiers and replacement comparisons', () => {
    execFileSync('python3', ['scripts/dj-effects/test_eligibility.py'], { encoding: 'utf8', timeout: 30_000 });
  });
});
