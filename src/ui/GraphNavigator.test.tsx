// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import GraphNavigator from './GraphNavigator';

const nodes: DocNode[] = [
  {
    id: 'zeta', kind: 'document', title: 'Zeta', fileType: 'txt', topics: [], entities: [],
    keywords: [], wordCount: 10, cluster: 1, degree: 1, status: 'ok',
  },
  {
    id: 'alpha', kind: 'document', title: 'Alpha', fileType: 'md', topics: [], entities: [],
    keywords: [], wordCount: 10, cluster: 0, degree: 1, status: 'ok',
  },
];

describe('GraphNavigator', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes,
      nodeIndex: { zeta: 0, alpha: 1 },
      edges: [{ id: 'alpha->zeta:semantic', source: 'alpha', target: 'zeta', kind: 'semantic', weight: 0.9, evidence: ['test'] }],
      phase: 'ready',
    });
    useUiStore.setState({ selectedId: null, cameraCommand: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useGraphStore.getState().reset();
  });

  it('summarizes the graph and opens the active node from the keyboard', () => {
    render(<GraphNavigator />);
    expect(screen.getByText(/2 documents, 0 topic hubs, 1 connection, 2 clusters/i)).toBeVisible();

    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-0');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-1');

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useUiStore.getState().selectedId).toBe('zeta');
    expect(useUiStore.getState().cameraCommand).toMatchObject({ kind: 'frameNode', ids: ['zeta'] });
  });

  it('scrolls the newly active option into view as the highlight moves', () => {
    // The list moves aria-activedescendant rather than DOM focus, so nothing
    // scrolls it for us.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<GraphNavigator />);
    scrollIntoView.mockClear();

    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Graph nodes' }), { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('contains arrow keys so the global camera handler cannot consume them', () => {
    const windowHandler = vi.fn();
    window.addEventListener('keydown', windowHandler);
    render(<GraphNavigator />);

    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Graph nodes' }), { key: 'ArrowDown' });
    expect(windowHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowHandler);
  });
});
