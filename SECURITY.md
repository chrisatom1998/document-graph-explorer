# Security

Document Graph Explorer runs **entirely in the browser**. Parsing, embeddings,
similarity, clustering, and layout all execute client-side in web workers. There
is no server, no account, no telemetry, and no analytics.

## Where data can go

| Build / mode | External network |
|---|---|
| `npm run build:airgap` (air-gapped) | **None.** Zero external destinations — enforced, see below. |
| `npm run build`, AI enrichment **off** (default) | **None.** No document content leaves the browser. |
| `npm run build`, AI enrichment **on** with the **OpenRouter** provider (opt-in, user supplies an OpenRouter key) | Each document's full stored text is sent to `openrouter.ai`, which routes it to the model the user selected, **only** for the AI features the user explicitly triggers. Enormous files are capped at 240,000 characters. Off by default. |
| `npm run build`, chat provider set to **OpenRouter** (opt-in, user supplies an OpenRouter key) | The question and the document passages retrieved for it are sent to `openrouter.ai`, which routes them to the model the user selected. Local notes, tags, and cluster labels are excluded from chat context. Only when the user picks this provider and asks a question. Off by default. |
| `npm run build`, enrichment or chat provider set to **Ollama** (opt-in) | **No external network.** Requests go to a user-run Ollama server on this machine (`127.0.0.1:11434` / `localhost:11434`); nothing leaves the device. The CSP admits only those two loopback hosts for it. |
| `npm run build`, collaboration session started | Signaling WebSocket to `signaling.yjs.dev` so peers can find each other. Direct WebRTC uses **host ICE only** — public STUN (Google/Twilio) is disabled, so NAT traversal may fail. Shared over the room: view (selection id/title, camera, filters) and presence. Notes and tags sync **only if the user opts in** (off by default). Corpus text/bytes and local filesystem paths never leave this browser. A collab invite hash does not connect until the user confirms. Offline mode refuses collab/WebRTC the same way it guards fetch and WebSocket. Off until the user starts or confirms joining a session. |

> **Offline mode (Settings toggle) vs the air-gapped build:** the normal build
> includes an "Offline mode" toggle that blocks all external requests in
> JavaScript (per-call refusal plus a global fetch / WebSocket / WebRTC guard) and answers chat from
> your documents locally. Collaboration sessions cannot start while it is on, and RTCPeerConnection is given empty iceServers so default STUN cannot fire. It is a **behavioral** setting a user can flip off.
> For distribution where the guarantee must be enforced rather than configured,
> use the air-gapped build — its CSP physically removes the external network at
> the browser level and cannot be re-enabled at runtime.

The embedding model (BGE-small English), its WASM runtime, and the Tesseract.js OCR worker,
WASM core, and English language data are **self-hosted** in the app (`/models`,
`/assets`, `/ocr`) — they are never fetched from HuggingFace or a CDN
(`allowRemoteModels = false`, ORT and OCR asset paths pinned same-origin).

## Browser-local persistence and sharing

Named corpora, extracted document text, graph data, embeddings, layouts, chat
history, snapshots, original file bytes, and watched-folder handles are stored in
the browser's IndexedDB. A watched folder grants the app read access through the
browser's File System Access API; rescans happen only while the app is open and
permission may need to be granted again after a restart or browser policy change.

**Shareable URLs are an explicit disclosure action.** The Data menu shows a
confirmation before copying a link. The URL fragment contains titles, summaries
(up to 2000 characters), topics, entities, keywords, warnings, cluster data, and
connection evidence (up to 200 characters), so anyone who
receives the link can read that graph metadata. It excludes full document text,
original file bytes, local paths, modification times, embeddings, file handles,
and settings, and replaces content-derived node and edge IDs. Compact links also
copy that payload into a `?graph=` query parameter (when the full URL stays
under 4000 characters) because many chat apps drop everything after `#`.
Opening the link rewrites the address bar to a fragment-only URL. That first
request can appear in the host's access logs; later navigations do not resend
the payload. Recipients' browsers decode the graph locally.

## How the air-gapped guarantee is enforced (not just promised)

Three independent layers:

1. **Content-Security-Policy.** In the airgap build the CSP's `connect-src`
   drops every named host (OpenRouter, the Ollama loopback ports, and the yjs signaling server),
   leaving `'self' blob:` only, so the browser physically blocks every
   off-origin request — even from a buggy dependency.
2. **Runtime refusal.** The `AIRGAP` flag makes the enrichment/chat functions
   return before any `fetch`, independent of the CSP, and removes the AI UI
   entirely.
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

## Assessments

- [Security assessment of merged PRs (2026-07-09)](docs/security-assessment-2026-07-09-merged-prs.md) — review of PRs #1 and #2 for vulnerabilities and data leaks, plus follow-up remediations.

## Reporting a vulnerability

Report suspected security issues privately to the repository owner
(chrismjohnson@google.com) rather than opening a public issue.
