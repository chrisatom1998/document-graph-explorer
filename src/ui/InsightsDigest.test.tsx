// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import InsightsDigest, { _resetInsightsDigestForTests } from './InsightsDigest';

function doc(id: string, cluster: number): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster,
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

describe('InsightsDigest', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    _resetInsightsDigestForTests();
    useUiStore.setState({
      insightsOpen: false,
      insightsFocus: null,
      searchResults: null,
      highlightOwner: null,
    });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
  });

  it('does not appear on restore (idle → ready)', () => {
    useGraphStore.setState({
      phase: 'idle',
      nodes: [doc('a', 0), doc('b', 1)],
      edges: [],
      duplicatePairs: [],
    });
    render(<InsightsDigest />);
    act(() => {
      useGraphStore.setState({ phase: 'ready' });
    });
    expect(screen.queryByLabelText('What we found')).not.toBeInTheDocument();
  });

  it('appears after an ingest phase and jump links open Insights', () => {
    useGraphStore.setState({
      phase: 'connecting',
      nodes: [doc('a', 0), doc('b', 0), doc('orphan', 1)],
      nodeIndex: { a: 0, b: 1, orphan: 2 },
      edges: [edge('a', 'b')],
      duplicatePairs: [{ a: 'a', b: 'b', sim: 0.96 }],
    });
    render(<InsightsDigest />);
    act(() => {
      useGraphStore.setState({ phase: 'ready' });
    });

    expect(screen.getByLabelText('What we found')).toBeInTheDocument();
    expect(screen.getByText('2 clusters · 1 orphan · 1 near-duplicate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1 orphan' }));
    const ui = useUiStore.getState();
    expect(ui.insightsOpen).toBe(true);
    expect(ui.insightsFocus).toBe('orphans');
    expect(ui.searchResults).toEqual(['orphan']);
    expect(screen.queryByLabelText('What we found')).not.toBeInTheDocument();
  });

  it('still appears when the card mounts after ingest has already settled', () => {
    useGraphStore.setState({
      phase: 'connecting',
      nodes: [doc('a', 0), doc('b', 1)],
      edges: [],
      duplicatePairs: [],
    });
    act(() => {
      useGraphStore.setState({ phase: 'ready' });
    });
    render(<InsightsDigest />);
    expect(screen.getByLabelText('What we found')).toBeInTheDocument();
    expect(screen.getByText('2 clusters · 2 orphans · 0 near-duplicates')).toBeInTheDocument();
  });

  it('does not appear after enrichment', () => {
    useGraphStore.setState({
      phase: 'enriching',
      nodes: [doc('a', 0), doc('b', 1)],
      edges: [],
      duplicatePairs: [],
    });
    render(<InsightsDigest />);
    act(() => {
      useGraphStore.setState({ phase: 'ready' });
    });
    expect(screen.queryByLabelText('What we found')).not.toBeInTheDocument();
  });
});
