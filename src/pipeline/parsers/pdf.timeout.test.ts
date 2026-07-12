import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => pdfjs);

import { parsePdf } from './pdf';

describe('parsePdf timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    pdfjs.getDocument.mockReset();
  });

  it('returns an unreadable result when a pdf.js page operation never settles', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getMetadata: vi.fn().mockResolvedValue({ info: {} }),
        getPage: vi.fn().mockReturnValue(new Promise(() => {})),
      }),
      destroy,
    });

    const result = parsePdf(new ArrayBuffer(8), 'stalled.pdf');
    await vi.advanceTimersByTimeAsync(60_001);

    await expect(result).resolves.toMatchObject({
      title: 'Stalled',
      status: 'unreadable',
      warning: expect.stringMatching(/timed out/i),
    });
    expect(destroy).toHaveBeenCalled();
  });

  it('preserves text extracted before a later page times out', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const firstPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          {
            str: 'Useful content extracted before the second page stopped responding.',
            transform: [1, 0, 0, 1, 0, 10],
            hasEOL: true,
          },
        ],
      }),
      getAnnotations: vi.fn().mockResolvedValue([]),
      cleanup: vi.fn(),
    };
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getMetadata: vi.fn().mockResolvedValue({ info: { Title: 'Partial PDF' } }),
        getPage: vi
          .fn()
          .mockResolvedValueOnce(firstPage)
          .mockReturnValueOnce(new Promise(() => {})),
      }),
      destroy,
    });

    const result = parsePdf(new ArrayBuffer(8), 'partial.pdf');
    await vi.advanceTimersByTimeAsync(60_001);

    await expect(result).resolves.toMatchObject({
      title: 'Partial PDF',
      status: 'partial',
      text: expect.stringContaining('Useful content extracted'),
      warning: expect.stringMatching(/timed out/i),
    });
  });
});
