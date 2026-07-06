/**
 * pdf.js 6.x's canvas renderer (Page.prototype.render, used only by the
 * SidePanel's live PDF preview — ui/PdfPreview.tsx) calls the brand-new
 * `Map.prototype.getOrInsertComputed` method internally (glyph/pattern
 * caching). It's part of a very recent TC39 proposal that's only just
 * landed in the newest V8/Chrome releases — Electron's bundled Chromium
 * lags behind, so every page render throws
 * "getOrInsertComputed is not a function" and the canvas is left blank
 * (visually indistinguishable from "nothing happened" since the page div's
 * CSS background is white). Text extraction (parsePdf) never hits this path,
 * so PDF ingestion itself isn't affected — only the rendered preview is.
 *
 * Runs on the MAIN THREAD only: canvas rendering can't happen in a worker
 * (no Canvas API there), so — unlike pdfUint8ArrayPolyfill.ts — there's no
 * need to splice this into pdf.js's separate worker script.
 */

/** True when the runtime already implements both upsert methods natively. */
export function hasMapUpsertSupport(): boolean {
  const proto = Map.prototype as unknown as Record<string, unknown>;
  return typeof proto.getOrInsertComputed === 'function' && typeof proto.getOrInsert === 'function';
}

/** Installs whichever of the two methods are missing. Safe to call unconditionally. */
export function installMapUpsertPolyfill(): void {
  const proto = Map.prototype as unknown as {
    getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
    getOrInsert?: (key: unknown, value: unknown) => unknown;
  };

  if (typeof proto.getOrInsertComputed !== 'function') {
    proto.getOrInsertComputed = function getOrInsertComputed(
      this: Map<unknown, unknown>,
      key: unknown,
      callback: (key: unknown) => unknown,
    ): unknown {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    };
  }
  if (typeof proto.getOrInsert !== 'function') {
    proto.getOrInsert = function getOrInsert(this: Map<unknown, unknown>, key: unknown, value: unknown): unknown {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    };
  }
}
