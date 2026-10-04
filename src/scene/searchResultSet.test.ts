import { expect, it } from 'vitest';
import { createSearchResultSetCache } from './searchResultSet';

it('reuses membership across frames and replaces stale IDs when results change', () => {
  const lookup = createSearchResultSetCache();
  const results = ['alpha', 'beta'];
  const first = lookup(results);
  expect(first?.has('alpha')).toBe(true);
  expect(lookup(results)).toBe(first);
  const next = lookup(['gamma']);
  expect(next).not.toBe(first);
  expect(next?.has('alpha')).toBe(false);
  expect(next?.has('gamma')).toBe(true);
});

it('preserves empty results as an active empty set and clears stale results on reset', () => {
  const lookup = createSearchResultSetCache();
  expect(lookup(null)).toBeNull();
  const results: string[] = [];
  const empty = lookup(results);
  expect(empty).toBeInstanceOf(Set);
  expect(empty?.size).toBe(0);
  expect(lookup(results)).toBe(empty);
  expect(lookup(null)).toBeNull();
  expect(lookup(results)).not.toBe(empty);
});
