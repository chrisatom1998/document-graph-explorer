# Phase A — Fixes & Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the app's silent-failure modes, ship the already-built-but-unreachable document-removal feature, fix the emphasis/filter inconsistency, and put tests + a floating-promise lint on the riskiest pure logic.

**Architecture:** Four independent tasks on branch `feat/phase-a-fixes`. Roadmap: `docs/superpowers/specs/2026-07-05-consolidated-roadmap.md` items 1–5. Implementers READ the target files first and follow existing patterns — this plan gives requirements, anchors, and acceptance, not verbatim code, because each task is small and pattern-following.

**Tech Stack:** React 19, TS, Zustand, Vitest (node + per-file jsdom via `// @vitest-environment jsdom`), typescript-eslint flat config.

## Global Constraints

- No new runtime dependencies. No telemetry. Airgap gates untouched (`npm run build:airgap` must stay green).
- TDD where a pure function is involved (Tasks 1, 4); UI/worker tasks verify via typecheck + full suite + build and targeted tests where the harness supports it.
- Every task: run `npm run lint && npm run typecheck && npm test` before committing; commit with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Follow the file's existing comment/style conventions; match how siblings do it (e.g. worker respawn parity with `src/workers/pool.ts` / the aggregator client in `src/pipeline/coordinator.ts:103-129`).

---

## Task 1: Extract `scene/emphasis.ts`, fix the minEdgeWeight bug, test it

**Files:** Create `src/scene/emphasis.ts`, `src/scene/emphasis.test.ts`; Modify `src/scene/Nodes.tsx`, `src/scene/Edges.tsx` (Edges imports emphasis helpers from Nodes today — repoint both to the new module).

**Requirements:**
- Move `computeEmphasis` + `adjacencyFor` (and any helper they share) from `Nodes.tsx` into `src/scene/emphasis.ts` unchanged in behavior EXCEPT the one fix: the `filterActive` condition (currently `filter.fileTypes !== null || filter.clusters !== null || filter.minDegree > 0` at Nodes.tsx:99-100) must also include the edge-weight filter (find its store field — the FilterBar slider writes it, likely `minEdgeWeight` on the filter/ui store; READ `src/ui/FilterBar.tsx` + the store to get the exact name and its neutral value) so node dimming and edge filtering behave consistently.
- When the edge-weight filter is active, emphasized nodes = nodes incident to at least one edge meeting the weight floor (composed with the other facets the same way the existing code composes fileTypes/clusters/minDegree). Derive the exact semantics from how Edges.tsx applies the weight floor — the two must agree.
- TDD: `emphasis.test.ts` (node env) covers: no filters → null; each existing facet; the NEW case — weight-only filter active → returns a set (regression for the bug: old code returned null); focus/search paths unchanged.
- `Nodes.tsx`/`Edges.tsx` import from `./emphasis`; no behavior change beyond the fix.

**Verify:** focused test RED (new case fails against old logic if you port first, fix second — capture it), then GREEN; `npm run lint && npm run typecheck && npm test`; commit `fix(scene): emphasis honors edge-weight filter; extract scene/emphasis.ts`.

---

## Task 2: Layout-worker error handling

**Files:** Modify `src/layout/layoutBridge.ts` (+ its consumer surface only if needed for the error state).

