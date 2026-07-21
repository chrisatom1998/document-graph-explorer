import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_MANIFEST_URL, fetchDemoManifest } from './manifest';

describe('fetchDemoManifest', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('bypasses an immutable manifest cached by an older desktop build', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('{}'));
    globalThis.fetch = inner as unknown as typeof fetch;

    await fetchDemoManifest();

    expect(inner).toHaveBeenCalledWith(DEMO_MANIFEST_URL, { cache: 'no-store' });
  });
});
