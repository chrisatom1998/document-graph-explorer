// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';

describe('ChatPanel offline toggle (normal build)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useChatStore.getState().clearMessages();
    useChatStore.getState().setIsOpen(true);
    useGraphStore.setState({ nodes: [{ id: 'doc1', kind: 'document', title: 'Doc' } as DocNode] });
    // Gemini otherwise available — the toggle alone must force local mode.
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setGeminiKey('test-key');
    useSettingsStore.getState().setOfflineMode(true);
  });
  afterEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setGeminiKey('');
  });

  it('shows the offline hint when the toggle is on', () => {
    render(<ChatPanel />);
    expect(screen.getByText(/offline mode/i)).toBeInTheDocument();
  });
});
