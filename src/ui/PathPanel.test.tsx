// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { commitPendingFocus } from './focusNode';
import PathPanel from './PathPanel';

function makeDoc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 50,
    cluster: 0,
    degree: 1,
    status: 'ok',
  };
}

const mockNodes: DocNode[] = [
  makeDoc('docA', 'Document A'),
  makeDoc('docB', 'Document B'),
  makeDoc('docC', 'Document C'),
  makeDoc('docZ', 'Document Z'),
];

const mockNodeIndex: Record<string, number> = {
  docA: 0,
  docB: 1,
  docC: 2,
  docZ: 3,
};

const mockEdges: Edge[] = [
  { id: 'docA->docB:reference', source: 'docA', target: 'docB', weight: 0.9, kind: 'reference', evidence: [] },
  { id: 'docB->docC:reference', source: 'docB', target: 'docC', weight: 0.8, kind: 'reference', evidence: [] },
];

describe('PathPanel', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.setState({
      nodes: mockNodes,
      nodeIndex: mockNodeIndex,
      edges: mockEdges,
    });
    useUiStore.setState({
      pathMode: true,
      pathEndpoints: [],
      searchResults: null,
      highlightOwner: null,
      cameraCommand: null,
      selectedId: null,
    });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    useUiStore.setState({ pathMode: false, pathEndpoints: [] });
  });

  it('renders nothing when pathMode is false', () => {
    useUiStore.setState({ pathMode: false });
    const { container } = render(<PathPanel />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders initial hint when 0 endpoints are selected', () => {
    render(<PathPanel />);

    expect(screen.getByRole('dialog', { name: 'Connection path finder' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How are these connected?' })).toBeInTheDocument();
    expect(screen.getByText('Choose a node to start a path.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('renders node chip and second hint when 1 endpoint is selected', () => {
    useUiStore.setState({ pathEndpoints: ['docA'] });
    render(<PathPanel />);

    expect(screen.getByText('Document A')).toBeInTheDocument();
    expect(screen.getByText('Choose a second node.')).toBeInTheDocument();
  });

  it('announces each endpoint pick through a polite live region', () => {
    render(<PathPanel />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('');

    act(() => useUiStore.getState().addPathEndpoint('docA'));
    expect(status).toHaveTextContent('Path start: Document A. Choose an end node.');

    act(() => useUiStore.getState().addPathEndpoint('docC'));
    expect(status).toHaveTextContent('Path end: Document C. 2 hops from Document A.');

    act(() => useUiStore.setState({ pathEndpoints: ['docA', 'docZ'] }));
    expect(status).toHaveTextContent('Path end: Document Z. No connection found.');
  });

  it('takes the selected document as the next endpoint from the keyboard', () => {
    useUiStore.setState({ selectedId: 'docA' });
    render(<PathPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Use “Document A” as the start' }));
    expect(useUiStore.getState().pathEndpoints).toEqual(['docA']);
    // Already an endpoint: nothing to offer until another node is selected.
    expect(screen.queryByRole('button', { name: /^Use “/ })).not.toBeInTheDocument();

    act(() => useUiStore.setState({ selectedId: 'docC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use “Document C” as the end' }));
    expect(useUiStore.getState().pathEndpoints).toEqual(['docA', 'docC']);
    expect(screen.getByText('2 hops')).toBeInTheDocument();

    act(() => useUiStore.setState({ selectedId: 'docB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use “Document B” to start a new path' }));
    expect(useUiStore.getState().pathEndpoints).toEqual(['docB']);
  });

  it('calculates shortest path, displays hop count, and updates scene highlights when 2 connected endpoints are selected', () => {
    useUiStore.setState({ pathEndpoints: ['docA', 'docC'] });
    render(<PathPanel />);

    expect(screen.getByText('2 hops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Document A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Document B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Document C' })).toBeInTheDocument();

    const ui = useUiStore.getState();
    expect(ui.searchResults).toEqual(['docA', 'docB', 'docC']);
    expect(ui.highlightOwner).toBe('path');
    expect(ui.cameraCommand?.kind).toBe('frameSet');
    expect(ui.cameraCommand?.ids).toEqual(['docA', 'docB', 'docC']);
  });

  it('renders "1 hop" singular label for direct connection', () => {
    useUiStore.setState({ pathEndpoints: ['docA', 'docB'] });
    render(<PathPanel />);

    expect(screen.getByText('1 hop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Document A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Document B' })).toBeInTheDocument();
  });

  it('displays disconnected message when no path exists between selected endpoints', () => {
    useUiStore.setState({ pathEndpoints: ['docA', 'docZ'] });
    render(<PathPanel />);

    expect(screen.getByText('No connection found between these documents.')).toBeInTheDocument();
    expect(useUiStore.getState().searchResults).toEqual(['docA', 'docZ']);
    expect(useUiStore.getState().highlightOwner).toBe('path');
  });

  it('focuses node when a path node button is clicked', () => {
    useUiStore.setState({ pathEndpoints: ['docA', 'docC'] });
    render(<PathPanel />);

    const docBBtn = screen.getByRole('button', { name: 'Document B' });
    fireEvent.click(docBBtn);

    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().pendingFocus?.id).toBe('docB');
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameNode');
    expect(useUiStore.getState().cameraCommand?.ids).toEqual(['docB']);
    commitPendingFocus();
    expect(useUiStore.getState().selectedId).toBe('docB');
  });

  it('clears highlights and exits path mode when close button is clicked', () => {
    useUiStore.setState({ pathEndpoints: ['docA', 'docC'] });
    render(<PathPanel />);

    const closeBtn = screen.getByRole('button', { name: 'Close path finder' });
    fireEvent.click(closeBtn);

    const ui = useUiStore.getState();
    expect(ui.searchResults).toBeNull();
    expect(ui.pathMode).toBe(false);
    expect(ui.pathEndpoints).toEqual([]);
  });
});
