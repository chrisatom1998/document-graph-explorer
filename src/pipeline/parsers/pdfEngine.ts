/**
 * PDF text extraction via pdf.js — the shared engine behind BOTH parse
 * routes: the dedicated pdf worker (src/workers/pdf.worker.ts) and the
 * main-thread fallback (parsePdf in ./pdf.ts). Everything in this module
 * must stay runnable inside a worker global scope: no DOM reads, no zustand
 * — OCR settings arrive pre-resolved in PdfEngineOptions. pdf.js spawns its
 * own nested worker from here in either scope (CSP allows
 * `worker-src 'self' blob:`).
 *
 * Cleanup heuristics (spec §9): drop header/footer lines repeated across
 * pages, join hyphenated line breaks. parsePdfEngine never throws except on
 * abort — encrypted or zero-text PDFs come back as status 'unreadable' with
 * a warning so they surface as ghosted nodes rather than silent gaps.
 */

import * as pdfjs from 'pdfjs-dist';
import type { LinkRef, NodeStatus } from '../../model/types';
import { cleanFilename } from './txt';
import { ocrPdfPages, type OcrPageProgress } from './ocr';
import { setActiveOcrLanguage } from './ocrLanguage';
import { labelForRect, type PdfTextSpan } from './pdfLinkLabels';
import {
  UINT8ARRAY_BASE64_HEX_NATIVE,
  installUint8ArrayBase64HexPolyfill,
  INSTALL_UINT8ARRAY_POLYFILL_SOURCE,
} from './pdfUint8ArrayPolyfill';
import { installMapUpsertPolyfill } from './pdfMapUpsertPolyfill';

// See pdfUint8ArrayPolyfill.ts: pdf.js 6.x needs Uint8Array
// toHex/fromHex/toBase64/fromBase64, which older bundled Chromium (e.g.
// Electron's) may not implement yet. Patch this scope unconditionally
// (harmless no-op where the runtime has them — or where pdf.worker.ts
// already installed the polyfill before loading this module). Whether the
// runtime NATIVELY lacked them was captured at the polyfill module's first
// import, so pdf.js's nested worker — yet another global scope — still gets
// the spliced copy below when it needs one.
const NEEDS_UINT8ARRAY_POLYFILL = !UINT8ARRAY_BASE64_HEX_NATIVE;
installUint8ArrayBase64HexPolyfill();

// See pdfMapUpsertPolyfill.ts: pdf.js 6.x's canvas renderer needs
// Map.prototype.getOrInsertComputed, which is newer still and commonly
// missing even where the Uint8Array methods above are already present (e.g.
// Electron's bundled Chromium). The renderer runs in every scope this engine
// does: ui/PdfPreview.tsx on the main thread, and the OCR fallback
// rasterizing pages inside the pdf worker.
installMapUpsertPolyfill();

const PDF_WORKER_ASSET_URL = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * pdf.js's dedicated worker runs in its own global scope, so the polyfill
 * above never reaches it. When it's actually needed, fetch the worker
 * script's own source once, splice the prebuilt polyfill source
 * (INSTALL_UINT8ARRAY_POLYFILL_SOURCE — a plain string constant, not a
 * `Function.prototype.toString()` serialization) in front of it, and load
 * that combined script from a blob: URL instead of the raw asset — CSP
 * already allows `worker-src 'self' blob:`. Cached for the life of the
 * session; falls back to the plain asset URL if anything about the
 * fetch/blob step fails, which is no worse than before this fix.
 */
let workerSrcReady: Promise<void> | null = null;

async function ensureWorkerSrc(): Promise<void> {
  if (!NEEDS_UINT8ARRAY_POLYFILL) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_ASSET_URL;
    return;
  }
  try {
    const source = await fetch(PDF_WORKER_ASSET_URL).then((r) => r.text());
    const blob = new Blob([INSTALL_UINT8ARRAY_POLYFILL_SOURCE, '\n', source], {
      type: 'text/javascript',
    });
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_ASSET_URL;
  }
}

