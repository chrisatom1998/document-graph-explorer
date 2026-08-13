import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  BENCHMARK_DEMO_DOCUMENT_COUNT,
  GENERATED_DEMO_DOCUMENT_COUNT,
  createBenchmarkDemoDocuments,
  createGeneratedDemoDocuments,
  generatedDemoFilename,
  generatedDemoText,
  isGeneratedDemoFilename,
} from './generatedDocuments';
import { referenceEdges, type ReferenceDocInput } from '../pipeline/links';

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Real pdf.js extraction (legacy build runs in Node without a worker). */
async function extractPdfText(bytes: ArrayBuffer): Promise<{ title: unknown; text: string }> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata();
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      );
    }
    return { title: (meta.info as { Title?: unknown }).Title, text: pages.join('\n') };
  } finally {
    await task.destroy();
  }
}

describe('generated demo documents', () => {
  it('names files deterministically and validates them', () => {
    expect(generatedDemoFilename(1)).toBe(
      'knowledge-record-0001-platform-reliability.pdf',
    );
    const last = GENERATED_DEMO_DOCUMENT_COUNT;
    expect(isGeneratedDemoFilename(generatedDemoFilename(last), last)).toBe(true);
    // One past the end must not validate — session restore uses this to tell
    // reconstructable demo records from files the user actually dropped.
    expect(isGeneratedDemoFilename(generatedDemoFilename(last + 1), last)).toBe(false);
    expect(isGeneratedDemoFilename('knowledge-record-0001-wrong-theme.pdf', last)).toBe(
      false,
    );
    expect(isGeneratedDemoFilename('knowledge-record-0001-platform-reliability.txt', last)).toBe(
      false,
    );
  });

  it('emits unique text for every generated index', () => {
    const texts = Array.from({ length: GENERATED_DEMO_DOCUMENT_COUNT }, (_, i) =>
      generatedDemoText(i + 1),
    );
    expect(new Set(texts).size).toBe(GENERATED_DEMO_DOCUMENT_COUNT);
  });

  it('keeps same-theme pairs well below near-duplicate token overlap', () => {
    // Theme period is 20; compare several same-theme pairs across the corpus.
    // Old templated bodies scored ~0.92 Jaccard; Insights flags cosine ≥ 0.93.
    const pairs = [
      [1, 21],
      [2, 42],
      [7, 27],
      [20, 40],
      [24, 44],
      [4, 64],
    ] as const;
    for (const [a, b] of pairs) {
      const overlap = jaccard(tokens(generatedDemoText(a)), tokens(generatedDemoText(b)));
      expect(overlap, `indexes ${a} vs ${b}`).toBeLessThan(0.6);
    }
  });

  it('avoids long identical body lines that would become corpus boilerplate', () => {
    // Small enough now to check the whole corpus rather than a sample.
    const sampleIndexes = Array.from({ length: GENERATED_DEMO_DOCUMENT_COUNT }, (_, i) => i + 1);
    const lineDocCounts = new Map<string, number>();
    for (const index of sampleIndexes) {
      const seen = new Set<string>();
      for (const raw of generatedDemoText(index).split('\n')) {
        const line = raw.trim().toLowerCase();
        if (line.length < 25 || seen.has(line)) continue;
        seen.add(line);
        lineDocCounts.set(line, (lineDocCounts.get(line) ?? 0) + 1);
      }
    }
    const minDocs = Math.ceil(sampleIndexes.length * 0.6);
    const boilerplate = [...lineDocCounts.entries()].filter(([, n]) => n >= minDocs);
    expect(boilerplate).toEqual([]);
  });

  it('cites related records by exact filename so reference edges can form', () => {
    // Every record cites its same-theme neighbors (index ± theme period) and
    // one cross-theme partner; even indexes also cite a committed sample PDF.
    const text = generatedDemoText(42);
    expect(text).toContain(generatedDemoFilename(22));
    expect(text).toContain(generatedDemoFilename(62));
    // even index → cites a committed sample PDF (data-platform theme, slot 42 % 3)
    expect(text).toContain('postgres-performance-tuning.pdf');
    expect(generatedDemoText(21)).toContain(generatedDemoFilename(1));
  });

  it('keeps every cross-reference inside the corpus', () => {
    // The reference math reaches index ± (theme period × 2), so shrinking the
    // corpus too far would cite records that are never generated — dangling
    // filenames that quietly produce zero reference edges instead of failing.
    const valid = new Set(
      Array.from({ length: GENERATED_DEMO_DOCUMENT_COUNT }, (_, i) =>
        generatedDemoFilename(i + 1),
      ),
    );
    // Read from the shipped manifest (not a copy) so a citation to a sample
    // PDF that no longer ships fails here too.
    const manifest = JSON.parse(
      readFileSync(new URL('../../public/demo/manifest.json', import.meta.url), 'utf8'),
    ) as { files: string[] };
    const sampleFilenames = new Set(manifest.files);
    for (let index = 1; index <= GENERATED_DEMO_DOCUMENT_COUNT; index++) {
      const cited = generatedDemoText(index).match(/[\w-]+\.pdf/g) ?? [];
      expect(cited.length, `record ${index} cites nothing`).toBeGreaterThan(0);
      for (const name of cited) {
        expect(
          valid.has(name) || sampleFilenames.has(name),
          `record ${index} cites missing ${name}`,
        ).toBe(true);
      }
    }
  });

  it('produces reference edges between related records via the real edge pass', () => {
    const indexes = [1, 21, 41] as const;
    const docs: ReferenceDocInput[] = indexes.map((index) => {
      const text = generatedDemoText(index);
      return {
        id: `doc-${index}`,
        title: text.split('\n')[0]!.replace(/^#\s*/, ''),
        fileName: generatedDemoFilename(index),
        textLower: text.toLowerCase(),
        mdLinkTargets: [],
      };
    });
    const edges = referenceEdges(docs, 8);
    const pairs = new Set(edges.map((e) => `${e.source}|${e.target}`));
    // 1 ↔ 21 and 21 ↔ 41 are continuity/follow-up citations of each other.
    expect(pairs.has('doc-1|doc-21') || pairs.has('doc-21|doc-1')).toBe(true);
    expect(pairs.has('doc-21|doc-41') || pairs.has('doc-41|doc-21')).toBe(true);
  });

  it('builds the expected ingest file count with unique paths and valid PDF bytes', () => {
    const files = createGeneratedDemoDocuments(40);
    expect(files).toHaveLength(40);
    expect(new Set(files.map((f) => f.path)).size).toBe(40);
    expect(files.every((f) => f.name.endsWith('.pdf') && f.fileType === 'pdf')).toBe(true);
    // originals must be retained so the PDF preview / "Open original" work
    expect(files.every((f) => !f.reconstructable)).toBe(true);
    const headers = files.map((f) =>
      String.fromCharCode(...new Uint8Array(f.bytes.slice(0, 5))),
    );
    expect(headers.every((h) => h === '%PDF-')).toBe(true);
    // distinct content per record, same as the old text corpus guarantee
    expect(new Set(files.map((f) => f.bytes.byteLength)).size).toBeGreaterThan(20);
  });

  it('supports a 2000-doc benchmark corpus without drifting filenames or references', () => {
    const files = createBenchmarkDemoDocuments(BENCHMARK_DEMO_DOCUMENT_COUNT);
    expect(files).toHaveLength(BENCHMARK_DEMO_DOCUMENT_COUNT);
    expect(files[0]!.name).toBe(generatedDemoFilename(1, BENCHMARK_DEMO_DOCUMENT_COUNT));
    expect(files.at(-1)!.name).toBe(generatedDemoFilename(BENCHMARK_DEMO_DOCUMENT_COUNT, BENCHMARK_DEMO_DOCUMENT_COUNT));
    expect(new Set(files.map((f) => f.path)).size).toBe(BENCHMARK_DEMO_DOCUMENT_COUNT);
    expect(generatedDemoText(2000, undefined, BENCHMARK_DEMO_DOCUMENT_COUNT)).toContain(
      generatedDemoFilename(1980, BENCHMARK_DEMO_DOCUMENT_COUNT),
    );
  });

  it('round-trips a generated record through real pdf.js extraction', async () => {
    const [file] = createGeneratedDemoDocuments(1);
    const { title, text } = await extractPdfText(file!.bytes);
    expect(title).toBe(generatedDemoText(1).split('\n')[0]!.replace(/^#\s*/, ''));
    // cluster vocabulary and the cross-reference filenames survive extraction
    expect(text).toContain('Platform Reliability');
    expect(text).toContain(generatedDemoFilename(21));
    expect(text).toContain('KNEB-0001');
  });
});
