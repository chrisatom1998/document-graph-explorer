# Runtime Offline-mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persisted Settings toggle that makes the running normal build behave like the airgap build — refuse all external network in JS (per-call + a global fetch guard), answer chat locally, hide Gemini-only UI — honestly labeled as behavioral, not the CSP-sealed guarantee.

**Architecture:** One new module `src/offline.ts` (`isOffline()`, `OFFLINE_MESSAGE`, `installOfflineFetchGuard()`); a new persisted `offlineMode` field on the settings store; every existing `AIRGAP` gate broadens to `AIRGAP || offlineMode`. See `docs/superpowers/specs/2026-07-04-offline-mode-toggle-design.md`.

**Tech Stack:** React 19, TS, Zustand, Vitest (node + jsdom). No new deps.

## Global Constraints

- **No new dependencies.**
- **Airgap build behavior byte-identical:** in airgap builds `AIRGAP` is true, so `isOffline()` is true regardless of the toggle; the airgap UI (badge, hidden sections) is unchanged and the toggle is not shown there.
- **Toggle OFF ⇒ exact pre-feature behavior** (all new conditions reduce to the old `AIRGAP`-only checks).
- Refusal copy: airgap keeps `AIRGAP_MESSAGE`; the toggle uses `OFFLINE_MESSAGE = 'Offline mode is on — AI features are disabled (no external network).'`
- The fetch guard only blocks **cross-origin** http(s) requests while offline; same-origin, `blob:`, `data:` always pass; installed once from `src/main.tsx`.
- Honest labeling: Settings copy and SECURITY.md must state this is behavioral; `build:airgap` remains the sealed guarantee.

---

## File Structure

| File | Change |
|---|---|
| `src/store/settingsStore.ts` | add `offlineMode` (default false, persisted) + `setOfflineMode` |
| `src/offline.ts` (new) | `isOffline()`, `OFFLINE_MESSAGE`, `installOfflineFetchGuard()` |
| `src/offline.test.ts` (new) | guard + isOffline unit tests |
| `src/store/settingsStore.test.ts` | add offlineMode persistence cases |
| `src/enrich/gemini.ts` | broaden 4 AIRGAP guards |
| `src/enrich/gemini.offline.test.ts` (new) | offline refusal, no fetch |
| `src/chat/ragChat.ts` | `useLocal` uses `isOffline()` |
| `src/chat/ragChat.offline.test.ts` (new) | local answer under toggle, no fetch |
| `src/main.tsx` | install fetch guard |
| `src/ui/SettingsPanel.tsx` | toggle + disable enrichment controls when on |
| `src/ui/SidePanel.tsx` | DocAiSection gate reactive on offline |
| `src/ui/ChatPanel.tsx` | `localMode` uses offline condition |
| `src/ui/ChatPanel.test.tsx` | add offline-toggle hint case |
| `SECURITY.md` | behavioral-vs-sealed paragraph |

---

## Task 1: offlineMode state + offline module + fetch guard

**Files:**
- Modify: `src/store/settingsStore.ts`, `src/store/settingsStore.test.ts`
- Create: `src/offline.ts`, `src/offline.test.ts`

**Interfaces:**
- Produces: `offlineMode: boolean` + `setOfflineMode(v: boolean)` on `useSettingsStore`; from `src/offline.ts`: `isOffline(): boolean`, `OFFLINE_MESSAGE: string`, `installOfflineFetchGuard(): void`.

- [ ] **Step 1: Add offlineMode to the settings store**

In `src/store/settingsStore.ts`, mirror `enrichEnabled` exactly in all five places:
1. The `PersistedSettings` interface: add `offlineMode: boolean;`
2. The actions interface: add `setOfflineMode: (offline: boolean) => void;`
3. `DEFAULTS`: add `offlineMode: false,`
4. `loadPersisted()` return object: add
```ts
      offlineMode:
        typeof parsed.offlineMode === 'boolean' ? parsed.offlineMode : DEFAULTS.offlineMode,
```
5. The store creator: add `setOfflineMode: (offlineMode) => set({ offlineMode }),` and the subscribe persister's `persisted` object: add `offlineMode: s.offlineMode,`

- [ ] **Step 2: Write failing tests**

