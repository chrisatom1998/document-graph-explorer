/**
 * OCR fallback for image-only PDFs.
 *
 * Tesseract is demand-loaded only after pdf.js finds no usable text. Jobs are
 * serialized because each worker owns a sizeable WASM heap; allowing every
 * concurrently parsed PDF to create one can exhaust a browser tab. One worker
 * is reused for all pages in a document, then terminated so the heap is
 * released before the next queued PDF starts.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { currentOcrLanguage } from '../ocrOptions';

const OCR_WORKER_PATH = '/ocr/worker.min.js';
const OCR_CORE_PATH = '/ocr/core';
const OCR_LANGUAGE_PATH = '/ocr/lang';
const OCR_RENDER_SCALE = 2;
const OCR_MAX_CANVAS_PIXELS = 16_000_000;
const OCR_ENGINE_START_TIMEOUT_MS = 60_000;
const OCR_PAGE_OPERATION_TIMEOUT_MS = 60_000;
const OCR_TOTAL_TIMEOUT_MS = 5 * 60_000;
const OCR_WORKER_STOP_TIMEOUT_MS = 5_000;

export type OcrPageProgress = (completed: number, total: number) => void;

let queueTail: Promise<void> = Promise.resolve();

class OcrTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out`);
    this.name = 'OcrTimeoutError';
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => finish(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function enqueueOcr<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const start = (): Promise<T> =>
    signal?.aborted ? Promise.reject(abortReason(signal)) : job();
  const run = queueTail.then(start, start);
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  // A queued OCR call must reject as soon as its ingest is cancelled, not
  // remain chained behind an unrelated long-running scanned PDF. The queued
  // `start` still observes the signal later and skips creating a worker.
  return withAbort(run, signal);
}

function reportProgress(
  onProgress: OcrPageProgress | undefined,
  completed: number,
  total: number,
): void {
  try {
    onProgress?.(completed, total);
  } catch (err) {
    // A presentation callback must never turn otherwise usable OCR into an
    // unreadable document.
    console.warn('[knowledge-nebula] OCR progress callback failed', err);
  }
}

function scaleForPage(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>): number {
  const base = page.getViewport({ scale: 1 });
  const basePixels = base.width * base.height;
  if (!Number.isFinite(basePixels) || basePixels <= 0) return 1;
  return Math.min(OCR_RENDER_SCALE, Math.sqrt(OCR_MAX_CANVAS_PIXELS / basePixels));
}

function beforeTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  cancel?: () => void,
  signal?: AbortSignal,
): Promise<T> {
  const cancelBestEffort = (): void => {
    try {
      cancel?.();
    } catch {
      // Cancellation is best-effort; timeout/abort still wins.
    }
  };
  if (signal?.aborted) {
    cancelBestEffort();
    return Promise.reject(abortReason(signal));
  }
  if (timeoutMs <= 0) {
    cancelBestEffort();
    return Promise.reject(new OcrTimeoutError(label));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => {
      cancelBestEffort();
      finish(() => reject(abortReason(signal!)));
    };
    const timer = setTimeout(() => {
      cancelBestEffort();
      finish(() => reject(new OcrTimeoutError(label)));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function beforeDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  perOperationLimit: number,
  label: string,
  cancel?: () => void,
  signal?: AbortSignal,
): Promise<T> {
  return beforeTimeout(
    operation,
    Math.min(perOperationLimit, deadline - Date.now()),
    label,
    cancel,
    signal,
  );
}

async function runOcr(
  doc: PDFDocumentProxy,
  maxPages: number,
  onProgress?: OcrPageProgress,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw abortReason(signal);
  const total = Math.min(doc.numPages, Math.max(0, Math.floor(maxPages)));
  if (total === 0) return '';
  if (typeof document === 'undefined') throw new Error('OCR requires browser canvas support');
  const deadline = Date.now() + OCR_TOTAL_TIMEOUT_MS;
  reportProgress(onProgress, 0, total);

  // Keep the dependency in its own async chunk; normal text PDFs never pay
  // the Tesseract parse/initialization cost.
  const { createWorker } = await beforeDeadline(
    import('tesseract.js'),
    deadline,
    OCR_ENGINE_START_TIMEOUT_MS,
    'Loading the OCR engine',
    undefined,
    signal,
  );
  const workerPromise = createWorker(currentOcrLanguage(), undefined, {
    workerPath: OCR_WORKER_PATH,
    corePath: OCR_CORE_PATH,
    langPath: OCR_LANGUAGE_PATH,
    gzip: true,
    legacyCore: false,
    legacyLang: false,
    // All assets are same-origin. Avoid the default blob wrapper so a bad
    // deployment cannot silently fall back to a remote worker URL.
    workerBlobURL: false,
  });
  let worker: Awaited<typeof workerPromise>;
  try {
    worker = await beforeDeadline(
      workerPromise,
      deadline,
      OCR_ENGINE_START_TIMEOUT_MS,
      'Starting the OCR engine',
      undefined,
      signal,
    );
  } catch (err) {
    // createWorker exposes no handle until initialization resolves. If it
    // completes after our deadline, terminate that late worker immediately.
    void workerPromise
      .then((lateWorker) => lateWorker.terminate())
      .catch(() => undefined);
    throw err;
  }

  const pageTexts: string[] = [];
  let termination: ReturnType<typeof worker.terminate> | null = null;
  const stopWorker = (): void => {
    if (!termination) termination = worker.terminate();
  };
  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      if (signal?.aborted) throw abortReason(signal);
      let canvas: HTMLCanvasElement | null = null;
      let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;
      try {
        page = await beforeDeadline(
          doc.getPage(pageNumber),
          deadline,
          OCR_PAGE_OPERATION_TIMEOUT_MS,
          `Loading PDF page ${pageNumber} for OCR`,
          undefined,
          signal,
        );
        // Compute a scale with a pixel ceiling before allocating the canvas so
        // pathological page sizes cannot create a hundreds-of-megabytes bitmap.
        const scale = scaleForPage(page);
        const viewport = page.getViewport({ scale });
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const renderTask = page.render({ canvas, viewport });
        await beforeDeadline(
          renderTask.promise,
          deadline,
          OCR_PAGE_OPERATION_TIMEOUT_MS,
          `Rendering PDF page ${pageNumber} for OCR`,
          () => renderTask.cancel(),
          signal,
        );
        const result = await beforeDeadline(
          worker.recognize(canvas),
          deadline,
          OCR_PAGE_OPERATION_TIMEOUT_MS,
          `Recognizing PDF page ${pageNumber}`,
          stopWorker,
          signal,
        );
        const text = result.data.text.trim();
        if (text) pageTexts.push(text);
      } catch (err) {
        if (signal?.aborted) throw abortReason(signal);
        if (err instanceof OcrTimeoutError) throw err;
        // One malformed page should not discard text recognized from the
        // remaining pages. parsePdf will retain its unreadable fallback if no
        // page ultimately yields enough text.
        console.warn(`[knowledge-nebula] OCR skipped PDF page ${pageNumber}`, err);
      } finally {
        page?.cleanup();
        if (canvas) {
          // Drop the backing bitmap promptly before the next page is rendered.
          canvas.width = 0;
          canvas.height = 0;
        }
        if (!signal?.aborted) reportProgress(onProgress, pageNumber, total);
      }

      // Yield between pages so React can paint the progress update and the tab
      // remains responsive during long scanned documents.
      if (pageNumber < total) {
        await beforeDeadline(
          new Promise<void>((resolve) => setTimeout(resolve, 0)),
          deadline,
          OCR_PAGE_OPERATION_TIMEOUT_MS,
          'Yielding between OCR pages',
          undefined,
          signal,
        );
      }
    }
  } finally {
    stopWorker();
    await beforeTimeout(
      termination!,
      OCR_WORKER_STOP_TIMEOUT_MS,
      'Stopping the OCR engine',
      stopWorker,
      signal,
    ).catch((err: unknown) => {
      if (!signal?.aborted) console.warn('[knowledge-nebula] OCR worker cleanup failed', err);
    });
  }

  return pageTexts.join('\n\n').trim();
}

/** Recognize up to `maxPages` pages from an already-open pdf.js document. */
export function ocrPdfPages(
  doc: PDFDocumentProxy,
  maxPages: number,
  onProgress?: OcrPageProgress,
  signal?: AbortSignal,
): Promise<string> {
  return enqueueOcr(() => runOcr(doc, maxPages, onProgress, signal), signal);
}
