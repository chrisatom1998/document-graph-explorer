# Consolidated Roadmap — Phases A–E + P

**Date:** 2026-07-05
**Status:** Approved; Phase A quick wins and Phase P import safety shipped July 2026
**Supersedes:** the sequencing of Phases 3-5 in `2026-07-04-improvement-program-design.md` (its content is folded in below). Sources: that program spec, a full-codebase cloud review, and a production-readiness gap analysis. Some original spot-checks have since shipped and are marked below.

**Standing constraints (bind every phase):** airgap gates (sanitize/verify/CI) intact; no telemetry ever; new ML/wasm assets self-hosted; enrichment opt-in; no renaming of internal `knowledge-nebula` storage slugs without migration; each phase = spec/plan → subagent implementation → per-task review → final whole-branch review → merge to main.

## Phase A - Fixes & quick wins (shipped July 2026)
1. **Wire document removal**: shipped with Remove + confirm in SidePanel.
2. **Layout-worker error handling**: shipped with `onerror`/`onmessageerror`, respawn, and visible warnings.
3. **Emphasis bug**: shipped with edge-weight-aware emphasis extraction and regression coverage.
4. **High-risk pure-fn tests**: shipped for chat history turns, emphasis, and export/import sanitization paths.
5. **`no-floating-promises`** typed-lint slice: shipped.

## Phase P — Productionization
6. **Error containment**: app-level React error boundary (reload/export-data screen); global `error` + `unhandledrejection` handlers surfacing to a local-only error toast/panel; worker-crash surfacing.
7. **Release engineering**: LICENSE (owner to choose; default internal/proprietary notice), CHANGELOG.md, version bump to 1.0.0 at cut; CI job publishing verified `dist-airgap.zip` (+ `dist.zip`) as GitHub Release artifacts on tag; DEPLOYMENT.md (static hosting + required security headers per vite.config comment; nginx + generic examples).
8. **Diagnostics panel**: About section in Settings — version, browser, corpus size, last error; "copy diagnostics" button. Local-only (no telemetry).
9. **Import safety quick-win** (pulled from E): shipped July 2026 with confirm before import-over-existing corpus.

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

## Deferred
Shareable snapshot URLs, multi-corpus workspaces, folder watching, Notion/Confluence export, plugin API. 2D toggle shipped in July 2026.

## Strengths to preserve (do not regress)
Three-level dup detection; incremental parse/embed with cache hits; transferable-buffer recycling; dirty-flag rendering; chat streaming retry/cancel/block-reason handling; crash-safe auto-save ordering; CI-enforced airgap guarantee.
