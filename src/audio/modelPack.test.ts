// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeAudioModelPack, formatAudioPackSize } from './modelPack';

describe('audio model pack authorization', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows the exact pack size before allowing the first same-origin fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      schema: 1,
      capability: 'audio',
      revision: 'audio-v1',
      bytes: 632_123_456,
    }), { status: 200 }))));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await expect(authorizeAudioModelPack()).resolves.toBe('ready');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('632.1 MB (632,123,456 bytes)'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("this app's own origin"));

    await expect(authorizeAudioModelPack()).resolves.toBe('ready');
    expect(confirm).toHaveBeenCalledTimes(1);
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

  it('does not remember declined downloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schema: 1,
      capability: 'audio',
      revision: 'audio-v2',
      bytes: 10,
    }), { status: 200 })));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(authorizeAudioModelPack()).resolves.toBe('declined');
    expect(localStorage.length).toBe(0);
  });
});

describe('formatAudioPackSize', () => {
  it('keeps the exact byte count alongside the readable size', () => {
    expect(formatAudioPackSize(1_234_567)).toBe('1.2 MB (1,234,567 bytes)');
  });
});
