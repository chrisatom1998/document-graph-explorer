import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Troika's bundled parser does not publish declarations.
import typrFactory from 'troika-three-text/libs/typr.factory.js';
// @ts-expect-error Troika's bundled WOFF decoder does not publish declarations.
import woff2otfFactory from 'troika-three-text/libs/woff2otf.factory.js';
import { INTER_GLYPH_RANGES, needsSystemFont } from './interGlyphCoverage';

describe('bundled Inter glyph coverage', () => {
  it('matches the actual font asset using the same parser as Troika', () => {
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('window', globalThis);
    try {
      const bytes = readFileSync(new URL('../../public/fonts/Inter-Regular.woff', import.meta.url));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const typr = typrFactory();
      const font = typr.parse(woff2otfFactory()(buffer))[0];
      const ranges: [number, number][] = [];
      for (let code = 0; code <= 0x10ffff; code++) {
        if (typr.U.codeToGlyph(font, code) > 0) {
          const last = ranges.at(-1);
          if (last && last[1] === code - 1) last[1] = code;
          else ranges.push([code, code]);
        }
      }
      expect(INTER_GLYPH_RANGES).toEqual(ranges);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['Architecture — café…', 'Cluster · 12', 'Cost €50', 'Simple ASCII'])('keeps %s on Inter', (text) => {
    expect(needsSystemFont(text)).toBe(false);
  });

  it.each(['東京 計画 📚', 'مرحبا بالعالم', 'नमस्ते', '👩🏽‍💻', 'Москва'])('uses native fonts for %s', (text) => {
    expect(needsSystemFont(text)).toBe(true);
  });
});
