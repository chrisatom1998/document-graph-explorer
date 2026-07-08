# Phase 2 — Local Extractive Chat (flagship) — design

**Date:** 2026-07-04
**Status:** Approved
**Program:** Improvement program Phase 2 (spec §1.1 local chat + §2.5 test harness)

## Problem

Chat requires Gemini. In the airgap build (the corp-distribution target) and in the
normal build with enrichment off / no key, `sendChatMessage` just refuses. Yet the
retrieval half of RAG already runs fully locally — so the tool can answer questions
offline without any LLM.

## Goal

When Gemini is unavailable, answer a chat question **by extraction**: embed the
question locally, retrieve the best-matching passages, and render them verbatim,
grouped by source document, with the existing clickable citations. Make chat
available in the airgap build. No new runtime dependencies; no local LLM.

## Architecture (reuse-first — verified against the codebase)

The seam is inside `sendChatMessage` (`src/chat/ragChat.ts`). Everything up to and
including retrieval is already local and stays; only the Gemini
prompt→`fetch`→SSE-stream section is replaced by a local formatter when Gemini
isn't available.

Reused as-is (all already local, no network):
- `embedQuery(text): Promise<Float32Array>` (`src/pipeline/coordinator.ts`) — local, works under AIRGAP.
- `retrieveChunks(query): Promise<RetrievedChunk[]>` (`src/chat/ragChat.ts`) — chunk-level dot-product over `chunkStore` (which retains verbatim `texts[]`), floor `RAG_MIN_SCORE=0.3`, top `RAG_TOP_K=8`, with a doc-level fallback for imported graphs. `RetrievedChunk = { docId, docTitle, chunkIndex, text, score }`.
- `bestChunkSources(chunks): ChatSource[]` (`src/chat/ragChat.ts`) — best chunk per doc. `ChatSource = { docId, snippet, score }`.
- Citation UI: `SourceChips` in `src/ui/ChatPanel.tsx` → `handleSourceClick` (`setSelected` + `sendCamera('frameNode',[docId])`) and `openDocument(docId)`. Powered by `ChatMessage.sources`.
- `ChatMessage`/`ChatSource` shapes and `useChatStore` `addMessage`/`updateMessage` (`src/store/chatStore.ts`).
- `ChatMarkdown` (`src/chat/ChatMarkdown.tsx`) renders assistant markdown.

## Design

### Behavior matrix (in `sendChatMessage`)

| Condition | Path |
|---|---|
| `!AIRGAP` and `enrichEnabled` and key present | **Gemini generative** (unchanged) |
| `AIRGAP`, OR enrichment off, OR no key | **Local extractive** (new) |

So local extractive is the answer path whenever Gemini isn't available — replacing
today's three refusal branches (the `AIRGAP` guard emitting `AIRGAP_MESSAGE`, and
the `!enrichEnabled || !key` early return). No new user toggle.

New control flow: add user message → `retrieveChunks(question)` (local) → branch:
Gemini available ⇒ existing generative path; else ⇒ extractive formatter → single
`addMessage({ role:'assistant', text, sources })`. The AIRGAP embedding path
(`embedQuery`) never touches the network, so retrieval works air-gapped.

### Extractive formatter (the one genuinely new unit)

`formatExtractiveAnswer(question: string, chunks: RetrievedChunk[]): { text: string; sources: ChatSource[] }`
in a new module `src/chat/extractiveAnswer.ts`.

- Dedupe to the best-scoring chunk per document (reuse/share `bestChunkSources`
  logic), take the top **`EXTRACT_MAX_PASSAGES` = 4** by score.
- `text` is markdown: a one-line lead (`Top passages from your documents for
  "<question>":`) followed, per passage, by the doc title and a blockquote of the
  verbatim chunk text truncated to **`EXTRACT_PASSAGE_CHARS` = 600** chars
  (ellipsis if cut, on a word boundary). These constants go in `src/config.ts`.
- `sources` = the `ChatSource[]` for those passages (drives the existing chips).
- **Empty case:** if `chunks` is empty (nothing ≥ floor), return a fixed
  `text = "I couldn't find anything relevant to that in your documents."` and
  `sources = []`. (Honest, no fabricated answer.)

Pure and synchronous — unit-tested with the existing node vitest, no jsdom.

### UI

- `src/App.tsx`: change `{!AIRGAP && <ChatPanel />}` → `<ChatPanel />` (chat now
  works air-gapped).
- `src/ui/ChatPanel.tsx`: when the answer path will be local (airgap, or
  enrichment off / no key), show a small one-line hint near the input, e.g.
  "Offline mode — answers are exact passages from your documents." Reads
  `AIRGAP`/settings; no behavior in the component itself.
- **Out of scope this phase:** the per-doc "Ask AI" panel (`DocAiSection`) and the
  Settings enrichment section stay Gemini-gated (hidden under AIRGAP). Local
  extractive summaries are Phase 3 (§1.2).

### Test harness (§2.5)

- Add **devDependencies only**: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- Keep the single Vitest config (root `environment: 'node'`), and broaden
  `include` to `['src/**/*.test.{ts,tsx}']`. Component tests opt into jsdom
  **per file** with a top-of-file `// @vitest-environment jsdom` directive and
  `import '@testing-library/jest-dom/vitest'` — no `test.projects`/workspace
  config, no global setup file, so existing node `.ts` tests are unaffected. This
  also gives the pre-existing `pdfjs-dist` `DOMMatrix` stub a real home.
- Tests: the extractive formatter (node); `ChatPanel` renders an offline hint and
  a local answer under AIRGAP; airgap UI gating (badge shown, Ask-AI/enrichment
  hidden, chat shown) — component tests.

### Update existing test

`src/chat/ragChat.airgap.test.ts` currently asserts the AIRGAP branch emits
`AIRGAP_MESSAGE` and never fetches. Update it: under AIRGAP, `sendChatMessage`
must still never `fetch`, but now produces an **assistant** message from local
extraction (with `sources` when passages match, or the honest empty message when
not) — not the refusal. Keep the no-`fetch` assertion (the core guarantee).

## Non-goals

- No local generative LLM (extractive only, per the approved decision).
- No new runtime dependencies (test libs are devDependencies).
- No change to the Gemini generative path when it is available.
- `DocAiSection`/Settings-enrichment local modes (deferred).

## Acceptance criteria

- In a `build:airgap` preview, opening chat and asking a question returns verbatim
  cited passages (or the honest empty message), with **zero network requests** and
  clickable citations that fly to the source node.
- Normal build with enrichment on + key: Gemini generative path unchanged.
- Normal build with enrichment off: chat answers locally instead of refusing.
- `npm run build:airgap` still passes `verify-airgap` (no new external host).
- `npm test` runs both node and jsdom test projects green; the airgap chat test
  asserts the local answer + no fetch.
- No new runtime dependency in `package.json` `dependencies`.
