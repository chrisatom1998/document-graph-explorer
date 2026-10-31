import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

describe('Jamendo archive fetch', () => {
  it('retries ranges with jitter and Retry-After, and skips tracks already stamped on disk', () => {
    execFileSync('python3', ['scripts/holdout-r3/test_fetch_jamendo.py'], { encoding: 'utf8', timeout: 30_000 });
  });
});
