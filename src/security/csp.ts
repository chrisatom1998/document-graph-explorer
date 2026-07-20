/**
 * Single source of the app's Content-Security-Policy. In airgap builds both
 * external connect-src hosts (Gemini and OpenRouter) are removed, so the
 * browser physically blocks every off-origin request. Consumed by
 * vite.config.ts's injectCsp plugin at build time.
 *
 * Any host added here must also be reflected in docker/security-headers.conf,
 * the nginx example in DEPLOYMENT.md, and SECURITY.md's egress table — those
 * are hand-maintained copies, and a host missing from them is a feature that
 * silently fails in production.
 */
export function buildCsp({ airgap }: { airgap: boolean }): string {
  // connect-src deliberately omits data: — nothing legitimate fetches data:
  // URLs, so don't allow it. In airgap builds the opt-in AI hosts are dropped
  // too, leaving only 'self' and blob:.
  const connectSrc = airgap
    ? "connect-src 'self' blob:"
    : "connect-src 'self' blob: https://generativelanguage.googleapis.com https://openrouter.ai";
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' + blob: are both for onnxruntime: it compiles WASM and
    // boots its runtime via importScripts on a blob: URL — without blob: every
    // embedding fails ("importScripts … failed to load"). blob: script URLs can
    // only be minted by code that is ALREADY running same-origin JS, so this
    // doesn't widen the injection surface.
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