function workerSrcReadyOnce(): Promise<void> {
  if (!workerSrcReady) workerSrcReady = ensureWorkerSrc();
  return workerSrcReady;
}

/**
 * Same worker setup as parsePdfEngine, exposed (via ./pdf.ts) for the
 * SidePanel's live PDF page preview (ui/PdfPreview.tsx) so it doesn't
 * duplicate the polyfill/worker plumbing above.
 */
export const ensurePdfWorkerReady = workerSrcReadyOnce;

/**
 * Standard-14 font programs (copied from pdfjs-dist/standard_fonts into
 * public/). PDFs that reference Helvetica/Times/Courier without embedding
 * them — including the generated demo corpus — render blank canvas pages
 * without this; text EXTRACTION works either way, so the gap only shows in
 * the SidePanel's PDF preview. Every getDocument call must pass it.
 */
export const PDF_STANDARD_FONT_DATA_URL = '/standard_fonts/';


export interface PdfParseResult {
  title: string;
  text: string;
  status: NodeStatus;
  warning?: string;
  /** Links from the PDF's annotation layer, labelled with the text under each
   * link's rectangle (empty text when nothing matched). */
  links: LinkRef[];
}

export interface PdfEngineOptions {
  /** Resolved by the dispatching side (settings live on the main thread). */
  ocrMaxPages: number;
  /** Resolved Tesseract language string, same provenance as ocrMaxPages. */
  ocrLanguage: string;
  onOcrProgress?: OcrPageProgress;
  signal?: AbortSignal;
}

/** TextItem | TextMarkedContent — the root package doesn't re-export item types. */
type TextContentItems = Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>['items'];

const MIN_TEXT_CHARS = 40; // below this the PDF is considered unreadable
const HEADER_FOOTER_MIN_PAGES = 3; // repeated-line cleanup needs ≥ 3 pages
const HEADER_FOOTER_FRACTION = 0.6; // line repeats on ≥ 60% of pages
const SAME_LINE_Y_TOLERANCE = 2; // pt; larger y-jumps start a new line
const PDF_PARSE_TIMEOUT_MS = 60_000;

class PdfParseTimeoutError extends Error {
  constructor() {
    super(`PDF parsing timed out after ${PDF_PARSE_TIMEOUT_MS / 1000} seconds`);
    this.name = 'PdfParseTimeoutError';
  }
}

async function beforePdfDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  cancel: () => void,
  signal?: AbortSignal,
): Promise<T> {
  const abortError = (): Error =>
    signal?.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted.', 'AbortError');
  const cancelBestEffort = (): void => {
    try {
      cancel();
    } catch {
      // Timeout/abort is already the result; cleanup is best-effort.
    }
  };
  if (signal?.aborted) {
    cancelBestEffort();
    throw abortError();
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    cancelBestEffort();
    throw new PdfParseTimeoutError();
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
      finish(() => reject(abortError()));
    };
    const timer = setTimeout(() => {
      cancelBestEffort();
      finish(() => reject(new PdfParseTimeoutError()));
    }, remaining);
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function isPasswordError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const named = err as { name?: unknown; message?: unknown };
    if (named.name === 'PasswordException') return true;
    if (typeof named.message === 'string' && /password/i.test(named.message)) return true;
  }
  return false;
}

/** Normalize a line for repeated-header/footer matching (digits collapsed so "Page 3 of 10" matches across pages). */
function headerFooterKey(line: string): string {
  return line.trim().toLowerCase().replace(/\d+/g, '#');
}

