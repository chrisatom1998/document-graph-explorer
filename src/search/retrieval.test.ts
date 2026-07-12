import { describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import type { ChunkData } from '../store/runtimeStores';

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
});
