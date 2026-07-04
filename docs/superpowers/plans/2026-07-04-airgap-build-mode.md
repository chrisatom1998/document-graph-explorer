# Air-gapped Build Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run build:airgap`, a build variant with zero possible external network destinations — Gemini host stripped from the CSP, all AI UI removed, enrichment/chat refused at runtime, and the build failed by a post-build check if any external host survives.

**Architecture:** One Vite `--mode airgap` flag drives two things: a build-time CSP with no external `connect-src` host, and a single `AIRGAP` runtime constant (`import.meta.env.MODE === 'airgap'`) that gates all AI UI and refuses the network-calling functions. A post-build Node script asserts the shipped CSP has no external host. Two independent enforcement layers: runtime refusal, then CSP.

**Tech Stack:** Vite 7 (mode flag + `transformIndexHtml`), React 19, TypeScript, Vitest 4 (node env). No new runtime dependencies.

## Global Constraints

- **No new dependencies** — runtime or dev.
- **Normal `npm run build` must remain byte-for-byte behaviorally unchanged** — the Gemini host stays in its CSP; the AI UI stays present.
- **Airgap CSP `connect-src` must be exactly `'self' blob:`** — no scheme host (`http://`/`https://`) anywhere in the airgap CSP.
- **Airgap output dir is `dist-airgap/`**, never `dist/`.
- **`AIRGAP` stays a one-line constant** (`export const AIRGAP = import.meta.env.MODE === 'airgap'`); tests reach the guarded behavior via `vi.mock('../airgap', …)`, not by mutating the constant.
- Test env is node (`test.environment: 'node'`, `include: ['src/**/*.test.ts']`); there are **no** React component tests — UI changes are verified by `tsc --noEmit` + manual `preview`, matching existing project practice.
- End every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### Preconditions (read before starting)

The working tree already has **unrelated uncommitted changes**, including to two files this plan modifies (`src/ui/SidePanel.tsx`, `src/ui/ChatPanel.tsx`) plus `src/pipeline/coordinator.ts`, `src/styles.css`, `src/ui/openDocument.*`. Before executing, stash or commit those separately so airgap commits stay clean — otherwise Task 5's commit of `SidePanel.tsx` will sweep in the pre-existing diff. Work happens on branch `feat/airgap-build-mode` (already created; spec already committed there).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/security/csp.ts` (new) | Pure `buildCsp({ airgap })` — the single source of the CSP string |
| `src/security/csp.test.ts` (new) | Unit tests for both CSP modes |
| `src/airgap.ts` (new) | `AIRGAP` flag + `AIRGAP_MESSAGE` copy |
| `src/enrich/gemini.ts` (modify) | Refuse in the two fetch chokepoints + two user-facing entry points |
| `src/chat/ragChat.ts` (modify) | Refuse in the chat pre-flight |
| `src/enrich/gemini.airgap.test.ts` (new) | Prove gemini gates refuse without fetching |
| `src/chat/ragChat.airgap.test.ts` (new) | Prove chat gate refuses without fetching |
| `vite.config.ts` (modify) | Thread `mode` into `injectCsp`; call `buildCsp` |
| `package.json` (modify) | `build:airgap` script |
| `.gitignore` (modify) | ignore `dist-airgap/` |
| `scripts/verify-airgap.mjs` (new) | Post-build assertion: no external host in shipped CSP |
| `src/ui/SettingsPanel.tsx` (modify) | Replace enrichment section with badge when `AIRGAP` |
| `src/ui/SidePanel.tsx` (modify) | Hide `DocAiSection` when `AIRGAP` |
| `src/App.tsx` (modify) | Hide `<ChatPanel />` when `AIRGAP` |

---

## Task 1: CSP builder

**Files:**
- Create: `src/security/csp.ts`
- Test: `src/security/csp.test.ts`

**Interfaces:**
- Produces: `buildCsp(opts: { airgap: boolean }): string` — the full CSP policy string (directives joined by `'; '`).

- [ ] **Step 1: Write the failing test**

