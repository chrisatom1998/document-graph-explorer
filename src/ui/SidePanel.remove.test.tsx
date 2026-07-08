// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { DocNode } from '../model/types';

// SidePanel imports `removeDocuments` from the coordinator, which pulls in
// the worker pool / pdf parser / etc. — keep that heavy chain out of jsdom,
// mirroring ChatPanel.test.tsx's established mock seam for this module.
// (vi.mock factories are hoisted above imports, so the mock fn is created
// inline here and read back via the mocked module namespace below.)
vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { removeDocuments } from '../pipeline/coordinator';

const mockRemoveDocuments = vi.mocked(removeDocuments);

const docNode: DocNode = {
  id: 'doc1',
  kind: 'document',
  title: 'Doc One',
  fileType: 'txt',
  topics: [],
  entities: [],
  keywords: [],
  wordCount: 100,
  cluster: 0,
  degree: 0,
  status: 'ok',
};

describe('SidePanel document removal', () => {
  beforeEach(() => {
    mockRemoveDocuments.mockClear();
    useGraphStore.setState({
      nodes: [docNode],
      nodeIndex: { doc1: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.getState().setSelected('doc1');
  });

  // No global test-setup registers this: without it, each test's rendered
  // tree stays mounted in document.body and the next render's queries see
  // both (e.g. two "Remove" buttons).
  afterEach(() => {
    cleanup();
  });

  it('arms a confirm on first click, then removes the document on confirm', () => {
    render(<SidePanel />);

    fireEvent.click(screen.getByTitle(/remove this document from the graph/i));

    expect(screen.getByText(/remove from graph\?/i)).toBeInTheDocument();
    expect(mockRemoveDocuments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(mockRemoveDocuments).toHaveBeenCalledTimes(1);
    expect(mockRemoveDocuments).toHaveBeenCalledWith(['doc1']);
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('cancel disarms the confirm without removing anything', () => {
    render(<SidePanel />);

    fireEvent.click(screen.getByTitle(/remove this document from the graph/i));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockRemoveDocuments).not.toHaveBeenCalled();
    expect(screen.getByTitle(/remove this document from the graph/i)).toBeInTheDocument();
  });
});
