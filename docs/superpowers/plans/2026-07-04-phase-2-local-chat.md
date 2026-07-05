# Phase 2 — Local Extractive Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Gemini is unavailable (airgap build, or enrichment off / no key), answer chat questions by rendering the best-matching document passages verbatim with citations — fully local, zero network — and make chat available in the airgap build.

**Architecture:** A pure extractive formatter renders retrieved passages; `sendChatMessage` branches to it whenever Gemini isn't available (the Gemini generative path is untouched). A jsdom test harness is added for component tests. See `docs/superpowers/specs/2026-07-04-phase-2-local-chat-design.md`.

**Tech Stack:** React 19, TypeScript, Vitest 4 (node + per-file jsdom), Testing Library. No new runtime deps.

## Global Constraints

- **No new runtime dependency** in `package.json` `dependencies`. Test libs (`@testing-library/react`, `@testing-library/jest-dom`, `jsdom`) go in `devDependencies` only.
- **The Gemini generative path must remain behaviorally unchanged** — only add a local branch; don't alter prompt building, fetch, streaming, retry, or abort handling.
- **Local path makes zero network calls.** Retrieval (`retrieveChunks` → `embedQuery`, with `keywordFallback`) is already local; the formatter is pure.
- **`build:airgap` must still pass `verify-airgap`** (no new external host).
- Behavior selector: `const useLocal = AIRGAP || !enrichEnabled || geminiKey.trim() === '';`
- Constants (add to `src/config.ts`): `EXTRACT_MAX_PASSAGES = 4`, `EXTRACT_PASSAGE_CHARS = 600`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/config.ts` | modify | add `EXTRACT_MAX_PASSAGES`, `EXTRACT_PASSAGE_CHARS` |
| `src/chat/extractiveAnswer.ts` | create | pure `formatExtractiveAnswer` |
| `src/chat/extractiveAnswer.test.ts` | create | unit tests (node) |
| `src/chat/ragChat.ts` | modify | branch to local path when `useLocal` |
| `src/chat/ragChat.airgap.test.ts` | modify | assert local answer + no fetch |
| `src/App.tsx` | modify | render `<ChatPanel/>` in airgap |
| `src/ui/ChatPanel.tsx` | modify | offline-mode hint |
| `src/ui/ChatPanel.test.tsx` | create | component test (jsdom) |
| `vite.config.ts` | modify | broaden test `include` to `.tsx` |
| `package.json` | modify | add test devDeps |

---

## Task 1: Extractive answer formatter

**Files:**
- Modify: `src/config.ts`
- Create: `src/chat/extractiveAnswer.ts`, `src/chat/extractiveAnswer.test.ts`

**Interfaces:**
- Produces: `formatExtractiveAnswer(question: string, chunks: readonly Passage[]): { text: string; sources: ChatSource[] }` and `interface Passage { docId: string; docTitle: string; text: string; score: number }`.
- Consumes: `ChatSource` (`{ docId; snippet; score }`) from `src/store/chatStore.ts`.

- [ ] **Step 1: Add constants**

In `src/config.ts`, after the `SEARCH_MAX_RESULTS` line (Search section), add:

```ts
// --- Extractive (local, no-LLM) chat answers ---
export const EXTRACT_MAX_PASSAGES = 4; // distinct-doc passages shown in a local answer
export const EXTRACT_PASSAGE_CHARS = 600; // per-passage verbatim quote cap
```

- [ ] **Step 2: Write the failing test**

Create `src/chat/extractiveAnswer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatExtractiveAnswer, type Passage } from './extractiveAnswer';

const p = (docId: string, docTitle: string, text: string, score: number): Passage => ({
  docId, docTitle, text, score,
});

