import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: vi.fn().mockResolvedValue({ annotations: {} }),
  updateCorpusAnnotations: vi.fn().mockResolvedValue(undefined),
}));

import { _resetAnnotationsForTests, useAnnotationStore } from '../store/annotationStore';
import { addTagToDocuments, documentsAlreadyTagged, DUPLICATE_TAG } from './insightActions';

function doc(id: string, path: string): Pick<DocNode, 'id' | 'path' | 'title'> {
  return { id, path, title: path };
}

describe('insightActions', () => {
  beforeEach(() => {
    useAnnotationStore.getState().hydrate('c1', {});
  });

  afterEach(() => {
    _resetAnnotationsForTests();
    useAnnotationStore.getState().hydrate(null as unknown as string, {});
  });

  it('tags each listed document once and reports how many were new', () => {
    const nodes = [doc('a', 'a.md'), doc('b', 'b.md')];
    expect(addTagToDocuments(nodes, ['a', 'b'], DUPLICATE_TAG)).toBe(2);
    expect(useAnnotationStore.getState().annotations['a.md']?.tags).toEqual(['duplicate']);
    expect(useAnnotationStore.getState().annotations['b.md']?.tags).toEqual(['duplicate']);
    expect(documentsAlreadyTagged(nodes, ['a', 'b'], DUPLICATE_TAG)).toBe(true);
    expect(addTagToDocuments(nodes, ['a', 'b'], DUPLICATE_TAG)).toBe(0);
  });

  it('does nothing when annotations are not hydrated for a corpus', () => {
    _resetAnnotationsForTests();
    useAnnotationStore.setState({ scope: null, annotations: {} });
    expect(addTagToDocuments([doc('a', 'a.md')], ['a'], DUPLICATE_TAG)).toBe(0);
  });
});