In `src/store/settingsStore.test.ts`, add (following the file's existing test style — read it first and match its setup/reset helpers):

```ts
describe('offlineMode', () => {
  it('defaults to false', () => {
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });
  it('setOfflineMode flips and persists it', () => {
    useSettingsStore.getState().setOfflineMode(true);
    expect(useSettingsStore.getState().offlineMode).toBe(true);
    const raw = localStorage.getItem('knowledge-nebula-settings');
    expect(raw && (JSON.parse(raw) as { offlineMode?: boolean }).offlineMode).toBe(true);
  });
});
```

(If the existing test file runs in node without a localStorage shim, follow whatever mechanism it already uses for persistence assertions; if it has none, assert via `loadPersisted` behavior instead — match the file's conventions rather than inventing new scaffolding. Reset `offlineMode` to false in an `afterEach`/beforeEach consistent with the file.)

Create `src/offline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isOffline, installOfflineFetchGuard, OFFLINE_MESSAGE } from './offline';
import { useSettingsStore } from './store/settingsStore';

describe('offline module', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => useSettingsStore.getState().setOfflineMode(false));
  afterEach(() => {
    globalThis.fetch = realFetch;
    useSettingsStore.getState().setOfflineMode(false);
  });

  it('isOffline follows the toggle (AIRGAP is false in tests)', () => {
    expect(isOffline()).toBe(false);
    useSettingsStore.getState().setOfflineMode(true);
    expect(isOffline()).toBe(true);
  });

  it('OFFLINE_MESSAGE names offline mode, not the airgap build', () => {
    expect(OFFLINE_MESSAGE).toMatch(/offline mode/i);
    expect(OFFLINE_MESSAGE).not.toMatch(/air-?gap/i);
  });

  it('guard blocks cross-origin fetches while offline, without calling through', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    useSettingsStore.getState().setOfflineMode(true);
    await expect(fetch('https://example.com/x')).rejects.toThrow(/offline mode/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it('guard passes same-origin and passes everything when offline is off', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = inner as unknown as typeof fetch;
    installOfflineFetchGuard();
    await fetch('/demo/manifest.json'); // relative → same-origin, offline off
    useSettingsStore.getState().setOfflineMode(true);
    await fetch('/models/x.onnx'); // same-origin while offline
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
```

Note for node env: `location` may be undefined — `isSameOrigin` below treats relative URLs (no scheme) as same-origin without touching `location`, so these tests run in node. `installOfflineFetchGuard` is idempotent per install but the test reinstalls over a fresh mock each time — implement the guard to wrap whatever `globalThis.fetch` is at install time (see Step 3), which makes that valid.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/offline.test.ts src/store/settingsStore.test.ts`
Expected: FAIL — `./offline` unresolved; store tests fail on missing field.

- [ ] **Step 4: Implement src/offline.ts**

```ts
/**
 * Runtime Offline mode: a user-flippable, BEHAVIORAL counterpart to the
 * build-time airgap guarantee. isOffline() is true in airgap builds always,
 * and in normal builds when the Settings toggle is on. JS-level enforcement
 * only — the CSP-sealed `build:airgap` remains the security guarantee.
 */
import { AIRGAP } from './airgap';
import { useSettingsStore } from './store/settingsStore';

export const OFFLINE_MESSAGE =
  'Offline mode is on — AI features are disabled (no external network).';

export function isOffline(): boolean {
  return AIRGAP || useSettingsStore.getState().offlineMode;
}

/** Relative URLs and same-origin/blob/data URLs are always allowed. */
function isExternal(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return false; // relative → same-origin
  if (/^(blob|data):/i.test(url)) return false;
  if (typeof location !== 'undefined' && url.startsWith(location.origin)) return false;
  return true;
}

let installed = false;

/**
 * Defense-in-depth: wrap fetch so that while offline, ANY cross-origin request
 * rejects before hitting the network — covering future code paths nobody
 * remembered to gate. Installed once at app startup (main.tsx).
 */
export function installOfflineFetchGuard(): void {
  if (installed && import.meta.env.MODE !== 'test') return;
  installed = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isOffline() && isExternal(input)) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.reject(
        new TypeError(`Offline mode: external request blocked (${url})`),
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
```

(Vitest sets `MODE` to `'test'`, letting tests reinstall over fresh mocks; production installs once.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/offline.test.ts src/store/settingsStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, then commit**

Run: `npm test` → all green.

```bash
git add src/store/settingsStore.ts src/store/settingsStore.test.ts src/offline.ts src/offline.test.ts
git commit -m "feat(offline): persisted offlineMode setting + isOffline() + global fetch guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Broaden the AIRGAP gates to isOffline()

**Files:**
- Modify: `src/enrich/gemini.ts`, `src/chat/ragChat.ts`
- Create: `src/enrich/gemini.offline.test.ts`, `src/chat/ragChat.offline.test.ts`

**Interfaces:** Consumes `isOffline`/`OFFLINE_MESSAGE` from Task 1.

- [ ] **Step 1: gemini.ts — collapse each AIRGAP guard into an offline guard**

Add import: `import { isOffline, OFFLINE_MESSAGE } from '../offline';`

Replace each of the four guards (they are the first line of `callGemini`, `docAiBlockedReason`, `streamGemini`, `runEnrichment`):

- `if (AIRGAP) return { ok: false, error: AIRGAP_MESSAGE };` →
  `if (isOffline()) return { ok: false, error: AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE };` (both `callGemini` and `streamGemini`)
- `if (AIRGAP) return AIRGAP_MESSAGE;` (docAiBlockedReason) →
  `if (isOffline()) return AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE;`
- `if (AIRGAP) return { ok: false, message: AIRGAP_MESSAGE };` (runEnrichment) →
  `if (isOffline()) return { ok: false, message: AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE };`

(`AIRGAP` and `AIRGAP_MESSAGE` remain imported and used.)

- [ ] **Step 2: ragChat.ts — useLocal via isOffline**

Add import: `import { isOffline } from '../offline';`
Change `const useLocal = AIRGAP || !enrichEnabled || geminiKey.trim() === '';` to:

```ts
  const useLocal = isOffline() || !enrichEnabled || geminiKey.trim() === '';
```

`AIRGAP` becomes unused in ragChat.ts — remove its import line entirely.

- [ ] **Step 3: Write the two offline tests**

Create `src/enrich/gemini.offline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEnrichment, docAiBlockedReason } from './gemini';
import { OFFLINE_MESSAGE } from '../offline';
import { useSettingsStore } from '../store/settingsStore';

describe('gemini gates under the offline toggle (normal build)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().setOfflineMode(true);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setGeminiKey('test-key');
  });
  afterEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setGeminiKey('');
  });

  it('runEnrichment refuses with OFFLINE_MESSAGE and never fetches, even with key+enrichment on', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await runEnrichment();
    expect(res).toEqual({ ok: false, message: OFFLINE_MESSAGE });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('docAiBlockedReason reports offline mode', () => {
    expect(docAiBlockedReason()).toBe(OFFLINE_MESSAGE);
  });
});
```

Create `src/chat/ragChat.offline.test.ts` (mirror of the airgap test, but via the real toggle — no `../airgap` mock):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('no embed worker in test')),
}));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { textStore, chunkStore, docVectorStore } from '../store/runtimeStores';

