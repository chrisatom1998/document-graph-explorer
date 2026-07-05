import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('no embed worker in test')),
}));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { textStore, chunkStore, docVectorStore } from '../store/runtimeStores';

describe('offline-toggle chat: local, no network (normal build)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().clearMessages();
    textStore.clear(); chunkStore.clear(); docVectorStore.clear();
    useSettingsStore.getState().setOfflineMode(true);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setGeminiKey('test-key'); // proves the toggle overrides an available Gemini
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Rate Limiting' } as DocNode],
    });
    textStore.set('doc1', 'Rate limiting caps requests at 100 per minute to protect the API from abuse.');
  });
  afterEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setGeminiKey('');
  });

  it('answers locally with a citation and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendChatMessage('how does rate limiting work');
    expect(fetchSpy).not.toHaveBeenCalled();
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.text.toLowerCase()).toContain('rate limiting');
    expect(last?.sources?.some((s) => s.docId === 'doc1')).toBe(true);
  });
});
