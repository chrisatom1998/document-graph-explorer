# Phase 1 — Guard Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI actually enforce the airgap guarantee on every push, fix the broken lint so it can gate, and bring the docs (plus a new SECURITY.md) in line with the current tool.

**Architecture:** Phase 1 of the improvement program (see `docs/superpowers/specs/2026-07-04-improvement-program-design.md`). Four independent tasks: fix eslint config → repair+extend the existing GitHub Actions workflow → add SECURITY.md → refresh the product docs. No runtime code changes.

**Tech Stack:** ESLint 9 flat config, GitHub Actions, Vitest, Vite. Node 22.

## Global Constraints

- **Airgap guarantee is the point of CI:** the workflow MUST run `npm run build:airgap` (which chains `tsc → vite build --mode airgap → sanitize-airgap.mjs → verify-airgap.mjs`); `verify-airgap.mjs` exits non-zero on any external host, so a CSP regression fails CI.
- **No new runtime dependencies.** (This phase adds no deps at all.)
- **Node version:** pin CI to **22** (matches local dev `v22.23.1`).
- **Default branch is `main`** (`master` was deleted). CI triggers must reference `main`, never `master`.
- **Product name is "Document Graph Explorer"**; repo is `chrisatom1998/document-graph-explorer`. No doc may reintroduce "Knowledge Nebula" as the product name (the internal `knowledge-nebula` storage slug staying in code is fine and out of scope here).
- **Shipped parse formats** (state accurately in docs): Markdown, TXT, PDF, HTML, **DOCX, PPTX, XLSX**, and generic text (JSON/YAML/CSV). The old docs omit the Office formats.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `eslint.config.js` | modify | ignore built output; give `.mjs` scripts Node globals so lint passes |
| `.github/workflows/ci.yml` | modify | trigger on `main`; run lint/typecheck/test/build/**build:airgap** |
| `SECURITY.md` | create | corp-security artifact: guarantee, layers, verification |
| `docs/product-roadmap.md` | modify | rebrand + add Office/airgap |
| `docs/project-plan.md` | modify | rebrand + add Office/airgap |
| `README.md` | modify | formats + Builds section + SECURITY.md link |

---

## Task 1: Fix ESLint so `npm run lint` passes

**Files:**
- Modify: `eslint.config.js`

**Interfaces:**
- Produces: a passing `npm run lint` (exit 0), which Task 2's CI depends on.

**Context:** `npm run lint` currently reports 11,298 errors. Cause: the flat config ignores `dist` but NOT `dist-airgap`, so ESLint lints the 2 MB minified airgap bundles (11,279 errors); the remaining 19 are `no-undef` for `console`/`process`/`URL` in `scripts/*.mjs`, which get browser globals only. Verified: `npx eslint . --ignore-pattern 'dist-airgap'` → 19 errors, all in the `.mjs` scripts.

- [ ] **Step 1: Confirm the current failure**

Run: `npm run lint 2>&1 | tail -3`
Expected: ends with a large error count (`✖ 11298 problems`).

- [ ] **Step 2: Apply the config fix**

In `eslint.config.js`, change the ignores line (currently line 14):

```js
  { ignores: ['dist', 'node_modules', 'public', 'coverage'] },
```

to also ignore the airgap build output:

```js
  { ignores: ['dist', 'dist-airgap', 'node_modules', 'public', 'coverage'] },
```

Then change the Node-context block (currently lines 35-39) so it also covers the `.mjs` build scripts. Replace:

```js
  {
    // Node context: tests and build config.
    files: ['**/*.test.ts', '*.config.{ts,js}', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
