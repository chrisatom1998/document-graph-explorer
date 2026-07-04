/**
 * Single source of the app's Content-Security-Policy. In airgap builds the
 * only external connect-src host (Gemini) is removed, so the browser physically
 * blocks every off-origin request. Consumed by vite.config.ts's injectCsp
 * plugin at build time.
 */
export function buildCsp({ airgap }: { airgap: boolean }): string {
  const connectSrc = airgap
    ? "connect-src 'self' blob:"
    : "connect-src 'self' blob: https://generativelanguage.googleapis.com";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}
