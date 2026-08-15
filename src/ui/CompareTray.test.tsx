// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import CompareTray from './CompareTray';

function doc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'md',
    topics: ['alpha'],
    entities: ['Northwind'],
    keywords: [],
    wordCount: 12,
    cluster: 0,
    degree: 1,
    status: 'ok',
    summary: `${title} summary`,
  };
}

describe('CompareTray', () => {
  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    useUiStore.getState().clearCompare();
  });

  it('compares pinned documents and can unpin them', () => {
    const nodes = [doc('a', 'Alpha'), doc('b', 'Beta')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { a: 0, b: 1 },
      edges: [
        { id: 'a-b', source: 'a', target: 'b', kind: 'semantic', weight: 0.9, evidence: ['shared topic'] },
      ],
      clusterNames: { 0: 'Ops' },
    });
    useUiStore.setState({ compareIds: ['a', 'b'] });

    render(<CompareTray />);
    expect(screen.getByRole('region', { name: 'Pinned document comparison' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Alpha summary')).toBeInTheDocument();
    expect(screen.getAllByText('Northwind').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from comparison' }));
    expect(useUiStore.getState().compareIds).toEqual(['b']);
  });
});
