# Air-gapped build mode — design

**Date:** 2026-07-04
**Status:** Approved (pending spec review)

## Problem

KnowledgeNebula is client-side and privacy-preserving by default: with AI
enrichment off, documents never leave the browser, and a production CSP
(`vite.config.ts`) allows exactly one external `connect-src` host,
`generativelanguage.googleapis.com`, used only when the user opts into Gemini
enrichment with their own key.

For distribution to others — where we want a **guarantee** that no one can turn
on the external path, whether by toggling a setting or via a future code path
that forgets to gate — we need a build variant that makes the external network
physically impossible, not merely off-by-default.

## Goal

A second build, `npm run build:airgap`, that produces an application with **zero
possible external network destinations**: the Gemini host is removed from the
CSP, all AI UI is removed, the runtime enrichment/chat entry points refuse to
fire, and a post-build script fails the build if the shipped CSP contains any
external host. The normal `npm run build` is unchanged.

## Scope of the guarantee

"Zero external destinations" means **programmatic** external requests — every
path by which the app itself could send data out: `fetch`/XHR, WebSocket,
`sendBeacon`, external subresources (scripts, styles, fonts, images), and the
embedding-model download. All of these are blocked in an airgap build by the CSP
(`connect-src 'self' blob:`, and no external host in any directive) and, for the
Gemini paths, refused at runtime before they fire. No document content can leave
the browser.

It does **not** override a user's own deliberate navigation: if a user's
document contains a link and the user clicks it, the document viewer opens that
URL in a new tab (a top-level navigation, which CSP `connect-src` does not
govern). This is not exfiltration — it sends none of the user's document
content, and nothing loads without that explicit click. A distributor who wants
the airgap build to have *literally* no reachable external URL can strip external
anchors under `AIRGAP` in `src/ui/openDocumentViewer.ts` (rendering them as plain
text); this is intentionally left as an opt-in hardening, not part of the default
guarantee.

## Non-goals

- **No dead-code elimination of Gemini modules.** The enrichment/chat code stays
  in the bundle, unreachable behind the CSP + runtime gates. Restructuring it
  behind dynamic imports adds real complexity and buys no additional guarantee
  once the CSP blocks the host and the runtime refuses the call.
- **No airgap dev mode.** This is a distribution guarantee, not a dev workflow.
  `vite dev` stays permissive (HMR needs it), exactly as today.
- **No new runtime dependencies.**

## Approach

Vite **mode** flag (`vite build --mode airgap`), chosen over an env var
(`VITE_AIRGAP=1`, which would need `cross-env` for Windows/macOS parity) and over
a duplicate `vite.airgap.config.ts` (which would drift from the real config over
time — unacceptable for a security-relevant setting). One config, one flag, read
in exactly two places (build-time CSP, runtime gate constant).

## Design

### 1. Build entry point

`package.json` scripts:

```
"build:airgap": "tsc --noEmit && vite build --mode airgap --outDir dist-airgap && node scripts/verify-airgap.mjs"
```

- Output goes to **`dist-airgap/`**, not `dist/`, so a normal build and an
  airgap build can never be confused or deployed into each other's slot.
- Add `dist-airgap/` to `.gitignore`.
- The existing `"build"` script is untouched.

### 2. CSP construction (the actual enforcement)

Extract the CSP string construction out of the inline `injectCsp` plugin in
`vite.config.ts` into a pure, unit-testable function in a new module
`src/security/csp.ts`:

```ts
export function buildCsp(opts: { airgap: boolean }): string
```

- Normal mode: identical to today's string, including
  `connect-src 'self' blob: https://generativelanguage.googleapis.com`.
- Airgap mode: `connect-src 'self' blob:` — the Gemini host is gone. Every other
  directive is unchanged (self-hosted model, wasm, fonts, workers all still
  work; the app needs no external host for anything but Gemini).

`vite.config.ts`'s `injectCsp` plugin calls `buildCsp({ airgap: mode === 'airgap' })`.
The plugin factory receives the resolved mode via Vite's `config`/`configResolved`
hook (or `defineConfig(({ mode }) => …)`), so `apply: 'build'` is preserved and
dev stays permissive.

### 3. The single runtime flag

New module `src/airgap.ts`:

```ts
/** True in builds produced by `npm run build:airgap`. Set via Vite --mode airgap. */
export const AIRGAP = import.meta.env.MODE === 'airgap';
```

Every gate reads this one constant. (`import.meta.env.MODE` is `'airgap'` under
`--mode airgap`, `'production'` for a normal build, `'development'` in dev — so
`AIRGAP` is correctly `false` everywhere except the airgap build.)

### 4. UI removal — "hide + badge"