Create `src/security/csp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('normal build allows exactly the Gemini connect-src host', () => {
    const csp = buildCsp({ airgap: false });
    expect(csp).toContain(
      "connect-src 'self' blob: https://generativelanguage.googleapis.com",
    );
  });

  it('airgap build has no external host anywhere in the policy', () => {
    const csp = buildCsp({ airgap: true });
    expect(csp).toContain("connect-src 'self' blob:");
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toContain('generativelanguage');
  });

  it('both modes keep the non-connect directives identical', () => {
    const normal = buildCsp({ airgap: false });
    const air = buildCsp({ airgap: true });
    for (const d of ["script-src 'self' 'wasm-unsafe-eval' blob:", "worker-src 'self' blob:", "object-src 'none'"]) {
      expect(normal).toContain(d);
      expect(air).toContain(d);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/security/csp.test.ts`
Expected: FAIL — `Failed to resolve import "./csp"` / `buildCsp is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/security/csp.ts`:

```ts
/**
 * Single source of the app's Content-Security-Policy. In airgap builds the
 * only external connect-src host (Gemini) is removed, so the browser physically
 * blocks every off-origin request. Consumed by vite.config.ts's injectCsp
 * plugin at build time.
 */
export function buildCsp({ airgap }: { airgap: boolean }): string {
  const connectSrc = airgap
    ? "connect-src 'self' blob:"
    : "connect-src 'self' blob: https://generativelanguage.googleapis.com";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/security/csp.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/security/csp.ts src/security/csp.test.ts
git commit -m "feat(security): extract buildCsp with airgap mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Airgap flag + runtime refusal gates

**Files:**
- Create: `src/airgap.ts`
- Modify: `src/enrich/gemini.ts` (4 sites), `src/chat/ragChat.ts` (1 site)
- Test: `src/enrich/gemini.airgap.test.ts`, `src/chat/ragChat.airgap.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AIRGAP: boolean` and `AIRGAP_MESSAGE: string` from `src/airgap.ts`.
- Existing shapes this task relies on (already in the codebase): `callGemini` and `streamGemini` return `{ ok: true; text: string } | { ok: false; error: string }`; `runEnrichment()` returns `{ ok: boolean; message: string }`; `docAiBlockedReason()` returns `string | null`.

- [ ] **Step 1: Create the flag module**

Create `src/airgap.ts`:

```ts
/**
 * True only in builds produced by `npm run build:airgap` (Vite `--mode airgap`).
 * Gates every AI/network surface. Kept a one-line constant on purpose — tests
 * reach the guarded paths via `vi.mock('../airgap', …)`, never by mutating this.
 */
export const AIRGAP = import.meta.env.MODE === 'airgap';

/** User-facing copy shown wherever an AI path is refused in an airgap build. */
export const AIRGAP_MESSAGE =
  'This is an air-gapped build — AI features are disabled (no external network).';
```

- [ ] **Step 2: Write the failing tests**

Create `src/enrich/gemini.airgap.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the airgap gate on for this file only.
vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG' }));

import { runEnrichment, docAiBlockedReason } from './gemini';

describe('gemini AI gates under airgap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('runEnrichment refuses without ever calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await runEnrichment();
    expect(res.ok).toBe(false);
    expect(res.message).toBe('AIRGAP_TEST_MSG');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('docAiBlockedReason reports the air-gapped state', () => {
    expect(docAiBlockedReason()).toBe('AIRGAP_TEST_MSG');
  });
});
```

Create `src/chat/ragChat.airgap.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG' }));

import { sendChatMessage } from './ragChat';

