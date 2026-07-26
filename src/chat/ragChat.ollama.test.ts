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

describe('Ollama RAG chat', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    textStore.clear();
    chunkStore.clear();
    docVectorStore.clear();
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setChatProvider('ollama');
    useSettingsStore.getState().setOllamaModel('llama3.2');
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Rate Limits' } as DocNode],
    });
    textStore.set('doc1', 'Rate limits cap requests at 100 per minute.');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().setChatProvider('local');
  });

  it('streams a cited answer through the local server without any API key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"The limit is 100 per minute [Source 1]."}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );

    await sendChatMessage('what are the rate limits');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('llama3.2');
    expect(body.stream).toBe(true);
    const answer = useChatStore.getState().messages.at(-1);
    expect(answer?.text).toContain('100 per minute [Source 1]');
    expect(answer?.sources?.[0].docId).toBe('doc1');
  });

  it('reports an unreachable server with a fix-it message instead of "Failed to fetch"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await sendChatMessage('what are the rate limits');

    const answer = useChatStore.getState().messages.at(-1);
    expect(answer?.isError).toBe(true);
    expect(answer?.text).toContain('Is Ollama installed and running?');
  });

  it('falls back to local extraction while offline mode is on', async () => {
    useSettingsStore.getState().setOfflineMode(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await sendChatMessage('what are the rate limits');

    expect(fetchSpy).not.toHaveBeenCalled();
    const answer = useChatStore.getState().messages.at(-1);
    expect(answer?.sources?.[0].docId).toBe('doc1');
    useSettingsStore.getState().setOfflineMode(false);
  });

  it('names a missing model and how to pull it on a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'model "llama3.2" not found' } }), {
        status: 404,
      }),
    );

    await sendChatMessage('what are the rate limits');

    const answer = useChatStore.getState().messages.at(-1);
    expect(answer?.isError).toBe(true);
    expect(answer?.text).toContain('ollama pull llama3.2');
  });
});
