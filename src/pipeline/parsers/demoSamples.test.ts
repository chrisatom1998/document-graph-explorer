/**
 * Regression guard for the committed demo corpus (public/demo): the corpus is
 * exactly the files generated for the office/PDF sample-data feature — 8 txt /
 * 10 docx / 15 pdf / 3 pptx, no markdown — every listed file exists on disk,
 * and every office sample parses cleanly with the real parser (binary-safe
 * end to end — these are the actual bytes the demo loader fetches). PDF
 * extraction runs on pdf.js in the browser and is covered by the e2e check
 * instead.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOffice } from './office';

const DEMO_DIR = join(__dirname, '../../../public/demo');

const manifest = JSON.parse(
  readFileSync(join(DEMO_DIR, 'manifest.json'), 'utf-8'),
) as { files: string[] };

const byExt = (ext: string): string[] => manifest.files.filter((f) => f.endsWith(ext));

describe('demo corpus manifest', () => {
  it('has the agreed composition: 8 txt, 10 docx, 15 pdf, 3 pptx, no markdown', () => {
    expect(byExt('.md')).toHaveLength(0);
    expect(byExt('.txt')).toHaveLength(8);
    expect(byExt('.docx')).toHaveLength(10);
    expect(byExt('.pdf')).toHaveLength(15);
    expect(byExt('.pptx')).toHaveLength(3);
    expect(manifest.files).toHaveLength(36);
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

describe('demo office samples parse with the real parser', () => {
  const officeFiles = [
    ...byExt('.docx').map((f) => ({ f, type: 'docx' as const })),
    ...byExt('.pptx').map((f) => ({ f, type: 'pptx' as const })),
  ];

  it.each(officeFiles)('$f extracts a title, headings, and body text', async ({ f, type }) => {
    const buf = readFileSync(join(DEMO_DIR, f));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await parseOffice(bytes, f, type);
    expect(parsed.status).toBe('ok');
    // a real title from core metadata, not a filename fallback
    expect(parsed.title.length).toBeGreaterThan(5);
    expect(parsed.headings.length).toBeGreaterThan(0);
    // enough body text for embeddings/keywords to be meaningful
    expect(parsed.text.length).toBeGreaterThan(400);
  });
});
