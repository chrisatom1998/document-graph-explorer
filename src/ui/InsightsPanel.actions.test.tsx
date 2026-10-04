// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode, Edge } from '../model/types';

vi.mock('../pipeline/insightsClient', () => ({
  requestInsights: vi.fn().mockResolvedValue({ bridges: [], hubs: [], clusterStats: [] }),
}));
vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: vi.fn().mockResolvedValue({ annotations: {} }),
  updateCorpusAnnotations: vi.fn().mockResolvedValue(undefined),
}));

import { _resetAnnotationsForTests, useAnnotationStore } from '../store/annotationStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import InsightsPanel from './InsightsPanel';

function doc(id: string, title = id): DocNode {
  return {
    id,
    kind: 'document',
    title,
    path: `${id}.md`,
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

function edge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    kind: 'semantic',
    weight: 0.7,
    evidence: [],
  };
}

describe('InsightsPanel actions', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useUiStore.setState({
      insightsOpen: true,
      insightsFocus: null,
      searchResults: null,
      highlightOwner: null,
      compareLeftId: null,
      compareRightId: null,
      comparePick: null,
    });
    useCorpusStore.setState({ activeCorpusId: 'c1', mode: 'local' });
    useAnnotationStore.getState().hydrate('c1', {});
  });

  afterEach(() => {
    cleanup();
    _resetAnnotationsForTests();
    useGraphStore.getState().reset();
    useCorpusStore.setState({ activeCorpusId: null, mode: 'local' });
    useUiStore.getState().clearCompare();
  });

  it('lets a duplicate pair be framed and tagged', () => {
    const nodes = [doc('a', 'Alpha'), doc('b', 'Beta')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { a: 0, b: 1 },
      edges: [edge('a', 'b')],
      duplicatePairs: [{ a: 'a', b: 'b', sim: 0.97 }],
      phase: 'ready',
    });

    render(<InsightsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show both' }));
    expect(useUiStore.getState().searchResults).toEqual(['a', 'b']);
    expect(useUiStore.getState().highlightOwner).toBe('insights');

    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(useUiStore.getState().compareLeftId).toBe('a');
    expect(useUiStore.getState().compareRightId).toBe('b');
    expect(useUiStore.getState().highlightOwner).toBe('compare');

    fireEvent.click(screen.getByRole('button', { name: 'Tag both duplicate' }));
    expect(useAnnotationStore.getState().annotations['a.md']?.tags).toEqual(['duplicate']);
    expect(useAnnotationStore.getState().annotations['b.md']?.tags).toEqual(['duplicate']);
    expect(screen.getByRole('button', { name: 'Tagged duplicate' })).toBeDisabled();
  });

  it('shows the closest unlinked neighbor for an orphan', () => {
    const nodes = [doc('lonely', 'Lonely'), doc('cousin', 'Cousin')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { lonely: 0, cousin: 1 },
      edges: [],
      duplicatePairs: [],
      semanticNeighbors: [
        { id: 'lonely', neighborId: 'cousin', sim: 0.6 },
        { id: 'cousin', neighborId: 'lonely', sim: 0.6 },
      ],
      phase: 'ready',
    });

    render(<InsightsPanel />);
    expect(screen.getByText('Lonely')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not connected, but 60% similar to Cousin/ })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Show both' })[0]);
    expect(useUiStore.getState().searchResults).toEqual(['lonely', 'cousin']);
  });
});
