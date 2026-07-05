/**
 * Export -> (JSON file) -> import-sanitize round trip.
 *
 * `toGraphExport` (exportImport.ts) builds the file a user downloads;
 * `sanitizeGraphExport` (validateImport.ts) is what untrusted re-imports of
 * that same file are run through. A real export must survive the sanitizer
 * byte-for-byte in the fields that matter — if it didn't, every re-import of
 * your own export would silently lose data. Malformed data (e.g. a field an
 * older/foreign export or a hand-edited file got wrong) must degrade per the
 * sanitizer's documented rule rather than being rejected outright.
 *
 * exportImport.ts imports pipeline/coordinator (for resetCorpus), whose
 * transitive graph includes pdfjs-dist — that needs DOM globals (DOMMatrix)
 * absent in the node test environment. Mock the coordinator import the same
 * way ragChat.airgap.test.ts does, since this suite never calls resetCorpus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline/coordinator', () => ({ resetCorpus: vi.fn() }));

import { toGraphExport, f32ToBase64 } from './exportImport';
import { sanitizeGraphExport } from './validateImport';
import { useGraphStore } from '../store/graphStore';
import { docVectorStore } from '../store/runtimeStores';
import { EMBED_DIMS } from '../config';
import type { DocNode, Edge } from '../model/types';

function docNode(id: string, extra: Partial<DocNode> = {}): DocNode {
  return {
    id,
    kind: 'document',
    title: `Doc ${id}`,
    fileType: 'md',
    topics: ['alpha'],
    entities: ['Acme Corp'],
    keywords: ['alpha', 'beta'],
    wordCount: 120,
    cluster: 0,
    degree: 1,
    status: 'ok',
    ...extra,
  };
}

const edge: Edge = {
  id: 'a->b:semantic',
  source: 'a',
  target: 'b',
  kind: 'semantic',
  weight: 0.82,
  evidence: ['shared vocabulary'],
};

describe('export -> import round trip', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    docVectorStore.clear();
  });

  it('a real export survives the sanitizer unchanged (nodes, edges, kind allow-list)', () => {
    useGraphStore.setState({
      nodes: [docNode('a'), docNode('b', { cluster: 1, fileType: 'pdf' })],
      edges: [edge],
      clusterNames: { 0: 'Alpha docs', 1: 'Beta docs' },
    });

    const built = toGraphExport(false);
    // Simulate the real file round trip (download -> re-upload is JSON text).
    const reparsed: unknown = JSON.parse(JSON.stringify(built));
    const sanitized = sanitizeGraphExport(reparsed);

    expect(sanitized.nodes).toEqual(built.nodes);
    expect(sanitized.edges).toEqual(built.edges);
    expect(sanitized.clusterNames).toEqual(built.clusterNames);
    // The edge's kind is a valid member of the sanitizer's allow-list, so it
    // passes through as-is rather than being downgraded.
    expect(sanitized.edges[0].kind).toBe('semantic');
  });

  it('carries embeddings through when includeEmbeddings is requested', () => {
    useGraphStore.setState({
      nodes: [docNode('a'), docNode('b')],
      edges: [edge],
      clusterNames: {},
    });
    const vec = new Float32Array(EMBED_DIMS).fill(0.5);
    docVectorStore.set('a', vec);

    const built = toGraphExport(true);
    expect(built.embeddings?.a).toBe(f32ToBase64(vec));

    const reparsed: unknown = JSON.parse(JSON.stringify(built));
    const sanitized = sanitizeGraphExport(reparsed);
    expect(sanitized.embeddings).toEqual({ a: f32ToBase64(vec) });
  });

  it('downgrades an unrecognized edge kind to "reference" instead of rejecting the file', () => {
    useGraphStore.setState({
      nodes: [docNode('a'), docNode('b')],
      edges: [edge],
      clusterNames: {},
    });
    const built = toGraphExport(false);
    const reparsed = JSON.parse(JSON.stringify(built)) as Record<string, unknown>;
    // Simulate a hand-edited / foreign-tool file: an edge kind outside the
    // sanitizer's allow-list ('reference' | 'semantic' | 'keyword' | 'entity'
    // | 'topic' — see EDGE_KINDS in validateImport.ts).
    (reparsed.edges as Record<string, unknown>[])[0].kind = 'exploit';

    const sanitized = sanitizeGraphExport(reparsed);
    expect(sanitized.edges).toHaveLength(1);
    expect(sanitized.edges[0].kind).toBe('reference'); // the sanitizer's documented default
    // Nothing else about the edge is disturbed by the downgrade.
    expect(sanitized.edges[0].source).toBe('a');
    expect(sanitized.edges[0].target).toBe('b');
    expect(sanitized.edges[0].weight).toBe(edge.weight);
  });
});
