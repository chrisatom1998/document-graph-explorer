import { describe, expect, it } from 'vitest';
import type { AggRequest, LexicalDocInput } from '../model/types';
import {
  dispatchAggregatorRequest,
  handleCluster,
  handleLexical,
  handleSemantic,
} from './aggregatorHandlers';

const LEX_PARAMS: Extract<AggRequest, { type: 'lexical' }>['params'] = {
  tfidfTopN: 15,
  minShared: 2,
  edgesPerDoc: 5,
  minTitleLen: 5,
  entityMinShared: 2,
  entityEdgesPerDoc: 4,
};

function lexicalDoc(partial: Partial<LexicalDocInput> & { id: string }): LexicalDocInput {
  return {
    title: partial.id,
    fileName: `${partial.id}.md`,
    tf: {},
    phraseTf: {},
    totalTerms: 0,
    textLower: '',
    mdLinkTargets: [],
    entities: [],
    ...partial,
  };
}

function unitVector(dims: number, tilt = 0): Float32Array {
  const v = new Float32Array(dims);
  v[0] = 1;
  v[1] = tilt;
  let norm = 0;
  for (let i = 0; i < dims; i += 1) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i += 1) v[i] /= norm;
  return v;
}

describe('handleLexical', () => {
  it('returns lexical:done with keywords, edges, and boilerplate fields', () => {
    const req: Extract<AggRequest, { type: 'lexical' }> = {
      requestId: 7,
      type: 'lexical',
      docs: [
        lexicalDoc({
          id: 'deploy',
          title: 'Deploy Guide',
          fileName: 'deploy-guide.md',
          tf: { kafka: 4, consumer: 3, deploy: 2 },
          totalTerms: 9,
          textLower: 'how we ship. see the incident runbook when things break.',
          mdLinkTargets: ['incident-runbook.md'],
          entities: ['Kafka'],
        }),
        lexicalDoc({
          id: 'runbook',
          title: 'Incident Runbook',
          fileName: 'incident-runbook.md',
          tf: { kafka: 3, consumer: 3, retry: 2 },
          totalTerms: 8,
          textLower: 'incident runbook for kafka consumer lag.',
          entities: ['Kafka'],
        }),
      ],
      params: LEX_PARAMS,
    };

    const done = handleLexical(req);
    expect(done).toMatchObject({ requestId: 7, type: 'lexical:done' });
    expect(done.keywordsByDoc.deploy?.length).toBeGreaterThan(0);
    expect(done.keywordsByDoc.runbook?.length).toBeGreaterThan(0);
    expect(Array.isArray(done.edges)).toBe(true);
    expect(done.edges.some((e) => e.kind === 'reference')).toBe(true);
    expect(Array.isArray(done.boilerplateLines)).toBe(true);
  });

  it('returns empty keywords and edges for an empty corpus', () => {
    const done = handleLexical({
      requestId: 1,
      type: 'lexical',
      docs: [],
      params: LEX_PARAMS,
    });
    expect(done.type).toBe('lexical:done');
    expect(done.keywordsByDoc).toEqual({});
    expect(done.edges).toEqual([]);
    expect(done.boilerplateLines).toEqual([]);
  });
});

describe('handleSemantic', () => {
  it('returns semantic:done plus progress for a tiny similar pair', async () => {
    const dims = 8;
    const a = unitVector(dims, 0);
    const b = unitVector(dims, 0.05);
    const vectors = new Float32Array(dims * 2);
    vectors.set(a, 0);
    vectors.set(b, dims);

    const progress: Extract<import('../model/types').AggResponse, { type: 'semantic:progress' }>[] =
      [];
    const done = await handleSemantic(
      {
        requestId: 3,
        type: 'semantic',
        ids: ['a', 'b'],
        vectors,
        dims,
        existingEdges: [],
        params: { threshold: 0.5, topK: 5, dupThreshold: 0.95 },
      },
      (msg) => progress.push(msg),
    );

    expect(done).toMatchObject({ requestId: 3, type: 'semantic:done' });
    expect(done.edges.length).toBeGreaterThan(0);
    expect(done.edges[0]).toMatchObject({ kind: 'semantic', source: 'a', target: 'b' });
    expect(done.clusters).toEqual(expect.objectContaining({ a: expect.any(Number), b: expect.any(Number) }));
    expect(done.nearest).toHaveLength(2);
    expect(done.top).toHaveLength(2);
    expect(Array.isArray(done.duplicates)).toBe(true);
    for (const msg of progress) {
      expect(msg.type).toBe('semantic:progress');
      expect(msg.requestId).toBe(3);
      expect(msg.total).toBeGreaterThan(0);
    }
  });

  it('returns empty edges and singleton-safe clusters for no ids', async () => {
    const done = await handleSemantic({
      requestId: 4,
      type: 'semantic',
      ids: [],
      vectors: new Float32Array(0),
      dims: 8,
      existingEdges: [],
      params: { threshold: 0.5, topK: 5, dupThreshold: 0.95 },
    });
    expect(done.type).toBe('semantic:done');
    expect(done.edges).toEqual([]);
    expect(done.clusters).toEqual({});
    expect(done.nearest).toEqual([]);
    expect(done.top).toEqual([]);
  });
});

describe('handleCluster', () => {
  it('labels a fixed adjacency with stable community ids', () => {
    const done = handleCluster({
      requestId: 9,
      type: 'cluster',
      ids: ['a', 'b', 'c'],
      edges: [
        { source: 'a', target: 'b', weight: 1 },
        { source: 'b', target: 'a', weight: 1 },
      ],
    });
    expect(done).toMatchObject({ requestId: 9, type: 'cluster:done' });
    expect(Object.keys(done.clusters).sort()).toEqual(['a', 'b', 'c']);
    expect(done.clusters.a).toBe(done.clusters.b);
    expect(done.clusters.c).toBeTypeOf('number');
  });

  it('assigns singleton communities when there are no edges', () => {
    const done = handleCluster({
      requestId: 10,
      type: 'cluster',
      ids: ['solo-a', 'solo-b'],
      edges: [],
    });
    expect(done.clusters['solo-a']).toBe(0);
    expect(done.clusters['solo-b']).toBe(1);
  });
});

describe('dispatchAggregatorRequest', () => {
  it('posts an error response for malformed lexical input', async () => {
    const posted: import('../model/types').AggResponse[] = [];
    await dispatchAggregatorRequest(
      {
        requestId: 99,
        type: 'lexical',
        docs: null as unknown as LexicalDocInput[],
        params: LEX_PARAMS,
      },
      (msg) => posted.push(msg),
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ requestId: 99, type: 'error' });
    expect(posted[0].type === 'error' && posted[0].message.length).toBeGreaterThan(0);
  });
});
