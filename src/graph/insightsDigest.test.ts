import { describe, expect, it } from 'vitest';
import type { DocNode, DuplicatePair, Edge } from '../model/types';
import {
  formatInsightsDigest,
  isIngestPhase,
  shouldOfferInsightsDigest,
  summarizeInsights,
} from './insightsDigest';

function mkNode(
  id: string,
  opts: Partial<Pick<DocNode, 'kind' | 'cluster' | 'lastModified'>> = {},
): DocNode {
  return {
    id,
    kind: opts.kind ?? 'document',
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: opts.cluster ?? 0,
    degree: 0,
    status: 'ok',
    lastModified: opts.lastModified,
  };
}

function mkEdge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}:semantic`,
    source,
    target,
    kind: 'semantic',
    weight: 0.7,
    evidence: [],
  };
}

describe('summarizeInsights', () => {
  it('counts clusters, orphans, duplicates, and stale docs', () => {
    const now = Date.UTC(2026, 7, 14);
    const nodes = [
      mkNode('a', { cluster: 0 }),
      mkNode('b', { cluster: 0 }),
      mkNode('c', { cluster: 1 }),
      mkNode('orphan', { cluster: 2, lastModified: now - 200 * 86_400_000 }),
      mkNode('topic', { kind: 'topic', cluster: 0 }),
    ];
    const edges = [mkEdge('a', 'b')];
    const pairs: DuplicatePair[] = [{ a: 'a', b: 'b', sim: 0.95 }];

    const digest = summarizeInsights(nodes, edges, pairs, now);
    expect(digest.docCount).toBe(4);
    expect(digest.clusterCount).toBe(3);
    expect(digest.orphanIds).toEqual(['c', 'orphan']);
    expect(digest.duplicateCount).toBe(1);
    expect(digest.duplicateIds).toEqual(['a', 'b']);
    expect(digest.staleIds).toEqual(['orphan']);
    expect(formatInsightsDigest(digest)).toBe('3 clusters · 2 orphans · 1 near-duplicate');
    expect(shouldOfferInsightsDigest(digest)).toBe(true);
  });

  it('hides the card for a single well-connected cluster', () => {
    const nodes = [mkNode('a'), mkNode('b')];
    const digest = summarizeInsights(nodes, [mkEdge('a', 'b')], []);
    expect(digest.clusterCount).toBe(1);
    expect(digest.orphanCount).toBe(0);
    expect(shouldOfferInsightsDigest(digest)).toBe(false);
  });

  it('hides the card when the graph is empty', () => {
    expect(shouldOfferInsightsDigest(summarizeInsights([], [], []))).toBe(false);
  });
});

describe('isIngestPhase', () => {
  it('treats parse/link/embed/cluster as ingest, not restore or enrichment', () => {
    expect(isIngestPhase('parsing')).toBe(true);
    expect(isIngestPhase('connecting')).toBe(true);
    expect(isIngestPhase('ready')).toBe(false);
    expect(isIngestPhase('idle')).toBe(false);
    expect(isIngestPhase('enriching')).toBe(false);
  });
});
