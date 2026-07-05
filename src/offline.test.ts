import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isOffline, installOfflineFetchGuard, OFFLINE_MESSAGE } from './offline';
import { useSettingsStore } from './store/settingsStore';

describe('offline module', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => useSettingsStore.getState().setOfflineMode(false));
  afterEach(() => {
    globalThis.fetch = realFetch;
    useSettingsStore.getState().setOfflineMode(false);
  });

  it('isOffline follows the toggle (AIRGAP is false in tests)', () => {
    expect(isOffline()).toBe(false);
    useSettingsStore.getState().setOfflineMode(true);
    expect(isOffline()).toBe(true);
  });

  it('OFFLINE_MESSAGE names offline mode, not the airgap build', () => {
    expect(OFFLINE_MESSAGE).toMatch(/offline mode/i);
    expect(OFFLINE_MESSAGE).not.toMatch(/air-?gap/i);
  });

  it('guard blocks cross-origin fetches while offline, without calling through', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    useSettingsStore.getState().setOfflineMode(true);
    await expect(fetch('https://example.com/x')).rejects.toThrow(/offline mode/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it('guard passes same-origin and passes everything when offline is off', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    await fetch('/demo/manifest.json'); // relative → same-origin, offline off
    useSettingsStore.getState().setOfflineMode(true);
    await fetch('/models/x.onnx'); // same-origin while offline
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('guard blocks protocol-relative URLs while offline', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    useSettingsStore.getState().setOfflineMode(true);
    await expect(fetch('//evil.example/x')).rejects.toThrow(/offline mode/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it('guard blocks lookalike-origin URLs (startsWith spoof) while offline', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    useSettingsStore.getState().setOfflineMode(true);
    // In node the base origin is http://localhost — a lookalike host prefixed with it must still block.
    await expect(fetch('http://localhost.evil.example/x')).rejects.toThrow(/offline mode/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it('guard blocks whitespace-prefixed external URLs while offline', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    useSettingsStore.getState().setOfflineMode(true);
    await expect(fetch('  https://evil.example/x')).rejects.toThrow(/offline mode/i);
    expect(inner).not.toHaveBeenCalled();
  });
});
