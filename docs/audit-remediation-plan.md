# Audit remediation — 6 September 2026

Goal: address the five requested remediation groups while preserving the pre-existing workspace UI changes. Implementation uses existing workers, stores, readers, and provider contracts; no new dependency is planned.

## Work and verification ledger

| Area | Owned implementation | Required evidence | Status |
| --- | --- | --- | --- |
| Collaboration | Session lifecycle, scoped annotation sharing, path redaction | Offline active/pending sessions, corpus switch in both directions, orphan annotation regressions | Implemented |
| Persistence | Failed notes, snapshot failure, document edit generations, demo restoration | Storage failure/switch and concurrent-save tests; browser reload | Implemented |
| Parsing and folders | Literal XML text, slide sequence, partial read failures | Real parser fixtures and folder-watch retention/recovery tests | Implemented |
| Coordinator | Retry incomplete stages, cancellable backfill, failure cleanup | Failed/cancelled embedding, lexical, semantic and clustering retries | Implemented |
| Search | Eligibility before ranking, title-only candidates, Unicode matching | Lexical/semantic top-K and imported-title tests; browser search | Implemented |
| Graph | Worker state replay, relative reader links, ordered import resolution | Worker lifecycle and path-resolution regressions | Implemented |
| Scene | Aspect-aware framing, hidden-node picking, quality recovery | Projection, picking and refresh-rate tests; portrait browser view | Implemented |
| Accessibility | PDF text view, focus preservation, chat announcements | Reader/chat tests; keyboard PDF text browser inspection | Implemented |
| AI | Hydration cleanup, interrupted stream handling | Mocked stream failures with partial output, no repeated paid request | Implemented |
| Delivery | Port retry, cache upgrades, airgap verifier, lint exclusions | Launcher/cache/CSP regressions; lint and both builds | Implemented |
| Topic quality | Meaningful fallback labels and phrase boundaries | Generated-corpus evaluation plus focused regressions | Implemented |
| Unicode labels | Local font fallback for glyphs absent from Inter | Font-coverage, texture lifecycle tests; Japanese, Arabic and emoji browser coverage | Implemented |
| Integration | Preserve existing e2e tests, add reload/PDF/search/normal-motion coverage | Full unit suite, lint, typecheck, standard + airgap builds, Chrome e2e and hands-on browser | Verified |

## Root implementation decisions

- Prefer focused lifecycle/error-boundary fixes over a cross-cutting redesign; keep new behavior inside existing APIs where possible.
- Preserve demo sessions rather than silently purging them at startup. The same durability expectation applies after annotation or naming.
- Keep raw TF-IDF keywords for search/edges; give fallback topic labels stronger evidence (title terms or repeated phrases) and prevent phrases from crossing sentence/number boundaries. This reduces byline and identifier noise without hard-coded person or domain lists.
- Keep default browser test behavior; allow an explicit installed-Chrome channel for machines without the pinned Playwright browser. Add normal-motion coverage independently of the reduced-motion smoke suite.
- Agents run scoped regressions. Root reviews combined changes and runs final broad checks only after integration, followed by browser verification and a requirement-by-requirement completion audit.

No deployment or packaging release is requested. Source fixes, regression tests, and verified builds are the deliverable.

## Coverage of the original audit

The numbered findings refer to `artifacts/audit-2026-09-06/audit-report.md`, which preserves the original audit evidence.

| Findings | Implementation and regression evidence |
| --- | --- |
| 1–3: collaboration isolation/privacy | `src/collab/store.ts`, `store.privacy.test.ts`, `importBoundary.test.ts`: active/pending offline disconnect, immutable annotation scope, late callback guards, orphan-key omission, imported/shared replacement boundaries and notes toggles during hydration. |
| 4–6: storage failures/races | `annotationStore.test.ts`, `runtimeStores.test.ts`, `sessionSave.test.ts`, `session.test.ts`: per-corpus failed-write payloads, generation acknowledgements, shared hydration outcomes, snapshot failure and original-owner capture. |
| 7, 11–12: literal parsing/folder reads | Office/EPUB parser fixtures, folder scanner/picker/watcher/local-files and DropZone tests: literal values, relationship slide order/root targets, readable siblings, retained failed revisions, report identity and unchanged access recovery. |
| 8–10: processing recovery | `coordinator.ingest.test.ts`: failed/cancelled incomplete stages resume without re-parsing or re-embedding completed work; backfill abort and analysis errors remain retryable; phase/progress settle on boundary failures. |
| 13–15: search | Retrieval and SearchOverlay tests plus browser smoke cases: filter eligibility precedes result caps; title-only imports and Unicode matches work without vectors. |
| 16–18: graph correctness | Layout bridge, link resolver, pipeline links and Markdown tests: worker preference replay, source-relative reader paths and ordered single-target import resolution. |
| 19, 23–24: accessibility | PDF reader/chat tests: text alternative with passage navigation, retained user focus and polite generation/completion status. Browser accessibility tree exposes the PDF body. |
| 20–22: rendering | Camera projection, picking and AutoQuality tests: portrait bounds, invisible-node exclusion and recovery at ordinary refresh rates. |
| 25–27: AI failures | Enrichment, LLM stream and provider/RAG tests: hydration cleanup, partial-output preservation and no replay after output begins. Provider boundaries use mocked requests. |
| 28–30: delivery | Launcher, desktop-cache and CSP verifier tests: actual-bound-port launch, upgrade HTTP-cache migration and strict per-directive local-source verification. |

