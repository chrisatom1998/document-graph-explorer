// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode, Edge } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

function doc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'txt',
    topics: ['auth'],
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 1,
    status: 'ok',
  };
}

const hub: DocNode = {
  id: 'topic:auth',
  kind: 'topic',
  title: 'auth',
  fileType: 'other',
  topics: ['auth'],
  entities: [],
  keywords: [],
  wordCount: 0,
  cluster: 0,
  degree: 2,
  status: 'ok',
};

const members = [doc('doc-a', 'Login flow'), doc('doc-b', 'Session tokens')];
const edges: Edge[] = members.map((n) => ({
  id: `${n.id}->${hub.id}:topic`,
  source: n.id,
  target: hub.id,
  kind: 'topic',
  weight: 0.5,
  evidence: ['Shared topic: "auth"'],
}));

describe('SidePanel topic hub', () => {
  beforeEach(() => {
    const nodes = [hub, ...members];
    useGraphStore.setState({
      nodes,
      nodeIndex: Object.fromEntries(nodes.map((n, i) => [n.id, i])),
      edges,
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.getState().setSelected(hub.id);
  });

  afterEach(() => {
    cleanup();
    useUiStore.getState().setSelected(null);
  });

  it('lists member documents and hides document-only chrome', () => {
    render(<SidePanel />);

    expect(screen.getByRole('dialog', { name: /auth \(topic hub, 2 documents\)/i })).toBeInTheDocument();
    expect(screen.getAllByText('Topic hub').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Login flow')).toBeInTheDocument();
    expect(screen.getByText('Session tokens')).toBeInTheDocument();
    expect(screen.queryByText(/text unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^open$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more like this/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/remove this document from the graph/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Notes & Tags')).not.toBeInTheDocument();
    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument();
  });
});
