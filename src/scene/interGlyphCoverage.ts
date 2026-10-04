// Generated from public/fonts/Inter-Regular.woff using Troika's bundled Typr
// parser, matching FontParser.supportsCodePoint. The test verifies these ranges
// against the actual asset so replacing the font cannot silently break routing.
export const INTER_GLYPH_RANGES: readonly (readonly [number, number])[] = [
  [0, 0], [32, 126], [160, 172], [174, 255], [305, 305], [338, 339],
  [699, 700], [710, 710], [730, 730], [732, 732], [768, 769], [771, 772],
  [776, 777], [803, 803], [8194, 8194], [8201, 8201], [8203, 8203],
  [8211, 8212], [8216, 8218], [8220, 8222], [8226, 8226], [8230, 8230],
  [8242, 8243], [8249, 8250], [8260, 8260], [8364, 8364], [8482, 8482],
  [8593, 8593], [8595, 8595], [8722, 8722], [65279, 65279],
];

export function needsSystemFont(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (!INTER_GLYPH_RANGES.some(([start, end]) => code >= start && code <= end)) return true;
  }
  return false;
}
