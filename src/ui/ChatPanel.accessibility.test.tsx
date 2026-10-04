// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';

describe('Chat accessibility during generation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    useChatStore.setState({ messages: [], isOpen: true, isStreaming: false });
    useGraphStore.setState({ nodes: [{ id: 'doc1', kind: 'document', title: 'Doc' } as DocNode] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps focus in a modal opened while an answer streams', () => {
    render(<><ChatPanel /><div role="dialog" aria-modal="true" aria-label="Settings"><button>Close settings</button></div></>);
    act(() => { vi.runAllTimers(); });
    act(() => { useChatStore.getState().setIsStreaming(true); });
    const modalButton = screen.getByRole('button', { name: 'Close settings' });
    modalButton.focus();
    act(() => { useChatStore.getState().setIsStreaming(false); });
    act(() => { vi.runAllTimers(); });
    expect(modalButton).toHaveFocus();
  });

  it('announces start and completion without changing the live region for each token', () => {
    render(<ChatPanel />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    let messageId = '';
    act(() => {
      useChatStore.getState().setIsStreaming(true);
      messageId = useChatStore.getState().addMessage({ role: 'assistant', text: '' });
    });
    expect(status).toHaveTextContent('Generating answer…');
    expect(status).toHaveAttribute('aria-live', 'polite');
    act(() => { useChatStore.getState().updateMessage(messageId, { text: 'First token' }); });
    expect(status).toHaveTextContent('Generating answer…');
    act(() => { useChatStore.getState().updateMessage(messageId, { text: 'The complete answer.' }); });
    expect(status).toHaveTextContent('Generating answer…');
    act(() => { useChatStore.getState().setIsStreaming(false); });
    expect(status).toHaveTextContent('Response finished. Read the conversation above.');
    expect(screen.getByText('The complete answer.')).toBeInTheDocument();
    act(() => { useChatStore.getState().clearMessages(); });
    expect(status).toBeEmptyDOMElement();
  });
});
