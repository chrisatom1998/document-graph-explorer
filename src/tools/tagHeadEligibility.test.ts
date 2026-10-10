import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

describe('runtime-eligible tag head shipping', () => {
  it('keeps disabled one-shots out of head eligibility, tiers and replacement comparisons', () => {
    execFileSync('python3', ['scripts/dj-effects/test_eligibility.py'], { encoding: 'utf8', timeout: 30_000 });
  });

  it('rescores synthetic artifacts with fail-closed provenance and validation before writes', () => {
    execFileSync('python3', ['scripts/dj-effects/test_rescore.py'], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, OPENBLAS_NUM_THREADS: '1' },
    });
  });
});
