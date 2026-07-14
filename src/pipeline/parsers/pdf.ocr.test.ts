import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));
const ocr = vi.hoisted(() => ({ ocrPdfPages: vi.fn() }));

vi.mock('pdfjs-dist', () => pdfjs);
vi.mock('./ocr', () => ocr);

import { parsePdf } from './pdf';

function pdfTask(text: string) {
  const page = {
    getTextContent: vi.fn().mockResolvedValue({
      items: text
        ? [{ str: text, transform: [1, 0, 0, 1, 0, 10], hasEOL: true }]
        : [],
    }),
    getAnnotations: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn(),
  };
  const doc = {
    numPages: 1,
    getMetadata: vi.fn().mockResolvedValue({ info: {} }),
    getPage: vi.fn().mockResolvedValue(page),
  };
  const destroy = vi.fn().mockResolvedValue(undefined);
  return { task: { promise: Promise.resolve(doc), destroy }, doc, destroy };
}

afterEach(() => {
  pdfjs.getDocument.mockReset();
  ocr.ocrPdfPages.mockReset();
  vi.restoreAllMocks();
});

describe('parsePdf OCR fallback', () => {
  it('recognizes a scanned PDF from the still-open document proxy', async () => {
    const { task, doc, destroy } = pdfTask('');
    pdfjs.getDocument.mockReturnValue(task);
    ocr.ocrPdfPages.mockResolvedValue(
      'Text recovered from a scanned page with enough content to build a useful document node.',
    );
    const onOcrProgress = vi.fn();

    await expect(
      parsePdf(new ArrayBuffer(8), 'scan.pdf', { onOcrProgress }),
    ).resolves.toMatchObject({
      title: 'Scan',
      text: expect.stringContaining('Text recovered from a scanned page'),
      status: 'partial',
      warning: 'Text recognized via OCR (scanned document)',
    });

    expect(ocr.ocrPdfPages).toHaveBeenCalledWith(doc, 20, onOcrProgress);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('preserves the unreadable result when OCR fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { task, destroy } = pdfTask('');
    pdfjs.getDocument.mockReturnValue(task);
    ocr.ocrPdfPages.mockRejectedValue(new Error('OCR unavailable'));

    await expect(parsePdf(new ArrayBuffer(8), 'scan.pdf')).resolves.toMatchObject({
      title: 'Scan',
      text: '',
      status: 'unreadable',
      warning: 'No extractable text (scanned images?)',
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not load OCR when native PDF text is usable', async () => {
    const nativeText = 'Native PDF text is already long enough that OCR should not be attempted.';
    const { task } = pdfTask(nativeText);
    pdfjs.getDocument.mockReturnValue(task);

    await expect(parsePdf(new ArrayBuffer(8), 'native.pdf')).resolves.toMatchObject({
      text: expect.stringContaining('Native PDF text'),
      status: 'ok',
    });
    expect(ocr.ocrPdfPages).not.toHaveBeenCalled();
  });
});
