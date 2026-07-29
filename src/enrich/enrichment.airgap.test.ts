import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the airgap gate on for this file only.
vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG' }));

import { runEnrichment, docAiBlockedReason } from './gemini';

describe('gemini AI gates under airgap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('runEnrichment refuses without ever calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await runEnrichment();
    expect(res.ok).toBe(false);
    expect(res.message).toBe('AIRGAP_TEST_MSG');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('docAiBlockedReason reports the air-gapped state', () => {
    expect(docAiBlockedReason()).toBe('AIRGAP_TEST_MSG');
  });
});
