// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../persistence/exportImport', () => ({
  exportGraphJSON: vi.fn(() => Promise.resolve()),
}));

import AppErrorBoundary from './AppErrorBoundary';
import { exportGraphJSON } from '../persistence/exportImport';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const mockExportGraphJSON = vi.mocked(exportGraphJSON);

function Thrower(): never {
  throw new Error('render exploded');
}

function docNode(): DocNode {
  return {
    id: 'doc1',
    kind: 'document',
    title: 'Doc One',
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('AppErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    useGraphStore.getState().reset();
    useUiStore.setState({ lastError: null, toasts: [] });
    mockExportGraphJSON.mockClear();
  });

  afterEach(() => {
    consoleError.mockRestore();
    cleanup();
  });

  it('renders a fallback and records render errors locally', async () => {
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/stopped rendering/i);
    expect(screen.getByText('render exploded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export your graph/i })).toBeDisabled();
    await waitFor(() =>
      expect(useUiStore.getState().lastError?.message).toBe('render exploded'),
    );
  });

  it('can export the current graph from the fallback', () => {
    useGraphStore.setState({
      nodes: [docNode()],
      nodeIndex: { doc1: 0 },
    });

    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );

    const exportButton = screen.getByRole('button', { name: /export your graph/i });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);

    expect(mockExportGraphJSON).toHaveBeenCalledTimes(1);
  });
});
