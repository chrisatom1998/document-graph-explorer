# Quick Wins Phase P Implementation Plan

Date: 2026-07-06

## Task 0 - Save This Plan

Write this document to `docs/superpowers/specs/2026-07-06-quickwins-phaseP-plan.md` so the implementation plan lives with the other program specs.

## Task 1 - XSS/Escaping Tests For `openDocumentViewer`

- Export the private pure helpers `escapeHtml`, `hrefFor`, `linkifyLine`, and `formatContent` from `src/ui/openDocumentViewer.ts` with an "exported for tests" comment. No behavior change.
- Add `src/ui/openDocumentViewer.test.ts`:
  - `escapeHtml` escapes `&`, `<`, `>`, and `"`, and generated attributes are double-quoted.
  - `hrefFor` allows `http(s)://`, `www.`, `mailto:`, and bare email addresses.
  - `hrefFor` rejects `javascript:`, mixed-case script schemes, `data:`, `file:`, `vbscript:`, protocol-relative URLs, and relative paths.
  - Attribute injection in a URL is encoded into the `href` attribute.
  - Hostile formatted content does not emit executable tags, event attributes, or script URLs.
- Add a jsdom round-trip test if needed: stub `window.open`, pass a hostile `DocNode` and hostile `LinkRef[]`, and assert the written HTML is clean.

## Task 2 - Wire Export/Import/PNG Into The UI

Decision: add a toolbar `Data` popover with `Export graph JSON`, `Export image PNG`, and `Import graph JSON`, following the existing `View` menu pattern. Use a new `src/ui/ExportImportMenu.tsx` component so `Toolbar.tsx` does not absorb all behavior. Add an `Import a graph` button to `src/ui/EmptyState.tsx`. Use a confirm-before-import modal only when a graph is already loaded. Do not add airgap gating because all operations are local file/canvas/Blob work.

Changes:

- Create `src/ui/ExportImportMenu.tsx`.
  - Include `openGraphJsonPicker()` with a hidden input singleton.
  - Accept `.json,application/json`.
  - Reset `input.value = ''` after read.
- Update `src/ui/Toolbar.tsx`.
  - Use `type MenuKey = 'view' | 'data'`.
  - Generalize outside-click handling to the active menu ref.
  - Add the Data trigger between Insights and the divider.
- Update `src/ui/EmptyState.tsx`.
  - Add a secondary `Import a graph` button beside `Load demo corpus`.
  - Skip confirmation while the corpus is empty.
- Update `src/persistence/exportImport.ts`.
  - `exportScenePNG()` should select `.nebula-canvas canvas` and return `Promise<boolean>`.
  - `importGraphJSONFile()` should return `{ nodes, edges }` so UI can show a success toast.
- Gating:
  - Import enabled only when phase is `idle` or `ready`.
  - Export JSON enabled only when phase is `ready`.
  - Feedback via `useUiStore.getState().pushToast`.
  - Invalid import must validate before reset so the existing corpus is preserved.
- Tests:
  - `src/ui/ExportImportMenu.test.tsx`, jsdom.
  - Mock `../persistence/exportImport` using the existing SidePanel mock pattern.
  - Cover confirm dialog with nodes, skipped confirm when empty, Cancel, disabled import during parsing, failure toast, and invalid file preserving the store.

## Task 3 - Documentation Truth Sync

- `docs/product-roadmap.md`: mark JSON export/import shipped as of July 2026 and add PNG export as shipped.
- `docs/product-roadmap.md`: move 2D toggle mode from planned to shipped.
- `docs/project-plan.md`: mark 2D toggle mode complete.
- `docs/superpowers/specs/2026-07-05-consolidated-roadmap.md`: mark Phase A items 1-5 and item 9 shipped; remove 2D toggle from Deferred with a shipped note.
- `docs/user-guide.md` and `README.md`: replace "not yet wired" notes with Data-menu usage instructions.
- Do not touch `knowledge-nebula-spec.md`.

## Task 4 - Repo Hygiene

Delete stale root duplicates from `KnowledgeNebula/`: `src/`, `docs/`, `desktop/`, `scripts/`, `package.json`, `package-lock.json`, `eslint.config.js`, `rebuild.sh`, `run-app.sh`, `README.md`, plus root `.gitignore` if it is identical to the repo copy. Keep `senior-developer-instructions.md`, `.claude/`, `.agents/`, and `document-graph-explorer/`.

Pre-delete verification must produce empty output, else abort:

```sh
cd /c/Users/Owner/OneDrive/Documents/GTechProjects/KnowledgeNebula
for f in package.json package-lock.json eslint.config.js rebuild.sh run-app.sh README.md .gitignore; do
  cmp -s "$f" "document-graph-explorer/$f" || echo "STOP: $f differs"
done
for d in src docs desktop scripts; do
  diff -rq --strip-trailing-cr "$d" "document-graph-explorer/$d" | grep -v '^Only in document-graph-explorer/'
done
```

