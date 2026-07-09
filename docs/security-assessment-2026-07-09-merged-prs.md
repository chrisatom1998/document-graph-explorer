# Security assessment: last merged PRs (2026-07-09)

Review of every merged pull request in this repository for security
vulnerabilities and potential data leaks. Method: check out the codebase at
each PR's merge commit, inspect the full diff and surrounding call sites, then
cross-check residual findings against current `main`.

**Scope note:** the repository has only **two** merged PRs in its history
(GitHub API `state=all`). Both were reviewed. Other work landed as direct
commits to `main` and was out of scope for this pass.

| PR | Title | Merged | Merge commit |
|---|---|---|---|
| [#1](https://github.com/chrisatom1998/document-graph-explorer/pull/1) | Fix security vulnerabilities from security review | 2026-07-02 | `e3e79ed` |
| [#2](https://github.com/chrisatom1998/document-graph-explorer/pull/2) | Embed the app icon into the Windows .exe build | 2026-07-08 | `a2d2f5d` |

**Verdict:** neither PR introduced an exploitable vulnerability or data leak.
PR #1 is a net security improvement whose claims were verified against the
code. PR #2 is build tooling with a clean supply-chain diff.

---

## PR #1 — Fix security vulnerabilities from security review

**Files changed:** `config.ts`, `DropZone.tsx`, `exportImport.ts`,
`validateImport.ts` (+ tests), `settingsStore.ts`, `ChatPanel.tsx`,
`ProgressStrip.tsx`, `SettingsPanel.tsx`, `vite.config.ts`.

### What the PR claimed (and verification)

| Claim | Verified? | Notes |
|---|---|---|
| Sanitize imported GraphExport JSON (type-check, clamp, drop dangling edges, cap counts/embeddings) | Yes | `sanitizeGraphExport` is pure, unit-tested, and applied before React / layout worker / IndexedDB |
| Cap ingested file size at 64 MB | Yes | `MAX_INGEST_FILE_BYTES`; oversized drops go to the ignored tray |
| "Remember key" setting scrubs Gemini key from localStorage when off | Yes | Subscribe writer persists `''` when remember is off |
| Harden CSP (`connect-src` drops `data:`; security headers in dev/preview) | Yes | Headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` |
| Add `blob:` to `script-src` for onnxruntime | Yes | Required for `importScripts(blob:)`; see residual notes |

### Positive findings

- Gemini API key travels in the `x-goog-api-key` **header**, not a URL query
  parameter (avoids proxy/server log and browser-history leakage).
- Doc vectors live in a `Map`, so a crafted `__proto__` / `constructor` node id
  cannot pollute `Object.prototype` via embeddings.
- No XSS sinks at this snapshot: no `dangerouslySetInnerHTML`, `innerHTML`,
  `eval`, or `new Function` under `src/`.
- Export path never includes the Gemini key or settings — only graph data
  (and opt-in embeddings).

### Residual risks at merge time

1. **Gemini key in localStorage by default.** `rememberGeminiKey` defaulted to
   `true`, so the plaintext key sat in localStorage where any future XSS could
   read it. Defense-in-depth gap, not an active leak (no XSS sink found).
2. **`script-src` widened with `blob:`.** Required for onnxruntime. Blob URLs
   can only be minted by already-running same-origin JS, so this does not
   widen the injection surface by itself, but CSP no longer blocks blob-based
   script loading if an injection is ever found. Accepted trade-off.
3. **No size cap on the GraphExport import file itself.**
   `importGraphJSONFile` called `file.text()` before any check — a multi-GB
   `.json` could freeze/crash the tab (client-side DoS only).

### Status on current `main` (post-review remediations)

| Residual | Status |
|---|---|
| Remember-key default `true` | **Fixed** — default is now `false` |
| Import file size uncapped | **Fixed** — import reuses `MAX_INGEST_FILE_BYTES` |
| Stale plaintext key left until next settings write after default flip | **Fixed** in follow-up PR (eager scrub on boot) |
| `blob:` in `script-src` | **Accepted** — still required for embeddings |

---

## PR #2 — Embed the app icon into the Windows .exe build

**Files changed:** `.github/workflows/ci.yml`, `README.md`, `eslint.config.js`,
`package.json`, `package-lock.json`, `scripts/set-exe-icon.mjs`,
`scripts/stage-win-release.mjs`.

No application/runtime code changed. The PR swaps archived `pkg` for
`@yao-pkg/pkg`, post-processes the PE with `resedit` for icon/version metadata,
stages `dist/` beside `run.exe`, and adds a CI assertion that the PE has an
embedded icon.

### Supply-chain review

- Every added lockfile package resolves to `registry.npmjs.org` with `sha512`
  integrity. No `git+` / `http://` sources. No new `hasInstallScript` entries.
- Key versions at merge: `@yao-pkg/pkg` 6.21.0, `pkg-fetch` 3.6.4,
  `resedit` 3.0.2, `unzipper` 0.12.5, `tar-fs` 3.1.3 (post-dates known
  path-traversal CVEs), nested `tar` under `@yao-pkg/pkg` at 7.5.19 (outside
  the then-flagged `<=7.5.15` range).

### Script / packaging review

- `set-exe-icon.mjs` and `stage-win-release.mjs` operate only on fixed
  repo-local paths; no untrusted input. `rmSync` target is hardcoded
  `release/win/dist`.
- `release/` was already gitignored; no build artifacts or secrets in the
  tree at the merge commit.
- CI `build:exe` step runs under the plain `pull_request` trigger with no
  secrets — safe to build untrusted PR code.
- Bundled `serve-exe.cjs` (unchanged by this PR, but packaged by it) binds to
  `127.0.0.1` only and has a correct path-traversal guard (single decode,
  absolute-path rejection, normalized prefix check). No bypass found,
  including Windows drive-relative paths.

### Inherent caveats (documented, not vulnerabilities)

- `pkg-fetch` downloads a prebuilt Node base binary from GitHub releases at
  build time (checksum-verified against pinned hashes) — a trust dependency
  for the **build** machine, not end users of the web app.
- Produced `run.exe` is unsigned (SmartScreen warning) — explicitly documented
  in the README.

### Pre-existing audit noise (not introduced by PR #2)

At merge, `npm audit` reported highs in the `electron` 32.x /
`electron-builder` → `node-tar` **devDependency** chain (build-machine
exposure only). Later remediations on `main`:

| Item | Status |
|---|---|
| Electron 32.x advisories | **Fixed** — Electron upgraded to 43.x |
| Remaining `electron-builder` → `tar` highs | **Fixed** in follow-up PR (`electron-builder` ^26.15.3; `npm audit` → 0) |

---

## Follow-up work from this assessment

Landed on branch `cursor/pr-security-followups-85d7` (PR #3):

1. Eager localStorage scrub of stale Gemini keys when remember is off.
2. `electron-builder` upgrade clearing remaining audit findings.

Accepted / already fixed items are listed in the tables above and were not
re-opened.
