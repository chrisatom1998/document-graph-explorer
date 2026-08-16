// @vitest-environment jsdom
/**
 * The Connections list is the only surface for edge evidence, but it is
 * uncapped by nature — a hub document can carry dozens of edges, each with
 * several "mentions …" lines, which pushed everything below it (notably the
 * Ask AI section) off screen. It collapses to the strongest few, with
 * evidence collapsed per row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { DocNode, Edge } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const COLLAPSED = 8;
const NEIGHBOURS = 12;

function doc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 100,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

// Descending weights, so the render order is deterministic and "top N" is
// unambiguous: neighbour-0 is strongest.
const neighbours = Array.from({ length: NEIGHBOURS }, (_, i) => doc(`n${i}`, `Neighbour ${i}`));
const edges: Edge[] = neighbours.map((n, i) => ({
  id: `doc1->${n.id}`,
  source: 'doc1',
  target: n.id,
  kind: 'reference',
  weight: 1 - i * 0.01,
  evidence: [`mentions '${n.id}-a.pdf'`, `mentions '${n.id}-b.pdf'`, `mentions '${n.id}-c.pdf'`],
}));

describe('SidePanel connections list', () => {
  beforeEach(() => {
    const nodes = [doc('doc1', 'Doc One'), ...neighbours];
    useGraphStore.setState({
      nodes,
      nodeIndex: Object.fromEntries(nodes.map((n, i) => [n.id, i])),
      edges,
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.getState().setSelected('doc1');
  });

  afterEach(() => cleanup());

  function openConnections(): void {
    fireEvent.click(screen.getByRole('button', { name: /^connections$/i }));
  }

  it('keeps the connections list collapsed until the section is opened', () => {
    render(<SidePanel />);
    expect(screen.getByText('Neighbour 0')).not.toBeVisible();
    openConnections();
    expect(screen.getByText('Neighbour 0')).toBeVisible();
  });

  it('shows only the strongest connections until expanded', () => {
    render(<SidePanel />);
    openConnections();

    expect(screen.getByText('Neighbour 0')).toBeInTheDocument();
    expect(screen.getByText(`Neighbour ${COLLAPSED - 1}`)).toBeInTheDocument();
    expect(screen.queryByText(`Neighbour ${COLLAPSED}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show all 12 connections/i }));
    expect(screen.getByText(`Neighbour ${NEIGHBOURS - 1}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`show top ${COLLAPSED}`, 'i') }));
    expect(screen.queryByText(`Neighbour ${COLLAPSED}`)).not.toBeInTheDocument();
  });

  it('shows one evidence line per row, expandable in place', () => {
    render(<SidePanel />);
    openConnections();

    expect(screen.getByText("mentions 'n0-a.pdf'")).toBeInTheDocument();
    expect(screen.queryByText("mentions 'n0-b.pdf'")).not.toBeInTheDocument();

    // Each collapsed row offers its own toggle; expand the first.
    fireEvent.click(screen.getAllByRole('button', { name: /\+2 more/i })[0]);

    expect(screen.getByText("mentions 'n0-b.pdf'")).toBeInTheDocument();
    expect(screen.getByText("mentions 'n0-c.pdf'")).toBeInTheDocument();
    // Expanding one row must not expand its siblings.
    expect(screen.queryByText("mentions 'n1-b.pdf'")).not.toBeInTheDocument();
  });

  it('does not repeat the connection count in the section header', () => {
    render(<SidePanel />);
    // The identity row already reports the degree; a second count here was
    // the same number twice in one panel.
    expect(screen.getByRole('button', { name: /^connections$/i })).toBeInTheDocument();
    expect(screen.queryByText(`Connections (${NEIGHBOURS})`)).not.toBeInTheDocument();
  });

  it('offers Compare on document neighbors', () => {
    render(<SidePanel />);
    openConnections();
    fireEvent.click(screen.getByTitle('Compare with Neighbour 0'));
    expect(useUiStore.getState().compareLeftId).toBe('doc1');
    expect(useUiStore.getState().compareRightId).toBe('n0');
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('resets expansion when the selection changes', () => {
    render(<SidePanel />);
    openConnections();
    fireEvent.click(screen.getByRole('button', { name: /show all 12 connections/i }));
    expect(screen.getByText(`Neighbour ${NEIGHBOURS - 1}`)).toBeInTheDocument();

    // A stale expansion would carry a hub document's long list onto the next
    // selection, which is exactly the overflow this collapse exists to stop.
    // Committed separately: batching both into one render would leave
    // selectedId unchanged from the effect's point of view, so it never runs.
    act(() => useUiStore.getState().setSelected('n0'));
    act(() => useUiStore.getState().setSelected('doc1'));

    expect(screen.queryByText(`Neighbour ${COLLAPSED}`)).not.toBeInTheDocument();
    openConnections();
    expect(screen.queryByText(`Neighbour ${COLLAPSED}`)).not.toBeInTheDocument();
  });
});
