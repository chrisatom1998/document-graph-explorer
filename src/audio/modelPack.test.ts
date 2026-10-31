// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeAudioModelPack, formatAudioPackSize } from './modelPack';

describe('audio model pack authorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is ready when the valid same-origin pack marker is present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      schema: 1,
      capability: 'audio',
      revision: 'audio-v1',
      bytes: 632_123_456,
    }), { status: 200 }))));
    const confirm = vi.spyOn(window, 'confirm');

    await expect(authorizeAudioModelPack()).resolves.toBe('ready');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('explains how to install audio models when the build cannot serve them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, 'confirm');

    await expect(authorizeAudioModelPack()).resolves.toBe('unavailable');
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('npm run models:audio'));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('npm run build:airgap'));
    expect(confirm).not.toHaveBeenCalled();
  });

});

describe('formatAudioPackSize', () => {
  it('keeps the exact byte count alongside the readable size', () => {
    expect(formatAudioPackSize(1_234_567)).toBe('1.2 MB (1,234,567 bytes)');
  });
});
