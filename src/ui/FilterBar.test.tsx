// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import FilterBar from './FilterBar';

function node(id: string, kind: DocNode['kind'], fileType: DocNode['fileType']): DocNode {
  return {
    id,
    kind,
    title: id,
    fileType,
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('FilterBar', () => {
  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    useUiStore.setState({ filter: { ...DEFAULT_FILTER } });
  });

  it('counts document file types without labeling topic nodes as other files', () => {
    const nodes = [node('doc', 'document', 'txt'), node('topic', 'topic', 'other')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { doc: 0, topic: 1 },
      edges: [],
      phase: 'ready',
      clusterNames: { 0: 'Cluster' },
    });
    render(<FilterBar />);

    fireEvent.click(screen.getByTitle('Show filters'));

    expect(screen.getByRole('button', { name: /txt.*1/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /other/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cluster.*1/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /more filters/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^links$/i })).not.toBeInTheDocument();
  });

  it('toggles edge-kind and recency facets', () => {
    const nodes = [node('doc', 'document', 'txt')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { doc: 0 },
      edges: [],
      phase: 'ready',
      clusterNames: { 0: 'Cluster' },
    });
    render(<FilterBar />);
    fireEvent.click(screen.getByTitle('Show filters'));
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));

    fireEvent.click(screen.getByRole('button', { name: /^links$/i }));
    expect(useUiStore.getState().filter.edgeKinds).toEqual(['reference']);

    fireEvent.click(screen.getByRole('button', { name: /^30d$/i }));
    expect(useUiStore.getState().filter.modifiedWithinDays).toBe(30);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(useUiStore.getState().filter).toEqual(DEFAULT_FILTER);
  });

  it('keeps active filters discoverable and clearable after collapsing', () => {
    useGraphStore.setState({ nodes: [node('text', 'document', 'txt'), node('pdf', 'document', 'pdf')], edges: [] });
    render(<FilterBar />);
    fireEvent.click(screen.getByTitle('Show filters'));
    fireEvent.click(screen.getByRole('button', { name: /txt.*1/i }));
    expect(screen.getByRole('status')).toHaveTextContent('1 document matches');
    fireEvent.click(screen.getByTitle('Hide filters'));
    expect(screen.getByRole('button', { name: 'Show graph filters' })).toHaveTextContent('Filters · On');
    expect(screen.getByRole('status')).toHaveTextContent('1 document matches');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(useUiStore.getState().filter).toEqual(DEFAULT_FILTER);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains an empty result and recovers when filters are cleared', () => {
    useGraphStore.setState({ nodes: [node('text', 'document', 'txt')], edges: [] });
    useUiStore.setState({ filter: { ...DEFAULT_FILTER, minDegree: 5 } });
    render(<FilterBar />);
    fireEvent.click(screen.getByTitle('Show filters'));
    expect(screen.getByRole('status')).toHaveTextContent('0 documents match');
    expect(screen.getByText(/No documents match/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 document matches');
    expect(screen.queryByText(/No documents match/)).not.toBeInTheDocument();
  });

  it('dismisses on outside pointer presses and returns focus on Escape', () => {
    useGraphStore.setState({ nodes: [node('text', 'document', 'txt')], edges: [] });
    render(<FilterBar />);
    const toggle = screen.getByRole('button', { name: 'Show graph filters' });
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByRole('button', { name: /txt.*1/i }), { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});
