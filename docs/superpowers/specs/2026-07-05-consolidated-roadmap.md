# Consolidated Roadmap — Phases A–E + P

**Date:** 2026-07-05
**Status:** Approved ("implement all of these")
**Supersedes:** the sequencing of Phases 3–5 in `2026-07-04-improvement-program-design.md` (its content is folded in below). Sources: that program spec, a full-codebase cloud review (verified spot-checks: `removeDocuments` unwired at coordinator.ts:911; layoutBridge has `onmessage` only; `filterActive` at Nodes.tsx:99 omits `minEdgeWeight`), and a production-readiness gap analysis (verified: no error boundary, no global error handlers, no LICENSE/CHANGELOG, no release/deploy story).

**Standing constraints (bind every phase):** airgap gates (sanitize/verify/CI) intact; no telemetry ever; new ML/wasm assets self-hosted; enrichment opt-in; no renaming of internal `knowledge-nebula` storage slugs without migration; each phase = spec/plan → subagent implementation → per-task review → final whole-branch review → merge to main.

## Phase A — Fixes & quick wins
1. **Wire document removal**: `removeDocuments()` (coordinator.ts:911) has zero callers. Add Remove (with confirm) to SidePanel.
2. **Layout-worker error handling**: add `onerror`/`onmessageerror` + respawn-or-visible-error (parity with pool.ts/aggregator).
3. **Emphasis bug**: include the edge-weight filter in `computeEmphasis`'s `filterActive` (Nodes.tsx:99); extract `scene/emphasis.ts`; regression test.
4. **High-risk pure-fn tests**: `buildHistoryTurns` (ragChat), `computeEmphasis`, export↔sanitize↔hydrate round-trip.
5. **`no-floating-promises`** (typed-lint slice) + fix fallout.

## Phase P — Productionization
6. **Error containment**: app-level React error boundary (reload/export-data screen); global `error` + `unhandledrejection` handlers surfacing to a local-only error toast/panel; worker-crash surfacing.
7. **Release engineering**: LICENSE (owner to choose; default internal/proprietary notice), CHANGELOG.md, version bump to 1.0.0 at cut; CI job publishing verified `dist-airgap.zip` (+ `dist.zip`) as GitHub Release artifacts on tag; DEPLOYMENT.md (static hosting + required security headers per vite.config comment; nginx + generic examples).
8. **Diagnostics panel**: About section in Settings — version, browser, corpus size, last error; "copy diagnostics" button. Local-only (no telemetry).
9. **Import safety quick-win** (pulled from E): confirm before import-over-existing corpus.

## Phase B — Run-lifecycle robustness
10. Serialize `runEnrichment` through `runChain` (race fix).
11. Split coordinator.ts (aggregator RPC client → topic synthesis → removal), before #12.
12. Ingest cancellation (AbortSignal through `runIngest`; stop button in ProgressStrip).
13. Persistent ingest failure report (failed/skipped/capped + per-file retry).

## Phase C — Graph quality (= program Phase 3)
14. Local extractive summaries (TextRank over existing chunk embeddings; airgap-safe).
15. Multiword keyphrases (RAKE/YAKE-style; MUST compute phrase-level IDF for keywordEdges — token IDF returns 0 for phrases and flattens edge weights; `textLower` already ships to the aggregator).
16. Insights: hub ranking + cluster stats; betweenness off main thread.

## Phase D — Reach (= program Phase 4)
17. Accessibility: node-list roving-focus nav, panel ARIA + focus restore, `aria-live` (chat/toasts/progress), SearchOverlay focus trap.
18. Bundle diet: manualChunks, lazy pdf.js, panel lazy-load, CI bundle-size assertion (main chunk currently 2.09 MB).
19. IndexedDB quota resilience (`storage.estimate()`, selective caching) + scoped hover recolor (perf at 4k nodes).

## Phase E — Product depth
20. Chat: per-corpus persistence; history-aware extractive answers; retrieval transparency.
21. Snapshot diff/compare; non-destructive snapshot load.
22. Search↔filter unification; edge-kind + date facets.
23. Legend/help popover; shortcut cheatsheet.
24. `noUncheckedIndexedAccess` migration (module-by-module).
25. OCR for scanned PDFs (self-hosted Tesseract; stretch).

## Deferred (unchanged non-goals)
Shareable snapshot URLs, 2D toggle, multi-corpus workspaces, folder watching, Notion/Confluence export, plugin API.

## Strengths to preserve (do not regress)
Three-level dup detection; incremental parse/embed with cache hits; transferable-buffer recycling; dirty-flag rendering; chat streaming retry/cancel/block-reason handling; crash-safe auto-save ordering; CI-enforced airgap guarantee.
