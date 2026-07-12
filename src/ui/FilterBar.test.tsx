// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
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
  });
});
