# Code Audit & Refactoring Suggestions — COMPLETED

> **Status: all 16 items from this audit have been implemented and verified.**
> This file is kept as a pointer so nobody re-litigates finished work. The full
> original audit (findings, rationale, and the priority matrix) is preserved in
> git history — see this file's log for the last full revision.

Verified implemented (September 2026):

| # | Item | Where it landed |
|---|---|---|
| 1 | macOS APFS hardlink `EPERM` handling | `agent/subagent.test.js` wraps `linkSync` in try/catch |
| 2 | `vite-node` devDependency | `package.json` |
| 3 | Remove unused `unist-util-visit` | `package.json` |
| 4 | Static `chatHistorySync` import | `src/persistence/session.ts` |
| 5 | TS strictness flags | `tsconfig.json` (`forceConsistentCasingInFileNames`, `noImplicitOverride`) |
| 6 | Module-scope `TextEncoder` + tokenization | `src/pipeline/chunker.ts` |
| 7 | Splice-free bounded inserts | `src/pipeline/similarity.ts` |
| 8 | Worker global scope typing | `src/workers/*.worker.ts` |
| 9 | Pipeline helper unit tests | `src/pipeline/spawnPosition.test.ts`, `src/pipeline/hash.test.ts` |
| 10 | `null` instead of empty fragment | `src/scene/Effects.tsx` (see `effectsNullFragment.test.ts`) |
| 11 | Instanced buffer disposal | `src/scene/Nodes.tsx` |
| 12 | Shared reader constants/slicing | `src/ui/readerUtils.ts` |
| 13 | Centralized `CloseButton` | `src/ui/CloseButton.tsx` |
| 14 | `isConnected` focus restore check | `src/ui/useFocusTrap.ts` |
| 15 | Typed window debug global | `src/App.tsx` |
| 16 | UI unit tests (focus trap, toasts, panels) | `src/ui/*.test.ts(x)` |

New improvement work is tracked in issues/PRs, not in this file.
