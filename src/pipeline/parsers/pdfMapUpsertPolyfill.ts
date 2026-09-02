/**
 * pdf.js 6.x's canvas renderer (Page.prototype.render, used only by the
 * SidePanel's live PDF preview — ui/PdfPreview.tsx) calls the brand-new
 * `Map.prototype.getOrInsertComputed` method internally (glyph/pattern
 * caching). It's part of a very recent TC39 proposal that's only just
 * landed in the newest V8/Chrome releases — Electron's bundled Chromium
 * lags behind, so every page render throws
 * "getOrInsertComputed is not a function" and the canvas is left blank
 * (visually indistinguishable from "nothing happened" since the page div's
 * CSS background is white). Text extraction never hits this path — only
 * canvas rendering does.
 *
 * The renderer runs in two scopes: ui/PdfPreview.tsx on the main thread, and
 * the OCR fallback rasterizing pages into an OffscreenCanvas inside the
 * dedicated pdf worker — so this installs in both (pdfEngine.ts at module
 * scope, pdf.worker.ts before the engine loads). Unlike
 * pdfUint8ArrayPolyfill.ts it never needs splicing into pdf.js's own nested
 * worker script: rendering happens on the API side, not in pdf.js's worker.
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
