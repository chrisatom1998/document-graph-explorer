/**
 * PDF parse dispatch. parsePdf routes each document to the dedicated pdf
 * worker (src/workers/pdf.worker.ts) when the runtime can host it (Worker +
 * OffscreenCanvas — OCR rasterizes pages off-DOM there), and otherwise runs
 * the same engine (./pdfEngine.ts) on the main thread: vitest's Node
 * environment, browsers without OffscreenCanvas, or a session where a worker
 * infrastructure failure pinned main-thread mode. The route is decided
 * BEFORE the bytes are transferred; the caller's buffer is then handed to
 * the worker (and detached, matching the main-thread path where pdf.js
 * transfers it) while a private copy taken up front lets an infrastructure
 * failure (crash, watchdog timeout, protocol error — never a legitimate
 * parse result) retry on the main thread exactly once.
 *
 * Like the engine, parsePdf never throws except on abort — encrypted or
 * zero-text PDFs come back as status 'unreadable' with a warning so they
 * surface as ghosted nodes rather than silent gaps.
 */

import { currentOcrLanguage, currentOcrMaxPages } from '../ocrOptions';
import type { OcrPageProgress } from './ocr';
import { parsePdfEngine, type PdfParseResult } from './pdfEngine';
import { getPdfWorkerClient, PdfWorkerFailure } from './pdfWorkerClient';

export { ensurePdfWorkerReady, PDF_STANDARD_FONT_DATA_URL } from './pdfEngine';
export type { PdfParseResult } from './pdfEngine';

export interface PdfParseOptions {
  onOcrProgress?: OcrPageProgress;
  signal?: AbortSignal;
}

/**
 * The 60s parse deadline starts inside the engine, so admission must be
 * gated: the coordinator fires every miss's parse task at once, and a large
 * all-PDF drop (e.g. the 100-doc demo corpus, or a user folder of hundreds of
 * PDFs) would otherwise have documents burning their deadline while queued
 * behind pdf.js — the tail of the batch would time out as 'unreadable'
 * without ever being looked at. The gate wraps BOTH routes: the dedicated
 * worker is one instance, so flooding it would queue documents inside its
 * message queue with the same expired-deadline outcome.
 */
const PDF_PARSE_MAX_CONCURRENT = 4;
let pdfParseActive = 0;
interface PdfParseWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}
const pdfParseWaiters: PdfParseWaiter[] = [];

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

async function acquirePdfParseSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  if (pdfParseActive < PDF_PARSE_MAX_CONCURRENT) {
    pdfParseActive += 1;
    return;
  }
  // released slot is handed over directly — the counter stays saturated
  await new Promise<void>((resolve, reject) => {
    const waiter: PdfParseWaiter = { resolve, reject, signal };
    if (signal) {
      waiter.onAbort = () => {
        const index = pdfParseWaiters.indexOf(waiter);
        if (index >= 0) pdfParseWaiters.splice(index, 1);
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    pdfParseWaiters.push(waiter);
  });
}

function releasePdfParseSlot(): void {
  const next = pdfParseWaiters.shift();
  if (!next) {
    pdfParseActive -= 1;
    return;
  }
  if (next.signal && next.onAbort) {
    next.signal.removeEventListener('abort', next.onAbort);
  }
  next.resolve();
}

/**
 * Set after the first worker infrastructure failure: that document is
 * retried on the main thread, and every later PDF in the session skips the
 * worker outright — a runtime that just crashed or wedged it is unlikely to
 * do better on the next document, and each failed attempt costs a full
 * watchdog window.
 */
let pdfWorkerBroken = false;

function canUsePdfWorker(): boolean {
  return (
    !pdfWorkerBroken && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
  );
}

export async function parsePdf(
  bytes: ArrayBuffer,
  name: string,
  options: PdfParseOptions = {},
): Promise<PdfParseResult> {
  await acquirePdfParseSlot(options.signal);
  try {
    return await routeParsePdf(bytes, name, options);
  } finally {
    releasePdfParseSlot();
  }
}

async function routeParsePdf(
  bytes: ArrayBuffer,
  name: string,
  options: PdfParseOptions,
): Promise<PdfParseResult> {
  const signal = options.signal;
  // Settings live in main-thread zustand state, so they're resolved here on
  // the dispatching side and travel with the request (see ocrLanguage.ts).
  const ocrMaxPages = currentOcrMaxPages();
  const ocrLanguage = currentOcrLanguage();
  if (!canUsePdfWorker()) {
    return parsePdfEngine(bytes, name, {
      ocrMaxPages,
      ocrLanguage,
      onOcrProgress: options.onOcrProgress,
      signal,
    });
  }
  // The caller's buffer is transferred to the worker and detached — the same
  // contract the main-thread path has always had (pdf.js transfers the buffer
  // to its own worker), so a large drop's raw bytes don't stay resident on
  // the main thread for the whole parse phase. The retry copy below lives
  // only until this parse settles.
  const retryBytes = bytes.slice(0);
  try {
    return await getPdfWorkerClient().parse(bytes, name, {
      ocrMaxPages,
      ocrLanguage,
      onOcrProgress: options.onOcrProgress,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw abortReason(signal);
    if (!(err instanceof PdfWorkerFailure)) throw err;
    pdfWorkerBroken = true;
    console.warn(
      `[knowledge-nebula] pdf worker failed (${err.message}); parsing on the main thread for the rest of the session`,
    );
    return parsePdfEngine(retryBytes, name, {
      ocrMaxPages,
      ocrLanguage,
      onOcrProgress: options.onOcrProgress,
      signal,
    });
  }
}
