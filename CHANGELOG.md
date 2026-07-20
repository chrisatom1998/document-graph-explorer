# Changelog

All notable changes to Document Graph Explorer are documented here.

This project follows the Keep a Changelog format.

## [Unreleased]

### Fixed
- Resolve a permanent hang when switching to, deleting, or restoring a snapshot of a corpus with a watched folder: rebinding the watcher awaited a catch-up sync that was itself queued behind the operation awaiting it, leaving the corpus switcher disabled and every later drop or import stuck until reload.
- Stop a corpus switch from overwriting the outgoing workspace's saved chat transcript with an empty one, and stop a completed pipeline run from replacing a streaming answer with the last persisted snapshot. Loading and saving now derive the active workspace from store state at decision time rather than from a committed React effect scope.
- Require ~4px of pointer travel before a node drag pins a node, so an ordinary click no longer freezes it in the layout with no visual indication and only an undiscoverable double-click to release.
- Allow the OpenRouter chat provider in the production Content-Security-Policy. It was selectable in settings but blocked in every production build, so it only ever worked in dev.
- Retry watched-folder files that were deferred by the per-scan total size cap instead of recording their new timestamps and never indexing them again; files rejected on their own size are still skipped permanently.
- Drain an in-flight folder scan before storing a newly chosen watch folder, so the previous scan's manifest write can no longer clobber the new handle and silently resume watching the old folder.
- Serialize startup session restore through the ingest queue so files dropped during a slow restore no longer interleave with hydration.
- Invalidate the cached semantic index when embeddings are rebuilt, so similarity edges cannot be derived from the previous vector space.
- Accept documents whose ids collide with `Object.prototype` members (`constructor`, `__proto__`, `toString`) from imports and share links; they were silently dropped from the graph store while still being sent to the layout worker, and their degree counts were computed from inherited members.
- Scroll the active option into view in the graph navigator and search overlay, which move an `aria-activedescendant` highlight rather than DOM focus and so were not scrolled by the browser.
- Release GPU resources held by the starfield, nebula clouds, AI core, and edge geometry, which leaked shader programs and canvas textures on every 2D/3D toggle.
- Report chat failures with the existing `isError` flag rather than relying solely on an `"Error:"` text prefix, so rewording a message cannot silently readmit it to model history.
- Cancel an in-flight per-document AI stream when the selection changes or the panel unmounts, instead of running it to completion against the user's own API key.
- Keep the chat transcript from force-scrolling to the bottom on every streaming chunk, so an earlier answer can be re-read while a new one arrives.
- Only fail fast on an IndexedDB open that is actually blocked by another connection; a slow but healthy open (cold profile, large first upgrade) no longer degrades the whole visit to "persistence unavailable".
- Correct assistive-technology semantics and Escape handling in the corpus switcher, and remove a nested assertive live region in the toast host that could double-announce.

### Changed
- Scan document text once against an index of all titles and filenames instead of comparing every document against every other one. Measured on a synthetic corpus, reference-edge extraction drops from ~3.1s to ~0.19s at 500 documents and completes 2000 documents in ~1.2s, where the previous approach would have exceeded the aggregator timeout.
- Terminate and respawn the aggregator worker when a request times out, and scale that timeout with corpus size. A wedged pass previously starved every later lexical, semantic, and clustering request until reload.
- Dispatch queued worker jobs past ones whose resource is busy, so an embedding job waiting on model load no longer blocks parsing while general workers sit idle, and stop lending the pinned embedding worker to parse jobs except in a single-worker pool.
- Persist only documents whose text, chunks, or vectors actually changed rather than rewriting the whole corpus on every completed run and debounced auto-save.

### Documentation
- Correct the user guide's claim that chat history is ephemeral and memory-only; it is stored per workspace in browser-local IndexedDB, capped at the most recent 100 messages.
- Disclose the OpenRouter chat provider as a possible external destination in the security policy and deployment CSP examples.

## [1.1.5] - 2026-07-14

### Added
- Local English OCR fallback for scanned PDFs using bundled Tesseract.js assets, with progress reporting and a 20-page safety cap.
- Browser folder watching for supported File System Access environments, including automatic add/change/remove reconciliation, pause/reconnect controls, and focus-triggered rescans while the app is open.
- Backend-free shareable graph URLs with explicit metadata disclosure, bounded fragment decoding, sanitized identifiers, short source excerpts, and exclusion of original bytes, full document text, local paths, embeddings, and file handles.
- Named multi-corpus workspaces with independent persisted graphs, layouts, document references, and optional watched-folder state.