describe('formatExtractiveAnswer', () => {
  it('returns an honest empty message and no sources when nothing matched', () => {
    const r = formatExtractiveAnswer('anything', []);
    expect(r.sources).toEqual([]);
    expect(r.text).toMatch(/couldn.t find/i);
  });

  it('quotes the passage verbatim and cites the source doc', () => {
    const r = formatExtractiveAnswer('rate limits', [
      p('doc1', 'Rate Limiting', 'Requests are capped at 100/min per token.', 0.9),
    ]);
    expect(r.text).toContain('Rate Limiting');
    expect(r.text).toContain('Requests are capped at 100/min per token.');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ docId: 'doc1' });
  });

  it('keeps only the best passage per document', () => {
    const r = formatExtractiveAnswer('q', [
      p('doc1', 'A', 'low score chunk', 0.4),
      p('doc1', 'A', 'high score chunk', 0.8),
      p('doc2', 'B', 'other doc', 0.5),
    ]);
    expect(r.sources.map((s) => s.docId)).toEqual(['doc1', 'doc2']); // best-per-doc, score-sorted
    expect(r.text).toContain('high score chunk');
    expect(r.text).not.toContain('low score chunk');
  });

  it('caps the number of passages at EXTRACT_MAX_PASSAGES (4)', () => {
    const many = Array.from({ length: 7 }, (_, i) => p(`doc${i}`, `T${i}`, `text ${i}`, 1 - i * 0.1));
    const r = formatExtractiveAnswer('q', many);
    expect(r.sources).toHaveLength(4);
  });

  it('truncates a long passage to EXTRACT_PASSAGE_CHARS with an ellipsis', () => {
    const long = 'word '.repeat(400); // 2000 chars
    const r = formatExtractiveAnswer('q', [p('doc1', 'Long', long, 0.9)]);
    // quoted body (after the "> ") is capped near 600 chars and ends with an ellipsis
    expect(r.text).toContain('…');
    expect(r.text.length).toBeLessThan(long.length);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/chat/extractiveAnswer.test.ts`
Expected: FAIL — `Failed to resolve import "./extractiveAnswer"`.

- [ ] **Step 4: Implement**

Create `src/chat/extractiveAnswer.ts`:

```ts
/**
 * Local, no-LLM chat answers: render the best-matching retrieved passages
 * verbatim, grouped by source document, with citations. Used whenever Gemini
 * is unavailable (airgap build, or enrichment off / no key). Pure and
 * synchronous — the retrieval that feeds it (ragChat.retrieveChunks) is what
 * touches embeddings; this only formats.
 */
import { EXTRACT_MAX_PASSAGES, EXTRACT_PASSAGE_CHARS } from '../config';
import type { ChatSource } from '../store/chatStore';

const SOURCE_SNIPPET_CHARS = 200; // citation-chip preview length (matches ragChat)

export interface Passage {
  docId: string;
  docTitle: string;
  text: string;
  score: number;
}

/** Truncate on a word boundary near `max`, appending an ellipsis when cut. */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function formatExtractiveAnswer(
  question: string,
  chunks: readonly Passage[],
): { text: string; sources: ChatSource[] } {
  // Best passage per document, highest score first.
  const bestByDoc = new Map<string, Passage>();
  for (const c of chunks) {
    const cur = bestByDoc.get(c.docId);
    if (!cur || c.score > cur.score) bestByDoc.set(c.docId, c);
  }
  const top = [...bestByDoc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, EXTRACT_MAX_PASSAGES);

  if (top.length === 0) {
    return {
      text: "I couldn't find anything relevant to that in your documents.",
      sources: [],
    };
  }

  const q = question.trim();
  const lead = `Here ${top.length === 1 ? 'is the most relevant passage' : `are the ${top.length} most relevant passages`} from your documents${q ? ` for "${q}"` : ''}:`;
  const blocks = top.map((c) => `**${c.docTitle}**\n\n> ${clip(c.text, EXTRACT_PASSAGE_CHARS).replace(/\n+/g, '\n> ')}`);
  const text = [lead, ...blocks].join('\n\n');

  const sources: ChatSource[] = top.map((c) => ({
    docId: c.docId,
    snippet: c.text.slice(0, SOURCE_SNIPPET_CHARS).trim(),
    score: c.score,
  }));

  return { text, sources };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/chat/extractiveAnswer.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/chat/extractiveAnswer.ts src/chat/extractiveAnswer.test.ts
git commit -m "feat(chat): local extractive answer formatter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire the local path into sendChatMessage

**Files:**
- Modify: `src/chat/ragChat.ts`
- Modify: `src/chat/ragChat.airgap.test.ts`

**Interfaces:**
- Consumes: `formatExtractiveAnswer` (Task 1); existing `retrieveChunks`, `useChatStore`, `AIRGAP`.

**Context:** In `sendChatMessage`, two refusal blocks currently early-return: the `AIRGAP` guard (emits `AIRGAP_MESSAGE`) and the `!enrichEnabled || !key` guard. Replace both with a `useLocal` flag (no early return), and add a local branch right after `retrieveChunks`. The Gemini path (empty-chunks handling, prompt, fetch, stream, retry, abort, finally) is unchanged. The `controller`/`timeoutTimer` created before the try are harmless for the local path (cleared in the existing `finally`).

- [ ] **Step 1: Import the formatter**

In `src/chat/ragChat.ts`, add after the chatStore import (line ~20):

```ts
import { formatExtractiveAnswer } from './extractiveAnswer';
```

- [ ] **Step 2: Replace the two refusal guards with a useLocal flag**

Replace this block (currently lines ~256–270):

```ts
  if (AIRGAP) {
    chat.addMessage({ role: 'system', text: AIRGAP_MESSAGE });
    return;
  }

  // Validate API availability
  if (!enrichEnabled || geminiKey.trim() === '') {
    chat.addMessage({
      role: 'system',
      text: !enrichEnabled
        ? 'Turn on "Enable enrichment" in Settings to use the chat feature.'
        : 'Add a Gemini API key in Settings to use the chat feature.',
    });
    return;
  }
```

with:

```ts
  // When Gemini isn't available (airgap build, enrichment off, or no key), answer
  // locally by extracting the best-matching passages — no network, no refusal.
  const useLocal = AIRGAP || !enrichEnabled || geminiKey.trim() === '';
```

- [ ] **Step 3: Add the local branch after retrieval**

Immediately after `const chunks = await retrieveChunks(q);` (currently line ~299), before the existing `if (chunks.length === 0) {` block, insert:

```ts
    if (useLocal) {
      const { text, sources: localSources } = formatExtractiveAnswer(q, chunks);
      useChatStore.getState().updateMessage(assistantId, {
        text,
        ...(localSources.length ? { sources: localSources } : {}),
      });
      return;
    }
```

(The `return` triggers the existing `finally`, which clears the timeout and resets streaming state. `AIRGAP_MESSAGE` is now unused in this file — remove it from the `import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';` line, leaving `import { AIRGAP } from '../airgap';`, so lint/tsc stay clean.)

- [ ] **Step 4: Update the airgap test to expect a local answer**

Replace the entire contents of `src/chat/ragChat.airgap.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG' }));
// Fully mock the coordinator so its pdfjs import chain never loads and the query
// embed deterministically rejects — routing retrieveChunks through its local
// keywordFallback (substring/token match over textStore), which needs no worker.
vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('no embed worker in test')),
}));

import { sendChatMessage } from './ragChat';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { textStore, chunkStore, docVectorStore } from '../store/runtimeStores';

describe('airgap chat: local, no network', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().clearMessages();
    textStore.clear();
    chunkStore.clear();
    docVectorStore.clear();
    // Minimal document node — retrieveChunks reads id+title; docCount reads kind.
    useGraphStore.setState({
      nodes: [{ id: 'doc1', kind: 'document', title: 'Rate Limiting' } as DocNode],
    });
    textStore.set('doc1', 'Rate limiting caps requests at 100 per minute to protect the API from abuse.');
  });

  it('answers from local documents with a citation and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendChatMessage('how does rate limiting work');

    expect(fetchSpy).not.toHaveBeenCalled();
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.text).not.toBe('AIRGAP_TEST_MSG'); // no longer a refusal
    expect(last?.text.toLowerCase()).toContain('rate limiting'); // quotes the passage
    expect(last?.sources?.some((s) => s.docId === 'doc1')).toBe(true); // cited
  });
});
```

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run src/chat/ragChat.airgap.test.ts src/chat/extractiveAnswer.test.ts`
Expected: PASS. (If the keyword match fails, confirm the seeded `textStore` text shares words with the query — `keywordFallback` in `ragChat.ts` does token-overlap over `textStore`.)

- [ ] **Step 6: Full suite + typecheck (no regressions in the Gemini path)**

Run: `npm run typecheck && npm test`
Expected: PASS — all tests green, including the unchanged Gemini-path logic.

- [ ] **Step 7: Commit**

```bash
git add src/chat/ragChat.ts src/chat/ragChat.airgap.test.ts
git commit -m "feat(chat): answer locally by extraction when Gemini is unavailable

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Make chat available in airgap + offline hint

**Files:**
- Modify: `src/App.tsx`, `src/ui/ChatPanel.tsx`

**Interfaces:** Consumes `AIRGAP`; reads `enrichEnabled`/`geminiKey` from `useSettingsStore`.

- [ ] **Step 1: Render ChatPanel in airgap builds**

In `src/App.tsx`, change:

```tsx
      {!AIRGAP && <ChatPanel />}
```

to:

```tsx
      <ChatPanel />
```

(Leave the `AIRGAP` import — it still gates other UI. If `tsc`/lint flags `AIRGAP` as unused in App.tsx after this, confirm no other use and remove the import; there is other `AIRGAP` usage in App only if present — otherwise remove it.)

- [ ] **Step 2: Add the offline-mode hint to ChatPanel**

In `src/ui/ChatPanel.tsx`, add imports (near the existing store imports):

```tsx
import { AIRGAP } from '../airgap';
import { useSettingsStore } from '../store/settingsStore';
```

Inside the component, add a derived flag (after the existing store hooks, ~line 134):

```tsx
  const enrichEnabled = useSettingsStore((s) => s.enrichEnabled);
  const geminiKey = useSettingsStore((s) => s.geminiKey);
  const localMode = AIRGAP || !enrichEnabled || geminiKey.trim() === '';
```

Then render a hint inside the panel. Immediately after the `{/* Messages */}` container's closing `</div>` and before the input area (locate the input `<textarea>`; place this just above its wrapper), add:

```tsx
      {localMode && (
        <p className="chat-panel__mode-hint" title="Answers are exact passages retrieved from your own documents — no AI service, no network.">
          Offline mode — answers are exact passages from your documents.
        </p>
      )}
```

(If a `chat-panel__mode-hint` style doesn't exist, add a minimal rule to `src/styles.css` near the other `.chat-panel__` rules: small, muted text — `font-size: 11px; opacity: 0.6; margin: 0 12px 6px; text-align: center;`.)

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run typecheck && npm run build >/dev/null && echo BUILD_OK`
Expected: typecheck passes; `BUILD_OK`.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/ui/ChatPanel.tsx src/styles.css
git commit -m "feat(chat): show chat in airgap builds with an offline-mode hint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Component-test harness + airgap UI test

**Files:**
- Modify: `package.json`, `vite.config.ts`
- Create: `src/ui/ChatPanel.test.tsx`

**Interfaces:** none exported.

**Context:** No jsdom/component-test harness exists. Add one with the minimal footprint: devDeps + broaden the vitest `include`; component tests opt into jsdom per-file with a directive. No `test.projects`/workspace config.

- [ ] **Step 1: Add devDependencies**

Run: `npm install -D @testing-library/react @testing-library/jest-dom jsdom`
Expected: the three land in `package.json` `devDependencies`; `dependencies` unchanged.

- [ ] **Step 2: Broaden the vitest include**

In `vite.config.ts`, in the `test` block, change:

```ts
    include: ['src/**/*.test.ts'],
```

to:

```ts
    include: ['src/**/*.test.{ts,tsx}'],
```

- [ ] **Step 3: Write the jsdom component test**

Create `src/ui/ChatPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';

// Airgap build → chat is in local/offline mode.
vi.mock('../airgap', () => ({ AIRGAP: true, AIRGAP_MESSAGE: 'x' }));
// Keep ChatPanel's transitive coordinator/pdfjs import chain out of jsdom.
vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import ChatPanel from './ChatPanel';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';

describe('ChatPanel (airgap)', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useChatStore.getState().setIsOpen(true);
    useGraphStore.setState({ nodes: [{ id: 'doc1', kind: 'document', title: 'Doc' } as DocNode] });
  });

  it('shows the offline-mode hint when opened in an airgap build', () => {
    render(<ChatPanel />);
    expect(screen.getByText(/offline mode/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the new test in jsdom**

Run: `npx vitest run src/ui/ChatPanel.test.tsx`
Expected: PASS (1 passing), running under jsdom.

- [ ] **Step 5: Full suite (node + tsx together) + airgap build**

Run: `npm test`
Expected: PASS — both `.ts` (node) and `.tsx` (jsdom) tests run green.

Run: `npm run build:airgap 2>&1 | tail -2`
Expected: `verify-airgap: OK — airgap CSP has no external host.` (no new external host from the test deps — they're dev-only).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/ui/ChatPanel.test.tsx
git commit -m "test: add jsdom component-test harness + airgap ChatPanel test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1.1 local extractive answers → Task 1 (formatter) + Task 2 (wiring). ✓
- Chat available in airgap + hint → Task 3. ✓
- §2.5 component-test harness → Task 4. ✓
- Airgap chat test updated to local answer + no fetch → Task 2 Step 4. ✓
- Behavior matrix (Gemini when available, local otherwise) → Task 2 `useLocal`. ✓
- No new runtime deps → Task 4 uses `-D`. ✓

**Placeholder scan:** Every code step has complete code; run steps have exact commands + expected output. The one judgment note (App.tsx `AIRGAP` import possibly unused) is guarded with a concrete check.

**Type consistency:** `formatExtractiveAnswer(question, chunks: readonly Passage[]) → { text, sources: ChatSource[] }` defined in Task 1, consumed in Task 2 with `ragChat`'s `RetrievedChunk[]` (structurally a `Passage[]` — has `docId/docTitle/text/score`). `ChatSource` shape matches `chatStore`. `useLocal` defined once (Task 2 Step 2) and used in Task 2 Step 3. `DocNode` cast used consistently in both new tests. Constants `EXTRACT_MAX_PASSAGES`/`EXTRACT_PASSAGE_CHARS` defined in Task 1, imported in the formatter.
