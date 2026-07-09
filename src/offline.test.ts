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

  describe('navigator.sendBeacon guard', () => {
    const realSendBeacon = navigator.sendBeacon;
    afterEach(() => {
      navigator.sendBeacon = realSendBeacon;
    });

    it('blocks cross-origin sendBeacon while offline, returning false', () => {
      const inner = vi.fn().mockReturnValue(true);
      navigator.sendBeacon = inner;
      installOfflineFetchGuard();
      useSettingsStore.getState().setOfflineMode(true);
      expect(navigator.sendBeacon('https://evil.example/collect', 'x')).toBe(false);
      expect(inner).not.toHaveBeenCalled();
    });

    it('passes same-origin sendBeacon through while offline', () => {
      const inner = vi.fn().mockReturnValue(true);
      navigator.sendBeacon = inner;
      installOfflineFetchGuard();
      useSettingsStore.getState().setOfflineMode(true);
      expect(navigator.sendBeacon('/collect', 'x')).toBe(true);
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('passes sendBeacon through untouched when offline mode is off', () => {
      const inner = vi.fn().mockReturnValue(true);
      navigator.sendBeacon = inner;
      installOfflineFetchGuard();
      expect(navigator.sendBeacon('https://example.com/collect', 'x')).toBe(true);
      expect(inner).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebSocket guard', () => {
    const RealWebSocket = globalThis.WebSocket;
    class MockWebSocket {
      url: string;
      constructor(url: string | URL) {
        this.url = String(url);
      }
    }
    afterEach(() => {
      globalThis.WebSocket = RealWebSocket;
    });

    it('blocks a cross-origin WebSocket connection while offline', () => {
      globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
      installOfflineFetchGuard();
      useSettingsStore.getState().setOfflineMode(true);
      expect(() => new WebSocket('wss://evil.example/socket')).toThrow(/offline mode/i);
    });

    it('constructs a same-origin WebSocket while offline', () => {
      globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
      installOfflineFetchGuard();
      useSettingsStore.getState().setOfflineMode(true);
      const ws = new WebSocket('/socket');
      expect(ws).toBeInstanceOf(MockWebSocket);
    });

    it('constructs any WebSocket untouched when offline mode is off', () => {
      globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
      installOfflineFetchGuard();
      const ws = new WebSocket('wss://example.com/socket');
      expect(ws).toBeInstanceOf(MockWebSocket);
    });
  });
});
