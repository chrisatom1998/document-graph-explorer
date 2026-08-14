// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../airgap', () => ({ AIRGAP: false, AIRGAP_MESSAGE: 'x' }));
vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

Element.prototype.scrollIntoView = vi.fn();

function doc(id: string, title: string, cluster: number): DocNode {
  return {
    id,
    kind: 'document',
    title,
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

describe('ChatPanel corpus starters', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useChatStore.getState().setIsOpen(true);
    useGraphStore.getState().reset();
    useUiStore.setState({ pathEndpoints: [] });
  });

  afterEach(() => {
    cleanup();
    useChatStore.getState().clearMessages();
    useGraphStore.getState().reset();
  });

  it('seeds the input from an orphan starter', () => {
    useGraphStore.setState({
      nodes: [doc('a', 'Alpha', 0), doc('b', 'Beta', 0), doc('lonely', 'Lonely', 1)],
      nodeIndex: { a: 0, b: 1, lonely: 2 },
      edges: [
        {
          id: 'a->b',
          source: 'a',
          target: 'b',
          kind: 'semantic',
          weight: 0.7,
          evidence: [],
        },
      ],
      clusterNames: { 0: 'Core' },
      localClusterNames: {},
    });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Why is this orphan isolated?' }));
    expect(screen.getByLabelText('Ask a question about your documents')).toHaveValue(
      expect.stringContaining('orphaned document'),
    );
  });
});
