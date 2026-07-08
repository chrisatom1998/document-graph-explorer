# Runtime Offline-mode toggle — design

**Date:** 2026-07-04
**Status:** Approved

## Problem

The airgap guarantee is (correctly) a build: the CSP is fixed at page load and JS
cannot change it, so "a toggle that turns the app into the airgap build" is not
possible at runtime. What IS possible — and what the owner chose — is a
**behavioral Offline mode** in the normal build: a Settings toggle that makes the
running app refuse all external network in JS, answer chat locally (Phase-2
extractive path), and hide the Gemini-only UI. Honestly labeled as behavioral —
the CSP-sealed `build:airgap` remains the security-grade guarantee.

## Design

### One effective condition

New module `src/offline.ts`:

```ts
export function isOffline(): boolean; // AIRGAP || useSettingsStore.getState().offlineMode
export const OFFLINE_MESSAGE: string; // "Offline mode is on — AI features are disabled (no external network)."
export function installOfflineFetchGuard(): void; // see below
```

Everywhere the app gates on the build-time `AIRGAP` constant, the effective
condition becomes **`AIRGAP || offlineMode`**:
- Non-React code calls `isOffline()`.
- React components derive it reactively: `const offlineMode = useSettingsStore((s) => s.offlineMode); const offline = AIRGAP || offlineMode;` (the constant half never changes; the store half re-renders the gate when toggled).

### State

`offlineMode: boolean` on `useSettingsStore`, default `false`, persisted to
localStorage exactly like `enrichEnabled` (same parse/persist pattern, safe
default on malformed data). Setter `setOfflineMode(v: boolean)`.

### Gating changes (reuse the AIRGAP machinery)

| Site | Today | Becomes |
|---|---|---|
| `gemini.ts` — `callGemini`, `streamGemini`, `runEnrichment`, `docAiBlockedReason` | `if (AIRGAP) …AIRGAP_MESSAGE` | `if (AIRGAP) …AIRGAP_MESSAGE; else if (isOffline()) …OFFLINE_MESSAGE` — collapsed to one guard: `if (AIRGAP \|\| isOffline())` returning the appropriate message (`AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE`) |
| `ragChat.ts` — `useLocal` | `AIRGAP \|\| !enrichEnabled \|\| key===''` | `isOffline() \|\| !enrichEnabled \|\| key===''` (isOffline already covers AIRGAP) |
| `ChatPanel.tsx` — `localMode` hint | same expression | same updated expression (reactive form) |
| `SidePanel.tsx` — DocAiSection | `{!AIRGAP && fullText && …}` | `{!offline && fullText && …}` (reactive) |
| `SettingsPanel.tsx` | AI section in `!AIRGAP` branch | toggle added at top of the AI section; when on, the key/model/enable-enrichment/Enrich-now controls are `disabled` (toggle itself stays enabled) with help text; honest label: *"Offline mode — no external network; local answers only. (Behavioral setting — for the sealed guarantee, ship the air-gapped build.)"* |

Airgap build UI is unchanged (already permanently offline; badge already shown).

### Global fetch guard (defense-in-depth, approved)

`installOfflineFetchGuard()` wraps `globalThis.fetch` ONCE at app startup
(called from `src/main.tsx`): at call time, if `isOffline()` and the request URL
resolves to a different origin than `location.origin` (and isn't `blob:`/`data:`),
reject with `TypeError('Offline mode: external request blocked (<host>)')`
without calling the real fetch. Same-origin (demo corpus, /models) passes
through untouched. Main-thread only (workers already never fetch externally —
`allowRemoteModels=false`; and the airgap CSP covers the sealed build).
Honest scope: this is JS-level defense-in-depth, not the CSP.

### Docs

SECURITY.md gains one short paragraph under the build/mode table: Offline mode
is a behavioral, user-flippable setting enforced in JS (per-call refusal + a
global fetch guard); the air-gapped build remains the enforced, CSP-sealed
guarantee for distribution.

## Tests

- `settingsStore`: `offlineMode` defaults false, persists, survives malformed storage.
- Fetch guard (node): with offline on, external URL rejects and underlying fetch not called; same-origin passes through; with offline off, external passes through.
- `gemini`: with `offlineMode: true` (real store, AIRGAP false), `runEnrichment` refuses with `OFFLINE_MESSAGE`, no fetch.
- `ragChat`: with `offlineMode: true` (AIRGAP false), `sendChatMessage` answers locally with citation, no fetch (mirror of the airgap test).
- Component (jsdom): ChatPanel shows the offline hint when `offlineMode` is on in a normal build.

## Non-goals

- No claim of CSP-grade guarantee; no change to `build:airgap` or its gates.
- No worker-side fetch wrapper (nothing external to block there).
- No new dependencies.

## Acceptance

- Normal build, toggle ON: chat answers locally with citations; Ask-AI hidden;
  enrichment controls disabled; any hypothetical external fetch rejects; zero
  network requests observable in DevTools. Toggle OFF: exact pre-feature behavior.
- Airgap build: byte-identical behavior to before this feature.
- `npm test` green (node + jsdom); `build` + `build:airgap` green.
