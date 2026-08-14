// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'x' }));
vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

Element.prototype.scrollIntoView = vi.fn();

describe('ChatPanel source citations', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useChatStore.getState().setIsOpen(true);
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Runbook' } as DocNode],
      nodeIndex: { doc1: 0 },
    });
    useUiStore.setState({ selectedId: null, readerHighlight: null, cameraCommand: null });
    useChatStore.getState().addMessage({
      role: 'assistant',
      text: 'The runbook covers failover.',
      sources: [{
        docId: 'doc1',
        chunkIndex: 1,
        snippet: 'failover steps for the primary region',
        score: 0.91,
      }],
    });
  });

  afterEach(cleanup);

  it('flies to the cited passage when a source chip is clicked', () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: /runbook · 2/i }));
    expect(useUiStore.getState().selectedId).toBe('doc1');
    expect(useUiStore.getState().readerHighlight).toEqual({
      docId: 'doc1',
      text: 'failover steps for the primary region',
      passageIndex: 1,
    });
    expect(useUiStore.getState().cameraCommand?.kind).toBe('frameNode');
  });
});
