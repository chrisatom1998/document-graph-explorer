import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

describe('Jamendo archive fetch', () => {
  it('retries with jitter, honors Retry-After, and resumes a dropped body with Range', () => {
    execFileSync('python3', ['scripts/holdout-r3/test_fetch_jamendo.py'], { encoding: 'utf8', timeout: 30_000 });
  });
});
