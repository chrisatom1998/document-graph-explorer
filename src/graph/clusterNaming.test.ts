import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { computeLocalClusterNames } from './clusterNaming';

function mkNode(
  id: string,
  cluster: number,
  keywords: string[] = [],
  opts: { topics?: string[]; kind?: DocNode['kind'] } = {},
): DocNode {
  return {
    id,
    kind: opts.kind ?? 'document',
    title: id,
    fileType: 'md',
    topics: opts.topics ?? [],
    entities: [],
    keywords,
    wordCount: 10,
    cluster,
    degree: 0,
    status: 'ok',
  };
}

describe('computeLocalClusterNames', () => {
  it('names clusters from their top two keywords, single-keyword clusters from one', () => {
    const nodes = [
      mkNode('a', 0, ['auth', 'tokens']),
      mkNode('b', 0, ['auth', 'tokens']),
      mkNode('c', 1, ['billing']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBe('Auth & Tokens');
    expect(names[1]).toBe('Billing');
  });

  it('prefers cluster-distinctive keywords over corpus-wide ubiquitous ones', () => {
    // "notes" appears in every doc corpus-wide — despite matching the
    // cluster-specific terms on in-cluster frequency, its distinctiveness
    // weight must keep it out of both names.
    const nodes = [
      mkNode('a1', 0, ['auth', 'tokens', 'notes']),
      mkNode('a2', 0, ['auth', 'tokens', 'notes']),
      mkNode('a3', 0, ['auth', 'tokens', 'notes']),
      mkNode('b1', 1, ['billing', 'invoices', 'notes']),
      mkNode('b2', 1, ['billing', 'invoices', 'notes']),
      mkNode('b3', 1, ['billing', 'invoices', 'notes']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBe('Auth & Tokens');
    expect(names[1]).toBe('Billing & Invoices');
  });

  it('falls back to topics for docs with no keywords', () => {
    const nodes = [
      mkNode('a', 0, [], { topics: ['graph theory', 'topology'] }),
      mkNode('b', 0, [], { topics: ['graph theory', 'topology'] }),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBe('Graph Theory & Topology');
  });

  it('disambiguates colliding names with each cluster\'s next-best keyword', () => {
    // Both clusters share dominant "auth"/"tokens"; the rarer third keyword
    // differs. Base names collide as "Auth & Tokens", so each extends.
    const nodes = [
      mkNode('a1', 0, ['auth', 'tokens', 'sessions']),
      mkNode('a2', 0, ['auth', 'tokens']),
      mkNode('a3', 0, ['auth', 'tokens']),
      mkNode('b1', 1, ['auth', 'tokens', 'billing']),
      mkNode('b2', 1, ['auth', 'tokens']),
      mkNode('b3', 1, ['auth', 'tokens']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBe('Auth & Tokens & Sessions');
    expect(names[1]).toBe('Auth & Tokens & Billing');
  });

  it('drops the later cluster when a collision cannot be disambiguated', () => {
    // Identical single-keyword vocabularies: nothing left to extend with, so
    // only the lower cluster id keeps the label.
    const nodes = [
      mkNode('a', 0, ['auth']),
      mkNode('b', 3, ['auth']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBe('Auth');
    expect(names[3]).toBeUndefined();
  });

  it('omits clusters whose docs have no keywords or topics', () => {
    const nodes = [
      mkNode('a', 0),
      mkNode('b', 1, ['billing']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBeUndefined();
    expect(names[1]).toBe('Billing');
  });

  it('ignores unclustered (-1) docs and topic nodes', () => {
    const nodes = [
      mkNode('a', -1, ['ghost']),
      mkNode('t', 0, ['phantom'], { kind: 'topic' }),
      mkNode('b', 0, ['billing']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[-1]).toBeUndefined();
    expect(names[0]).toBe('Billing');
  });

  it('drops the second keyword instead of truncating past the length cap', () => {
    // "Internationalization & Containerization" is 40 chars — over the cap,
    // so the name falls back to the top keyword alone.
    const nodes = [
      mkNode('a', 0, ['internationalization', 'containerization']),
      mkNode('b', 0, ['internationalization', 'containerization']),
      mkNode('c', 0, ['internationalization']),
    ];
    const names = computeLocalClusterNames(nodes);
    expect(names[0]).toBe('Internationalization');
  });

  it('returns an empty record for an empty graph', () => {
    expect(computeLocalClusterNames([])).toEqual({});
  });
});
