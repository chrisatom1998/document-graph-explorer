// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import SidePanel from './SidePanel';

describe('SidePanel focus restoration', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [{
        id: 'doc-1',
        kind: 'document',
        title: 'Document one',
        fileType: 'txt',
        topics: [],
        entities: [],
        keywords: [],
        wordCount: 10,
        cluster: 0,
        degree: 0,
        status: 'ok',
      }],
      nodeIndex: { 'doc-1': 0 },
      edges: [],
      phase: 'ready',
    });
    useUiStore.setState({ selectedId: 'doc-1', readerHighlight: null });
  });

  afterEach(() => {
    cleanup();
    document.querySelector('.nebula-canvas')?.remove();
    document.querySelector('.graph-navigator__list')?.remove();
    useGraphStore.getState().reset();
    useUiStore.getState().setSelected(null);
  });

  it('returns a canvas-opened panel to the graph without opening the navigator overlay', async () => {
    const graphSurface = document.createElement('div');
    graphSurface.className = 'nebula-canvas';
    graphSurface.tabIndex = -1;
    document.body.appendChild(graphSurface);

    const navigator = document.createElement('div');
    navigator.className = 'graph-navigator__list';
    navigator.tabIndex = 0;
    document.body.appendChild(navigator);

    render(<SidePanel />);
    const close = screen.getByRole('button', { name: 'Back to graph' });
    expect(close).toHaveFocus();

    fireEvent.click(close);

    await waitFor(() => expect(graphSurface).toHaveFocus());
    expect(navigator).not.toHaveFocus();
  });
});
