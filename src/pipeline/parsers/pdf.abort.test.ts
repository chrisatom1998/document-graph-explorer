import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => pdfjs);

import { parsePdf } from './pdf';

afterEach(() => {
  pdfjs.getDocument.mockReset();
  vi.restoreAllMocks();
});

describe('parsePdf cancellation', () => {
  it('aborts active parses and removes cancelled work from the four-slot admission queue', async () => {
    const destroys: ReturnType<typeof vi.fn>[] = [];
    pdfjs.getDocument.mockImplementation(() => {
      const destroy = vi.fn().mockResolvedValue(undefined);
      destroys.push(destroy);
      return { promise: new Promise(() => {}), destroy };
    });
    const controller = new AbortController();

    const parses = Array.from({ length: 5 }, (_, index) =>
      parsePdf(new ArrayBuffer(8), `scan-${index}.pdf`, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(4));

    controller.abort();
    const settled = await Promise.allSettled(parses);

    expect(settled).toHaveLength(5);
    expect(settled.every((result) => result.status === 'rejected')).toBe(true);
    for (const result of settled) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ name: 'AbortError' });
    }
    expect(pdfjs.getDocument).toHaveBeenCalledTimes(4);
    expect(destroys).toHaveLength(4);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledOnce();
  });
});
