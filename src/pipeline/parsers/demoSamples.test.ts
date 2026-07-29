/**
 * Regression guard for the committed demo corpus (public/demo): the corpus is
 * PDF-only — 36 committed sample PDFs (15 original samples plus 21 converted
 * from the earlier txt/docx/pptx set) and 64 deterministic generated PDF
 * records. Every static file exists on disk, is a real PDF, and extracts
 * meaningful text through pdf.js — the same engine the browser pipeline uses.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GENERATED_DEMO_DOCUMENT_COUNT } from '../../demo/generatedDocuments';

const DEMO_DIR = join(__dirname, '../../../public/demo');

const manifest = JSON.parse(
  readFileSync(join(DEMO_DIR, 'manifest.json'), 'utf-8'),
) as { files: string[]; generated?: { count?: number } };

describe('demo corpus manifest', () => {
  it('is PDF-only with exactly 100 total demo documents', () => {
    expect(manifest.files.filter((f) => !f.endsWith('.pdf'))).toEqual([]);
    expect(manifest.files).toHaveLength(36);
    // The manifest count drives the runtime; the constant drives the
    // cross-reference math. They must agree or records cite documents that
    // are never generated.
    expect(manifest.generated?.count).toBe(GENERATED_DEMO_DOCUMENT_COUNT);
    expect(manifest.files.length + (manifest.generated?.count ?? 0)).toBe(100);
  });

  it('lists only files that exist in public/demo', () => {
    const onDisk = new Set(readdirSync(DEMO_DIR));
    const missing = manifest.files.filter((f) => !onDisk.has(f));
    expect(missing).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(new Set(manifest.files).size).toBe(manifest.files.length);
  });
});

describe('demo sample PDFs extract text with real pdf.js', () => {
  it.each(manifest.files.map((f) => ({ f })))('$f parses and yields body text', async ({ f }) => {
    const buf = readFileSync(join(DEMO_DIR, f));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const task = getDocument({
      data: new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      verbosity: 0,
    });
    const doc = await task.promise;
    try {
      const pages: string[] = [];
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }
      // enough body text for embeddings/keywords to be meaningful
      expect(pages.join('\n').trim().length).toBeGreaterThan(400);
    } finally {
      await task.destroy();
    }
  });
});
