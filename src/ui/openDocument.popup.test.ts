// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const { getOriginal } = vi.hoisted(() => ({
  getOriginal: vi.fn(),
}));

vi.mock('../persistence/originals', () => ({ getOriginal }));

import { openDocument } from './openDocument';

describe('openDocument popup activation', () => {
  it('reserves the fallback viewer window before the first async storage read', async () => {
    let resolveOriginal!: (value: undefined) => void;
    getOriginal.mockReturnValue(
      new Promise<undefined>((resolve) => {
        resolveOriginal = resolve;
      }),
    );
    const reservedWindow = { close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(reservedWindow);

    const pending = openDocument('doc-that-needs-hydration');

    // A popup created after the awaited IndexedDB read can lose transient user
    // activation and be blocked. Reserve it synchronously while the click is
    // still on the stack; later code may populate or close it as appropriate.
    expect(open).toHaveBeenCalledWith('', '_blank');

    resolveOriginal(undefined);
    await pending;
  });
});
