/**
 * Resolved-OCR-language hand-off between the parse dispatch layer and ocr.ts.
 *
 * ocr.ts also runs inside the dedicated pdf worker, where the zustand-backed
 * settings reads in ../ocrOptions are unavailable — so whichever side
 * dispatches a parse (parsePdf on the main thread, pdf.worker.ts per request,
 * both through pdfEngine) pushes the already-resolved Tesseract language
 * string here instead of ocr.ts pulling it from the store. Kept out of ocr.ts
 * itself so tests that mock './ocr' still get a real setter.
 */

let language = 'eng';

export function setActiveOcrLanguage(next: string): void {
  language = next;
}

/** Captured synchronously when an OCR job is enqueued (see ocrPdfPages). */
export function activeOcrLanguage(): string {
  return language;
}
