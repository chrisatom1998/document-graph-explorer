import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG' }));
// Fully mock the coordinator so its pdfjs import chain never loads and the query
// embed deterministically rejects — routing retrieveChunks through its local
// keywordFallback (substring/token match over textStore), which needs no worker.
vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('no embed worker in test')),
}));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { textStore, chunkStore, docVectorStore } from '../store/runtimeStores';

describe('airgap chat: local, no network', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().clearMessages();
    textStore.clear();
    chunkStore.clear();
    docVectorStore.clear();
    // Minimal document node — retrieveChunks reads id+title; docCount reads kind.
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Rate Limiting' } as DocNode],
    });
    textStore.set('doc1', 'Rate limiting caps requests at 100 per minute to protect the API from abuse.');
  });

  it('answers from local documents with a citation and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendChatMessage('how does rate limiting work');

    expect(fetchSpy).not.toHaveBeenCalled();
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.text).not.toBe('AIRGAP_TEST_MSG'); // no longer a refusal
    expect(last?.text.toLowerCase()).toContain('rate limiting'); // quotes the passage
    expect(last?.sources?.some((s) => s.docId === 'doc1')).toBe(true); // cited
  });
});
