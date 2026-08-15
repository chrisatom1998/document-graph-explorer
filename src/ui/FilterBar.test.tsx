// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('Clear wins over a pending slider commit', async () => {
    const nodes = [node('doc', 'document', 'txt')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { doc: 0 },
      edges: [],
      phase: 'ready',
      clusterNames: { 0: 'Cluster' },
    });
    // Another facet keeps Clear visible while the degree slider is still at
    // the store default — the rAF has not committed the drag yet.
    useUiStore.setState({ filter: { ...DEFAULT_FILTER, fileTypes: ['txt'] } });
    render(<FilterBar />);
    fireEvent.click(screen.getByTitle('Show filters'));
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));

    fireEvent.change(screen.getByLabelText('Minimum document connections'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Minimum link strength'), {
      target: { value: '0.4' },
    });
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(useUiStore.getState().filter).toEqual(DEFAULT_FILTER);
  });

  it('an external setFilter wins over a pending slider commit', async () => {
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

    fireEvent.change(screen.getByLabelText('Minimum document connections'), {
      target: { value: '8' },
    });
    act(() => {
      useUiStore.getState().setFilter({ minDegree: 2 });
    });

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(useUiStore.getState().filter.minDegree).toBe(2);
    expect(screen.getByLabelText('Minimum document connections')).toHaveValue('2');
  });
});
