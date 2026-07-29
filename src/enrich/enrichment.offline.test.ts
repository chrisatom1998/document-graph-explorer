import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEnrichment, docAiBlockedReason } from './enrichment';
import { OFFLINE_MESSAGE } from '../offline';
import { useSettingsStore } from '../store/settingsStore';

describe('enrichment gates under the offline toggle (normal build)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().setOfflineMode(true);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setEnrichProvider('openrouter');
    useSettingsStore.getState().setOpenRouterKey('test-key');
  });
  afterEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setOpenRouterKey('');
  });

  it('runEnrichment refuses with OFFLINE_MESSAGE and never fetches, even with key+enrichment on', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await runEnrichment();
    expect(res).toEqual({ ok: false, message: OFFLINE_MESSAGE });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('docAiBlockedReason reports offline mode', () => {
    expect(docAiBlockedReason()).toBe(OFFLINE_MESSAGE);
  });
});