### Changed
- Kept corpus and folder-management code outside the eager app entry, bounded watched-folder metadata reads, and avoided repeatedly loading every saved graph just to refresh corpus summaries.

## [1.1.4] - 2026-07-12

### Fixed
- Block hardlink and symlink aliases to sensitive paths in the standalone subagent read/search tools.
- Cancel pending debounced chat-history saves when the corpus hash changes so Clear All cannot repopulate wiped chats.

## [1.1.3] - 2026-07-12

### Added
- Design report document under `docs/` for product and architecture reference.
- Coverage for Gemini enrichment consent-aligned excerpts and cache clear including chat history.

### Changed
- Reduce Gemini enrichment excerpt size to match the consent disclosure shown before enrichment is enabled.
- Clear persisted chat history when wiping local caches.
- Harden the standalone subagent runner and expand its tests.

## [1.1.2] - 2026-07-12

### Fixed
- Recover cleanly from PDF and embedding worker timeouts, validate persisted vectors, and rebuild missing indexes transactionally.
- Make search and imported-graph chat useful immediately through lexical metadata fallback and progressive semantic results.
- Fix mobile toolbar/modal/toast/counting issues and add keyboard/screen-reader document browsing plus progress semantics.

## [1.1.1] - 2026-07-12

### Added
- Provider-independent hybrid retrieval with reciprocal-rank fusion, passage diversification, and shared search/chat grounding.
- Durable chat history persistence across sessions.
- Optional retrieval benchmark panel (`?eval=retrieval`) and archived validation artifacts for regression checks.
- Runtime asset verification after standard and air-gapped builds.

### Changed
- Search and local RAG chat now share one retrieval path instead of separate semantic-only pipelines.

## [1.1.0] - 2026-07-11

### Added
- Batched procedural atmosphere volumes that follow live cluster centroids and make communities read as distinct spatial regions without obscuring graph links.
- Cluster-colored focus lighting around hovered and selected nodes.
- Tested cluster-field geometry with bounded radii and deterministic draw-budget prioritization.

### Changed
- Refined the 3D scene with explicit sRGB output, ACES filmic tone mapping, balanced hemisphere illumination, stronger key/rim lighting, and restrained exposure tuning.
- Integrated the new atmosphere with adaptive quality and reduced-motion behavior, including correct restoration after quality-tier changes.

### Fixed
- Replaced the self-referencing `--ease-out` CSS token so intended interface transitions render correctly.
- Regenerated cross-platform optional dependency metadata so clean Linux and Docker installs succeed under npm 11.

## [1.0.1] - 2026-07-10

### Changed
- Align package metadata with the `v1.0.1` patch release so the automated release workflow can publish standard and air-gapped web artifacts.

## [1.0.0] - 2026-07-10

### Added
- Local-first document graph ingestion for Markdown, text, HTML, PDF, DOCX, PPTX, XLSX, JSON, YAML, and CSV.
- Worker-backed parsing, embedding, semantic linking, Louvain clustering, and force-directed layout.
- IndexedDB session restore, named snapshots, document removal, and original-file retention.
- Semantic search, path mode, corpus insights, optional Gemini enrichment, local extractive chat, and air-gapped builds.
- Toolbar Data menu for JSON graph export/import, PNG scene export, and confirm-before-import safety.
- App error boundary, global error capture, worker crash warnings, and Settings About diagnostics.
- Release workflow, deployment guide, and GNU GPL v3 license.

### Changed
- Version bumped from `0.1.0` to `1.0.0` for the production cut.
- Electron app identifiers use Document Graph Explorer branding (`com.documentgraph.explorer`).
- Gemini calls now use task-specific stable models: 3.1 Flash-Lite for structured enrichment and 3.5 Flash for document Q&A and chat, with a single optional custom override.
- Local semantic search now uses self-hosted BGE small embeddings with retrieval-prefixed queries for better search, graph links, and local chat grounding.
- Gemini 3 requests use task-appropriate thinking levels and system instructions that treat document content as untrusted reference material.

### Security
- Graph import validation sanitizes untrusted JSON before resetting the current graph.
- Air-gapped builds keep the zero-external-host CSP verification gate.
