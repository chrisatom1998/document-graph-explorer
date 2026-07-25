import { describe, expect, it } from 'vitest';
import {
  GENERATED_DEMO_DOCUMENT_COUNT,
  createGeneratedDemoDocuments,
  generatedDemoFilename,
  generatedDemoText,
  isGeneratedDemoFilename,
} from './generatedDocuments';

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

describe('generated demo documents', () => {
  it('names files deterministically and validates them', () => {
    expect(generatedDemoFilename(1)).toBe(
      'knowledge-record-0001-platform-reliability.txt',
    );
    expect(isGeneratedDemoFilename(generatedDemoFilename(1964), 1964)).toBe(true);
    expect(isGeneratedDemoFilename('knowledge-record-0001-wrong-theme.txt', 1964)).toBe(
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
      [7, 207],
      [20, 1000],
      [50, 1050],
      [100, 1900],
    ] as const;
    for (const [a, b] of pairs) {
      const overlap = jaccard(tokens(generatedDemoText(a)), tokens(generatedDemoText(b)));
      expect(overlap, `indexes ${a} vs ${b}`).toBeLessThan(0.6);
    }
  });

  it('avoids long identical body lines that would become corpus boilerplate', () => {
    const sampleIndexes = Array.from({ length: 120 }, (_, i) => i * 16 + 1);
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

  it('builds the expected ingest file count with unique paths and bytes', () => {
    const files = createGeneratedDemoDocuments(40);
    expect(files).toHaveLength(40);
    expect(new Set(files.map((f) => f.path)).size).toBe(40);
    const bodies = files.map((f) => new TextDecoder().decode(f.bytes));
    expect(new Set(bodies).size).toBe(40);
    expect(files.every((f) => f.reconstructable)).toBe(true);
  });
});
