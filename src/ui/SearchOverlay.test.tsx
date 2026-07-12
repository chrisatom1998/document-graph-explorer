// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../search/semanticSearch', () => ({
  searchCorpus: vi.fn(),
  searchCorpusLexical: vi.fn(),
}));

import { searchCorpus, searchCorpusLexical } from '../search/semanticSearch';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
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
    useGraphStore.getState().reset();
    useGraphStore.setState({ nodes: [documentNode()], nodeIndex: { architecture: 0 } });
    useUiStore.setState({ searchOpen: true, searchResults: null, highlightOwner: null });
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
    expect(mockSearchCorpusLexical).toHaveBeenCalledWith('architecture');
    expect(mockSearchCorpus).toHaveBeenCalledWith('architecture');
    expect(useUiStore.getState().searchResults).toEqual(['architecture']);
  });
});
