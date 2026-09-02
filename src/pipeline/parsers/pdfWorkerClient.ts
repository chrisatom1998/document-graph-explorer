/**
 * Main-thread client for the dedicated pdf worker (src/workers/pdf.worker.ts).
 * Modeled on the coordinator's aggregator client: a single long-lived worker,
 * pending requests keyed by requestId, streamed OCR progress, and
 * discard-and-respawn on crash, watchdog timeout, or abort — after any of
 * those the worker's state can no longer be trusted, and runs are serialized
 * by the coordinator's runQueue so tearing it down only affects the run that
 * already failed or was cancelled. Deliberately NOT routed through
 * WorkerPool: its 30s parse timeout, retire-on-timeout semantics, and
 * settle-on-any-message handling can't host a 60s parse + 5min OCR job with
 * streamed progress.
 */

import type { OcrPageProgress } from './ocr';
import type { PdfParseResult } from './pdfEngine';

export interface PdfWorkerParseRequest {
  requestId: number;
  type: 'parsePdf';
  /** Transferred to the worker — callers must hand over a dedicated copy. */
  bytes: ArrayBuffer;
  name: string;
  ocrMaxPages: number;
  ocrLanguage: string;
}

export type PdfWorkerResponse =
  | { type: 'pdf:ocr-progress'; requestId: number; completed: number; total: number }
  | { type: 'pdf:done'; requestId: number; result: PdfParseResult }
  | { type: 'pdf:error'; requestId: number; message: string };

/** Structural Worker surface, injectable for tests (no Worker in Node). */
export interface PdfWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<PdfWorkerResponse>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
}

/**
 * Worker infrastructure failure — crash, watchdog timeout, protocol error —
 * never a legitimate parse outcome (those always arrive as a pdf:done
 * result, even for unreadable documents). parsePdf reacts by retrying the
 * document once on the main thread and pinning main-thread mode for the
 * rest of the session.
 */
export class PdfWorkerFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfWorkerFailure';
  }
}

// Outer safety net around the worker's own budgets (60s parse deadline plus
// the 5min OCR total, both enforced inside the engine): the engine always
// settles within those, so a request outliving this margin means the worker
// itself is wedged — discard and respawn it, mirroring the coordinator's
// discardAggregator handling.
const PDF_WORKER_WATCHDOG_MS = 390_000;

export interface PdfWorkerParseOptions {
  ocrMaxPages: number;
  ocrLanguage: string;
  onOcrProgress?: OcrPageProgress;
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function spawnPdfWorker(): PdfWorkerLike {
  return new Worker(new URL('../../workers/pdf.worker.ts', import.meta.url), {
    type: 'module',
  });
}

interface PendingParse {
  resolve: (result: PdfParseResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onOcrProgress?: OcrPageProgress;
}

export class PdfWorkerClient {
  private worker: PdfWorkerLike | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingParse>();
  private readonly workerFactory: () => PdfWorkerLike;

  constructor(options: { workerFactory?: () => PdfWorkerLike } = {}) {
    this.workerFactory = options.workerFactory ?? spawnPdfWorker;
  }

  /**
   * Reject everything in flight and drop the worker so the next request
   * respawns a clean one. Used for crashes, undecodable messages, watchdog
   * timeouts, and aborts alike — in every case the worker's state can no
   * longer be trusted (there is no way to cancel a job inside it).
   */
  private discard(error: Error): void {
    for (const [id, entry] of [...this.pending]) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): PdfWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    worker.onmessage = (ev: MessageEvent<PdfWorkerResponse>) => {
      const msg = ev.data;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;

      if (msg.type === 'pdf:ocr-progress') {
        try {
          entry.onOcrProgress?.(msg.completed, msg.total);
        } catch (err) {
          // A presentation callback must never turn a parsable document into
          // a failed one (same contract as ocr.ts's reportProgress).
          console.warn('[knowledge-nebula] OCR progress callback failed', err);
        }
        return;
      }

      this.pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.type === 'pdf:error') entry.reject(new PdfWorkerFailure(msg.message));
      else entry.resolve(msg.result);
    };
    worker.onerror = (ev: ErrorEvent) => {
      this.discard(new PdfWorkerFailure(ev.message || 'pdf worker crashed'));
    };
    worker.onmessageerror = () => {
      this.discard(new PdfWorkerFailure('pdf worker message could not be decoded'));
    };
    this.worker = worker;
    return worker;
  }

  /**
   * Parse one PDF in the worker. `bytes` is transferred — pass a copy if the
   * buffer must survive (parsePdf keeps the original for its main-thread
   * retry). Rejects with PdfWorkerFailure for infrastructure trouble and
   * with the abort reason when `signal` fires (the worker is torn down then:
   * an in-flight pdf.js/Tesseract job can't be interrupted any other way).
   */
  parse(bytes: ArrayBuffer, name: string, options: PdfWorkerParseOptions): Promise<PdfParseResult> {
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<PdfParseResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        this.discard(
          new PdfWorkerFailure(`pdf worker request timed out after ${PDF_WORKER_WATCHDOG_MS}ms`),
        );
      }, PDF_WORKER_WATCHDOG_MS);
      const onAbort = signal
        ? () => {
            if (!this.pending.has(requestId)) return;
            this.discard(abortReason(signal));
          }
        : null;
      // Detach the abort listener however the request settles, so a shared
      // per-run signal doesn't accumulate dead listeners.
      const settled =
        <A,>(fn: (arg: A) => void) =>
        (arg: A): void => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          fn(arg);
        };
      if (signal && onAbort) signal.addEventListener('abort', onAbort);
      this.pending.set(requestId, {
        resolve: settled(resolve),
        reject: settled(reject),
        timer,
        onOcrProgress: options.onOcrProgress,
      });
      const payload: PdfWorkerParseRequest = {
        requestId,
        type: 'parsePdf',
        bytes,
        name,
        ocrMaxPages: options.ocrMaxPages,
        ocrLanguage: options.ocrLanguage,
      };
      try {
        worker.postMessage(payload, [bytes]);
      } catch (err) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        settled(reject)(new PdfWorkerFailure(`pdf worker request could not be sent (${message})`));
      }
    });
  }
}

let singleton: PdfWorkerClient | null = null;

export function getPdfWorkerClient(): PdfWorkerClient {
  if (!singleton) singleton = new PdfWorkerClient();
  return singleton;
}
