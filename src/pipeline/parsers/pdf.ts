/**
 * PDF text extraction via pdf.js — MAIN-THREAD ONLY. pdf.js spawns its own
 * worker (configured below); do NOT import this module from
 * pipeline.worker.ts.
 *
 * Cleanup heuristics (spec §9): drop header/footer lines repeated across
 * pages, join hyphenated line breaks. Never throws — encrypted or
 * zero-text PDFs come back as status 'unreadable' with a warning so they
 * surface as ghosted nodes rather than silent gaps.
 */

import * as pdfjs from 'pdfjs-dist';
import type { NodeStatus } from '../../model/types';
import { cleanFilename } from './txt';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface PdfParseResult {
  title: string;
  text: string;
  status: NodeStatus;
  warning?: string;
}

/** TextItem | TextMarkedContent — the root package doesn't re-export item types. */
type TextContentItems = Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>['items'];

const MIN_TEXT_CHARS = 40; // below this the PDF is considered unreadable
const HEADER_FOOTER_MIN_PAGES = 3; // repeated-line cleanup needs ≥ 3 pages
const HEADER_FOOTER_FRACTION = 0.6; // line repeats on ≥ 60% of pages
const SAME_LINE_Y_TOLERANCE = 2; // pt; larger y-jumps start a new line

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

export async function parsePdf(bytes: ArrayBuffer, name: string): Promise<PdfParseResult> {
  const fallbackTitle = cleanFilename(name);
  // NOTE: pdf.js transfers the underlying buffer to its worker; callers must
  // not rely on `bytes` afterwards (the coordinator hashes before parsing).
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const doc = await task.promise;

    let title = fallbackTitle;
    try {
      const meta = await doc.getMetadata();
      const infoTitle = (meta.info as { Title?: unknown }).Title;
      if (typeof infoTitle === 'string' && infoTitle.trim().length > 0) {
        title = infoTitle.trim();
      }
    } catch {
      // metadata is optional; keep the filename title
    }

    const pageTexts: string[] = [];
    let failedPages = 0;
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      try {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        pageTexts.push(extractPageText(content.items));
        page.cleanup();
      } catch {
        failedPages += 1;
        pageTexts.push('');
      }
    }

    let text = stripRepeatedLines(pageTexts).join('\n');
    text = text.replace(/-\n/g, ''); // join hyphenated line breaks
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < MIN_TEXT_CHARS) {
      return {
        title,
        text,
        status: 'unreadable',
        warning: 'No extractable text (scanned images?)',
      };
    }
    if (failedPages > 0) {
      return {
        title,
        text,
        status: 'partial',
        warning: `${failedPages} of ${doc.numPages} page(s) could not be read`,
      };
    }
    return { title, text, status: 'ok' };
  } catch (err) {
    if (isPasswordError(err)) {
      return {
        title: fallbackTitle,
        text: '',
        status: 'unreadable',
        warning: 'Encrypted PDF — cannot read',
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      title: fallbackTitle,
      text: '',
      status: 'unreadable',
      warning: `Could not parse PDF (${message})`,
    };
  } finally {
    try {
      await task.destroy();
    } catch {
      // task may already be destroyed after a load failure
    }
  }
}
