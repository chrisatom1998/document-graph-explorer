// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';

function doc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('SidePanel passage fly-to and similar docs', () => {
  beforeEach(() => {
    textStore.clear();
    textStore.set('doc1', 'The disaster recovery procedure is tested quarterly.');
    const nodes = [doc('doc1', 'Doc One')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { doc1: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.setState({
      selectedId: 'doc1',
      readerHighlight: {
        docId: 'doc1',
        text: 'disaster recovery procedure is tested quarterly',
        passageIndex: 0,
      },
      toasts: [],
    });
  });

  afterEach(() => {
    cleanup();
    textStore.clear();
    useUiStore.setState({ selectedId: null, readerHighlight: null });
  });

  it('shows the matching passage banner and highlights it in the reader', () => {
    render(<SidePanel />);
    expect(screen.getByRole('status')).toHaveTextContent(/matching passage/i);
    expect(screen.getByRole('status')).toHaveTextContent(/disaster recovery/i);
    const mark = document.querySelector('mark.passage-mark');
    expect(mark?.textContent).toMatch(/disaster recovery/i);
    expect(mark).toHaveAttribute('role', 'mark');
    expect(mark).toHaveClass('passage-mark');
  });

  it('does not mark the body for annotation-only hits that omit passageIndex', () => {
    useUiStore.setState({
      readerHighlight: {
        docId: 'doc1',
        text: 'Tags: legal-hold · disaster recovery procedure is tested quarterly',
      },
    });
    render(<SidePanel />);
    expect(screen.getByRole('status')).toHaveTextContent(/matching passage/i);
    expect(screen.getByRole('status')).toHaveTextContent(/legal-hold/i);
    expect(document.querySelector('mark.passage-mark')).toBeNull();
    expect(document.querySelector('[role="mark"]')).toBeNull();
  });

  it('keeps one cluster mark in the document chrome, not a second chip row', () => {
    useGraphStore.setState({ clusterNames: { 0: 'Disaster recovery' } });
    render(<SidePanel />);
    expect(screen.getAllByText('Disaster recovery')).toHaveLength(1);
    expect(document.querySelectorAll('.side-panel__cluster')).toHaveLength(1);
    expect(document.querySelector('.side-panel__badges')).toBeNull();
    expect(document.querySelector('.side-panel__type')).toHaveTextContent('txt');
  });

  it('offers More like this without adding toolbar chrome', () => {
    render(<SidePanel />);
    expect(screen.getByRole('button', { name: /more like this/i })).toBeInTheDocument();
  });
});
