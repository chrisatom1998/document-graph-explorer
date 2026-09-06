/**
 * parsePdf route gating: the worker route needs Worker + OffscreenCanvas
 * (absent in Node, so every other pdf test exercises the main-thread engine),
 * the worker gets a COPY of the bytes, and a worker infrastructure failure
 * retries the untouched original on the main thread and pins main-thread
 * mode for the rest of the session. Modules are reset per test because the
 * pin and the admission gate are module-scope state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));
const client = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock('pdfjs-dist', () => pdfjs);
vi.mock('./pdfWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdfWorkerClient')>();
  return { ...actual, getPdfWorkerClient: () => client };
});

const NATIVE_TEXT = 'Native PDF text long enough that the engine returns an ok result.';

function pdfTask(text: string) {
  const page = {
    getTextContent: vi.fn().mockResolvedValue({
      items: text ? [{ str: text, transform: [1, 0, 0, 1, 0, 10], hasEOL: true }] : [],
    }),
    getAnnotations: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn(),
  };
  const doc = {
    numPages: 1,
    getMetadata: vi.fn().mockResolvedValue({ info: {} }),
    getPage: vi.fn().mockResolvedValue(page),
  };
  return { promise: Promise.resolve(doc), destroy: vi.fn().mockResolvedValue(undefined) };
}

function makeBytes(): ArrayBuffer {
  const bytes = new ArrayBuffer(8);
  new Uint8Array(bytes).set([1, 2, 3, 4, 5, 6, 7, 8]);
  return bytes;
}

describe('parsePdf dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    pdfjs.getDocument.mockReset();
    client.parse.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses on the main thread when the runtime lacks Worker/OffscreenCanvas', async () => {
    const { parsePdf } = await import('./pdf');
    pdfjs.getDocument.mockReturnValue(pdfTask(NATIVE_TEXT));

    await expect(parsePdf(makeBytes(), 'a.pdf')).resolves.toMatchObject({ status: 'ok' });
    expect(client.parse).not.toHaveBeenCalled();
    expect(pdfjs.getDocument).toHaveBeenCalledOnce();
  });

  it('routes to the worker (with copied bytes and resolved OCR settings) when supported', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('OffscreenCanvas', class {});
    const { parsePdf } = await import('./pdf');
    client.parse.mockResolvedValue({ title: 'Worker Doc', text: 'x', status: 'ok', links: [] });
    const bytes = makeBytes();

    await expect(parsePdf(bytes, 'a.pdf')).resolves.toMatchObject({ title: 'Worker Doc' });

    expect(pdfjs.getDocument).not.toHaveBeenCalled();
    const [sentBytes, name, options] = client.parse.mock.calls[0] as [
      ArrayBuffer,
      string,
      { ocrMaxPages: number; ocrLanguage: string },
    ];
    expect(name).toBe('a.pdf');
    expect(options).toMatchObject({ ocrMaxPages: 20, ocrLanguage: 'eng' });
    // the caller's buffer itself goes to the worker (it is transferred and
    // detached there, freeing the main-thread copy as parsing starts); the
    // fallback retry runs from a private copy taken before the hand-off
    expect(sentBytes).toBe(bytes);
    expect([...new Uint8Array(sentBytes)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('retries an infrastructure failure once on the main thread with the original bytes, then pins main-thread mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('OffscreenCanvas', class {});
    const { parsePdf } = await import('./pdf');
    const { PdfWorkerFailure } = await import('./pdfWorkerClient');
    client.parse.mockRejectedValue(new PdfWorkerFailure('pdf worker crashed'));
    const seenData: Uint8Array[] = [];
    pdfjs.getDocument.mockImplementation(({ data }: { data: Uint8Array }) => {
      seenData.push(new Uint8Array(data));
      return pdfTask(NATIVE_TEXT);
    });

    await expect(parsePdf(makeBytes(), 'a.pdf')).resolves.toMatchObject({ status: 'ok' });
    expect(client.parse).toHaveBeenCalledTimes(1);
    expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
    expect([...seenData[0]]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // the session is pinned: the next PDF skips the worker outright
    await expect(parsePdf(makeBytes(), 'b.pdf')).resolves.toMatchObject({ status: 'ok' });
    expect(client.parse).toHaveBeenCalledTimes(1);
    expect(pdfjs.getDocument).toHaveBeenCalledTimes(2);
  });

  it('an abort on the worker route rejects without a main-thread retry', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('OffscreenCanvas', class {});
    const { parsePdf } = await import('./pdf');
    const controller = new AbortController();
    client.parse.mockImplementation(
      (_bytes: ArrayBuffer, _name: string, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const fail = (): void =>
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (options.signal?.aborted) fail();
          else options.signal?.addEventListener('abort', fail, { once: true });
        }),
    );

    const parsed = parsePdf(makeBytes(), 'a.pdf', { signal: controller.signal });
    controller.abort();
    await expect(parsed).rejects.toMatchObject({ name: 'AbortError' });
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });
});
