// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

vi.mock('./SidePanelReader', () => ({
  default: ({ node, onNavigate }: { node: DocNode; onNavigate?: (id: string) => void }) => (
    <button type="button" onClick={() => onNavigate?.('linked')}>
      Follow link from {node.id}
    </button>
  ),
}));

import ComparePanel from './ComparePanel';

function doc(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 1,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('ComparePanel reader navigation', () => {
  beforeEach(() => {
    const nodes = [doc('left'), doc('right'), doc('linked')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { left: 0, right: 1, linked: 2 },
      edges: [],
    });
    useUiStore.setState({
      compareLeftId: 'left',
      compareRightId: 'right',
      comparePick: null,
      selectedId: null,
      pendingFocus: null,
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.getState().clearCompare();
  });

  it('closes compare and focuses the linked document', () => {
    render(<ComparePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Follow link from left' }));

    const ui = useUiStore.getState();
    expect(ui.compareLeftId).toBeNull();
    expect(ui.compareRightId).toBeNull();
    expect(ui.pendingFocus).toEqual({ id: 'linked' });
    expect(ui.cameraCommand).toMatchObject({ kind: 'frameNode', ids: ['linked'] });
  });
});
