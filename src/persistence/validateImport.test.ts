import { describe, expect, it } from 'vitest';
import { MAX_NODES } from '../config';
import {
  MAX_EMBEDDING_B64_CHARS,
  MAX_IMPORT_EDGES,
  sanitizeGraphExport,
} from './validateImport';

function validNode(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'document',
    title: `Doc ${id}`,
    fileType: 'md',
    topics: ['a'],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 1,
    status: 'ok',
    ...extra,
  };
}

function validExport(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    generator: 'knowledge-nebula',
    includeEmbeddings: false,
    nodes: [validNode('a'), validNode('b')],
    edges: [
      { id: 'a->b:semantic', source: 'a', target: 'b', kind: 'semantic', weight: 0.7, evidence: ['sim'] },
    ],
    ...extra,
  };
}

describe('sanitizeGraphExport — structural rejection', () => {
  it('rejects non-objects', () => {
    expect(() => sanitizeGraphExport(null)).toThrow(/JSON object/);
    expect(() => sanitizeGraphExport([1, 2])).toThrow(/JSON object/);
    expect(() => sanitizeGraphExport('hi')).toThrow(/JSON object/);
  });

  it('rejects wrong version and missing arrays', () => {
    expect(() => sanitizeGraphExport(validExport({ version: 2 }))).toThrow(/version/);
    expect(() => sanitizeGraphExport(validExport({ nodes: 'nope' }))).toThrow(/malformed/);
  });

  it('rejects exports above the node capacity', () => {
    const nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => validNode(String(i)));
    expect(() => sanitizeGraphExport(validExport({ nodes }))).toThrow(/maximum/);
  });

  it('rejects exports with no valid nodes', () => {
    expect(() =>
      sanitizeGraphExport(validExport({ nodes: [{ id: 42 }, { title: 'no id' }, null] })),
    ).toThrow(/no valid nodes/);
  });
});

describe('sanitizeGraphExport — node sanitization', () => {
  it('accepts a well-formed export unchanged in the fields that matter', () => {
    const out = sanitizeGraphExport(validExport());
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0]).toMatchObject({ id: 'a', title: 'Doc a', cluster: 0, kind: 'document' });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].weight).toBe(0.7);
  });

  it('coerces non-string titles/summaries instead of letting them reach React', () => {
    const out = sanitizeGraphExport(
      validExport({
        nodes: [validNode('abcdef123456', { title: { evil: true }, summary: ['x'] })],
        edges: [],
      }),
    );
    expect(typeof out.nodes[0].title).toBe('string');
    expect(out.nodes[0].title).not.toBe('');
    expect(out.nodes[0].summary).toBeUndefined();
  });

  it('defaults non-finite cluster and negative counts', () => {
    const out = sanitizeGraphExport(
      validExport({
        nodes: [validNode('a', { cluster: NaN, wordCount: -5, degree: 'x' })],
        edges: [],
      }),
    );
    expect(out.nodes[0].cluster).toBe(-1);
    expect(out.nodes[0].wordCount).toBe(0);
    expect(out.nodes[0].degree).toBe(0);
  });

  it('drops duplicate node ids and filters non-string list items', () => {
    const out = sanitizeGraphExport(
      validExport({
        nodes: [validNode('a', { topics: ['ok', 7, null, 'also ok'] }), validNode('a')],
        edges: [],
      }),
    );
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].topics).toEqual(['ok', 'also ok']);
  });

  it('preserves Office file types during export/import sanitization', () => {
    const out = sanitizeGraphExport(
      validExport({
        nodes: [
          validNode('a', { fileType: 'docx' }),
          validNode('b', { fileType: 'pptx' }),
          validNode('c', { fileType: 'xlsx' }),
        ],
        edges: [],
      }),
    );
    expect(out.nodes.map((n) => n.fileType)).toEqual(['docx', 'pptx', 'xlsx']);
  });
});

describe('sanitizeGraphExport — edge sanitization', () => {
  it('drops edges whose endpoints are missing (layout worker crash vector)', () => {
    const out = sanitizeGraphExport(
      validExport({
        edges: [
          { source: 'a', target: 'ghost', kind: 'semantic', weight: 0.5, evidence: [] },
          { source: 'a', target: 'b', kind: 'semantic', weight: 0.5, evidence: [] },
          { source: 'a', target: 'a', kind: 'semantic', weight: 0.5, evidence: [] },
        ],
      }),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].target).toBe('b');
  });

  it('clamps weights and defaults invalid kinds', () => {
    const out = sanitizeGraphExport(
      validExport({
        edges: [
          { source: 'a', target: 'b', kind: 'exploit', weight: 99, evidence: [] },
        ],
      }),
    );
    expect(out.edges[0].weight).toBe(1);
    expect(out.edges[0].kind).toBe('reference');
  });

  it('defaults non-finite weights to 0.5 and caps edge count', () => {
    const edges = Array.from({ length: MAX_IMPORT_EDGES + 10 }, (_, i) => ({
      id: `e${i}`,
      source: 'a',
      target: 'b',
      kind: 'semantic',
      weight: NaN,
      evidence: [],
    }));
    const out = sanitizeGraphExport(validExport({ edges }));
    expect(out.edges.length).toBeLessThanOrEqual(MAX_IMPORT_EDGES);
    expect(out.edges[0].weight).toBe(0.5);
  });
});

describe('sanitizeGraphExport — clusterNames and embeddings', () => {
  it('keeps only numeric-keyed string cluster names', () => {
    const out = sanitizeGraphExport(
      validExport({
        clusterNames: { 0: 'Auth', 1: { nested: true }, abc: 'nope', 2: '  ' },
      }),
    );
    expect(out.clusterNames).toEqual({ 0: 'Auth' });
  });

  it('drops embeddings for unknown nodes, non-strings, and oversized blobs', () => {
    const out = sanitizeGraphExport(
      validExport({
        embeddings: {
          a: 'AAAA',
          ghost: 'AAAA',
          b: 'x'.repeat(MAX_EMBEDDING_B64_CHARS + 1),
        },
      }),
    );
    expect(out.embeddings).toEqual({ a: 'AAAA' });
  });

  it('tolerates malformed clusterNames/embeddings containers', () => {
    const out = sanitizeGraphExport(validExport({ clusterNames: [1, 2], embeddings: 'nope' }));
    expect(out.clusterNames).toEqual({});
    expect(out.embeddings).toBeUndefined();
  });
});
