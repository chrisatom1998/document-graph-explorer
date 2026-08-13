import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_EMBED_TEXT_BYTES } from '../config';
import { chunkText } from './chunker';
import { fnv1a32, fnv1a32Hex, sha256Hex } from './hash';
import {
  addToSemanticIndex,
  buildSemanticIndex,
  MAX_DUPLICATE_PAIRS,
  semanticEdges,
} from './similarity';
import { randomSpherePoint } from './spawnPosition';

describe('Adversarial Test Suite - Milestone 2', () => {
  describe('1. Hash Functions (hash.ts)', () => {
    it('sha256Hex produces exact match against Node native crypto sha256', async () => {
      const testCases = [
        '',
        'a',
        'hello world',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        '🚀 Multi-byte 🌐 Unicode & Emojis test 🦔',
        'Line 1\nLine 2\r\nLine 3\tTabbed',
        '\0Null\0Bytes\0In\0String\0',
        'A'.repeat(100000), // 100KB payload
      ];

      for (const text of testCases) {
        const expected = createHash('sha256').update(text).digest('hex');
        const actual = await sha256Hex(text);
        expect(actual).toBe(expected);

        // Also test Uint8Array input
        const bytes = new TextEncoder().encode(text);
        const actualFromBuffer = await sha256Hex(bytes.buffer);
        expect(actualFromBuffer).toBe(expected);
      }
    });

    it('fnv1a32 and fnv1a32Hex consistency and standard FNV-1a 32-bit test vectors', () => {
      // Standard FNV-1a 32 test vectors reference values:
      // "" -> 0x811c9dc5 = 2166136261
      // "a" -> 0xe40c292c = 3826002220
      // "foobar" -> 0xbf9cf968 = 3214735720
      expect(fnv1a32('')).toBe(2166136261);
      expect(fnv1a32Hex('')).toBe('811c9dc5');

      expect(fnv1a32('a')).toBe(3826002220);
      expect(fnv1a32Hex('a')).toBe('e40c292c');

      expect(fnv1a32('foobar')).toBe(3214735720);
      expect(fnv1a32Hex('foobar')).toBe('bf9cf968');

      // Check invariant: fnv1a32Hex(s) MUST ALWAYS equal fnv1a32(s).toString(16).padStart(8, '0')
      const samples = [
        '',
        'a',
        'b',
        'hello',
        'world',
        'document-graph-explorer',
        '1234567890',
        '🎉',
      ];
      for (const sample of samples) {
        const num = fnv1a32(sample);
        const hex = fnv1a32Hex(sample);
        expect(hex).toBe(num.toString(16).padStart(8, '0'));
        expect(num).toBeGreaterThanOrEqual(0);
        expect(num).toBeLessThanOrEqual(0xffffffff);
      }
    });

    it('fnv1a32 treats string and Uint8Array identical for multi-byte UTF-8', () => {
      const text = 'Complex 🌟 Multi-Byte UTF-8 String: €100 for café & naïve';
      const bytes = new TextEncoder().encode(text);
      expect(fnv1a32(bytes)).toBe(fnv1a32(text));
      expect(fnv1a32Hex(bytes)).toBe(fnv1a32Hex(text));
    });
  });

  describe('2. Bounded Similarity Indexing (similarity.ts)', () => {
    it('buildSemanticIndex sorts candidates descending and respects topK bound', () => {
      const ids = ['d1', 'd2', 'd3', 'd4', 'd5'];
      const dims = 4;
      // Unit vectors
      const v1 = new Float32Array([1, 0, 0, 0]);
      const v2 = new Float32Array([0.9, 0.43588989, 0, 0]); // sim ~0.9 with v1
      const v3 = new Float32Array([0.8, 0.6, 0, 0]);        // sim ~0.8 with v1
      const v4 = new Float32Array([0.7, 0.71414284, 0, 0]); // sim ~0.7 with v1
      const v5 = new Float32Array([0.6, 0.8, 0, 0]);        // sim ~0.6 with v1

      const vectors = new Float32Array(5 * dims);
      vectors.set(v1, 0);
      vectors.set(v2, 4);
      vectors.set(v3, 8);
      vectors.set(v4, 12);
      vectors.set(v5, 16);

      const index = buildSemanticIndex(ids, vectors, dims, { threshold: 0.5, topK: 2 });
      expect(index.top[0]).toHaveLength(2);
      // d1 top-2 candidates should be d2 (0.9) and d3 (0.8) in descending order
      expect(index.top[0][0].j).toBe(1);
      expect(index.top[0][0].sim).toBeCloseTo(0.9, 3);
      expect(index.top[0][1].j).toBe(2);
      expect(index.top[0][1].sim).toBeCloseTo(0.8, 3);
    });

    it('incremental addToSemanticIndex produces identical result to buildSemanticIndex', () => {
      const dims = 3;
      const ids = Array.from({ length: 20 }, (_, i) => `doc_${i}`);
      const vectors = new Float32Array(20 * dims);
      for (let i = 0; i < 20; i++) {
        const x = Math.sin(i);
        const y = Math.cos(i);
        const z = Math.sin(i * 2);
        const norm = Math.hypot(x, y, z) || 1;
        vectors[i * dims] = x / norm;
        vectors[i * dims + 1] = y / norm;
        vectors[i * dims + 2] = z / norm;
      }

      const params = { threshold: 0.3, topK: 5, dupThreshold: 0.95 };

      // Full rebuild
      const fullIndex = buildSemanticIndex(ids, vectors, dims, params);

      // Incremental build (first 10, then add 10)
      const initIndex = buildSemanticIndex(ids.slice(0, 10), vectors.subarray(0, 10 * dims), dims, params);
      const incIndex = addToSemanticIndex(
        initIndex,
        ids.slice(10),
        vectors.subarray(10 * dims),
        params
      );

      expect(incIndex.ids).toEqual(fullIndex.ids);
      expect(incIndex.dims).toBe(fullIndex.dims);
      expect(incIndex.top).toEqual(fullIndex.top);
      expect(incIndex.duplicates).toEqual(fullIndex.duplicates);
    });

    it('bounded duplicate pairs list caps at MAX_DUPLICATE_PAIRS (512) and remains sorted', () => {
      const n = 50; // 50 docs -> 50*49/2 = 1225 pairs
      const dims = 2;
      const ids = Array.from({ length: n }, (_, i) => `doc_${i}`);
      // All docs have identical unit vector [1, 0] -> cosine sim = 1.0
      const vectors = new Float32Array(n * dims);
      for (let i = 0; i < n; i++) {
        vectors[i * dims] = 1;
        vectors[i * dims + 1] = 0;
      }

      const res = semanticEdges(ids, vectors, dims, { threshold: 0.5, topK: 10, dupThreshold: 0.9 });
      expect(res.duplicates.length).toBe(MAX_DUPLICATE_PAIRS);
      expect(res.duplicates.length).toBeLessThanOrEqual(512);

      // Check sorted order descending
      for (let i = 1; i < res.duplicates.length; i++) {
        expect(res.duplicates[i - 1].sim).toBeGreaterThanOrEqual(res.duplicates[i].sim);
      }
    });

    it('handles 0 candidates / empty inputs gracefully', () => {
      const emptyRes = semanticEdges([], new Float32Array(0), 128, { threshold: 0.5, topK: 5 });
      expect(emptyRes.edges).toEqual([]);
      expect(emptyRes.duplicates).toEqual([]);
    });
  });

  describe('3. Text Chunker (chunker.ts)', () => {
    it('handles empty and whitespace-only text gracefully', () => {
      expect(chunkText('')).toEqual({ chunks: [], truncated: false });
      expect(chunkText('   \n\n\t  ')).toEqual({ chunks: [], truncated: false });
    });

    it('splits text into chunks and carries overlap without word duplication exploding', () => {
      const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
      const text = words.join(' ');
      const result = chunkText(text, 100, 0.2); // ~77 words per chunk, ~15 overlap words

      expect(result.chunks.length).toBeGreaterThan(1);
      expect(result.truncated).toBe(false);

      // Verify that every chunk has text and words
      for (const chunk of result.chunks) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    });

    it('respects MAX_EMBED_TEXT_BYTES and sets truncated: true on huge document', () => {
      // Create text that exceeds MAX_EMBED_TEXT_BYTES (200 KB = 204,800 bytes)
      const paragraph = 'Word '.repeat(50) + '\n\n';
      const hugeText = paragraph.repeat(1200); // ~300 KB text
      const result = chunkText(hugeText);

      expect(result.truncated).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(0);

      let totalBytes = 0;
      const encoder = new TextEncoder();
      for (const chunk of result.chunks) {
        totalBytes += encoder.encode(chunk).byteLength;
      }
      expect(totalBytes).toBeLessThanOrEqual(MAX_EMBED_TEXT_BYTES);
    });

    it('handles single oversized paragraph without exploding chunk sizes', () => {
      const longWords = Array.from({ length: 1000 }, (_, i) => `longword_${i}`).join(' ');
      const result = chunkText(longWords, 50, 0.1);
      expect(result.chunks.length).toBeGreaterThan(5);
    });
  });

  describe('4. Spawn Position (spawnPosition.ts)', () => {
    it('generates points on spherical shell with expected distance bounds', () => {
      for (let i = 0; i < 100; i++) {
        const radius = 150;
        const jitter = 20;
        const [x, y, z] = randomSpherePoint(radius, jitter);

        const dist = Math.hypot(x, y, z);
        expect(dist).toBeGreaterThanOrEqual(radius - jitter - 1e-6);
        expect(dist).toBeLessThanOrEqual(radius + jitter + 1e-6);
      }
    });
  });
});