Additional improvements preserve annotated demo work, reduce inferred topic noise, exclude generated audit artifacts from lint, document the installed-Chrome test option and reject occupied Playwright ports. Independent follow-up reviews covered storage/collaboration and processing recovery; their concrete findings were added to implementation and regressions.

## Final integration verification

Completed on 6 September 2026. All five requested remediation groups and the original 30 numbered findings have implementations and regression coverage. Ten audit/implementation agents and two independent integration reviewers contributed; the primary agent reviewed the combined diff and performed browser verification. Pre-existing workspace UI changes were preserved. No new dependency was added.

| Final check | Result |
| --- | --- |
| `npm test -- --maxWorkers=4` | **208 files, 1,418 tests passed**, 106.40 seconds. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed, including the e2e TypeScript project. |
| `npm run build` | Passed, with runtime-asset verification and 78.0 kB eager/entry JavaScript within budget. |
| `npm run build:airgap` | Passed, including sanitization, strict CSP verification, runtime assets and bundle budget. Sanitizer reported zero external service hosts in built JS. |
| `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4273 npx playwright test` | **All 7 browser tests passed**, 1.2 minutes, against the final production build. No browser installation was needed. |
| `git diff --check` | Passed. |

The normal-motion case imports Japanese/emoji and Arabic titles, opens a document through keyboard navigation, searches the Japanese title without body text or embeddings, and verifies no console/page errors or external HTTP requests. The Unicode rendering failure discovered during this pass was fixed with a bounded local system-font fallback; supported Inter glyphs keep their existing renderer. Native glyph availability still depends on installed system fonts.

The demo smoke test verifies exactly 100 documents, PDF extracted text with a matching passage, notes/tags surviving a demo-only reload, and a real file-picker upload producing 101 documents that survive another reload. The remaining cases cover file-filter ranking before top-K, 1280px/390px workspace controls, and selecting node 4,097 after renderer capacity growth.

### Hands-on browser evidence

The primary agent used the production app at `http://127.0.0.1:4174/` independently of Playwright:

- Loaded all **100 demo documents**, with **30 topic hubs, 611 connections and 13 clusters**. The original audit observed 93 topic hubs; the reduced count reflects stronger evidence for inferred topic labels, not removed documents.
- Opened Postgres Performance Tuning Guide from search. The extracted PDF body, including `pg_stat_statements`, appeared in the accessibility tree as actual text.
- Created a synthetic note and tag, reopened the final build, and confirmed both persisted with the entire demo corpus and 2D preference.
- Inspected Fit view at **390×844** in 3D and 2D: graph nodes stayed inside the horizontal viewport. Reset the temporary viewport afterward.
- Inspected the final reader visually and checked browser diagnostics: no errors; an existing Three.js Clock deprecation warning remains.
- Inspected the final Unicode screenshot: the Japanese title and emoji render in the graph.

Local screenshots are preserved under `artifacts/audit-remediation-2026-09-06/`: `demo-graph.png`, `pdf-extracted-text.png`, `unicode-graph.png`, and `portrait-filters.png`.

### Verification limits and intermediate failures

Storage, live collaboration transport, and provider failure boundaries were exercised with controlled fixtures/mocks. No live peer room, paid AI request, packaged desktop upgrade, deployment, or full screen-reader certification was performed. Desktop cache/launch behavior was verified through its regression harnesses. Vite retains its pre-existing mixed static/dynamic import warning.

One intermediate unit run while both builds ran concurrently exceeded an existing two-second hostile-input performance assertion (2,507 ms). That test passed unchanged when run alone; the final entire suite passed with four workers. No assertion or timeout was weakened. The first expanded browser run detected the Unicode fallback-font error; the final run passed after the rendering fix. Playwright now refuses occupied ports rather than silently reusing another local app.
