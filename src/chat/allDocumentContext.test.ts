import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { assembleAllDocumentChunks } from './allDocumentContext';

function doc(id: string, title: string, extra: Partial<DocNode> = {}): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
    ...extra,
  } as DocNode;
}

describe('assembleAllDocumentChunks', () => {
  it('includes every document, preferring retrieved passages', () => {
    const documents = [doc('a', 'Alpha'), doc('b', 'Beta'), doc('c', 'Gamma')];
    const texts = new Map([
      ['b', 'Beta body that never retrieved.'],
      ['c', 'Gamma opening text.'],
    ]);
    const chunks = new Map([
      ['c', { texts: ['Gamma chunk 0'], vectors: null, dims: 0 }],
    ]);
    const result = assembleAllDocumentChunks(
      [{ docId: 'a', docTitle: 'Alpha', chunkIndex: 2, text: 'Alpha hit', score: 0.9 }],
      documents,
      texts,
      chunks,
    );

    expect(result.total).toBe(3);
    expect(result.included).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.chunks.map((c) => [c.docId, c.text, c.score])).toEqual([
      ['a', 'Alpha hit', 0.9],
      ['b', 'Beta body that never retrieved.', 0],
      ['c', 'Gamma chunk 0', 0],
    ]);
  });

  it('shrinks excerpts and drops lowest-scoring docs when over budget', () => {
    const documents = [doc('a', 'A'), doc('b', 'B'), doc('c', 'C')];
    const texts = new Map([
      ['a', 'AAAA '.repeat(80)],
      ['b', 'BBBB '.repeat(80)],
      ['c', 'CCCC '.repeat(80)],
    ]);
    const result = assembleAllDocumentChunks(
      [
        { docId: 'a', docTitle: 'A', text: 'AAAA '.repeat(80), score: 0.9 },
        { docId: 'b', docTitle: 'B', text: 'BBBB '.repeat(80), score: 0.5 },
        { docId: 'c', docTitle: 'C', text: 'CCCC '.repeat(80), score: 0.1 },
      ],
      documents,
      texts,
      new Map(),
      500,
      1500,
      200,
    );

    expect(result.charsPerDocument).toBe(200);
    expect(result.included).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.chunks.map((c) => c.docId)).toEqual(['a', 'b']);
    expect(result.chunks.every((c) => c.text.length <= 200)).toBe(true);
  });
});
