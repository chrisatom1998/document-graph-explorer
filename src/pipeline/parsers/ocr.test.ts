// @vitest-environment jsdom
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tesseract = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => tesseract);

import { ocrPdfPages } from './ocr';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakePage(width = 100, height = 200): PDFPageProxy {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
  } as unknown as PDFPageProxy;
}

function fakeDoc(pages: PDFPageProxy[]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: vi.fn((pageNumber: number) => Promise.resolve(pages[pageNumber - 1])),
  } as unknown as PDFDocumentProxy;
}

afterEach(() => {
  vi.useRealTimers();
  tesseract.createWorker.mockReset();
  vi.restoreAllMocks();
});

describe('ocrPdfPages', () => {
  it('uses the same-origin v7 assets, caps pages, and releases the worker', async () => {
    const recognize = vi
      .fn()
      .mockResolvedValueOnce({ data: { text: 'First scanned page' } })
      .mockResolvedValueOnce({ data: { text: 'Second scanned page' } });
    const terminate = vi.fn().mockResolvedValue({});
    tesseract.createWorker.mockResolvedValue({ recognize, terminate });
    const pages = [fakePage(), fakePage(), fakePage()];
    const doc = fakeDoc(pages);
    const progress = vi.fn();

    await expect(ocrPdfPages(doc, 2, progress)).resolves.toBe(
      'First scanned page\n\nSecond scanned page',
    );

    expect(tesseract.createWorker).toHaveBeenCalledWith(
      'eng',
      undefined,
      expect.objectContaining({
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr/lang',
        gzip: true,
        workerBlobURL: false,
      }),
    );
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(terminate).toHaveBeenCalledOnce();
    expect(pages[0].cleanup).toHaveBeenCalledOnce();
    expect(pages[1].cleanup).toHaveBeenCalledOnce();
  });

  it('serializes documents so only one Tesseract worker is live at a time', async () => {
    const firstRecognition = deferred<{ data: { text: string } }>();
    const firstWorker = {
      recognize: vi.fn(() => firstRecognition.promise),
      terminate: vi.fn().mockResolvedValue({}),
    };
    const secondWorker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: 'Second' } }),
      terminate: vi.fn().mockResolvedValue({}),
    };
    tesseract.createWorker
      .mockResolvedValueOnce(firstWorker)
      .mockResolvedValueOnce(secondWorker);

    const first = ocrPdfPages(fakeDoc([fakePage()]), 1);
    const second = ocrPdfPages(fakeDoc([fakePage()]), 1);
    await vi.waitFor(() => expect(tesseract.createWorker).toHaveBeenCalledTimes(1));

    firstRecognition.resolve({ data: { text: 'First' } });
    await expect(first).resolves.toBe('First');
    await expect(second).resolves.toBe('Second');

    expect(firstWorker.terminate).toHaveBeenCalledBefore(secondWorker.recognize);
    expect(tesseract.createWorker).toHaveBeenCalledTimes(2);
  });

  it('skips a failed page and still terminates cleanly', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const terminate = vi.fn().mockResolvedValue({});
    tesseract.createWorker.mockResolvedValue({
      recognize: vi.fn().mockRejectedValue(new Error('recognizer failed')),
      terminate,
    });

    await expect(ocrPdfPages(fakeDoc([fakePage()]), 1)).resolves.toBe('');
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('times out a stalled recognition and releases the serial queue', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stalledWorker = {
      recognize: vi.fn(() => new Promise(() => {})),
      terminate: vi.fn().mockResolvedValue({}),
    };
    const nextWorker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: 'Queue recovered' } }),
      terminate: vi.fn().mockResolvedValue({}),
    };
    tesseract.createWorker
      .mockResolvedValueOnce(stalledWorker)
      .mockResolvedValueOnce(nextWorker);

    const stalled = ocrPdfPages(fakeDoc([fakePage()]), 1);
    const next = ocrPdfPages(fakeDoc([fakePage()]), 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(tesseract.createWorker).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_001);
    await expect(stalled).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toBe('Queue recovered');

    expect(stalledWorker.terminate).toHaveBeenCalledOnce();
    expect(tesseract.createWorker).toHaveBeenCalledTimes(2);
  });
});
