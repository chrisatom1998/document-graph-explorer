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
    const mark = screen.getByRole('mark');
    expect(mark).toHaveClass('passage-mark');
    expect(mark.textContent).toMatch(/disaster recovery/i);
  });

  it('does not mark the body for annotation-only hits', () => {
    textStore.set('doc1', 'The disaster recovery procedure is tested quarterly.');
    useUiStore.setState({
      readerHighlight: {
        docId: 'doc1',
        text: 'Tags: legal-hold',
      },
    });
    render(<SidePanel />);
    expect(screen.getByRole('status')).toHaveTextContent(/matching passage/i);
    expect(screen.getByRole('status')).toHaveTextContent(/legal-hold/i);
    expect(screen.queryByRole('mark')).toBeNull();
    expect(document.querySelector('mark.passage-mark')).toBeNull();
    expect(screen.getByText(/disaster recovery procedure is tested quarterly/i)).toBeInTheDocument();
  });

  it('shows type and cluster once in document chrome', () => {
    useGraphStore.setState({ clusterNames: { 0: 'Incident response' } });
    useUiStore.setState({ readerHighlight: null });
    render(<SidePanel />);
    expect(screen.getByText('txt')).toBeInTheDocument();
    expect(screen.getAllByText('Incident response')).toHaveLength(1);
    expect(document.querySelector('.side-panel__kicker')).toBeTruthy();
    expect(document.querySelector('.side-panel__badges')).toBeNull();
    expect(screen.getByText(/0 connections/i)).toBeInTheDocument();
  });

  it('offers More like this without adding toolbar chrome', () => {
    render(<SidePanel />);
    expect(screen.getByRole('button', { name: /more like this/i })).toBeInTheDocument();
  });
});
