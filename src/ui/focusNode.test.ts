import { beforeEach, describe, expect, it } from 'vitest';
import { chunkStore } from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';
import { focusNode } from './focusNode';

describe('focusNode', () => {
  beforeEach(() => {
    chunkStore.clear();
    useUiStore.setState({ selectedId: null, readerHighlight: null, cameraCommand: null });
  });

  it('selects and frames a node without a passage highlight', () => {
    focusNode('doc-a');
    expect(useUiStore.getState().selectedId).toBe('doc-a');
    expect(useUiStore.getState().readerHighlight).toBeNull();
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameNode');
    expect(useUiStore.getState().cameraCommand?.ids).toEqual(['doc-a']);
  });

  it('prefers stored chunk text over the citation snippet', () => {
    chunkStore.set('doc-a', {
      texts: ['full chunk about disaster recovery'],
      vectors: null,
      dims: 0,
    });
    focusNode('doc-a', { index: 0, text: 'disaster recovery' });
    expect(useUiStore.getState().readerHighlight).toEqual({
      docId: 'doc-a',
      text: 'full chunk about disaster recovery',
      passageIndex: 0,
    });
  });

  it('uses the snippet when chunk text is unavailable', () => {
    focusNode('doc-a', { text: 'imported summary snippet' });
    expect(useUiStore.getState().readerHighlight).toMatchObject({
      docId: 'doc-a',
      text: 'imported summary snippet',
    });
  });

  it('clears a previous highlight when selecting a different node', () => {
    focusNode('doc-a', { text: 'passage a' });
    focusNode('doc-b');
    expect(useUiStore.getState().selectedId).toBe('doc-b');
    expect(useUiStore.getState().readerHighlight).toBeNull();
  });
});
