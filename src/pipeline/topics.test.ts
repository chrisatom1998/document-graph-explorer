import { describe, expect, it } from 'vitest';
import { canonicalizeTopic, groupTopics } from './topics';

describe('canonicalizeTopic', () => {
  it('folds case and whitespace', () => {
    expect(canonicalizeTopic('Index Mappings')).toBe('index mappings');
    expect(canonicalizeTopic('  index   mappings ')).toBe('index mappings');
  });

  it('collapses separators to spaces', () => {
    expect(canonicalizeTopic('index-mappings')).toBe('index mappings');
    expect(canonicalizeTopic('index_mappings')).toBe('index mappings');
    expect(canonicalizeTopic('CI/CD')).toBe('ci cd');
  });

  it('preserves intra-token symbols so tech names stay distinct', () => {
    expect(canonicalizeTopic('C++')).toBe('c++');
    expect(canonicalizeTopic('.NET')).toBe('.net');
    expect(canonicalizeTopic('C++')).not.toBe(canonicalizeTopic('C'));
  });

  it('returns empty for blank input', () => {
    expect(canonicalizeTopic('   ')).toBe('');
    expect(canonicalizeTopic('---')).toBe('');
  });
});

describe('groupTopics', () => {
  const opts = { minDocs: 2, maxDocFraction: 0.9 };

  it('merges case/separator variants into one hub, union of docs', () => {
    const groups = groupTopics(
      [
        { id: 'a', topics: ['Kubernetes'] },
        { id: 'b', topics: ['kubernetes'] },
        { id: 'c', topics: ['other'] },
      ],
      opts,
    );
    const k = groups.find((g) => g.key === 'kubernetes');
    expect(k).toBeDefined();
    expect(k?.docIds).toEqual(['a', 'b']);
    // 'other' appears once -> below minDocs
    expect(groups.find((g) => g.key === 'other')).toBeUndefined();
  });

  it('picks the most frequent label as the display form', () => {
    const groups = groupTopics(
      [
        { id: 'a', topics: ['kubernetes'] },
        { id: 'b', topics: ['Kubernetes'] },
        { id: 'c', topics: ['Kubernetes'] },
      ],
      opts,
    );
    expect(groups.find((g) => g.key === 'kubernetes')?.label).toBe('Kubernetes');
  });

  it('coalesces a plural into its singular ONLY when the singular exists', () => {
    const merged = groupTopics(
      [
        { id: 'a', topics: ['API'] },
        { id: 'b', topics: ['API'] },
        { id: 'c', topics: ['APIs'] },
      ],
      opts,
    );
    const api = merged.find((g) => g.key === 'api');
    expect(api?.docIds).toEqual(['a', 'b', 'c']);
    expect(merged.find((g) => g.key === 'apis')).toBeUndefined();
  });

  it('does NOT strip a trailing s when the singular is absent (no false merge)', () => {
    const groups = groupTopics(
      [
        { id: 'a', topics: ['kubernetes'] },
        { id: 'b', topics: ['kubernetes'] },
      ],
      opts,
    );
    expect(groups.find((g) => g.key === 'kubernetes')).toBeDefined();
    expect(groups.find((g) => g.key === 'kubernete')).toBeUndefined();
  });

  it('drops topics carried by more than maxDocFraction of the corpus', () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      topics: i < 8 ? ['ubiquitous', 'niche'] : ['niche'],
    }));
    // 'ubiquitous' in 8/10 = 0.8 > 0.33 cap -> dropped; 'niche' in 10/10 also dropped
    const groups = groupTopics(docs, { minDocs: 2, maxDocFraction: 0.33 });
    expect(groups.find((g) => g.key === 'ubiquitous')).toBeUndefined();
  });

  it('keeps a fully-shared topic in a tiny corpus (cap never below minDocs)', () => {
    const groups = groupTopics(
      [
        { id: 'a', topics: ['shared'] },
        { id: 'b', topics: ['shared'] },
      ],
      { minDocs: 2, maxDocFraction: 0.33 },
    );
    expect(groups.find((g) => g.key === 'shared')?.docIds).toEqual(['a', 'b']);
  });

  it('counts a doc once even if it lists case variants of one topic', () => {
    const groups = groupTopics(
      [
        { id: 'a', topics: ['Auth', 'auth'] },
        { id: 'b', topics: ['auth'] },
      ],
      opts,
    );
    expect(groups.find((g) => g.key === 'auth')?.docIds).toEqual(['a', 'b']);
  });
});