function extractPageText(items: TextContentItems): string {
  let text = '';
  let lastY: number | null = null;
  for (const item of items) {
    if (!('str' in item)) continue; // skip TextMarkedContent
    const transform: unknown[] = Array.isArray(item.transform) ? item.transform : [];
    const y = typeof transform[5] === 'number' ? transform[5] : null;
    if (text.length > 0 && !text.endsWith('\n')) {
      if (lastY !== null && y !== null && Math.abs(y - lastY) > SAME_LINE_Y_TOLERANCE) {
        text += '\n';
      } else if (!text.endsWith(' ') && item.str.length > 0 && !item.str.startsWith(' ')) {
        text += ' ';
      }
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    if (y !== null) lastY = y;
  }
  return text;
}

/** Drop lines whose normalized form repeats on ≥ 60% of pages (headers/footers). */
function stripRepeatedLines(pageTexts: string[]): string[] {
  if (pageTexts.length < HEADER_FOOTER_MIN_PAGES) return pageTexts;
  const pageCounts = new Map<string, number>();
  for (const page of pageTexts) {
    const seen = new Set<string>();
    for (const line of page.split('\n')) {
      const key = headerFooterKey(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1);
    }
  }
  const minPages = Math.max(2, Math.ceil(pageTexts.length * HEADER_FOOTER_FRACTION));
  const repeated = new Set<string>();
  for (const [key, count] of pageCounts) {
    if (count >= minPages) repeated.add(key);
  }
  if (repeated.size === 0) return pageTexts;
  return pageTexts.map((page) =>
    page
      .split('\n')
      .filter((line) => {
        const key = headerFooterKey(line);
        return !key || !repeated.has(key);
      })
      .join('\n'),
  );
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

export async function parsePdfEngine(
  bytes: ArrayBuffer,
  name: string,
  options: PdfEngineOptions,
): Promise<PdfParseResult> {
  const fallbackTitle = cleanFilename(name);
  const signal = options.signal;
  const deadline = Date.now() + PDF_PARSE_TIMEOUT_MS;
  await beforePdfDeadline(workerSrcReadyOnce(), deadline, () => undefined, signal);
  // NOTE: pdf.js transfers the underlying buffer to its worker; callers must
  // not rely on `bytes` afterwards (the coordinator hashes before parsing,
  // and parsePdf's worker route hands this engine a dedicated copy).
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  });
  let destroyStarted: Promise<void> | null = null;
  const destroyTask = (): void => {
    if (!destroyStarted) destroyStarted = task.destroy().catch(() => undefined);
  };
  let title = fallbackTitle;
  const pageTexts: string[] = [];
  // url -> label; first non-empty label wins for a URL linked multiple times
  const linkLabels = new Map<string, string>();
  let failedPages = 0;
  try {
    const doc = await beforePdfDeadline(task.promise, deadline, destroyTask, signal);

    try {
      const meta = await beforePdfDeadline(doc.getMetadata(), deadline, destroyTask, signal);
      const infoTitle = (meta.info as { Title?: unknown }).Title;
      if (typeof infoTitle === 'string' && infoTitle.trim().length > 0) {
        title = infoTitle.trim();
      }
    } catch (err) {
      if (signal?.aborted) throw abortReason(signal);
      if (err instanceof PdfParseTimeoutError) throw err;
      // metadata is optional; keep the filename title
    }

    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      try {
        const page = await beforePdfDeadline(doc.getPage(pageNo), deadline, destroyTask, signal);
        const content = await beforePdfDeadline(
          page.getTextContent(),
          deadline,
          destroyTask,
          signal,
        );
        pageTexts.push(extractPageText(content.items));
        // Link annotations carry the URL that the visible text ("click here")
        // never contains — extract them, and recover each link's label from
        // the text items under its rectangle (same page user-space coords).
        try {
          const spans = content.items.filter(
            (it): it is PdfTextSpan & (typeof content.items)[number] => 'str' in it,
          );
          const annotations = await beforePdfDeadline(
            page.getAnnotations(),
            deadline,
            destroyTask,
            signal,
          );
          for (const a of annotations) {
            const annot = a as { subtype?: unknown; url?: unknown; rect?: unknown };
            if (annot.subtype !== 'Link' || typeof annot.url !== 'string' || !annot.url) {
              continue;
            }
            const rect = annot.rect;
            const label =
              Array.isArray(rect) && rect.every((v) => typeof v === 'number')
                ? labelForRect(spans, rect as number[])
                : '';
            const existing = linkLabels.get(annot.url);
            if (existing === undefined || (existing === '' && label !== '')) {
              linkLabels.set(annot.url, label);
            }
          }
        } catch (err) {
          if (signal?.aborted) throw abortReason(signal);
          if (err instanceof PdfParseTimeoutError) throw err;
          // annotations are optional — never fail text extraction over them
        }
        page.cleanup();
      } catch (err) {
        if (signal?.aborted) throw abortReason(signal);
        if (err instanceof PdfParseTimeoutError) throw err;
        failedPages += 1;
        pageTexts.push('');
      }
    }
    const links: LinkRef[] = [...linkLabels]
      .slice(0, 500)
      .map(([url, text]) => ({ text, url }));

    let text = stripRepeatedLines(pageTexts).join('\n');
    text = text.replace(/-\n/g, ''); // join hyphenated line breaks
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < MIN_TEXT_CHARS) {
      // The ArrayBuffer has been transferred to pdf.js by this point, so the
      // fallback must rasterize from the still-open PDFDocumentProxy before
      // the loading task is destroyed in `finally`.
      try {
        const ocrMaxPages = options.ocrMaxPages;
        // ocr.ts can't read settings itself (see ocrLanguage.ts) — hand it
        // the language resolved by whichever side dispatched this parse.
        setActiveOcrLanguage(options.ocrLanguage);
        const ocrText = (
          await ocrPdfPages(doc, ocrMaxPages, options.onOcrProgress, signal)
        ).trim();
        if (ocrText.length >= MIN_TEXT_CHARS) {
          const pageLimitNote =
            doc.numPages > ocrMaxPages ? `; first ${ocrMaxPages} pages only` : '';
          return {
            title,
            text: ocrText,
            status: 'partial',
            warning: `Text recognized via OCR (scanned document${pageLimitNote})`,
            links,
          };
        }
      } catch (err) {
        if (signal?.aborted) throw abortReason(signal);
        // OCR is an optional fallback. Missing assets, unsupported WASM, or a
        // recognition failure must preserve the parser's existing unreadable
        // result instead of turning ingestion into a rejected file.
        console.warn('[knowledge-nebula] scanned-PDF OCR failed', err);
      }
      return {
        title,
        text,
        status: 'unreadable',
        warning: 'No extractable text (scanned images?)',
        links,
      };
    }
    if (failedPages > 0) {
      return {
        title,
        text,
        status: 'partial',
        warning: `${failedPages} of ${doc.numPages} page(s) could not be read`,
        links,
      };
    }
    return { title, text, status: 'ok', links };
  } catch (err) {
    if (signal?.aborted) throw abortReason(signal);
    if (err instanceof PdfParseTimeoutError) {
      let text = stripRepeatedLines(pageTexts).join('\n');
      text = text.replace(/-\n/g, '').replace(/\n{3,}/g, '\n\n').trim();
      return {
        title,
        text,
        status: text.length >= MIN_TEXT_CHARS ? 'partial' : 'unreadable',
        warning: err.message,
        links: [...linkLabels]
          .slice(0, 500)
          .map(([url, label]) => ({ text: label, url })),
      };
    }
    if (isPasswordError(err)) {
      return {
        title: fallbackTitle,
        text: '',
        status: 'unreadable',
        warning: 'Encrypted PDF — cannot read',
        links: [],
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      title: fallbackTitle,
      text: '',
      status: 'unreadable',
      warning: `Could not parse PDF (${message})`,
      links: [],
    };
  } finally {
    // Start cleanup, but never let a wedged pdf.js destroy promise recreate
    // the ingestion hang this deadline is meant to prevent.
    destroyTask();
  }
}
