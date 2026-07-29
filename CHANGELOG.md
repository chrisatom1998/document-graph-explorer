# Changelog

All notable changes to Document Graph Explorer are documented here.

This project follows the Keep a Changelog format.

## [Unreleased]

## [1.1.14] - 2026-07-29

### Added
- Chat now picks its own model, independent of enrichment. The two workloads pull in opposite directions — chat is one request per question, so quality is affordable; enrichment is one request per 15 documents corpus-wide, where a large reasoning model turns minutes into hours — so each gets its own curated shortlist. Chat leads with flagship models (Claude Sonnet 5, GPT-5.4, Gemini 3.1 Pro) and defaults to Claude Sonnet 5; enrichment keeps the fast tier and defaults to Gemini 3.1 Flash Lite. Models are stored per provider, so switching providers back and forth keeps each choice, and a pre-split saved model carries into both.
- Inter-cluster bridge filaments in the 3D scene: sparse luminous ribbons spanning cluster centroids so topic neighborhoods stay visually connected without drawing every cross-cluster document edge.

### Changed
- AI enrichment, per-document AI, and chat no longer use Google Gemini. They now run through a user-selected provider — OpenRouter (cloud, user's API key) or a local Ollama server.
- Model selection is a curated dropdown rather than a free-text model ID. Enrichment's list is fast-tier only (Gemini 3.1/3.5 Flash Lite, Claude Haiku 4.5, GPT-5 mini, Mistral Small 3.2, Qwen3.7 Flash, GLM 4.7 Flash), each with at least a 200k context window for per-document AI. Lists are validated against OpenRouter's live catalog, and a previously-saved model stays selectable. Ollama's picker lists the models installed on your server, with a **Recheck installed models** button.
- Settings: replaced the Gemini API key fields with separate chat and enrichment provider selectors; the OpenRouter key (session-only by default) is shared, the model choices are not.
- Demo corpus is now 100 documents (36 committed sample PDFs + 64 generated records), down from 500. Every record is written as a real PDF and parsed back through pdf.js on load, which costs far more per document than the plain-text corpus it replaced; a cold load drops from ~52s to ~11s. Generated cross-references are unchanged in kind — a new test pins every cited filename to a document that actually exists, guarding the `count >= themes * 3` floor the reference math depends on.
- Side panel connections list collapses to the 8 strongest with a "Show all" toggle, and evidence collapses to one line per row. Previously every edge rendered every evidence line, pushing the Ask AI section off screen on well-connected documents.

### Fixed
- Enrichment was far slower than it needed to be on large corpora, from three compounding causes: batches ran strictly one at a time (34 sequential requests for a 500-document corpus), the 30-second request timeout was a wall clock rather than an inactivity deadline (so a merely-slow batch aborted and burned three retries before being skipped), and the default model was a large reasoning model. Batches now run 4-at-a-time against cloud providers, every request streams so the timeout resets on each received chunk, and the default is a fast-tier model.

### Removed
- Google Gemini as a provider: its API key storage, model policy, chat path, and its host (`generativelanguage.googleapis.com`) from the Content-Security-Policy and deployment header examples. A leftover Gemini key in localStorage from an earlier build is scrubbed on boot; a persisted `chatProvider` of `gemini` falls back to local passages.

## [1.1.13] - 2026-07-27

### Changed
- Welcome screen constellation replaced with a 3D hero miniature of the real graph scene (instanced cores/halos, fat-line filaments, edge-pulse packets; cool-band cluster hues; reduced-motion and WebGL fallbacks to the flat SVG mark).

## [1.1.12] - 2026-07-26

### Fixed
- Corpus switcher on the welcome screen: the empty-state dropdown now renders through a document-level portal sized against the trigger, so the welcome card's rounded clipping can no longer crop the menu (viewport-aware flip above/below; follows resize/scroll).
- Welcome constellation styles restored after an orphaned HeroOrbitalPreview scaffold renamed `.empty-state__constellation` away from the class EmptyState still uses — the SVG had lost its width cap and `overflow: visible` (needed for node drop-shadows), and the mobile 180px override no longer applied.

### Removed
- Unused `HeroOrbitalPreview` component and its visual-stage CSS (HeroUI Pro-dependent scaffold that EmptyState never adopted after the Pro dependency was dropped).

### Tests
- Added hostile-input coverage for HtmlPreview and the graph-import sanitizer (prompt-injection / DoS-bound payloads), aligned with `sanitizeGraphExport`'s real throw-on-unusable-file contract.

## [1.1.11] - 2026-07-26

### Changed
- Scene render pipeline: drop `preserveDrawingBuffer` (Export PNG now captures one on-demand frame via a `sceneCapture` bridge), turn off unused canvas MSAA in favor of explicit composer multisampling, and add render resolution (dpr) to the AutoQuality ladder so bloom-heavy scenes can shed fill-rate under load.
- Graph edges in 3D use fat-line ribbons (`LineSegments2`) at top quality tiers instead of 1-device-px `GL_LINES` hairlines; hairlines remain at degraded tiers and in the 2D star chart.

## [1.1.10] - 2026-07-26

### Added
- Document annotations: every document's side panel now has a **Notes & Tags** section — a free-text note, removable tag chips with corpus-wide one-click suggestions, and a pin. Annotations persist per corpus in IndexedDB, keyed by the document's stable path so an edited file keeps its notes, and survive document removal. Pinned documents surface as a jump list in Corpus insights. Saves are debounced, per-key (a second tab's annotations can't be clobbered), flushed on tab close/app hide, and retried with a warning toast on failure.
- The first-run tour now covers the full feature set in 7 steps: saved views, folder sync, snapshot compare, chat providers, and annotations. It reappears once for users who dismissed the older 4-step tour, can be dismissed with Escape, and drops cloud-provider mentions in airgap/offline mode.

### Changed
- Welcome/empty state, progress strip, and first-run chrome restyled with HeroUI (open-source components; no Pro license required for builds); nebula canvas and global styles refreshed to match.

### Security
- Upgraded Electron from 32.3.3 (EOL, Chromium 128, 17 known advisories) to 43.x, and hardened the packaged app's Electron fuses: `RunAsNode`, `--inspect` CLI arguments, and `NODE_OPTIONS` are disabled, while asar integrity validation, `OnlyLoadAppFromAsar`, and cookie encryption are enabled. At their defaults a signed Electron binary doubles as a general-purpose Node interpreter that inherits the app's signature and granted permissions.
- Updated `fast-xml-parser` (Office-document parsing) past an entity-expansion DoS, and cleared the critical `node-tar` chain in the build tooling. `npm audit`: 40 → 26 issues, 0 critical.
- Chat prompts now fence retrieved passages with a per-request random nonce, so a document containing the literal context delimiter can no longer close the context block and have the rest of its text read as instructions.
- Chat renders model-authored external links as inert text showing the full URL instead of one-click anchors, closing a prompt-injection exfiltration path that bypassed the CSP by leaving the app entirely.
- Bounded model-authored enrichment output (summary length, topic label length) so an injected instruction in one document cannot propagate oversized content into topic canonicalization, cluster names, and exports.
- Bounded the CSV preview by column count (a one-line all-commas file mounted one DOM cell per field and wedged the renderer), the document-viewer URL linkifier's regex quantifiers (quadratic backtracking hung the main thread on a long line), and the import validator's cluster-name/embedding scans (invalid entries advanced no counter, defeating the caps).

### Fixed
- Background per-corpus writes (annotations, and by the same path watched-folder and saved-view updates) can no longer re-derive the active workspace while an imported or shared graph is open. Previously the publish fallback re-activated the last local corpus underneath the ephemeral view — flipping the mode back to "local", misdirecting later edits into a real corpus, and re-arming active-corpus mutations (such as marking the corpus empty on last-document removal) that ephemeral mode deliberately disarms.

## [1.1.9] - 2026-07-25

### Added
- Snapshot comparison: each saved snapshot now has a **Compare** action that summarizes what changed between it and the current graph — documents added/removed/updated and connections gained/lost. An edited file (whose content-derived id changed) counts as one update, not a removal plus an addition, and edges are compared by endpoints so an updated document that kept its connections adds no churn.
- Saved views: bookmark the current camera position, 2D/3D mode, and filters from the View menu, then jump back with one click. Views are stored per corpus (up to 12) and survive restarts.
- Ollama chat provider: document chat can now run against a local Ollama server (127.0.0.1:11434) — no API key, nothing leaves the machine. Opt-in from Settings with a configurable model; unreachable-server and missing-model errors explain how to fix them. The production CSP admits only the two loopback spellings of the endpoint; airgap builds still admit no host at all.
- Native folder watching in the desktop app: the Electron shell watches a connected folder with fs.watch and triggers the normal sync within about a second of a change, instead of waiting for the next 8-second poll. The native watch is a trigger only — scanning, diffing, and ingestion are unchanged — and browsers keep the polling behavior.
- macOS app icon (generated nebula-constellation artwork; `scripts/make-mac-icon.mjs` regenerates it).

### Changed
- `run-app.sh` now rebuilds and redeploys automatically when the installed app is older than the source tree, instead of failing or launching a stale build.
- Moved stray debugging screenshots and the retrieval benchmark snapshot from the repository root into `docs/`.
- README: corrected desktop build output names ("Knowledge Nebula.app" → "Document Graph Explorer.app") and refreshed the privacy paragraph to cover all three chat providers.

## [1.1.8] - 2026-07-25

### Added
- Richer generated demo corpus content (theme systems, incidents, actions, risks, and artifacts) so Load demo corpus produces more distinctive, cross-linked documents.
- Batched embedding worker requests that pack many short documents into shared model inference calls instead of one round trip per document.

### Changed
- Commit parsed ingest results in fixed-size store/layout batches so large drops update the graph in groups rather than once per file.
- Scale the AI core with corpus size so the center orb stays readable against the expanded force-layout shell.
- Skip IndexedDB original retention for reconstructable generated demo documents, avoiding thousands of redundant writes on demo load.
- Serve and fetch the unversioned demo manifest with `no-cache` / `no-store` so desktop upgrades no longer keep a year-old cached corpus definition.

## [1.1.7] - 2026-07-20

### Fixed
- Rebase the chat message-id counter when a transcript is restored. The counter restarts at zero each page load, so the first new turn could reuse a restored message's id, producing duplicate React keys and causing a single update to patch two messages at once.
- Apply the same transcript flush and switch guard to snapshot restore that normal corpus switches use, so restoring a snapshot owned by another workspace can no longer persist an empty transcript over that workspace's saved history.
- Restore a saved transcript that arrived while an answer was still streaming, instead of discarding it permanently and letting the next save replace the stored history with only the new turn.
- Stop retrying a document-AI request that was cancelled during a rate-limit backoff, which continued issuing billable requests after the user had moved to another document.
- Mark an empty-bodied streaming failure as an error so it is excluded from the history sent to the model rather than replayed as a genuine prior answer.
- Stop re-reporting watched-folder files that were merely deferred by the batch size cap; they are retried on the next scan, so each poll was adding another ignored-file entry and warning toast until the backlog drained.

## [1.1.6] - 2026-07-20

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