describe('offline-toggle chat: local, no network (normal build)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().clearMessages();
    textStore.clear(); chunkStore.clear(); docVectorStore.clear();
    useSettingsStore.getState().setOfflineMode(true);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setGeminiKey('test-key'); // proves the toggle overrides an available Gemini
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Rate Limiting' } as DocNode],
    });
    textStore.set('doc1', 'Rate limiting caps requests at 100 per minute to protect the API from abuse.');
  });
  afterEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setGeminiKey('');
  });

  it('answers locally with a citation and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendChatMessage('how does rate limiting work');
    expect(fetchSpy).not.toHaveBeenCalled();
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.text.toLowerCase()).toContain('rate limiting');
    expect(last?.sources?.some((s) => s.docId === 'doc1')).toBe(true);
  });
});
```

- [ ] **Step 4: Run focused, then full**

Run: `npx vitest run src/enrich/gemini.offline.test.ts src/chat/ragChat.offline.test.ts src/chat/ragChat.airgap.test.ts`
Expected: PASS (the airgap test still passes — `isOffline()` returns true under its `../airgap` mock… **note**: the airgap test mocks `../airgap`, and `offline.ts` imports `AIRGAP` from `../airgap`, so the mock propagates through `isOffline()`; verify this holds).

Run: `npm run typecheck && npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/enrich/gemini.ts src/chat/ragChat.ts src/enrich/gemini.offline.test.ts src/chat/ragChat.offline.test.ts
git commit -m "feat(offline): gemini/chat gates honor the offline toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: UI + guard install + SECURITY.md

**Files:**
- Modify: `src/main.tsx`, `src/ui/SettingsPanel.tsx`, `src/ui/SidePanel.tsx`, `src/ui/ChatPanel.tsx`, `src/ui/ChatPanel.test.tsx`, `SECURITY.md`

**Interfaces:** Consumes `installOfflineFetchGuard`, `offlineMode`/`setOfflineMode`.

- [ ] **Step 1: Install the guard at startup**

In `src/main.tsx`, add near the top (after imports, before render):

```ts
import { installOfflineFetchGuard } from './offline';

installOfflineFetchGuard();
```

- [ ] **Step 2: SettingsPanel — the toggle**

In `src/ui/SettingsPanel.tsx` (inside the existing `!AIRGAP` branch — the airgap badge branch is untouched), add store reads next to the existing ones:

```ts
  const offlineMode = useSettingsStore((s) => s.offlineMode);
  const setOfflineMode = useSettingsStore((s) => s.setOfflineMode);
```

At the TOP of the `AI Enrichment (optional)` section (right after its `<h3>`), insert:

