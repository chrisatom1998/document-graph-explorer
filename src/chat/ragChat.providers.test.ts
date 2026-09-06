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

  it.each(['openrouter', 'ollama'] as const)(
    'preserves a partial %s answer and citations when the stream reports an error',
    async (provider) => {
      useSettingsStore.getState().setChatProvider(provider);
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        'data: {"choices":[{"delta":{"content":"100 per minute [Source 1]."}}]}\n\n' +
        'data: {"error":{"message":"generation failed"}}\n\ndata: [DONE]\n\n',
      ));

      await sendChatMessage('What are the API rate limits?');

      const answer = useChatStore.getState().messages.at(-1);
      expect(answer?.text).toContain('100 per minute [Source 1].');
      expect(answer?.text).toContain('Response interrupted:');
      expect(answer?.text).toContain('generation failed');
      expect(answer?.isError).toBe(true);
      expect(answer?.sources?.[0].docId).toBe('rate-doc');
      expect(useChatStore.getState().isStreaming).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
