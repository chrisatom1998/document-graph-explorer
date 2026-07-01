/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Privacy guarantee, enforced not promised: production builds ship a CSP that
 * blocks every network destination except
 *   - 'self'                       (app assets, demo corpus, cached model)
 *   - huggingface.co / hf.co CDNs  (one-time DOWNLOAD of the local embedding model)
 *   - generativelanguage.googleapis.com (Gemini — used ONLY when the user
 *     explicitly enables AI enrichment and supplies their own key)
 * Document content cannot reach any other host, even via a buggy dependency.
 * (Dev server stays permissive so HMR websockets work.)
 */
function injectCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'", // onnxruntime WASM
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob: https://huggingface.co https://*.huggingface.co https://*.hf.co https://generativelanguage.googleapis.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'knowledge-nebula:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// NOTE: no COOP/COEP headers on purpose — we use transferable Float32Arrays
// (not SharedArrayBuffer), and COEP: require-corp can break the ~25 MB
// HF Hub embedding-model download.
export default defineConfig({
  plugins: [react(), injectCsp()],
  worker: { format: 'es' },
  build: { target: 'esnext' },
  optimizeDeps: {
    // transformers.js does its own dynamic ORT backend imports; pre-bundling breaks it
    exclude: ['@huggingface/transformers'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
