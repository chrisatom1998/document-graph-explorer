import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import {
  applyComparePick,
  closeCompare,
  openCompare,
  startCompare,
  startComparePick,
  swapCompare,
} from './openCompare';

function doc(id: string, kind: DocNode['kind'] = 'document'): DocNode {
  return {
    id,
    kind,
    title: id,
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

describe('openCompare', () => {
  beforeEach(() => {
    const nodes = [doc('a'), doc('b'), doc('topic', 'topic')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { a: 0, b: 1, topic: 2 },
      edges: [],
    });
    useUiStore.setState({
      selectedId: 'a',
      pathMode: true,
      pathEndpoints: ['a'],
      compareLeftId: null,
      compareRightId: null,
      comparePick: null,
      searchResults: ['x'],
      highlightOwner: 'path',
      cameraCommand: null,
    });
  });

  afterEach(() => {
    useUiStore.getState().clearCompare();
    useUiStore.setState({
      selectedId: null,
      pathMode: false,
      pathEndpoints: [],
      searchResults: null,
      highlightOwner: null,
    });
  });

  it('starts a pick from the selected document without closing the side panel', () => {
    startCompare('a');
    const ui = useUiStore.getState();
    expect(ui.compareLeftId).toBe('a');
    expect(ui.compareRightId).toBeNull();
    expect(ui.comparePick).toBe('right');
    expect(ui.selectedId).toBe('a');
    expect(ui.pathMode).toBe(false);
    expect(ui.searchResults).toEqual(['a']);
    expect(ui.highlightOwner).toBe('compare');
    expect(ui.cameraCommand).toMatchObject({ kind: 'frameNode', ids: ['a'] });
  });

  it('opens a known pair, closes the reader, and frames both nodes', () => {
    openCompare('a', 'b');
    const ui = useUiStore.getState();
    expect(ui.compareLeftId).toBe('a');
    expect(ui.compareRightId).toBe('b');
    expect(ui.comparePick).toBeNull();
    expect(ui.selectedId).toBeNull();
    expect(ui.pathMode).toBe(false);
    expect(ui.searchResults).toEqual(['a', 'b']);
    expect(ui.highlightOwner).toBe('compare');
    expect(ui.cameraCommand).toMatchObject({ kind: 'frameSet', ids: ['a', 'b'] });
  });

  it('applies a graph pick and ignores topic hubs or the other pane', () => {
    startCompare('a');
    expect(applyComparePick('topic')).toBe(false);
    expect(useUiStore.getState().compareRightId).toBeNull();
    expect(applyComparePick('a')).toBe(false);
    expect(applyComparePick('b')).toBe(true);
    expect(useUiStore.getState().compareRightId).toBe('b');
    expect(useUiStore.getState().comparePick).toBeNull();
    expect(useUiStore.getState().highlightOwner).toBe('compare');
  });

  it('lets Change replace one side', () => {
    openCompare('a', 'b');
    startComparePick('left');
    expect(applyComparePick('b')).toBe(false);
    expect(applyComparePick('a')).toBe(true);
    expect(useUiStore.getState().compareLeftId).toBe('a');
    expect(useUiStore.getState().compareRightId).toBe('b');
  });

  it('swaps panes and clears compare including its highlight', () => {
    openCompare('a', 'b');
    swapCompare();
    expect(useUiStore.getState().compareLeftId).toBe('b');
    expect(useUiStore.getState().compareRightId).toBe('a');

    closeCompare();
    const ui = useUiStore.getState();
    expect(ui.compareLeftId).toBeNull();
    expect(ui.compareRightId).toBeNull();
    expect(ui.comparePick).toBeNull();
    expect(ui.searchResults).toBeNull();
    expect(ui.highlightOwner).toBeNull();
  });

  it('exits compare when path mode turns on', () => {
    openCompare('a', 'b');
    useUiStore.getState().setPathMode(true);
    const ui = useUiStore.getState();
    expect(ui.compareLeftId).toBeNull();
    expect(ui.compareRightId).toBeNull();
    expect(ui.pathMode).toBe(true);
  });
});
