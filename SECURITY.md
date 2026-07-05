# Security

Document Graph Explorer runs **entirely in the browser**. Parsing, embeddings,
similarity, clustering, and layout all execute client-side in web workers. There
is no server, no account, no telemetry, and no analytics.

## Where data can go

| Build / mode | External network |
|---|---|
| `npm run build:airgap` (air-gapped) | **None.** Zero external destinations — enforced, see below. |
| `npm run build`, AI enrichment **off** (default) | **None.** No document content leaves the browser. |
| `npm run build`, AI enrichment **on** (opt-in, user supplies a Gemini key) | Document excerpts are sent to Google's Gemini API (`generativelanguage.googleapis.com`) **only** for the AI features the user explicitly triggers. Off by default. |

The embedding model (MiniLM) and its WASM runtime are **self-hosted** in the app
(`/models`, `/assets`) — they are never fetched from HuggingFace or a CDN
(`allowRemoteModels = false`, ORT `wasmPaths` pinned same-origin).

## How the air-gapped guarantee is enforced (not just promised)

Three independent layers:

1. **Content-Security-Policy.** The production CSP allows `connect-src 'self'
   blob:` only; in the airgap build the single external host (Gemini) is removed,
   so the browser physically blocks every off-origin request — even from a buggy
   dependency.
2. **Runtime refusal.** The `AIRGAP` flag makes the Gemini/chat functions return
   before any `fetch`, independent of the CSP, and removes the AI UI entirely.
3. **Post-build gate.** `npm run build:airgap` runs `scripts/verify-airgap.mjs`,
   which fails the build if the shipped CSP admits any external host, and
   `scripts/sanitize-airgap.mjs`, which strips inert third-party vendor strings
   (e.g. model-hub/CDN hostnames the ML library bundles as defaults but never
   contacts). CI runs this on every push to `main` and every pull request.

## Scope of the guarantee

"Zero external destinations" covers every **programmatic** request the app can
make (fetch/XHR, WebSocket, `sendBeacon`, external subresources, model download).
It does not override a user's own deliberate navigation: if a user's document
contains a link and the user clicks it, the viewer opens that URL in a new tab.
That sends none of the document's content and nothing loads without the click.

## Verify it yourself

```bash
npm run build:airgap
npx vite preview --outDir dist-airgap
```
Open the URL, then DevTools → **Network** → "Disable cache" → reload → drop a few
documents and interact. Every request's domain is the local origin; there are no
external domains and no CSP violations in the Console.

## Reporting a vulnerability

Report suspected security issues privately to the repository owner
(chrismjohnson@google.com) rather than opening a public issue.
