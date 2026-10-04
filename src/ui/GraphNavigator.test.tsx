// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore, DEFAULT_FILTER } from '../store/uiStore';
import { commitPendingFocus } from './focusNode';
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
    useUiStore.setState({
      filter: {...DEFAULT_FILTER},
      selectedId: null,
      cameraCommand: null,
      compareLeftId: null,
      compareRightId: null,
      comparePick: null,
      pendingFocus: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useGraphStore.getState().reset();
    useUiStore.getState().clearCompare();
  });

  it('summarizes the graph and opens the active node from the keyboard', () => {
    render(<GraphNavigator />);
    expect(screen.getByRole('button', { name: 'Browse documents' })).toHaveTextContent('2 documents');
    fireEvent.click(screen.getByRole('button', { name: 'Browse documents' }));

    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-0');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-1');

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().pendingFocus?.id).toBe('zeta');
    expect(useUiStore.getState().cameraCommand).toMatchObject({ kind: 'frameNode', ids: ['zeta'] });
    commitPendingFocus();
    expect(useUiStore.getState().selectedId).toBe('zeta');
  });

  it('applies a compare pick instead of opening the side panel', () => {
    useUiStore.setState({
      compareLeftId: 'alpha',
      compareRightId: null,
      comparePick: 'right',
    });
    render(<GraphNavigator />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse documents' }));
    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useUiStore.getState().compareRightId).toBe('zeta');
    expect(useUiStore.getState().pendingFocus).toBeNull();
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('scrolls the newly active option into view as the highlight moves', () => {
    // The list moves aria-activedescendant rather than DOM focus, so nothing
    // scrolls it for us.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<GraphNavigator />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse documents' }));
    scrollIntoView.mockClear();

    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Graph nodes' }), { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('contains arrow keys so the global camera handler cannot consume them', () => {
    const windowHandler = vi.fn();
    window.addEventListener('keydown', windowHandler);
    render(<GraphNavigator />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse documents' }));

    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End']) {
      fireEvent.keyDown(list, { key });
    }
    expect(windowHandler).not.toHaveBeenCalled();
    act(() => useUiStore.getState().setFilter({ fileTypes: ['pdf'] }));
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(windowHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowHandler);
  });

  it('collapses the document list and returns focus to its toggle on Escape', () => {
    render(<GraphNavigator />);
    const toggle = screen.getByRole('button', { name: 'Browse documents' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    list.focus();
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside pointer press without changing document selection', () => {
    render(<GraphNavigator />);
    const toggle = screen.getByRole('button', { name: 'Browse documents' });
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(useUiStore.getState().selectedId).toBeNull();
  });
  it('limits keyboard candidates to filtered nodes and keeps an accessible empty state', () => {
    useUiStore.getState().setFilter({ fileTypes: ['md'] });
    render(<GraphNavigator embedded />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Alpha');
    act(() => useUiStore.getState().setFilter({ fileTypes: ['pdf'] }));
    expect(screen.getByRole('status')).toHaveTextContent('No documents match the current filters');
    const list = screen.getByRole('listbox');
    expect(list).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useUiStore.getState().pendingFocus).toBeNull();
    act(() => useUiStore.getState().setFilter({ fileTypes: ['txt'] }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveTextContent('Zeta');
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useUiStore.getState().pendingFocus?.id).toBe('zeta');
  });

  it('hops distinct clusters despite interleaved alphabetical ordering', () => {
    useGraphStore.setState({ nodes: [
      { ...nodes[0], id: 'a', title: 'A', cluster: 0 },
      { ...nodes[0], id: 'b', title: 'B', cluster: 1 },
      { ...nodes[0], id: 'c', title: 'C', cluster: 0 },
      { ...nodes[0], id: 'd', title: 'D', cluster: 2 },
    ] });
    render(<GraphNavigator embedded />);
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'PageUp' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-0');
    fireEvent.keyDown(list, { key: 'PageDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-1');
    fireEvent.keyDown(list, { key: 'PageDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-3');
    fireEvent.keyDown(list, { key: 'PageDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-3');
    fireEvent.keyDown(list, { key: 'PageUp' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-1');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-2');
    fireEvent.keyDown(list, { key: 'PageDown' });
    expect(list).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-1');
  });
});
