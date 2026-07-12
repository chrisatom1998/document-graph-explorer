import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('force shared lexical retrieval')),
}));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { chunkStore, docVectorStore, textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';

describe('provider-independent RAG evidence', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    textStore.clear();
    chunkStore.clear();
    docVectorStore.clear();
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setGeminiKey('test-gemini-key');
    useGraphStore.setState({
      nodes: [{ id: 'rate-doc', kind: 'document', title: 'Rate Limits' } as DocNode],
    });
    textStore.set('rate-doc', 'API rate limits cap requests at 100 per minute.');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().setChatProvider('local');
    useSettingsStore.getState().setGeminiKey('');
  });

  it('gives local and Gemini generation the same ranked citation', async () => {
    useSettingsStore.getState().setChatProvider('local');
    await sendChatMessage('What are the API rate limits?');
    const localSources = useChatStore.getState().messages.at(-1)?.sources;

    useChatStore.getState().clearMessages();
    useSettingsStore.getState().setChatProvider('gemini');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"100 per minute [Source 1]."}]},"finishReason":"STOP"}]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    await sendChatMessage('What are the API rate limits?');
    const geminiSources = useChatStore.getState().messages.at(-1)?.sources;

    expect(localSources?.map((source) => [source.docId, source.chunkIndex]))
      .toEqual(geminiSources?.map((source) => [source.docId, source.chunkIndex]));
    expect(geminiSources?.[0].docId).toBe('rate-doc');
  });
});
