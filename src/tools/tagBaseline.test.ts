import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

describe('Tag baseline set and summary', () => {
  it('builds a capped, deterministic, reserved-free set and computes micro and macro scores', () => {
    execFileSync('python3', ['scripts/tag-baseline/test_tag_baseline.py'], { encoding: 'utf8', timeout: 30_000 });
  });
});
