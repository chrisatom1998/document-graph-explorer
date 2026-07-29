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
    useSettingsStore.getState().setOpenRouterKey('test-openrouter-key');
    useGraphStore.setState({
      nodes: [{ id: 'rate-doc', kind: 'document', title: 'Rate Limits' } as DocNode],
    });
    textStore.set('rate-doc', 'API rate limits cap requests at 100 per minute.');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().setChatProvider('local');
    useSettingsStore.getState().setOpenRouterKey('');
  });

  it('gives local and OpenRouter generation the same ranked citation', async () => {
    useSettingsStore.getState().setChatProvider('local');
    await sendChatMessage('What are the API rate limits?');
    const localSources = useChatStore.getState().messages.at(-1)?.sources;

    useChatStore.getState().clearMessages();
    useSettingsStore.getState().setChatProvider('openrouter');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"100 per minute [Source 1]."},"finish_reason":"stop"}]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    await sendChatMessage('What are the API rate limits?');
    const openRouterSources = useChatStore.getState().messages.at(-1)?.sources;

    expect(localSources?.map((source) => [source.docId, source.chunkIndex]))
      .toEqual(openRouterSources?.map((source) => [source.docId, source.chunkIndex]));
    expect(openRouterSources?.[0].docId).toBe('rate-doc');
  });
});
