// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const docNode: DocNode = {
  id: 'doc1',
  kind: 'document',
  title: 'Imported doc',
  fileType: 'txt',
  topics: [],
  entities: [],
  keywords: [],
  wordCount: 12,
  cluster: 0,
  degree: 0,
  status: 'ok',
  summary: 'Titles and summaries travel with the share link.',
};

describe('SidePanel imported-corpus notes hint', () => {
  beforeEach(() => {
    useCorpusStore.setState({ activeCorpusId: null, mode: 'imported' });
    useGraphStore.setState({
      nodes: [docNode],
      nodeIndex: { doc1: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.getState().setSelected('doc1');
  });

  afterEach(() => {
    cleanup();
    useCorpusStore.setState({ activeCorpusId: null, mode: 'local' });
    useUiStore.getState().setSelected(null);
  });

  it('explains missing notes after expanding About', () => {
    render(<SidePanel />);
    expect(screen.getByText(/not available on imported or shared graphs/i)).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^about$/i }));
    expect(screen.getByText(/not available on imported or shared graphs/i)).toBeVisible();
  });

  it('shows the shared summary in the reader when document text is absent', () => {
    render(<SidePanel />);
    const reader = document.querySelector('.side-panel__reader');
    expect(reader).toHaveTextContent('Titles and summaries travel with the share link.');
    expect(reader).toHaveTextContent(
      'Full document text is not included in shared or imported graphs.',
    );
    expect(screen.queryByText('text unavailable')).not.toBeInTheDocument();
  });
});
