# Changelog

All notable changes to Document Graph Explorer are documented here.

This project follows the Keep a Changelog format.

## [Unreleased]

### Changed
- Gemini calls now use task-specific stable models: 3.1 Flash-Lite for structured enrichment and 3.5 Flash for document Q&A and chat, with a single optional custom override.
- Local semantic search now uses self-hosted BGE small embeddings with retrieval-prefixed queries for better search, graph links, and local chat grounding.
- Gemini 3 requests use task-appropriate thinking levels and system instructions that treat document content as untrusted reference material.

## [1.0.0] - 2026-07-07

### Added
- Local-first document graph ingestion for Markdown, text, HTML, PDF, DOCX, PPTX, XLSX, JSON, YAML, and CSV.
- Worker-backed parsing, embedding, semantic linking, Louvain clustering, and force-directed layout.
- IndexedDB session restore, named snapshots, document removal, and original-file retention.
- Semantic search, path mode, corpus insights, optional Gemini enrichment, local extractive chat, and air-gapped builds.
- Toolbar Data menu for JSON graph export/import, PNG scene export, and confirm-before-import safety.
- App error boundary, global error capture, worker crash warnings, and Settings About diagnostics.
- Release workflow, deployment guide, and internal/proprietary license notice.

### Changed
- Version bumped from `0.1.0` to `1.0.0` for the production cut.

### Security
- Graph import validation sanitizes untrusted JSON before resetting the current graph.
- Air-gapped builds keep the zero-external-host CSP verification gate.
