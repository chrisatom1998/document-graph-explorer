// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { textStore } from '../store/runtimeStores';

function codeDoc(overrides: Partial<DocNode> = {}): DocNode {
  return {
    id: 'session',
    kind: 'document',
    title: 'Session',
    fileType: 'code',
    path: 'src/auth/session.ts',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 40,
    cluster: 0,
    degree: 1,
    status: 'ok',
    ...overrides,
  };
}

describe('SidePanel code language labels', () => {
  beforeEach(() => {
    const node = codeDoc();
    textStore.set(node.id, 'export function loadSession() {}\n');
    useGraphStore.setState({
      nodes: [node],
      nodeIndex: { [node.id]: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.getState().setSelected(node.id);
  });

  afterEach(() => {
    cleanup();
    textStore.clear();
    useUiStore.getState().setSelected(null);
  });

  it('shows the language on the document name, type chip, and reader card', () => {
    render(<SidePanel />);

    expect(screen.getByRole('dialog', { name: 'Session (TypeScript)' })).toBeInTheDocument();
    expect(screen.getAllByText('ts').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.queryByText(/^code$/)).not.toBeInTheDocument();
  });

  it('labels a Python file as py / Python', () => {
    const node = codeDoc({
      id: 'train',
      title: 'Train',
      path: 'models/train.py',
    });
    textStore.set(node.id, 'def fit():\n    pass\n');
    useGraphStore.setState({
      nodes: [node],
      nodeIndex: { [node.id]: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.getState().setSelected(node.id);

    render(<SidePanel />);

    expect(screen.getByRole('dialog', { name: 'Train (Python)' })).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getAllByText('py').length).toBeGreaterThanOrEqual(1);
  });
});
