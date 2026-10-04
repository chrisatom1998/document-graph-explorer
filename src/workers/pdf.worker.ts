/**
 * Dedicated pdf worker: pdf.js text extraction + Tesseract OCR fallback, one
 * document per request, off the main thread. A single long-lived instance
 * owned by pipeline/parsers/pdfWorkerClient.ts — concurrency is admission-
 * gated by parsePdf (4 slots), and keeping ONE instance means ocr.ts's
 * module-scope queue still serializes Tesseract heaps exactly as it did on
 * the main thread. pdf.js spawns its own nested worker in here, and
 * tesseract.js spawns another (CSP already allows `worker-src 'self' blob:`).
 * OCR progress streams back as pdf:ocr-progress; a final pdf:done carries
 * the result (the engine encodes parse failures as unreadable/partial
 * results, so pdf:error means infrastructure trouble and the client retries
 * on the main thread).
 */

import { installUint8ArrayBase64HexPolyfill } from '../pipeline/parsers/pdfUint8ArrayPolyfill';
import { installMapUpsertPolyfill } from '../pipeline/parsers/pdfMapUpsertPolyfill';
import type {
  PdfWorkerParseRequest,
  PdfWorkerResponse,
} from '../pipeline/parsers/pdfWorkerClient';

declare const self: DedicatedWorkerGlobalScope;

// Both polyfills must be live in THIS global scope before any pdf.js code
// evaluates (a worker scope inherits nothing from the main thread, and the
// OCR fallback exercises the canvas renderer's Map.getOrInsertComputed path
// here) — so the engine, whose static imports include pdfjs-dist, is loaded
// dynamically after they install.
installUint8ArrayBase64HexPolyfill();
installMapUpsertPolyfill();
const engineReady = import('../pipeline/parsers/pdfEngine');

function respond(msg: PdfWorkerResponse): void {
  self.postMessage(msg);
}

async function handle(req: PdfWorkerParseRequest): Promise<void> {
  try {
    const { parsePdfEngine } = await engineReady;
    const result = await parsePdfEngine(req.bytes, req.name, {
      ocrMaxPages: req.ocrMaxPages,
      ocrLanguage: req.ocrLanguage,
      onOcrProgress: (completed, total) =>
        respond({ type: 'pdf:ocr-progress', requestId: req.requestId, completed, total }),
    });
    respond({ type: 'pdf:done', requestId: req.requestId, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The client surfaces only `message`; without the stack a runtime error
    // (e.g. a failed engine import in dev) is undiagnosable from the console.
    console.error('[pdf.worker] parsePdf failed:', err);
    respond({ type: 'pdf:error', requestId: req.requestId, message });
  }
}

self.onmessage = (ev: MessageEvent<PdfWorkerParseRequest>) => {
  void handle(ev.data);
};
