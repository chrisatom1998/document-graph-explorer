import { describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { useAnnotationStore } from '../store/annotationStore';
import { useGraphStore } from '../store/graphStore';
import { textStore, type ChunkData } from '../store/runtimeStores';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('default embedder is not used in unit tests')),
}));

import {
  lexicalRelevance,
  retrieveCorpus,
  retrievalTerms,
  type RetrievalDependencies,
} from './retrieval';

function node(id: string, title: string): DocNode {
  return {
    id,
    title,
    kind: 'document',
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function dependencies(
  nodes: DocNode[],
  chunks: ReadonlyMap<string, ChunkData>,
  embedQuery: RetrievalDependencies['embedQuery'],
  texts: ReadonlyMap<string, string> = new Map(),
  docVectors: ReadonlyMap<string, Float32Array> = new Map(),
): RetrievalDependencies {
  return { nodes, chunks, texts, docVectors, embedQuery };
}

describe('shared hybrid retrieval', () => {
  it('removes question stop words while preserving technical identifiers', () => {
    expect(retrievalTerms('What is the API rate-limit for SOC2?')).toEqual([
      'api', 'rate-limit', 'soc2',
    ]);
  });

  it('scores exact lexical evidence and rejects weak multi-term overlap', () => {
    expect(lexicalRelevance('API rate limit', 'The API rate limit is 100/min.').score).toBeGreaterThan(1);
    expect(lexicalRelevance('API rate limit', 'This document only mentions the API.').score).toBe(0);
  });

  it('matches non-Latin titles and phrases and stopword-only titles', () => {
    expect(retrievalTerms('東京 Москва')).toEqual(['東京', 'москва']);
    expect(lexicalRelevance('東京', '東京にある会社').score).toBeGreaterThan(0);
    expect(lexicalRelevance('Москва', '', 'Москва').titleMatch).toBe(true);
    expect(lexicalRelevance('It', '', 'It').titleMatch).toBe(true);
    expect(lexicalRelevance(' ', 'body', 'title').score).toBe(0);
  });

  it('retrieves title-only imports without claiming a source passage', async () => {
    const result = await retrieveCorpus('Architecture', { semantic: false }, dependencies(
      [node('architecture', 'Architecture Overview')],
      new Map(),
      vi.fn(),
    ));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ docId: 'architecture', matchKind: 'title', text: 'Architecture Overview' });
    expect(result[0].passageIndex).toBeUndefined();
  });

  it('applies eligibility before the lexical result limit', async () => {
    const nodes = Array.from({ length: 13 }, (_, i) => node(String(i).padStart(2, '0'), 'Architecture'));
    const result = await retrieveCorpus('Architecture', {
      limit: 12,
      semantic: false,
      eligibleDocIds: new Set(['12']),
    }, dependencies(nodes, new Map(), vi.fn(), new Map(nodes.map((n) => [n.id, 'Architecture']))));
    expect(result.map((hit) => hit.docId)).toEqual(['12']);
  });

  it('restricts semantic chunks and document vectors to eligible document nodes', async () => {
    const nodes = ['blocked-chunk', 'blocked-vector', 'allowed-chunk', 'allowed-vector'].map((id) => node(id, id));
    const result = await retrieveCorpus('unseen query', {
      limit: 2,
      eligibleDocIds: new Set(['allowed-chunk', 'allowed-vector', 'orphan']),
    }, dependencies(
      nodes,
      new Map([
        ['blocked-chunk', { texts: ['excluded'], vectors: new Float32Array([1, 0]), dims: 2 }],
        ['allowed-chunk', { texts: ['included'], vectors: new Float32Array([0.8, 0.6]), dims: 2 }],
        ['orphan', { texts: ['orphan'], vectors: new Float32Array([1, 0]), dims: 2 }],
      ]),
      async () => new Float32Array([1, 0]),
      new Map(),
      new Map([
        ['blocked-vector', new Float32Array([1, 0])],
        ['allowed-vector', new Float32Array([0.6, 0.8])],
      ]),
    ));
    expect(result.map((hit) => hit.docId)).toEqual(['allowed-chunk', 'allowed-vector']);
  });

  it('does not start embeddings when no documents are eligible', async () => {
    const embedQuery = vi.fn();
    const result = await retrieveCorpus('architecture', { eligibleDocIds: new Set() }, dependencies(
      [node('architecture', 'Architecture')], new Map(), embedQuery,
    ));
    expect(result).toEqual([]);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('rewards agreement between lexical and semantic evidence', async () => {
    const chunks = new Map<string, ChunkData>([
      ['semantic-only', { texts: ['unrelated wording'], vectors: new Float32Array([1, 0]), dims: 2 }],
      ['both', { texts: ['API rate limits cap traffic'], vectors: new Float32Array([0.8, 0.6]), dims: 2 }],
    ]);
    const result = await retrieveCorpus('API rate limits', { minSemanticScore: 0, limit: 2 }, dependencies(
      [node('semantic-only', 'General'), node('both', 'Limits')],
      chunks,
      async () => new Float32Array([1, 0]),
    ));

    expect(result.map((hit) => hit.docId)).toEqual(['both', 'semantic-only']);
    expect(result[0].matchKind).toBe('hybrid');
    expect(result[0].semanticRank).toBe(2);
    expect(result[0].lexicalRank).toBe(1);
  });

  it('uses stable candidate ids to break equal-score ties', async () => {
    const chunks = new Map<string, ChunkData>([
      ['b', { texts: ['alpha'], vectors: null, dims: 2 }],
      ['a', { texts: ['alpha'], vectors: null, dims: 2 }],
    ]);
    const result = await retrieveCorpus('alpha', { limit: 2 }, dependencies(
      [node('b', 'B'), node('a', 'A')],
      chunks,
      async () => { throw new Error('offline'); },
    ));
    expect(result.map((hit) => hit.docId)).toEqual(['a', 'b']);
  });

  it('caps passages from one document after fusion', async () => {
    const chunks = new Map<string, ChunkData>([
      ['a', {
        texts: ['alpha one', 'alpha two', 'alpha three'],
        vectors: null,
        dims: 2,
      }],
      ['b', { texts: ['alpha four'], vectors: null, dims: 2 }],
    ]);
    const result = await retrieveCorpus('alpha', { limit: 3, perDocument: 2 }, dependencies(
      [node('a', 'A'), node('b', 'B')],
      chunks,
      async () => { throw new Error('offline'); },
    ));
    expect(result.filter((hit) => hit.docId === 'a')).toHaveLength(2);
    expect(result.some((hit) => hit.docId === 'b')).toBe(true);
  });

  it('skips only dimension-mismatched vectors and still ranks valid documents', async () => {
    const chunks = new Map<string, ChunkData>([
      ['bad', { texts: ['mismatch'], vectors: new Float32Array([1, 0, 0]), dims: 3 }],
      ['good', { texts: ['valid'], vectors: new Float32Array([1, 0]), dims: 2 }],
    ]);
    const result = await retrieveCorpus('unseen query', { minSemanticScore: 0.2 }, dependencies(
      [node('bad', 'Bad'), node('good', 'Good')],
      chunks,
      async () => new Float32Array([1, 0]),
    ));
    expect(result.map((hit) => hit.docId)).toEqual(['good']);
  });

  it('degrades to lexical-only results when embedding fails', async () => {
    const result = await retrieveCorpus('disaster recovery', {}, dependencies(
      [node('dr', 'Disaster Recovery')],
      new Map(),
      async () => { throw new Error('model unavailable'); },
      new Map([['dr', 'The disaster recovery procedure is tested quarterly.']]),
    ));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ docId: 'dr', matchKind: 'title' });
    expect(result[0].semanticRank).toBeUndefined();
  });

  it('can return lexical results without starting semantic embedding', async () => {
    const embedQuery = vi.fn(async () => new Float32Array([1, 0]));
    const result = await retrieveCorpus(
      'architecture',
      { semantic: false },
      dependencies(
        [node('architecture', 'Architecture Overview')],
        new Map(),
        embedQuery,
        new Map([['architecture', 'System architecture and topology.']]),
      ),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ docId: 'architecture', matchKind: 'title' });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('searches exported document metadata when source passages are unavailable', async () => {
    const imported = {
      ...node('dr', 'Disaster Recovery Plan'),
      summary: 'The recovery point objective (RPO) is fifteen minutes.',
      topics: ['business continuity'],
    };

    const embedQuery = vi.fn();
    const result = await retrieveCorpus(
      'recovery point objective',
      {},
      dependencies([imported], new Map(), embedQuery),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      docId: 'dr',
      matchKind: 'keyword',
      text: expect.stringContaining('recovery point objective'),
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('returns no results for empty and unsupported no-answer queries', async () => {
    const deps = dependencies(
      [node('a', 'Operations')],
      new Map(),
      async () => new Float32Array([0, 1]),
      new Map([['a', 'capacity planning and on-call rotations']]),
    );
    expect(await retrieveCorpus('   ', {}, deps)).toEqual([]);
    expect(await retrieveCorpus('quantum entanglement', { minSemanticScore: 0.3 }, deps)).toEqual([]);
  });

  it('matches notes and tags when the document body does not', async () => {
    const tagged = node('policy', 'Vendor Policy');
    const result = await retrieveCorpus(
      'legal-hold',
      { semantic: false },
      {
        ...dependencies(
          [tagged],
          new Map(),
          async () => { throw new Error('offline'); },
          new Map([['policy', 'This policy covers procurement and onboarding.']]),
        ),
        annotations: new Map([['policy', { note: 'Keep for counsel', tags: ['legal-hold'] }]]),
      },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      docId: 'policy',
      matchKind: 'keyword',
      text: expect.stringMatching(/legal-hold/i),
    });
    expect(result[0].passageIndex).toBeUndefined();
  });

  it('excludes local search metadata when a caller disables it', async () => {
    const result = await retrieveCorpus(
      'legal-hold',
      { semantic: false, includeSearchMetadata: false },
      {
        ...dependencies(
          [node('policy', 'Vendor Policy')],
          new Map(),
          async () => { throw new Error('offline'); },
          new Map([['policy', 'This policy covers procurement and onboarding.']]),
        ),
        annotations: new Map([['policy', { note: 'Keep for counsel', tags: ['legal-hold'] }]]),
        clusterNameById: new Map([['policy', 'Payments & revenue']]),
      },
    );

    expect(result).toEqual([]);
  });

  it('ignores inherited annotation properties for imported document paths', async () => {
    const previousGraph = useGraphStore.getState();
    const previousAnnotations = useAnnotationStore.getState();
    const hazardous = { ...node('hazard', 'Safety Policy'), path: 'constructor' };

    try {
      textStore.set('hazard', 'This document explains constructor safety.');
      useGraphStore.setState({
        nodes: [hazardous],
        nodeIndex: { hazard: 0 },
        clusterNames: {},
        localClusterNames: {},
      });
      useAnnotationStore.setState({ annotations: {} });

      await expect(retrieveCorpus('safety', { semantic: false })).resolves.toMatchObject([
        { docId: 'hazard' },
      ]);
    } finally {
      textStore.delete('hazard');
      useGraphStore.setState(previousGraph, true);
      useAnnotationStore.setState(previousAnnotations, true);
    }
  });

  it('does not fuse tag evidence onto chunk 0 during semantic upsert', async () => {
    const tagged = node('policy', 'Vendor Policy');
    const result = await retrieveCorpus(
      'legal-hold',
      { minSemanticScore: 0, limit: 2, perDocument: 2 },
      {
        ...dependencies(
          [tagged],
          new Map([['policy', {
            texts: ['This policy covers procurement and onboarding.'],
            vectors: new Float32Array([1, 0]),
            dims: 2,
          }]]),
          async () => new Float32Array([1, 0]),
        ),
        annotations: new Map([['policy', { note: 'Keep for counsel', tags: ['legal-hold'] }]]),
      },
    );
    expect(result.some((hit) => hit.docId === 'policy')).toBe(true);
    expect(result.some((hit) => hit.passageIndex === 0 && /legal-hold/i.test(hit.text))).toBe(false);
    const tagHit = result.find((hit) => /legal-hold/i.test(hit.text));
    expect(tagHit?.passageIndex).toBeUndefined();
  });

  it('does not treat Cluster/Tags label prefixes as query terms', async () => {
    const tagged = node('policy', 'Vendor Policy');
    const deps = {
      ...dependencies(
        [tagged],
        new Map(),
        async () => { throw new Error('offline'); },
        new Map([['policy', 'This policy covers procurement and onboarding.']]),
      ),
      annotations: new Map([['policy', { note: 'Keep for counsel', tags: ['legal-hold'] }]]),
      clusterNameById: new Map([['policy', 'Payments & revenue']]),
    };
    expect(await retrieveCorpus('cluster', { semantic: false }, deps)).toEqual([]);
    expect(await retrieveCorpus('tags', { semantic: false }, deps)).toEqual([]);
    expect(await retrieveCorpus('tag', { semantic: false }, deps)).toEqual([]);
    expect((await retrieveCorpus('legal-hold', { semantic: false }, deps))[0]?.docId).toBe('policy');
    expect((await retrieveCorpus('payments', { semantic: false }, deps))[0]?.docId).toBe('policy');
  });

  it('matches resolved cluster names', async () => {
    const result = await retrieveCorpus(
      'payments',
      { semantic: false },
      {
        ...dependencies(
          [node('invoice', 'Q3 Invoice Notes')],
          new Map(),
          async () => { throw new Error('offline'); },
          new Map([['invoice', 'Line items and purchase orders for September.']]),
        ),
        clusterNameById: new Map([['invoice', 'Payments & revenue']]),
      },
    );
    expect(result).toHaveLength(1);
    expect(result[0].docId).toBe('invoice');
    expect(result[0].text).toMatch(/Payments & revenue/);
  });
});
