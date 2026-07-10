import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('no embed worker in test')),
}));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { chunkStore, docVectorStore, textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';

describe('OpenRouter RAG chat', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    textStore.clear();
    chunkStore.clear();
    docVectorStore.clear();
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setChatProvider('openrouter');
    useSettingsStore.getState().setOpenRouterKey('test-openrouter-key');
    useSettingsStore.getState().setOpenRouterModel('anthropic/claude-sonnet-5');
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Rate Limits' } as DocNode],
    });
    textStore.set('doc1', 'Rate limits cap requests at 100 per minute.');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().setChatProvider('local');
    useSettingsStore.getState().setOpenRouterKey('');
  });

  it('streams a cited answer through the selected model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"The limit is 100 per minute [Source 1]."}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );

    await sendChatMessage('what are the rate limits');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-openrouter-key',
    );
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('anthropic/claude-sonnet-5');
    expect(body.stream).toBe(true);
    const answer = useChatStore.getState().messages.at(-1);
    expect(answer?.text).toContain('100 per minute [Source 1]');
    expect(answer?.sources?.[0].docId).toBe('doc1');
  });
});