**Requirements:**
- READ `src/layout/layoutBridge.ts` fully, plus the respawn patterns in `src/workers/pool.ts` and the aggregator client (`src/pipeline/coordinator.ts:103-129`).
- Add `onerror` and `onmessageerror` to the layout worker: on crash, terminate + respawn the worker once (fresh instance, re-send current graph state the same way `ensureLayout`/existing code seeds it), and surface a toast via the existing toast mechanism (find how other failures toast — note the roadmap's C7 caveat that layoutBridge already imports `useUiStore` for a capacity toast; reuse that existing pattern, do NOT invent a new channel). If a respawned worker crashes again within a short window, stop respawning and toast a persistent "layout engine failed — positions frozen; reload to retry" message.
- Guard against error-handler loops (a crash during respawn must not recurse unbounded — a simple crash counter/backoff is fine).
- No test harness exists for workers; verification is code-review + typecheck + a manual note in the report describing the failure path. Keep the diff minimal.

**Verify:** `npm run lint && npm run typecheck && npm test && npm run build >/dev/null`; commit `fix(layout): respawn layout worker on crash and surface the failure`.

---

## Task 3: Document-removal UI

**Files:** Modify `src/ui/SidePanel.tsx` (+ `src/styles.css` if a style is needed).

**Requirements:**
- READ `src/pipeline/coordinator.ts:900-976` (`removeDocuments(ids: string[]): Promise<void>` — already serialized via `runChain`, handles re-link/cache/topics) and `src/ui/SidePanel.tsx`'s header button patterns (the Open button, close button).
- Add a "Remove" button to the SidePanel header for `node.kind === 'document'` (match the Open button's style/markup idiom). First click arms a confirm state ("Remove from graph?" with confirm/cancel — inline two-step, matching the app's minimal-dialog style; no window.confirm); confirming calls `void removeDocuments([node.id])` and closes the panel (`setSelected(null)`).
- Removal is permanent for the session/cache (that's what the function does) — the confirm copy must say the document leaves the graph and its cached data (the file on disk is untouched).
- jsdom component test (`src/ui/SidePanel.remove.test.tsx`, mirror ChatPanel.test.tsx's mocking approach): renders with a selected document node, clicks Remove → confirm appears; clicking confirm calls a mocked `removeDocuments` with `['doc1']`. Mock `../pipeline/coordinator` (it's already the established mock seam).
- Any `no-floating-promises` fallout in the touched lines: use `void` intentionally.

**Verify:** focused test green; `npm run lint && npm run typecheck && npm test && npm run build >/dev/null`; commit `feat(ui): document removal from the side panel (confirm + re-link)`.

---

## Task 4: High-risk pure-fn tests + `no-floating-promises`

**Files:** Create `src/chat/history.test.ts` (or colocated per convention), `src/persistence/exportImport.test.ts` (extend if exists); Modify `eslint.config.js` (+ minimal source fixes for fallout).

**Requirements:**
- **`buildHistoryTurns`** (`src/chat/ragChat.ts:211` area): it is module-private — export it (named export, no behavior change) and test: role alternation is normalized to strict user/model alternation (Gemini 400s otherwise), system messages excluded, `MAX_HISTORY_MESSAGES` respected, empty history → [].
- **Export↔import round-trip**: using existing helpers (`toGraphExport` in `src/persistence/exportImport.ts`, the sanitizer in `src/persistence/validateImport.ts`), assert a built export passes sanitize unchanged (nodes/edges/kind allow-list) and a malformed edge kind downgrades per the sanitizer's documented rule. READ both files first; follow `validateImport.test.ts`'s existing fixtures.
- **Lint**: in `eslint.config.js`, enable typed linting for `src/**/*.{ts,tsx}` ONLY as far as needed for `@typescript-eslint/no-floating-promises: 'error'` (use `parserOptions.projectService: true` in the ts/tsx block; do NOT switch wholesale to recommendedTypeChecked). Fix all fallout with intentional `void` (fire-and-forget) or `await` where ordering matters — judge each site; flag any genuinely suspicious one in the report (the roadmap notes `resetCorpus`'s unawaited `cancelChat` as a known hazard — look at it).
- Zero warnings in `npm run lint` afterward.

**Verify:** new tests green; `npm run lint && npm run typecheck && npm test`; commit `test(core): history/export round-trip coverage; enable no-floating-promises`.

---

## Self-Review

Coverage: roadmap items 1→Task 3, 2→Task 2, 3→Task 1, 4→Tasks 1+4, 5→Task 4. ✓ No placeholders — each task names exact files, anchors, semantics, and acceptance; implementers read code before editing (mandated per task). Type consistency: `removeDocuments(ids: string[]): Promise<void>` used as-is; emphasis helpers keep signatures. Tasks are independent (1/2/3 touch disjoint files; 4's lint lands last to catch the whole branch's fallout — execute in order 1,2,3,4).
