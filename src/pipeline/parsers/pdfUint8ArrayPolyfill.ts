/**
 * pdf.js 6.x calls the brand-new `Uint8Array` base64/hex methods internally
 * (fingerprint hashing in its worker, data-URI/signature encoding on the
 * main thread). They landed in recent V8/Chrome, but Electron's bundled
 * Chromium lags behind whatever browser this app usually gets dev-tested
 * in — so the packaged desktop .app can hit
 * "x.toHex is not a function" / "x.fromBase64 is not a function" on every
 * single PDF import while the exact same code works everywhere else.
 *
 * `hasUint8ArrayBase64HexSupport` / `installUint8ArrayBase64HexPolyfill` are
 * used on the main thread (pdf.ts) AND, when needed, spliced — via
 * `installUint8ArrayBase64HexPolyfill.toString()` — in front of pdf.js's
 * separately-loaded dedicated worker script (see pdf.ts's
 * `ensureWorkerSrc`). Keep `installUint8ArrayBase64HexPolyfill` a
 * free-standing function with NO closures over anything outside its own
 * body — the worker copy runs from a completely different module/global
 * scope than this file.
 */

/** True when the runtime already implements the full set natively. */
export function hasUint8ArrayBase64HexSupport(): boolean {
  const proto = Uint8Array.prototype as unknown as Record<string, unknown>;
  const ctor = Uint8Array as unknown as Record<string, unknown>;
  return (
    typeof proto.toHex === 'function' &&
    typeof proto.toBase64 === 'function' &&
    typeof ctor.fromHex === 'function' &&
    typeof ctor.fromBase64 === 'function'
  );
}

/**
 * Prebuilt IIFE source, functionally identical to
 * `installUint8ArrayBase64HexPolyfill` below — computed once, here, as a
 * literal string constant instead of calling `.toString()` on the function
 * at runtime (see pdf.ts's `ensureWorkerSrc`, which used to splice
 * `installUint8ArrayBase64HexPolyfill.toString()` into pdf.js's worker
 * script source). Relying on `Function.prototype.toString()` to serialize a
 * function into re-executable source is fragile: minifiers/bundlers are
 * free to rename, hoist, or otherwise transform the function as long as its
 * OWN behavior is preserved, with no obligation to keep `.toString()`
 * producing standalone-valid source — a guarantee this codepath was quietly
 * depending on. A hardcoded constant has no such dependency.
 *
 * Must stay behaviorally in sync with `installUint8ArrayBase64HexPolyfill`
 * below by hand (both are tiny and rarely change).
 */
export const INSTALL_UINT8ARRAY_POLYFILL_SOURCE = `(function () {
  var HEX_CHARS = '0123456789abcdef';
  var proto = Uint8Array.prototype;
  var ctor = Uint8Array;
  if (typeof proto.toHex !== 'function') {
    proto.toHex = function toHex() {
      var out = '';
      for (var i = 0; i < this.length; i++) {
        out += HEX_CHARS[this[i] >> 4] + HEX_CHARS[this[i] & 0x0f];
      }
      return out;
    };
  }
  if (typeof ctor.fromHex !== 'function') {
    ctor.fromHex = function fromHex(hex) {
      var out = new Uint8Array(Math.floor(hex.length / 2));
      for (var i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    };
  }
  if (typeof proto.toBase64 !== 'function') {
    proto.toBase64 = function toBase64() {
      var binary = '';
      for (var i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
      return btoa(binary);
    };
  }
  if (typeof ctor.fromBase64 !== 'function') {
    ctor.fromBase64 = function fromBase64(base64) {
      var binary = atob(base64);
      var out = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    };
  }
})();`;

/** Installs whichever of the four methods are missing. Safe to call unconditionally. */
export function installUint8ArrayBase64HexPolyfill(): void {
  const HEX_CHARS = '0123456789abcdef';
  const proto = Uint8Array.prototype as unknown as {
    toHex?: () => string;
    toBase64?: () => string;
  };
  const ctor = Uint8Array as unknown as {
    fromHex?: (hex: string) => Uint8Array;
    fromBase64?: (base64: string) => Uint8Array;
  };

  if (typeof proto.toHex !== 'function') {
    proto.toHex = function toHex(this: Uint8Array): string {
      let out = '';
      for (let i = 0; i < this.length; i++) {
        out += HEX_CHARS[this[i] >> 4] + HEX_CHARS[this[i] & 0x0f];
      }
      return out;
    };
  }
  if (typeof ctor.fromHex !== 'function') {
    ctor.fromHex = function fromHex(hex: string): Uint8Array {
      const out = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    };
  }
  if (typeof proto.toBase64 !== 'function') {
    proto.toBase64 = function toBase64(this: Uint8Array): string {
      let binary = '';
      for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
      return btoa(binary);
    };
  }
  if (typeof ctor.fromBase64 !== 'function') {
    ctor.fromBase64 = function fromBase64(base64: string): Uint8Array {
      const binary = atob(base64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    };
  }
}
