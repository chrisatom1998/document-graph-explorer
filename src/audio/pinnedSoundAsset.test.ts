import { afterEach, expect, it, vi } from 'vitest';
import { loadPinnedSoundAsset } from './pinnedSoundAsset';

afterEach(() => vi.unstubAllGlobals());
const bytes = JSON.stringify({ heads: [] });
const hash = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes))), b => b.toString(16).padStart(2, '0')).join('');

it('allows an absent optional model without fetching', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(await loadPinnedSoundAsset('learned.json', undefined)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});
it('fails a pinned model download and retries successfully on the next call', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal('fetch', fetcher);
  const pinned = await hash();
  await expect(loadPinnedSoundAsset('short-clip.json', pinned)).rejects.toThrow('could not be loaded');
  expect(await loadPinnedSoundAsset('short-clip.json', pinned)).toEqual({ heads: [] });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects altered model bytes instead of returning an optional fallback', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('altered')));
  await expect(loadPinnedSoundAsset('short-clip.json', await hash())).rejects.toThrow('failed verification');
});
