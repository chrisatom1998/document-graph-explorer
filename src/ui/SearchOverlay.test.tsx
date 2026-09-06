// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../search/semanticSearch', () => ({
  searchCorpus: vi.fn(),
  searchCorpusLexical: vi.fn(),
}));

import { searchCorpus, searchCorpusLexical } from '../search/semanticSearch';
import { useGraphStore } from '../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import { docVectorStore } from '../store/runtimeStores';
import { commitPendingFocus } from './focusNode';
import SearchOverlay from './SearchOverlay';

const mockSearchCorpus = vi.mocked(searchCorpus);
const mockSearchCorpusLexical = vi.mocked(searchCorpusLexical);

function documentNode(): DocNode {
  return {
    id: 'architecture',
    kind: 'document',
    title: 'Architecture Overview',
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function secondDocumentNode(): DocNode {
  return { ...documentNode(), id: 'runbook', title: 'Incident Runbook' };
}

describe('SearchOverlay', () => {
  beforeEach(() => {
    docVectorStore.clear();
    useGraphStore.getState().reset();
    useGraphStore.setState({ nodes: [documentNode()], nodeIndex: { architecture: 0 } });
    useUiStore.setState({
      searchOpen: true,
      searchResults: null,
      highlightOwner: null,
      filter: { ...DEFAULT_FILTER },
      selectedId: null,
      readerHighlight: null,
      cameraCommand: null,
      toasts: [],
    });
    mockSearchCorpus.mockReset();
    mockSearchCorpusLexical.mockReset();
  });

  afterEach(cleanup);

  it('provides a keyboard-browsable document list before a query is entered', async () => {
    useGraphStore.setState({
      nodes: [documentNode(), secondDocumentNode()],
      nodeIndex: { architecture: 0, runbook: 1 },
    });

    render(<SearchOverlay />);

    const listbox = screen.getByRole('listbox', { name: 'All documents' });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: /Architecture Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Incident Runbook/i })).toBeInTheDocument();
    expect(mockSearchCorpusLexical).not.toHaveBeenCalled();
    expect(mockSearchCorpus).not.toHaveBeenCalled();
  });

  it('shows lexical matches without waiting for the semantic search', async () => {
    mockSearchCorpusLexical.mockResolvedValue([{
      id: 'architecture',
      score: 1,
      matchKind: 'title',
      snippet: 'Architecture details',
    }]);
    mockSearchCorpus.mockReturnValue(new Promise(() => {}));

    render(<SearchOverlay />);
    fireEvent.change(
      screen.getByRole('combobox', { name: /search your documents/i }),
      { target: { value: 'architecture' } },
    );

    await waitFor(() => expect(screen.getByRole('option')).toHaveTextContent('Architecture Overview'));
    expect(mockSearchCorpusLexical).toHaveBeenCalledWith('architecture', undefined);
    expect(mockSearchCorpus).toHaveBeenCalledWith('architecture', undefined);
    expect(useUiStore.getState().searchResults).toEqual(['architecture']);
  });

  it('hides documents that fail the active file-type filter', () => {
    useGraphStore.setState({
      nodes: [documentNode(), { ...secondDocumentNode(), fileType: 'pdf' }],
      nodeIndex: { architecture: 0, runbook: 1 },
    });
    useUiStore.setState({ filter: { ...DEFAULT_FILTER, fileTypes: ['md'] } });

    render(<SearchOverlay />);

    expect(screen.getByRole('option', { name: /Architecture Overview/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Incident Runbook/i })).not.toBeInTheDocument();
  });

  it('passes active filters to both search passes and repeats search when filters change', async () => {
    useGraphStore.setState({
      nodes: [documentNode(), { ...secondDocumentNode(), fileType: 'pdf' }],
      nodeIndex: { architecture: 0, runbook: 1 },
    });
    useUiStore.setState({ filter: { ...DEFAULT_FILTER, fileTypes: ['md'] } });
    mockSearchCorpusLexical.mockResolvedValue([]);
    mockSearchCorpus.mockResolvedValue([]);
    render(<SearchOverlay />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'operations' } });
    await waitFor(() => expect(mockSearchCorpus).toHaveBeenCalledWith('operations', new Set(['architecture'])));
    expect(mockSearchCorpusLexical).toHaveBeenCalledWith('operations', new Set(['architecture']));
    await act(async () => {
      useUiStore.setState({ filter: { ...DEFAULT_FILTER, fileTypes: ['pdf'] } });
    });
    await waitFor(() => expect(mockSearchCorpus).toHaveBeenLastCalledWith('operations', new Set(['runbook'])));
    expect(mockSearchCorpusLexical).toHaveBeenLastCalledWith('operations', new Set(['runbook']));
    expect(screen.getByRole('status')).toHaveTextContent('No matches within the active filters');
  });

  it('explains when all returned results are excluded by the current filters', async () => {
    useUiStore.setState({ filter: { ...DEFAULT_FILTER, fileTypes: ['pdf'] } });
    const hits = [{ id: 'architecture', score: 1, matchKind: 'title' as const }];
    mockSearchCorpusLexical.mockResolvedValue(hits);
    mockSearchCorpus.mockResolvedValue(hits);
    render(<SearchOverlay />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'architecture' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No matches within the active filters'));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('does not restore highlights when an in-flight search lands after close', async () => {
    let resolveLexical!: (hits: Awaited<ReturnType<typeof searchCorpusLexical>>) => void;
    mockSearchCorpusLexical.mockReturnValue(
      new Promise((resolve) => {
        resolveLexical = resolve;
      }),
    );
    mockSearchCorpus.mockResolvedValue([]);

    render(<SearchOverlay />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'architecture' } });
    await waitFor(() => expect(mockSearchCorpusLexical).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /close search/i }));

    resolveLexical([{ id: 'architecture', score: 1, matchKind: 'title' }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(useUiStore.getState().searchResults).toBeNull();
  });

  it('invalidates an in-flight search as soon as the query is cleared', async () => {
    let resolveLexical!: (hits: Awaited<ReturnType<typeof searchCorpusLexical>>) => void;
    mockSearchCorpusLexical.mockReturnValue(
      new Promise((resolve) => {
        resolveLexical = resolve;
      }),
    );
    mockSearchCorpus.mockResolvedValue([]);

    render(<SearchOverlay />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'architecture' } });
    await waitFor(() => expect(mockSearchCorpusLexical).toHaveBeenCalled());
    fireEvent.change(input, { target: { value: '' } });

    resolveLexical([{ id: 'architecture', score: 1, matchKind: 'title' }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(useUiStore.getState().searchResults).toBeNull();
    expect(screen.getByRole('listbox', { name: 'All documents' })).toBeInTheDocument();
  });

  it('frames every match from Show all in graph instead of opening a second topic panel', async () => {
    useGraphStore.setState({
      nodes: [documentNode(), secondDocumentNode()],
      nodeIndex: { architecture: 0, runbook: 1 },
    });
    mockSearchCorpusLexical.mockResolvedValue([
      { id: 'architecture', score: 1, matchKind: 'title' },
      { id: 'runbook', score: 0.8, matchKind: 'keyword' },
    ]);
    mockSearchCorpus.mockResolvedValue([
      { id: 'architecture', score: 1, matchKind: 'title' },
      { id: 'runbook', score: 0.8, matchKind: 'keyword' },
    ]);

    render(<SearchOverlay />);
    fireEvent.change(
      screen.getByRole('combobox', { name: /search your documents/i }),
      { target: { value: 'ops' } },
    );

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /show all in graph/i }));

    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(useUiStore.getState().highlightOwner).toBe('showMe');
    expect(useUiStore.getState().searchResults).toEqual(['architecture', 'runbook']);
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameSet');
    expect(useUiStore.getState().cameraCommand?.ids).toEqual(['architecture', 'runbook']);
  });

  it('keeps a Show-all highlight when the in-flight semantic pass lands later', async () => {
    useGraphStore.setState({
      nodes: [documentNode(), secondDocumentNode()],
      nodeIndex: { architecture: 0, runbook: 1 },
    });
    mockSearchCorpusLexical.mockResolvedValue([
      { id: 'architecture', score: 1, matchKind: 'title' },
      { id: 'runbook', score: 0.8, matchKind: 'keyword' },
    ]);
    let finishSemantic: (value: Awaited<ReturnType<typeof searchCorpus>>) => void = () => {};
    mockSearchCorpus.mockReturnValue(
      new Promise((resolve) => {
        finishSemantic = resolve;
      }),
    );

    render(<SearchOverlay />);
    fireEvent.change(
      screen.getByRole('combobox', { name: /search your documents/i }),
      { target: { value: 'ops' } },
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /show all in graph/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /show all in graph/i }));
    expect(useUiStore.getState().highlightOwner).toBe('showMe');
    expect(useUiStore.getState().searchResults).toEqual(['architecture', 'runbook']);

    await act(async () => {
      finishSemantic([{ id: 'architecture', score: 1, matchKind: 'semantic' }]);
    });
    expect(useUiStore.getState().highlightOwner).toBe('showMe');
    expect(useUiStore.getState().searchResults).toEqual(['architecture', 'runbook']);
  });

  it('cycles Tab from the close button onto Show all in graph', async () => {
    useGraphStore.setState({
      nodes: [documentNode(), secondDocumentNode()],
      nodeIndex: { architecture: 0, runbook: 1 },
    });
    mockSearchCorpusLexical.mockResolvedValue([
      { id: 'architecture', score: 1, matchKind: 'title' },
      { id: 'runbook', score: 0.8, matchKind: 'keyword' },
    ]);
    mockSearchCorpus.mockResolvedValue([
      { id: 'architecture', score: 1, matchKind: 'title' },
      { id: 'runbook', score: 0.8, matchKind: 'keyword' },
    ]);

    render(<SearchOverlay />);
    fireEvent.change(
      screen.getByRole('combobox', { name: /search your documents/i }),
      { target: { value: 'ops' } },
    );

    const showAll = await screen.findByRole('button', { name: /show all in graph/i });
    const close = screen.getByRole('button', { name: /close search/i });
    const input = screen.getByRole('combobox', { name: /search your documents/i });

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(showAll).toHaveFocus();

    fireEvent.keyDown(showAll, { key: 'Tab' });
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(showAll).toHaveFocus();
  });

  it('opens the matching passage when a search hit is chosen', async () => {
    mockSearchCorpusLexical.mockResolvedValue([{
      id: 'architecture',
      score: 1,
      matchKind: 'keyword',
      snippet: 'Architecture details live here',
      passageIndex: 2,
    }]);
    mockSearchCorpus.mockResolvedValue([{
      id: 'architecture',
      score: 1,
      matchKind: 'keyword',
      snippet: 'Architecture details live here',
      passageIndex: 2,
    }]);

    render(<SearchOverlay />);
    fireEvent.change(
      screen.getByRole('combobox', { name: /search your documents/i }),
      { target: { value: 'architecture' } },
    );
    const option = await screen.findByRole('option', { name: /Architecture Overview/i });
    fireEvent.click(option);

    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameNode');
    expect(useUiStore.getState().pendingFocus?.id).toBe('architecture');
    commitPendingFocus();
    expect(useUiStore.getState().selectedId).toBe('architecture');
    expect(useUiStore.getState().readerHighlight).toEqual({
      docId: 'architecture',
      text: 'Architecture details live here',
      passageIndex: 2,
    });
  });

  it('shows similar documents for the active result with Alt+Enter', () => {
    useGraphStore.setState({
      nodes: [documentNode(), secondDocumentNode()],
      nodeIndex: { architecture: 0, runbook: 1 },
      edges: [{
        id: 'similar',
        source: 'architecture',
        target: 'runbook',
        kind: 'semantic',
        weight: 0.9,
        evidence: ['similar'],
      }],
    });

    render(<SearchOverlay />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter');
    for (const button of screen.getAllByRole('button', { name: 'Similar' })) {
      expect(button).not.toHaveAttribute('tabindex', '-1');
    }
    fireEvent.keyDown(input, { key: 'Enter', altKey: true });

    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(useUiStore.getState().highlightOwner).toBe('showMe');
    expect(useUiStore.getState().searchResults).toEqual(['architecture', 'runbook']);
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameSet');
  });
});