Also add `docs/*.pdf` to the repo `.gitignore`; the guide PDF is generated from `docs/user-guide.md`.

## Task 5 - Error Containment

- Create `src/ui/AppErrorBoundary.tsx` with a jsdom test.
  - Class component.
  - Fallback screen uses existing glass styling.
  - Shows the error message.
  - Provides `Reload`.
  - Provides `Export your graph (JSON)` via `exportGraphJSON()`, disabled when there are no nodes.
  - Works because Zustand stores live outside the React tree.
- Wrap `<App />` in `src/main.tsx` inside `StrictMode`.
- Create `src/util/globalErrors.ts` with tests.
  - `installGlobalErrorHandlers()` handles `window` `error` and `unhandledrejection`.
  - Record to store and push an error toast.
  - Deduplicate repeated errors with about a 5 second cooldown.
  - Local only; nothing sent anywhere.
- Update `src/store/uiStore.ts`.
  - Add `lastError: { message, stack?, at } | null`.
  - Add `setLastError`.
- Update `src/workers/pool.ts`.
  - Add `onWorkerCrash(listener)` mirroring `onModelProgress`.
  - Fire it from `handleWorkerFailure`.
  - Subscribe in `coordinator.ts` and show a warning toast: "A background worker crashed and was restarted - processing continues."
- R3F caveat:
  - `useFrame` and event-handler errors do not reliably reach React boundaries.
  - Render-phase errors inside `<Canvas>` are rethrown by R3F.
  - Boundary plus global handlers cover both.

## Task 6 - Diagnostics About Panel

- Update `vite.config.ts` with `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`.
- Declare `__APP_VERSION__` in `src/vite-env.d.ts`.
- Use a safe fallback of `dev` if the constant is unavailable.
- Update `src/ui/SettingsPanel.tsx`.
  - Add an About section after Data.
  - Show version, build flavor, user agent, corpus node/edge counts, and last error.
  - Add `Copy diagnostics` using `navigator.clipboard.writeText`.
  - Reuse the existing clear-note feedback pattern.
- Extract pure `buildDiagnosticsText()` into `src/ui/diagnostics.ts` and test it in node env.

## Task 7 - Release Engineering

- Add `LICENSE` with an internal/proprietary notice:
  - Copyright (c) 2026 Chris Johnson.
  - All rights reserved.
  - Internal use only unless a separate written license is provided.
- Add `CHANGELOG.md` in Keep a Changelog style with a retroactive `1.0.0` entry summarizing the repo history and this branch's additions.
- Add `.github/workflows/release.yml`.
  - Run on tags matching `v*`.
  - `permissions: contents: write`.
  - Node 22, mirroring `ci.yml`.
  - `npm ci`, lint, typecheck, test, build, and build airgap.
  - Assert tag equals `package.json` version.
  - Zip `dist` and `dist-airgap`.
  - `gh release create "$GITHUB_REF_NAME" ... --generate-notes` using `${{ github.token }}`.
- Add `DEPLOYMENT.md`.
  - Build products.
  - Required headers from `vite.config.ts`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
  - Serve CSP as a header too because `frame-ancestors` only works as a header.
  - Note that COOP/COEP are intentionally omitted.
  - Include nginx example and generic checklist.
  - Include airgap serving via `scripts/serve.mjs` and Electron pointer (`build:desktop`).
- Final cut:
  - Bump `package.json` from `0.1.0` to `1.0.0`.
  - Tag `v1.0.0`.

## Sequencing

Tasks 1, 2, 3, 4, 5, 6, then 7. Work on a feature branch in the `document-graph-explorer` repo and commit per task.

## Verification

Run:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run build:airgap
```

Manual smoke with `npm run dev`:

- Demo corpus -> Data -> Export JSON downloads.
- Export PNG downloads a non-black image.
- Import that JSON over a live corpus -> confirm dialog -> replaces graph and shows success toast.
- Cancel/Escape leave corpus intact.
- Fresh tab -> EmptyState `Import a graph` works without confirm.
- Malformed file import shows an error toast and leaves existing corpus untouched.
- Mid-ingest import is disabled.
- UI render error reaches boundary fallback.
- `useFrame` error reaches global-handler toast.
- Simulated pool-worker crash shows respawn toast.
- Settings -> About shows correct version/counts and copies diagnostics.
- Repeat key flows in airgap preview and confirm zero external requests.
- Repo hygiene pre-delete re-diff is empty before deletion.
- Validate `release.yml` with actionlint or an rc tag on a branch.

## Owner-Flagged Defaults

- License defaults to internal/proprietary; owner can replace it later.
- Root `.gitignore` is included in the duplicate deletion list if identical.
- Generated guide PDFs are gitignored unless the owner decides to commit them.
