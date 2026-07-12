# Changelog

All notable changes to Document Graph Explorer are documented here.

This project follows the Keep a Changelog format.

## [Unreleased]

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
