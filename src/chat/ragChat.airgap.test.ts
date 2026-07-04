import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG' }));

// ragChat -> pipeline/coordinator -> parsers/pdf statically imports
// pdfjs-dist, which reaches for the browser-only DOMMatrix global at module
// load time. Vitest's node environment has no DOM, so the bare import
// throws before this file's tests can even run. The AIRGAP-gated path under
// test returns before parsePdf is ever called, so stubbing the module here
// only unblocks module resolution — it doesn't touch the behavior asserted
// below. Pre-existing repo/environment gap, not introduced by this task.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';

describe('chat gate under airgap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().clearMessages();
  });

  it('sendChatMessage refuses via an AIRGAP system message, without ever calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendChatMessage('hello');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The last message must be the AIRGAP refusal, not the default
    // enrichment-disabled notice — this is what uniquely proves the AIRGAP
    // guard fired (both paths block fetch, but only this one emits AIRGAP_MESSAGE).
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.role).toBe('system');
    expect(last?.text).toBe('AIRGAP_TEST_MSG');
  });
});
