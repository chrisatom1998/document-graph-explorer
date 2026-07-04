# Improvement Program — Document Graph Explorer

**Date:** 2026-07-04
**Status:** Approved (program-level); each phase specced/planned/executed separately
**Owner:** Chris Johnson

## What this is

A decomposition doc, not a single implementation spec. "Do it all" spans 11
features across two themes chosen by the owner — **Smarter intelligence** and
**Corp-ready daily driver**. That is too large for one plan, so it is broken into
5 sequenced phases. **Each phase gets its own spec → implementation plan →
subagent execution → review → merge cycle** (the same process used for the
airgap feature). This document is the stable map they all reference.

Anchoring approach (approved): one flagship — **local chat that works in airgap
builds** — with corp-ready guard rails landing first to de-risk everything after.

## Guiding constraints (inherited, bind every phase)

- **Airgap-first:** every new capability must work in `npm run build:airgap` with
  zero external network. No new runtime dependency may add an external host; if a
  feature needs a model/wasm asset, self-host it in `public/` (the MiniLM/ORT
  pattern) and keep it inside the CSP. New deps are checked by the sanitize/verify
  gates and (once Phase 1 lands) CI.
- **Client-side only:** no servers, no telemetry, no accounts.
- **Data compatibility:** don't rename IndexedDB stores, `localStorage` keys, or
  the export `generator` field without a migration path (see the rename decision
  in the airgap spec).
- **Follow existing structure:** pipeline work lives in web workers; UI gates read
  the `AIRGAP` constant; tests are colocated `*.test.ts(x)`.

---

## Theme 1 — Smarter intelligence (all local, all airgap-compatible)

### 1.1 Local corpus chat — flagship ⭐
**Problem:** Chat requires Gemini; the airgap build has no Q&A even though the
retrieval half of RAG (embeddings + semantic search) already runs locally.
**Approach:** Add a retrieval-only answer mode to `src/chat/ragChat.ts` /
`ChatPanel`. Embed the question with the existing MiniLM worker, retrieve top-k
chunks via `src/search/semanticSearch.ts` scoring, and render an **extractive**
answer: best passages verbatim, grouped per source document, each with a citation
that flies the camera to the source node. Gemini stays the generative layer when
available; when `AIRGAP` (or enrichment off), chat degrades to this instead of
refusing.
**Effort:** M · **Acceptance:** in a `build:airgap` preview, a question returns
cited passages with zero network requests; the Task-2 refusal tests updated to
expect local answers rather than a refusal message.

### 1.2 Local extractive summaries
**Problem:** With enrichment off (the corp default), docs show "No summary
available yet."
**Approach:** TextRank-style extractive summarizer in the pipeline worker: score
sentences by centrality against the doc's own chunk embeddings (already computed),
select top 3–5. Fills `node.summary` for every doc, no API. Gemini enrichment,
when run, overwrites with abstractive summaries (existing path unchanged).
**Effort:** M · **Acceptance:** every parsed doc has a non-empty summary in a
fresh airgap session; enrichment overwrite path unchanged.

### 1.3 Cross-reference detection upgrade
**Problem:** Mention edges rely on title-string matching; real corpora link by
markdown links and relative paths, which are ignored.
**Approach:** In the parsers, resolve `[text](./other-doc.md)` and bare relative
paths against the dropped file set; add a high-weight `reference` edge kind with
the link text as evidence. Markdown-first; heading-anchor resolution is a stretch.
**Effort:** S–M · **Acceptance:** a corpus with relative markdown links shows
explicit reference edges carrying link-text evidence.