describe('chat gate under airgap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sendChatMessage refuses without ever calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendChatMessage('hello');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/enrich/gemini.airgap.test.ts src/chat/ragChat.airgap.test.ts`
Expected: FAIL — `runEnrichment` returns its normal `'Turn on "Enable enrichment" first'` message (not `AIRGAP_TEST_MSG`); the chat test may call `fetch` or fail the message assertion because no gate exists yet.

- [ ] **Step 4: Add the gemini gates**

In `src/enrich/gemini.ts`, add the import near the other imports at the top of the file:

```ts
import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';
```

Guard the two fetch chokepoints. First line inside `callGemini` (currently `function callGemini(prompt, responseSchema): Promise<CallResult> {` at ~line 65), before `const { geminiKey, geminiModel } = …`:

```ts
  if (AIRGAP) return { ok: false, error: AIRGAP_MESSAGE };
```

First line inside `streamGemini` (currently `async function streamGemini(prompt, onChunk?): Promise<…> {` at ~line 318), before `const { geminiKey, geminiModel } = …`:

```ts
  if (AIRGAP) return { ok: false, error: AIRGAP_MESSAGE };
```

Guard the two user-facing entry points. First line inside `docAiBlockedReason` (~line 307), before `const { geminiKey, enrichEnabled } = …`:

```ts
  if (AIRGAP) return AIRGAP_MESSAGE;
```

First line inside `runEnrichment` (~line 491), before `const { geminiKey, enrichEnabled } = …`:

```ts
  if (AIRGAP) return { ok: false, message: AIRGAP_MESSAGE };
```

- [ ] **Step 5: Add the chat gate**

In `src/chat/ragChat.ts`, add the import near the top:

```ts
import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';
```

Inside `sendChatMessage` (~line 241), immediately after `chat.addMessage({ role: 'user', text: q });` (~line 253) and before the `if (!enrichEnabled || geminiKey.trim() === '')` check:

```ts
  if (AIRGAP) {
    chat.addMessage({ role: 'system', text: AIRGAP_MESSAGE });
    return;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/enrich/gemini.airgap.test.ts src/chat/ragChat.airgap.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — existing tests unaffected (they run with `MODE !== 'airgap'`, so `AIRGAP` is `false` outside the two mocked files).

- [ ] **Step 8: Commit**

```bash
git add src/airgap.ts src/enrich/gemini.ts src/chat/ragChat.ts src/enrich/gemini.airgap.test.ts src/chat/ragChat.airgap.test.ts
git commit -m "feat(airgap): refuse enrichment and chat at runtime under AIRGAP

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire the CSP builder + mode into the build

**Files:**
- Modify: `vite.config.ts`, `package.json`, `.gitignore`

**Interfaces:**
- Consumes: `buildCsp({ airgap })` from Task 1.
- Produces: `npm run build:airgap` emitting to `dist-airgap/` with an airgap CSP; `npm run build` unchanged.

- [ ] **Step 1: Replace the inline CSP with buildCsp and thread the mode**

In `vite.config.ts`:

Add the import below the existing imports:

```ts
import { buildCsp } from './src/security/csp';
```

Change `injectCsp` to accept the flag and delegate to `buildCsp`. Replace the current function body's CSP construction — replace this:

```ts
function injectCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: https://generativelanguage.googleapis.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
```

with this:

```ts
function injectCsp(airgap: boolean): Plugin {
  const csp = buildCsp({ airgap });
  return {
```

(Keep the rest of `injectCsp` — `name`, `apply: 'build'`, `transformIndexHtml` — exactly as-is. You may delete the now-redundant explanatory comment block above the old array or move it into `src/security/csp.ts`.)

Convert the default export to the callback form so it receives `mode`. Replace:

```ts
export default defineConfig({
  plugins: [react(), injectCsp()],
```

with:

```ts
export default defineConfig(({ mode }) => ({
  plugins: [react(), injectCsp(mode === 'airgap')],
```

Then close the object+call at the end of the file: change the final `});` of `defineConfig({ … })` to `}));`.

- [ ] **Step 2: Add the build script**

In `package.json` `scripts`, add after the `"build"` line:

```json
    "build:airgap": "tsc --noEmit && vite build --mode airgap --outDir dist-airgap && node scripts/verify-airgap.mjs",
```

(`scripts/verify-airgap.mjs` is created in Task 4. Until then, this step's verification stops at the grep below; the script call will error only because the file is absent, which Task 4 resolves.)

- [ ] **Step 3: Ignore the airgap output dir**

In `.gitignore`, add under the existing `dist/` line:

```
dist-airgap/
```

- [ ] **Step 4: Verify the normal build is unchanged**

Run: `npx vite build`
Then inspect the emitted CSP:

Run: `grep -o "connect-src[^;]*" dist/index.html`
Expected: `connect-src 'self' blob: https://generativelanguage.googleapis.com`

- [ ] **Step 5: Verify the airgap build strips the host**

Run: `npx vite build --mode airgap --outDir dist-airgap`
Then:

Run: `grep -o "connect-src[^;]*" dist-airgap/index.html`
Expected: `connect-src 'self' blob:`

Run: `grep -c "generativelanguage" dist-airgap/index.html`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts package.json .gitignore
git commit -m "feat(airgap): build:airgap script emitting a host-free CSP to dist-airgap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Post-build CSP verification script

**Files:**
- Create: `scripts/verify-airgap.mjs`

**Interfaces:**
- Consumes: `dist-airgap/index.html` produced by Task 3's airgap build.
- Produces: a Node script that exits non-zero if the shipped airgap CSP contains any external host; wired as the last step of `build:airgap`.

- [ ] **Step 1: Write the script**

Create `scripts/verify-airgap.mjs`:

```js
// Post-build gate for `npm run build:airgap`: fails the build if the shipped
// CSP allows any external host. The airgap guarantee is enforced here, not
// trusted. No dependencies — plain Node ESM.
import { readFileSync } from 'node:fs';

const htmlUrl = new URL('../dist-airgap/index.html', import.meta.url);

let html;
try {
  html = readFileSync(htmlUrl, 'utf8');
} catch {
  console.error('verify-airgap: dist-airgap/index.html not found — run the airgap build first.');
  process.exit(1);
}

const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
if (!match) {
  console.error('verify-airgap: FAIL — no CSP <meta> found in dist-airgap/index.html.');
  process.exit(1);
}

const csp = match[1];
if (/https?:\/\//i.test(csp)) {
  console.error('verify-airgap: FAIL — external host present in airgap CSP:\n  ' + csp);
  process.exit(1);
}

console.log('verify-airgap: OK — airgap CSP has no external host.\n  ' + csp);
```

- [ ] **Step 2: Run it against the current airgap build (pass case)**

(Task 3 already produced `dist-airgap/`. If not, run `npx vite build --mode airgap --outDir dist-airgap` first.)

Run: `node scripts/verify-airgap.mjs`
Expected: exit 0, prints `verify-airgap: OK — airgap CSP has no external host.` followed by the `connect-src 'self' blob:` policy.

- [ ] **Step 3: Prove it actually fails on a bad CSP**

Run:
```bash
npx vite build --outDir dist-airgap   # NORMAL mode into the airgap dir → CSP still has the Gemini host
node scripts/verify-airgap.mjs; echo "exit=$?"
```
Expected: prints `verify-airgap: FAIL — external host present…` and `exit=1`.

Then restore the correct airgap output:

Run: `npx vite build --mode airgap --outDir dist-airgap`
Expected: rebuilds the host-free `dist-airgap/`.

- [ ] **Step 4: Verify the full wired build succeeds end-to-end**

Run: `npm run build:airgap`
Expected: `tsc` passes, vite builds to `dist-airgap/`, and the script prints `verify-airgap: OK …` with exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-airgap.mjs
git commit -m "feat(airgap): fail build:airgap if any external host survives in the CSP

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Hide AI UI in airgap builds (hide + badge)

**Files:**
- Modify: `src/ui/SettingsPanel.tsx`, `src/ui/SidePanel.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `AIRGAP` from `src/airgap.ts` (Task 2).
- No new exports. No automated test (no component-test harness in this repo); verified by `tsc --noEmit` + manual `preview`.

- [ ] **Step 1: Settings — replace the enrichment section with a badge**

In `src/ui/SettingsPanel.tsx`, add the import after the existing `../config` import (line 9 area):

```ts
import { AIRGAP } from '../airgap';
```

Wrap the existing `AI Enrichment (optional)` `<section>` so it renders only in normal builds, and add the badge for airgap builds. Change the section's opening line (currently line ~184):

```tsx
        <section style={sectionStyle}>
          <h3 style={headingStyle}>AI Enrichment (optional)</h3>
```

to:

```tsx
        {AIRGAP && (
          <section style={sectionStyle}>
            <h3 style={headingStyle}>AI</h3>
            <p style={noteStyle}>
              🔒 Air-gapped build — no external network. AI features are removed
              from this build.
            </p>
          </section>
        )}
        {!AIRGAP && (
        <section style={sectionStyle}>
          <h3 style={headingStyle}>AI Enrichment (optional)</h3>
```

Then close the `{!AIRGAP && (…)}` wrapper at the section's existing closing tag. The enrichment `<section>` currently ends at line ~262 with `</section>` (immediately before the `Export` section). Change that closing `</section>` to:

```tsx
        </section>
        )}
```

(`noteStyle` and `sectionStyle`/`headingStyle` already exist in this file; the enrichment section's local variables remain referenced inside the `!AIRGAP` branch, so nothing becomes unused.)

- [ ] **Step 2: SidePanel — hide the per-doc Ask-AI panel**

In `src/ui/SidePanel.tsx`, add after the `import DocAiSection from './DocAiSection';` line (line 9):

```ts
import { AIRGAP } from '../airgap';
```

Change the DocAiSection block (currently lines ~213–219):

```tsx
          {fullText && (
            <>
              <hr className="hairline" />
              {/* key resets the Q&A state when the selection changes */}
              <DocAiSection key={node.id} docId={node.id} title={node.title} />
            </>
          )}
```

to gate on `!AIRGAP`:

```tsx
          {!AIRGAP && fullText && (
            <>
              <hr className="hairline" />
              {/* key resets the Q&A state when the selection changes */}
              <DocAiSection key={node.id} docId={node.id} title={node.title} />
            </>
          )}
```

- [ ] **Step 3: App — hide the chat panel**

In `src/App.tsx`, add near the `import ChatPanel from './ui/ChatPanel';` line (line 18):

```ts
import { AIRGAP } from './airgap';
```

Change `<ChatPanel />` (line ~207) to:

```tsx
      {!AIRGAP && <ChatPanel />}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 5: Manual smoke — airgap build hides AI, normal build keeps it**

Run: `npm run build:airgap && npx vite preview --outDir dist-airgap`
In the browser: open Settings → shows the 🔒 badge, no key/toggle; select a document → no "Ask AI" section; no chat panel present. Stop the preview.

Run: `npm run build && npx vite preview`
In the browser: Settings shows the full enrichment section; a selected document shows "Ask AI"; the chat panel is present. Stop the preview.

- [ ] **Step 6: Commit**

```bash
git add src/ui/SettingsPanel.tsx src/ui/SidePanel.tsx src/App.tsx
git commit -m "feat(airgap): hide enrichment, Ask-AI, and chat UI in airgap builds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Build entry point / `dist-airgap` → Task 3 (script, outDir), `.gitignore` → Task 3 Step 3. ✓
- CSP construction extracted + airgap host removal → Task 1 + wired in Task 3. ✓
- Single `AIRGAP` flag → Task 2 Step 1. ✓
- UI removal (Settings badge, no Ask-AI, no chat) → Task 5. ✓
- Runtime refusal (gemini + chat) → Task 2 Steps 4–5. ✓
- Verification: `verify-airgap.mjs` → Task 4; `buildCsp` unit tests → Task 1; runtime-gate tests → Task 2. ✓
- Non-goals honored: no dead-code stripping, no airgap dev mode, no new deps. ✓

**Placeholder scan:** No TBD/TODO; every code step shows exact code and every run step shows an exact command + expected output. The spec's one deferred detail (how to test the runtime gate) is resolved concretely via `vi.mock('../airgap', …)` in Task 2.

**Type consistency:** `buildCsp({ airgap: boolean }): string` is defined in Task 1 and consumed with the same shape in Task 3. `AIRGAP: boolean` / `AIRGAP_MESSAGE: string` defined in Task 2 and imported unchanged in Tasks 2 and 5. Runtime guards return the exact existing shapes: `CallResult` `{ ok:false; error }` for `callGemini`/`streamGemini`, `{ ok:false; message }` for `runEnrichment`, `string` for `docAiBlockedReason`. ✓
