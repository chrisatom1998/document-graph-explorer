# Changelog

All notable changes to Document Graph Explorer are documented here.

This project follows the Keep a Changelog format.

## [Unreleased]

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
