import { beforeEach, describe, expect, it } from 'vitest';
import { chunkStore } from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';
import { commitPendingFocus, commitPendingFocusIf, focusNode } from './focusNode';

describe('focusNode', () => {
  beforeEach(() => {
    chunkStore.clear();
    useUiStore.setState({
      selectedId: null,
      pendingFocus: null,
      readerHighlight: null,
      cameraCommand: null,
    });
  });

  it('frames the camera first and leaves the side panel closed', () => {
    focusNode('doc-a');
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().readerHighlight).toBeNull();
    expect(useUiStore.getState().pendingFocus).toEqual({ id: 'doc-a' });
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameNode');
    expect(useUiStore.getState().cameraCommand?.ids).toEqual(['doc-a']);
  });

  it('opens the panel and applies a stored-chunk highlight on commit', () => {
    chunkStore.set('doc-a', {
      texts: ['full chunk about disaster recovery'],
      vectors: null,
      dims: 0,
    });
    focusNode('doc-a', { index: 0, text: 'disaster recovery' });
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().readerHighlight).toBeNull();
    expect(useUiStore.getState().pendingFocus).toEqual({
      id: 'doc-a',
      passage: { index: 0, text: 'disaster recovery' },
    });

    expect(commitPendingFocus()).toBe(true);
    expect(useUiStore.getState().selectedId).toBe('doc-a');
    expect(useUiStore.getState().pendingFocus).toBeNull();
    expect(useUiStore.getState().readerHighlight).toEqual({
      docId: 'doc-a',
      text: 'full chunk about disaster recovery',
      passageIndex: 0,
    });
  });

  it('uses the snippet when chunk text is unavailable', () => {
    focusNode('doc-a', { text: 'imported summary snippet' });
    commitPendingFocus();
    expect(useUiStore.getState().readerHighlight).toMatchObject({
      docId: 'doc-a',
      text: 'imported summary snippet',
    });
  });

  it('keeps annotation snippets when chunks exist but no passage index is given', () => {
    chunkStore.set('doc-a', {
      texts: ['opening body chunk that should not be highlighted'],
      vectors: null,
      dims: 0,
    });
    focusNode('doc-a', { text: 'Tags: legal-hold' });
    commitPendingFocus();
    expect(useUiStore.getState().readerHighlight).toEqual({
      docId: 'doc-a',
      text: 'Tags: legal-hold',
    });
  });

  it('replaces a previous pending focus without opening the first panel', () => {
    focusNode('doc-a', { text: 'passage a' });
    focusNode('doc-b');
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().pendingFocus).toEqual({ id: 'doc-b' });
    commitPendingFocus();
    expect(useUiStore.getState().selectedId).toBe('doc-b');
    expect(useUiStore.getState().readerHighlight).toBeNull();
  });

  it('does not commit after the pending focus is dismissed', () => {
    focusNode('doc-a');
    useUiStore.getState().setSelected(null);
    expect(useUiStore.getState().pendingFocus).toBeNull();
    expect(commitPendingFocus()).toBe(false);
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('commits only when the framed id matches the pending node', () => {
    focusNode('doc-a');
    expect(commitPendingFocusIf('doc-other')).toBe(false);
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(commitPendingFocusIf('doc-a')).toBe(true);
    expect(useUiStore.getState().selectedId).toBe('doc-a');
  });
});