Four surfaces, per the approved "hide + badge" choice:

- **`src/ui/SettingsPanel.tsx`** — the entire `AI Enrichment (optional)`
  `<section>` (currently lines ~184–262: key input, remember-key, model, enable
  toggle, Enrich-now button, result line, help text) is replaced, when
  `AIRGAP`, by a single locked-down section:

  > 🔒 **Air-gapped build** — no external network. AI features are removed from
  > this build.

- **`src/ui/SidePanel.tsx`** — the `{fullText && (<><hr/><DocAiSection …/></>)}`
  block (lines ~213–219) is additionally gated on `!AIRGAP`, so the per-doc
  "Ask AI" panel never renders.

- **`src/App.tsx`** — `<ChatPanel />` (line ~207) renders only when `!AIRGAP`,
  so the RAG chat entry point is absent. (Chat is meaningless air-gapped: it
  needs Gemini to generate answers.)

- No other component references enrichment/chat, so these three edits plus the
  runtime gate below cover every path.

### 5. Runtime refusal (defense in depth)

Independently of the UI, the network-calling functions refuse when `AIRGAP`:

- **`src/enrich/gemini.ts`** — `callGemini` (shared by `runEnrichment` and
  `askDocAi`) returns a failure result immediately if `AIRGAP`, before
  constructing the request. `docAiBlockedReason` reports the air-gapped state.
- **`src/chat/ragChat.ts`** — `sendChatMessage`'s pre-flight check (currently
  `if (!enrichEnabled || geminiKey.trim() === '')`) also short-circuits on
  `AIRGAP`.

This means even a stale `enrichEnabled: true` left in `localStorage` by a normal
build previously run on the same origin — or any future code path someone forgets
to gate — hits a wall in JS before the CSP has to act. Two independent layers:
runtime gate, then CSP.

### 6. Verification (enforced, not promised)

Matching the project's "enforced, not promised" ethos, the guarantee is checked,
not trusted:

- **`scripts/verify-airgap.mjs`** (Node ESM, no deps) runs as the last step of
  `build:airgap`. It reads `dist-airgap/index.html`, extracts the injected CSP
  `<meta>`, and **exits non-zero** if the CSP contains any `https://`/`http://`
  host or any `connect-src` token other than `'self'` and `blob:`. A failure
  fails the build.
- **Unit tests** (`src/security/csp.test.ts`, vitest, matching existing
  `*.test.ts` convention):
  - `buildCsp({ airgap: true })` — `connect-src` is exactly `'self' blob:`; no
    `generativelanguage` / `https://` substring anywhere in the string.
  - `buildCsp({ airgap: false })` — `connect-src` contains exactly the Gemini
    host (guards against accidentally weakening the normal build).
- **Runtime-gate test** — with `AIRGAP` forced true, `callGemini` /
  `sendChatMessage` refuse without attempting a fetch. (Implementation note:
  `AIRGAP` reads `import.meta.env.MODE`; the test either imports a thin wrapper
  it can stub, or asserts the guard via a small injected predicate — decided at
  plan time to keep the constant a one-liner.)

## Files touched

| File | Change |
|---|---|
| `package.json` | add `build:airgap` script |
| `.gitignore` | add `dist-airgap/` |
| `vite.config.ts` | call `buildCsp()`; thread `mode` into `injectCsp` |
| `src/security/csp.ts` | **new** — `buildCsp({ airgap })` |
| `src/security/csp.test.ts` | **new** — CSP unit tests |
| `src/airgap.ts` | **new** — `AIRGAP` constant |
| `src/ui/SettingsPanel.tsx` | replace enrichment section with badge when `AIRGAP` |
| `src/ui/SidePanel.tsx` | gate `DocAiSection` on `!AIRGAP` |
| `src/App.tsx` | gate `<ChatPanel />` on `!AIRGAP` |
| `src/enrich/gemini.ts` | `callGemini` refuses when `AIRGAP` |
| `src/chat/ragChat.ts` | `sendChatMessage` refuses when `AIRGAP` |
| `scripts/verify-airgap.mjs` | **new** — post-build CSP assertion |

## Testing strategy

1. `buildCsp` unit tests (both modes) — the security-critical logic.
2. Runtime-gate test — refusal without fetch under `AIRGAP`.
3. `npm run build:airgap` succeeds and `verify-airgap.mjs` passes; manual grep of
   `dist-airgap/index.html` confirms no external host in the CSP.
4. `npm run build` (normal) still emits the Gemini host — regression guard that
   the default path is unchanged.
5. Manual smoke: airgap `preview` shows the Settings badge, no Ask-AI panel, no
   chat; normal `preview` is unchanged.
