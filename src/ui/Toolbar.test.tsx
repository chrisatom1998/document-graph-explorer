// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { layoutSetDims } from '../layout/layoutBridge';
import Toolbar from './Toolbar';

// The bridge owns a real Worker; the toggle contract is what we assert here.
vi.mock('../layout/layoutBridge', () => ({
  layoutSetDims: vi.fn(),
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
    });
    vi.mocked(layoutSetDims).mockClear();
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
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
  });

  it('drives both the store flag and the layout worker when toggling dimensions', () => {
    render(<Toolbar />);

    // Both calls are required: the store flag restyles the scene, the bridge
    // reheats the simulation. Either one alone leaves the view inconsistent.
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 2D view' }));
    expect(useUiStore.getState().dims).toBe(2);
    expect(layoutSetDims).toHaveBeenLastCalledWith(2);
    expect(screen.getByRole('button', { name: 'Switch to 3D view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch to 3D view' }));
    expect(useUiStore.getState().dims).toBe(3);
    expect(layoutSetDims).toHaveBeenLastCalledWith(3);
    expect(screen.getByRole('button', { name: 'Switch to 2D view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