```tsx
          <label
            style={checkboxRowStyle}
            title="Blocks all external network in the app and answers chat from your documents locally. Behavioral setting — for the sealed, CSP-enforced guarantee, ship the air-gapped build."
          >
            <input
              type="checkbox"
              checked={offlineMode}
              onChange={(e) => setOfflineMode(e.target.checked)}
            />
            Offline mode — no external network; local answers only
          </label>
          {offlineMode && (
            <p style={helpStyle}>
              AI features below are disabled while offline. (Behavioral setting — the
              air-gapped build remains the enforced guarantee.)
            </p>
          )}
```

Then disable the Gemini controls while offline: add `disabled={offlineMode}` to the key `<input>`, the remember-key checkbox, the model `<input>`, the enable-enrichment checkbox; and extend the Enrich-now button's existing `disabled={enriching || enrichBlocked}` to `disabled={enriching || enrichBlocked || offlineMode}` (mirror its opacity/cursor expression the same way).

- [ ] **Step 3: SidePanel + ChatPanel — reactive offline condition**

`src/ui/SidePanel.tsx`: add imports (`AIRGAP` is already imported):

```ts
import { useSettingsStore } from '../store/settingsStore';
```

In the component, add `const offlineMode = useSettingsStore((s) => s.offlineMode);` and change the DocAiSection gate `{!AIRGAP && fullText && (` to:

```tsx
          {!(AIRGAP || offlineMode) && fullText && (
```

`src/ui/ChatPanel.tsx`: change the `localMode` line to include the toggle:

```ts
  const offlineMode = useSettingsStore((s) => s.offlineMode);
  const localMode = AIRGAP || offlineMode || !enrichEnabled || geminiKey.trim() === '';
```

- [ ] **Step 4: Component test**

In `src/ui/ChatPanel.test.tsx`, the existing test mocks `../airgap` with `AIRGAP: true`. Add a second test file case in the same file is NOT possible for AIRGAP:false (module mock is file-wide) — so create the case in this file only if it works with the existing mock, otherwise skip: **instead**, add the assertion to the existing test that the hint also appears (it does, AIRGAP true). Then add one NEW check via the store: in a fresh test in the same file, set `useSettingsStore.getState().setOfflineMode(true)` before render and assert the hint still shows (AIRGAP mock true makes this redundant but harmless) — OR (preferred if quick): create `src/ui/ChatPanel.offline.test.tsx` with NO `../airgap` mock:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';

describe('ChatPanel offline toggle (normal build)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useChatStore.getState().clearMessages();
    useChatStore.getState().setIsOpen(true);
    useGraphStore.setState({ nodes: [{ id: 'doc1', kind: 'document', title: 'Doc' } as DocNode] });
    // Gemini otherwise available — the toggle alone must force local mode.
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setGeminiKey('test-key');
    useSettingsStore.getState().setOfflineMode(true);
  });
  afterEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setGeminiKey('');
  });

  it('shows the offline hint when the toggle is on', () => {
    render(<ChatPanel />);
    expect(screen.getByText(/offline mode/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: SECURITY.md — behavioral vs sealed**

In `SECURITY.md`, after the "Where data can go" table, add:

```markdown
> **Offline mode (Settings toggle) vs the air-gapped build:** the normal build
> includes an "Offline mode" toggle that blocks all external requests in
> JavaScript (per-call refusal plus a global fetch guard) and answers chat from
> your documents locally. It is a **behavioral** setting a user can flip off.
> For distribution where the guarantee must be enforced rather than configured,
> use the air-gapped build — its CSP physically removes the external network at
> the browser level and cannot be re-enabled at runtime.
```

- [ ] **Step 6: Verify everything**

Run: `npx vitest run src/ui/ChatPanel.offline.test.tsx` → PASS.
Run: `npm run typecheck && npm test` → all green.
Run: `npm run build >/dev/null && echo BUILD_OK` → BUILD_OK.
Run: `npm run build:airgap 2>&1 | tail -1` → `verify-airgap: OK …` (airgap unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx src/ui/SettingsPanel.tsx src/ui/SidePanel.tsx src/ui/ChatPanel.tsx src/ui/ChatPanel.offline.test.tsx SECURITY.md
git commit -m "feat(offline): Settings toggle, fetch-guard install, honest SECURITY.md note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** state+persistence (T1), isOffline+guard (T1), four gemini gates + ragChat useLocal (T2), UI toggle/disable/hide + hint (T3), guard install (T3), SECURITY.md honesty note (T3), tests at every layer. Airgap-unchanged constraint verified in T3 Step 6.
**Placeholders:** none — all code steps carry complete code; the one alternative in T4→T3 Step 4 resolves to a concrete preferred option (separate `.offline.test.tsx` file).
**Type consistency:** `isOffline(): boolean`, `OFFLINE_MESSAGE: string`, `installOfflineFetchGuard(): void` used identically across tasks; `offlineMode`/`setOfflineMode` mirror the store's existing naming pattern; guard return shapes in gemini.ts match each function's existing types.
