// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';

// Airgap build → chat is in local/offline mode.
vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'x' }));
// Keep ChatPanel's transitive coordinator/pdfjs import chain out of jsdom.
vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';

// jsdom has no layout engine and doesn't implement scrollIntoView; ChatPanel
// calls it in an auto-scroll effect that fires on every message-list update.
Element.prototype.scrollIntoView = vi.fn();

describe('ChatPanel (airgap)', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useChatStore.getState().setIsOpen(true);
    useGraphStore.setState({ nodes: [{ id: 'doc1', kind: 'document', title: 'Doc' } as DocNode] });
  });

  it('shows the offline-mode hint when opened in an airgap build', () => {
    render(<ChatPanel />);
    expect(screen.getByText(/offline mode/i)).toBeInTheDocument();
  });

  it('lets the user switch chat to all documents', () => {
    useSettingsStore.getState().setChatScope('relevant');
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'All documents' }));
    expect(useSettingsStore.getState().chatScope).toBe('all');
    expect(screen.getByRole('button', { name: 'All documents' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    useSettingsStore.getState().setChatScope('relevant');
  });
});
