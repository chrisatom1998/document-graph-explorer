import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('./db', () => ({ getDb: getDbMock }));

import { saveDocsToCache } from './cache';
import type { DocumentRecord } from './db';

function mkNode(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function docInput(id: string, text: string, chunkTexts: string[] = []) {
  return {
    node: mkNode(id),
    text,
    chunkTexts,
    chunkVectors: null,
    docVector: null,
    mdLinkTargets: [],
    docLinks: [],
  };
}

const documents = new Map<string, DocumentRecord>();

function fakeDb() {
  return {
    transaction: () => ({
      objectStore: (name: string) => ({
        get: async (key: string) => (name === 'documents' ? documents.get(key) : undefined),
        put: async (rec: DocumentRecord) => {
          if (name === 'documents') documents.set(rec.hash, rec);
          return rec.hash;
        },
      }),
      done: Promise.resolve(),
    }),
  };
}

beforeEach(() => {
  documents.clear();
  getDbMock.mockResolvedValue(fakeDb());
});

describe('saveDocsToCache empty-text overwrite guard', () => {
  it('keeps the persisted text when a write carries empty text over a non-empty record', async () => {
    documents.set('a', {
      hash: 'a',
      node: mkNode('a'),
      text: 'original body',
      chunkTexts: ['original body'],
    });

    // An evicted doc reads back as '' from textStore; the rest of its
    // payload (node, resident chunk texts) must still land.
    await expect(saveDocsToCache([docInput('a', '', ['chunk one'])])).resolves.toBe(true);

    const rec = documents.get('a');
    expect(rec?.text).toBe('original body');
    expect(rec?.chunkTexts).toEqual(['chunk one']);
  });

  it('still persists a genuinely empty first write', async () => {
    await expect(saveDocsToCache([docInput('empty', '')])).resolves.toBe(true);
    expect(documents.get('empty')?.text).toBe('');
  });

  it('lets non-empty text overwrite normally', async () => {
    documents.set('a', {
      hash: 'a',
      node: mkNode('a'),
      text: 'old body',
      chunkTexts: ['old body'],
    });

    await expect(saveDocsToCache([docInput('a', 'new body', ['new body'])])).resolves.toBe(true);
    expect(documents.get('a')?.text).toBe('new body');
  });
});
