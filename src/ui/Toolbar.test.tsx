// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { switchGraphDimensions } from '../scene/dimensionTransition';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import Toolbar from './Toolbar';

vi.mock('../scene/dimensionTransition', () => ({
  switchGraphDimensions: vi.fn(),
}));

function documentNode(): DocNode {
  return {
    id: 'doc',
    kind: 'document',
    title: 'Document',
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

describe('Toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(switchGraphDimensions).mockImplementation((dims) => {
      useUiStore.getState().setDims(dims);
    });
    useGraphStore.setState({
      nodes: [documentNode()],
      nodeIndex: { doc: 0 },
      edges: [],
      phase: 'ready',
    });
    useUiStore.setState({
      searchOpen: false,
      settingsOpen: false,
      snapshotsOpen: false,
      helpOpen: false,
      insightsOpen: false,
      pathMode: false,
      dims: 3,
      flatEdgeDetail: 'balanced',
    });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    localStorage.removeItem('knowledge-nebula-dims');
  });

  it('keeps studio tools in Analyze and Add menus instead of first-class buttons', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: 'Search documents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add documents' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me a topic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corpus insights' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saved snapshots' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add folder' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(screen.getByRole('button', { name: 'How are these connected?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Corpus insights' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Snapshots' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Add documents' }));
    expect(screen.getByRole('button', { name: 'Add files' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add folder' })).toBeVisible();
  });

  it('exposes the dimension switch as a first-class button, not a View menu item', () => {
    render(<Toolbar />);

    const toggle = screen.getByRole('button', { name: 'Switch to 2D view' });
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // The View menu keeps the other display toggles but no longer duplicates
    // this one — two live controls for one state would drift.
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByRole('button', { name: 'Topic nodes' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Switch to (2D|3D) view/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Link detail/ })).not.toBeInTheDocument();
  });

  it('coordinates dimension changes and reveals 2D link detail controls', () => {
    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to 2D view' }));
    expect(useUiStore.getState().dims).toBe(2);
    expect(switchGraphDimensions).toHaveBeenLastCalledWith(2, { fitAfterSettle: true });
    expect(screen.getByRole('button', { name: 'Switch to 3D view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('2D')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByRole('button', { name: 'Link detail: balanced' })).toBeVisible();
  });
});
