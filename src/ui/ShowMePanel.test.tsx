// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../search/semanticSearch', () => ({
  searchCorpus: vi.fn(),
  searchCorpusLexical: vi.fn(),
}));

import { searchCorpus, searchCorpusLexical } from '../search/semanticSearch';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import ShowMePanel from './ShowMePanel';

const mockSearchCorpus = vi.mocked(searchCorpus);
const mockSearchCorpusLexical = vi.mocked(searchCorpusLexical);

describe('ShowMePanel', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useUiStore.setState({
      showMeOpen: true,
      searchResults: null,
      highlightOwner: null,
      cameraCommand: null,
    });
    mockSearchCorpus.mockReset();
    mockSearchCorpusLexical.mockReset();
  });

  afterEach(cleanup);

  it('does not highlight or move the camera when a response lands after close', async () => {
    let resolveLexical!: (hits: Awaited<ReturnType<typeof searchCorpusLexical>>) => void;
    mockSearchCorpusLexical.mockReturnValue(
      new Promise((resolve) => {
        resolveLexical = resolve;
      }),
    );
    mockSearchCorpus.mockResolvedValue([]);

    render(<ShowMePanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'architecture' } });
    fireEvent.click(screen.getByRole('button', { name: /^show me$/i }));
    await waitFor(() => expect(mockSearchCorpusLexical).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /close topic highlighter/i }));

    resolveLexical([{ id: 'doc', score: 1, matchKind: 'title' }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(useUiStore.getState().searchResults).toBeNull();
    expect(useUiStore.getState().cameraCommand).toBeNull();
  });

  it('invalidates an in-flight response when the topic field is cleared', async () => {
    let resolveLexical!: (hits: Awaited<ReturnType<typeof searchCorpusLexical>>) => void;
    mockSearchCorpusLexical.mockReturnValue(
      new Promise((resolve) => {
        resolveLexical = resolve;
      }),
    );
    mockSearchCorpus.mockResolvedValue([]);

    render(<ShowMePanel />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'architecture' } });
    fireEvent.click(screen.getByRole('button', { name: /^show me$/i }));
    await waitFor(() => expect(mockSearchCorpusLexical).toHaveBeenCalled());
    fireEvent.change(input, { target: { value: '' } });

    resolveLexical([{ id: 'doc', score: 1, matchKind: 'title' }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(useUiStore.getState().searchResults).toBeNull();
    expect(useUiStore.getState().cameraCommand).toBeNull();
    expect(screen.queryByText(/highlighted/i)).not.toBeInTheDocument();
  });
});