```

with:

```js
  {
    // Node context: tests, build config, and the .mjs build/verify scripts.
    files: ['**/*.test.ts', '*.config.{ts,js}', 'vite.config.ts', '**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
```

- [ ] **Step 3: Verify lint now passes**

Run: `npm run lint`
Expected: exits 0 with no error output. (If any real source errors remain, they are genuine — fix them minimally or report; do not re-broaden the ignores.)

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "fix(lint): ignore dist-airgap and give .mjs scripts Node globals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Repair and extend the CI workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: passing `npm run lint` from Task 1.
- Produces: a workflow that fails on lint/type/test/build errors AND on any airgap CSP violation.

**Context:** The existing workflow triggers on `push: branches: [master]` (deleted branch → never runs) and has no build step, so the airgap `verify-airgap` gate never executes in CI. Local runs already pass: `npm run typecheck`, `npm test` (179/179), `npm run build`, and `npm run build:airgap` (ends `verify-airgap: OK`).

- [ ] **Step 1: Replace the workflow file**

Overwrite `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type-check
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build (production)
        run: npm run build

      - name: Build (air-gapped) + verify zero external hosts
        run: npm run build:airgap
```

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');if(!/build:airgap/.test(s)||!/branches: \[main\]/.test(s)){process.exit(1)}console.log('workflow OK: triggers on main, runs build:airgap')"`
Expected: prints `workflow OK: triggers on main, runs build:airgap`.

- [ ] **Step 3: Confirm every command the workflow runs passes locally**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run build:airgap 2>&1 | tail -3`
Expected: all succeed; the final lines include `verify-airgap: OK — airgap CSP has no external host.` (This is the exact chain CI will run — if it passes locally it will pass in CI.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: trigger on main and enforce airgap guarantee (build + verify)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Note (post-merge, not a step here):** after this branch merges to `main`, open the GitHub Actions tab and confirm the first run is green; the acceptance test "a PR adding an external host to the CSP fails CI" is guaranteed by `verify-airgap.mjs` (already proven to exit 1 on a host-bearing CSP in the airgap work).

---

## Task 3: Add SECURITY.md

**Files:**
- Create: `SECURITY.md`

**Interfaces:** none (documentation).

**Context:** This is the artifact a corporate security reviewer reads. It must stand alone and answer "does this send our documents anywhere?" The facts come from `vite.config.ts` (CSP), `src/airgap.ts` + `src/enrich/gemini.ts` + `src/chat/ragChat.ts` (runtime gates), `src/workers/pipeline.worker.ts` (self-hosted model), and `scripts/verify-airgap.mjs` / `scripts/sanitize-airgap.mjs` (build gates).

- [ ] **Step 1: Create the file**

Create `SECURITY.md`:

```markdown
# Security

Document Graph Explorer runs **entirely in the browser**. Parsing, embeddings,
similarity, clustering, and layout all execute client-side in web workers. There
is no server, no account, no telemetry, and no analytics.

## Where data can go

| Build / mode | External network |
|---|---|
| `npm run build:airgap` (air-gapped) | **None.** Zero external destinations — enforced, see below. |
| `npm run build`, AI enrichment **off** (default) | **None.** No document content leaves the browser. |
| `npm run build`, AI enrichment **on** (opt-in, user supplies a Gemini key) | Document excerpts are sent to Google's Gemini API (`generativelanguage.googleapis.com`) **only** for the AI features the user explicitly triggers. Off by default. |

The embedding model (MiniLM) and its WASM runtime are **self-hosted** in the app
(`/models`, `/assets`) — they are never fetched from HuggingFace or a CDN
(`allowRemoteModels = false`, ORT `wasmPaths` pinned same-origin).

## How the air-gapped guarantee is enforced (not just promised)

Three independent layers:

1. **Content-Security-Policy.** The production CSP allows `connect-src 'self'
   blob:` only; in the airgap build the single external host (Gemini) is removed,
   so the browser physically blocks every off-origin request — even from a buggy
   dependency.
2. **Runtime refusal.** The `AIRGAP` flag makes the Gemini/chat functions return
   before any `fetch`, independent of the CSP, and removes the AI UI entirely.
3. **Post-build gate.** `npm run build:airgap` runs `scripts/verify-airgap.mjs`,
   which fails the build if the shipped CSP admits any external host, and
   `scripts/sanitize-airgap.mjs`, which strips inert third-party vendor strings
   (e.g. model-hub/CDN hostnames the ML library bundles as defaults but never
   contacts). CI runs this on every push.

## Scope of the guarantee

"Zero external destinations" covers every **programmatic** request the app can
make (fetch/XHR, WebSocket, `sendBeacon`, external subresources, model download).
It does not override a user's own deliberate navigation: if a user's document
contains a link and the user clicks it, the viewer opens that URL in a new tab.
That sends none of the document's content and nothing loads without the click.

## Verify it yourself

```bash
npm run build:airgap
npx vite preview --outDir dist-airgap
```
Open the URL, then DevTools → **Network** → "Disable cache" → reload → drop a few
documents and interact. Every request's domain is the local origin; there are no
external domains and no CSP violations in the Console.

## Reporting a vulnerability

Report suspected security issues privately to the repository owner
(chrismjohnson@google.com) rather than opening a public issue.
```

- [ ] **Step 2: Verify it's complete and self-consistent**

Run: `grep -cE '^## ' SECURITY.md && grep -c 'generativelanguage' SECURITY.md`
Expected: at least `5` section headers, and exactly `1` mention of the Gemini host (in the enrichment row only).

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md describing the privacy/airgap guarantee

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refresh product docs

**Files:**
- Modify: `docs/product-roadmap.md`, `docs/project-plan.md`, `README.md`

**Interfaces:** none (documentation).

**Context:** These docs predate the rename and the Office-format + airgap work. Goal: accurate product name, accurate shipped-format list, and a mention of the air-gapped build. Do NOT rewrite wholesale — make targeted edits.

- [ ] **Step 1: Rebrand the two docs**

In `docs/product-roadmap.md` and `docs/project-plan.md`, replace the product name everywhere it appears as prose/title:
- `Knowledge Nebula` → `Document Graph Explorer`

Run to find every occurrence first:
`grep -rn "Knowledge Nebula" docs/product-roadmap.md docs/project-plan.md`
Then replace each. (Both files start with an H1 `# Knowledge Nebula — …` and use the name in prose.)

- [ ] **Step 2: Correct the shipped-format list**

In `docs/project-plan.md`, the Ingestion capability (around line 49) lists `.md`, `.txt`, `.pdf`, `.html`. Change it to include Office + text formats:

```markdown
- Drag-and-drop files or folders (`.md`, `.txt`, `.pdf`, `.html`, `.docx`, `.pptx`, `.xlsx`, and `.json`/`.yaml`/`.csv` as text)
```

In `docs/product-roadmap.md`, the shipped milestone "Multi-format parsing (MD, TXT, PDF, HTML)" — update to `Multi-format parsing (MD, TXT, PDF, HTML, DOCX, PPTX, XLSX)`.

- [ ] **Step 3: Add the air-gapped build to both docs**

In `docs/product-roadmap.md`, under "Q3 2026 — Foundation & Intelligence" Milestones table, add a row:

```markdown
| Air-gapped build (`build:airgap`) with enforced zero-egress CSP | ✅ Shipped | July 2026 |
```

In `docs/project-plan.md`, under "Key Capabilities (v1)" add a short subsection after "Visualization":

```markdown
### Distribution & Security
- **Air-gapped build** (`npm run build:airgap`): zero external network, enforced by a host-free CSP, runtime refusal, and a post-build verify gate. See [SECURITY.md](../SECURITY.md).
```

- [ ] **Step 4: Update the README feature list + add a Builds section**

In `README.md`, update the intro line's format list to include Office formats (find the "text, Markdown, PDF, or HTML" phrasing and add "Word/PowerPoint/Excel"). Then add a section after "Scripts":

```markdown
## Builds

| Command | Output | Network |
| --- | --- | --- |
| `npm run build` | `dist/` | Fully local by default; optional opt-in Gemini enrichment |
| `npm run build:airgap` | `dist-airgap/` | **Zero external network** — host-free CSP + runtime refusal + post-build verify gate |

See [SECURITY.md](SECURITY.md) for the full privacy guarantee and how to verify it.
```

- [ ] **Step 5: Verify no stale branding remains and facts are present**

Run:
```bash
grep -rn "Knowledge Nebula" docs/product-roadmap.md docs/project-plan.md README.md; echo "exit=$?"
grep -l "build:airgap" docs/project-plan.md docs/product-roadmap.md README.md
grep -l "docx\|DOCX" docs/project-plan.md docs/product-roadmap.md
```
Expected: the first grep prints nothing and `exit=1` (no "Knowledge Nebula" left); the airgap and Office greps list the files.

- [ ] **Step 6: Commit**

```bash
git add docs/product-roadmap.md docs/project-plan.md README.md
git commit -m "docs: rebrand to Document Graph Explorer; document Office formats and airgap build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (against program spec §2.1 and §2.4):**
- §2.1 CI enforcing the airgap guarantee → Task 2 (adds `build:airgap`); prerequisite lint fix → Task 1. ✓
- §2.4 SECURITY.md → Task 3; docs refresh (rebrand, Office, airgap) → Task 4. ✓
- Acceptance "a PR adding an external host to the CSP fails CI" → satisfied by Task 2 running `verify-airgap.mjs` (proven to exit 1 on a host-bearing CSP). ✓

**Placeholder scan:** No TBD/TODO; every code/config step shows exact content and every run step gives an exact command + expected output. Doc edits give exact find-strings and exact new blocks.

**Type/consistency:** Node pinned to `22` in both the constraint and Task 2. Trigger branch is `main` in the constraint, Task 2 YAML, and its validation grep. Lint-fix (Task 1) is sequenced before the CI task that depends on it. The `verify-airgap.mjs`/`sanitize-airgap.mjs` names match the files created in the airgap program. Product name "Document Graph Explorer" used consistently across Tasks 3–4.