### 1.4 Multiword keyphrase extraction
**Problem:** TF-IDF keywords are single tokens ("rate", "limiting" not "rate
limiting"), weakening keyword edges and topic hubs.
**Approach:** RAKE/YAKE-style candidate phrases (stopword-delimited 1–3-word
n-grams) scored by TF-IDF over the corpus, replacing the unigram top-N
(`TFIDF_TOP_N` in `src/config.ts`). Feeds existing keyword-edge and topic-hub
logic unchanged.
**Effort:** S · **Acceptance:** topic chips/hubs show multiword phrases; keyword
edge quality spot-checked on the demo corpus.

### 1.5 OCR for scanned PDFs (pulled forward from H1 2027)
**Problem:** Scanned PDFs (common corp legacy docs) parse to nothing.
**Approach:** Tesseract.js, **self-hosted** (wasm + `eng` traineddata in
`public/`, CSP- and airgap-safe). Trigger only when pdf.js yields near-zero text;
lazy-load; per-page progress; page cap.
**Effort:** L · **Acceptance:** a scanned PDF produces readable text + a node in
both normal and airgap builds, with zero external requests.

## Theme 2 — Corp-ready daily driver

### 2.1 CI pipeline (first — it guards everything)
**Problem:** No CI; nothing continuously enforces the airgap guarantee.
**Approach:** GitHub Actions on push/PR: typecheck → lint → `vitest run` →
`npm run build` → `npm run build:airgap` (already fails on any CSP/host
violation). Optional bundle-size assertion added in 2.2.
**Effort:** S · **Acceptance:** a PR adding an external host to the CSP fails CI.

### 2.2 Load-time & bundle diet
**Problem (measured):** main chunk ~2.09 MB (610 KB gz) with Vite warnings;
pdf.worker 1.26 MB; ORT wasm 23.5 MB.
**Approach:** (a) `manualChunks` splitting three.js/R3F/postprocessing from app
code; (b) dynamic-import pdf.js only when a PDF is dropped; (c) evaluate ORT's
smaller non-asyncify/JSEP wasm variant; (d) route-level lazy-load for
Settings/Snapshot/Insights panels; (e) a load-time budget recorded in README and
asserted in CI.
**Effort:** M · **Acceptance:** main chunk < 1 MB pre-gzip; no Vite chunk
warning; PDF-free sessions never fetch pdf.worker.

### 2.3 Accessibility + keyboard navigation
**Problem:** Roadmap ranked this "Low", but corp adoption makes it a real
blocker.
**Approach:** Roving-focus keyboard nav over nodes (hidden list mirroring visible
nodes), Enter to open the side panel, consistent Esc; ARIA roles/labels on panels
(reuse `useFocusTrap`); **reduced-motion mode** (disable bloom/pulses/auto-orbit,
also a perf win); colorblind-safe cluster palette option.
**Effort:** M–L · **Acceptance:** full open-doc→read→close loop without a mouse;
`prefers-reduced-motion` respected.

### 2.4 Docs & security posture refresh
**Problem:** `docs/product-roadmap.md` and `docs/project-plan.md` still say
"Knowledge Nebula", omit Office formats (docx/pptx/xlsx shipped) and the airgap
build, and predate the rename.
**Approach:** Update both docs + README feature matrix; add **SECURITY.md** — the
corp-security artifact: the guarantee, the three enforcement layers, the DevTools
verification walkthrough, and the sanitize/verify gates.
**Effort:** S · **Acceptance:** no stale branding in docs; SECURITY.md answers
"does this phone home?" standalone.

### 2.5 Component-test harness
**Problem:** UI gating (airgap badges, panel logic) is verified only by typecheck
+ manual smoke; the pdfjs `DOMMatrix` stub papered over a missing browser-env
harness.
**Approach:** Add `@testing-library/react` + jsdom (devDeps only), a `*.test.tsx`
vitest project with `environment: 'jsdom'`, and first tests for AIRGAP UI gating +
ChatPanel modes.
**Effort:** S–M · **Acceptance:** `npm test` covers component gating; the
DOMMatrix workaround gets a proper home.

### 2.6 IndexedDB quota resilience
**Problem:** 1000+ doc corpora with embeddings can hit browser quota; today's
failure is a silent console warning.
**Approach:** `navigator.storage.estimate()` on ingest; warn before exceeding;
selective-caching mode (skip full-text or embeddings persistence for huge
corpora) via a Settings toggle.
**Effort:** M · **Acceptance:** an oversized corpus degrades with a visible,
actionable warning instead of silent cache failure.

---

## Sequencing

| Phase | Items | Rationale |
|---|---|---|
| **1 — Guard rails** | 2.1 CI · 2.4 docs/SECURITY.md | Cheap; protects everything after; docs unblock corp adoption |
| **2 — Flagship** | 1.1 local chat · 2.5 test harness | The airgap-Q&A story; test harness lands with the feature that needs it |
| **3 — Graph quality** | 1.4 keyphrases · 1.3 cross-refs · 1.2 local summaries | Independent, incremental; each visibly improves the graph |
| **4 — Reach** | 2.2 bundle diet · 2.3 a11y · 2.6 quota | Bigger lifts; benefit from CI + tests existing first |
| **5 — Stretch** | 1.5 OCR | Largest; self-hosting pattern proven by then |

Each phase is a checkpoint: its plan is written, executed by subagents, reviewed,
and merged before the next phase's plan is written. Phases 3's three items are
mutually independent and may be parallelized across worktrees if desired.

## Non-goals for this program

Roadmap items that do **not** serve the two chosen themes are explicitly deferred:
shareable snapshot URLs, snapshot diff view, 2D toggle mode, multi-corpus
workspaces, folder watching, Notion/Confluence export, plugin API. They remain on
the product roadmap for a later program.

## Success criteria (program-level)

- Airgap build gains local Q&A and local summaries — the tool is fully useful with
  zero network.
- CI enforces the airgap guarantee on every push.
- First-load weight materially reduced; no Vite chunk warnings.
- Keyboard-only operation and reduced-motion supported.
- Docs and SECURITY.md are accurate and answer corp-security questions standalone.
- Graph quality visibly improved (multiword topics, explicit cross-references).
