import { beforeEach, describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { docVectorStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { showSimilarTo } from './showSimilar';

function doc(id: string): DocNode {
  return {
    id,
    title: id,
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

describe('showSimilarTo', () => {
  beforeEach(() => {
    docVectorStore.clear();
    useGraphStore.getState().reset();
    useUiStore.setState({ searchResults: null, highlightOwner: null, cameraCommand: null });
  });

  it('frames the seed plus similar documents with the showMe highlight', () => {
    const nodes = [doc('seed'), doc('near'), doc('far')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { seed: 0, near: 1, far: 2 },
    });
    docVectorStore.set('seed', new Float32Array([1, 0]));
    docVectorStore.set('near', new Float32Array([0.99, 0.141067359]));
    docVectorStore.set('far', new Float32Array([0, 1]));

    expect(showSimilarTo('seed')).toBe(1);
    expect(useUiStore.getState().highlightOwner).toBe('showMe');
    expect(useUiStore.getState().searchResults).toEqual(['seed', 'near']);
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameSet');
  });

  it('returns 0 and leaves the scene highlight alone when nothing is similar', () => {
    useGraphStore.setState({ nodes: [doc('seed')], nodeIndex: { seed: 0 } });
    expect(showSimilarTo('seed')).toBe(0);
    expect(useUiStore.getState().searchResults).toBeNull();
  });
});
